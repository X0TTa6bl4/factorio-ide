/** Страница схемы: локальное сохранение, импорт и экспорт без запуска сценария. */

import {
  createProjectSession,
  createProjectStore,
  draftProject,
  exampleProject,
} from "../../src/index.js";
import { mountWidgets, setSelectOptions } from "../../ui/scripts/widgets.js";

const host = document.querySelector("#project-host");
const response = await fetch(new URL("../../ui/components/project-file.html", import.meta.url));
if (!response.ok) throw new Error(`Фрагмент схемы: HTTP ${response.status}`);
host.innerHTML = await response.text();
mountWidgets(host);

const session = createProjectSession(exampleProject());
let recordId = null;
let sourceId = session.document.devices.find((item) => item.kind === "event")?.id ?? null;
let store = null;
try {
  store = createProjectStore(window.localStorage);
  store.list();
} catch (error) {
  report(error);
}

const nameInput = document.querySelector("#project-name");
const sourceInput = document.querySelector("#event-source");
const eventSelect = document.querySelector("#event-device");
const errorBox = document.querySelector("#project-error");
const statusBox = document.querySelector("#project-status");
const dialog = document.querySelector("#collision-dialog");
const saveButton = document.querySelector("#save-project");
const fileInput = document.querySelector("#import-file");

function message(error) {
  return error instanceof Error ? error.message : String(error);
}

function report(error) {
  statusBox.hidden = true;
  errorBox.hidden = false;
  errorBox.dataset.code = error?.code ?? "error";
  errorBox.querySelector("p").textContent = message(error);
}

function succeed(text) {
  errorBox.hidden = true;
  errorBox.dataset.code = "";
  statusBox.hidden = false;
  statusBox.querySelector("p").textContent = text;
}

function portsOf(ports) {
  return Object.entries(ports).filter(([, value]) => value).map(([key, value]) => `${key}=${value}`).join(", ") || "нет";
}

function render() {
  const project = session.document;
  document.querySelector("#project-profile").textContent = `Профиль ${project.profile}, игра ${project.gameVersion}, seed ${project.seed}. Формат ${project.format} версии ${project.version}.`;
  if (document.activeElement !== nameInput) nameInput.value = project.name;
  fill(document.querySelector("#network-rows"), project.networks.map((network) => [network.id, network.name, network.color]));
  fill(document.querySelector("#device-rows"), project.devices.map((device) => [device.id, device.name, device.kind, portsOf(device.ports)]));
  const events = project.devices.filter((device) => device.kind === "event");
  if (!events.some((device) => device.id === sourceId)) sourceId = events[0]?.id ?? null;
  setSelectOptions(eventSelect, events.map((device) => ({
    value: device.id,
    label: `${device.name} (${device.id})`,
  })), sourceId ?? "");
  const current = events.find((device) => device.id === sourceId);
  if (document.activeElement !== sourceInput) sourceInput.value = current?.source ?? "";
  renderSaved();
}

function fill(body, rows) {
  body.replaceChildren(...rows.map((cells) => {
    const row = document.createElement("tr");
    for (const text of cells) {
      const cell = document.createElement("td");
      cell.textContent = text;
      row.append(cell);
    }
    return row;
  }));
}

function renderSaved() {
  let records = [];
  if (store) {
    try {
      records = store.list();
    } catch (error) {
      report(error);
    }
  }
  const empty = document.querySelector("#saved-empty");
  const table = document.querySelector("#saved-scroll");
  empty.hidden = records.length > 0;
  table.hidden = records.length === 0;
  const body = document.querySelector("#saved-rows");
  body.replaceChildren(...records.map((record) => {
    const row = document.createElement("tr");
    for (const text of [record.name, record.id]) {
      const cell = document.createElement("td");
      cell.textContent = text;
      row.append(cell);
    }
    const action = document.createElement("td");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "fl-button";
    button.dataset.record = record.id;
    button.textContent = "Открыть";
    button.addEventListener("click", () => openRecord(record.id));
    action.append(button);
    row.append(action);
    return row;
  }));
}

function fileName(name) {
  const safe = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 80);
  return `${safe || "scheme"}.f-logic.json`;
}

function exportFile() {
  const blob = new Blob([JSON.stringify(session.document, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName(session.document.name);
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  succeed("Файл схемы подготовлен. Сценарий не запускался.");
}

function openRecord(id) {
  try {
    const stored = store.read(id);
    session.replace(stored.document);
    recordId = stored.recordId;
    sourceId = session.document.devices.find((item) => item.kind === "event")?.id ?? null;
    succeed(`Открыта запись ${stored.recordId}. Сценарий не запускался.`);
    render();
  } catch (error) {
    report(error);
  }
}

nameInput.addEventListener("change", () => {
  try {
    session.replace(draftProject(session.document, (project) => { project.name = nameInput.value; }));
    succeed("Название изменено в памяти.");
    render();
  } catch (error) {
    nameInput.value = session.document.name;
    report(error);
  }
});

eventSelect.addEventListener("change", () => {
  sourceId = eventSelect.value;
  const current = session.document.devices.find((item) => item.id === sourceId);
  sourceInput.value = current?.source ?? "";
});

sourceInput.addEventListener("change", () => {
  if (!sourceId) return;
  try {
    session.replace(draftProject(session.document, (project) => {
      const device = project.devices.find((item) => item.id === sourceId);
      if (device) device.source = sourceInput.value;
    }));
    succeed("Текст сценария записан в схему и не выполнялся.");
    render();
  } catch (error) {
    report(error);
  }
});

function save(options) {
  if (!store) {
    report({ code: "storage-unavailable", message: "Локальное хранилище недоступно. Рабочая схема остаётся в памяти." });
    return;
  }
  const saved = store.save(session.document, options);
  recordId = saved.recordId;
  succeed(`Схема «${saved.name}» записана в ${saved.recordId}. Сценарий не запускался.`);
  render();
}

saveButton.addEventListener("click", () => {
  if (!store) {
    report({ code: "storage-unavailable", message: "Локальное хранилище недоступно. Рабочая схема остаётся в памяти." });
    return;
  }
  try {
    save({ recordId, replace: false });
  } catch (error) {
    if (error.code === "name-collision") {
      document.querySelector("#collision-text").textContent = error.message;
      document.querySelector("#collision-name").value = "";
      dialog.showModal();
      return;
    }
    report(error);
  }
});

for (const button of document.querySelectorAll("[data-project-export]")) {
  button.addEventListener("click", () => {
    button.closest("details")?.removeAttribute("open");
    exportFile();
  });
}

for (const button of document.querySelectorAll("[data-project-import]")) {
  button.addEventListener("click", () => {
    button.closest("details")?.removeAttribute("open");
    fileInput.click();
  });
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (!file) return;
  try {
    session.replace(await file.text());
    recordId = null;
    sourceId = session.document.devices.find((item) => item.kind === "event")?.id ?? null;
    succeed("Файл загружен в память. Запись в хранилище не изменялась, сценарий не запускался.");
    render();
  } catch (error) {
    report(error);
  }
});

dialog.addEventListener("close", () => {
  const value = dialog.returnValue;
  if (!store) {
    report({ code: "storage-unavailable", message: "Локальное хранилище недоступно. Рабочая схема остаётся в памяти." });
  } else if (value === "replace") {
    try {
      save({ recordId, replace: true });
    } catch (error) {
      report(error);
    }
  } else if (value === "rename") {
    const nextName = document.querySelector("#collision-name").value;
    try {
      const draft = draftProject(session.document, (project) => { project.name = nextName; });
      const saved = store.save(draft, { recordId: null, replace: false });
      session.replace(draft);
      recordId = saved.recordId;
      succeed(`Схема сохранена как «${saved.name}» в ${saved.recordId}. Сценарий не запускался.`);
      render();
    } catch (error) {
      report(error);
      if (error.code === "name-collision" || error.code === "invalid-name") dialog.showModal();
    }
  }
  if (!dialog.open) saveButton.focus({ focusVisible: true });
});

document.querySelector("#project-feedback").textContent = "Сохранение пишет в локальное хранилище этого браузера. Импорт файла сам по себе хранилище не меняет.";
render();
if (store) {
  try {
    store.list();
  } catch (error) {
    report(error);
  }
}
