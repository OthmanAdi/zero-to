/**
 * Seeded randomness. Every generated trail, mountain and decoration in zero-to comes from a seed, so the same
 * roadmap always draws the same landscape and a shared link shows the receiver exactly what the sender saw.
 */

/** A source of numbers in [0, 1). */
export type Random = () => number;

/** Turns any string into a 32-bit seed (FNV-1a). Topic names and roadmap ids become seeds this way. */
export function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Mulberry32: small, fast and good enough for landscapes. Not for anything that needs to be secret. */
export function createRandom(seed: number | string): Random {
  let state = (typeof seed === 'string' ? hashSeed(seed) : seed) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A number in [min, max). */
export function range(random: Random, min: number, max: number): number {
  return min + (max - min) * random();
}

/** An integer in [min, max], both ends included. */
export function integer(random: Random, min: number, max: number): number {
  return Math.floor(min + (max - min + 1) * random());
}

/** One element of a list that is not empty. */
export function pick<T>(random: Random, list: readonly T[]): T {
  if (list.length === 0) throw new Error('pick: the list is empty');
  return list[Math.min(list.length - 1, Math.floor(random() * list.length))] as T;
}

/** A child stream: the same parent seed and label always give the same child, independent of call order. */
export function fork(seed: number | string, label: string): Random {
  const base = typeof seed === 'string' ? seed : String(seed >>> 0);
  return createRandom(hashSeed(`${base}/${label}`));
}
