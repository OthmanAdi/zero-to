import { describe, expect, it } from 'vitest';
import { createBudget, FLOOR, isSoftwareRenderer, SLOW_FRAME_MS, startingDensity, WARM_UP, WINDOW } from './budget';

const feed = (budget: ReturnType<typeof createBudget>, ms: number, count: number): boolean[] =>
  Array.from({ length: count }, () => budget.record(ms));

describe('the detail Studio can afford', () => {
  it('keeps full detail on a device whose frames fit the budget', () => {
    const budget = createBudget(2);
    feed(budget, 12, 100);
    expect(budget.density).toBe(2);
    expect(budget.steps).toBe(0);
  });

  it('ignores the first frames, which compile programs and upload textures', () => {
    const budget = createBudget(2);
    expect(feed(budget, 900, WARM_UP).some(Boolean)).toBe(false);
    expect(budget.density).toBe(2);
  });

  it('steps down once per window of slow frames, and says so', () => {
    const budget = createBudget(2.625);
    feed(budget, 5, WARM_UP);
    const first = feed(budget, 300, WINDOW);
    expect(first.filter(Boolean)).toHaveLength(1);
    expect(first.at(-1)).toBe(true);
    expect(budget.density).toBeCloseTo(1.58, 2);
    feed(budget, 300, WINDOW);
    expect(budget.density).toBeLessThan(1);
  });

  it('never goes below its floor, however slow the frames', () => {
    const budget = createBudget(4);
    feed(budget, 2000, WARM_UP + WINDOW * 20);
    expect(budget.density).toBe(FLOOR);
  });

  it('judges by the typical frame, so one stall does not cost detail', () => {
    const budget = createBudget(2);
    feed(budget, 5, WARM_UP);
    const frames = [10, 12, 11, 400, 9, 13, 10, 12];
    for (const ms of frames) budget.record(ms);
    expect(budget.density).toBe(2);
    expect(Math.max(...frames.filter((ms) => ms !== 400))).toBeLessThan(SLOW_FRAME_MS);
  });

  it('never asks for more detail again within a visit', () => {
    const budget = createBudget(2);
    feed(budget, 5, WARM_UP);
    feed(budget, 200, WINDOW);
    const lowered = budget.density;
    feed(budget, 2, WINDOW * 5);
    expect(budget.density).toBe(lowered);
  });

  it('knows a renderer that draws in software and starts it at one device pixel per px', () => {
    expect(isSoftwareRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)')).toBe(true);
    expect(isSoftwareRenderer('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe(true);
    expect(isSoftwareRenderer('ANGLE (AMD, AMD Radeon(TM) 8060S Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe(false);
    expect(startingDensity(2.625, 'SwiftShader', 4)).toBe(1);
    expect(startingDensity(2.625, 'Apple M3', 4)).toBe(2.625);
    expect(startingDensity(6, 'Adreno (TM) 740', 4)).toBe(4);
  });
});
