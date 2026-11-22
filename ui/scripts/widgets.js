// Общее поведение библиотеки: выбор, панели, меню подсказок и фокус редактора.
// Страницы подключают этот модуль, а не копируют обработчики.

let optionSerial = 0;
let globalsReady = false;
let pointerNavigating = false;

const SELECT_CHEVRON = `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>`;

export function mountWidgets(root = document) {
  ensureGlobals();
  root.querySelectorAll("[data-select]").forEach(mountSelect);
  root.querySelectorAll("[data-panel]").forEach(mountPanel);
  root.querySelectorAll("[data-pane-toggle]").forEach(mountPaneToggle);
  root.querySelectorAll('[data-suggest="inline"]').forEach(menu => mountSuggestMenu(menu, null));
  root.querySelectorAll("[data-suggest-open]").forEach(mountSuggestTrigger);
  root.querySelectorAll("[data-tooltip]").forEach(mountTooltip);
  root.querySelectorAll(".fl-editor").forEach(mountEditor);
}

function parseSelectOptions(text) {
  if (!text.trim()) return [];
  return text.split("|").map(part => {
    const index = part.indexOf(":");
    if (index < 0) return { value: part, label: part };
    return { value: part.slice(0, index), label: part.slice(index + 1) };
  });
}

function buildSelect(widget) {
  if (widget.querySelector(".fl-selectbox__control")) return;
  const entries = parseSelectOptions(widget.dataset.options || "");
  const initial = widget.dataset.value ?? "";
  const selected = entries.find(entry => entry.value === initial) ?? null;
  const labelId = widget.dataset.labelId || "";
  const valueId = widget.id ? `${widget.id}-value` : "";
  const listId = widget.id ? `${widget.id}-menu` : "";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "fl-selectbox__control";
  button.setAttribute("aria-haspopup", "listbox");
  button.setAttribute("aria-expanded", "false");
  if (listId) button.setAttribute("aria-controls", listId);
  const labelled = [labelId, valueId].filter(Boolean).join(" ");
  if (labelled) button.setAttribute("aria-labelledby", labelled);
  else if (widget.dataset.label) button.setAttribute("aria-label", widget.dataset.label);
  const valueEl = document.createElement("span");
  valueEl.className = "fl-selectbox__value";
  if (valueId) valueEl.id = valueId;
  if (selected) valueEl.textContent = selected.label;
  else {
    valueEl.textContent = widget.dataset.placeholder || "—";
    valueEl.classList.add("fl-selectbox__placeholder");
  }
  button.append(valueEl);
  button.insertAdjacentHTML("beforeend", SELECT_CHEVRON);
  const hidden = document.createElement("input");
  hidden.type = "hidden";
  hidden.setAttribute("data-select-value", "");
  hidden.value = selected ? selected.value : initial;
  const popover = document.createElement("div");
  popover.className = "fl-selectbox__popover";
  popover.setAttribute("popover", "manual");
  const list = document.createElement("div");
  list.className = "fl-selectbox__list";
  if (listId) list.id = listId;
  list.setAttribute("role", "listbox");
  if (labelId) list.setAttribute("aria-labelledby", labelId);
  entries.forEach(entry => {
    const option = document.createElement("div");
    option.setAttribute("role", "option");
    option.dataset.value = entry.value;
    option.textContent = entry.label;
    option.setAttribute("aria-selected", String(selected?.value === entry.value));
    list.append(option);
  });
  const empty = document.createElement("p");
  empty.className = "fl-selectbox__empty";
  empty.hidden = true;
  empty.textContent = "Ничего не найдено";
  if (widget.dataset.search === "true" && !popover.querySelector("[data-select-filter]")) {
    const filter = document.createElement("input");
    filter.className = "fl-input fl-selectbox__filter";
    filter.setAttribute("data-select-filter", "");
    filter.type = "search";
    filter.setAttribute("aria-label", "Поиск в списке");
    filter.placeholder = "Поиск";
    filter.autocomplete = "off";
    filter.spellcheck = false;
    popover.append(filter);
  }
  popover.append(list, empty);
  widget.append(button, hidden, popover);
  widget.dataset.value = hidden.value;
  if (widget.dataset.disabled === "true") setSelectDisabled(widget, true);
}

function writeSelectValue(widget, next, notify) {
  const hidden = widget.querySelector("[data-select-value]");
  const valueEl = widget.querySelector(".fl-selectbox__value");
  const options = [...widget.querySelectorAll(".fl-selectbox__list [role='option']")];
  const text = String(next ?? "");
  const match = options.find(item => (item.dataset.value ?? "") === text);
  const previous = hidden.value;
  hidden.value = match ? (match.dataset.value ?? "") : text;
  widget.dataset.value = hidden.value;
  options.forEach(item => item.setAttribute("aria-selected", String(item === match)));
  if (valueEl) {
    if (match) {
      valueEl.textContent = widget.hasAttribute("data-value-only") ? match.dataset.value : optionLabel(match);
      valueEl.classList.remove("fl-selectbox__placeholder");
    } else if (text === "") {
      valueEl.textContent = widget.dataset.placeholder || "—";
      valueEl.classList.add("fl-selectbox__placeholder");
    } else {
      valueEl.textContent = text;
      valueEl.classList.remove("fl-selectbox__placeholder");
    }
  }
  if (notify && previous !== hidden.value) hidden.dispatchEvent(new Event("change", { bubbles: true }));
}

function setSelectDisabled(widget, disabled) {
  const button = widget.querySelector(".fl-selectbox__control");
  if (!button) return;
  button.disabled = disabled;
  if (disabled) {
    button.setAttribute("aria-disabled", "true");
    widget.setAttribute("aria-disabled", "true");
    closeSelect(widget, false);
  } else {
    button.removeAttribute("aria-disabled");
    widget.removeAttribute("aria-disabled");
  }
}

export function setSelectOptions(widget, entries, preferred) {
  buildSelect(widget);
  const list = widget.querySelector(".fl-selectbox__list");
  if (!list) return;
  list.replaceChildren(...entries.map(entry => {
    const option = document.createElement("div");
    option.setAttribute("role", "option");
    option.dataset.value = String(entry.value ?? "");
    option.textContent = entry.label ?? "";
    option.setAttribute("aria-selected", "false");
    return option;
  }));
  const values = entries.map(entry => String(entry.value ?? ""));
  const wanted = preferred === undefined ? (widget.value ?? "") : String(preferred ?? "");
  writeSelectValue(widget, values.includes(wanted) ? wanted : (values[0] ?? ""), false);
}

export function ensureSelectOption(widget, value, label) {
  buildSelect(widget);
  const list = widget.querySelector(".fl-selectbox__list");
  if (!list) return;
  const text = String(value);
  if ([...list.querySelectorAll("[role='option']")].some(item => item.dataset.value === text)) return;
  const option = document.createElement("div");
  option.setAttribute("role", "option");
  option.dataset.value = text;
  option.textContent = label;
  option.setAttribute("aria-selected", "false");
  list.append(option);
}

function ensureGlobals() {
  if (globalsReady) return;
  globalsReady = true;
  document.addEventListener("pointerdown", () => { pointerNavigating = true; }, true);
  document.addEventListener("keydown", event => {
    if (event.key === "Tab") pointerNavigating = false;
  }, true);
  document.addEventListener("pointerdown", event => {
    document.querySelectorAll("[data-select][data-open='true']").forEach(widget => {
      const popover = widget.querySelector(".fl-selectbox__popover");
      if (widget.contains(event.target) || popover?.contains(event.target)) return;
      closeSelect(widget, false);
    });
    document.querySelectorAll('[data-suggest="popup"]:popover-open').forEach(menu => {
      const owner = ownerOf(menu);
      if (menu.contains(event.target) || owner?.contains(event.target)) return;
      closeSuggest(menu, null);
    });
  }, true);
  window.addEventListener("resize", repositionOpen);
  window.addEventListener("scroll", repositionOpen, true);
}

function ensureId(element) {
  if (!element.id) element.id = `fl-opt-${++optionSerial}`;
  return element.id;
}

function visibleOptions(container) {
  return [...container.querySelectorAll("[role='option']")].filter(option => !option.hidden);
}

function optionLabel(option) {
  return (option.dataset.label || option.textContent).replace(/\s+/g, " ").trim();
}

function scrollOptionInto(option) {
  const scroller = option.closest(".fl-selectbox__list, .fl-suggest");
  if (!scroller) return;
  const optionRect = option.getBoundingClientRect();
  const box = scroller.getBoundingClientRect();
  if (optionRect.top < box.top) scroller.scrollTop -= box.top - optionRect.top;
  else if (optionRect.bottom > box.bottom) scroller.scrollTop += optionRect.bottom - box.bottom;
}

function placePopover(popover, anchor) {
  const margin = 8;
  const room = Math.max(80, window.innerHeight - margin * 2);
  const requested = Number(popover.closest("[data-select]")?.dataset.menuWidth) || 320;
  const width = Math.min(requested, Math.max(80, window.innerWidth - margin * 2));
  popover.style.position = "fixed";
  popover.style.width = `${width}px`;
  popover.style.maxHeight = `${Math.min(240, room)}px`;
  popover.style.overflow = "auto";
  let left = Math.min(Math.max(margin, anchor.left), window.innerWidth - margin - width);
  popover.style.left = `${left}px`;
  popover.style.top = `${margin}px`;
  if (!popover.matches(":popover-open")) popover.showPopover();
  const height = popover.getBoundingClientRect().height;
  const spaceBelow = window.innerHeight - anchor.bottom - margin;
  const spaceAbove = anchor.top - margin;
  let top = anchor.bottom + 4;
  if (height > spaceBelow && spaceAbove >= spaceBelow) top = anchor.top - height - 4;
  if (top + height > window.innerHeight - margin) top = window.innerHeight - margin - height;
  if (top < margin) top = margin;
  popover.style.top = `${top}px`;
  const placed = popover.getBoundingClientRect();
  if (placed.bottom > window.innerHeight - margin) {
    popover.style.top = `${margin}px`;
    popover.style.maxHeight = `${room}px`;
  }
  const again = popover.getBoundingClientRect();
  if (again.right > window.innerWidth - margin) {
    left = Math.max(margin, window.innerWidth - margin - again.width);
    popover.style.left = `${left}px`;
  }
}

function repositionOpen() {
  document.querySelectorAll("[data-select][data-open='true']").forEach(widget => {
    const popover = widget.querySelector(".fl-selectbox__popover");
    const button = widget.querySelector(".fl-selectbox__control");
    if (popover?.matches(":popover-open") && button) placePopover(popover, button.getBoundingClientRect());
  });
  document.querySelectorAll('[data-suggest="popup"]:popover-open').forEach(menu => {
    const owner = ownerOf(menu);
    if (!owner) return;
    placePopover(menu, owner.getBoundingClientRect());
  });
  document.querySelectorAll("[data-tooltip] .fl-tooltip[data-open='true']").forEach(tip => {
    const control = tip.closest("[data-tooltip]")?.querySelector("button, [data-tooltip-control]");
    if (control) showTooltip(tip, control);
  });
}

function tabbables() {
  return [...document.querySelectorAll("a[href], button, input, textarea, select, [tabindex]")].filter(element => {
    if (element.disabled || element.hidden || element.tabIndex < 0) return false;
    if (element.closest("[hidden]")) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  });
}

function focusFrom(origin, backward) {
  const items = tabbables();
  const index = items.indexOf(origin);
  const step = backward ? -1 : 1;
  const next = items[index + step] ?? (backward ? items[0] : items.at(-1));
  next?.focus();
}

function mountSelect(widget) {
  if (widget.dataset.selectReady === "true") return;
  buildSelect(widget);
  const button = widget.querySelector(".fl-selectbox__control");
  const popover = widget.querySelector(".fl-selectbox__popover:not(.fl-selectbox__popover--sample)");
  const list = widget.querySelector(".fl-selectbox__list");
  const hidden = widget.querySelector("[data-select-value]");
  const filter = widget.querySelector("[data-select-filter]");
  const menuTitle = widget.dataset.menuTitle?.trim() ?? "";
  if (menuTitle && popover && !popover.querySelector(".fl-selectbox__title")) {
    const title = document.createElement("div");
    title.className = "fl-selectbox__title";
    title.textContent = menuTitle;
    ensureId(title);
    popover.prepend(title);
    list?.setAttribute("aria-labelledby", title.id);
  }
  if (widget.dataset.label && list && !list.hasAttribute("aria-labelledby")) list.setAttribute("aria-label", widget.dataset.label);
  if (!button || !popover || !list || !hidden) return;
  widget.dataset.selectReady = "true";
  if (widget.hasAttribute("data-value-only")) writeSelectValue(widget, hidden.value, false);
  list.querySelectorAll("[role='option']").forEach(ensureId);
  Object.defineProperty(widget, "value", {
    configurable: true,
    get() { return hidden.value; },
    set(next) { writeSelectValue(widget, next, false); },
  });
  Object.defineProperty(widget, "disabled", {
    configurable: true,
    get() { return button.disabled; },
    set(next) { setSelectDisabled(widget, Boolean(next)); },
  });
  const onKey = event => onSelectKey(event, widget);
  button.addEventListener("keydown", onKey);
  filter?.addEventListener("keydown", onKey);
  filter?.addEventListener("input", () => applyFilter(widget));
  button.addEventListener("click", () => {
    if (button.disabled) return;
    if (widget.dataset.open === "true") closeSelect(widget, true);
    else openSelect(widget);
  });
  list.addEventListener("click", event => {
    const option = event.target.closest("[role='option']");
    if (!option || option.hidden) return;
    commitSelect(widget, option);
  });
}

function onSelectKey(event, widget) {
  const button = widget.querySelector(".fl-selectbox__control");
  if (button.disabled) return;
  const open = widget.dataset.open === "true";
  const filter = event.target.matches?.("[data-select-filter]");
  if (!open && !filter && ["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
    event.preventDefault();
    openSelect(widget);
    if (event.key === "ArrowDown") moveSelect(widget, 1);
    if (event.key === "ArrowUp") moveSelect(widget, -1);
    return;
  }
  if (!open) return;
  if (event.key === " " && filter) return;
  if (event.key === "ArrowDown") { event.preventDefault(); moveSelect(widget, 1); }
  else if (event.key === "ArrowUp") { event.preventDefault(); moveSelect(widget, -1); }
  else if (event.key === "Home") { event.preventDefault(); moveSelectTo(widget, 0); }
  else if (event.key === "End") { event.preventDefault(); moveSelectTo(widget, -1); }
  else if (event.key === "Enter") {
    event.preventDefault();
    const active = visibleOptions(widget.querySelector(".fl-selectbox__list")).find(item => item.hasAttribute("data-active"));
    if (active) commitSelect(widget, active);
  } else if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeSelect(widget, true);
  } else if (event.key === "Tab") {
    event.preventDefault();
    closeSelect(widget, false);
    focusFrom(button, event.shiftKey);
  }
}

function openSelect(widget) {
  document.querySelectorAll("[data-select][data-open='true']").forEach(other => {
    if (other !== widget) closeSelect(other, false);
  });
  document.querySelectorAll('[data-suggest="popup"]:popover-open').forEach(menu => closeSuggest(menu, null));
  const button = widget.querySelector(".fl-selectbox__control");
  const popover = widget.querySelector(".fl-selectbox__popover:not(.fl-selectbox__popover--sample)");
  const filter = widget.querySelector("[data-select-filter]");
  if (button.disabled) return;
  if (filter) filter.value = "";
  applyFilter(widget);
  widget.dataset.open = "true";
  button.setAttribute("aria-expanded", "true");
  placePopover(popover, button.getBoundingClientRect());
  const selected = visibleOptions(widget.querySelector(".fl-selectbox__list")).find(item => item.getAttribute("aria-selected") === "true");
  setSelectActive(widget, selected ?? visibleOptions(widget.querySelector(".fl-selectbox__list"))[0] ?? null);
  if (filter) filter.focus();
}

function closeSelect(widget, restoreFocus) {
  const button = widget.querySelector(".fl-selectbox__control");
  const popover = widget.querySelector(".fl-selectbox__popover:not(.fl-selectbox__popover--sample)");
  const trapped = popover?.contains(document.activeElement) ?? false;
  widget.dataset.open = "false";
  button.setAttribute("aria-expanded", "false");
  button.removeAttribute("aria-activedescendant");
  widget.querySelector("[data-select-filter]")?.removeAttribute("aria-activedescendant");
  if (popover?.matches(":popover-open")) popover.hidePopover();
  if (restoreFocus || trapped) button.focus();
}

function applyFilter(widget) {
  const filter = widget.querySelector("[data-select-filter]");
  const query = (filter?.value || "").toLocaleLowerCase("ru").trim();
  const options = [...widget.querySelectorAll(".fl-selectbox__list [role='option']")];
  options.forEach(option => {
    const matches = query === "" || optionLabel(option).toLocaleLowerCase("ru").includes(query);
    option.hidden = !matches;
    if (!matches) option.removeAttribute("data-active");
  });
  const empty = widget.querySelector(".fl-selectbox__empty");
  const visible = options.filter(option => !option.hidden);
  if (empty) empty.hidden = visible.length > 0;
  if (!visible.some(option => option.hasAttribute("data-active"))) setSelectActive(widget, visible[0] ?? null);
}

function setSelectActive(widget, option) {
  const button = widget.querySelector(".fl-selectbox__control");
  const filter = widget.querySelector("[data-select-filter]");
  widget.querySelectorAll(".fl-selectbox__list [role='option']").forEach(item => {
    if (item === option) item.setAttribute("data-active", "true");
    else item.removeAttribute("data-active");
  });
  const target = filter && document.activeElement === filter ? filter : button;
  if (option) {
    ensureId(option);
    target.setAttribute("aria-activedescendant", option.id);
    scrollOptionInto(option);
  } else target.removeAttribute("aria-activedescendant");
}

function moveSelect(widget, delta) {
  const items = visibleOptions(widget.querySelector(".fl-selectbox__list"));
  if (!items.length) return;
  const current = items.findIndex(item => item.hasAttribute("data-active"));
  const next = current < 0 ? 0 : Math.min(items.length - 1, Math.max(0, current + delta));
  setSelectActive(widget, items[next]);
}

function moveSelectTo(widget, index) {
  const items = visibleOptions(widget.querySelector(".fl-selectbox__list"));
  if (!items.length) return;
  setSelectActive(widget, items[index < 0 ? items.length - 1 : index]);
}

function commitSelect(widget, option) {
  writeSelectValue(widget, option.dataset.value ?? "", true);
  closeSelect(widget, true);
}

function mountPaneToggle(button) {
  if (button.dataset.paneReady === "true") return;
  const pane = document.getElementById(button.getAttribute("aria-controls") || "");
  if (!pane) return;
  button.dataset.paneReady = "true";
  button.addEventListener("click", () => {
    const open = button.getAttribute("aria-expanded") !== "true";
    const group = button.parentElement;
    group?.querySelectorAll("[data-pane-toggle]").forEach(other => {
      const otherPane = document.getElementById(other.getAttribute("aria-controls") || "");
      const on = other === button && open;
      other.setAttribute("aria-expanded", String(on));
      if (!otherPane) return;
      if (on) otherPane.dataset.open = "true";
      else delete otherPane.dataset.open;
    });
  });
}

function showTooltip(tip, anchor) {
  const margin = 8;
  const gap = 6;
  tip.dataset.open = "true";
  tip.style.left = "0px";
  tip.style.top = "0px";
  const anchorBox = anchor.getBoundingClientRect();
  const tipBox = tip.getBoundingClientRect();
  let top = anchorBox.bottom + gap;
  if (top + tipBox.height > window.innerHeight - margin && anchorBox.top - gap - tipBox.height >= margin) {
    top = anchorBox.top - gap - tipBox.height;
  }
  if (top < margin) top = margin;
  if (top + tipBox.height > window.innerHeight - margin) top = Math.max(margin, window.innerHeight - margin - tipBox.height);
  let left = anchorBox.left;
  if (left + tipBox.width > window.innerWidth - margin) left = window.innerWidth - margin - tipBox.width;
  if (left < margin) left = margin;
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
}

function hideTooltip(tip) {
  delete tip.dataset.open;
  tip.style.left = "";
  tip.style.top = "";
}

function mountTooltip(host) {
  if (host.dataset.tooltipReady === "true") return;
  const control = host.querySelector("button, [data-tooltip-control]");
  const tip = host.querySelector("[role='tooltip']:not(.fl-tooltip--sample)");
  if (!control || !tip) return;
  host.dataset.tooltipReady = "true";
  ensureId(tip);
  const ids = new Set((control.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
  ids.add(tip.id);
  control.setAttribute("aria-describedby", [...ids].join(" "));
  let hover = false;
  let keyFocus = false;
  let dismissed = false;
  const sync = () => {
    if (!dismissed && (hover || keyFocus)) showTooltip(tip, control);
    else hideTooltip(tip);
  };
  host.addEventListener("pointerenter", () => {
    hover = true;
    dismissed = false;
    sync();
  });
  host.addEventListener("pointerleave", event => {
    if (host.contains(event.relatedTarget)) return;
    hover = false;
    sync();
  });
  control.addEventListener("focusin", () => {
    keyFocus = !pointerNavigating;
    if (keyFocus) dismissed = false;
    sync();
  });
  control.addEventListener("focusout", () => {
    keyFocus = false;
    sync();
  });
  control.addEventListener("keydown", event => {
    if (event.key !== "Escape" || tip.dataset.open !== "true") return;
    event.preventDefault();
    event.stopPropagation();
    dismissed = true;
    keyFocus = false;
    hideTooltip(tip);
  });
}

function mountPanel(panel) {
  if (panel.dataset.panelReady === "true") return;
  const button = panel.querySelector(".fl-panel__toggle");
  const body = button && document.getElementById(button.getAttribute("aria-controls"));
  if (!button || !body) return;
  panel.dataset.panelReady = "true";
  button.addEventListener("click", () => {
    const open = button.getAttribute("aria-expanded") !== "true";
    if (!open && body.contains(document.activeElement)) button.focus();
    button.setAttribute("aria-expanded", String(open));
    body.hidden = !open;
  });
}

const suggestOwners = new WeakMap();

function ownerOf(menu) {
  return suggestOwners.get(menu) ?? null;
}

function mountSuggestTrigger(button) {
  if (button.dataset.suggestReady === "true") return;
  const panel = button.closest("[role='tabpanel'], .fl-panel, body");
  const menu = panel?.querySelector('[data-suggest="popup"]');
  if (!menu) return;
  button.dataset.suggestReady = "true";
  ensureId(menu);
  button.setAttribute("aria-controls", menu.id);
  button.setAttribute("aria-haspopup", "listbox");
  menu.querySelectorAll("[role='option']").forEach(ensureId);
  button.addEventListener("click", () => {
    if (menu.matches(":popover-open")) closeSuggest(menu, button);
    else openSuggest(menu, button.getBoundingClientRect(), button);
  });
  button.addEventListener("keydown", event => onSuggestKey(event, menu, button));
  const area = panel.querySelector(".fl-editor textarea");
  area?.addEventListener("keydown", event => {
    const open = menu.matches(":popover-open") && ownerOf(menu) === area;
    if (open && onSuggestKey(event, menu, area)) return;
    const shortcut = ((event.ctrlKey || event.metaKey) && event.key === " ") || (event.altKey && event.key === "ArrowDown");
    if (!shortcut) return;
    event.preventDefault();
    openSuggest(menu, area.getBoundingClientRect(), area);
  });
}

function mountSuggestMenu(menu, owner) {
  if (menu.dataset.suggestMenuReady === "true") return;
  menu.dataset.suggestMenuReady = "true";
  menu.querySelectorAll("[role='option']").forEach(ensureId);
  menu.addEventListener("keydown", event => onSuggestKey(event, menu, ownerOf(menu) ?? menu));
  menu.addEventListener("click", event => {
    const option = event.target.closest("[role='option']");
    if (!option || option.hidden) return;
    commitSuggest(menu, option, ownerOf(menu) ?? menu);
  });
}

function openSuggest(menu, anchor, owner) {
  document.querySelectorAll("[data-select][data-open='true']").forEach(widget => closeSelect(widget, false));
  document.querySelectorAll('[data-suggest="popup"]:popover-open').forEach(other => {
    if (other !== menu) closeSuggest(other, null);
  });
  mountSuggestMenu(menu, owner);
  suggestOwners.set(menu, owner);
  menu.querySelectorAll("[role='option']").forEach(option => { option.hidden = false; });
  placePopover(menu, anchor);
  const selected = visibleOptions(menu).find(item => item.getAttribute("aria-selected") === "true");
  setSuggestActive(menu, selected ?? visibleOptions(menu)[0] ?? null);
  if (owner?.hasAttribute("aria-expanded")) owner.setAttribute("aria-expanded", "true");
}

function closeSuggest(menu, restore) {
  if (menu.matches(":popover-open")) menu.hidePopover();
  const owner = ownerOf(menu);
  if (owner?.hasAttribute("aria-expanded")) owner.setAttribute("aria-expanded", "false");
  owner?.removeAttribute("aria-activedescendant");
  if (restore && restore.isConnected) restore.focus();
}

function onSuggestKey(event, menu, owner) {
  const inline = menu.dataset.suggest === "inline";
  const open = inline || menu.matches(":popover-open");
  if (!open && ["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key) && event.target === owner) {
    event.preventDefault();
    openSuggest(menu, owner.getBoundingClientRect(), owner);
    if (event.key === "ArrowDown") moveSuggest(menu, 1);
    if (event.key === "ArrowUp") moveSuggest(menu, -1);
    return true;
  }
  if (!open) return false;
  if (!["ArrowDown", "ArrowUp", "Home", "End", "Enter", "Escape", "Tab", " "].includes(event.key)) return false;
  if (event.key === "Tab") {
    if (inline) return false;
    event.preventDefault();
    closeSuggest(menu, null);
    focusFrom(owner.closest(".fl-editor") ? owner : owner, event.shiftKey);
    return true;
  }
  event.preventDefault();
  if (event.key === "ArrowDown") moveSuggest(menu, 1);
  else if (event.key === "ArrowUp") moveSuggest(menu, -1);
  else if (event.key === "Home") moveSuggestTo(menu, 0);
  else if (event.key === "End") moveSuggestTo(menu, -1);
  else if (event.key === "Enter" || event.key === " ") {
    const active = visibleOptions(menu).find(item => item.hasAttribute("data-active"));
    if (active) commitSuggest(menu, active, owner);
  } else if (event.key === "Escape") {
    event.stopPropagation();
    if (!inline) closeSuggest(menu, owner);
  }
  return true;
}

function setSuggestActive(menu, option) {
  menu.querySelectorAll("[role='option']").forEach(item => {
    if (item === option) item.setAttribute("data-active", "true");
    else item.removeAttribute("data-active");
  });
  const owner = ownerOf(menu) ?? menu;
  if (option) {
    ensureId(option);
    owner.setAttribute("aria-activedescendant", option.id);
    scrollOptionInto(option);
  } else owner.removeAttribute("aria-activedescendant");
}

function moveSuggest(menu, delta) {
  const items = visibleOptions(menu);
  if (!items.length) return;
  const current = items.findIndex(item => item.hasAttribute("data-active"));
  const next = current < 0 ? 0 : Math.min(items.length - 1, Math.max(0, current + delta));
  setSuggestActive(menu, items[next]);
}

function moveSuggestTo(menu, index) {
  const items = visibleOptions(menu);
  if (!items.length) return;
  setSuggestActive(menu, items[index < 0 ? items.length - 1 : index]);
}

function commitSuggest(menu, option, owner) {
  menu.querySelectorAll("[role='option']").forEach(item => item.setAttribute("aria-selected", String(item === option)));
  const status = owner?.closest?.("[role='tabpanel']")?.querySelector("[data-suggest-status]");
  if (status) status.textContent = `Выбрано: ${optionLabel(option)}`;
  if (menu.dataset.suggest === "popup") closeSuggest(menu, owner && owner !== menu ? owner : null);
  else setSuggestActive(menu, option);
}

function wheelScale(area, event) {
  if (event.deltaMode === 1) {
    const line = Number.parseFloat(getComputedStyle(area).lineHeight);
    return Number.isFinite(line) && line > 0 ? line : 22;
  }
  if (event.deltaMode === 2) return area.clientHeight || 1;
  return 1;
}

function bindGutterGestures(gutter, area, syncScroll) {
  gutter.addEventListener("wheel", event => {
    event.preventDefault();
    const scale = wheelScale(area, event);
    area.scrollTop += event.deltaY * scale;
    area.scrollLeft += event.deltaX * scale;
    syncScroll();
  }, { passive: false });
  let drag = null;
  const finish = event => {
    if (!drag || event.pointerId !== drag.id) return;
    drag = null;
  };
  gutter.addEventListener("pointerdown", event => {
    if (event.pointerType === "mouse" || event.button > 0) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, top: area.scrollTop, left: area.scrollLeft };
    try { gutter.setPointerCapture(event.pointerId); } catch { /* синтетическое событие проверки */ }
  });
  gutter.addEventListener("pointermove", event => {
    if (!drag || event.pointerId !== drag.id) return;
    area.scrollTop = drag.top - (event.clientY - drag.y);
    area.scrollLeft = drag.left - (event.clientX - drag.x);
    syncScroll();
  });
  gutter.addEventListener("pointerup", finish);
  gutter.addEventListener("pointercancel", finish);
}

function mountEditor(editor) {
  if (editor.dataset.editorReady === "true") return;
  const area = editor.querySelector("textarea");
  const gutter = editor.querySelector(".fl-editor__gutter");
  if (!area) return;
  editor.dataset.editorReady = "true";
  area.addEventListener("pointerdown", () => { editor.dataset.focusSource = "pointer"; });
  area.addEventListener("focusin", () => {
    if (editor.dataset.focusSource !== "pointer") editor.dataset.focusSource = "keyboard";
  });
  area.addEventListener("focusout", event => {
    if (!editor.contains(event.relatedTarget)) delete editor.dataset.focusSource;
  });
  const syncScroll = () => {
    if (gutter) {
      gutter.scrollTop = area.scrollTop;
      gutter.scrollLeft = 0;
    }
    const layer = editor.querySelector(".fl-editor__paint");
    if (layer) layer.style.transform = `translate(${-area.scrollLeft}px, ${-area.scrollTop}px)`;
  };
  const followScroll = () => {
    syncScroll();
    queueMicrotask(syncScroll);
  };
  area.addEventListener("scroll", followScroll, { passive: true });
  area.addEventListener("input", syncScroll);
  area.addEventListener("keyup", syncScroll);
  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(() => syncScroll());
    observer.observe(area);
    if (gutter) observer.observe(gutter);
  }
  if (gutter) bindGutterGestures(gutter, area, syncScroll);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => mountWidgets(document));
else mountWidgets(document);
