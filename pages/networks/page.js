/** Страница сетей: подсказки и транзакции редактора, шаг — тот же runtime. */

import { createNetworkEditor } from "../../src/network-editor.js";
import { networkFinishChoice } from "../../src/network-document.js";
import { ConfigError } from "../../src/errors.js";
import { mountCodePaint, paintConfiguration } from "../code-paint.js";
import { mountAbout } from "../release.js";
import { setSelectOptions } from "../../ui/scripts/widgets.js";
import { createPlayback } from "../debugger/playback.js";

const STATUS_TEXT = {
  editing: "Черновик",
  invalid: "Ошибка",
  ready: "Готово",
  running: "Идёт",
  failed: "Ошибка",
};

mountAbout();
let codePaint = () => {};

const editor = createNetworkEditor();
const toolbar = document.querySelector("#toolbar");
const launchButton = document.querySelector("#launch");
const playButton = document.querySelector("#play");
const playLabel = document.querySelector("#play-label");
const stepButton = document.querySelector("#step");
const resetButton = document.querySelector("#reset");
const undoButton = document.querySelector("#undo");
const redoButton = document.querySelector("#redo");
const status = document.querySelector("#run-status");
const statusText = document.querySelector("#run-status-text");
const revision = document.querySelector("#revision");
const tickValue = document.querySelector("#tick-value");
const networkSelect = document.querySelector("#network");
const renameButton = document.querySelector("#rename");
const removeButton = document.querySelector("#remove");
const networkList = document.querySelector("#network-list");
const portList = document.querySelector("#port-list");
const portSelect = document.querySelector("#port");
const pickerPort = document.querySelector("#picker-port");
const query = document.querySelector("#network-query");
const results = document.querySelector("#network-results");
const networkError = document.querySelector("#network-error");
const source = document.querySelector("#document");
const gutter = document.querySelector("#gutter");
const documentState = document.querySelector("#document-state");
const liveSignals = document.querySelector("#live-signals");
const retainedNote = document.querySelector("#retained");
const diagnostics = document.querySelector("#diagnostics");
const renameDialog = document.querySelector("#rename-dialog");
const renameName = document.querySelector("#rename-name");
const renameError = document.querySelector("#rename-error");
const removeDialog = document.querySelector("#remove-dialog");
const removeText = document.querySelector("#remove-text");

source.value = editor.text;
let networkQuerySettled = false;
let networkPointerInList = false;

const playback = createPlayback({
  perform,
  schedule(delay, fn) {
    const id = setTimeout(() => {
      fn();
    }, delay);
    return { cancel() { clearTimeout(id); } };
  },
  interval: () => 100,
  onChange: render,
});

function selectedNetwork() {
  return networkSelect.value || null;
}

function selectedPort() {
  const [device, field] = (portSelect.value || "").split(".");
  if (!device || !field) return null;
  return editor.ports().find((port) => port.device === device && port.field === field) ?? null;
}

function portDiagnostic(port) {
  if (!port) return null;
  return editor.diagnostics.find((item) => item.device === port.device && item.field === port.field) ?? null;
}

function stopPlayback() {
  playback.pause();
  playback.clearFailure();
}

function syncText() {
  if (source.value !== editor.text) source.value = editor.text;
}

function option(value, label) {
  const item = document.createElement("option");
  item.value = value;
  item.textContent = label;
  return item;
}

function emptyRow(text) {
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = 3;
  cell.textContent = text;
  row.append(cell);
  return row;
}

function chip(port) {
  const item = document.createElement("span");
  const invalid = portDiagnostic(port);
  item.className = port.color === "red" ? "fl-port fl-red" : "fl-port fl-green";
  item.dataset.port = `${port.device}.${port.field}`;
  item.dataset.invalid = invalid ? "true" : "false";
  const network = editor.index().entries.find((entry) => entry.name === port.text);
  item.dataset.networkId = network ? network.id : "";
  item.textContent = `${port.field} · ${port.text}`;
  return item;
}

function fillSelect(select, values, current) {
  setSelectOptions(select, values.map((item) => ({
    value: item.value,
    label: item.textContent,
  })), current ?? "");
}

function renderSuggestions(port) {
  results.replaceChildren();
  if (!port || !editor.view().ports.length) return;
  const listed = editor.suggestions({ color: port.color, query: query.value, revision: editor.revision });
  listed.items.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = item.kind === "new" || item.kind === "create"
      ? "fl-completion__option fl-completion__option--new"
      : "fl-completion__option";
    button.dataset.choice = item.kind;
    button.dataset.name = item.name;
    button.setAttribute("role", "option");
    button.id = `suggestion-${index}`;
    const label = document.createElement("span");
    label.textContent = item.kind === "new" || item.kind === "create" ? `+ ${item.name}` : item.name;
    const note = document.createElement("span");
    note.className = "fl-muted";
    note.textContent = item.kind === "new"
      ? "Новая сеть"
      : item.kind === "create"
        ? "Создать"
        : item.kind === "null"
          ? "Не подключено"
          : item.id ?? "";
    button.append(label, note);
    button.addEventListener("click", () => applyChoice(port, item));
    results.append(button);
  });
}

function render() {
  const view = editor.view();
  const mode = playback.mode === "running" ? "running" : playback.mode === "failed" ? "failed" : view.status;
  status.dataset.status = mode;
  statusText.textContent = STATUS_TEXT[mode] ?? mode;
  revision.textContent = String(view.revision);
  tickValue.textContent = view.publication ? String(view.publication.tick) : "—";
  tickValue.dataset.current = view.current ? "true" : "false";
  tickValue.dataset.steps = view.publication ? String(view.publication.tick) : "0";
  toolbar.dataset.playback = playback.mode;
  playButton.setAttribute("aria-pressed", playback.mode === "running" ? "true" : "false");
  playLabel.textContent = playback.mode === "running" ? "Пауза" : "Просмотр";
  const runnable = view.canLaunch || view.publication !== null;
  launchButton.disabled = !view.canLaunch;
  playButton.disabled = !runnable;
  stepButton.disabled = !runnable || playback.mode === "running";
  undoButton.disabled = !editor.canUndo;
  redoButton.disabled = !editor.canRedo;
  documentState.textContent = view.canLaunch ? "Разбор выполнен" : "Запуск заблокирован";

  const lines = source.value.split("\n").length;
  gutter.textContent = Array.from({ length: lines }, (_, index) => String(index + 1).padStart(2, "0")).join("\n");
  codePaint();

  const networkValue = selectedNetwork();
  fillSelect(
    networkSelect,
    view.index.entries.map((entry) => option(entry.name, `${entry.name} · ${entry.id}`)),
    networkValue,
  );
  renameButton.disabled = !selectedNetwork();
  removeButton.disabled = !selectedNetwork();
  networkList.replaceChildren();
  for (const entry of view.index.entries) {
    const row = document.createElement("p");
    row.className = "fl-field__hint";
    row.dataset.network = entry.name;
    row.dataset.id = entry.id;
    row.textContent = `${entry.name} · ${entry.id} · MRU ${entry.mru} · ссылок ${entry.uses.length}`;
    networkList.append(row);
  }
  if (view.index.entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "fl-field__hint";
    empty.textContent = "Сетей нет";
    networkList.append(empty);
  }

  portList.replaceChildren(...view.ports.map(chip));
  const portValue = portSelect.value;
  fillSelect(
    portSelect,
    view.ports.map((port) => option(`${port.device}.${port.field}`, `${port.device}.${port.field}`)),
    portValue,
  );
  const port = selectedPort();
  pickerPort.textContent = port ? port.field : "нет порта";
  query.disabled = !port;
  const problem = portDiagnostic(port);
  query.setAttribute("aria-invalid", problem ? "true" : "false");
  networkError.hidden = !problem;
  networkError.textContent = problem ? `${problem.field}: ${problem.message}` : "";
  renderSuggestions(port);

  liveSignals.replaceChildren();
  if (!view.publication) {
    liveSignals.append(emptyRow("Нет текущего прогона"));
  } else if (view.publication.networks.every((network) => network.signals.length === 0)) {
    liveSignals.append(emptyRow("Нет сигналов"));
  } else {
    for (const network of view.publication.networks) {
      for (const signal of network.signals) {
        const row = document.createElement("tr");
        row.dataset.network = network.name;
        row.dataset.signal = signal.name;
        row.dataset.value = String(signal.constant);
        const name = document.createElement("th");
        name.scope = "row";
        name.textContent = `${network.name} · ${network.id}`;
        const signalCell = document.createElement("td");
        signalCell.textContent = signal.name;
        const valueCell = document.createElement("td");
        valueCell.className = "fl-mono";
        valueCell.textContent = String(signal.constant);
        row.append(name, signalCell, valueCell);
        liveSignals.append(row);
      }
    }
  }

  const held = view.retained;
  retainedNote.hidden = !held || held.matchesText;
  retainedNote.textContent = held && !held.matchesText
    ? `Последняя корректная схема: ${held.networks.map((network) => `${network.name} ${network.id}`).join(", ") || "без сетей"}. Это не текущий прогон.`
    : "";

  diagnostics.replaceChildren();
  if (view.diagnostics.length === 0) {
    const ok = document.createElement("p");
    ok.className = "fl-field__hint";
    ok.textContent = "Ошибок документа нет.";
    diagnostics.append(ok);
  } else {
    for (const item of view.diagnostics) {
      const notice = document.createElement("p");
      notice.className = "fl-error";
      notice.dataset.code = item.code;
      notice.dataset.field = item.field ?? "";
      notice.textContent = `${item.device ? `${item.device}.` : ""}${item.field ? `${item.field}: ` : ""}${item.message}`;
      diagnostics.append(notice);
    }
  }
}

async function perform() {
  if (!editor.publication()) {
    const launched = await editor.launch();
    if (!launched.applied) {
      const error = new Error("Запуск запрещён");
      error.code = "launch-blocked";
      throw error;
    }
    return;
  }
  const stepped = await editor.step();
  if (!stepped.applied) {
    const error = new Error("Шаг не применён");
    error.code = "stale";
    throw error;
  }
}

function applyDocument(text) {
  stopPlayback();
  editor.replace(text);
  syncText();
  render();
}

function applyChoice(port, item) {
  stopPlayback();
  const outcome = editor.applySuggestion({
    device: port.device,
    port: port.field,
    choice: item.kind,
    name: item.name,
    revision: editor.revision,
  });
  if (outcome.applied) query.value = outcome.name === "null" ? "" : outcome.name;
  syncText();
  render();
}

source.addEventListener("input", () => {
  stopPlayback();
  const pending = playback.pending;
  const commit = () => applyDocument(source.value);
  if (pending) pending.then(commit, commit);
  else commit();
});

query.addEventListener("input", () => {
  networkQuerySettled = false;
  render();
});
query.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") {
    const first = results.querySelector("button");
    if (!first) return;
    event.preventDefault();
    first.focus();
    return;
  }
  if (event.key === "Enter") {
    const port = selectedPort();
    const first = results.querySelector("button");
    if (!port || !first) return;
    event.preventDefault();
    networkQuerySettled = true;
    applyChoice(port, { kind: first.dataset.choice, name: first.dataset.name });
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    finishNetworkQuery();
    return;
  }
  if (event.key === "Tab" && !event.shiftKey) finishNetworkQuery();
});
results.addEventListener("pointerdown", () => {
  networkPointerInList = true;
});
query.addEventListener("blur", (event) => {
  const fromList = networkPointerInList || (event.relatedTarget && results.contains(event.relatedTarget));
  networkPointerInList = false;
  if (fromList) return;
  finishNetworkQuery();
});

portSelect.addEventListener("change", () => {
  const port = selectedPort();
  query.value = port && port.kind === "name" ? port.text : "";
  networkQuerySettled = false;
  render();
});

function finishNetworkQuery() {
  if (networkQuerySettled) return;
  const port = selectedPort();
  if (!port) return;
  const known = new Set(editor.index().entries.map((entry) => entry.name));
  const choice = networkFinishChoice(port.color, query.value, known);
  networkQuerySettled = true;
  if (!choice) return;
  if (choice.choice === "network" && port.text === choice.name) return;
  applyChoice(port, { kind: choice.choice, name: choice.name });
}

launchButton.addEventListener("click", async () => {
  stopPlayback();
  toolbar.setAttribute("aria-busy", "true");
  try {
    await editor.launch();
  } finally {
    toolbar.setAttribute("aria-busy", "false");
    render();
  }
});

playButton.addEventListener("click", () => {
  if (playback.mode === "running") {
    playback.pause();
    render();
    return;
  }
  playback.start().finally(render);
});

stepButton.addEventListener("click", () => {
  playback.step().finally(render);
});

resetButton.addEventListener("click", () => {
  stopPlayback();
  editor.resetRun();
  render();
});

undoButton.addEventListener("click", () => {
  stopPlayback();
  editor.undo();
  syncText();
  render();
});

redoButton.addEventListener("click", () => {
  stopPlayback();
  editor.redo();
  syncText();
  render();
});

renameButton.addEventListener("click", () => {
  const name = selectedNetwork();
  if (!name) return;
  renameName.value = name;
  renameError.hidden = true;
  renameDialog.showModal();
  renameName.focus();
});

function closeRename() {
  if (renameDialog.open) renameDialog.close("cancel");
}

renameDialog.querySelector("form").addEventListener("submit", (event) => {
  event.preventDefault();
  document.querySelector("#rename-confirm").click();
});
document.querySelector("#rename-cancel").addEventListener("click", closeRename);
document.querySelector("#rename-close").addEventListener("click", closeRename);
document.querySelector("#rename-confirm").addEventListener("click", () => {
  try {
    stopPlayback();
    editor.rename(selectedNetwork(), renameName.value.trim());
    renameError.hidden = true;
    renameDialog.close("rename");
    syncText();
    render();
  } catch (error) {
    renameError.hidden = false;
    renameError.textContent = error instanceof ConfigError ? error.message : "Имя не принято";
  }
});

removeButton.addEventListener("click", () => {
  const name = selectedNetwork();
  if (!name) return;
  const plan = editor.planRemoval(name);
  removeText.textContent = plan.uses.length === 0
    ? `${name} не используется. Удаление уберёт её из схемы.`
    : `${name} подключена к ${plan.uses.length} портам. Удаление снимет ссылки и не оставит висячих сетей.`;
  removeDialog.showModal();
});

function closeRemove() {
  editor.cancelRemoval();
  if (removeDialog.open) removeDialog.close("cancel");
}

removeDialog.querySelector("form").addEventListener("submit", (event) => {
  event.preventDefault();
});
document.querySelector("#remove-cancel").addEventListener("click", closeRemove);
document.querySelector("#remove-close").addEventListener("click", closeRemove);
document.querySelector("#remove-confirm").addEventListener("click", () => {
  stopPlayback();
  editor.commitRemoval(selectedNetwork());
  removeDialog.close("remove");
  syncText();
  render();
});

codePaint = mountCodePaint(source, paintConfiguration, gutter);
render();
