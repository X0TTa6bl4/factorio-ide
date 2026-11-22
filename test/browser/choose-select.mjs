/** Открывает общий выбор и подтверждает пункт. Нативный select на страницах не используется. */

export async function chooseSelect(page, id, value) {
  const box = page.locator(`#${id}`);
  await box.locator(".fl-selectbox__control").click();
  await box.locator(`[role="option"][data-value="${value}"]`).click();
}
