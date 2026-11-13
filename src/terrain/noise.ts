import type { Random } from '../core/random';

/** A smooth 2D noise function with values in about [-1, 1]. */
export type Noise2D = (x: number, y: number) => number;

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

/** Twelve gradient directions, evenly spread round the circle. */
const GRADIENTS: readonly (readonly [number, number])[] = Array.from({ length: 12 }, (_, index) => {
  const angle = (index / 12) * Math.PI * 2 + 0.13;
  return [Math.cos(angle), Math.sin(angle)] as const;
});

/**
 * Simplex noise in two dimensions. The permutation table is shuffled with the given random source, so one seed
 * always gives the same landscape.
 */
export function createNoise2D(random: Random): Noise2D {
  const table = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) table[i] = i;
  for (let i = 255; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const swap = table[i] as number;
    table[i] = table[j] as number;
    table[j] = swap;
  }
  const perm = new Uint8Array(512);
  const grad = new Uint8Array(512);
  for (let i = 0; i < 512; i += 1) {
    perm[i] = table[i & 255] as number;
    grad[i] = (perm[i] as number) % 12;
  }

  const corner = (gi: number, x: number, y: number): number => {
    const falloff = 0.5 - x * x - y * y;
    if (falloff <= 0) return 0;
    const g = GRADIENTS[gi] as readonly [number, number];
    const f2 = falloff * falloff;
    return f2 * f2 * (g[0] * x + g[1] * y);
  };

  return (x, y) => {
    const skew = (x + y) * F2;
    const i = Math.floor(x + skew);
    const j = Math.floor(y + skew);
    const unskew = (i + j) * G2;
    const x0 = x - (i - unskew);
    const y0 = y - (j - unskew);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = 1 - i1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    const g0 = grad[ii + (perm[jj] as number)] as number;
    const g1 = grad[ii + i1 + (perm[jj + j1] as number)] as number;
    const g2 = grad[ii + 1 + (perm[jj + 1] as number)] as number;
    return 70 * (corner(g0, x0, y0) + corner(g1, x1, y1) + corner(g2, x2, y2));
  };
}

/** Fractal Brownian motion: octaves of the same noise, each finer and weaker. The sum stays in about [-1, 1]. */
export function fbm(noise: Noise2D, x: number, y: number, octaves: number, gain = 0.5, lacunarity = 2): number {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let total = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    // Each octave reads a shifted copy, so the octaves do not line up at the origin.
    sum += amplitude * noise(x * frequency + octave * 17.31, y * frequency - octave * 9.73);
    total += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return total > 0 ? sum / total : 0;
}
