/** Меню шапки: руководство и замена рабочего черновика редактора. */

import { CONFIGURATION_EXAMPLE } from "../src/config-editor.js";
import { mountDetailsMenu } from "../ui/scripts/details-menu.js";

export const DRAFT_KEY = "f-logic.editor-draft.v1";
export const CLEAR_MESSAGE = "Очистить рабочий черновик? Правки схемы и сценария этой вкладки будут потеряны. Сохранённые схемы не удаляются.";
export const WRITE_FAILURE = "Не удалось записать черновик. Проект не очищен.";

export function storedDraftChanged() {
  try {
    const value = sessionStorage.getItem(DRAFT_KEY);
    return value !== null && value !== CONFIGURATION_EXAMPLE;
  } catch {
    return true;
  }
}

export function writeInitialDraft() {
  try {
    sessionStorage.setItem(DRAFT_KEY, CONFIGURATION_EXAMPLE);
    return sessionStorage.getItem(DRAFT_KEY) === CONFIGURATION_EXAMPLE;
  } catch {
    try {
      return sessionStorage.getItem(DRAFT_KEY) === CONFIGURATION_EXAMPLE;
    } catch {
      return false;
    }
  }
}

export function mountTopbarMenu(options = {}) {
  const menu = document.querySelector("[data-topbar-menu]");
  if (!menu || menu.dataset.clearBound === "app") return;
  menu.dataset.clearBound = "app";
  mountDetailsMenu(menu);
  menu.querySelector("[data-clear-project]")?.addEventListener("click", () => {
    const dirty = options.changed ? options.changed() : storedDraftChanged();
    if (dirty && window.confirm(CLEAR_MESSAGE) !== true) {
      menu.open = false;
      menu.querySelector("summary")?.focus();
      return;
    }
    if (!writeInitialDraft()) {
      window.alert(WRITE_FAILURE);
      menu.open = false;
      menu.querySelector("summary")?.focus();
      return;
    }
    options.apply?.();
    menu.open = false;
    menu.querySelector("summary")?.focus();
  });
}

const topbarMenu = document.querySelector("[data-topbar-menu]");
if (topbarMenu && !topbarMenu.hasAttribute("data-topbar-owner")) mountTopbarMenu();
