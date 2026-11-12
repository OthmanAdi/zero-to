import { describe, expect, it } from 'vitest';
import { MAX_FRAME_STEP, createFrameClock, phoneLike, pixelRatioFor } from './stage-math';

describe('stage maths', () => {
  it('treats small and coarse screens as phones', () => {
    expect(phoneLike(390, 844, true)).toBe(true);
    expect(phoneLike(820, 1180, true)).toBe(false);
    expect(phoneLike(1440, 900, false)).toBe(false);
    expect(phoneLike(1024, 768, true)).toBe(true);
  });

  it('caps the pixel ratio', () => {
    expect(pixelRatioFor(3, true)).toBe(1.75);
    expect(pixelRatioFor(3, false)).toBe(2);
    expect(pixelRatioFor(1, false)).toBe(1);
    expect(pixelRatioFor(Number.NaN, false)).toBe(1);
  });

  it('starts at zero, clamps long frames and resumes without a jump', () => {
    const clock = createFrameClock();
    expect(clock.tick(10, false)).toEqual({ dt: 0, t: 0, reduced: false });
    expect(clock.tick(10.016, false).dt).toBeCloseTo(0.016, 6);
    expect(clock.tick(15, true)).toMatchObject({ dt: MAX_FRAME_STEP, reduced: true });
    clock.resume();
    expect(clock.tick(60, false).dt).toBe(0);
  });
});
