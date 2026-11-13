import { describe, expect, it } from 'vitest';
import { ease, follow, follower, FOLLOW_MS, pointerPlace, QUANTUM, SETTLED, spring, type Spring } from './pointer';

describe('the light following the pointer', () => {
  it('covers 63 % of the way in one time constant and never passes the target', () => {
    expect(ease(0, 1, FOLLOW_MS, FOLLOW_MS)).toBeCloseTo(1 - Math.exp(-1), 6);
    let value = 0;
    for (let i = 0; i < 200; i++) {
      const next = ease(value, 1, 16, FOLLOW_MS);
      expect(next).toBeGreaterThanOrEqual(value);
      expect(next).toBeLessThanOrEqual(1);
      value = next;
    }
  });

  it('does not depend on how the time is cut into frames', () => {
    let fine = 0;
    for (let i = 0; i < 20; i++) fine = ease(fine, 1, 8, FOLLOW_MS);
    expect(fine).toBeCloseTo(ease(0, 1, 160, FOLLOW_MS), 6);
  });

  it('keeps asking for frames until it has arrived, then stops exactly on the target', () => {
    const state = follower();
    state.targetX = 0.8;
    state.targetY = -0.4;
    let frames = 0;
    while (follow(state, 16, FOLLOW_MS)) {
      frames++;
      expect(frames).toBeLessThan(200);
    }
    expect(frames).toBeGreaterThan(20);
    expect(state.x).toBe(0.8);
    expect(state.y).toBe(-0.4);
    expect(follow(state, 16, FOLLOW_MS)).toBe(false);
  });
});

describe('where the pointer is over the scene', () => {
  const box = { left: 100, top: 200, width: 1000, height: 400 };

  it('runs from -1 to 1 across the box', () => {
    expect(pointerPlace(100, 200, box)).toEqual({ x: -1, y: -1 });
    expect(pointerPlace(600, 400, box)).toEqual({ x: 0, y: 0 });
    expect(pointerPlace(1100, 600, box)).toEqual({ x: 1, y: 1 });
  });

  it('ignores a pointer well outside the box and holds one just outside at the edge', () => {
    expect(pointerPlace(600, 100, box)).toBeNull();
    expect(pointerPlace(1200, 400, box)).toBeNull();
    expect(pointerPlace(600, 650, box)).toEqual({ x: 0, y: 1 });
  });

  it('gives the same place for moves within one step', () => {
    const wide = { left: 0, top: 0, width: 4096, height: 400 };
    const a = pointerPlace(2048, 200, wide)!;
    const b = pointerPlace(2049, 200, wide)!;
    expect(a.x).toBe(b.x);
    expect(Math.abs(pointerPlace(2080, 200, wide)!.x - a.x)).toBeGreaterThanOrEqual(QUANTUM);
  });
});

describe('the tilt spring', () => {
  it('reaches its target, passes it by a few percent at most, and comes to rest', () => {
    const state: Spring = { value: 0, velocity: 0 };
    let peak = 0;
    let frames = 0;
    while (spring(state, 1, 16)) {
      peak = Math.max(peak, state.value);
      frames++;
      expect(frames).toBeLessThan(400);
    }
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(1.05);
    expect(state.value).toBe(1);
    expect(state.velocity).toBe(0);
    // About a second: quick enough to feel held, slow enough to read as weight.
    expect(frames * 16).toBeLessThan(1600);
  });

  it('stays bounded through one very long frame', () => {
    const state: Spring = { value: 0, velocity: 0 };
    spring(state, 1, 5000);
    expect(Math.abs(state.value)).toBeLessThan(1.1);
    expect(Math.abs(1 - state.value)).toBeGreaterThanOrEqual(0);
    expect(SETTLED).toBeLessThan(0.01);
  });
});
