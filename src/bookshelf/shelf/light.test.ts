import { describe, expect, it } from 'vitest';
import { DEFAULT_LAMP, DEFAULT_LIGHT, faceShades, lampReach, resolveLight, sheenOf, sweepOf } from './light';
import type { Light } from './types';

describe('faceShades with the default light', () => {
  it('leaves a resting spine its own colour and shades the board facing away from the light', () => {
    const rest = faceShades(DEFAULT_LIGHT, 0);
    expect(rest.spine).toBeCloseTo(0, 3);
    expect(rest.front).toBeCloseTo(0.56, 2);
    expect(rest.back).toBeCloseTo(0.3, 2);
  });

  it('shades the spine of a turned volume as much as a lit back board', () => {
    expect(faceShades(DEFAULT_LIGHT, 90).spine).toBeCloseTo(0.3, 2);
  });

  it('brightens the cover as it turns to the viewer', () => {
    expect(faceShades(DEFAULT_LIGHT, 45).front).toBeCloseTo(0.345, 2);
    expect(faceShades(DEFAULT_LIGHT, 90).front).toBeCloseTo(0, 3);
  });

  it('changes continuously with the turn', () => {
    let previous = faceShades(DEFAULT_LIGHT, 0);
    for (let angle = 0.5; angle <= 90; angle += 0.5) {
      const next = faceShades(DEFAULT_LIGHT, angle);
      expect(Math.abs(next.spine - previous.spine)).toBeLessThan(0.01);
      expect(Math.abs(next.front - previous.front)).toBeLessThan(0.01);
      expect(Math.abs(next.back - previous.back)).toBeLessThan(0.01);
      previous = next;
    }
  });

  it('never films a face so deeply that its cloth is lost', () => {
    const dark: Light = { x: 1, z: 0, ambient: 0, tint: '#000' };
    for (const angle of [0, 30, 60, 90]) {
      const shades = faceShades(dark, angle);
      for (const value of Object.values(shades)) expect(value).toBeLessThanOrEqual(0.72);
    }
  });

  it('ignores where a volume stands', () => {
    expect(faceShades(DEFAULT_LIGHT, 30, 4)).toEqual(faceShades(DEFAULT_LIGHT, 30, 0));
  });
});

describe('faceShades under a lamp', () => {
  it('leaves the presented cover under the lamp its own colour', () => {
    expect(faceShades(DEFAULT_LAMP, 90, 0).front).toBeCloseTo(0, 6);
  });

  it('dims volumes the further they stand from the lamp, the same on both sides', () => {
    let previous = faceShades(DEFAULT_LAMP, 0, 0).spine;
    for (const offset of [0.5, 1, 2, 3, 5]) {
      const left = faceShades(DEFAULT_LAMP, 0, -offset).spine;
      const right = faceShades(DEFAULT_LAMP, 0, offset).spine;
      expect(right).toBeCloseTo(left, 9);
      expect(right).toBeGreaterThan(previous);
      previous = right;
    }
  });

  it('lights the boards that face the lamp: front boards on the left, back boards on the right', () => {
    const left = faceShades(DEFAULT_LAMP, 0, -1.5);
    const right = faceShades(DEFAULT_LAMP, 0, 1.5);
    expect(left.front).toBeLessThan(left.back);
    expect(right.back).toBeLessThan(right.front);
  });

  it('never lets the far ends fall below the floor of its light', () => {
    expect(lampReach(DEFAULT_LAMP, 40)).toBe(0.55);
    expect(lampReach(DEFAULT_LAMP, 0)).toBe(1);
    expect(lampReach(DEFAULT_LIGHT, 40)).toBe(1);
  });

  it('changes continuously along the row, so passing the centre never steps the light', () => {
    let previous = faceShades(DEFAULT_LAMP, 0, -3);
    for (let offset = -3; offset <= 3; offset += 0.02) {
      const next = faceShades(DEFAULT_LAMP, 0, offset);
      expect(Math.abs(next.spine - previous.spine)).toBeLessThan(0.01);
      expect(Math.abs(next.front - previous.front)).toBeLessThan(0.02);
      previous = next;
    }
  });
});

describe('sheenOf', () => {
  it('rises only in the last twenty degrees of the turn and stays faint', () => {
    expect(sheenOf(DEFAULT_LIGHT, 60)).toBeLessThan(0.004);
    expect(sheenOf(DEFAULT_LIGHT, 70)).toBeLessThan(0.012);
    expect(sheenOf(DEFAULT_LIGHT, 84)).toBeGreaterThanOrEqual(0.055);
    expect(sheenOf(DEFAULT_LIGHT, 90)).toBeLessThanOrEqual(0.1);
  });

  it('brings the band to rest over the board, entering late in the turn', () => {
    expect(sweepOf(0)).toBe(0);
    expect(sweepOf(0.5)).toBe(0);
    expect(sweepOf(1)).toBeCloseTo(0.625, 9);
    expect(sweepOf(0.8)).toBeGreaterThan(0);
    expect(sweepOf(0.8)).toBeLessThan(0.625);
  });

  it('never brightens by a visible step between two frames of a turn', () => {
    for (let angle = 0; angle < 90; angle += 1) {
      expect(Math.abs(sheenOf(DEFAULT_LIGHT, angle + 1) - sheenOf(DEFAULT_LIGHT, angle))).toBeLessThan(0.006);
    }
  });

  it('is strongest under a lamp at the centre of the row', () => {
    expect(sheenOf(DEFAULT_LAMP, 90, 0)).toBeGreaterThan(sheenOf(DEFAULT_LAMP, 90, 2));
  });
});

describe('resolveLight', () => {
  it('falls back to the default light', () => {
    expect(resolveLight(undefined)).toBe(DEFAULT_LIGHT);
    const oak: Light = { x: -0.5, z: 0.87, ambient: 0.38, tint: '#140a02' };
    expect(resolveLight(oak)).toBe(oak);
  });
});
