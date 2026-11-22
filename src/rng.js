/** RNG модели сценария: xorshift32 и начальное состояние FNV-1a. Это не RNG Factorio. */

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;
const RNG_FALLBACK = 0x6d2b79f5;

export function fnv1a32(text) {
  let hash = FNV_OFFSET;
  const bytes = new TextEncoder().encode(text);
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

export function initialRng(seed, id) {
  const value = (seed ^ fnv1a32(id)) >>> 0;
  return value === 0 ? RNG_FALLBACK : value;
}

export function xorshift32(value) {
  let state = value >>> 0;
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return state >>> 0;
}
