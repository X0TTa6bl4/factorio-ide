/** Переключатели «Код / Сети / События»: шапка остаётся, меняется только область под ней. */

export function createWorkViews(root, { onChange, stateTarget, media } = {}) {
  const query = media ?? window.matchMedia("(max-width: 900px)");
  const state = stateTarget ?? root;
  const buttons = [...root.querySelectorAll("[data-work-view]")];
  const panels = new Map(buttons.map((button) => {
    const id = button.getAttribute("aria-controls");
    return [button.dataset.workView, { button, panel: id ? document.getElementById(id) : null }];
  }));
  let primary = panels.has("code") ? "code" : buttons[0]?.dataset.workView ?? "code";
  let networksOpen = true;
  let narrowView = primary;

  function shown(name) {
    const narrow = query.matches;
    if (name === "networks") return narrow ? narrowView === "networks" : networksOpen;
    return narrow ? narrowView === name : primary === name;
  }

  function paint() {
    const narrow = query.matches;
    for (const [name, item] of panels) {
      const open = shown(name);
      item.button.setAttribute("aria-expanded", String(open));
      if (item.panel && !item.panel.contains(item.button)) item.panel.hidden = !open;
    }
    const codePanel = root.querySelector("#code-panel");
    if (codePanel) codePanel.hidden = false;
    state.dataset.networks = String(networksOpen);
    state.dataset.primary = primary;
    state.dataset.narrow = narrow && narrowView === "networks" ? "networks" : "";
    onChange?.({
      primary,
      networksOpen,
      narrowView,
      narrow,
    });
  }

  function select(name) {
    if (!panels.has(name)) return;
    if (name === "networks") {
      if (query.matches) narrowView = "networks";
      else networksOpen = !networksOpen;
    } else {
      primary = name;
      narrowView = name;
    }
    paint();
  }

  function show(name) {
    if (!panels.has(name)) return;
    if (name === "networks") {
      networksOpen = true;
      if (query.matches) narrowView = "networks";
    } else {
      primary = name;
      narrowView = name;
    }
    paint();
  }

  function keepFocus() {
    const active = document.activeElement;
    if (!active) return;
    for (const [name, item] of panels) {
      if (!item.panel?.contains(active)) continue;
      if (name === "networks") {
        narrowView = "networks";
        networksOpen = true;
      } else {
        narrowView = name;
        primary = name;
      }
      return;
    }
  }

  for (const [name, item] of panels) {
    item.button.addEventListener("click", () => select(name));
  }
  query.addEventListener("change", () => {
    keepFocus();
    paint();
  });
  paint();

  return {
    show,
    paint,
    get primary() { return primary; },
    get networksOpen() { return networksOpen; },
    get narrowView() { return narrowView; },
  };
}
