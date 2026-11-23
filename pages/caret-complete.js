/** Меню подсказок у каретки. Страница решает, какие пункты допустимы и какой текст вставить. */

let serial = 0;

export function mountCaretComplete(textarea, provider, { suggest = "caret" } = {}) {
  const menu = document.createElement("div");
  menu.className = "fl-suggest";
  menu.dataset.suggest = suggest;
  menu.setAttribute("popover", "manual");
  menu.setAttribute("role", "listbox");
  menu.setAttribute("aria-label", "Подсказки");
  menu.id = `caret-menu-${++serial}`;
  document.body.append(menu);
  textarea.setAttribute("aria-autocomplete", "list");
  textarea.setAttribute("aria-controls", menu.id);
  textarea.setAttribute("aria-expanded", "false");

  let open = false;
  let current = null;
  let active = 0;
  let suppress = false;
  let composing = false;
  const limit = 80;

  function read() {
    return provider.suggest(textarea.selectionStart, textarea.selectionEnd);
  }

  function showList(next) {
    if (!next || next.context?.kind === "none" || !next.items?.length) {
      close();
      return;
    }
    current = next;
    active = Math.min(active, Math.min(limit, next.items.length) - 1);
    if (active < 0) active = 0;
    render();
    open = true;
    textarea.setAttribute("aria-expanded", "true");
    place();
  }

  function openForced() {
    active = 0;
    showList(read());
  }

  function refreshFromEdit() {
    const next = read();
    if (!autoOpen(next)) {
      close();
      return;
    }
    if (!open) active = 0;
    showList(next);
  }

  function autoOpen(next) {
    if (!next || next.context?.kind === "none" || !next.items?.length) return false;
    const query = next.context.query ?? "";
    if (query) return true;
    const at = next.context.range?.start ?? textarea.selectionStart;
    return /[.:][ \t]*$/u.test(textarea.value.slice(0, at));
  }

  function close(reason = "dismiss") {
    open = false;
    current = null;
    menu.dataset.closeReason = reason;
    textarea.setAttribute("aria-expanded", "false");
    textarea.removeAttribute("aria-activedescendant");
    if (menu.matches(":popover-open")) menu.hidePopover();
  }

  function runFinish(reason) {
    if (suppress || composing || typeof provider.finish !== "function") {
      return { applied: false, handled: false };
    }
    suppress = true;
    try {
      return provider.finish(reason, textarea) ?? { applied: false, handled: false };
    } finally {
      suppress = false;
    }
  }

  function render() {
    menu.replaceChildren();
    current.items.slice(0, limit).forEach((item, index) => {
      const option = document.createElement("div");
      option.className = "fl-suggest__option";
      option.setAttribute("role", "option");
      option.dataset.index = String(index);
      option.dataset.value = item.value ?? item.name;
      option.setAttribute("aria-selected", String(index === active));
      if (index === active) option.setAttribute("data-active", "true");
      const name = document.createElement("span");
      name.textContent = item.caption ?? item.name;
      option.append(name);
      if (item.label) {
        option.append(document.createTextNode(" "));
        const label = document.createElement("span");
        label.className = "fl-muted";
        label.textContent = item.label;
        option.append(label);
      }
      menu.append(option);
    });
    const chosen = menu.querySelector("[data-active='true']");
    if (chosen) {
      if (!chosen.id) chosen.id = `${menu.id}-opt-${active}`;
      textarea.setAttribute("aria-activedescendant", chosen.id);
      chosen.scrollIntoView({ block: "nearest" });
    }
  }

  function move(delta) {
    const count = Math.min(limit, current.items.length);
    active = Math.min(count - 1, Math.max(0, active + delta));
    render();
    place();
  }

  function moveTo(index) {
    const count = Math.min(limit, current.items.length);
    active = index < 0 ? count - 1 : 0;
    render();
    place();
  }

  function accept(index = active) {
    if (!open || !current) return;
    const item = current.items[index];
    if (!item) return;
    const suggestion = current;
    suppress = true;
    let outcome = { applied: false };
    try {
      outcome = provider.commit(item, suggestion, textarea) ?? { applied: false };
    } finally {
      suppress = false;
    }
    if (outcome.applied === false) {
      close();
      return;
    }
    if (outcome.reopen) {
      active = 0;
      showList(read());
      return;
    }
    close();
  }

  function place() {
    if (!open) return;
    const rect = caretRect(textarea);
    const box = textarea.getBoundingClientRect();
    const visible = rect.bottom > box.top + 1
      && rect.top < box.bottom - 1
      && rect.left < box.right - 1
      && rect.right > box.left + 1;
    if (!visible) {
      if (menu.matches(":popover-open")) {
        menu.dataset.closeReason = "scroll";
        menu.hidePopover();
      }
      return;
    }
    placeMenu(menu, rect);
  }

  textarea.addEventListener("compositionstart", () => {
    composing = true;
    close();
  });
  textarea.addEventListener("compositionend", () => {
    composing = false;
    if (!suppress) refreshFromEdit();
  });
  textarea.addEventListener("input", (event) => {
    if (suppress || composing || event.isComposing) return;
    const typed = event.inputType === "insertText" ? (event.data ?? "") : "";
    const insertion = event.inputType === "insertText" && /[A-Za-z0-9_.:]/u.test(typed);
    const deletion = event.inputType === "deleteContentBackward"
      || event.inputType === "deleteContentForward"
      || event.inputType === "deleteByCut";
    if (insertion || deletion) {
      refreshFromEdit();
      return;
    }
    if (!open) return;
    const next = read();
    if (next.context?.kind === "none" || !next.items?.length) close();
    else showList(next);
  });

  textarea.addEventListener("keydown", (event) => {
    if (composing || event.isComposing) return;
    const shortcut = (event.ctrlKey || event.metaKey) && event.key === " " && !event.altKey;
    if (shortcut) {
      event.preventDefault();
      openForced();
      return;
    }
    if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      const outcome = runFinish("tab");
      if (open) close("tab");
      if (outcome.handled) return;
      if (typeof provider.insertTab === "function") {
        provider.insertTab(textarea);
        return;
      }
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      textarea.setRangeText("\t", start, end, "end");
      return;
    }
    if (event.key === "Escape") {
      const wasOpen = open;
      runFinish("escape");
      if (wasOpen) {
        event.preventDefault();
        event.stopPropagation();
      }
      close("escape");
      return;
    }
    if (!open) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      moveTo(0);
    } else if (event.key === "End") {
      event.preventDefault();
      moveTo(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      accept();
    }
  });

  menu.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });
  menu.addEventListener("mousemove", (event) => {
    const option = event.target.closest?.("[role='option']");
    if (!option || !open) return;
    const index = Number(option.dataset.index);
    if (index === active) return;
    active = index;
    render();
  });
  menu.addEventListener("click", (event) => {
    const option = event.target.closest?.("[role='option']");
    if (!option) return;
    accept(Number(option.dataset.index));
  });

  document.addEventListener("selectionchange", () => {
    if (suppress || !open || document.activeElement !== textarea) return;
    const next = read();
    const same = next.context?.kind === current?.context?.kind
      && next.context?.query === current?.context?.query
      && next.context?.range?.start === current?.context?.range?.start
      && next.context?.range?.end === current?.context?.range?.end
      && next.anchor?.caret === current?.anchor?.caret;
    if (!same) close();
    else place();
  });
  textarea.addEventListener("scroll", () => place(), { passive: true });
  window.addEventListener("resize", () => place());
  window.addEventListener("scroll", () => place(), true);
  document.addEventListener("pointerdown", (event) => {
    if (suppress || composing) return;
    if (menu.contains(event.target)) return;
    const inTextarea = event.target === textarea;
    const editing = document.activeElement === textarea;
    if (!inTextarea && !editing && !open) return;
    runFinish("click");
    if (open) close("click");
  }, true);

  return { close, menu };
}

function caretRect(textarea) {
  const style = getComputedStyle(textarea);
  const box = textarea.getBoundingClientRect();
  const mirror = document.createElement("div");
  mirror.style.position = "fixed";
  mirror.style.left = `${box.left}px`;
  mirror.style.top = `${box.top}px`;
  mirror.style.visibility = "hidden";
  mirror.style.pointerEvents = "none";
  mirror.style.overflow = "hidden";
  mirror.style.whiteSpace = "pre";
  mirror.style.overflowWrap = "normal";
  mirror.style.boxSizing = "border-box";
  mirror.style.width = `${textarea.offsetWidth}px`;
  mirror.style.height = `${textarea.offsetHeight}px`;
  mirror.style.border = style.border;
  mirror.style.padding = style.padding;
  mirror.style.font = style.font;
  mirror.style.lineHeight = style.lineHeight;
  mirror.style.letterSpacing = style.letterSpacing;
  mirror.style.tabSize = style.tabSize || "2";
  const before = document.createTextNode(textarea.value.slice(0, textarea.selectionStart));
  const mark = document.createElement("span");
  mark.textContent = "\u200b";
  mirror.append(before, mark);
  document.body.append(mirror);
  mirror.scrollTop = textarea.scrollTop;
  mirror.scrollLeft = textarea.scrollLeft;
  const rect = mark.getBoundingClientRect();
  mirror.remove();
  return rect;
}

function placeMenu(menu, anchor) {
  const margin = 8;
  const room = Math.max(80, window.innerHeight - margin * 2);
  const width = Math.min(320, Math.max(160, window.innerWidth - margin * 2));
  menu.style.position = "fixed";
  menu.style.width = `${width}px`;
  menu.style.maxHeight = `${Math.min(240, room)}px`;
  menu.style.overflow = "auto";
  let left = Math.min(Math.max(margin, anchor.left), window.innerWidth - margin - width);
  menu.style.left = `${left}px`;
  menu.style.top = `${margin}px`;
  if (!menu.matches(":popover-open")) menu.showPopover();
  const height = menu.getBoundingClientRect().height;
  const spaceBelow = window.innerHeight - anchor.bottom - margin;
  const spaceAbove = anchor.top - margin;
  let top = anchor.bottom + 4;
  if (height > spaceBelow && spaceAbove >= spaceBelow) top = anchor.top - height - 4;
  if (top + height > window.innerHeight - margin) top = window.innerHeight - margin - height;
  if (top < margin) top = margin;
  menu.style.top = `${top}px`;
  const placed = menu.getBoundingClientRect();
  if (placed.bottom > window.innerHeight - margin) {
    menu.style.top = `${margin}px`;
    menu.style.maxHeight = `${room}px`;
  }
  const again = menu.getBoundingClientRect();
  if (again.right > window.innerWidth - margin) {
    left = Math.max(margin, window.innerWidth - margin - again.width);
    menu.style.left = `${left}px`;
  }
}
