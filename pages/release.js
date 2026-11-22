/** Сведения выпуска: номер снимка каталога и граница заявленной совместимости. */

export const CATALOG_VERSION = "2.1.24";
export const VERSION_CHECKED_ON = "2026-11-19";
export const GAME_BEHAVIOR_VERIFIED = false;

export const RELEASE_NOTE = "Каталог сигналов сверен со снимком Factorio 2.1.24. Проверка stable 19.11.2026 подтвердила номер версии, а не поведение этих схем. Демонстрации считают по проектной модели; игровой прогон не выполнялся, совместимость вычислений с игрой не заявлена.";

export const EVENT_DEMO = Object.freeze({
  title: "Сценарий Arrival",
  kinds: "Событийный, Worker",
  expect: "Граница 0: красная сеть пуста, arrived = false. Граница 1 и следующие удержания: signal-A = 1, arrived = true.",
});

export function mountReleaseNote(element) {
  if (!element) return;
  element.textContent = RELEASE_NOTE;
  element.dataset.catalog = CATALOG_VERSION;
  element.dataset.checkedOn = VERSION_CHECKED_ON;
  element.dataset.gameBehavior = GAME_BEHAVIOR_VERIFIED ? "verified" : "unverified";
}

export function mountAbout(root = document) {
  mountReleaseNote(root.querySelector("[data-release-text]"));
  const dialog = root.querySelector("[data-about-dialog]");
  const open = root.querySelector("[data-about-open]");
  if (!dialog || !open || open.dataset.aboutReady === "true") return;
  open.dataset.aboutReady = "true";
  open.addEventListener("click", () => dialog.showModal());
}
