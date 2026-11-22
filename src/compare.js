/** Сравнение строк по кодам UTF-16, без локали машины. */

export function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
