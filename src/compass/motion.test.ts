import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { TAU } from './heading';
import { SHOWPIECE_MOTION, clamp, contactShadow, damp, showpiecePose, tipToAxisAngle } from './motion';

describe('showpiecePose', () => {
  it('bobs by the bob height with the bob period', () => {
    const quarter = SHOWPIECE_MOTION.bobPeriod / 4;
    expect(showpiecePose(0).bob).toBeCloseTo(0, 12);
    expect(showpiecePose(quarter).bob).toBeCloseTo(SHOWPIECE_MOTION.bobHeight, 12);
    expect(showpiecePose(3 * quarter).bob).toBeCloseTo(-SHOWPIECE_MOTION.bobHeight, 12);
    expect(showpiecePose(quarter).lift).toBeCloseTo(1, 12);
    expect(showpiecePose(3 * quarter).lift).toBeCloseTo(0, 12);
    expect(showpiecePose(SHOWPIECE_MOTION.bobPeriod).bob).toBeCloseTo(0, 9);
  });

  it('turns once per spin period', () => {
    expect(showpiecePose(SHOWPIECE_MOTION.spinPeriod).spin).toBeCloseTo(TAU, 9);
    expect(showpiecePose(SHOWPIECE_MOTION.spinPeriod / 4).spin).toBeCloseTo(TAU / 4, 9);
  });

  it('keeps the wobble and the rings gentle', () => {
    for (let t = 0; t < 120; t += 0.37) {
      const pose = showpiecePose(t);
      expect(Math.abs(pose.wobbleX)).toBeLessThanOrEqual(SHOWPIECE_MOTION.wobble);
      expect(Math.abs(pose.wobbleZ)).toBeLessThanOrEqual(SHOWPIECE_MOTION.wobble);
      expect(Math.abs(pose.ringSwing)).toBeLessThanOrEqual(SHOWPIECE_MOTION.ringSwing);
      expect(Math.abs(pose.ringRock)).toBeLessThanOrEqual(SHOWPIECE_MOTION.ringRock);
    }
  });

  it('is a pure function of the time', () => {
    expect(showpiecePose(12.5)).toEqual(showpiecePose(12.5));
  });

  it('rests with reduced motion', () => {
    for (const t of [0, 1, 17.3]) {
      expect(showpiecePose(t, SHOWPIECE_MOTION, true)).toEqual({
        bob: 0,
        lift: 0.5,
        spin: 0,
        wobbleX: 0,
        wobbleZ: 0,
        ringSwing: 0,
        ringRock: 0,
      });
    }
  });

  it('takes its own periods', () => {
    const pose = showpiecePose(1, { ...SHOWPIECE_MOTION, bobPeriod: 4, bobHeight: 0.2, spinPeriod: 10 });
    expect(pose.bob).toBeCloseTo(0.2, 12);
    expect(pose.spin).toBeCloseTo(TAU / 10, 12);
  });
});

describe('contactShadow', () => {
  it('shrinks and fades as the compass rises', () => {
    const low = contactShadow(0);
    const mid = contactShadow(0.5);
    const high = contactShadow(1);
    expect(low).toEqual({ scale: 1, strength: 1 });
    expect(mid.scale).toBeLessThan(low.scale);
    expect(high.scale).toBeLessThan(mid.scale);
    expect(high.strength).toBeLessThan(mid.strength);
    expect(high.scale).toBeGreaterThan(0.5);
    expect(contactShadow(5)).toEqual(high);
    expect(contactShadow(-5)).toEqual(low);
  });
});

describe('damp', () => {
  it('eases towards the target without passing it, whatever the frame time', () => {
    let fine = 0;
    for (let i = 0; i < 100; i += 1) fine = damp(fine, 1, 5, 0.01);
    const coarse = damp(0, 1, 5, 1);
    expect(fine).toBeCloseTo(coarse, 9);
    expect(coarse).toBeLessThan(1);
    expect(coarse).toBeGreaterThan(0.99);
    expect(damp(0.4, 1, 5, 0)).toBe(0.4);
  });
});

describe('clamp', () => {
  it('clamps', () => {
    expect(clamp(2, 0, 1)).toBe(1);
    expect(clamp(-2, 0, 1)).toBe(0);
    expect(clamp(0.3, 0, 1)).toBe(0.3);
  });
});

describe('tipToAxisAngle', () => {
  const tipOf = (tipX: number, tipZ: number): Vector3 => {
    const tip = tipToAxisAngle(tipX, tipZ);
    const q = new Quaternion().setFromAxisAngle(new Vector3(tip.x, tip.y, tip.z), tip.angle);
    return new Vector3(0, 1, 0).applyQuaternion(q);
  };

  it('leans the top towards +X and +Z', () => {
    const towardsX = tipOf(0.2, 0);
    expect(towardsX.x).toBeCloseTo(Math.sin(0.2), 9);
    expect(towardsX.z).toBeCloseTo(0, 9);
    const towardsZ = tipOf(0, 0.2);
    expect(towardsZ.z).toBeCloseTo(Math.sin(0.2), 9);
    expect(towardsZ.x).toBeCloseTo(0, 9);
    const away = tipOf(0, -0.1);
    expect(away.z).toBeLessThan(0);
  });

  it('gives no turn for no tilt', () => {
    expect(tipToAxisAngle(0, 0).angle).toBe(0);
    expect(tipOf(0, 0).y).toBeCloseTo(1, 12);
  });
});
