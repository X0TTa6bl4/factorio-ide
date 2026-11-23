import { mountEventSession } from "./session-ui.js";

const redBody = document.querySelector("#red-body");
const greenBody = document.querySelector("#green-body");
const workbench = document.querySelector("[data-workbench]");
const codePanel = document.querySelector("#code-panel");
const networksColumn = document.querySelector("#networks-column");
const codeView = workbench.querySelector('[data-work-view="code"]');
const networksView = workbench.querySelector('[data-work-view="networks"]');
const layoutQuery = window.matchMedia("(max-width: 900px)");
let networksOpen = true;
let narrowView = "code";

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

function narrowLayout() {
  return layoutQuery.matches;
}

function paintWorkbench() {
  const narrow = narrowLayout();
  const showCode = narrow ? narrowView === "code" : true;
  const showNetworks = narrow ? narrowView === "networks" : networksOpen;
  codePanel.hidden = !showCode;
  networksColumn.hidden = !showNetworks;
  workbench.dataset.networks = String(networksOpen);
  codeView.setAttribute("aria-expanded", String(showCode));
  networksView.setAttribute("aria-expanded", String(showNetworks));
}

function keepFocusedPanel() {
  const active = document.activeElement;
  if (codePanel.contains(active)) narrowView = "code";
  else if (networksColumn.contains(active)) {
    narrowView = "networks";
    networksOpen = true;
  }
}

codeView.addEventListener("click", () => {
  if (narrowLayout()) narrowView = "code";
  paintWorkbench();
});
networksView.addEventListener("click", () => {
  if (narrowLayout()) narrowView = "networks";
  else networksOpen = !networksOpen;
  paintWorkbench();
});
layoutQuery.addEventListener("change", () => {
  keepFocusedPanel();
  paintWorkbench();
});

paintWorkbench();

const session = mountEventSession(document, {
  paintNetworks(view) {
    fillSignals(redBody, view.red);
    fillSignals(greenBody, view.green);
  },
});

window.__eventPage = {
  check: session.check,
  step: session.step,
  reset: session.reset,
  stop: session.stop,
  remember: session.remember,
  restore: session.restore,
  view: session.view,
};
