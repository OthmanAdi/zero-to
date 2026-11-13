import { describe, expect, it } from 'vitest';
import { NEEDLE_SPRING, springAtRest, springFromStiffness, springOvershoot, stepSpring, type SpringState } from './spring';

function run(params: { frequency: number; damping: number }, dt: number, seconds: number, target = 1): { state: SpringState; peak: number } {
  let state: SpringState = { value: 0, velocity: 0 };
  let peak = 0;
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    state = stepSpring(state, target, dt, params);
    peak = Math.max(peak, state.value);
  }
  return { state, peak };
}

describe('stepSpring', () => {
  it('settles on the target', () => {
    const { state } = run(NEEDLE_SPRING, 1 / 60, 4);
    expect(state.value).toBeCloseTo(1, 4);
    expect(state.velocity).toBeCloseTo(0, 3);
    expect(springAtRest(state, 1)).toBe(true);
  });

  it('overshoots a little, as the damping ratio predicts', () => {
    const { peak } = run(NEEDLE_SPRING, 1 / 240, 3);
    const overshoot = peak - 1;
    expect(overshoot).toBeGreaterThan(0.1);
    expect(overshoot).toBeLessThan(0.3);
    expect(overshoot).toBeCloseTo(springOvershoot(NEEDLE_SPRING.damping), 2);
  });

  it('does not depend on the frame rate', () => {
    const fine = run(NEEDLE_SPRING, 1 / 240, 0.5).state;
    const coarse = run(NEEDLE_SPRING, 1 / 20, 0.5).state;
    const single = stepSpring({ value: 0, velocity: 0 }, 1, 0.5, NEEDLE_SPRING);
    expect(coarse.value).toBeCloseTo(fine.value, 9);
    expect(coarse.velocity).toBeCloseTo(fine.velocity, 9);
    expect(single.value).toBeCloseTo(fine.value, 9);
  });

  it('stays finite and bounded for a very long frame', () => {
    const state = stepSpring({ value: 0, velocity: 40 }, 1, 5, NEEDLE_SPRING);
    expect(Number.isFinite(state.value)).toBe(true);
    expect(state.value).toBeCloseTo(1, 4);
  });

  it('returns the same state when no time passes', () => {
    const state: SpringState = { value: 0.3, velocity: 2 };
    expect(stepSpring(state, 1, 0, NEEDLE_SPRING)).toBe(state);
    expect(stepSpring(state, 1, -1, NEEDLE_SPRING)).toBe(state);
    expect(stepSpring(state, 1, Number.NaN, NEEDLE_SPRING)).toBe(state);
  });

  it('does not overshoot when critically damped or overdamped', () => {
    for (const damping of [1, 1.8]) {
      const { state, peak } = run({ frequency: 8, damping }, 1 / 120, 6);
      expect(peak).toBeLessThanOrEqual(1 + 1e-9);
      expect(state.value).toBeCloseTo(1, 3);
    }
  });

  it('is continuous across the critical damping ratio', () => {
    const start: SpringState = { value: 0, velocity: 1 };
    const under = stepSpring(start, 1, 0.2, { frequency: 6, damping: 0.9999 });
    const exact = stepSpring(start, 1, 0.2, { frequency: 6, damping: 1 });
    const over = stepSpring(start, 1, 0.2, { frequency: 6, damping: 1.0001 });
    expect(under.value).toBeCloseTo(exact.value, 3);
    expect(over.value).toBeCloseTo(exact.value, 3);
  });

  it('matches the differential equation', () => {
    // Check x'' + 2 z w x' + w^2 x = 0 by finite differences on the exact solution.
    const params = { frequency: 5, damping: 0.3 };
    const h = 1e-4;
    const at = (t: number): SpringState => stepSpring({ value: 1, velocity: 0 }, 0, t, params);
    const a = at(0.3 - h);
    const b = at(0.3);
    const c = at(0.3 + h);
    const acceleration = (c.velocity - a.velocity) / (2 * h);
    const expected = -2 * params.damping * params.frequency * b.velocity - params.frequency ** 2 * b.value;
    expect(acceleration).toBeCloseTo(expected, 3);
    expect((c.value - a.value) / (2 * h)).toBeCloseTo(b.velocity, 4);
  });
});

describe('spring helpers', () => {
  it('predicts no overshoot at or above critical damping', () => {
    expect(springOvershoot(1)).toBe(0);
    expect(springOvershoot(2)).toBe(0);
    expect(springOvershoot(0)).toBe(1);
  });

  it('converts stiffness and damping of a unit mass', () => {
    const params = springFromStiffness(64, 7.5);
    expect(params.frequency).toBeCloseTo(8, 9);
    expect(params.damping).toBeCloseTo(7.5 / 16, 9);
    expect(params.damping).toBeCloseTo(NEEDLE_SPRING.damping, 2);
  });
});
