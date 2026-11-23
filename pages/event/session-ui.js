/** Сессия событийного сценария. Монтируется в свой документ и не ищет чужие id страницы. */

import { eventCompletion } from "../../src/event-complete.js";
import { createWorkerExecutor } from "../../src/event-host.js";
import { createEventScriptSession } from "../../src/event-script.js";
import { mountCaretComplete } from "../caret-complete.js";
import { mountCodePaint, paintJavaScript } from "../code-paint.js";
import { EVENT_DEMO } from "../release.js";

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

function required(root, name) {
  const element = root.querySelector(`[data-event-${name}]`);
  if (!element) throw new Error(`Нет [data-event-${name}] для сессии сценария`);
  return element;
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

export function mountEventSession(root, { paintNetworks, suggest = "caret" } = {}) {
  const source = required(root, "source");
  const gutter = required(root, "gutter");
  const stateJson = required(root, "state");
  const everyTick = required(root, "every");
  const inputChanged = required(root, "changed");
  const timeout = required(root, "timeout");
  const checkButton = required(root, "check");
  const stepButton = required(root, "step");
  const resetButton = required(root, "reset");
  const stopButton = required(root, "stop");
  const status = required(root, "status");
  const statusText = required(root, "status-text");
  const tickValue = required(root, "tick");
  const runMeta = required(root, "meta");
  const className = required(root, "class");
  const editorStatus = required(root, "editor-status");
  const editStatus = required(root, "edit-status");
  const diagnostic = required(root, "diagnostic");
  const diagnosticToggle = required(root, "diagnostic-toggle");
  const messageBody = required(root, "messages");
  const deviceState = required(root, "device-state");
  const alive = required(root, "alive");
  const ping = required(root, "ping");
  const rememberButton = required(root, "remember");
  const restoreButton = required(root, "restore");
  const snapshotSummary = required(root, "snapshot-summary");
  const dialog = required(root, "dialog");
  const openSnapshot = required(root, "open-snapshot");
  const errorIcon = required(root, "error-icon");
  const toolbar = required(root, "toolbar");
  const demoExpect = root.querySelector("[data-event-demo]");
  if (demoExpect) demoExpect.textContent = EVENT_DEMO.expect;

  let diagnosticOpen = false;
  source.value = INITIAL_SOURCE;

  let codePaint = () => {};

  function syncGutter() {
    const lines = source.value.split("\n");
    gutter.textContent = lines.map((_, index) => String(index + 1).padStart(2, "0")).join("\n");
    codePaint();
  }

  const session = createEventScriptSession({
    engineHref: sourceUrl.href,
    openExecutor,
  });

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
    diagnosticToggle.hidden = !item;
    if (!item) diagnosticOpen = false;
    diagnostic.hidden = !item || !diagnosticOpen;
    diagnosticToggle.setAttribute("aria-expanded", String(Boolean(item) && diagnosticOpen));
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
    const summary = view.diagnostic?.message ?? "";
    editStatus.textContent = summary !== ""
      ? summary
      : view.dirty
        ? "Изменено · нужен новый прогон"
        : STATUS_TEXT[view.status] ?? view.status;
    editorStatus.dataset.kind = summary !== "" ? "error" : "ok";
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
    fillMessages(view.messages);
    deviceState.textContent = view.state === null ? "—" : JSON.stringify(view.state, null, 2);
    showDiagnostic(view.diagnostic);
    paintNetworks?.(view);
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
  }, { suggest });
  for (const field of [everyTick, inputChanged, stateJson]) {
    field.addEventListener("input", () => {
      session.noteEdit();
      render();
    });
    field.addEventListener("change", () => {
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
  ping.addEventListener("click", () => {
    alive.textContent = "Интерфейс: alive";
  });
  diagnosticToggle.addEventListener("click", () => {
    diagnosticOpen = !diagnosticOpen;
    render();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !diagnosticOpen || dialog.open) return;
    if (document.activeElement !== diagnosticToggle && !diagnostic.contains(document.activeElement)) return;
    event.preventDefault();
    diagnosticOpen = false;
    render();
    diagnosticToggle.focus();
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

  codePaint = mountCodePaint(source, paintJavaScript, gutter);
  syncGutter();
  render();

  function isPristine() {
    return source.value === INITIAL_SOURCE
      && everyTick.checked
      && inputChanged.checked === false
      && stateJson.value === "{}"
      && timeout.value === "1000";
  }

  function resetDraft() {
    session.discard();
    source.value = INITIAL_SOURCE;
    everyTick.checked = true;
    inputChanged.checked = false;
    stateJson.value = "{}";
    timeout.value = "1000";
    diagnosticOpen = false;
    if (dialog.open) dialog.close();
    syncGutter();
    render();
  }

  return {
    source,
    isPristine,
    resetDraft,
    check: () => run(() => session.check(formInput())),
    step: () => run(() => session.step()),
    reset: () => run(() => session.reset()),
    stop: () => run(() => session.stop()),
    remember: () => run(() => Promise.resolve(session.remember())),
    restore: () => run(() => session.restore()),
    view: () => session.view(),
  };
}
