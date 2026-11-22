/** Арифметика каналов: знаковые 32-битные целые с переполнением. */

export const INT32_MIN = -2147483648;
export const INT32_MAX = 2147483647;

export function isInt32(value) {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= INT32_MIN
    && value <= INT32_MAX;
}

export function addInt32(left, right) {
  return Number(BigInt.asIntN(32, BigInt(left) + BigInt(right)));
}
