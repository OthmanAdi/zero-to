/**
 * Seeded, tileable noise. Everything here is a pure function of its arguments, so a tile made from it
 * is the same on every machine and wraps without a seam. No three.js, no DOM.
 */

/** Small seeded generator (mulberry32). Returns numbers in [0, 1). */
export function seededRandom(seed: number): () => number {
  let state = toInt(seed) || 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Any number as a 32 bit integer: fractions are kept apart, NaN and infinity become 0. */
export function toInt(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const whole = Math.floor(value);
  const fraction = value - whole;
  return (whole | 0) ^ (fraction === 0 ? 0 : Math.imul((fraction * 4294967296) | 0, 0x45d9f3b));
}

/** Hash of a lattice point, in [0, 1). */
export function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Hash of one integer and a salt, in [0, 1). Used for the choices that follow from an item's seed. */
export function hash1(value: number, salt: number): number {
  return hash2(toInt(value), 0x51ed27 + salt, 0x1b873593 + salt);
}

function wrap(value: number, period: number): number {
  const rest = value % period;
  return rest < 0 ? rest + period : rest;
}

function smooth(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Value noise on a lattice that repeats every `periodX` by `periodY` cells, in [0, 1].
 * Sample it at `x = u * periodX` to cover one tile exactly.
 */
export function valueNoise(x: number, y: number, periodX: number, periodY: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smooth(x - x0);
  const ty = smooth(y - y0);
  const xa = wrap(x0, periodX);
  const xb = wrap(x0 + 1, periodX);
  const ya = wrap(y0, periodY);
  const yb = wrap(y0 + 1, periodY);
  const a = hash2(xa, ya, seed);
  const b = hash2(xb, ya, seed);
  const c = hash2(xa, yb, seed);
  const d = hash2(xb, yb, seed);
  return a + (b - a) * tx + (c - a + (a - b - c + d) * tx) * ty;
}

/**
 * Fractal sum of value noise that still tiles: each octave doubles the lattice and its period together.
 * `u` and `v` run 0 to 1 across the tile. Result in [0, 1].
 */
export function fbm(u: number, v: number, periodX: number, periodY: number, seed: number, octaves = 4, gain = 0.5): number {
  let sum = 0;
  let weight = 1;
  let total = 0;
  let px = periodX;
  let py = periodY;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += weight * valueNoise(u * px, v * py, px, py, seed + octave * 101);
    total += weight;
    weight *= gain;
    px *= 2;
    py *= 2;
  }
  return sum / total;
}

/** Nearest and second nearest feature point of a tileable cell pattern, and an id for the nearest cell. */
export interface Cells {
  /** Distance to the nearest point, in cells. */
  f1: number;
  /** Distance to the second nearest point, in cells. */
  f2: number;
  /** Stable random number of the nearest cell, in [0, 1). */
  id: number;
}

/**
 * Worley cells on a grid that repeats every `period` cells. Writes into `out` and returns it, so a tile
 * loop allocates nothing.
 */
export function cells(x: number, y: number, period: number, seed: number, out: Cells, jitter = 0.9): Cells {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  let f1 = 9;
  let f2 = 9;
  let id = 0;
  for (let oy = -1; oy <= 1; oy += 1) {
    for (let ox = -1; ox <= 1; ox += 1) {
      const gx = cx + ox;
      const gy = cy + oy;
      const wx = wrap(gx, period);
      const wy = wrap(gy, period);
      const px = gx + 0.5 + (hash2(wx, wy, seed) - 0.5) * jitter;
      const py = gy + 0.5 + (hash2(wx, wy, seed + 57) - 0.5) * jitter;
      const dx = px - x;
      const dy = py - y;
      const distance = dx * dx + dy * dy;
      if (distance < f1) {
        f2 = f1;
        f1 = distance;
        id = hash2(wx, wy, seed + 113);
      } else if (distance < f2) {
        f2 = distance;
      }
    }
  }
  out.f1 = Math.sqrt(f1);
  out.f2 = Math.sqrt(f2);
  out.id = id;
  return out;
}
