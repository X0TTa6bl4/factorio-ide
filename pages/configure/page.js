/** Редактор обычных комбинаторов: код, общий playback и сигналы сетей. */

import { CONFIGURATION_EXAMPLE, createConfigurationEditor } from "../../src/config-editor.js";
import { nestAtCaret } from "../../src/config-completion.js";
import { mountCaretComplete } from "../caret-complete.js";
import { mountCodePaint, paintConfiguration } from "../code-paint.js";
import { createPlayback } from "../debugger/playback.js";
import { mountAbout } from "../release.js";
const DRAFT_KEY = "f-logic.editor-draft.v1";
mountAbout();

const editor = createConfigurationEditor(readDraft() === null ? {} : { text: readDraft() });
const source = document.querySelector("#document");
const gutter = document.querySelector("#gutter");
const documentState = document.querySelector("#document-state");
const toolbar = document.querySelector("#toolbar");
const tickValue = document.querySelector("#tick-value");
const playButton = document.querySelector("#play");
const playLabel = document.querySelector("#play-label");
const stepButton = document.querySelector("#step");
const backButton = document.querySelector("#back");
const resetButton = document.querySelector("#reset");
const undoButton = document.querySelector("#undo");
const redoButton = document.querySelector("#redo");
const undoTip = document.querySelector("#undo-tip");
const redoTip = document.querySelector("#redo-tip");
const speed = document.querySelector("#speed");
const errorJump = document.querySelector("#error-jump");
const staleNote = document.querySelector("#stale-note");
const diagnostics = document.querySelector("#diagnostics");
const liveSignals = document.querySelector("#live-signals");
const signalFilter = document.querySelector("#signal-filter");
const signalPanel = document.querySelector("#signal-panel");

let writing = false;
let inputCaret = null;
let playbackError = "";
let codePaint = () => {};
source.value = editor.text;

const playback = createPlayback({
  perform,
  schedule(delay, fn) {
    const id = setTimeout(() => {
      fn();
    }, delay);
    return { cancel() { clearTimeout(id); } };
  },
  interval: () => Number(speed.value) || 1000,
  onChange: render,
});

function readDraft() {
  try {
    return sessionStorage.getItem(DRAFT_KEY);
  } catch {
    return null;
  }
}

function storeDraft(text) {
  try {
    sessionStorage.setItem(DRAFT_KEY, text);
    return true;
  } catch {
    return false;
  }
}

function forgetDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* хранилище вкладки недоступно */
  }
}

function colorLabel(color) {
  if (color === "red") return "красная";
  if (color === "green") return "зелёная";
  return color || "без цвета";
}

function revealInspectorSection(section) {
  const inspector = section?.closest(".fl-editor-inspector");
  if (!section || !inspector) return;
  const sectionBox = section.getBoundingClientRect();
  const frame = inspector.getBoundingClientRect();
  if (sectionBox.top < frame.top - 1 || sectionBox.bottom > frame.bottom + 1) {
    inspector.scrollTop += sectionBox.top - frame.top;
  }
}

function openPanel(id) {
  const body = document.getElementById(id);
  const button = document.querySelector(`[aria-controls="${id}"]`);
  if (button) button.setAttribute("aria-expanded", "true");
  if (body) body.hidden = false;
  revealInspectorSection(body?.closest("section"));
}

function stopPlayback() {
  playback.pause();
  playback.clearFailure();
}

function revealRange(range) {
  const start = Math.max(0, range?.start ?? 0);
  const end = Math.max(start, Math.min(source.value.length, range?.end ?? start));
  source.focus();
  source.setSelectionRange(start, end);
  const line = source.value.slice(0, start).split("\n").length;
  source.scrollTop = Math.max(0, (line - 3) * 22);
}

function renderLines() {
  const count = editor.text.split("\n").length;
  gutter.textContent = Array.from({ length: count }, (_, index) => String(index + 1).padStart(2, "0")).join("\n");
  codePaint(editor.diagnostics);
}

function cell(tag, text) {
  const item = document.createElement(tag);
  item.textContent = text;
  return item;
}

function noteRow(text) {
  const row = document.createElement("tr");
  const item = document.createElement("td");
  item.colSpan = 3;
  item.textContent = text;
  row.append(item);
  return row;
}

function renderSignals(bundle, runState) {
  liveSignals.replaceChildren();
  signalPanel.dataset.run = runState;
  if (!bundle) {
    liveSignals.append(noteRow("Нет прогона"));
    return;
  }
  const filter = signalFilter.value.trim().toLowerCase();
  let shown = 0;
  for (const network of bundle.networks) {
    const nameMatch = network.name.toLowerCase().includes(filter);
    const signals = network.signals.filter((signal) => !filter || nameMatch || signal.name.toLowerCase().includes(filter));
    if (filter && signals.length === 0 && !nameMatch) continue;
    const label = `${network.name} · ${colorLabel(network.color)}`;
    if (signals.length === 0) {
      const row = document.createElement("tr");
      row.dataset.network = network.name;
      row.dataset.color = network.color || "";
      row.dataset.empty = "true";
      row.dataset.run = runState;
      row.dataset.tick = String(bundle.tick);
      const name = cell("th", label);
      name.scope = "row";
      row.append(name, cell("td", "пусто"), cell("td", "—"));
      liveSignals.append(row);
      shown += 1;
      continue;
    }
    for (const signal of signals) {
      const row = document.createElement("tr");
      row.dataset.network = network.name;
      row.dataset.color = network.color || "";
      row.dataset.signal = signal.name;
      row.dataset.value = String(signal.constant);
      row.dataset.run = runState;
      row.dataset.tick = String(bundle.tick);
      const name = cell("th", label);
      name.scope = "row";
      row.append(name, cell("td", signal.name), cell("td", String(signal.constant)));
      liveSignals.append(row);
      shown += 1;
    }
  }
  if (shown === 0) liveSignals.append(noteRow(filter ? "Нет сигналов по фильтру" : "Нет сетей"));
}

function renderDiagnostics(items) {
  diagnostics.replaceChildren();
  errorJump.hidden = items.length === 0;
  errorJump.textContent = items.length === 0 ? "" : `Ошибка: ${items[0].code}`;
  if (items.length === 0) {
    const note = document.createElement("p");
    note.className = "fl-muted";
    note.textContent = playbackError || "Ошибок нет.";
    diagnostics.append(note);
    return;
  }
  for (const item of items) {
    const notice = document.createElement("div");
    notice.className = "fl-notice fl-notice--error";
    notice.dataset.code = item.code;
    notice.dataset.field = item.field ?? "";
    notice.dataset.expected = item.expected ?? "";
    const title = document.createElement("h3");
    title.textContent = item.field || "Документ";
    const expected = document.createElement("p");
    expected.textContent = item.expected ? `Ожидается ${item.expected}. ${item.message}` : item.message;
    const jump = document.createElement("button");
    jump.type = "button";
    jump.className = "fl-button";
    jump.dataset.jump = "true";
    jump.textContent = "К месту";
    jump.addEventListener("click", () => revealRange(item.range));
    notice.append(title, expected, jump);
    diagnostics.append(notice);
  }
}

function render() {
  const view = editor.view();
  if (document.activeElement !== source && source.value !== view.text) source.value = view.text;
  renderLines();
  documentState.textContent = view.diagnostics.length === 0 ? "Разбор выполнен" : "Есть диагностика";
  const publication = view.publication;
  const runnable = view.canLaunch && playback.mode !== "failed";
  playButton.disabled = playback.mode === "running" ? false : !view.canLaunch;
  playButton.setAttribute("aria-pressed", playback.mode === "running" ? "true" : "false");
  playLabel.textContent = playback.mode === "running" ? "Пауза" : "Запустить";
  stepButton.disabled = !runnable || playback.mode === "running" || Boolean(playback.pending);
  backButton.disabled = !view.canStepBack || playback.mode !== "paused" || Boolean(playback.pending);
  resetButton.disabled = !view.canLaunch || Boolean(playback.pending);
  undoButton.disabled = !editor.canUndo;
  redoButton.disabled = !editor.canRedo;
  toolbar.dataset.playback = playback.mode;
  toolbar.setAttribute("aria-busy", playback.pending ? "true" : "false");
  tickValue.textContent = publication ? String(publication.tick) : "—";
  tickValue.dataset.current = publication ? "true" : "false";
  if (publication) renderSignals(publication, "current");
  else if (view.staleRun) renderSignals(view.staleRun, "stale");
  else renderSignals(null, "none");
  staleNote.hidden = !view.staleRun || Boolean(publication);
  staleNote.textContent = view.staleRun
    ? `Старый прогон, ревизия ${view.staleRun.revision ?? "—"}, тик ${view.staleRun.tick}. Это не текущий текст.`
    : "";

  renderDiagnostics(view.diagnostics);
}

function rejectPerform(message) {
  playbackError = message;
  const error = new Error(message);
  error.code = "rejected";
  throw error;
}

async function perform() {
  playbackError = "";
  if (!editor.view().publication) {
    const launched = await editor.launch();
    if (!launched.applied) rejectPerform(launched.diagnostics?.[0]?.message || "Запуск не выполнен");
    return;
  }
  try {
    const stepped = await editor.step();
    if (!stepped.applied) rejectPerform(stepped.diagnostics?.[0]?.message || "Шаг не выполнен");
  } catch (error) {
    if (error?.code === "rejected") throw error;
    playbackError = error instanceof Error ? error.message : "Шаг не выполнен";
    throw error;
  }
}

function leaveEditor(event) {
  if (storeDraft(editor.text)) return;
  const previous = readDraft();
  if (editor.text === previous || (editor.text === CONFIGURATION_EXAMPLE && previous === null)) return;
  const leave = window.confirm("Не удалось сохранить черновик. Уйти и потерять несохранённый текст?");
  if (!leave) event.preventDefault();
}

signalFilter.addEventListener("input", render);
source.addEventListener("keydown", (event) => {
  if (!formatShortcut(event)) return;
  event.preventDefault();
  formatDocument();
});

source.addEventListener("beforeinput", (event) => {
  if (event.inputType === "historyUndo" || event.inputType === "historyRedo") {
    event.preventDefault();
    return;
  }
  if (event.isComposing) return;
  inputCaret = { start: source.selectionStart, end: source.selectionEnd };
});

source.addEventListener("input", (event) => {
  if (writing) return;
  if ((event.data === "{" || event.data === "[") && event.inputType === "insertText") {
    const edit = nestAtCaret(source.value, source.selectionStart, event.data);
    if (edit) {
      writing = true;
      source.value = source.value.slice(0, edit.range.start) + edit.text + source.value.slice(edit.range.end);
      source.setSelectionRange(edit.caret, edit.caret);
      writing = false;
    }
  }
  stopPlayback();
  const pending = playback.pending;
  const before = inputCaret;
  const after = { start: source.selectionStart, end: source.selectionEnd };
  inputCaret = null;
  const commit = () => {
    editor.replace(source.value, { before, after });
    storeDraft(editor.text);
    render();
  };
  if (pending) pending.then(commit, commit);
  else commit();
});

playButton.addEventListener("click", () => {
  if (playback.mode === "running") {
    playback.pause();
    render();
    return;
  }
  playback.clearFailure();
  playback.start().catch((error) => {
    playbackError = error instanceof Error ? error.message : "Запуск остановлен";
  }).finally(render);
});

stepButton.addEventListener("click", async () => {
  if (playback.mode === "running") return;
  playback.clearFailure();
  try {
    if (!editor.view().publication) {
      await editor.launch();
    } else {
      await playback.step();
    }
  } catch (error) {
    playbackError = error instanceof Error ? error.message : "Шаг не выполнен";
  }
  render();
});

backButton.addEventListener("click", async () => {
  const outcome = await editor.back();
  playbackError = outcome.applied ? "" : (outcome.message || "");
  render();
});

resetButton.addEventListener("click", async () => {
  stopPlayback();
  if (playback.pending) await playback.pending.catch(() => {});
  await editor.reset();
  playbackError = "";
  render();
});

undoButton.addEventListener("click", () => applyHistory("undo"));
redoButton.addEventListener("click", () => applyHistory("redo"));

document.addEventListener("keydown", (event) => {
  const action = historyAction(event);
  if (!action || keepsLocalHistory(document.activeElement)) return;
  event.preventDefault();
  applyHistory(action);
});

if (usesMacShortcut()) {
  undoTip.textContent = "Отменить правку · ⌘Z";
  redoTip.textContent = "Повторить правку · ⇧⌘Z";
}

function usesMacShortcut() {
  const platform = navigator.userAgentData?.platform ?? navigator.platform ?? "";
  return /mac/i.test(platform) || /Mac OS X/i.test(navigator.userAgent);
}

function historyAction(event) {
  if (event.isComposing || event.keyCode === 229 || event.altKey) return null;
  const key = typeof event.key === "string" && event.key.length === 1 ? event.key.toLowerCase() : "";
  const undoKey = event.code === "KeyZ" || key === "z" || key === "я";
  const redoKey = event.code === "KeyY" || key === "y" || key === "н";
  if (usesMacShortcut()) {
    if (!event.metaKey || event.ctrlKey) return null;
    if (undoKey && event.shiftKey) return "redo";
    if (undoKey && !event.shiftKey) return "undo";
    return null;
  }
  if (!event.ctrlKey || event.metaKey) return null;
  if (undoKey && event.shiftKey) return "redo";
  if (undoKey && !event.shiftKey) return "undo";
  if (redoKey && !event.shiftKey) return "redo";
  return null;
}

function keepsLocalHistory(node) {
  if (!node || node === source) return false;
  if (node.isContentEditable) return true;
  const tag = node.tagName;
  if (tag === "TEXTAREA") return !node.disabled && !node.readOnly;
  if (tag !== "INPUT") return false;
  const type = (node.type || "text").toLowerCase();
  const textual = ["text", "search", "url", "tel", "email", "password", "number"].includes(type);
  return textual && !node.disabled && !node.readOnly;
}

function applyHistory(action) {
  const available = action === "redo" ? editor.canRedo : editor.canUndo;
  if (!available) return;
  stopPlayback();
  restoreHistory(action === "redo" ? editor.redo() : editor.undo());
}

function formatShortcut(event) {
  const letter = event.code === "KeyL" || event.key.toLowerCase() === "l";
  if (!letter || event.shiftKey || event.repeat) return false;
  if (usesMacShortcut()) return event.metaKey && event.altKey && !event.ctrlKey;
  return event.ctrlKey && event.altKey && !event.metaKey;
}

function formatDocument() {
  stopPlayback();
  const scroll = source.scrollTop;
  const beforeLine = source.value.slice(0, source.selectionStart).split("\n").length;
  const line = Number.parseFloat(getComputedStyle(source).lineHeight) || 22;
  const outcome = editor.format({ start: source.selectionStart, end: source.selectionEnd });
  if (!outcome.applied) {
    render();
    return;
  }
  const cursor = outcome.cursor ?? { start: 0, end: 0 };
  writing = true;
  source.value = editor.text;
  placeCaret(cursor);
  writing = false;
  storeDraft(editor.text);
  render();
  placeCaret(cursor);
  const afterLine = source.value.slice(0, cursor.start).split("\n").length;
  const max = Math.max(0, source.scrollHeight - source.clientHeight);
  source.scrollTop = Math.min(max, Math.max(0, scroll + (afterLine - beforeLine) * line));
}

function restoreHistory(outcome) {
  storeDraft(editor.text);
  writing = true;
  source.focus();
  if (source.value !== editor.text) source.value = editor.text;
  placeCaret(outcome?.cursor);
  writing = false;
  codePaint();
  render();
  placeCaret(outcome?.cursor);
}

function placeCaret(cursor) {
  if (!cursor || !Number.isInteger(cursor.start) || !Number.isInteger(cursor.end)) return;
  const end = Math.min(source.value.length, Math.max(cursor.start, cursor.end));
  const start = Math.min(end, Math.max(0, cursor.start));
  source.setSelectionRange(start, end);
}

errorJump.addEventListener("click", () => {
  openPanel("diagnostics-panel");
  const first = editor.diagnostics[0];
  if (first) revealRange(first.range);
});

document.querySelector("#new-draft").addEventListener("click", () => {
  if (editor.text !== CONFIGURATION_EXAMPLE) {
    const replace = window.confirm("Заменить текущий текст примером? Черновик этой вкладки будет забыт.");
    if (!replace) return;
  }
  stopPlayback();
  forgetDraft();
  editor.replace(CONFIGURATION_EXAMPLE);
  if (source.value !== editor.text) source.value = editor.text;
  storeDraft(editor.text);
  render();
});

document.querySelectorAll("a[href]").forEach((link) => {
  link.addEventListener("click", leaveEditor);
});
window.addEventListener("pagehide", () => {
  storeDraft(editor.text);
});

mountCaretComplete(source, {
  suggest(selectionStart, selectionEnd) {
    return editor.suggestions({
      offset: selectionStart,
      selectionEnd,
      revision: editor.revision,
    });
  },
  finish(reason, area) {
    if (area.value !== editor.text) return { applied: false, reason: "stale", handled: reason === "tab" };
    const listed = editor.suggestions({
      offset: area.selectionStart,
      selectionEnd: area.selectionEnd,
      revision: editor.revision,
    });
    if (!listed.applied || listed.context?.kind !== "network") {
      return { applied: false, handled: false };
    }
    const outcome = editor.finishNetwork({
      revision: listed.revision,
      color: listed.context.color,
      name: listed.context.slice,
      range: listed.context.range,
      anchor: listed.anchor,
      selectionStart: area.selectionStart,
      selectionEnd: area.selectionEnd,
      tab: reason === "tab",
    });
    if (outcome.applied) {
      const cursor = outcome.cursor ?? listed.context.range.start + outcome.text.length;
      stopPlayback();
      writing = true;
      area.value = editor.text;
      area.setSelectionRange(cursor, cursor);
      writing = false;
      storeDraft(editor.text);
      codePaint();
      render();
    }
    return { applied: outcome.applied === true, handled: reason === "tab", reason: outcome.reason };
  },
  insertTab(area) {
    if (area.value !== editor.text) {
      stopPlayback();
      editor.replace(area.value);
    }
    const outcome = editor.replaceRange(
      { start: area.selectionStart, end: area.selectionEnd },
      "\t",
    );
    if (!outcome.applied) return;
    stopPlayback();
    writing = true;
    area.value = editor.text;
    const cursor = outcome.cursor ?? { start: area.value.length, end: area.value.length };
    area.setSelectionRange(cursor.start, cursor.end);
    writing = false;
    storeDraft(editor.text);
    codePaint();
    render();
  },
  commit(item, suggestion) {
    if (source.value !== editor.text) {
      stopPlayback();
      editor.replace(source.value);
      storeDraft(editor.text);
      render();
      return { applied: false, reason: "stale" };
    }
    const token = item.value ?? item.name;
    const outcome = editor.applySuggestion({
      revision: suggestion.revision,
      kind: suggestionKind(item),
      choice: suggestionChoice(item),
      name: token,
      color: suggestion.context.color,
      range: suggestion.context.range,
      use: suggestionUse(item, token),
      leaf: item.leaf,
      anchor: suggestion.anchor,
      selectionStart: source.selectionStart,
      selectionEnd: source.selectionEnd,
    });
    if (!outcome.applied) return outcome;
    const cursor = Number.isInteger(outcome.cursor)
      ? outcome.cursor
      : suggestion.context.range.start + outcome.text.length;
    stopPlayback();
    writing = true;
    source.value = editor.text;
    source.setSelectionRange(cursor, cursor);
    writing = false;
    storeDraft(editor.text);
    codePaint();
    render();
    return { ...outcome, reopen: outcome.reopen === true };
  },
});

codePaint = mountCodePaint(source, paintConfiguration, gutter);
render();

function suggestionChoice(item) {
  if (item.kind === "new") return "new";
  if (item.kind === "create") return "create";
  if (item.kind === "null") return "null";
  if (item.kind === "network") return "network";
  return "item";
}

function suggestionKind(item) {
  if (item.kind === "new" || item.kind === "create" || item.kind === "null") return "network";
  return item.kind;
}

function suggestionUse(item, token = item.value ?? item.name) {
  if (item.kind === "signal") return `signal:${token}`;
  if (item.kind === "operation") return `operation:${token}`;
  if (item.kind === "quality") {
    const name = token.startsWith("Quality.") ? token.slice("Quality.".length) : token;
    return `quality:${name}`;
  }
  if (item.kind === "type") return `type:${token}`;
  if (item.kind === "key") return `key:${token}`;
  if (item.kind === "boolean") return `boolean:${token}`;
  if (item.kind === "peer" || item.kind === "group") return `device:${token}`;
  return undefined;
}
