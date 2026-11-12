import { describe, expect, it } from 'vitest';
import { createRandom, fork, hashSeed, integer, pick, range } from './random';

describe('seeded randomness', () => {
  it('repeats the same sequence for the same seed', () => {
    const a = createRandom('rust');
    const b = createRandom('rust');
    const first = Array.from({ length: 8 }, () => a());
    const second = Array.from({ length: 8 }, () => b());
    expect(first).toEqual(second);
  });

  it('differs between seeds', () => {
    expect(createRandom('rust')()).not.toEqual(createRandom('go')());
  });

  it('stays inside [0, 1)', () => {
    const random = createRandom(7);
    for (let i = 0; i < 5000; i += 1) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('hashes strings to unsigned 32-bit seeds', () => {
    expect(hashSeed('')).toBe(0x811c9dc5);
    expect(hashSeed('zero-to')).toBeGreaterThanOrEqual(0);
    expect(hashSeed('zero-to')).toBeLessThan(2 ** 32);
  });

  it('keeps range, integer and pick inside their bounds', () => {
    const random = createRandom(42);
    for (let i = 0; i < 1000; i += 1) {
      const r = range(random, -2, 3);
      expect(r).toBeGreaterThanOrEqual(-2);
      expect(r).toBeLessThan(3);
      const n = integer(random, 1, 6);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(6);
      expect(['a', 'b', 'c']).toContain(pick(random, ['a', 'b', 'c']));
    }
    expect(() => pick(random, [])).toThrow();
  });

  it('forks independent streams that do not depend on call order', () => {
    const trailFirst = fork('rust', 'trail')();
    fork('rust', 'grass')();
    expect(fork('rust', 'trail')()).toEqual(trailFirst);
    expect(fork('rust', 'trail')()).not.toEqual(fork('rust', 'grass')());
  });
});
