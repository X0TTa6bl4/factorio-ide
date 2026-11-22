import { Arithmetic, Circuit, Constant, EventCombinator, Signal } from "../../src/index.js";
import { ConfigError, RuntimeError } from "../../src/errors.js";
import { createWorkerExecutor } from "../../src/event-host.js";
import { compileScenarioSource, formatDiagnostic, readTimeoutMs } from "../../src/event-script.js";
const engineHref = new URL("../../src/index.js", import.meta.url).href;
const workerUrl = new URL("../../src/event-worker.js", import.meta.url);

const PRESETS = {
  observe: `export class Observe extends EventCombinator {
  init() {
    this.state.role = "observe";
  }

  main() {
    this.state.steps = (this.state.steps ?? 0) + 1;
  }
}
`,
  spin: `export class Spin extends EventCombinator {
  main() {
    while (true) {}
  }
}
`,
};

const CARDS = [
  { key: "constant", symbol: "=", title: "Постоянный", hint: "signal-A = 3" },
  { key: "arithmetic", symbol: "+", title: "Арифметический", hint: "signal-A + 2 → signal-B" },
  { key: "event", symbol: "{}", title: "Событийный", hint: "Worker, без вклада в сети" },
];

const STATUS_TEXT = {
  idle: "Загрузка",
  busy: "Выполняется",
  ready: "Готово",
  paused: "Пауза",
  failed: "Ошибка",
};

const stepButton = document.querySelector("#step");
const resetButton = document.querySelector("#reset");
const status = document.querySelector("#run-status");
const statusText = document.querySelector("#run-status-text");
const tickValue = document.querySelector("#tick-value");
const runMeta = document.querySelector("#run-meta");
const alive = document.querySelector("#ui-alive");
const toolbar = document.querySelector("#toolbar");
const deviceList = document.querySelector("#device-list");
const deviceCount = document.querySelector("#device-count");
const preset = document.querySelector("#preset");
const presetActive = document.querySelector("#preset-active");
const timeoutInput = document.querySelector("#timeout-ms");
const outputBody = document.querySelector("#output-body");
const eventState = document.querySelector("#event-state");
const redBody = document.querySelector("#red-body");
const greenBody = document.querySelector("#green-body");
const diagnostic = document.querySelector("#diagnostic");
const errorIcon = document.querySelector("#error-icon");

let simulation = null;
let circuit = null;
let networks = null;
let devices = null;
let executor = null;
let release = null;
let stopped = false;
let flight = null;
let intent = null;
let runStatus = "idle";
let problem = null;
let previous = { red: new Map(), green: new Map() };
let selected = "arithmetic";

const facade = {
  replayInit: true,
  prepare(request) {
    const current = executor;
    if (!current) return Promise.reject(new RuntimeError("worker-stopped", "Исполнитель сценария остановлен"));
    return Promise.resolve(current.prepare(request)).then((response) => {
      if (stopped) throw new RuntimeError("worker-stopped", "Исполнитель сценария остановлен");
      return response;
    });
  },
};

function signalName(signal) {
  return signal.quality && signal.quality !== "normal"
    ? `${signal.name}/${signal.quality}`
    : signal.name;
}

function listed(signals) {
  return signals.map((entry) => ({ name: signalName(entry.signal), constant: entry.constant, signal: entry.signal }));
}

function indexSignals(signals) {
  return new Map(signals.map((entry) => [entry.name, entry.constant]));
}

async function openExecutor(moduleSource, timeoutMs) {
  const scriptUrl = URL.createObjectURL(new Blob([moduleSource], { type: "text/javascript" }));
  const worker = new Worker(workerUrl, { type: "module" });
  let failed = false;
  const failure = new Promise((_, reject) => {
    worker.addEventListener("error", () => {
      failed = true;
      reject(new Error("Не удалось запустить Worker"));
    }, { once: true });
  });
  failure.catch(() => {});
  try {
    const opened = await Promise.race([
      createWorkerExecutor(worker, { scriptUrl, timeoutMs }),
      failure,
    ]);
    if (failed) throw new Error("Не удалось запустить Worker");
    return {
      executor: opened,
      release() {
        URL.revokeObjectURL(scriptUrl);
      },
    };
  } catch (error) {
    worker.terminate();
    URL.revokeObjectURL(scriptUrl);
    throw error;
  }
}

function halt() {
  stopped = true;
  if (executor && typeof executor.stop === "function") executor.stop();
}

function buildCircuit() {
  const next = new Circuit({ profile: "base" });
  const red = next.network("red_1");
  const green = next.network("green_1");
  const constant = new Constant({
    enabled: true,
    red_output: red,
    signals: [{ signal: Signal.Signals.signal_A, constant: 3 }],
  });
  const arithmetic = new Arithmetic({
    red_input: red,
    green_output: green,
    left_operand: { red: true, green: false, signal: Signal.Signals.signal_A },
    right_operand: { constant: 2 },
    operation: Arithmetic.Operation.SUM,
    return: Signal.Signals.signal_B,
  });
  const event = new EventCombinator({
    run: { every_tick: true, input_changed: false },
    state: {},
  });
  next.add(constant);
  next.add(arithmetic);
  next.add(event);
  return {
    circuit: next,
    networks: { red, green },
    devices: { constant, arithmetic, event },
  };
}

function annotate(error) {
  if (!error || typeof error !== "object") return;
  if (error.deviceId === undefined && circuit && devices) error.deviceId = circuit.deviceId(devices.event);
  if (error.tick === undefined && simulation) error.tick = simulation.tick;
}

async function boot() {
  const timeout = readTimeoutMs(Number(timeoutInput.value));
  if (!timeout.ok) throw new ConfigError(timeout.code, timeout.message);
  const compiled = compileScenarioSource(PRESETS[preset.value], engineHref);
  if (!compiled.ok) throw new RuntimeError(compiled.code, compiled.message);
  halt();
  const opened = await openExecutor(compiled.moduleSource, timeout.timeoutMs);
  const built = buildCircuit();
  executor = opened.executor;
  const previousRelease = release;
  release = opened.release;
  stopped = false;
  previousRelease?.();
  let next;
  try {
    next = await built.circuit.createSimulation({ executor: facade });
  } catch (error) {
    halt();
    release?.();
    executor = null;
    release = null;
    throw error;
  }
  simulation = next;
  circuit = built.circuit;
  networks = built.networks;
  devices = built.devices;
  previous = { red: new Map(), green: new Map() };
  problem = null;
  runStatus = "ready";
  presetActive.textContent = preset.value;
}

async function revive() {
  const snapshot = simulation.capture();
  const timeout = readTimeoutMs(Number(timeoutInput.value));
  if (!timeout.ok) throw new ConfigError(timeout.code, timeout.message);
  const compiled = compileScenarioSource(PRESETS[preset.value], engineHref);
  if (!compiled.ok) throw new RuntimeError(compiled.code, compiled.message);
  const opened = await openExecutor(compiled.moduleSource, timeout.timeoutMs);
  const previousRelease = release;
  executor = opened.executor;
  release = opened.release;
  stopped = false;
  previousRelease?.();
  await simulation.restore(snapshot);
}

async function step() {
  if (flight) {
    const error = new RuntimeError("step-busy", "Шаг уже выполняется");
    problem = formatDiagnostic(error);
    render();
    throw error;
  }
  if (!simulation || runStatus === "failed" || runStatus === "idle") {
    const error = new RuntimeError("run-paused", "Сначала дождитесь готового прогона");
    problem = formatDiagnostic(error);
    render();
    throw error;
  }
  const before = {
    red: indexSignals(listed(simulation.present(networks.red))),
    green: indexSignals(listed(simulation.present(networks.green))),
  };
  const run = (async () => {
    try {
      await simulation.step();
      previous = before;
      problem = null;
      runStatus = "ready";
    } catch (error) {
      annotate(error);
      problem = formatDiagnostic(error);
      runStatus = "paused";
      if (intent !== "reset" && (error.code === "timeout" || error.code === "worker-stopped")) {
        try {
          await revive();
        } catch (reviveError) {
          runStatus = "failed";
          problem = formatDiagnostic(reviveError);
          throw reviveError;
        }
      }
      throw error;
    }
  })();
  flight = run;
  run.catch(() => {});
  render();
  try {
    await run;
  } finally {
    if (flight === run) flight = null;
    render();
  }
}

async function reset() {
  if (flight) {
    intent = "reset";
    halt();
    try {
      await flight;
    } catch {
      /* отменённый шаг не публикует границу */
    }
    intent = null;
  }
  await boot();
}

function showDiagnostic(item) {
  diagnostic.replaceChildren();
  if (!item) {
    const note = document.createElement("p");
    note.className = "fl-muted";
    note.textContent = "Ошибок опубликованной границы нет.";
    diagnostic.append(note);
    return;
  }
  const notice = document.createElement("div");
  notice.className = "fl-notice fl-notice--error";
  const body = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = item.code === "unsupported-mode"
    || item.code === "unsupported-operation"
    || item.code === "unsupported-case"
    ? "Неподдержанный режим"
    : "Ошибка прогона";
  const meta = document.createElement("p");
  meta.className = "fl-notice__meta";
  const parts = [`код ${item.code}`];
  if (item.deviceId) parts.push(`блок ${item.deviceId}`);
  if (item.tick !== "") parts.push(`тик ${item.tick}`);
  meta.textContent = parts.join(" · ");
  const message = document.createElement("p");
  message.textContent = item.message;
  body.append(title, meta, message);
  notice.append(errorIcon.content.cloneNode(true), body);
  diagnostic.append(notice);
}

function fillNetwork(body, signals, prior, showPrior) {
  body.replaceChildren();
  const names = [...new Set([...prior.keys(), ...signals.map((entry) => entry.name)])].sort();
  if (names.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.textContent = "Нет сигналов";
    row.append(cell);
    body.append(row);
    return;
  }
  for (const name of names) {
    const current = signals.find((entry) => entry.name === name)?.constant ?? 0;
    const row = document.createElement("tr");
    const title = document.createElement("th");
    title.scope = "row";
    title.textContent = name;
    const before = document.createElement("td");
    before.className = "fl-mono";
    const now = document.createElement("td");
    now.className = "fl-mono";
    now.textContent = String(current);
    const delta = document.createElement("td");
    if (!showPrior) {
      before.textContent = "—";
      delta.textContent = "—";
      delta.className = "fl-muted";
    } else {
      const earlier = prior.get(name) ?? 0;
      before.textContent = String(earlier);
      const diff = current - earlier;
      delta.textContent = diff > 0 ? `+${diff}` : String(diff);
      delta.className = diff === 0 ? "fl-muted" : "fl-delta";
    }
    row.append(title, before, now, delta);
    body.append(row);
  }
}

function fillOutput(rows) {
  outputBody.replaceChildren();
  if (rows.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 3;
    cell.textContent = "Нет вклада";
    row.append(cell);
    outputBody.append(row);
    return;
  }
  for (const entry of rows) {
    const row = document.createElement("tr");
    const color = document.createElement("th");
    color.scope = "row";
    color.textContent = entry.color;
    const name = document.createElement("td");
    name.textContent = entry.name;
    const value = document.createElement("td");
    value.className = "fl-mono";
    value.textContent = String(entry.constant);
    row.append(color, name, value);
    outputBody.append(row);
  }
}

function renderDevices() {
  deviceList.replaceChildren();
  if (!circuit || !devices) {
    deviceCount.textContent = "0";
    return;
  }
  deviceCount.textContent = String(circuit.devices.length);
  for (const card of CARDS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = card.key === selected ? "fl-device fl-device--selected" : "fl-device";
    button.setAttribute("role", "listitem");
    button.setAttribute("aria-pressed", String(card.key === selected));
    button.dataset.device = card.key;
    const row = document.createElement("div");
    row.className = "fl-row";
    const symbol = document.createElement("span");
    symbol.className = "fl-device__symbol";
    symbol.setAttribute("aria-hidden", "true");
    symbol.textContent = card.symbol;
    const text = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = card.title;
    const hint = document.createElement("span");
    hint.className = "fl-field__hint fl-mono";
    hint.textContent = `${circuit.deviceId(devices[card.key])} · ${card.hint}`;
    text.append(title, hint);
    row.append(symbol, text);
    button.append(row);
    button.addEventListener("click", () => {
      selected = card.key;
      render();
    });
    deviceList.append(button);
  }
}

function selectedRows() {
  if (!simulation || !devices) return [];
  const output = simulation.device(devices[selected]).output;
  return [
    ...output.red.map((entry) => ({ color: "красный", name: signalName(entry.signal), constant: entry.constant })),
    ...output.green.map((entry) => ({ color: "зелёный", name: signalName(entry.signal), constant: entry.constant })),
  ];
}

function render() {
  const busy = Boolean(flight);
  const shown = busy ? "busy" : runStatus;
  status.dataset.status = shown;
  status.className = shown === "failed"
    ? "fl-badge fl-badge--error"
    : shown === "ready"
      ? "fl-badge fl-badge--success"
      : shown === "paused"
        ? "fl-badge fl-badge--accent"
        : "fl-badge";
  statusText.textContent = STATUS_TEXT[shown] ?? shown;
  tickValue.textContent = simulation ? String(simulation.tick) : "—";
  const runId = simulation ? String(simulation.runId) : "—";
  runMeta.textContent = `Непрерывный запуск не входит в этот срез. Прогон ${runId}. Лимит исполнителя не меняет номер тика.`;
  toolbar.setAttribute("aria-busy", busy ? "true" : "false");
  stepButton.disabled = busy || !simulation || (runStatus !== "ready" && runStatus !== "paused");
  resetButton.disabled = !simulation && !busy;
  preset.disabled = busy;
  const red = simulation ? listed(simulation.present(networks.red)) : [];
  const green = simulation ? listed(simulation.present(networks.green)) : [];
  const showPrior = Boolean(simulation && simulation.tick > 0);
  fillNetwork(redBody, red, previous.red, showPrior);
  fillNetwork(greenBody, green, previous.green, showPrior);
  fillOutput(selectedRows());
  eventState.textContent = simulation ? JSON.stringify(simulation.device(devices.event).state, null, 2) : "—";
  renderDevices();
  showDiagnostic(problem);
}

function fail(error) {
  problem = formatDiagnostic(error);
  runStatus = "failed";
  render();
}

document.querySelector("#ui-ping").addEventListener("click", () => {
  alive.textContent = "Интерфейс: alive";
});
stepButton.addEventListener("click", () => {
  step().catch(() => {});
});
resetButton.addEventListener("click", () => {
  reset().then(() => render()).catch(fail);
});
preset.addEventListener("change", () => {
  reset().then(() => render()).catch(fail);
});
document.querySelector("#unsupported").addEventListener("click", () => {
  try {
    new Arithmetic({
      left_operand: { red: true, green: false, signal: Signal.Meta.signal_anything },
      right_operand: { constant: 1 },
      operation: Arithmetic.Operation.SUM,
      return: Signal.Signals.signal_B,
    });
    problem = null;
  } catch (error) {
    problem = formatDiagnostic(error);
  }
  render();
});

render();
boot().then(() => render()).catch(fail);

function snapshot() {
  return {
    status: flight ? "busy" : runStatus,
    tick: simulation ? simulation.tick : null,
    runId: simulation ? simulation.runId : null,
    red: simulation ? listed(simulation.present(networks.red)) : [],
    green: simulation ? listed(simulation.present(networks.green)) : [],
    diagnostic: problem,
    eventState: simulation ? simulation.device(devices.event).state : null,
  };
}

window.__circuitPage = {
  step,
  reset: () => reset().then(() => snapshot()),
  view: snapshot,
};
