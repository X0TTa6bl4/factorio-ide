import { eventCompletion } from "../../src/event-complete.js";
import { createWorkerExecutor } from "../../src/event-host.js";
import { createEventScriptSession } from "../../src/event-script.js";
import { mountCaretComplete } from "../caret-complete.js";
import { mountCodePaint, paintJavaScript } from "../code-paint.js";
import { EVENT_DEMO, mountAbout } from "../release.js";

const sourceUrl = new URL("../../src/index.js", import.meta.url);
const workerUrl = new URL("../../src/event-worker.js", import.meta.url);

const INITIAL_SOURCE = `export class Arrival extends EventCombinator {
  init() {
    this.state.arrived = false;
  }

  main() {
    if (this.nextTick === 1) {
      this.state.arrived = true;
      this.setOutput({
        red: true,
        green: false,
        signals: [{ signal: Signal.Signals.signal_A, constant: 1 }]
      });
    }
  }
}
`;

const STATUS_TEXT = {
  idle: "Не проверен",
  busy: "Выполняется",
  ready: "Готово",
  paused: "Пауза",
  failed: "Ошибка",
};

mountAbout();
const demoExpect = document.querySelector("#demo-expect");
if (demoExpect) demoExpect.textContent = EVENT_DEMO.expect;

const source = document.querySelector("#script-source");
const gutter = document.querySelector("#code-gutter");
const stateJson = document.querySelector("#state-json");
const everyTick = document.querySelector("#every-tick");
const inputChanged = document.querySelector("#input-changed");
const timeout = document.querySelector("#timeout-ms");
const checkButton = document.querySelector("#check");
const stepButton = document.querySelector("#step");
const resetButton = document.querySelector("#reset");
const stopButton = document.querySelector("#stop");
const status = document.querySelector("#run-status");
const statusText = document.querySelector("#run-status-text");
const tickValue = document.querySelector("#tick-value");
const runMeta = document.querySelector("#run-meta");
const className = document.querySelector("#class-name");
const editStatus = document.querySelector("#edit-status");
const diagnostic = document.querySelector("#diagnostic");
const redBody = document.querySelector("#red-body");
const greenBody = document.querySelector("#green-body");
const messageBody = document.querySelector("#message-body");
const deviceState = document.querySelector("#device-state");
const alive = document.querySelector("#ui-alive");
const toolbar = document.querySelector("#toolbar");
const rememberButton = document.querySelector("#remember");
const restoreButton = document.querySelector("#restore");
const snapshotSummary = document.querySelector("#snapshot-summary");
const dialog = document.querySelector("#snapshot-dialog");
const openSnapshot = document.querySelector("#open-snapshot");
const errorIcon = document.querySelector("#error-icon");

source.value = INITIAL_SOURCE;

let codePaint = () => {};

function syncGutter() {
  const lines = source.value.split("\n");
  gutter.textContent = lines.map((_, index) => String(index + 1).padStart(2, "0")).join("\n");
  codePaint();
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
    const executor = await Promise.race([
      createWorkerExecutor(worker, { scriptUrl, timeoutMs }),
      failure,
    ]);
    if (failed) throw new Error("Не удалось запустить Worker");
    return {
      executor,
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

const session = createEventScriptSession({
  engineHref: sourceUrl.href,
  openExecutor,
});

function signalLabel(entry) {
  const signal = entry.signal;
  if (signal.quality && signal.quality !== "normal") {
    return `${signal.type}/${signal.name}/${signal.quality}`;
  }
  return `${signal.type}/${signal.name}`;
}

function fillSignals(body, signals) {
  body.replaceChildren();
  if (signals.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 2;
    cell.textContent = "Нет сигналов";
    row.append(cell);
    body.append(row);
    return;
  }
  for (const entry of signals) {
    const row = document.createElement("tr");
    const name = document.createElement("th");
    name.scope = "row";
    name.textContent = signalLabel(entry);
    const value = document.createElement("td");
    value.className = "fl-mono";
    value.textContent = String(entry.constant);
    row.append(name, value);
    body.append(row);
  }
}

function fillMessages(messages) {
  messageBody.replaceChildren();
  if (messages.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 2;
    cell.textContent = "Нет сообщений";
    row.append(cell);
    messageBody.append(row);
    return;
  }
  for (const message of messages) {
    const row = document.createElement("tr");
    const type = document.createElement("th");
    type.scope = "row";
    type.textContent = message.type;
    const delivery = document.createElement("td");
    delivery.className = "fl-mono";
    delivery.textContent = String(message.deliveryTick);
    row.append(type, delivery);
    messageBody.append(row);
  }
}

function showDiagnostic(item) {
  diagnostic.replaceChildren();
  if (!item) return;
  const notice = document.createElement("div");
  notice.className = "fl-notice fl-notice--error";
  const icon = errorIcon.content.cloneNode(true);
  const body = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = "Ошибка сценария";
  const meta = document.createElement("p");
  meta.className = "fl-notice__meta";
  const parts = [`код ${item.code}`];
  if (item.deviceId !== "") parts.push(`блок ${item.deviceId}`);
  if (item.tick !== "") parts.push(`тик ${item.tick}`);
  meta.textContent = parts.join(" · ");
  const message = document.createElement("p");
  message.textContent = item.message;
  body.append(title, meta, message);
  if (item.location !== "") {
    const place = document.createElement("p");
    place.className = "fl-muted fl-mono";
    place.textContent = item.location;
    body.append(place);
  }
  notice.append(icon, body);
  diagnostic.append(notice);
}

function render() {
  const view = session.view();
  status.dataset.status = view.status;
  status.className = view.status === "failed"
    ? "fl-badge fl-badge--error"
    : view.status === "ready"
      ? "fl-badge fl-badge--success"
      : view.status === "paused"
        ? "fl-badge fl-badge--accent"
        : "fl-badge";
  statusText.textContent = STATUS_TEXT[view.status] ?? view.status;
  tickValue.textContent = view.tick === null ? "—" : String(view.tick);
  const revision = view.revision === 0 ? "—" : String(view.revision);
  const runId = view.runId === null ? "—" : String(view.runId);
  runMeta.textContent = `Ревизия сценария ${revision} · прогон ${runId}. Лимит исполнителя не меняет номер тика.`;
  className.textContent = view.className === "" ? "—" : view.className;
  editStatus.textContent = view.dirty ? "Изменено · нужен новый прогон" : STATUS_TEXT[view.status] ?? view.status;
  toolbar.setAttribute("aria-busy", view.status === "busy" ? "true" : "false");
  checkButton.disabled = !view.canCheck;
  stepButton.disabled = !view.canStep;
  resetButton.disabled = !view.canReset;
  stopButton.disabled = !view.canStop;
  rememberButton.disabled = !view.canRemember;
  restoreButton.disabled = !view.canRestore;
  snapshotSummary.textContent = view.rememberedTick === null
    ? "Снимок ещё не запомнен."
    : `Запомнен тик ${view.rememberedTick}. Восстановление не вызывает init.`;
  fillSignals(redBody, view.red);
  fillSignals(greenBody, view.green);
  fillMessages(view.messages);
  deviceState.textContent = view.state === null ? "—" : JSON.stringify(view.state, null, 2);
  showDiagnostic(view.diagnostic);
}

function formInput() {
  return {
    source: source.value,
    everyTick: everyTick.checked,
    inputChanged: inputChanged.checked,
    stateText: stateJson.value,
    timeoutMs: Number(timeout.value),
  };
}

async function run(start) {
  let pending;
  try {
    pending = start();
  } catch (error) {
    render();
    throw error;
  }
  render();
  try {
    const result = await pending;
    render();
    return result;
  } catch (error) {
    render();
    throw error;
  }
}

function launch(start) {
  run(start).catch(() => {});
}

function wireTabs() {
  const tabs = [...document.querySelectorAll("#editor-panel [role='tab']")];
  function select(tab, focus) {
    for (const item of tabs) {
      const active = item === tab;
      item.setAttribute("aria-selected", String(active));
      item.tabIndex = active ? 0 : -1;
      document.getElementById(item.getAttribute("aria-controls")).hidden = !active;
    }
    if (focus) tab.focus();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => select(tab, false));
    tab.addEventListener("keydown", (event) => {
      let next;
      if (event.key === "ArrowRight") next = tabs[(index + 1) % tabs.length];
      if (event.key === "ArrowLeft") next = tabs[(index + tabs.length - 1) % tabs.length];
      if (event.key === "Home") next = tabs[0];
      if (event.key === "End") next = tabs.at(-1);
      if (!next) return;
      event.preventDefault();
      select(next, true);
    });
  });
}

source.addEventListener("input", () => {
  syncGutter();
  session.noteEdit();
  render();
});
mountCaretComplete(source, {
  suggest(selectionStart, selectionEnd) {
    return eventCompletion(source.value, selectionStart, selectionEnd);
  },
  commit(item, suggestion) {
    const anchor = suggestion.anchor;
    if (source.selectionStart !== anchor.selectionStart || source.selectionEnd !== anchor.selectionEnd) {
      return { applied: false, reason: "stale" };
    }
    if (source.value.slice(anchor.range.start, anchor.range.end) !== anchor.slice) {
      return { applied: false, reason: "stale" };
    }
    const now = eventCompletion(source.value, anchor.selectionStart, anchor.selectionEnd);
    if (now.context.kind !== anchor.kind) return { applied: false, reason: "stale" };
    const token = item.value ?? item.name;
    source.focus();
    source.setSelectionRange(anchor.range.start, anchor.range.end);
    const inserted = document.execCommand("insertText", false, token);
    if (!inserted) source.setRangeText(token, anchor.range.start, anchor.range.end, "end");
    return { applied: true, text: token };
  },
});
source.addEventListener("scroll", () => {
  gutter.scrollTop = source.scrollTop;
});
for (const field of [everyTick, inputChanged, stateJson]) {
  field.addEventListener("input", () => {
    session.noteEdit();
    render();
  });
}
timeout.addEventListener("input", () => {
  const value = Number(timeout.value);
  if (!Number.isSafeInteger(value) || value < 1) return;
  session.setTimeoutMs(value);
});
checkButton.addEventListener("click", () => launch(() => session.check(formInput())));
stepButton.addEventListener("click", () => launch(() => session.step()));
resetButton.addEventListener("click", () => launch(() => session.reset()));
stopButton.addEventListener("click", () => launch(() => session.stop()));
document.querySelector("#ui-ping").addEventListener("click", () => {
  alive.textContent = "Интерфейс: alive";
});
openSnapshot.addEventListener("click", () => {
  dialog.showModal();
});
dialog.addEventListener("close", () => {
  const active = document.activeElement;
  if (active === document.body || active === dialog || !active) openSnapshot.focus();
});
rememberButton.addEventListener("click", () => launch(() => Promise.resolve(session.remember())));
restoreButton.addEventListener("click", () => launch(() => session.restore()));

wireTabs();
codePaint = mountCodePaint(source, paintJavaScript, gutter);
syncGutter();
render();

window.__eventPage = {
  check: () => run(() => session.check(formInput())),
  step: () => run(() => session.step()),
  reset: () => run(() => session.reset()),
  stop: () => run(() => session.stop()),
  remember: () => run(() => Promise.resolve(session.remember())),
  restore: () => run(() => session.restore()),
  view: () => session.view(),
};
