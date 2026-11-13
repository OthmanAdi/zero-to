import { describe, expect, it } from 'vitest';
import { TEXT_SIZES, nearestScale, normaliseScale, stepScale } from './text-size';

describe('text sizes', () => {
  it('lists the five sizes', () => {
    expect([...TEXT_SIZES]).toEqual([17, 19, 21, 24, 28]);
  });

  it('keeps a scale inside 0 to 4 and drops what is not a number', () => {
    expect(normaliseScale(2)).toBe(2);
    expect(normaliseScale(9)).toBe(4);
    expect(normaliseScale(-3)).toBe(0);
    expect(normaliseScale(1.6)).toBe(2);
    expect(normaliseScale(undefined)).toBeNull();
    expect(normaliseScale(Number.NaN)).toBeNull();
    expect(normaliseScale('2')).toBeNull();
  });

  it('finds the nearest step to a measured size', () => {
    expect(nearestScale(17.2)).toBe(0);
    expect(nearestScale(18.6)).toBe(1);
    expect(nearestScale(40)).toBe(4);
  });

  it('steps from the chosen step, or from the size on screen when none was chosen', () => {
    expect(stepScale(1, 1, 17)).toBe(2);
    expect(stepScale(1, -1, 17)).toBe(0);
    expect(stepScale(null, 1, 17)).toBe(1);
    expect(stepScale(null, -1, 19)).toBe(0);
  });

  it('stops at both ends', () => {
    expect(stepScale(0, -1, 17)).toBe(0);
    expect(stepScale(4, 1, 28)).toBe(4);
  });
});
