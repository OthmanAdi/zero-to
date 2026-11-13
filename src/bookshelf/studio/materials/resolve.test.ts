import { describe, expect, it } from 'vitest';
import { BINDINGS, STAMPS, type Binding, type Stamp } from '../types';
import { BINDING_WEIGHTS, LOOK_BINDING_WEIGHTS, STAMP_WEIGHTS, resolveBinding, resolveStamp } from './resolve';

const seeds = Array.from({ length: 6000 }, (_, index) => 101 + index * 37);

describe('resolveBinding', () => {
  it('keeps a binding the item names and ignores an unknown one', () => {
    for (const binding of BINDINGS) expect(resolveBinding(binding, 5)).toBe(binding);
    expect(BINDINGS).toContain(resolveBinding('vellum', 5));
    expect(resolveBinding('vellum', 5)).toBe(resolveBinding(undefined, 5));
  });

  it('answers the same for the same seed', () => {
    for (const seed of seeds.slice(0, 200)) expect(resolveBinding(undefined, seed)).toBe(resolveBinding(undefined, seed));
    expect(BINDINGS).toContain(resolveBinding(undefined, Number.NaN));
    expect(BINDINGS).toContain(resolveBinding(undefined, 0.5));
  });

  it('binds most volumes in cloth or linen and few in foil', () => {
    const counts = Object.fromEntries(BINDINGS.map((binding) => [binding, 0])) as Record<Binding, number>;
    for (const seed of seeds) counts[resolveBinding(undefined, seed)] += 1;
    const share = (binding: Binding) => counts[binding] / seeds.length;
    for (const [binding, weight] of BINDING_WEIGHTS) {
      expect(share(binding)).toBeGreaterThan((weight / 100) * 0.7 - 0.005);
      expect(share(binding)).toBeLessThan((weight / 100) * 1.3 + 0.005);
    }
    expect(share('cloth') + share('linen')).toBeGreaterThan(0.5);
    expect(share('velvet') + share('foil') + share('holo')).toBeLessThan(0.12);
    // A whole board of metal or holographic foil is a showpiece: about one volume in fifty.
    expect(share('foil') + share('holo')).toBeLessThan(0.035);
    expect(share('holo')).toBeLessThan(0.016);
    expect(share('cloth')).toBeGreaterThan(share('leather'));
    expect(share('leather')).toBeGreaterThan(share('gloss'));
  });

  it('binds every Pocket Paperback in printed card, matt or laminated', () => {
    const seen = new Set<Binding>();
    for (const seed of seeds.slice(0, 2000)) seen.add(resolveBinding(undefined, seed, 'pocket'));
    expect([...seen].sort()).toEqual(['gloss', 'paper']);
    expect(LOOK_BINDING_WEIGHTS.pocket!.map(([binding]) => binding)).toEqual(['paper', 'gloss']);
    // The item's own binding still wins, and the other looks keep the mixed shelf.
    expect(resolveBinding('leather', 5, 'pocket')).toBe('leather');
    for (const look of ['paper', 'oak', 'night', 'toString', '']) {
      for (const seed of seeds.slice(0, 50)) expect(resolveBinding(undefined, seed, look)).toBe(resolveBinding(undefined, seed));
    }
    expect(resolveBinding(undefined, 77, 'pocket')).toBe(resolveBinding(undefined, 77, 'pocket'));
  });

  it('does not run in a pattern along consecutive seeds', () => {
    let repeats = 0;
    for (let seed = 1; seed < 2000; seed += 1) if (resolveBinding(undefined, seed) === resolveBinding(undefined, seed + 1)) repeats += 1;
    // Independent draws from these weights agree about one time in four.
    expect(repeats / 2000).toBeGreaterThan(0.15);
    expect(repeats / 2000).toBeLessThan(0.35);
  });
});

describe('resolveStamp', () => {
  it('keeps a stamp the item names and ignores an unknown one', () => {
    for (const stamp of STAMPS) expect(resolveStamp(stamp, 'cloth', 5)).toBe(stamp);
    expect(STAMPS).toContain(resolveStamp('glitter', 'cloth', 5));
  });

  it('answers the same for the same seed and only with stamps that suit the binding', () => {
    for (const binding of BINDINGS) {
      const allowed = STAMP_WEIGHTS[binding].map(([stamp]) => stamp);
      const seen = new Set<Stamp>();
      for (const seed of seeds.slice(0, 1500)) {
        const stamp = resolveStamp(undefined, binding, seed);
        expect(resolveStamp(undefined, binding, seed)).toBe(stamp);
        expect(allowed).toContain(stamp);
        seen.add(stamp);
      }
      expect(seen.size).toBe(allowed.length);
    }
  });

  it('letters leather mostly in gold and paper mostly in ink', () => {
    const count = (binding: Binding, stamp: Stamp) => seeds.filter((seed) => resolveStamp(undefined, binding, seed) === stamp).length / seeds.length;
    expect(count('leather', 'gold')).toBeGreaterThan(0.45);
    expect(count('paper', 'ink')).toBeGreaterThan(0.58);
    expect(count('foil', 'gold')).toBe(0);
  });

  it('puts holographic foil on a shelf as a stamp far more often than as a board', () => {
    let boards = 0;
    let stamps = 0;
    for (const seed of seeds) {
      const binding = resolveBinding(undefined, seed);
      if (binding === 'holo') boards += 1;
      else if (resolveStamp(undefined, binding, seed) === 'holo') stamps += 1;
    }
    expect(stamps).toBeGreaterThan(boards * 3);
    const weight = (binding: Binding) => STAMP_WEIGHTS[binding].find(([stamp]) => stamp === 'holo')?.[1] ?? 0;
    expect(weight('cloth')).toBeGreaterThan(0);
    expect(weight('gloss')).toBeGreaterThan(weight('cloth'));
    for (const binding of ['linen', 'leather', 'paper', 'velvet', 'foil', 'holo'] as const) expect(weight(binding)).toBe(0);
  });

  it('chooses the stamp apart from the binding', () => {
    const cloth = seeds.filter((seed) => resolveBinding(undefined, seed) === 'cloth');
    const gold = cloth.filter((seed) => resolveStamp(undefined, 'cloth', seed) === 'gold').length / cloth.length;
    expect(gold).toBeGreaterThan(0.26);
    expect(gold).toBeLessThan(0.42);
  });
});
