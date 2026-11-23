/** Нативное details-меню: Escape, клик снаружи и удержание панели в окне. */

export function mountDetailsMenu(menu) {
  if (!menu || menu.dataset.menuReady === "true" || menu.classList.contains("fl-menu--static")) return;
  menu.dataset.menuReady = "true";
  const summary = menu.querySelector("summary");
  const panel = menu.querySelector(".fl-menu__items");

  function place() {
    if (!panel || !menu.open) return;
    panel.style.transform = "";
    const rect = panel.getBoundingClientRect();
    const margin = 8;
    let shift = 0;
    if (rect.left < margin) shift = margin - rect.left;
    else if (rect.right > window.innerWidth - margin) shift = window.innerWidth - margin - rect.right;
    if (shift !== 0) panel.style.transform = `translateX(${shift}px)`;
  }

  menu.addEventListener("toggle", place);
  window.addEventListener("resize", place);

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !menu.open || event.defaultPrevented) return;
    if (document.querySelector("dialog[open]")) return;
    if (document.querySelector("[data-select][data-open='true']")) return;
    event.preventDefault();
    menu.open = false;
    summary?.focus();
  });

  document.addEventListener("pointerdown", (event) => {
    if (!menu.open || menu.contains(event.target)) return;
    menu.open = false;
  });
}
