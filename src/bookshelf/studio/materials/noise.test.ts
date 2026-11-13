import { describe, expect, it } from 'vitest';
import { cells, fbm, hash1, hash2, seededRandom, toInt, valueNoise, type Cells } from './noise';

describe('seeded noise', () => {
  it('gives the same sequence for the same seed and another for another seed', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    const c = seededRandom(43);
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect([c(), c(), c()]).not.toEqual(first);
    for (const value of first) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('turns any number into an integer seed', () => {
    expect(toInt(Number.NaN)).toBe(0);
    expect(toInt(Number.POSITIVE_INFINITY)).toBe(0);
    expect(toInt(7)).toBe(7);
    expect(toInt(7.25)).not.toBe(toInt(7.5));
    expect(Number.isInteger(toInt(0.3))).toBe(true);
  });

  it('hashes lattice points evenly into [0, 1)', () => {
    let sum = 0;
    let low = 1;
    let high = 0;
    const count = 4000;
    for (let index = 0; index < count; index += 1) {
      const value = hash2(index % 61, Math.floor(index / 61), 5);
      sum += value;
      low = Math.min(low, value);
      high = Math.max(high, value);
    }
    expect(low).toBeGreaterThanOrEqual(0);
    expect(high).toBeLessThan(1);
    expect(sum / count).toBeGreaterThan(0.47);
    expect(sum / count).toBeLessThan(0.53);
    expect(hash1(101, 1)).toBe(hash1(101, 1));
    expect(hash1(101, 1)).not.toBe(hash1(101, 2));
  });

  it('value noise stays in range, is continuous and repeats at its period', () => {
    for (let step = 0; step < 200; step += 1) {
      const x = step * 0.173;
      const y = step * 0.091;
      const value = valueNoise(x, y, 8, 4, 3);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
      expect(valueNoise(x + 8, y, 8, 4, 3)).toBeCloseTo(value, 10);
      expect(valueNoise(x, y + 4, 8, 4, 3)).toBeCloseTo(value, 10);
      expect(Math.abs(valueNoise(x + 0.001, y, 8, 4, 3) - value)).toBeLessThan(0.01);
    }
  });

  it('fractal noise repeats across one tile', () => {
    for (let step = 0; step < 50; step += 1) {
      const u = step / 50;
      expect(fbm(0, u, 3, 5, 9)).toBeCloseTo(fbm(1, u, 3, 5, 9), 10);
      expect(fbm(u, 0, 3, 5, 9)).toBeCloseTo(fbm(u, 1, 3, 5, 9), 10);
      expect(fbm(u, 0.3, 3, 5, 9)).toBeGreaterThanOrEqual(0);
      expect(fbm(u, 0.3, 3, 5, 9)).toBeLessThanOrEqual(1);
    }
  });

  it('cells give ordered distances and repeat at their period', () => {
    const a: Cells = { f1: 0, f2: 0, id: 0 };
    const b: Cells = { f1: 0, f2: 0, id: 0 };
    for (let step = 0; step < 100; step += 1) {
      const x = step * 0.37;
      const y = step * 0.11;
      cells(x, y, 6, 4, a);
      cells(x + 6, y - 6, 6, 4, b);
      expect(a.f1).toBeLessThanOrEqual(a.f2);
      expect(a.f1).toBeGreaterThanOrEqual(0);
      expect(b.f1).toBeCloseTo(a.f1, 9);
      expect(b.f2).toBeCloseTo(a.f2, 9);
      expect(b.id).toBe(a.id);
    }
  });
});
