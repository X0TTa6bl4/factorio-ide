/** Редактор конфигурации: индекс подсказок, revision и полная сборка перед запуском. */

import { completionContext, pathChildren, structuralInsertion } from "./config-completion.js";
import { formatConfiguration } from "./config-format.js";
import { checkConfiguration, buildPrepared, listSignalPaths, operationCatalog, qualityCatalog, signalAllowed, compareCatalog } from "./config-check.js";
import { findNode } from "./config-grammar.js";
import { Circuit } from "./circuit.js";
import { ConfigError } from "./errors.js";
import { networkFinishChoice, nextNetworkName, parseNetworkName, spliceText, suggestionItems } from "./network-document.js";
import { openProfile } from "./signal-profile.js";

export const CONFIGURATION_EXAMPLE = `Constant({
  enabled: true,
  red_output: red_1,
  signals: [{ signal: Signal.Logistic.wooden_chest, constant: 3 }]
})

Arithmetic({
  red_input: red_1,
  green_output: green_1,
  left_operand: { red: true, green: true, signal: Signal.Logistic.wooden_chest },
  right_operand: { constant: 2 },
  operation: Arithmetic.Operation.SUM,
  return: Signal.Logistic.wooden_chest
})

Decider({
  red_input: red_1,
  conditions: [{
    left_operand: { red: true, green: false, signal: Signal.Logistic.wooden_chest },
    right_operand: { constant: 0 },
    operation: Decider.Operation.GT
  }],
  when_true: [{ signal: Signal.Logistic.wooden_chest, constant: 1 }]
})

Selector({
  red_input: red_1,
  operation: Selector.Operation.SELECT,
  sort: Selector.Sort.DESC,
  index: { constant: 0 },
  compare: Selector.Compare.EQ
})

event clock = new EventCombinator({
  run: { every_tick: true, input_changed: false },
  state: { started: false }
})
`;

function copyDiagnostic(item) {
  return {
    code: item.code,
    message: item.message,
    field: item.field ?? null,
    expected: item.expected ?? null,
    received: item.received ?? null,
    related: [...(item.related ?? [])],
    range: item.range ? { ...item.range } : { start: 0, end: 0 },
  };
}

export function createConfigurationEditor(options = {}) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new ConfigError("invalid-editor-options", "Редактор принимает объект настроек");
  }
  const profile = options.profile ?? "base";
  const text = options.text ?? CONFIGURATION_EXAMPLE;
  if (typeof text !== "string") throw new ConfigError("invalid-document", "Документ должен быть строкой");
  const circuit = new Circuit({ profile });
  const editor = {
    get revision() {
      return state.revision;
    },
    get text() {
      return state.text;
    },
    get profile() {
      return profile;
    },
    get diagnostics() {
      return state.diagnostics.map(copyDiagnostic);
    },
    get canLaunch() {
      return state.diagnostics.length === 0;
    },
    get canUndo() {
      return state.undo.length > 0;
    },
    get canRedo() {
      return state.redo.length > 0;
    },
    model() {
      return state.model;
    },
    locate(device, path) {
      const parts = Array.isArray(path) ? path : String(path).split(".");
      for (const statement of state.statements) {
        if (statement.name !== device && statement.identity !== device) continue;
        const node = findNode(statement, parts);
        if (!node?.range) continue;
        return {
          range: { ...node.range },
          text: state.text.slice(node.range.start, node.range.end),
        };
      }
      return null;
    },
    index() {
      return {
        revision: state.revision,
        networks: [...state.live].map(([name, network]) => ({
          name,
          id: network.id,
          color: network.color,
          mru: state.mru.get(`network:${name}`) ?? 0,
        })),
        devices: state.statements
          .filter((item) => item.type === "device")
          .map((item) => ({ name: item.name, kind: item.kind, id: item.identity ?? null })),
      };
    },
    replace(next, selection) {
      if (typeof next !== "string") throw new ConfigError("invalid-document", "Документ должен быть строкой");
      if (next === state.text) return { changed: false, revision: state.revision };
      const before = caretOf(selection?.before ?? selection);
      const after = caretOf(selection?.after);
      if (before) state.caret = before;
      transact(() => {
        state.text = next;
      });
      if (after) state.caret = after;
      return { changed: true, revision: state.revision, diagnostics: editor.diagnostics };
    },
    splice(range, inserted) {
      if (!range || typeof inserted !== "string") {
        return { applied: false, revision: state.revision };
      }
      transact(() => {
        state.text = spliceText(state.text, [{ start: range.start, end: range.end, text: inserted }]);
      });
      return { applied: true, revision: state.revision, diagnostics: editor.diagnostics };
    },
    replaceRange(range, inserted) {
      if (!range || typeof inserted !== "string") {
        return { applied: false, revision: state.revision };
      }
      const start = clampOffset(state.text, range.start);
      const end = clampOffset(state.text, range.end);
      if (start > end) return { applied: false, revision: state.revision };
      const cursor = start + inserted.length;
      noteCaret({ start, end }, () => {
        state.text = spliceText(state.text, [{ start, end, text: inserted }]);
      });
      state.caret = { start: cursor, end: cursor };
      return { applied: true, revision: state.revision, cursor: state.caret, diagnostics: editor.diagnostics };
    },
    format(caret) {
      const current = caretOf(caret) ?? caretOf(state.caret) ?? { start: 0, end: 0 };
      const start = clampOffset(state.text, current.start);
      const end = clampOffset(state.text, current.end);
      const before = { start: Math.min(start, end), end: Math.max(start, end) };
      const result = formatConfiguration(state.text, before);
      if (!result.changed) {
        return { applied: false, revision: state.revision, reason: result.reason, diagnostics: editor.diagnostics };
      }
      noteCaret(before, () => {
        state.text = result.text;
      });
      state.caret = caretOf(result.caret) ?? { start: state.text.length, end: state.text.length };
      return { applied: true, revision: state.revision, cursor: state.caret, diagnostics: editor.diagnostics };
    },
    suggestions(request = {}) {
      if (request.revision !== undefined && request.revision !== state.revision) {
        return { applied: false, revision: state.revision, items: [] };
      }
      if (Number.isInteger(request.offset)) {
        const end = Number.isInteger(request.selectionEnd) ? request.selectionEnd : request.offset;
        const context = completionContext(state.text, request.offset, end);
        const items = context.kind === "none" ? [] : suggest(contextRequest(context));
        return {
          applied: true,
          revision: state.revision,
          items,
          context,
          anchor: {
            caret: context.caret,
            selectionStart: context.selectionStart,
            selectionEnd: context.selectionEnd,
            slice: context.slice,
            kind: context.kind,
            color: context.color,
            owner: context.owner,
            field: context.field,
            role: context.role,
            range: context.range,
          },
        };
      }
      return { applied: true, revision: state.revision, items: suggest(request) };
    },
    applySuggestion(request = {}) {
      if (request.revision !== undefined && request.revision !== state.revision) {
        return { applied: false, revision: state.revision };
      }
      if (request.anchor && !anchorCurrent(request)) {
        return { applied: false, revision: state.revision, reason: "stale" };
      }
      if (request.kind !== "network" && (request.choice === "new" || request.choice === "create")) {
        return { applied: false, revision: state.revision, reason: "catalog" };
      }
      const range = request.range;
      if (!range || range.start < 0 || range.end > state.text.length || range.start > range.end) {
        return { applied: false, revision: state.revision };
      }
      const selectionStart = request.selectionStart ?? request.anchor?.selectionStart ?? range.start;
      const selectionEnd = request.selectionEnd ?? request.anchor?.selectionEnd ?? range.end;
      const context = completionContext(state.text, selectionStart, selectionEnd);
      let inserted = request.name ?? "";
      let cursor = selectionEnd;
      let reopen = false;
      const previousCaret = state.caret;
      state.caret = { start: selectionStart, end: selectionEnd };
      try {
        transact(() => {
          if (request.kind === "network") inserted = insertNetwork(request);
          const leaf = typeof request.leaf === "boolean" ? request.leaf : inferLeaf(request.kind, inserted);
          const edit = structuralInsertion(state.text, context, { kind: request.kind, name: inserted, leaf });
          if (edit && edit.range.start >= 0 && edit.range.end <= state.text.length && edit.range.start <= edit.range.end) {
            state.text = spliceText(state.text, [{ start: edit.range.start, end: edit.range.end, text: edit.text }]);
            cursor = edit.caret;
            reopen = edit.reopen === true;
          } else {
            state.text = spliceText(state.text, [{ start: range.start, end: range.end, text: inserted }]);
            cursor = range.start + inserted.length;
          }
          bump(memoryKey(request.kind, inserted, request.use));
        });
      } catch (error) {
        state.caret = previousCaret;
        throw error;
      }
      state.caret = { start: cursor, end: cursor };
      return {
        applied: true,
        revision: state.revision,
        text: inserted,
        cursor,
        reopen,
        diagnostics: editor.diagnostics,
      };
    },
    finishNetwork(request = {}) {
      if (request.revision !== undefined && request.revision !== state.revision) {
        return { applied: false, revision: state.revision };
      }
      if (request.anchor && !anchorCurrent(request)) {
        return { applied: false, revision: state.revision, reason: "stale" };
      }
      const range = request.range;
      if (!range || range.start < 0 || range.end > state.text.length || range.start > range.end) {
        return { applied: false, revision: state.revision };
      }
      const typed = request.name ?? state.text.slice(range.start, range.end);
      const choice = networkFinishChoice(request.color, typed, new Set(state.live.keys()));
      const tab = request.tab === true;
      if (!choice && !tab) return { applied: false, revision: state.revision, reason: "ignored" };
      if (!choice) {
        const start = request.selectionStart ?? range.end;
        const end = request.selectionEnd ?? start;
        if (start < 0 || end > state.text.length || start > end) {
          return { applied: false, revision: state.revision };
        }
        const cursor = start + 1;
        noteCaret({ start, end }, () => {
          state.text = spliceText(state.text, [{ start, end, text: "\t" }]);
        });
        state.caret = { start: cursor, end: cursor };
        return {
          applied: true,
          revision: state.revision,
          text: "\t",
          cursor,
          diagnostics: editor.diagnostics,
        };
      }
      const current = state.text.slice(range.start, range.end);
      if (choice.choice === "network" && current === choice.name && !tab) {
        return { applied: false, revision: state.revision, reason: "repeat" };
      }
      let inserted = choice.name;
      const before = {
        start: request.selectionStart ?? range.start,
        end: request.selectionEnd ?? range.end,
      };
      noteCaret(before, () => {
        inserted = insertNetwork({ color: request.color, choice: choice.choice, name: choice.name });
        const text = tab ? `${inserted}\t` : inserted;
        state.text = spliceText(state.text, [{ start: range.start, end: range.end, text }]);
        bump(memoryKey("network", inserted));
      });
      const text = tab ? `${inserted}\t` : inserted;
      const cursor = range.start + text.length;
      state.caret = { start: cursor, end: cursor };
      return {
        applied: true,
        revision: state.revision,
        text,
        cursor,
        diagnostics: editor.diagnostics,
      };
    },
    undo() {
      return travel(state.undo, state.redo);
    },
    redo() {
      return travel(state.redo, state.undo);
    },
    completeParse(revision, payload = {}) {
      if (revision !== state.revision) return { applied: false, revision: state.revision };
      state.cache = payload;
      return { applied: true, revision: state.revision };
    },
    async launch() {
      const revision = state.revision;
      const checked = checkConfiguration(state.text, profile);
      state.cache = null;
      state.diagnostics = checked.diagnostics.map(copyDiagnostic);
      state.statements = checked.statements;
      if (checked.diagnostics.length > 0) {
        dropRun();
        state.model = null;
        state.status = "invalid";
        return { applied: false, revision, diagnostics: editor.diagnostics };
      }
      const previous = snapshotRun();
      install(checked, true);
      if (state.revision !== revision) return { applied: false, stale: true, revision: state.revision };
      try {
        const simulation = await circuit.createSimulation();
        if (state.revision !== revision) return { applied: false, stale: true, revision: state.revision };
        state.simulation = simulation;
        state.runRevision = revision;
        state.staleRun = null;
        state.status = "ready";
        return { applied: true, revision, tick: simulation.tick };
      } catch (error) {
        state.simulation = null;
        state.runRevision = null;
        if (previous) state.staleRun = previous;
        state.status = "invalid";
        if (error instanceof ConfigError) {
          const located = checked.statements.find((item) => item.range && item.range.end > item.range.start)?.range;
          state.diagnostics = [copyDiagnostic({
            code: error.code,
            message: error.message,
            field: null,
            expected: "схема",
            related: [],
            range: located ?? { start: state.text.length, end: state.text.length },
          })];
        }
        return { applied: false, revision: state.revision, diagnostics: editor.diagnostics };
      }
    },
    async step() {
      const revision = state.revision;
      const checked = checkConfiguration(state.text, profile);
      if (state.revision !== revision) return { applied: false, stale: true, revision: state.revision };
      if (checked.diagnostics.length > 0) {
        state.diagnostics = checked.diagnostics.map(copyDiagnostic);
        state.statements = checked.statements;
        state.model = null;
        state.status = "invalid";
        dropRun();
        return { applied: false, revision, diagnostics: editor.diagnostics };
      }
      if (!state.simulation || state.runRevision !== revision) {
        const launched = await editor.launch();
        if (!launched.applied) return launched;
      }
      const simulation = state.simulation;
      await simulation.step();
      if (state.simulation !== simulation || state.revision !== revision) {
        return { applied: false, stale: true, revision: state.revision };
      }
      state.status = "ready";
      return { applied: true, tick: simulation.tick, revision };
    },
    async back() {
      const simulation = state.simulation;
      const revision = state.revision;
      if (!simulation || state.runRevision !== revision) {
        return { applied: false, revision, reason: "no-run" };
      }
      try {
        await simulation.back();
      } catch (error) {
        if (state.simulation !== simulation || state.revision !== revision) {
          return { applied: false, stale: true, revision: state.revision };
        }
        return {
          applied: false,
          revision,
          code: error.code,
          message: error.message,
        };
      }
      if (state.simulation !== simulation || state.revision !== revision) {
        return { applied: false, stale: true, revision: state.revision };
      }
      state.status = "ready";
      return { applied: true, tick: simulation.tick, revision };
    },
    async reset() {
      const revision = state.revision;
      if (!state.simulation || state.runRevision !== revision) {
        return editor.launch();
      }
      const simulation = state.simulation;
      await simulation.reset();
      if (state.simulation !== simulation || state.revision !== revision) {
        return { applied: false, stale: true, revision: state.revision };
      }
      state.staleRun = null;
      state.status = "ready";
      return { applied: true, tick: simulation.tick, revision };
    },
    resetRun() {
      dropRun();
      state.status = state.diagnostics.length > 0 ? "invalid" : "editing";
      return { revision: state.revision, publication: null };
    },
    clearRun() {
      state.simulation = null;
      state.runRevision = null;
      state.staleRun = null;
      state.status = state.diagnostics.length > 0 ? "invalid" : "editing";
      return { revision: state.revision, publication: null };
    },
    publication() {
      if (!state.simulation) return null;
      return {
        current: true,
        tick: state.simulation.tick,
        history: state.simulation.historyTicks().length,
        networks: circuit.networks.map((network) => ({
          id: network.id,
          name: network.name,
          color: network.color,
          signals: state.simulation.present(network).map((entry) => ({
            name: entry.signal.name,
            constant: entry.constant,
          })),
        })),
      };
    },
    view() {
      const publication = editor.publication();
      return {
        revision: state.revision,
        text: state.text,
        status: state.status,
        canLaunch: editor.canLaunch,
        diagnostics: editor.diagnostics,
        index: editor.index(),
        model: state.model,
        publication,
        retained: state.retained,
        staleRun: state.staleRun,
        canStepBack: Boolean(publication && publication.history >= 2),
        current: publication !== null,
      };
    },
  };

  const state = {
    revision: 1,
    text,
    diagnostics: [],
    statements: [],
    model: null,
    live: new Map(),
    mru: new Map(),
    clock: 0,
    undo: [],
    redo: [],
    simulation: null,
    runRevision: null,
    staleRun: null,
    status: "editing",
    cache: null,
    retained: null,
    seenUses: new Set(),
    identities: [],
    boundText: null,
    caret: null,
  };

  function snapshotRun() {
    const current = editor.publication();
    if (!current) return null;
    return {
      revision: state.runRevision,
      tick: current.tick,
      networks: current.networks.map((network) => ({
        id: network.id,
        name: network.name,
        color: network.color,
        signals: network.signals.map((signal) => ({ name: signal.name, constant: signal.constant })),
      })),
    };
  }

  function dropRun() {
    const snapshot = snapshotRun();
    if (snapshot) state.staleRun = snapshot;
    state.simulation = null;
    state.runRevision = null;
  }

  function bump(key) {
    if (!key) return;
    state.clock += 1;
    state.mru.set(key, state.clock);
  }

  function transact(change) {
    const snapshot = snapshotOf();
    const run = snapshotRun();
    change();
    commit(true);
    state.undo.push(snapshot);
    if (state.undo.length > 100) state.undo.shift();
    state.redo = [];
    state.revision += 1;
    if (run) state.staleRun = run;
    state.simulation = null;
    state.runRevision = null;
    if (state.status === "ready") state.status = state.diagnostics.length > 0 ? "invalid" : "editing";
  }

  function travel(source, target) {
    if (source.length === 0) return { applied: false, revision: state.revision };
    const current = snapshotOf();
    const run = snapshotRun();
    const snapshot = source.pop();
    const abandoned = state.identities.filter((item) => !snapshot.identities.some((kept) => kept.id === item.id));
    target.push(current);
    restore(snapshot);
    for (const item of abandoned) {
      if (!deviceById(item.id)) circuit.releaseDeviceId(item.id);
    }
    state.revision += 1;
    if (run) state.staleRun = run;
    state.simulation = null;
    state.runRevision = null;
    commit(false);
    return { applied: true, revision: state.revision, cursor: state.caret };
  };

  function snapshotOf() {
    return {
      text: state.text,
      networks: [...state.live].map(([name, network]) => ({
        name,
        network,
        mru: state.mru.get(`network:${name}`) ?? 0,
      })),
      mru: new Map(state.mru),
      seenUses: new Set(state.seenUses),
      boundText: state.boundText,
      identities: state.identities.map((item) => ({
        id: item.id,
        kind: item.kind,
        name: item.name,
        range: { ...item.range },
      })),
      caret: caretOf(state.caret),
    };
  }

  function restore(snapshot) {
    state.text = snapshot.text;
    for (const network of [...circuit.networks]) circuit.detachNetwork(network);
    state.live = new Map();
    for (const item of snapshot.networks) {
      circuit.restoreNetwork(item.network, item.name);
      state.live.set(item.name, item.network);
      state.mru.set(`network:${item.name}`, item.mru);
    }
    state.mru = new Map(snapshot.mru);
    state.seenUses = new Set(snapshot.seenUses);
    state.boundText = snapshot.boundText;
    state.identities = snapshot.identities.map((item) => ({
      id: item.id,
      kind: item.kind,
      name: item.name,
      range: { ...item.range },
    }));
    state.caret = caretOf(snapshot.caret);
  }

  function commit(bumpUses) {
    let checked = checkConfiguration(state.text, profile);
    if (checked.diagnostics.length === 0) {
      const unused = checked.wires.filter((wire) => !checked.referenced.has(wire.name));
      if (unused.length > 0) {
        state.text = spliceText(state.text, unused.map((wire) => ({
          start: wire.range.start,
          end: wire.range.end,
          text: "",
        })));
        checked = checkConfiguration(state.text, profile);
      }
    }
    state.diagnostics = checked.diagnostics.map(copyDiagnostic);
    state.statements = checked.statements;
    const structural = checked.diagnostics.some((item) => item.code === "syntax" || item.code === "forbidden-effect");
    if (structural) {
      state.model = null;
      state.status = "invalid";
      return;
    }
    bindIdentities(checked.statements);
    if (checked.diagnostics.length > 0) {
      state.model = null;
      state.status = "invalid";
      return;
    }
    install(checked, bumpUses);
    state.status = "editing";
  }

  function bindIdentities(statements) {
    const devices = statements.filter((item) => item.type === "device");
    const matched = matchIdentities(state.boundText, state.text, state.identities, devices);
    state.identities = devices.map((statement, index) => {
      const previous = matched[index];
      const id = previous?.id ?? circuit.reserveDeviceId();
      statement.identity = id;
      return {
        id,
        kind: statement.kind,
        name: statement.name ?? null,
        range: { ...statement.range },
      };
    });
    state.boundText = state.text;
  }

  function deviceById(id) {
    return circuit.devices.find((device) => circuit.deviceId(device) === id) ?? null;
  }

  function install(checked, bumpUses) {
    ensureNetworks(checked.referenced);
    const built = buildPrepared(checked.prepared, checked.peers, state.live, checked.groups);
    const keep = new Set(state.identities.map((item) => item.id));
    const fresh = [];
    built.devices.forEach((item, index) => {
      const id = state.identities[index].id;
      const live = deviceById(id);
      if (live) circuit.replaceDevice(live, item.device);
      else circuit.add(item.device, id);
      fresh.push(item.device);
    });
    for (const device of [...circuit.devices]) {
      if (!keep.has(circuit.deviceId(device))) circuit.remove(device);
    }
    if (fresh.length > 0) circuit.orderDevices(fresh);
    for (const link of built.links) circuit.setPeers(link.event, { receiver: link.receiver });
    stampStatements(state.statements);
    state.model = checked.model ? {
      ...checked.model,
      devices: checked.model.devices.map((item, index) => ({
        ...item,
        id: state.identities[index].id,
      })),
    } : null;
    state.retained = {
      revision: state.revision,
      networks: [...state.live].map(([name, network]) => ({ name, id: network.id, color: network.color })),
    };
    if (bumpUses) {
      for (const use of checked.uses) {
        if (!state.seenUses.has(use)) bump(use);
      }
    }
    state.seenUses = new Set(checked.uses);
  }

  function ensureNetworks(names) {
    for (const name of names) {
      const existing = state.live.get(name);
      if (!existing) {
        const network = circuit.network(name);
        state.live.set(name, network);
      } else if (existing.circuit !== circuit) {
        circuit.restoreNetwork(existing, name);
      }
    }
    for (const [name, network] of [...state.live]) {
      if (names.has(name)) continue;
      if (network.circuit === circuit) circuit.detachNetwork(network);
      state.live.delete(name);
    }
  }

  function insertNetwork(request) {
    const color = request.color;
    if (color !== "red" && color !== "green") {
      throw new ConfigError("wrong-color", "Подсказки сети относятся к красному или зелёному порту");
    }
    if (request.choice === "null") return "null";
    if (request.choice === "new") {
      const name = nextNetworkName(color, [...state.live.keys()]);
      const network = circuit.network(name);
      state.live.set(name, network);
      return name;
    }
    if (request.choice === "create") {
      const parsed = parseNetworkName(request.name);
      if (!parsed || parsed.color !== color) {
        throw new ConfigError(parsed ? "wrong-color" : "invalid-name", "Нельзя создать это имя для порта");
      }
      if (state.live.has(request.name)) throw new ConfigError("occupied-name", `Имя ${request.name} занято`);
      const network = circuit.network(request.name);
      state.live.set(request.name, network);
      return request.name;
    }
    if (request.choice === "network") {
      if (!state.live.has(request.name)) throw new ConfigError("missing-network", "Сеть не создана");
      const network = state.live.get(request.name);
      if (network.color !== color) throw new ConfigError("wrong-color", "Цвет сети не соответствует порту");
      return request.name;
    }
    throw new ConfigError("invalid-choice", "Неизвестное действие подсказки");
  }

  function anchorCurrent(request) {
    const anchor = request.anchor;
    const range = request.range;
    if (!anchor || !range) return false;
    if (range.start !== anchor.range?.start || range.end !== anchor.range?.end) return false;
    if (state.text.slice(range.start, range.end) !== anchor.slice) return false;
    if (request.selectionStart !== undefined && request.selectionStart !== anchor.selectionStart) return false;
    if (request.selectionEnd !== undefined && request.selectionEnd !== anchor.selectionEnd) return false;
    const now = completionContext(state.text, anchor.selectionStart, anchor.selectionEnd);
    return now.kind === anchor.kind
      && now.color === anchor.color
      && now.owner === anchor.owner
      && now.field === anchor.field
      && now.role === anchor.role;
  }

  function suggest(request) {
    const query = request.query ?? "";
    if (request.kind === "type") {
      const pool = request.mode === "new" ? NEW_TYPES : CALL_TYPES;
      return pool
        .filter((item) => item.name.startsWith(query))
        .map((item) => ({
          kind: "type",
          name: item.name,
          label: item.label,
          mru: state.mru.get(`type:${item.name}`) ?? 0,
        }))
        .sort(byUse);
    }
    if (request.kind === "key") {
      return (request.keys ?? [])
        .filter((name) => name.startsWith(query))
        .map((name, index) => ({
          kind: "key",
          name,
          label: "поле",
          mru: state.mru.get(`key:${name}`) ?? 0,
          order: index,
        }))
        .sort((left, right) => (right.mru - left.mru) || (left.order - right.order))
        .map(({ kind, name, label, mru }) => ({ kind, name, label, mru }));
    }
    if (request.kind === "boolean") {
      return ["true", "false"]
        .filter((name) => name.startsWith(query))
        .map((name) => ({
          kind: "boolean",
          name,
          label: "логическое",
          mru: state.mru.get(`boolean:${name}`) ?? 0,
        }))
        .sort(byUse);
    }
    if (request.kind === "literal") {
      return (request.options ?? [])
        .filter((name) => literalMatches(name, query))
        .map((name) => ({ kind: "literal", name, label: "значение", mru: 0 }));
    }
    if (request.kind === "network") {
      const entries = [...state.live].map(([name, network]) => ({
        name,
        color: network.color,
        mru: state.mru.get(`network:${name}`) ?? 0,
      }));
      return suggestionItems({ color: request.color, query, entries }).map((item) => ({
        ...item,
        kind: item.kind,
      }));
    }
    if (request.kind === "signal" || request.kind === "source") {
      const signals = catalogItems(
        listSignalPaths(openProfile(profile))
          .filter((entry) => signalAllowed(entry, request.role ?? "channel", request.context ?? {})),
        query,
        "signal",
        (entry, dotted) => (dotted ? (entry.meta ?? "") : (entry.meta ?? "сигнал")),
        (entry) => state.mru.get(`signal:${entry.path}`) ?? 0,
      );
      const qualities = request.kind === "source"
        ? catalogItems(
          qualityCatalog(openProfile(profile)),
          query,
          "quality",
          () => "качество",
          (entry) => state.mru.get(`quality:${entry.name}`) ?? 0,
        )
        : [];
      const items = [...signals, ...qualities];
      if (request.nullable && (query === "" || "null".startsWith(query))) {
        items.push({ kind: "literal", name: "null", label: "не задан", mru: 0 });
      }
      return items.sort(byUse);
    }
    if (request.kind === "operation") {
      const entries = operationCatalog()
        .filter((entry) => (request.owner ? entry.owner === request.owner : true))
        .filter((entry) => (request.group ? entry.group === request.group : true))
        .filter((entry) => entry.path.startsWith(query));
      const dotted = query.includes(".");
      const children = dotted
        ? pathChildren(entries.map((entry) => entry.path), query)
        : entries.map((entry) => ({ name: entry.path, label: entry.name, leaf: true }));
      return children
        .map((child) => {
          const entry = entries.find((item) => item.path === child.name);
          return {
            kind: "operation",
            name: child.name,
            value: child.name,
            caption: child.label,
            label: operationSign(entry),
            leaf: child.leaf !== false,
            mru: state.mru.get(`operation:${child.name}`) ?? 0,
          };
        })
        .sort(byUse);
    }
    if (request.kind === "quality") {
      return catalogItems(
        qualityCatalog(openProfile(profile)),
        query,
        "quality",
        () => "качество",
        (entry) => state.mru.get(`quality:${entry.name}`) ?? 0,
      ).sort(byUse);
    }
    if (request.kind === "group") {
      return state.statements
        .filter((item) => item.type === "group" && item.name?.startsWith(query))
        .map((item) => ({
          kind: "group",
          name: item.name,
          label: "группа",
          mru: state.mru.get(`device:${item.name}`) ?? 0,
        }))
        .sort(byUse);
    }
    const devices = state.statements.filter((item) => item.type === "device");
    const pool = request.kind === "peer" ? devices.filter((item) => item.kind === "event") : devices;
    return pool
      .filter((item) => item.name && item.name.startsWith(query))
      .map((item) => ({
        kind: request.kind,
        name: item.name,
        label: item.kind,
        mru: state.mru.get(`device:${item.name}`) ?? 0,
      }))
      .sort(byUse);
  }

  function noteCaret(before, change) {
    const previous = state.caret;
    state.caret = before;
    try {
      transact(change);
    } catch (error) {
      state.caret = previous;
      throw error;
    }
  }

  function inferLeaf(kind, name) {
    if (typeof name !== "string" || name === "") return true;
    if (kind === "operation") return !hasChildPath(operationCatalog().map((item) => item.path), name);
    const opened = openProfile(profile);
    if (kind === "quality") return !hasChildPath(qualityCatalog(opened).map((item) => item.path), name);
    if (kind === "signal" || kind === "source") {
      const paths = listSignalPaths(opened).map((item) => item.path);
      if (kind === "source") paths.push(...qualityCatalog(opened).map((item) => item.path));
      return !hasChildPath(paths, name);
    }
    return true;
  }

  function byUse(left, right) {
    return (right.mru - left.mru) || compareCatalog(left.name, right.name);
  }

  function stampStatements(statements) {
    const devices = statements.filter((item) => item.type === "device");
    if (devices.length !== state.identities.length) return;
    devices.forEach((statement, index) => {
      statement.identity = state.identities[index].id;
    });
  }

  commit(true);
  return editor;
}

/** Знак вторичной подписи. У режимов Selector.Operation и Selector.Sort знака нет. */
const OPERATION_SIGNS = new Map([
  ["SUM", "+"],
  ["SUB", "-"],
  ["MUL", "*"],
  ["DIV", "/"],
  ["MOD", "%"],
  ["POW", "^"],
  ["SHL", "<<"],
  ["SHR", ">>"],
  ["AND", "AND"],
  ["OR", "OR"],
  ["XOR", "XOR"],
  ["GT", ">"],
  ["LT", "<"],
  ["EQ", "="],
  ["GTE", ">="],
  ["LTE", "<="],
  ["NEQ", "!="],
]);

function operationSign(entry) {
  if (!entry) return "";
  if (entry.owner === "Selector" && entry.group !== "Compare") return "";
  return OPERATION_SIGNS.get(entry.name) ?? "";
}

function catalogItems(entries, query, kind, detailFor, mruFor) {
  const dotted = query.includes(".");
  const pool = entries.filter((entry) => entry.path.startsWith(query));
  const children = dotted
    ? pathChildren(pool.map((entry) => entry.path), query)
    : pool.map((entry) => ({ name: entry.path, label: "", leaf: true }));
  return children.map((child) => {
    const entry = pool.find((item) => item.path === child.name);
    const item = {
      kind,
      name: child.name,
      value: child.name,
      label: entry ? detailFor(entry, dotted) : "",
      leaf: child.leaf !== false,
      mru: entry ? mruFor(entry) : 0,
    };
    if (dotted) item.caption = child.label;
    return item;
  });
}

const CALL_TYPES = [
  ["Arithmetic", "комбинатор"],
  ["Constant", "комбинатор"],
  ["Decider", "комбинатор"],
  ["Selector", "комбинатор"],
].map(([name, label]) => ({ name, label }));

const NEW_TYPES = [
  ...CALL_TYPES,
  { name: "EventCombinator", label: "сценарий" },
  { name: "Lamp", label: "лампа" },
  { name: "Storage", label: "хранилище" },
  { name: "Station", label: "станция" },
  { name: "Train", label: "поезд" },
  { name: "Constant.Group", label: "группа" },
];

function contextRequest(context) {
  return {
    kind: context.kind,
    query: context.query,
    mode: context.mode,
    keys: context.keys ?? undefined,
    color: context.color ?? undefined,
    owner: context.owner ?? undefined,
    group: context.group ?? undefined,
    role: context.role ?? undefined,
    context: context.signalContext ?? undefined,
    options: context.options ?? undefined,
    nullable: context.nullable,
  };
}

function caretOf(caret) {
  if (!caret || !Number.isInteger(caret.start) || !Number.isInteger(caret.end)) return null;
  return { start: caret.start, end: caret.end };
}

function clampOffset(text, offset) {
  if (!Number.isInteger(offset)) return 0;
  return Math.min(text.length, Math.max(0, offset));
}

function hasChildPath(paths, name) {
  const prefix = `${name}.`;
  return paths.some((path) => path.startsWith(prefix));
}

function memoryKey(kind, name, use) {
  if (use) return use;
  if (kind === "network") return `network:${name}`;
  if (kind === "signal") return `signal:${name}`;
  if (kind === "operation") return `operation:${name}`;
  if (kind === "quality") return `quality:${name.startsWith("Quality.") ? name.slice("Quality.".length) : name}`;
  if (kind === "type") return `type:${name}`;
  if (kind === "key") return `key:${name}`;
  if (kind === "boolean") return `boolean:${name}`;
  if (kind === "peer" || kind === "group" || kind === "device") return `device:${name}`;
  return name;
}

function literalMatches(option, query) {
  const bare = option.replaceAll("\"", "");
  return option.startsWith(query) || bare.startsWith(query);
}

function editSpan(before, after) {
  let prefix = 0;
  const limit = Math.min(before.length, after.length);
  while (prefix < limit && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < before.length - prefix
    && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) suffix += 1;
  return { prefix, suffix, oldLength: before.length, delta: after.length - before.length };
}

function translateRange(range, span) {
  const editEnd = span.oldLength - span.suffix;
  if (range.end <= span.prefix) return { start: range.start, end: range.end };
  if (range.start >= editEnd) return { start: range.start + span.delta, end: range.end + span.delta };
  const start = range.start < span.prefix ? range.start : span.prefix;
  const end = range.end + span.delta;
  return { start, end: Math.max(start, end) };
}

function overlapLength(left, right) {
  return Math.max(0, Math.min(left.end, right.end) - Math.max(left.start, right.start));
}

function matchIdentities(previousText, nextText, previous, devices) {
  const matched = new Array(devices.length).fill(null);
  if (previousText == null) return matched;
  const span = editSpan(previousText, nextText);
  const translated = previous.map((item) => ({ ...item, range: translateRange(item.range, span) }));
  const used = new Set();
  devices.forEach((statement, index) => {
    if (!statement.name) return;
    const found = translated.findIndex((item, itemIndex) => (
      !used.has(itemIndex) && item.name === statement.name && item.kind === statement.kind
    ));
    if (found < 0) return;
    used.add(found);
    matched[index] = translated[found];
  });
  const candidates = [];
  devices.forEach((statement, index) => {
    if (matched[index]) return;
    translated.forEach((item, itemIndex) => {
      if (used.has(itemIndex) || item.kind !== statement.kind) return;
      const overlap = overlapLength(item.range, statement.range);
      if (overlap > 0) candidates.push({ index, itemIndex, overlap });
    });
  });
  candidates.sort((left, right) => right.overlap - left.overlap || left.index - right.index || left.itemIndex - right.itemIndex);
  for (const candidate of candidates) {
    if (matched[candidate.index] || used.has(candidate.itemIndex)) continue;
    used.add(candidate.itemIndex);
    matched[candidate.index] = translated[candidate.itemIndex];
  }
  return matched;
}
