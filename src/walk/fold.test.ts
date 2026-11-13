import { describe, expect, it } from 'vitest';
import { PANEL, coverAngle, coverHeight, creaseAngle, creaseOpen, foldSchedule, panelAngles, panelLanded, restAngle, stackOffset } from './fold';

describe('foldSchedule', () => {
  it('opens five panels in two pairs over 0.22 to 0.60 and 0.58 to 0.95', () => {
    const schedule = foldSchedule(5);
    expect(schedule.cover).toEqual({ from: 0, to: 0.24 });
    expect(schedule.groups).toHaveLength(2);
    expect(schedule.groups[0]?.from).toBeCloseTo(0.22, 10);
    expect(schedule.groups[0]?.to).toBeCloseTo(0.6, 10);
    expect(schedule.groups[1]?.from).toBeCloseTo(0.58, 10);
    expect(schedule.groups[1]?.to).toBeCloseTo(0.95, 10);
    expect(schedule.creases.map((crease) => crease.group)).toEqual([0, 0, 1, 1]);
    expect(schedule.creases.map((crease) => crease.first)).toEqual([true, false, true, false]);
  });

  it('keeps every window inside 0 to 1 and opens each crease exactly once, for 2 to 8 panels', () => {
    for (let n = 2; n <= 8; n += 1) {
      const schedule = foldSchedule(n);
      expect(schedule.panels).toBe(n);
      expect(schedule.creases).toHaveLength(n - 1);
      expect(schedule.groups).toHaveLength(Math.ceil((n - 1) / 2));
      expect(schedule.groups[0]?.from).toBeCloseTo(0.22, 10);
      expect(schedule.groups[schedule.groups.length - 1]?.to).toBeCloseTo(0.95, 10);
      for (const window of [schedule.cover, schedule.settle, ...schedule.groups, ...schedule.creases]) {
        expect(window.from).toBeGreaterThanOrEqual(0);
        expect(window.to).toBeLessThanOrEqual(1);
        expect(window.to).toBeGreaterThan(window.from);
      }
      for (let k = 1; k < n; k += 1) {
        // Once: shut before its window, open after it, and never closing again in between.
        expect(creaseOpen(schedule, k, 0)).toBe(0);
        expect(creaseOpen(schedule, k, 1)).toBe(1);
        let previous = 0;
        let rises = 0;
        for (let step = 0; step <= 400; step += 1) {
          const open = creaseOpen(schedule, k, step / 400);
          expect(open).toBeGreaterThanOrEqual(previous - 1e-12);
          if (previous === 0 && open > 0) rises += 1;
          previous = open;
        }
        expect(rises).toBe(1);
      }
      // Groups follow each other and overlap a little, so something is always moving.
      for (let g = 1; g < schedule.groups.length; g += 1) {
        const before = schedule.groups[g - 1] as { from: number; to: number };
        const after = schedule.groups[g] as { from: number; to: number };
        expect(after.from).toBeGreaterThan(before.from);
        expect(after.from).toBeLessThan(before.to);
      }
    }
  });

  it('clamps the number of panels to 2 and 8', () => {
    expect(foldSchedule(1).panels).toBe(2);
    expect(foldSchedule(12).panels).toBe(8);
    expect(foldSchedule(Number.NaN).panels).toBe(2);
  });
});

describe('the concertina', () => {
  it('is a zig-zag stack when shut: creases alternate between plus and minus a half turn', () => {
    for (let n = 2; n <= 8; n += 1) {
      const schedule = foldSchedule(n);
      for (let k = 1; k < n; k += 1) {
        expect(creaseAngle(schedule, k, 0)).toBeCloseTo(k % 2 === 1 ? Math.PI : -Math.PI, 10);
      }
      // Every other panel lies face down, and none is rolled further than that.
      const angles = panelAngles(schedule, 0);
      angles.forEach((angle, index) => expect(angle).toBeCloseTo(index % 2 === 1 ? Math.PI : 0, 10));
    }
  });

  it('lies open with every panel within the resting fold of flat', () => {
    for (let n = 2; n <= 8; n += 1) {
      const schedule = foldSchedule(n);
      const angles = panelAngles(schedule, 1);
      expect(angles[0]).toBe(0);
      for (let index = 1; index < n; index += 1) expect(Math.abs(angles[index] as number)).toBeCloseTo(PANEL.zig, 10);
      for (let k = 1; k < n; k += 1) expect(creaseAngle(schedule, k, 1)).toBeCloseTo(restAngle(k), 10);
    }
  });

  it('carries the folded rest level while a pair opens, apart from the flap', () => {
    const schedule = foldSchedule(5);
    for (let step = 0; step <= 100; step += 1) {
      const fold = 0.22 + (0.34 * step) / 100;
      const angles = panelAngles(schedule, fold);
      // Panel 2 hangs on the second crease of the first pair. It never tilts more than the flap.
      expect(Math.abs(angles[2] as number)).toBeLessThanOrEqual(PANEL.flap + 1e-9);
    }
  });

  it('opens the cover first and lands it as the legend', () => {
    const schedule = foldSchedule(5);
    expect(coverAngle(schedule, 0)).toBe(0);
    expect(coverAngle(schedule, 0, 1)).toBeCloseTo(PANEL.peek, 10);
    expect(coverAngle(schedule, 0.24)).toBeCloseTo(Math.PI - PANEL.zig, 10);
    expect(coverAngle(schedule, 1, 1)).toBeCloseTo(Math.PI - PANEL.zig, 10);
    expect(coverHeight(5)).toBeCloseTo(4 * PANEL.gap + PANEL.coverRise, 10);
  });

  it('counts a panel as landed only when the hinges on both sides are open', () => {
    const schedule = foldSchedule(5);
    expect(panelLanded(schedule, 0, 0.1)).toBe(false);
    expect(panelLanded(schedule, 0, 0.61)).toBe(true);
    expect(panelLanded(schedule, 1, 0.5)).toBe(false);
    expect(panelLanded(schedule, 2, 0.7)).toBe(false);
    for (let panel = 0; panel < 5; panel += 1) {
      expect(panelLanded(schedule, panel, 0)).toBe(false);
      expect(panelLanded(schedule, panel, 1)).toBe(true);
    }
    const two = foldSchedule(2);
    expect(panelLanded(two, 1, 1)).toBe(true);
    expect(panelLanded(two, 1, 0.5)).toBe(false);
  });

  it('gives the shut stack its thickness and lets go of it as the creases open', () => {
    const schedule = foldSchedule(4);
    expect(stackOffset(schedule, 1, 0)).toBeCloseTo(-PANEL.gap, 10);
    expect(stackOffset(schedule, 2, 0)).toBeCloseTo(PANEL.gap, 10);
    for (let k = 1; k < 4; k += 1) expect(Math.abs(stackOffset(schedule, k, 1))).toBe(0);
  });
});
