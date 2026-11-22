/** Страница отладчика: кнопки вызывают тот же step, таймер задаёт только паузу между ними. */

import { Arithmetic, Constant, Decider, EventCombinator, Selector } from "../../src/index.js";
import { formatDiagnostic } from "../../src/event-script.js";
import { createPlayback } from "./playback.js";
import { mountAbout } from "../release.js";
import { ensureSelectOption, setSelectOptions } from "../../ui/scripts/widgets.js";
import { buildScheme, schemeMeta } from "./schemes.js";
import { diffRows, indexOutput, indexSignals } from "./signals.js";

const KIND = new Map([
  [Constant, { symbol: "=", title: "Постоянный" }],
  [Arithmetic, { symbol: "+", title: "Арифметический" }],
  [Decider, { symbol: "≥", title: "Сравнивающий" }],
  [Selector, { symbol: "#", title: "Выбирающий" }],
  [EventCombinator, { symbol: "{}", title: "Событийный" }],
]);

const PORTS = [
  ["red_input", "вход", "red", "R"],
  ["green_input", "вход", "green", "G"],
  ["red_output", "выход", "red", "R"],
  ["green_output", "выход", "green", "G"],
];

const STATUS_TEXT = {
  idle: "Загрузка",
  running: "Идёт",
  paused: "Пауза",
  failed: "Ошибка",
};

const playButton = document.querySelector("#play");
const playLabel = document.querySelector("#play-label");
const playIcon = document.querySelector("#play-icon");
const pauseIcon = document.querySelector("#pause-icon");
const stepButton = document.querySelector("#step");
const backButton = document.querySelector("#back");
const resetButton = document.querySelector("#reset");
const timeline = document.querySelector("#timeline");
const timelineStatus = document.querySelector("#timeline-status");
const historyLimit = document.querySelector("#history-limit");
const speedSelect = document.querySelector("#speed");
const schemeSelect = document.querySelector("#scheme");
const status = document.querySelector("#run-status");
const statusText = document.querySelector("#run-status-text");
const tickValue = document.querySelector("#tick-value");
const toolbar = document.querySelector("#toolbar");
const runMeta = document.querySelector("#run-meta");
const schemeNote = document.querySelector("#scheme-note");
const schemeExpect = document.querySelector("#scheme-expect");
mountAbout();
const deviceList = document.querySelector("#device-list");
const deviceCount = document.querySelector("#device-count");
const deviceCard = document.querySelector("#device-card");
const networkSelect = document.querySelector("#network");
const networkBody = document.querySelector("#network-body");
const ownBody = document.querySelector("#own-body");
const diagnostic = document.querySelector("#diagnostic");
const errorIcon = document.querySelector("#error-icon");

let speedMs = Number(speedSelect.value);
const requestedScheme = new URLSearchParams(location.search).get("scheme");
if (requestedScheme) {
  ensureSelectOption(schemeSelect, requestedScheme, requestedScheme);
  schemeSelect.value = requestedScheme;
}
let schemeId = schemeSelect.value;
let expectText = schemeMeta(schemeId)?.expect ?? "";
let simulation = null;
let model = null;
let networks = [];
let steps = 0;
let problem = null;
let booting = false;
let scrubbing = false;
let selectedIndex = 0;
let selectedNetwork = null;

const playback = createPlayback({
  perform: stepSimulation,
  schedule(delay, fn) {
    const id = setTimeout(() => {
      fn();
    }, delay);
    return { cancel() { clearTimeout(id); } };
  },
  interval: () => speedMs,
  onChange: () => render(),
});

function describe(device) {
  return KIND.get(device.constructor) ?? { symbol: "?", title: "Устройство" };
}

function collectNetworks(devices) {
  const list = [];
  const seen = new Set();
  for (const item of devices) {
    for (const [key] of PORTS) {
      if (!Object.hasOwn(item.device, key)) continue;
      const network = item.device[key];
      if (!network || seen.has(network)) continue;
      seen.add(network);
      list.push(network);
    }
  }
  list.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  return list;
}

function selectedItem() {
  if (!model) return null;
  return model.devices[selectedIndex] ?? null;
}

function preferredNetwork(devices, list) {
  for (const item of devices) {
    for (const key of ["red_output", "green_output"]) {
      const network = item.device[key];
      if (network && list.includes(network)) return network.name;
    }
  }
  return list[0]?.name ?? null;
}

function ownLabel(entry) {
  const match = /^(red|green):(.*)$/.exec(entry.name);
  if (!match) return entry.name;
  return `${match[1] === "red" ? "красный" : "зелёный"} · ${match[2]}`;
}

function boundaryView(snapshot) {
  const networkMaps = new Map();
  for (const network of networks) {
    const entry = snapshot.networks.find((item) => item.id === network.id);
    networkMaps.set(network.name, indexSignals(entry ? entry.signals : []));
  }
  const own = new Map();
  for (const item of model.devices) {
    const id = model.circuit.deviceId(item.device);
    const device = snapshot.devices.find((entry) => entry.id === id);
    own.set(id, indexOutput(device ? device.output : { red: [], green: [] }));
  }
  return { networks: networkMaps, own };
}

function previousBoundary() {
  if (!simulation || !model) return null;
  const ticks = simulation.historyTicks();
  const index = ticks.indexOf(simulation.tick);
  if (index <= 0) return null;
  const snapshot = simulation.historySnapshot(ticks[index - 1]);
  return snapshot ? boundaryView(snapshot) : null;
}

async function recallTick(tick) {
  if (scrubbing || booting || !simulation || playback.mode !== "paused" || playback.pending) return;
  scrubbing = true;
  render();
  try {
    await simulation.recall(tick);
    steps = simulation.tick;
    problem = null;
  } catch (error) {
    problem = formatDiagnostic(error);
  } finally {
    scrubbing = false;
    render();
  }
}

async function stepSimulation() {
  if (booting || !simulation || !model) {
    const error = new Error("Нет готового прогона");
    error.code = "run-paused";
    problem = formatDiagnostic(error);
    throw error;
  }
  try {
    await simulation.step();
  } catch (error) {
    problem = formatDiagnostic(error);
    throw error;
  }
  steps = simulation.tick;
  problem = null;
  render();
}

async function openScheme(id) {
  schemeId = id;
  playback.pause();
  if (playback.pending) {
    try {
      await playback.pending;
    } catch {
      /* текущий шаг уже либо опубликован, либо отклонён */
    }
  }
  booting = true;
  render();
  try {
    const built = buildScheme(id);
    expectText = schemeMeta(id)?.expect ?? "";
    if (!built.ok) {
      simulation = null;
      model = null;
      networks = [];
      steps = 0;
      selectedIndex = 0;
      selectedNetwork = null;
      problem = formatDiagnostic(built.error);
      playback.fail();
      return;
    }
    const next = await built.circuit.createSimulation();
    simulation = next;
    model = built;
    networks = collectNetworks(built.devices);
    steps = 0;
    problem = null;
    selectedIndex = 0;
    selectedNetwork = built.watch && networks.some((network) => network.name === built.watch)
      ? built.watch
      : preferredNetwork(built.devices, networks);
    playback.clearFailure();
  } catch (error) {
    simulation = null;
    model = null;
    networks = [];
    steps = 0;
    problem = formatDiagnostic(error);
    playback.fail();
  } finally {
    booting = false;
    render();
  }
}

function titleFor(code) {
  if (code === "unsupported-case" || code === "unsupported-mode" || code === "unsupported-operation") {
    return "Неподдержанный режим";
  }
  if (code.startsWith("invalid-") || code === "mixed-operand" || code === "missing-operand") {
    return "Неверная конфигурация";
  }
  return "Ошибка прогона";
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
  title.textContent = titleFor(item.code);
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

function cell(text, className) {
  const node = document.createElement("td");
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

function deltaClass(change) {
  if (change === "gone") return "fl-delta fl-delta--gone";
  if (change === "changed" || change === "new") return "fl-delta";
  return "fl-muted";
}

function fillRows(body, rows, emptyText, labelOf) {
  body.replaceChildren();
  if (rows.length === 0) {
    const row = document.createElement("tr");
    const empty = document.createElement("td");
    empty.colSpan = 4;
    empty.textContent = emptyText;
    row.append(empty);
    body.append(row);
    return;
  }
  for (const entry of rows) {
    const row = document.createElement("tr");
    row.dataset.signal = entry.name;
    row.dataset.change = entry.change;
    if (entry.value !== null) row.dataset.value = String(entry.value);
    const title = document.createElement("th");
    title.scope = "row";
    title.textContent = labelOf(entry);
    row.append(
      title,
      cell(entry.before === null ? "—" : String(entry.before), "fl-mono"),
      cell(entry.value === null ? "—" : String(entry.value), "fl-mono"),
      cell(entry.delta, deltaClass(entry.change)),
    );
    body.append(row);
  }
}

function renderTables() {
  const item = selectedItem();
  const prior = previousBoundary();
  const showPrior = Boolean(prior);
  const network = networks.find((entry) => entry.name === selectedNetwork) ?? null;
  const currentNetwork = simulation && network
    ? indexSignals(simulation.present(network))
    : new Map();
  const previousNetwork = prior && network ? prior.networks.get(network.name) : null;
  fillRows(
    networkBody,
    diffRows(previousNetwork, currentNetwork, showPrior),
    "Нет сигналов",
    (entry) => entry.name,
  );
  const currentOwn = simulation && item
    ? indexOutput(simulation.device(item.device).output)
    : new Map();
  const previousOwn = prior && item
    ? prior.own.get(model.circuit.deviceId(item.device))
    : null;
  fillRows(
    ownBody,
    diffRows(previousOwn, currentOwn, showPrior),
    "Нет вклада",
    ownLabel,
  );
}

function portNode(device, key, role, tone, mark) {
  const network = device[key];
  const chip = document.createElement("span");
  chip.className = network ? `fl-port fl-${tone}` : "fl-port fl-muted";
  chip.textContent = `${role} ${mark} · ${network ? network.name : "null"}`;
  return chip;
}

function renderCard() {
  deviceCard.replaceChildren();
  const item = selectedItem();
  if (!item || !model) {
    const empty = document.createElement("p");
    empty.className = "fl-muted";
    empty.textContent = "Устройство не выбрано.";
    deviceCard.append(empty);
    return;
  }
  const kind = describe(item.device);
  const article = document.createElement("article");
  article.className = "fl-device fl-device--selected";
  const row = document.createElement("div");
  row.className = "fl-row";
  const symbol = document.createElement("span");
  symbol.className = "fl-device__symbol";
  symbol.setAttribute("aria-hidden", "true");
  symbol.textContent = kind.symbol;
  const text = document.createElement("div");
  text.className = "fl-device__title";
  const title = document.createElement("h3");
  title.textContent = kind.title;
  const hint = document.createElement("span");
  hint.className = "fl-field__hint fl-mono";
  hint.textContent = model.circuit.deviceId(item.device);
  text.append(title, hint);
  const badge = document.createElement("span");
  badge.className = "fl-badge fl-badge--accent";
  badge.textContent = "Выбран";
  row.append(symbol, text, badge);
  const rule = document.createElement("hr");
  rule.className = "fl-divider";
  const summary = document.createElement("p");
  summary.className = "fl-mono";
  summary.textContent = item.summary;
  const ports = document.createElement("div");
  ports.className = "fl-device__ports";
  const inputs = document.createElement("div");
  inputs.className = "fl-stack fl-stack--sm";
  const outputs = document.createElement("div");
  outputs.className = "fl-stack fl-stack--sm";
  for (const [key, role, tone, mark] of PORTS) {
    if (!Object.hasOwn(item.device, key)) continue;
    const chip = portNode(item.device, key, role, tone, mark);
    if (key.endsWith("input")) inputs.append(chip);
    else outputs.append(chip);
  }
  const arrow = document.createElement("span");
  arrow.className = "fl-muted";
  arrow.setAttribute("aria-hidden", "true");
  arrow.textContent = "→";
  ports.append(inputs, arrow, outputs);
  const note = document.createElement("p");
  note.className = "fl-field__hint";
  note.textContent = "Подключения читаются из портов устройства. Справа — агрегат выбранной сети, ниже — только собственный выход.";
  article.append(row, rule, summary, ports, note);
  deviceCard.append(article);
}

function syncDevices() {
  deviceCount.textContent = model ? String(model.devices.length) : "0";
  const signature = model
    ? model.devices.map((item) => model.circuit.deviceId(item.device)).join(" ")
    : "";
  if (deviceList.dataset.signature !== signature) {
    deviceList.dataset.signature = signature;
    deviceList.replaceChildren();
    if (!model) return;
    model.devices.forEach((item, index) => {
      const kind = describe(item.device);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "fl-device";
      button.setAttribute("role", "listitem");
      button.dataset.deviceId = model.circuit.deviceId(item.device);
      const row = document.createElement("div");
      row.className = "fl-row";
      const symbol = document.createElement("span");
      symbol.className = "fl-device__symbol";
      symbol.setAttribute("aria-hidden", "true");
      symbol.textContent = kind.symbol;
      const text = document.createElement("div");
      const title = document.createElement("h3");
      title.textContent = kind.title;
      const hint = document.createElement("span");
      hint.className = "fl-field__hint fl-mono";
      hint.textContent = `${button.dataset.deviceId} · ${item.summary}`;
      text.append(title, hint);
      row.append(symbol, text);
      button.append(row);
      button.addEventListener("click", () => {
        selectedIndex = index;
        render();
      });
      deviceList.append(button);
    });
  }
  const buttons = [...deviceList.querySelectorAll("button")];
  buttons.forEach((button, index) => {
    const on = index === selectedIndex;
    button.className = on ? "fl-device fl-device--selected" : "fl-device";
    button.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function syncNetworks() {
  const signature = networks.map((network) => network.name).join(" ");
  if (networkSelect.dataset.signature !== signature) {
    networkSelect.dataset.signature = signature;
    setSelectOptions(networkSelect, networks.map((network) => ({
      value: network.name,
      label: `${network.color === "green" ? "G" : "R"} · ${network.name}`,
    })), selectedNetwork ?? "");
  } else if (networks.some((network) => network.name === selectedNetwork)) {
    networkSelect.value = selectedNetwork;
  }
  networkSelect.disabled = networks.length === 0 || booting;
}

function renderTimeline() {
  const ticks = simulation ? simulation.historyTicks() : [];
  const signature = ticks.join(" ");
  const current = simulation ? simulation.tick : null;
  const focusedTick = timeline.contains(document.activeElement)
    ? document.activeElement.dataset.tick
    : null;
  if (timeline.dataset.signature !== signature) {
    timeline.dataset.signature = signature;
    timeline.replaceChildren();
    for (const tick of ticks) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "fl-timeline__tick";
      button.dataset.tick = String(tick);
      button.textContent = `t${String(tick).padStart(2, "0")}`;
      button.addEventListener("click", () => {
        recallTick(tick);
      });
      timeline.append(button);
    }
  }
  const locked = booting || scrubbing || !simulation || playback.mode !== "paused" || Boolean(playback.pending);
  for (const button of timeline.querySelectorAll("button")) {
    const on = Number(button.dataset.tick) === current;
    button.setAttribute("aria-pressed", on ? "true" : "false");
    button.disabled = locked;
  }
  historyLimit.textContent = simulation ? `Предел ${simulation.historyLimit}` : "Нет прогона";
  if (!simulation) {
    timelineStatus.textContent = "История появится после создания прогона.";
  } else if (ticks.length > 0 && ticks[0] !== 0) {
    timelineStatus.textContent = `Граница t${current}. Ранние снимки вытеснены пределом ${simulation.historyLimit}. Выбор тика восстанавливает сохранённую границу.`;
  } else {
    timelineStatus.textContent = `Граница t${current}. В истории ${ticks.length} из ${simulation.historyLimit}. Выбор тика восстанавливает сохранённую границу.`;
  }
  if (focusedTick) {
    const next = timeline.querySelector(`[data-tick="${focusedTick}"]`)
      ?? timeline.querySelector('[aria-pressed="true"]');
    next?.focus();
  }
}

function render() {
  const mode = booting ? "idle" : playback.mode;
  const running = mode === "running";
  const ready = Boolean(simulation) && mode === "paused" && !booting;
  status.dataset.status = mode;
  status.className = mode === "failed"
    ? "fl-badge fl-badge--error"
    : mode === "running"
      ? "fl-badge fl-badge--success"
      : "fl-badge";
  statusText.textContent = STATUS_TEXT[mode] ?? mode;
  tickValue.textContent = simulation ? String(simulation.tick) : "—";
  tickValue.dataset.steps = String(steps);
  toolbar.dataset.playback = mode;
  toolbar.setAttribute("aria-busy", booting || scrubbing || playback.pending ? "true" : "false");
  playButton.disabled = booting || !simulation || mode === "failed";
  playButton.setAttribute("aria-pressed", running ? "true" : "false");
  playLabel.textContent = running ? "Пауза" : "Запустить";
  playIcon.hidden = running;
  pauseIcon.hidden = !running;
  stepButton.disabled = !ready || scrubbing || Boolean(playback.pending);
  backButton.disabled = !ready || scrubbing || Boolean(playback.pending) || !simulation || simulation.historyTicks().length < 2;
  resetButton.disabled = booting;
  speedSelect.disabled = booting;
  schemeSelect.disabled = booting;
  schemeSelect.value = schemeId;
  schemeNote.textContent = model?.blurb
    ?? (problem ? "Схема не передана движку." : "Схема не загружена.");
  schemeExpect.textContent = expectText;
  runMeta.textContent = simulation
    ? `Прогон ${simulation.runId}. Опубликованный тик ${simulation.tick}. Скорость только задаёт паузу между теми же step().`
    : "Прогон не создан. Ошибочная конфигурация не передаётся движку.";
  syncDevices();
  syncNetworks();
  renderCard();
  renderTables();
  renderTimeline();
  showDiagnostic(problem);
}

playButton.addEventListener("click", () => {
  if (playback.mode === "running") playback.pause();
  else playback.start();
});
stepButton.addEventListener("click", () => {
  playback.step().catch((error) => {
    if (!error || error.code === "playback-stopped" || error.code === "playback-running" || error.code === "step-busy") {
      return;
    }
  });
});
backButton.addEventListener("click", () => {
  if (!simulation) return;
  recallTick(simulation.historyTicks().at(-2));
});
timeline.addEventListener("keydown", (event) => {
  const buttons = [...timeline.querySelectorAll("button")].filter((button) => !button.disabled);
  const index = buttons.indexOf(document.activeElement);
  if (index < 0) return;
  let next = index;
  if (event.key === "ArrowRight") next = Math.min(buttons.length - 1, index + 1);
  else if (event.key === "ArrowLeft") next = Math.max(0, index - 1);
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = buttons.length - 1;
  else return;
  event.preventDefault();
  if (next !== index) buttons[next].click();
});
resetButton.addEventListener("click", () => {
  openScheme(schemeId);
});
speedSelect.addEventListener("change", () => {
  speedMs = Number(speedSelect.value);
});
schemeSelect.addEventListener("change", () => {
  openScheme(schemeSelect.value);
});
networkSelect.addEventListener("change", () => {
  selectedNetwork = networkSelect.value;
  render();
});

render();
openScheme(schemeId);

window.__debuggerPage = {
  play: () => playback.start(),
  pause: () => playback.pause(),
  step: () => playback.step(),
  back: async () => {
    if (!simulation) return false;
    try {
      await simulation.back();
      steps = simulation.tick;
      problem = null;
      return true;
    } catch (error) {
      problem = formatDiagnostic(error);
      return false;
    } finally {
      render();
    }
  },
  reset: () => openScheme(schemeId),
  view: () => ({
    status: playback.mode,
    tick: simulation ? simulation.tick : null,
    steps,
    scheme: schemeId,
    diagnostic: problem,
  }),
};
