/** Прогон тиков: current/next, вклады устройств и одна публикация границы. */

import { readSelectorMemory, readSnapshot } from "./checkpoint.js";
import { ConfigError, RuntimeError } from "./errors.js";
import { readLampState } from "./lamp.js";
import { advanceTrains } from "./train.js";
import { cloneRuntimeJson } from "./json-value.js";
import { initialRng } from "./rng.js";
import { readSignalCount } from "./signal-count.js";
import { serializeCounts } from "./signal-codec.js";
import {
  addToTable,
  combineMasked,
  createTable,
  presentTable,
  readTable,
} from "./signal-table.js";

const REVISION = 1;
export const DEFAULT_HISTORY_LIMIT = 32;
const RESPONSE_KEYS = ["devices", "phase", "revision", "runId", "stepId", "tick"];
const PATCH_KEYS = new Set(["cancelWake", "clear", "held", "id", "pulses", "rng", "send", "state", "wake"]);
const PULSE_KEYS = ["duration", "green", "red", "signals"];
const MESSAGE_KEYS = ["data", "to", "type"];

function directPrepare(request) {
  return {
    runId: request.runId,
    revision: request.revision,
    stepId: request.stepId,
    phase: request.phase,
    tick: request.tick,
    devices: [],
  };
}

function emptyRuntime(state, rng = null) {
  return {
    output: { red: createTable(), green: createTable() },
    held: { red: createTable(), green: createTable() },
    pulses: [],
    state,
    rng,
    seenInputs: null,
    wakes: new Set(),
    messages: [],
  };
}

function cloneTable(table) {
  const copy = createTable();
  for (const [key, entry] of table) copy.set(key, { token: entry.token, value: entry.value });
  return copy;
}

function tableFromCounts(counts, profile) {
  const table = createTable();
  for (const entry of counts) {
    const count = readSignalCount(entry, profile);
    addToTable(table, count.signal, count.constant);
  }
  return table;
}

function tableFromStored(entries) {
  const table = createTable();
  for (const entry of entries) addToTable(table, entry.signal, entry.constant);
  return table;
}

function cloneMessage(message) {
  return {
    from: message.from,
    to: message.to,
    sentTick: message.sentTick,
    deliveryTick: message.deliveryTick,
    sequence: message.sequence,
    type: message.type,
    data: cloneRuntimeJson(message.data),
  };
}

function cloneRuntime(runtime) {
  return {
    output: {
      red: cloneTable(runtime.output.red),
      green: cloneTable(runtime.output.green),
    },
    held: {
      red: cloneTable(runtime.held.red),
      green: cloneTable(runtime.held.green),
    },
    pulses: runtime.pulses.map((pulse) => ({
      color: pulse.color,
      start: pulse.start,
      end: pulse.end,
      signals: cloneTable(pulse.signals),
    })),
    state: runtime.state === null ? null : cloneRuntimeJson(runtime.state),
    rng: runtime.rng,
    seenInputs: runtime.seenInputs,
    wakes: new Set(runtime.wakes),
    messages: runtime.messages.map(cloneMessage),
  };
}

function cloneCheckpoint(checkpoint) {
  const tables = new Map();
  for (const [network, table] of checkpoint.tables) tables.set(network, cloneTable(table));
  const devices = new Map();
  for (const [id, runtime] of checkpoint.devices) devices.set(id, cloneRuntime(runtime));
  return { tick: checkpoint.tick, tables, devices };
}

function compareMessages(left, right) {
  if (left.from === right.from) return left.sequence - right.sequence;
  return left.from < right.from ? -1 : 1;
}

function sortMessages(list) {
  const sorted = [];
  for (const message of list) {
    let index = 0;
    while (index < sorted.length && compareMessages(sorted[index], message) <= 0) index += 1;
    sorted.splice(index, 0, message);
  }
  return sorted;
}

function assertPlain(value, code, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RuntimeError(code, message);
  }
}

function assertExactKeys(value, allowed, code, message) {
  const keys = Object.keys(value);
  if (keys.length !== allowed.length || allowed.some((key) => !Object.hasOwn(value, key))) {
    throw new RuntimeError(code, message);
  }
}

function assertEcho(response, request) {
  assertPlain(response, "invalid-result", "Ответ prepare должен быть объектом");
  assertExactKeys(response, RESPONSE_KEYS, "invalid-result", "Ответ prepare содержит неверный набор полей");
  if (response.runId !== request.runId) {
    throw new RuntimeError("invalid-result", "Ответ prepare относится к другому прогону");
  }
  if (response.revision !== request.revision) {
    throw new RuntimeError("invalid-result", "Ответ prepare относится к другой ревизии");
  }
  if (response.stepId !== request.stepId) {
    throw new RuntimeError("invalid-result", "Ответ prepare относится к другому шагу");
  }
  if (response.phase !== request.phase) {
    throw new RuntimeError("invalid-result", "Ответ prepare относится к другой фазе");
  }
  if (response.tick !== request.tick) {
    throw new RuntimeError("invalid-result", "Ответ prepare относится к другому тику");
  }
  if (!Array.isArray(response.devices)) {
    throw new RuntimeError("invalid-result", "Список устройств ответа должен быть массивом");
  }
}

function resolveWire(runtime, boundary) {
  const red = cloneTable(runtime.held.red);
  const green = cloneTable(runtime.held.green);
  for (const pulse of runtime.pulses) {
    if (pulse.end <= boundary) continue;
    const target = pulse.color === "red" ? red : green;
    for (const entry of pulse.signals.values()) addToTable(target, entry.token, entry.value);
  }
  runtime.output = { red, green };
  runtime.pulses = runtime.pulses.filter((pulse) => pulse.end > boundary);
}

function historyLimitOf(options) {
  if (options === undefined || !Object.hasOwn(options, "historyLimit")) return DEFAULT_HISTORY_LIMIT;
  const value = options.historyLimit;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new ConfigError("invalid-simulation-options", "Предел истории должен быть целым числом от 1");
  }
  return value;
}

function schedulerOf(options) {
  if (options === undefined || !Object.hasOwn(options, "scheduler")) return "full";
  const value = options.scheduler;
  if (value !== "full" && value !== "optimized") {
    throw new ConfigError("invalid-simulation-options", "Планировщик должен быть full или optimized");
  }
  return value;
}

function indexReaders(records) {
  const readers = new Map();
  for (const record of records) {
    if (record.kind !== "computed" && record.kind !== "participant") continue;
    for (const network of [record.ports.red_input, record.ports.green_input]) {
      if (!network) continue;
      let bucket = readers.get(network);
      if (!bucket) {
        bucket = new Set();
        readers.set(network, bucket);
      }
      bucket.add(record);
    }
  }
  return readers;
}

function sameTable(left, right) {
  if (left.size !== right.size) return false;
  for (const [key, entry] of left) {
    const other = right.get(key);
    if (!other || other.value !== entry.value) return false;
  }
  return true;
}

function cloneSnapshot(snapshot) {
  return JSON.parse(JSON.stringify(snapshot));
}

export function assertSimulationOptions(options) {
  if (options === undefined) return null;
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new ConfigError("invalid-simulation-options", "Настройки прогона должны быть объектом");
  }
  for (const key of Object.keys(options)) {
    if (key !== "executor" && key !== "historyLimit" && key !== "scheduler") {
      throw new ConfigError("invalid-simulation-options", `Неизвестный параметр ${key}`);
    }
  }
  historyLimitOf(options);
  schedulerOf(options);
  if (!Object.hasOwn(options, "executor")) return null;
  const executor = options.executor;
  if (!executor || typeof executor !== "object" || Array.isArray(executor) || typeof executor.prepare !== "function") {
    throw new ConfigError("invalid-executor", "Исполнитель должен иметь функцию prepare");
  }
  return executor;
}

class Simulation {
  #executor;
  #profile;
  #seed;
  #world;
  #gameVersion;
  #records;
  #byDevice;
  #byId;
  #networks;
  #isNetwork;
  #runId = 1;
  #requestSeq = 0;
  #inflight = null;
  #preparing = null;
  #published;
  #origin;
  #historyLimit;
  #history = [];
  #replaceHistory = false;
  #scheduler;
  #readers;
  #queue;

  constructor(snapshot, options) {
    const executor = assertSimulationOptions(options);
    this.#historyLimit = historyLimitOf(options);
    this.#scheduler = schedulerOf(options);
    this.#readers = indexReaders(snapshot.records);
    this.#queue = new Set();
    this.#executor = executor ?? { prepare: directPrepare };
    this.#profile = snapshot.profile;
    this.#seed = snapshot.seed;
    this.#world = snapshot.world ?? null;
    this.#gameVersion = snapshot.gameVersion;
    this.#records = snapshot.records;
    this.#byDevice = new Map(snapshot.records.map((record) => [record.device, record]));
    this.#byId = new Map(snapshot.records.map((record) => [record.id, record]));
    this.#networks = snapshot.networks;
    this.#isNetwork = snapshot.isNetwork;
    this.#published = this.#emptyCheckpoint();
  }

  static async start(snapshot, options) {
    const simulation = new Simulation(snapshot, options);
    await simulation.#init();
    return simulation;
  }

  get seed() {
    return this.#seed;
  }

  get profile() {
    return this.#profile;
  }

  get gameVersion() {
    return this.#gameVersion;
  }

  get tick() {
    return this.#published.tick;
  }

  get historyLimit() {
    return this.#historyLimit;
  }

  historyTicks() {
    return this.#history.map((snapshot) => snapshot.tick);
  }

  historySnapshot(tick) {
    const found = this.#history.find((snapshot) => snapshot.tick === tick);
    return found ? cloneSnapshot(found) : null;
  }

  async back() {
    this.#assertIdle();
    if (this.#history.length < 2) {
      throw new RuntimeError("history-exhausted", "Сохранённых более ранних границ нет");
    }
    await this.recall(this.#history[this.#history.length - 2].tick);
  }

  async recall(tick) {
    this.#assertIdle();
    if (typeof tick !== "number" || !Number.isSafeInteger(tick) || tick < 0) {
      throw new RuntimeError("history-missing", "В истории нет такой границы");
    }
    const index = this.#history.findIndex((snapshot) => snapshot.tick === tick);
    if (index < 0) throw new RuntimeError("history-missing", "В истории нет такой границы");
    if (index === this.#history.length - 1) return;
    await this.restore(cloneSnapshot(this.#history[index]));
  }

  get runId() {
    return this.#runId;
  }

  get revision() {
    return REVISION;
  }

  read(network, token) {
    return readTable(this.#tableOf(network), token);
  }

  present(network) {
    return presentTable(this.#tableOf(network));
  }

  readMask(selection, mask, token) {
    return readTable(this.#selectionTable(selection, mask), token);
  }

  presentMask(selection, mask) {
    return presentTable(this.#selectionTable(selection, mask));
  }

  device(device) {
    const record = this.#byDevice.get(device);
    if (!record) {
      throw new ConfigError("not-in-simulation", "Устройство не входит в этот прогон");
    }
    const runtime = this.#published.devices.get(record.id);
    return {
      output: {
        red: presentTable(runtime.output.red),
        green: presentTable(runtime.output.green),
      },
      held: {
        red: presentTable(runtime.held.red),
        green: presentTable(runtime.held.green),
      },
      pulses: runtime.pulses.map((pulse) => ({
        color: pulse.color,
        start: pulse.start,
        end: pulse.end,
        signals: presentTable(pulse.signals),
      })),
      state: runtime.state === null ? null : cloneRuntimeJson(runtime.state),
      rng: runtime.rng,
      seenInputs: runtime.seenInputs,
      wakes: [...runtime.wakes].sort((left, right) => left - right),
      messages: runtime.messages.map(cloneMessage),
    };
  }

  async step() {
    if (this.#inflight !== null) {
      throw new RuntimeError("step-busy", "Шаг уже выполняется");
    }
    const runId = this.#runId;
    const stepId = ++this.#requestSeq;
    const request = this.#request("step", runId, stepId);
    this.#inflight = stepId;
    try {
      let response;
      try {
        response = await this.#executor.prepare(request);
      } catch (error) {
        if (this.#runId !== runId) throw new RuntimeError("step-cancelled", "Шаг отменён сбросом");
        throw error;
      }
      if (this.#runId !== runId) throw new RuntimeError("step-cancelled", "Шаг отменён сбросом");
      this.#commit(request, response, "step");
    } finally {
      if (this.#inflight === stepId) this.#inflight = null;
    }
  }

  async reset() {
    this.#runId += 1;
    this.#inflight = null;
    if (this.#executor.replayInit !== true) {
      this.#published = cloneCheckpoint(this.#origin);
      if (this.#scheduler === "optimized") this.#queue = this.#computedIds();
      this.#replaceHistory = true;
      this.#recordCommit();
      return;
    }
    this.#inflight = "reset";
    this.#preparing = this.#emptyCheckpoint();
    this.#replaceHistory = true;
    try {
      await this.#init();
    } catch (error) {
      this.#replaceHistory = false;
      throw error;
    } finally {
      this.#preparing = null;
      if (this.#inflight === "reset") this.#inflight = null;
    }
  }

  capture() {
    const counts = (table) => serializeCounts(presentTable(table));
    return {
      profile: this.#profile,
      gameVersion: this.#gameVersion,
      tick: this.#published.tick,
      networks: this.#networks.map((network) => ({
        id: network.id,
        signals: counts(this.#published.tables.get(network)),
      })),
      devices: this.#records.map((record) => {
        const runtime = this.#published.devices.get(record.id);
        return {
          id: record.id,
          state: runtime.state === null ? null : cloneRuntimeJson(runtime.state),
          rng: runtime.rng,
          seenInputs: runtime.seenInputs,
          wakes: [...runtime.wakes].sort((left, right) => left - right),
          messages: runtime.messages.map(cloneMessage),
          output: { red: counts(runtime.output.red), green: counts(runtime.output.green) },
          held: { red: counts(runtime.held.red), green: counts(runtime.held.green) },
          pulses: runtime.pulses.map((pulse) => ({
            color: pulse.color,
            start: pulse.start,
            end: pulse.end,
            signals: counts(pulse.signals),
          })),
        };
      }),
    };
  }

  async restore(snapshot) {
    this.#assertIdle();
    const plain = readSnapshot(snapshot, this.#snapshotExpected());
    this.#installSnapshot(plain);
    if (this.#scheduler === "optimized") this.#queue = this.#computedIds();
    const stored = this.capture();
    const index = this.#history.findIndex((item) => item.tick === stored.tick);
    if (index >= 0) this.#history.splice(index, this.#history.length - index, stored);
    else this.#history = [stored];
    this.#trimHistory();
  }

  async #init() {
    const stepId = ++this.#requestSeq;
    const request = this.#request("init", this.#runId, stepId);
    const response = await this.#executor.prepare(request);
    this.#commit(request, response, "init");
  }

  #emptyCheckpoint() {
    const tables = new Map();
    for (const network of this.#networks) tables.set(network, createTable());
    const devices = new Map();
    for (const record of this.#records) {
      const state = this.#freshState(record);
      const rng = record.event === true ? initialRng(this.#seed, record.id) : null;
      devices.set(record.id, emptyRuntime(state, rng));
    }
    return { tick: 0, tables, devices };
  }

  #source() {
    return this.#preparing ?? this.#published;
  }

  #installSnapshot(plain) {
    const networkById = new Map(this.#networks.map((network) => [network.id, network]));
    const tables = new Map();
    for (const entry of plain.networks) tables.set(networkById.get(entry.id), this.#countTable(entry.signals));
    const devices = new Map();
    for (const entry of plain.devices) {
      const runtime = emptyRuntime(entry.state, entry.rng);
      runtime.seenInputs = entry.seenInputs;
      runtime.wakes = new Set(entry.wakes);
      runtime.messages = entry.messages.map(cloneMessage);
      runtime.output = {
        red: this.#countTable(entry.output.red),
        green: this.#countTable(entry.output.green),
      };
      runtime.held = {
        red: this.#countTable(entry.held.red),
        green: this.#countTable(entry.held.green),
      };
      runtime.pulses = entry.pulses.map((pulse) => ({
        color: pulse.color,
        start: pulse.start,
        end: pulse.end,
        signals: this.#countTable(pulse.signals),
      }));
      devices.set(entry.id, runtime);
    }
    this.#published = { tick: plain.tick, tables, devices };
  }

  #request(phase, runId, stepId) {
    const tick = this.#source().tick;
    return {
      runId,
      revision: REVISION,
      stepId,
      phase,
      tick,
      nextTick: phase === "init" ? 0 : tick + 1,
      devices: this.#records
        .filter((record) => record.kind === "participant")
        .map((record) => this.#participantView(record, phase)),
    };
  }

  #participantView(record, phase) {
    const runtime = this.#source().devices.get(record.id);
    const view = {
      id: record.id,
      state: cloneRuntimeJson(runtime.state),
      messages: runtime.messages.map(cloneMessage),
      wakes: [...runtime.wakes].sort((left, right) => left - right),
      held: {
        red: presentTable(runtime.held.red),
        green: presentTable(runtime.held.green),
      },
      pulses: runtime.pulses.map((pulse) => ({
        color: pulse.color,
        start: pulse.start,
        end: pulse.end,
        signals: presentTable(pulse.signals),
      })),
      rng: runtime.rng,
      run: record.run ?? null,
      receiverId: record.receiverId ?? null,
    };
    if (phase === "step") {
      view.inputs = {
        red: this.#presentPort(record.ports.red_input),
        green: this.#presentPort(record.ports.green_input),
      };
      const signature = this.#inputSignature(record);
      view.inputChanged = runtime.seenInputs === null || runtime.seenInputs !== signature;
    }
    return view;
  }

  #presentPort(network) {
    if (!network) return [];
    return presentTable(this.#source().tables.get(network));
  }

  #wireSignature(record, tables) {
    const encode = (network) => {
      if (!network) return "";
      return presentTable(tables.get(network))
        .map((entry) => `${entry.signal.type}/${entry.signal.name}/${entry.signal.quality}=${entry.constant}`)
        .join(",");
    };
    return JSON.stringify([
      encode(record.ports.red_input),
      encode(record.ports.green_input),
    ]);
  }

  #inputSignature(record) {
    return this.#wireSignature(record, this.#source().tables);
  }

  #commit(request, response, phase) {
    assertEcho(response, request);
    const previousTables = this.#source().tables;
    const seen = phase === "step"
      ? new Map(this.#records.map((record) => [record.id, this.#inputSignature(record)]))
      : null;
    const patches = indexPatches(response.devices, this.#byId);
    const boundary = phase === "init" ? 0 : request.tick + 1;
    const devices = new Map();
    const sends = new Map();
    for (const record of this.#records) {
      const patch = patches.get(record.id);
      if (record.kind === "constant") {
        devices.set(record.id, this.#publishConstant(record));
      } else if (record.kind === "computed") {
        devices.set(record.id, this.#computedRuntime(record, phase));
      } else if (record.kind === "observer") {
        devices.set(record.id, emptyRuntime(this.#freshState(record)));
      } else if (record.kind === "participant") {
        const published = this.#publishParticipant(record, patch, phase, request.tick, boundary);
        devices.set(record.id, published.runtime);
        sends.set(record.id, published.sends);
      } else if (record.kind === "station" || record.kind === "train") {
        devices.set(record.id, emptyRuntime(this.#freshState(record)));
      } else {
        devices.set(record.id, emptyRuntime(null));
      }
    }
    if (phase === "step") {
      const delivered = this.#deliver(response.devices.map((patch) => patch.id), sends, request.tick);
      for (const record of this.#records) {
        if (record.kind !== "participant") continue;
        const runtime = devices.get(record.id);
        runtime.messages = delivered.get(record.id);
        runtime.wakes.delete(request.tick);
      }
    }
    this.#publishTrains(devices, phase);
    const tables = new Map();
    for (const network of this.#networks) tables.set(network, createTable());
    for (const record of this.#records) {
      const runtime = devices.get(record.id);
      this.#writePort(tables, record.ports.red_output, runtime.output.red);
      this.#writePort(tables, record.ports.green_output, runtime.output.green);
    }
    if (phase === "step" && this.#runId !== request.runId) {
      throw new RuntimeError("step-cancelled", "Шаг отменён сбросом");
    }
    if (seen) {
      for (const [id, signature] of seen) devices.get(id).seenInputs = signature;
    }
    this.#finishObservers(devices, tables, previousTables, phase);
    const checkpoint = { tick: boundary, tables, devices };
    this.#published = checkpoint;
    if (phase === "init") {
      this.#origin = cloneCheckpoint(checkpoint);
      if (this.#scheduler === "optimized") this.#queue = this.#computedIds();
    } else if (this.#scheduler === "optimized") {
      this.#queue = this.#plan(previousTables, tables);
    }
    this.#recordCommit();
  }

  #computedIds() {
    const queue = new Set();
    for (const record of this.#records) {
      if (record.kind === "computed") queue.add(record.id);
    }
    return queue;
  }

  #computedRuntime(record, phase) {
    if (phase === "init") return emptyRuntime(this.#freshState(record));
    if (this.#scheduler === "full" || this.#queue.has(record.id)) return this.#publishComputed(record);
    return this.#retainComputed(record);
  }

  #retainComputed(record) {
    const previous = this.#source().devices.get(record.id);
    const runtime = emptyRuntime(cloneRuntimeJson(previous.state), previous.rng);
    runtime.output = {
      red: cloneTable(previous.output.red),
      green: cloneTable(previous.output.green),
    };
    return runtime;
  }

  #plan(previous, tables) {
    const next = new Set();
    for (const network of this.#networks) {
      if (sameTable(previous.get(network), tables.get(network))) continue;
      const readers = this.#readers.get(network);
      if (!readers) continue;
      for (const record of readers) {
        if (record.kind === "computed") next.add(record.id);
      }
    }
    for (const record of this.#records) {
      if (record.awake === true) next.add(record.id);
    }
    return next;
  }

  #assertIdle() {
    if (this.#inflight !== null) {
      throw new RuntimeError("step-busy", "Шаг уже выполняется");
    }
  }

  #snapshotExpected() {
    const devices = new Map();
    for (const record of this.#records) {
      devices.set(record.id, {
        event: record.event === true,
        participant: record.kind === "participant",
        observer: record.kind === "observer",
        random: record.random === true,
        train: record.kind === "train",
        station: record.kind === "station",
        route: record.kind === "train" ? record.route : null,
        transit: record.kind === "train" ? record.transit : null,
        outputs: record.kind === "station"
          ? { red: record.ports.red_output !== null, green: record.ports.green_output !== null }
          : null,
      });
    }
    return {
      profile: this.#profile,
      gameVersion: this.#gameVersion,
      networkIds: new Set(this.#networks.map((network) => network.id)),
      devices,
    };
  }

  #recordCommit() {
    const snapshot = this.capture();
    if (this.#replaceHistory) {
      this.#history = [snapshot];
      this.#replaceHistory = false;
      return;
    }
    this.#history.push(snapshot);
    this.#trimHistory();
  }

  #trimHistory() {
    while (this.#history.length > this.#historyLimit) this.#history.shift();
  }

  #publishTrains(devices, phase) {
    const trainRecords = [];
    const stationRecords = [];
    for (const record of this.#records) {
      if (record.kind === "train") trainRecords.push(record);
      else if (record.kind === "station") stationRecords.push(record);
    }
    if (trainRecords.length === 0 && stationRecords.length === 0) return;
    const departCounts = new Map();
    if (phase === "step") {
      for (const record of stationRecords) departCounts.set(record.id, this.#departCount(record));
    }
    const current = this.#source().devices;
    const outcome = advanceTrains({
      phase,
      departCounts,
      trains: trainRecords.map((record) => ({
        id: record.id,
        state: phase === "init" ? record.state : current.get(record.id).state,
      })),
      stations: stationRecords.map((record) => ({ id: record.id })),
    });
    for (const record of trainRecords) devices.get(record.id).state = outcome.trains.get(record.id);
    for (const record of stationRecords) {
      const presence = outcome.stations.get(record.id);
      const runtime = devices.get(record.id);
      runtime.state = presence.state;
      if (!presence.present) continue;
      if (record.ports.red_output) addToTable(runtime.output.red, record.presence, 1);
      if (record.ports.green_output) addToTable(runtime.output.green, record.presence, 1);
    }
  }

  #departCount(record) {
    const tables = this.#source().tables;
    const red = record.ports.red_input ? tables.get(record.ports.red_input) : createTable();
    const green = record.ports.green_input ? tables.get(record.ports.green_input) : createTable();
    return readTable(combineMasked(red, green, { red: true, green: true }), record.depart);
  }

  #publishConstant(record) {
    const runtime = emptyRuntime(null);
    const table = tableFromStored(record.entries);
    if (record.ports.red_output) runtime.output.red = cloneTable(table);
    if (record.ports.green_output) runtime.output.green = cloneTable(table);
    return runtime;
  }

  #freshState(record) {
    if (record.kind === "participant") return cloneRuntimeJson(record.state);
    if (record.kind === "observer") return { lit: false, color: null };
    if (record.kind === "train") return cloneRuntimeJson(record.state);
    if (record.kind === "station") return { present: false, trainId: null };
    if (record.random === true) {
      return { rng: initialRng(this.#seed, record.id), held: null, elapsed: 0 };
    }
    return null;
  }

  #publishComputed(record) {
    const outcome = this.#invoke(record);
    const table = createTable();
    for (const count of outcome.signals) addToTable(table, count.signal, count.constant);
    const runtime = emptyRuntime(outcome.state);
    if (record.ports.red_output) runtime.output.red = cloneTable(table);
    if (record.ports.green_output) runtime.output.green = cloneTable(table);
    return runtime;
  }

  #invoke(record) {
    const previous = this.#source().devices.get(record.id);
    const view = Object.freeze({
      tick: this.#published.tick,
      nextTick: this.#published.tick + 1,
      profile: this.#profile,
      world: this.#world,
      random: record.random === true ? cloneRuntimeJson(previous.state) : null,
      read: (token, mask) => readTable(this.#inputs(record, mask), token),
      present: (mask) => presentTable(this.#inputs(record, mask)),
    });
    const result = record.compute.call(record.device, view);
    if (result && (typeof result === "object" || typeof result === "function") && typeof result.then === "function") {
      throw new RuntimeError("async-compute", "Вычислитель должен вернуть выход синхронно");
    }
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new RuntimeError("invalid-output", "Выход вычислителя должен быть объектом {signals}");
    }
    const names = record.random === true ? ["random", "signals"] : ["signals"];
    const keys = Object.keys(result);
    if (keys.length !== names.length || names.some((name) => !Object.hasOwn(result, name))) {
      throw new RuntimeError("invalid-output", "Выход вычислителя содержит неверный набор полей");
    }
    if (!Array.isArray(result.signals)) {
      throw new RuntimeError("invalid-output", "Выход вычислителя содержит только массив signals");
    }
    const signals = result.signals.map((entry) => readSignalCount(entry, this.#profile));
    const state = record.random === true
      ? readSelectorMemory(result.random, this.#profile, "invalid-state")
      : null;
    return { signals, state };
  }

  #finishObservers(devices, tables, previousTables, phase) {
    for (const record of this.#records) {
      if (record.kind !== "observer") continue;
      const runtime = devices.get(record.id);
      const dirty = phase === "init"
        || this.#scheduler === "full"
        || this.#observerDirty(record, previousTables, tables);
      if (dirty) runtime.state = this.#invokeObserve(record, tables);
      else runtime.state = cloneRuntimeJson(this.#source().devices.get(record.id).state);
      if (phase === "step") runtime.seenInputs = this.#wireSignature(record, tables);
    }
  }

  #observerDirty(record, previous, tables) {
    for (const network of [record.ports.red_input, record.ports.green_input]) {
      if (!network) continue;
      if (!sameTable(previous.get(network), tables.get(network))) return true;
    }
    return false;
  }

  #invokeObserve(record, tables) {
    const networkTable = (network) => (network ? tables.get(network) : createTable());
    const view = Object.freeze({
      read: (token, mask) => readTable(combineMasked(
        networkTable(record.ports.red_input),
        networkTable(record.ports.green_input),
        mask,
      ), token),
      present: (mask) => presentTable(combineMasked(
        networkTable(record.ports.red_input),
        networkTable(record.ports.green_input),
        mask,
      )),
    });
    const result = record.observe.call(record.device, view);
    if (result && (typeof result === "object" || typeof result === "function") && typeof result.then === "function") {
      throw new RuntimeError("async-observe", "Наблюдатель должен вернуть состояние синхронно");
    }
    return readLampState(result, "invalid-state");
  }

  #inputs(record, mask) {
    return combineMasked(
      this.#inputTable(record.ports.red_input),
      this.#inputTable(record.ports.green_input),
      mask,
    );
  }

  #inputTable(network) {
    if (!network) return createTable();
    return this.#published.tables.get(network);
  }

  #publishParticipant(record, patch, phase, tick, boundary) {
    const runtime = cloneRuntime(this.#source().devices.get(record.id));
    const sends = this.#applyPatch(runtime, patch, phase, tick, boundary);
    resolveWire(runtime, boundary);
    return { runtime, sends };
  }

  #applyPatch(runtime, patch, phase, tick, boundary) {
    if (!patch) return [];
    if (Object.hasOwn(patch, "state")) runtime.state = cloneRuntimeJson(patch.state);
    if (Object.hasOwn(patch, "rng")) runtime.rng = readRng(patch.rng);
    if (Object.hasOwn(patch, "clear")) this.#applyClear(runtime, patch.clear);
    if (Object.hasOwn(patch, "held")) this.#applyHeld(runtime, patch.held);
    if (Object.hasOwn(patch, "pulses")) this.#applyPulses(runtime, patch.pulses, boundary);
    if (Object.hasOwn(patch, "wake")) this.#applyWake(runtime, patch.wake, phase, tick);
    if (Object.hasOwn(patch, "cancelWake")) this.#applyCancel(runtime, patch.cancelWake);
    return this.#readSends(patch, phase);
  }

  #applyClear(runtime, clear) {
    assertPlain(clear, "invalid-result", "clear должен быть объектом цветов");
    const keys = Object.keys(clear);
    if (keys.length === 0 || keys.some((key) => key !== "red" && key !== "green")) {
      throw new RuntimeError("invalid-result", "clear содержит только red и green");
    }
    for (const key of keys) {
      if (typeof clear[key] !== "boolean") {
        throw new RuntimeError("invalid-result", "Флаги clear должны быть boolean");
      }
    }
    if (clear.red === true) {
      runtime.held.red = createTable();
      runtime.pulses = runtime.pulses.filter((pulse) => pulse.color !== "red");
    }
    if (clear.green === true) {
      runtime.held.green = createTable();
      runtime.pulses = runtime.pulses.filter((pulse) => pulse.color !== "green");
    }
  }

  #applyHeld(runtime, held) {
    assertPlain(held, "invalid-result", "held должен быть объектом цветов");
    const keys = Object.keys(held);
    if (keys.length === 0 || keys.some((key) => key !== "red" && key !== "green")) {
      throw new RuntimeError("invalid-result", "held содержит только red и green");
    }
    if (Object.hasOwn(held, "red")) runtime.held.red = this.#countTable(held.red);
    if (Object.hasOwn(held, "green")) runtime.held.green = this.#countTable(held.green);
  }

  #countTable(counts) {
    if (!Array.isArray(counts)) {
      throw new RuntimeError("invalid-result", "Список сигналов должен быть массивом");
    }
    return tableFromCounts(counts, this.#profile);
  }

  #applyPulses(runtime, pulses, boundary) {
    if (!Array.isArray(pulses)) {
      throw new RuntimeError("invalid-pulse", "pulses должен быть массивом");
    }
    for (const pulse of pulses) {
      assertPlain(pulse, "invalid-pulse", "Импульс должен быть объектом");
      assertExactKeys(pulse, PULSE_KEYS, "invalid-pulse", "Импульс содержит red, green, signals и duration");
      if (typeof pulse.red !== "boolean" || typeof pulse.green !== "boolean") {
        throw new RuntimeError("invalid-pulse", "Цвета импульса должны быть boolean");
      }
      if (!Number.isSafeInteger(pulse.duration) || pulse.duration < 1) {
        throw new RuntimeError("invalid-pulse", "Длительность импульса должна быть целым числом от 1");
      }
      const signals = this.#countTable(pulse.signals);
      if (pulse.red) {
        runtime.pulses.push({
          color: "red",
          start: boundary,
          end: boundary + pulse.duration,
          signals: cloneTable(signals),
        });
      }
      if (pulse.green) {
        runtime.pulses.push({
          color: "green",
          start: boundary,
          end: boundary + pulse.duration,
          signals: cloneTable(signals),
        });
      }
    }
  }

  #applyWake(runtime, wake, phase, tick) {
    if (!Array.isArray(wake)) throw new RuntimeError("invalid-wake", "wake должен быть массивом");
    for (const item of wake) {
      if (!Number.isSafeInteger(item)) {
        throw new RuntimeError("invalid-wake", "Граница пробуждения должна быть целым числом");
      }
      const past = phase === "init" ? item < 0 : item <= tick;
      if (past) throw new RuntimeError("invalid-wake", "Пробуждение назначено не на будущую границу");
      runtime.wakes.add(item);
    }
  }

  #applyCancel(runtime, cancel) {
    if (!Array.isArray(cancel)) throw new RuntimeError("invalid-wake", "cancelWake должен быть массивом");
    for (const item of cancel) {
      if (!Number.isSafeInteger(item)) {
        throw new RuntimeError("invalid-wake", "Граница пробуждения должна быть целым числом");
      }
      if (!runtime.wakes.has(item)) {
        throw new RuntimeError("unknown-wake", "Нельзя снять отсутствующее пробуждение");
      }
      runtime.wakes.delete(item);
    }
  }

  #readSends(patch, phase) {
    if (!Object.hasOwn(patch, "send")) return [];
    if (!Array.isArray(patch.send)) {
      throw new RuntimeError("invalid-message", "send должен быть массивом");
    }
    if (phase === "init" && patch.send.length > 0) {
      throw new RuntimeError("forbidden-send", "init не отправляет сообщения");
    }
    return patch.send.map((message) => this.#readMessage(message));
  }

  #readMessage(message) {
    assertPlain(message, "invalid-message", "Сообщение должно быть объектом");
    assertExactKeys(message, MESSAGE_KEYS, "invalid-message", "Сообщение содержит to, type и data");
    if (typeof message.to !== "string" || !this.#byId.has(message.to) || this.#byId.get(message.to).kind !== "participant") {
      throw new RuntimeError("invalid-message", "Получатель сообщения должен быть участником прогона");
    }
    if (typeof message.type !== "string" || message.type.length === 0) {
      throw new RuntimeError("invalid-message", "Тип сообщения должен быть непустой строкой");
    }
    return { to: message.to, type: message.type, data: cloneRuntimeJson(message.data) };
  }

  #deliver(orderedIds, sendsById, sentTick) {
    const buckets = new Map();
    for (const record of this.#records) {
      if (record.kind === "participant") buckets.set(record.id, []);
    }
    for (const id of orderedIds) {
      const sends = sendsById.get(id);
      sends.forEach((message, sequence) => {
        buckets.get(message.to).push({
          from: id,
          to: message.to,
          sentTick,
          deliveryTick: sentTick + 1,
          sequence,
          type: message.type,
          data: message.data,
        });
      });
    }
    for (const list of buckets.values()) {
      const sorted = sortMessages(list);
      list.splice(0, list.length, ...sorted);
    }
    return buckets;
  }

  #writePort(tables, network, table) {
    if (!network) return;
    const target = tables.get(network);
    for (const entry of table.values()) addToTable(target, entry.token, entry.value);
  }

  #tableOf(network) {
    if (!this.#isNetwork(network) || !this.#published.tables.has(network)) {
      throw new ConfigError("not-in-simulation", "Сеть не входит в этот прогон");
    }
    return this.#published.tables.get(network);
  }

  #selectionTable(selection, mask) {
    const tables = this.#selection(selection);
    return combineMasked(tables.red, tables.green, mask);
  }

  #selection(selection) {
    if (!selection || typeof selection !== "object" || Array.isArray(selection)) {
      throw new ConfigError("invalid-selection", "Выбор сетей должен быть объектом {red, green}");
    }
    const keys = Object.keys(selection);
    if (keys.length !== 2 || !Object.hasOwn(selection, "red") || !Object.hasOwn(selection, "green")) {
      throw new ConfigError("invalid-selection", "Выбор сетей содержит только red и green");
    }
    return {
      red: this.#side(selection.red, "red"),
      green: this.#side(selection.green, "green"),
    };
  }

  #side(value, color) {
    if (value === null) return createTable();
    if (!this.#isNetwork(value)) {
      throw new ConfigError("invalid-selection", "Сторона выбора должна быть сетью или null");
    }
    if (!this.#published.tables.has(value)) {
      throw new ConfigError("not-in-simulation", "Сеть не входит в этот прогон");
    }
    if (value.color !== color) {
      throw new ConfigError("wrong-color", "Цвет сети не соответствует стороне выбора");
    }
    return this.#published.tables.get(value);
  }
}

function readRng(value) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 4294967295) {
    throw new RuntimeError("invalid-rng", "Состояние RNG должно быть целым uint32");
  }
  return value;
}

function indexPatches(list, byId) {
  const patches = new Map();
  for (const patch of list) {
    assertPlain(patch, "invalid-result", "Правка устройства должна быть объектом");
    if (typeof patch.id !== "string") {
      throw new RuntimeError("invalid-result", "Правка устройства должна содержать id");
    }
    for (const key of Object.keys(patch)) {
      if (!PATCH_KEYS.has(key)) {
        throw new RuntimeError("invalid-result", `Неизвестное поле правки ${key}`);
      }
    }
    if (patches.has(patch.id)) {
      throw new RuntimeError("duplicate-device", "Устройство повторяется в ответе");
    }
    const record = byId.get(patch.id);
    if (!record) throw new RuntimeError("unknown-device", "Неизвестное устройство в ответе");
    if (record.kind !== "participant") {
      throw new RuntimeError("not-participant", "Правка доступна только участнику транзакции");
    }
    patches.set(patch.id, patch);
  }
  return patches;
}

export async function createRuntime(snapshot, options) {
  return Simulation.start(snapshot, options);
}
