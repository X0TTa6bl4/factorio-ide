/** Сессия редактирования сетей: индекс, MRU, транзакции и сборка Circuit. Без DOM и таймера. */

import { Circuit } from "./circuit.js";
import { Constant } from "./constant.js";
import { ConfigError } from "./errors.js";
import { isInt32 } from "./int32.js";
import {
  nextNetworkName,
  parseNetworkDocument,
  parseNetworkName,
  spliceText,
  suggestionItems,
} from "./network-document.js";
import { openProfile } from "./signal-profile.js";
import { isMetaToken, isSignalToken } from "./signal-token.js";

const EXAMPLE = `// Имя в комментарии не является сетью.
constant source {
  enabled: true
  red_output: null
  green_output: null
  label: "green_1"
  signal signal_A 5
}

wire reader {
  red_input: null
  green_input: null
}
`;

function issue(code, message, device, field = null, range = null) {
  return {
    code,
    message,
    device: device?.name ?? null,
    field,
    range: range ?? device?.range ?? { start: 0, end: 0 },
  };
}

function copyDiagnostic(item) {
  return {
    code: item.code,
    message: item.message,
    device: item.device,
    field: item.field,
    range: item.range ? { start: item.range.start, end: item.range.end } : null,
  };
}

export function createNetworkEditor(options = {}) {
  return new NetworkEditor(options);
}

export { EXAMPLE as NETWORK_DOCUMENT_EXAMPLE };

class NetworkEditor {
  #circuit;
  #text;
  #revision = 1;
  #undo = [];
  #redo = [];
  #live = new Map();
  #mru = new Map();
  #uses = new Map();
  #clock = 0;
  #ports = [];
  #portTokens = new Map();
  #tokensReady = false;
  #syntaxOk = false;
  #diagnostics = [];
  #retained = null;
  #simulation = null;
  #status = "editing";
  #hintCache = null;
  #signalCache = new Map();

  constructor(options = {}) {
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new ConfigError("invalid-editor-options", "Редактор принимает объект настроек");
    }
    const circuitOptions = {};
    if (Object.hasOwn(options, "profile")) circuitOptions.profile = options.profile;
    if (Object.hasOwn(options, "seed")) circuitOptions.seed = options.seed;
    this.#circuit = new Circuit(circuitOptions);
    this.#text = Object.hasOwn(options, "text") ? options.text : EXAMPLE;
    if (typeof this.#text !== "string") {
      throw new ConfigError("invalid-document", "Документ должен быть строкой");
    }
    const parsed = parseNetworkDocument(this.#text);
    this.#commitInspect(parsed, this.#inspect(parsed), { bump: false });
  }

  get revision() {
    return this.#revision;
  }

  get text() {
    return this.#text;
  }

  get status() {
    return this.#status;
  }

  get hintCache() {
    return this.#hintCache;
  }

  get diagnostics() {
    return this.#diagnostics.map(copyDiagnostic);
  }

  get canLaunch() {
    return this.#diagnostics.length === 0 && this.#syntaxOk;
  }

  get canUndo() {
    return this.#undo.length > 0;
  }

  get canRedo() {
    return this.#redo.length > 0;
  }

  index() {
    const entries = [...this.#live.values()].map((network) => ({
      name: network.name,
      id: network.id,
      color: network.color,
      mru: this.#mru.get(network) ?? 0,
      uses: (this.#uses.get(network) ?? []).map((use) => ({ device: use.device, port: use.port })),
    }));
    entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    return { revision: this.#revision, entries };
  }

  ports() {
    return this.#ports.map((port) => ({
      device: port.device,
      field: port.field,
      color: port.color,
      text: port.text,
      kind: port.kind,
    }));
  }

  publication() {
    if (!this.#simulation) return null;
    return {
      current: true,
      tick: this.#simulation.tick,
      networks: this.#circuit.networks.map((network) => ({
        id: network.id,
        name: network.name,
        signals: this.#simulation.present(network).map((entry) => ({
          name: entry.signal.name,
          constant: entry.constant,
        })),
      })),
    };
  }

  retained() {
    if (!this.#retained) return null;
    return {
      revision: this.#retained.revision,
      matchesText: this.#retained.revision === this.#revision && this.#diagnostics.length === 0,
      networks: this.#retained.networks.map((network) => ({ ...network })),
      ports: this.#retained.ports.map((port) => ({ ...port })),
    };
  }

  view() {
    const publication = this.publication();
    return {
      revision: this.#revision,
      text: this.#text,
      status: this.#status,
      canLaunch: this.canLaunch,
      diagnostics: this.diagnostics,
      index: this.index(),
      ports: this.ports(),
      publication,
      retained: this.retained(),
      current: publication !== null,
    };
  }

  replace(text) {
    if (typeof text !== "string") throw new ConfigError("invalid-document", "Документ должен быть строкой");
    if (text === this.#text) return { changed: false, revision: this.#revision };
    this.#transact(() => {
      this.#text = text;
    });
    return { changed: true, revision: this.#revision, diagnostics: this.diagnostics };
  }

  load(text) {
    if (typeof text !== "string") throw new ConfigError("invalid-document", "Документ должен быть строкой");
    const parsed = parseNetworkDocument(text);
    const inspected = this.#inspect(parsed);
    const blocking = inspected.diagnostics.filter((item) => item.code !== "unknown-network");
    const declared = blocking.length === 0 ? inspected.unknown.slice() : [];
    this.#transact(() => {
      for (const name of declared) this.#circuit.network(name);
      this.#text = text;
    }, { bump: false });
    return { declared, revision: this.#revision };
  }

  suggestions({ color, query = "", revision } = {}) {
    if (color !== "red" && color !== "green") {
      throw new ConfigError("wrong-color", "Подсказки сети относятся к красному или зелёному порту");
    }
    if (revision !== undefined && revision !== this.#revision) {
      return { applied: false, revision: this.#revision, items: [] };
    }
    const entries = [...this.#live.values()].map((network) => ({
      name: network.name,
      id: network.id,
      color: network.color,
      mru: this.#mru.get(network) ?? 0,
    }));
    return {
      applied: true,
      revision: this.#revision,
      items: suggestionItems({ color, query, entries }),
    };
  }

  preview(name) {
    const network = this.#live.get(name);
    if (!network) return null;
    return { name: network.name, id: network.id, color: network.color, mru: this.#mru.get(network) ?? 0 };
  }

  applySuggestion({ device, port, choice, name, revision } = {}) {
    if (revision !== undefined && revision !== this.#revision) {
      return { applied: false, revision: this.#revision };
    }
    if (!this.#syntaxOk) throw new ConfigError("syntax", "Подстановка доступна после разбора документа");
    const located = this.#ports.find((item) => item.device === device && item.field === port);
    if (!located) throw new ConfigError("unknown-port", "Порт не найден в текущем документе");
    let inserted = null;
    const outcome = this.#transact(() => {
      inserted = this.#insertChoice(located, choice, name);
      this.#text = spliceText(this.#text, [{
        start: located.range.start,
        end: located.range.end,
        text: inserted,
      }]);
    }, { rollbackOnDiagnostic: true });
    if (!outcome.ok) return { applied: false, revision: this.#revision, diagnostics: outcome.diagnostics };
    const network = inserted === "null" ? null : this.#networkByName(inserted);
    return {
      applied: true,
      name: inserted,
      id: network ? network.id : null,
      revision: this.#revision,
    };
  }

  rename(name, nextName) {
    const network = this.#live.get(name);
    if (!network) throw new ConfigError("missing-network", "Сеть уже исключена из схемы");
    if (!this.#syntaxOk) throw new ConfigError("syntax", "Переименование доступно после разбора документа");
    const edits = this.#ports
      .filter((port) => port.kind === "name" && port.text === name)
      .map((port) => ({ start: port.range.start, end: port.range.end, text: nextName }));
    this.#transact(() => {
      this.#circuit.renameNetwork(network, nextName);
      this.#text = spliceText(this.#text, edits);
    }, { bump: false });
    return { name: network.name, id: network.id, revision: this.#revision };
  }

  planRemoval(name) {
    const network = this.#live.get(name);
    if (!network) throw new ConfigError("missing-network", "Сеть уже исключена из схемы");
    return {
      name: network.name,
      id: network.id,
      uses: (this.#uses.get(network) ?? []).map((use) => ({ device: use.device, port: use.port })),
    };
  }

  cancelRemoval() {
    return { changed: false, revision: this.#revision, text: this.#text };
  }

  commitRemoval(name) {
    const network = this.#live.get(name);
    if (!network) throw new ConfigError("missing-network", "Сеть уже исключена из схемы");
    if (!this.#syntaxOk) throw new ConfigError("syntax", "Удаление сети доступно после разбора документа");
    const id = network.id;
    const edits = this.#ports
      .filter((port) => port.kind === "name" && port.text === name)
      .map((port) => ({ start: port.range.start, end: port.range.end, text: "null" }));
    this.#transact(() => {
      this.#text = spliceText(this.#text, edits);
    });
    return { removed: !this.#live.has(name), id, revision: this.#revision };
  }

  undo() {
    return this.#travel(this.#undo, this.#redo);
  }

  redo() {
    return this.#travel(this.#redo, this.#undo);
  }

  completeParse(revision, payload = {}) {
    if (revision !== this.#revision) return { applied: false, revision: this.#revision };
    if (payload && typeof payload === "object" && !Array.isArray(payload) && Object.hasOwn(payload, "cache")) {
      this.#hintCache = payload.cache;
    }
    return { applied: true, revision: this.#revision };
  }

  diagnose(color, value) {
    if (color !== "red" && color !== "green") {
      return {
        ok: false,
        code: "wrong-color",
        message: "Подсказки сети относятся к красному или зелёному порту",
        network: null,
      };
    }
    const field = color === "red" ? "red_input" : "green_input";
    const probe = { [field]: value };
    try {
      this.#circuit.add(probe);
      this.#circuit.remove(probe);
      return { ok: true, code: null, message: "", network: value ?? null };
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error;
      return { ok: false, code: error.code, message: error.message, network: null };
    }
  }

  async launch() {
    const revision = this.#revision;
    const parsed = parseNetworkDocument(this.#text);
    const inspected = this.#inspect(parsed);
    if (inspected.diagnostics.length > 0) {
      this.#commitInspect(parsed, inspected, { bump: false });
      return { applied: false, diagnostics: this.diagnostics, revision: this.#revision };
    }
    this.#discardRuntime();
    this.#install(inspected.built, { bump: false });
    let simulation;
    try {
      simulation = await this.#circuit.createSimulation();
    } catch (error) {
      if (this.#revision !== revision) this.#reapply();
      throw error;
    }
    this.#ensureAttached();
    if (this.#revision !== revision) {
      this.#simulation = null;
      this.#reapply();
      return { applied: false, stale: true, revision: this.#revision };
    }
    this.#simulation = simulation;
    this.#status = "ready";
    return { applied: true, revision, tick: simulation.tick };
  }

  async step() {
    if (!this.#simulation) {
      const launched = await this.launch();
      if (!launched.applied) return launched;
    }
    const revision = this.#revision;
    const simulation = this.#simulation;
    await simulation.step();
    if (this.#simulation !== simulation || this.#revision !== revision) {
      return { applied: false, stale: true, revision: this.#revision };
    }
    this.#status = "ready";
    return { applied: true, tick: simulation.tick, revision };
  }

  resetRun() {
    this.#discardRuntime();
    this.#status = this.#diagnostics.length > 0 ? "invalid" : "editing";
    return { revision: this.#revision, publication: null };
  }

  #insertChoice(located, choice, name) {
    if (choice === "new") {
      const created = nextNetworkName(located.color, this.#circuit.networks.map((network) => network.name));
      this.#circuit.network(created);
      return created;
    }
    if (choice === "create") {
      const parsed = parseNetworkName(name);
      if (!parsed || parsed.color !== located.color) {
        throw new ConfigError(parsed ? "wrong-color" : "invalid-name", "Нельзя создать это имя для порта");
      }
      if (this.#networkByName(name)) throw new ConfigError("occupied-name", `Имя ${name} занято`);
      this.#circuit.network(name);
      return name;
    }
    if (choice === "null") return "null";
    if (choice === "network") {
      const network = this.#networkByName(name);
      if (!network) throw new ConfigError("missing-network", "Сеть не создана");
      if (network.color !== located.color) {
        throw new ConfigError("wrong-color", "Цвет сети не соответствует порту");
      }
      return name;
    }
    throw new ConfigError("invalid-choice", "Неизвестное действие подсказки");
  }

  #transact(change, { bump = true, rollbackOnDiagnostic = false } = {}) {
    const snapshot = this.#snapshot();
    try {
      change();
    } catch (error) {
      this.#restore(snapshot);
      throw error;
    }
    const parsed = parseNetworkDocument(this.#text);
    const inspected = this.#inspect(parsed);
    if (rollbackOnDiagnostic && inspected.diagnostics.length > 0) {
      this.#restore(snapshot);
      return { ok: false, diagnostics: inspected.diagnostics.map(copyDiagnostic) };
    }
    this.#discardRuntime();
    this.#undo.push(snapshot);
    if (this.#undo.length > 100) this.#undo.shift();
    this.#redo = [];
    this.#revision += 1;
    this.#commitInspect(parsed, inspected, { bump });
    return { ok: true };
  }

  #travel(source, target) {
    if (source.length === 0) return { applied: false, revision: this.#revision };
    this.#discardRuntime();
    const current = this.#snapshot();
    const snapshot = source.pop();
    target.push(current);
    this.#restore(snapshot);
    this.#revision += 1;
    const parsed = parseNetworkDocument(this.#text);
    this.#commitInspect(parsed, this.#inspect(parsed), { bump: false });
    return { applied: true, revision: this.#revision };
  }

  #snapshot() {
    return {
      text: this.#text,
      items: [...this.#live.entries()].map(([name, network]) => ({
        name,
        network,
        mru: this.#mru.get(network) ?? 0,
        uses: (this.#uses.get(network) ?? []).map((use) => ({ device: use.device, port: use.port })),
      })),
    };
  }

  #restore(snapshot) {
    this.#text = snapshot.text;
    for (const network of this.#circuit.networks) this.#circuit.detachNetwork(network);
    this.#live = new Map();
    this.#uses = new Map();
    for (const item of snapshot.items) {
      this.#circuit.restoreNetwork(item.network, item.name);
      this.#live.set(item.name, item.network);
      this.#mru.set(item.network, item.mru);
      this.#uses.set(item.network, item.uses.map((use) => ({ device: use.device, port: use.port })));
    }
  }

  #ensureAttached() {
    for (const [name, network] of this.#live) {
      if (network.circuit !== this.#circuit) this.#circuit.restoreNetwork(network, name);
    }
  }

  #reapply() {
    this.#ensureAttached();
    const parsed = parseNetworkDocument(this.#text);
    this.#commitInspect(parsed, this.#inspect(parsed), { bump: false });
    this.#ensureAttached();
  }

  #discardRuntime() {
    this.#simulation = null;
    if (this.#status === "ready") this.#status = "editing";
  }

  #networkByName(name) {
    return this.#circuit.networks.find((network) => network.name === name) ?? null;
  }

  #bump(network) {
    this.#clock += 1;
    this.#mru.set(network, this.#clock);
  }

  #commitInspect(parsed, inspected, { bump }) {
    if (parsed.syntax.length > 0) {
      this.#diagnostics = parsed.syntax.map(copyDiagnostic);
      this.#syntaxOk = false;
      this.#ports = [];
      this.#status = "invalid";
      return;
    }
    this.#ports = inspected.ports;
    this.#syntaxOk = true;
    if (inspected.diagnostics.length > 0) {
      this.#diagnostics = inspected.diagnostics.map(copyDiagnostic);
      this.#status = "invalid";
      return;
    }
    this.#install(inspected.built, { bump });
  }

  #install(built, { bump }) {
    for (const device of this.#circuit.devices) this.#circuit.remove(device);
    for (const device of built.devices) this.#circuit.add(device);
    const used = new Set(built.networks);
    this.#live = new Map(built.networks.map((network) => [network.name, network]));
    this.#uses = new Map();
    for (const [network, uses] of built.uses) {
      this.#uses.set(network, uses.map((use) => ({ device: use.device, port: use.port })));
    }
    for (const network of this.#circuit.networks) {
      if (!used.has(network)) this.#circuit.detachNetwork(network);
    }
    const nextTokens = new Map(built.tokenEntries);
    if (bump && this.#tokensReady) {
      for (const [key, token] of nextTokens) {
        if (this.#portTokens.get(key) === token) continue;
        if (!parseNetworkName(token)) continue;
        const network = this.#networkByName(token);
        if (network) this.#bump(network);
      }
    }
    this.#portTokens = nextTokens;
    this.#tokensReady = true;
    this.#diagnostics = [];
    this.#status = "editing";
    this.#retained = {
      revision: this.#revision,
      networks: built.networks.map((network) => ({
        name: network.name,
        id: network.id,
        color: network.color,
      })),
      ports: built.ports.map((port) => ({ ...port })),
    };
  }

  #inspect(parsed) {
    const diagnostics = parsed.syntax.map(copyDiagnostic);
    const unknown = [];
    const ports = [];
    if (parsed.syntax.length > 0) {
      return { diagnostics, unknown, ports, built: null };
    }
    const seenDevices = new Set();
    const uses = new Map();
    const referenced = [];
    const plans = [];
    for (const device of parsed.devices) {
      if (seenDevices.has(device.name)) {
        diagnostics.push(issue("duplicate-device", `Устройство ${device.name} повторяется`, device));
      }
      seenDevices.add(device.name);
      const seenFields = new Set();
      const portValues = {};
      for (const port of device.ports) {
        if (seenFields.has(port.field)) {
          diagnostics.push(issue(
            "duplicate-field",
            `Поле ${port.field} повторяется`,
            device,
            port.field,
            port.range,
          ));
        }
        seenFields.add(port.field);
        ports.push({
          device: device.name,
          field: port.field,
          color: port.color,
          kind: port.kind,
          text: port.text,
          range: { start: port.range.start, end: port.range.end },
        });
        const resolved = this.#resolvePort(device, port, diagnostics, unknown);
        portValues[port.field] = resolved;
        if (resolved) {
          const list = uses.get(resolved) ?? [];
          list.push({ device: device.name, port: port.field });
          uses.set(resolved, list);
          referenced.push(resolved);
        }
      }
      if (device.kind === "wire" && device.signals.length > 0) {
        diagnostics.push(issue("invalid-field", "У провода нет сигналов", device, "signal", device.signals[0].range));
      }
      if (device.kind === "wire" && device.enabled) {
        diagnostics.push(issue("invalid-field", "У провода нет enabled", device, "enabled", device.enabled.range));
      }
      if (device.kind === "constant") {
        for (const field of ["red_input", "green_input"]) {
          if (portValues[field]) {
            const port = device.ports.find((item) => item.field === field);
            diagnostics.push(issue(
              "forbidden-input",
              "Источник constant не имеет входов",
              device,
              field,
              port?.range,
            ));
          }
        }
        for (const signal of device.signals) this.#resolveSignal(device, signal, diagnostics);
      }
      plans.push({ device, portValues });
    }
    if (diagnostics.length > 0) return { diagnostics, unknown, ports, built: null };
    const devices = plans.map((plan) => this.#materialize(plan));
    const networks = [...new Set(referenced)];
    const retainedPorts = ports.map((port) => {
      const network = port.kind === "name" ? this.#networkByName(port.text) : null;
      return {
        device: port.device,
        field: port.field,
        name: network ? network.name : null,
        id: network ? network.id : null,
      };
    });
    return {
      diagnostics,
      unknown,
      ports,
      built: {
        devices,
        networks,
        uses,
        ports: retainedPorts,
        tokenEntries: ports.map((port) => [`${port.device}.${port.field}`, port.text]),
      },
    };
  }

  #resolvePort(device, port, diagnostics, unknown) {
    if (port.kind === "null") return null;
    if (port.kind !== "name") {
      diagnostics.push(issue(
        "invalid-port",
        port.kind === "string"
          ? "Требуется ссылка на сеть или null, получена строка"
          : "Требуется ссылка на сеть или null",
        device,
        port.field,
        port.range,
      ));
      return null;
    }
    const parsed = parseNetworkName(port.text);
    if (!parsed) {
      diagnostics.push(issue(
        "invalid-port",
        "Требуется ссылка на сеть или null",
        device,
        port.field,
        port.range,
      ));
      return null;
    }
    if (parsed.color !== port.color) {
      diagnostics.push(issue(
        "wrong-color",
        "Цвет сети не соответствует порту",
        device,
        port.field,
        port.range,
      ));
      return null;
    }
    const network = this.#networkByName(port.text);
    if (!network) {
      diagnostics.push(issue(
        "unknown-network",
        "Неизвестное имя не создаёт сеть",
        device,
        port.field,
        port.range,
      ));
      if (!unknown.includes(port.text)) unknown.push(port.text);
      return null;
    }
    return network;
  }

  #resolveSignal(device, signal, diagnostics) {
    const constant = Number(signal.raw);
    if (!isInt32(constant)) {
      diagnostics.push(issue(
        "invalid-constant",
        "Количество сигнала должно быть целым int32",
        device,
        "signal",
        signal.range,
      ));
      return;
    }
    const found = this.#findSignals(signal.name);
    if (found.length !== 1) {
      diagnostics.push(issue(
        "invalid-signal",
        found.length === 0 ? "Сигнал не найден в профиле" : "Имя сигнала неоднозначно",
        device,
        "signal",
        signal.range,
      ));
      return;
    }
    if (isMetaToken(found[0])) {
      diagnostics.push(issue(
        "meta-signal",
        "Метасигнал не является каналом",
        device,
        "signal",
        signal.range,
      ));
      return;
    }
    signal.token = found[0];
    signal.constant = constant;
  }

  #findSignals(name) {
    const profileName = this.#circuit.profile;
    const key = `${profileName}:${name}`;
    if (this.#signalCache.has(key)) return this.#signalCache.get(key);
    const tree = openProfile(profileName).tree;
    const found = [];
    for (const group of Object.keys(tree)) {
      const bucket = tree[group];
      if (!bucket || typeof bucket !== "object") continue;
      if (!Object.hasOwn(bucket, name)) continue;
      const token = bucket[name];
      if (isSignalToken(token) || isMetaToken(token)) found.push(token);
    }
    this.#signalCache.set(key, found);
    return found;
  }

  #materialize(plan) {
    const ports = {};
    for (const [field, value] of Object.entries(plan.portValues)) {
      if (plan.device.kind === "constant" && (field === "red_input" || field === "green_input")) continue;
      ports[field] = value;
    }
    if (plan.device.kind === "wire") return ports;
    return new Constant({
      enabled: plan.device.enabled ? plan.device.enabled.value : true,
      signals: plan.device.signals.map((signal) => ({ signal: signal.token, constant: signal.constant })),
      ...ports,
    });
  }
}
