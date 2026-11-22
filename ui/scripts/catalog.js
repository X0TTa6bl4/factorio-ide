import { mountWidgets } from "./widgets.js";
import { mountCompact } from "./compact.js";
import { mountDocumentation } from "./docs.js";

// Demo-only composition. Production pages can use these HTML fragments directly.
const componentURL = new URL("../components/", import.meta.url);
const cache = new Map();
let instance = 0;

function source(name) {
  if (!/^[a-z-]+$/.test(name)) throw new Error("Некорректное имя компонента");
  if (!cache.has(name)) cache.set(name, fetch(new URL(`${name}.html`, componentURL)).then(response => {
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    return response.text();
  }));
  return cache.get(name);
}

function uniqueIDs(fragment) {
  const prefix = `fl-${++instance}-`;
  const ids = new Map();
  fragment.querySelectorAll("[id]").forEach(element => {
    const original = element.id;
    element.id = prefix + original;
    ids.set(original, element.id);
  });
  for (const attribute of ["for", "aria-labelledby", "aria-describedby", "aria-controls"]) {
    fragment.querySelectorAll(`[${attribute}]`).forEach(element => {
      element.setAttribute(attribute, element.getAttribute(attribute).split(/\s+/).map(id => ids.get(id) ?? id).join(" "));
    });
  }
  fragment.querySelectorAll("[data-label-id]").forEach(element => {
    const next = ids.get(element.dataset.labelId);
    if (next) element.dataset.labelId = next;
  });
}

async function include(element) {
  const name = element.dataset.ui;
  try {
    const html = await source(name);
    const template = document.createElement("template");
    template.innerHTML = html; // Trusted local library files only; never project/user data.
    uniqueIDs(template.content);
    element.replaceChildren(template.content);
    if (element.hasAttribute("data-show-source")) {
      const details = document.createElement("details");
      details.className = "fl-source";
      const summary = document.createElement("summary");
      summary.textContent = `HTML · ui/components/${name}.html`;
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = html.trim();
      pre.append(code);
      details.append(summary, pre);
      element.append(details);
      element.classList.add("fl-stack");
    }
    element.dataset.loaded = "true";
  } catch (error) {
    element.className = "fl-include-error";
    element.textContent = `Не удалось загрузить ${name}. Откройте каталог через HTTP. ${error.message}`;
    throw error;
  }
}

function wireTabs(root) {
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  function select(tab, focus = false) {
    tabs.forEach(item => {
      const active = item === tab;
      item.setAttribute("aria-selected", String(active));
      item.tabIndex = active ? 0 : -1;
      document.getElementById(item.getAttribute("aria-controls")).hidden = !active;
    });
    if (focus) tab.focus();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", event => {
      let next;
      if (event.key === "ArrowRight") next = tabs[(index + 1) % tabs.length];
      if (event.key === "ArrowLeft") next = tabs[(index + tabs.length - 1) % tabs.length];
      if (event.key === "Home") next = tabs[0];
      if (event.key === "End") next = tabs.at(-1);
      if (next) { event.preventDefault(); select(next, true); }
    });
  });
}

function wireDemo() {
  document.querySelectorAll("[data-tabs]").forEach(wireTabs);
  document.querySelectorAll("[data-operand-kind]").forEach(select => {
    select.addEventListener("change", () => {
      const root = select.closest(".fl-panel");
      ["signal", "constant", "null"].forEach(kind => { root.querySelector(`[data-operand-${kind}]`).hidden = select.value !== kind; });
    });
  });
  document.querySelectorAll("[data-output-rule]").forEach(root => {
    root.querySelector("[data-output-mode]").addEventListener("change", event => {
      root.querySelector("[data-output-fixed]").hidden = event.target.value !== "fixed";
      root.querySelector("[data-output-copy]").hidden = event.target.value !== "copy";
    });
  });
  document.querySelectorAll("[data-network-picker]").forEach(root => {
    const input = root.querySelector("[data-network-query]");
    const list = root.querySelector("[data-network-results]");
    const feedback = root.closest(".fl-panel").querySelector("[data-network-feedback]");
    const refresh = () => {
      const query = input.value;
      const options = [...root.querySelectorAll("[data-network-name]")];
      const ranked = options.map((option, index) => {
        const name = option.dataset.networkName;
        const service = option.dataset.networkKind === "service";
        const matches = query === "" || name.startsWith(query);
        let rank = 1;
        if (!matches) rank = 3;
        else if (service) rank = 2;
        else if (name === query) rank = 0;
        return { option, index, rank, matches, length: name.length };
      });
      ranked.sort((a, b) => a.rank - b.rank || a.length - b.length || a.index - b.index);
      ranked.forEach(({ option, matches }) => {
        option.hidden = !matches;
        list.append(option);
      });
      list.hidden = false;
    };
    const finish = reason => {
      if (list.hidden) return;
      list.hidden = true;
      feedback.textContent = `Имя завершено по ${reason}: ${input.value}. Это демонстрация, сеть в Circuit не создаётся.`;
    };
    refresh();
    input.addEventListener("input", refresh);
    root.querySelectorAll("[data-network-name]").forEach(option => option.addEventListener("click", () => {
      const requested = option.dataset.networkName;
      input.value = requested === "green_new" ? "green_1" : requested;
      list.hidden = true;
      feedback.textContent = `Подставлено: ${input.value}. Это демонстрация, сеть в Circuit не создаётся.`;
      input.focus();
    }));
    input.addEventListener("keydown", event => {
      if (event.key === "Escape") finish("Esc");
      if (event.key === "Tab") finish("Tab");
      if (event.key === "ArrowDown") {
        const first = [...root.querySelectorAll("[data-network-name]")].find(option => !option.hidden);
        if (first && !list.hidden) { event.preventDefault(); first.focus(); }
      }
    });
    document.addEventListener("pointerdown", event => {
      if (root.contains(event.target)) return;
      finish("клику");
    });
  });
  document.querySelectorAll("[data-signal-picker]").forEach(root => {
    const choices = [...root.querySelectorAll("[data-signal-name]")];
    root.querySelector("[data-signal-query]").addEventListener("input", event => {
      const query = event.target.value.toLocaleLowerCase("ru").trim();
      choices.forEach(choice => { choice.hidden = !choice.dataset.signalName.toLocaleLowerCase("ru").includes(query); });
      root.querySelector("[data-signal-empty]").hidden = choices.some(choice => !choice.hidden);
    });
    choices.forEach(choice => choice.addEventListener("click", () => {
      choices.forEach(item => item.setAttribute("aria-pressed", String(item === choice)));
      root.querySelector("[data-signal-selection]").textContent = `Выбрано: ${choice.querySelector(".fl-choice__label").textContent}`;
    }));
  });
  document.querySelectorAll("[data-timeline]").forEach(root => {
    const ticks = [...root.querySelectorAll(".fl-timeline__tick")];
    ticks.forEach(tick => tick.addEventListener("click", () => {
      ticks.forEach(item => item.setAttribute("aria-pressed", String(item === tick)));
      root.querySelector("[data-timeline-status]").textContent = `Выбрано ${tick.textContent}. Каталог показывает состояние шкалы; восстановление границы выполняет страница отладчика.`;
    }));
  });
  document.querySelectorAll("[data-open-dialog]").forEach(button => {
    button.addEventListener("click", () => {
      const host = button.closest("[data-ui]") ?? document;
      (host.querySelector("dialog") ?? document.querySelector("dialog"))?.showModal();
    });
  });
  document.querySelectorAll("[data-about-open]").forEach(button => {
    const dialog = button.parentElement?.querySelector("[data-about-dialog]")
      ?? document.querySelector("[data-about-dialog]");
    button.addEventListener("click", () => dialog?.showModal());
  });
  document.querySelectorAll("dialog").forEach(dialog => {
    dialog.addEventListener("close", () => {
      const feedback = document.querySelector("[data-dialog-feedback]");
      if (!feedback || dialog.returnValue !== "create") return;
      const form = dialog.querySelector("form");
      feedback.textContent = `Пример имени: ${form.elements.color.value}_${form.elements.suffix.value}. Данные не сохранены в схему.`;
    });
  });
  document.querySelectorAll("[data-project-file]").forEach((root) => {
    const dialog = root.querySelector("dialog");
    const feedback = root.querySelector("[data-project-feedback]");
    root.querySelector("[data-project-save]")?.addEventListener("click", () => dialog?.showModal());
    dialog?.addEventListener("close", () => {
      if (!feedback) return;
      feedback.textContent = dialog.returnValue === "replace" || dialog.returnValue === "rename"
        ? "Образец: хранилище не изменялось."
        : "Образец библиотеки. Сохранение подключено на странице схемы.";
    });
  });
  document.querySelectorAll(".fl-editor textarea").forEach(input => {
    input.addEventListener("input", () => {
      const status = input.closest('[role="tabpanel"]')?.querySelector("[data-edit-status]");
      if (status) status.textContent = "Изменено · демо без проверки кода";
    });
  });
}

const results = await Promise.allSettled([...document.querySelectorAll("[data-ui]")].map(include));
if (results.some(result => result.status === "rejected")) {
  document.documentElement.dataset.uiReady = "error";
} else {
  mountWidgets(document);
  wireDemo();
  mountCompact(document);
  document.querySelectorAll("[data-docs]").forEach(mountDocumentation);
  document.documentElement.dataset.uiReady = "true";
}
