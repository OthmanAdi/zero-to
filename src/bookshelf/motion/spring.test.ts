import { describe, expect, it } from 'vitest';
import {
  clamp,
  easeInOutCubic,
  easeOutCubic,
  lerp,
  linear,
  SETTLE_SPRING,
  smoothstep,
  stepSpring,
  wrapIndex,
  type SpringState,
} from './spring';

/** Runs the spring in fixed frames until it reports rest, returning the trace of values. */
function settle(state: SpringState, target: number, frameMs: number, maxFrames = 600): number[] {
  const values: number[] = [];
  for (let frame = 0; frame < maxFrames; frame++) {
    const atRest = stepSpring(state, target, frameMs);
    values.push(state.value);
    if (atRest) break;
  }
  return values;
}

describe('stepSpring', () => {
  it('converges to the target without overshoot when critically damped', () => {
    const state: SpringState = { value: 0, velocity: 0 };
    const values = settle(state, 1, 1000 / 60);
    expect(Math.max(...values)).toBeLessThanOrEqual(1);
    expect(state.value).toBe(1);
  });

  it('does not overshoot when moving down either', () => {
    const state: SpringState = { value: 5, velocity: 0 };
    const values = settle(state, 2, 1000 / 60);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(2);
    expect(state.value).toBe(2);
  });

  it('overshoots when under-damped', () => {
    const state: SpringState = { value: 0, velocity: 0 };
    const config = { ...SETTLE_SPRING, dampingRatio: 0.3 };
    let peak = 0;
    for (let frame = 0; frame < 120; frame++) {
      stepSpring(state, 1, 1000 / 60, config);
      peak = Math.max(peak, state.value);
    }
    expect(peak).toBeGreaterThan(1.1);
  });

  it('snaps exactly to the target with zero velocity at rest', () => {
    const state: SpringState = { value: 0.9999, velocity: 0 };
    expect(stepSpring(state, 1, 4)).toBe(true);
    expect(state.value).toBe(1);
    expect(state.velocity).toBe(0);
  });

  it('reports not at rest while still far from the target', () => {
    const state: SpringState = { value: 0, velocity: 0 };
    expect(stepSpring(state, 1, 16)).toBe(false);
    expect(state.value).toBeGreaterThan(0);
  });

  it('stays stable and does not overshoot with a 64 ms frame', () => {
    const state: SpringState = { value: 0, velocity: 0 };
    const values = settle(state, 1, 64);
    for (const value of values) expect(Number.isFinite(value)).toBe(true);
    expect(Math.max(...values)).toBeLessThanOrEqual(1);
    expect(values.length).toBeLessThan(60);
    expect(state.value).toBe(1);
  });

  it('treats a 500 ms frame like the 64 ms cap and stays finite', () => {
    const late: SpringState = { value: 0, velocity: 0 };
    const capped: SpringState = { value: 0, velocity: 0 };
    stepSpring(late, 1, 500);
    stepSpring(capped, 1, 64);
    expect(Number.isFinite(late.value)).toBe(true);
    expect(late.value).toBeCloseTo(capped.value, 10);
    const values = settle(late, 1, 500);
    expect(Math.max(...values)).toBeLessThanOrEqual(1);
    expect(late.value).toBe(1);
  });

  it('ignores zero and negative frame times', () => {
    const state: SpringState = { value: 0, velocity: 0 };
    stepSpring(state, 1, 0);
    stepSpring(state, 1, -20);
    expect(state).toEqual({ value: 0, velocity: 0 });
  });

  it('reaches 95 percent of a unit move in about 340 ms at the default stiffness', () => {
    const state: SpringState = { value: 0, velocity: 0 };
    let elapsed = 0;
    while (state.value < 0.95 && elapsed < 2000) {
      stepSpring(state, 1, 1000 / 60);
      elapsed += 1000 / 60;
    }
    expect(elapsed).toBeGreaterThan(310);
    expect(elapsed).toBeLessThan(370);
  });

  it('settles within about a second at the default stiffness', () => {
    const state: SpringState = { value: 0, velocity: 0 };
    const values = settle(state, 3, 1000 / 60);
    expect(values.length * (1000 / 60)).toBeLessThan(1200);
  });
});

/** Small seeded generator so a failing case can be replayed. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (random: () => number, low: number, high: number): number => low + (high - low) * random();

/** Advances in whole frames of `frameMs` until `untilMs`, returning the final state and every value on the way. */
function run(
  start: SpringState,
  target: number,
  frameMs: number,
  untilMs: number,
): { state: SpringState; values: number[]; atRestAt: number | null } {
  const state = { ...start };
  const values: number[] = [];
  let atRestAt: number | null = null;
  const frames = Math.round(untilMs / frameMs);
  for (let frame = 1; frame <= frames; frame++) {
    const atRest = stepSpring(state, target, frameMs);
    values.push(state.value);
    if (atRest && atRestAt === null) atRestAt = frame * frameMs;
  }
  return { state, values, atRestAt };
}

describe('stepSpring properties', () => {
  const frameTimes = [1000 / 60, 1000 / 90, 1000 / 144];

  it('never overshoots when critically damped and not thrown at the target', () => {
    const random = seeded(20260511);
    for (let trial = 0; trial < 300; trial++) {
      const from = between(random, -20, 20);
      const target = between(random, -20, 20);
      if (Math.abs(target - from) < 0.01) continue;
      const direction = Math.sign(target - from);
      // Speed zero or pointing away from the target, as it is after a press or a reversed drag.
      const velocity = -direction * between(random, 0, 0.05) * (random() < 0.3 ? 0 : 1);
      const frameMs = frameTimes[trial % frameTimes.length]!;
      const { values } = run({ value: from, velocity }, target, frameMs, 3000);
      for (const value of values) {
        const beyond = (value - target) * direction;
        expect(beyond).toBeLessThanOrEqual(1e-9);
      }
    }
  });

  it('overshoots at most once, and only slightly, when thrown at the target at a gentle speed', () => {
    const random = seeded(77);
    for (let trial = 0; trial < 200; trial++) {
      const distance = between(random, 0.5, 6);
      const velocity = between(random, 0, 0.004);
      const { values } = run({ value: 0, velocity }, distance, 1000 / 60, 3000);
      const peak = Math.max(...values);
      // A critically damped spring thrown at its target can pass it once, by at most v / omega.
      const omega = Math.sqrt(SETTLE_SPRING.stiffness) / 1000;
      expect(peak - distance).toBeLessThanOrEqual(velocity / omega + 1e-6);
      const last = values[values.length - 1]!;
      expect(last).toBe(distance);
    }
  });

  it('always settles exactly on the target, within a second and a half, from any start', () => {
    const random = seeded(9001);
    for (let trial = 0; trial < 300; trial++) {
      const from = between(random, -50, 50);
      const target = Math.round(between(random, -50, 50));
      const velocity = between(random, -0.05, 0.05);
      const frameMs = frameTimes[trial % frameTimes.length]!;
      const { state, atRestAt } = run({ value: from, velocity }, target, frameMs, 4000);
      expect(atRestAt).not.toBeNull();
      expect(state.value).toBe(target);
      expect(state.velocity).toBe(0);
      // Distance 100 at stiffness 200 still lands in well under four seconds.
      expect(atRestAt!).toBeLessThan(4000);
    }
    const near = run({ value: 0, velocity: 0 }, 1, 1000 / 60, 3000);
    expect(near.atRestAt!).toBeLessThan(1500);
  });

  it('keeps pace across frame rates: 60, 90 and 144 Hz agree within one percent of the distance', () => {
    const random = seeded(144);
    for (let trial = 0; trial < 100; trial++) {
      const from = between(random, -10, 10);
      const target = between(random, -10, 10);
      const distance = Math.abs(target - from);
      if (distance < 0.5) continue;
      const velocity = between(random, -0.01, 0.01);
      // Multiples of 1/6 s are whole numbers of frames at all three rates.
      for (const at of [1000 / 6, 1000 / 3, 500, 2000 / 3, 1000]) {
        const results = frameTimes.map((frameMs) => run({ value: from, velocity }, target, frameMs, at).state.value);
        const spread = Math.max(...results) - Math.min(...results);
        expect(spread).toBeLessThanOrEqual(distance * 0.01 + 1e-6);
      }
    }
  });

  it('takes about 340 ms to reach 95 percent at every frame rate', () => {
    for (const frameMs of frameTimes) {
      const state: SpringState = { value: 0, velocity: 0 };
      let elapsed = 0;
      while (state.value < 0.95 && elapsed < 2000) {
        stepSpring(state, 1, frameMs);
        elapsed += frameMs;
      }
      expect(elapsed).toBeGreaterThan(315);
      expect(elapsed).toBeLessThan(365);
    }
  });
});

describe('scalar helpers', () => {
  it('clamp limits to the range', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-5, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });

  it('lerp interpolates and extrapolates', () => {
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 1)).toBe(20);
    expect(lerp(10, 20, 0.25)).toBe(12.5);
    expect(lerp(10, 20, 2)).toBe(30);
  });

  it('smoothstep is 0 and 1 at the ends, 0.5 in the middle, and clamps outside', () => {
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(1)).toBe(1);
    expect(smoothstep(0.5)).toBe(0.5);
    expect(smoothstep(-3)).toBe(0);
    expect(smoothstep(4)).toBe(1);
  });

  it('smoothstep is flat at both ends and increasing between', () => {
    expect(smoothstep(0.01)).toBeLessThan(0.001);
    expect(1 - smoothstep(0.99)).toBeLessThan(0.001);
    expect(smoothstep(0.3)).toBeLessThan(smoothstep(0.6));
  });

  it('wrapIndex returns a value in 0..count-1 for negative and large numbers', () => {
    expect(wrapIndex(0, 12)).toBe(0);
    expect(wrapIndex(11, 12)).toBe(11);
    expect(wrapIndex(12, 12)).toBe(0);
    expect(wrapIndex(-1, 12)).toBe(11);
    expect(wrapIndex(-12, 12)).toBe(0);
    expect(wrapIndex(-25, 12)).toBe(11);
    expect(wrapIndex(37, 12)).toBe(1);
  });

  it('wrapIndex returns 0 for an empty row', () => {
    expect(wrapIndex(5, 0)).toBe(0);
    expect(wrapIndex(-5, -1)).toBe(0);
  });

  it('easings hit 0 and 1 at the ends', () => {
    for (const ease of [easeInOutCubic, easeOutCubic, linear]) {
      expect(ease(0)).toBeCloseTo(0, 12);
      expect(ease(1)).toBeCloseTo(1, 12);
    }
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 12);
  });
});
