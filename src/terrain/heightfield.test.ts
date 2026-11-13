import { describe, expect, it } from 'vitest';
import { createRandom } from '../core/random';
import {
  DEFAULT_RESOLUTION,
  TERRAIN_TEMPLATE_IDS,
  generateHeightfield,
  heightfieldFromData,
  resolveTerrainTemplate,
} from './heightfield';
import { createNoise2D, fbm } from './noise';

const SEEDS = ['rust', 'langgraph', 7, 20261113];

describe('noise', () => {
  it('repeats for the same seed and stays in range', () => {
    const a = createNoise2D(createRandom('n'));
    const b = createNoise2D(createRandom('n'));
    let low = Infinity;
    let high = -Infinity;
    for (let i = 0; i < 4000; i += 1) {
      const x = (i % 63) * 0.173 - 5;
      const y = Math.floor(i / 63) * 0.211 - 7;
      const value = a(x, y);
      expect(value).toBe(b(x, y));
      low = Math.min(low, value);
      high = Math.max(high, value);
    }
    expect(low).toBeGreaterThanOrEqual(-1.05);
    expect(high).toBeLessThanOrEqual(1.05);
    expect(high - low).toBeGreaterThan(1);
  });

  it('keeps fbm in range', () => {
    const noise = createNoise2D(createRandom(3));
    for (let i = 0; i < 500; i += 1) {
      const value = fbm(noise, i * 0.37, i * -0.21, 5);
      expect(Math.abs(value)).toBeLessThanOrEqual(1.05);
    }
  });
});

describe('generateHeightfield', () => {
  it('uses 129 nodes per side by default', () => {
    const field = generateHeightfield({ seed: 'a', template: 'massif' });
    expect(DEFAULT_RESOLUTION).toBe(129);
    expect(field.resolution).toBe(129);
    expect(field.data.length).toBe(129 * 129);
  });

  it('gives the same mountain for the same spec', () => {
    for (const template of [...TERRAIN_TEMPLATE_IDS, 'random'] as const) {
      const a = generateHeightfield({ seed: 'rust', template, resolution: 65 });
      const b = generateHeightfield({ seed: 'rust', template, resolution: 65 });
      expect(Array.from(a.data)).toEqual(Array.from(b.data));
      expect(a.summit).toEqual(b.summit);
      expect(a.template).toBe(b.template);
    }
  });

  it('gives different mountains for different seeds', () => {
    const a = generateHeightfield({ seed: 'rust', template: 'massif', resolution: 65 });
    const b = generateHeightfield({ seed: 'go', template: 'massif', resolution: 65 });
    let differing = 0;
    for (let i = 0; i < a.data.length; i += 1) if (a.data[i] !== b.data[i]) differing += 1;
    expect(differing).toBeGreaterThan(a.data.length / 2);
  });

  for (const template of TERRAIN_TEMPLATE_IDS) {
    it(`${template}: one summit at exactly 1, heights in 0..1, border at 0`, () => {
      for (const seed of SEEDS) {
        const field = generateHeightfield({ seed, template });
        const n = field.resolution;
        let max = -Infinity;
        let min = Infinity;
        let tops = 0;
        let finite = true;
        for (const value of field.data) {
          if (!Number.isFinite(value)) finite = false;
          max = Math.max(max, value);
          min = Math.min(min, value);
          if (value === 1) tops += 1;
        }
        expect(finite).toBe(true);
        expect(max).toBe(1);
        expect(min).toBe(0);
        expect(tops).toBe(1);
        expect(field.summit.h).toBe(1);
        expect(field.sample(field.summit.x, field.summit.z)).toBeCloseTo(1, 5);
        // The summit stands well inside the footprint.
        expect(Math.abs(field.summit.x)).toBeLessThan(0.8);
        expect(Math.abs(field.summit.z)).toBeLessThan(0.8);
        let border = 0;
        for (let k = 0; k < n; k += 1) {
          border = Math.max(border, field.at(k, 0), field.at(k, n - 1), field.at(0, k), field.at(n - 1, k));
        }
        expect(border).toBe(0);
        // Real relief: a fair share of the footprint is mountain, and a fair share is low ground.
        let high = 0;
        let low = 0;
        for (const value of field.data) {
          if (value > 0.3) high += 1;
          if (value < 0.1) low += 1;
        }
        expect(high / field.data.length).toBeGreaterThan(0.05);
        expect(low / field.data.length).toBeGreaterThan(0.1);
      }
    });
  }

  it('volcano has a crater: the middle of the rim is lower than the rim', () => {
    for (const seed of SEEDS) {
      const field = generateHeightfield({ seed, template: 'volcano', roughness: 0.2 });
      // Walk from the summit through the middle of the mountain: the ground dips and rises again.
      let centreX = 0;
      let centreZ = 0;
      let weight = 0;
      const n = field.resolution;
      for (let j = 0; j < n; j += 1) {
        for (let i = 0; i < n; i += 1) {
          const h = field.at(i, j);
          if (h > 0.5) {
            weight += 1;
            centreX += -1 + (2 * i) / (n - 1);
            centreZ += -1 + (2 * j) / (n - 1);
          }
        }
      }
      const middle = field.sample(centreX / weight, centreZ / weight);
      expect(middle).toBeLessThan(0.93);
      expect(middle).toBeGreaterThan(0.45);
    }
  });

  it('twin peaks has a second summit and a saddle between the two', () => {
    for (const seed of SEEDS) {
      const field = generateHeightfield({ seed, template: 'twin-peaks', roughness: 0.2 });
      const n = field.resolution;
      // The highest node that is a local top and lies away from the main summit.
      let second = { x: 0, z: 0, h: 0 };
      for (let j = 2; j < n - 2; j += 1) {
        for (let i = 2; i < n - 2; i += 1) {
          const h = field.at(i, j);
          const x = -1 + (2 * i) / (n - 1);
          const z = -1 + (2 * j) / (n - 1);
          if (Math.hypot(x - field.summit.x, z - field.summit.z) < 0.35) continue;
          if (h > second.h) second = { x, z, h };
        }
      }
      expect(second.h).toBeGreaterThan(0.6);
      let lowest = 1;
      for (let k = 0; k <= 40; k += 1) {
        const t = k / 40;
        lowest = Math.min(
          lowest,
          field.sample(field.summit.x + (second.x - field.summit.x) * t, field.summit.z + (second.z - field.summit.z) * t),
        );
      }
      expect(lowest).toBeLessThan(second.h - 0.08);
      expect(lowest).toBeGreaterThan(0.2);
    }
  });

  it('plateau has a wide flat top', () => {
    for (const seed of SEEDS) {
      const field = generateHeightfield({ seed, template: 'plateau' });
      let top = 0;
      for (const value of field.data) if (value > 0.8) top += 1;
      expect(top / field.data.length).toBeGreaterThan(0.08);
    }
  });

  it('canyon cuts a channel down to the sheet between two pieces of higher ground', () => {
    for (const seed of SEEDS) {
      const field = generateHeightfield({ seed, template: 'canyon' });
      const n = field.resolution;
      // Somewhere inside the footprint there is floor with clearly higher ground a short way off on both sides.
      let found = false;
      for (let j = 20; j < n - 20 && !found; j += 2) {
        for (let i = 20; i < n - 20 && !found; i += 2) {
          if (field.at(i, j) > 0.02) continue;
          for (const [di, dj] of [
            [1, 0],
            [0, 1],
            [1, 1],
            [1, -1],
          ] as const) {
            if (field.at(i + di * 12, j + dj * 12) > 0.15 && field.at(i - di * 12, j - dj * 12) > 0.15) found = true;
          }
        }
      }
      expect(found).toBe(true);
    }
  });

  it("'random' picks a template from the seed and says which", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed += 1) {
      const template = resolveTerrainTemplate({ seed, template: 'random' });
      expect(TERRAIN_TEMPLATE_IDS).toContain(template);
      expect(generateHeightfield({ seed, template: 'random', resolution: 33 }).template).toBe(template);
      seen.add(template);
    }
    expect(seen.size).toBe(TERRAIN_TEMPLATE_IDS.length);
  });

  it('rougher ground is less smooth', () => {
    const wiggle = (roughness: number): number => {
      const field = generateHeightfield({ seed: 'r', template: 'massif', roughness });
      const n = field.resolution;
      let sum = 0;
      for (let j = 1; j < n - 1; j += 1) {
        for (let i = 1; i < n - 1; i += 1) {
          sum += Math.abs(field.at(i - 1, j) + field.at(i + 1, j) + field.at(i, j - 1) + field.at(i, j + 1) - 4 * field.at(i, j));
        }
      }
      return sum;
    };
    expect(wiggle(1)).toBeGreaterThan(wiggle(0) * 1.3);
  });

  it('samples bilinearly and clamps outside the footprint', () => {
    const data = new Float32Array([0, 1, 2, 3]);
    const field = heightfieldFromData(2, data);
    expect(field.sample(-1, -1)).toBe(0);
    expect(field.sample(1, -1)).toBe(1);
    expect(field.sample(-1, 1)).toBe(2);
    expect(field.sample(1, 1)).toBe(3);
    expect(field.sample(0, 0)).toBeCloseTo(1.5, 6);
    expect(field.sample(0, -1)).toBeCloseTo(0.5, 6);
    expect(field.sample(9, 9)).toBe(3);
    expect(field.sample(-9, -9)).toBe(0);
    expect(field.summit).toEqual({ x: 1, z: 1, h: 3 });
  });

  it('honours the resolution and rejects an unknown template', () => {
    expect(generateHeightfield({ seed: 1, template: 'ridge', resolution: 65 }).resolution).toBe(65);
    expect(() => generateHeightfield({ seed: 1, template: 'hill' as never })).toThrow();
  });
});
