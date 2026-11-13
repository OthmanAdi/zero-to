import { Euler, Group, Object3D, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  TAU,
  bearingToDirection,
  bearingToYaw,
  directionToBearing,
  needleYaw,
  normalizeBearing,
  retarget,
  shortestTurn,
  worldToBody,
  yawToBearing,
} from './heading';

const deg = (degrees: number): number => (degrees * Math.PI) / 180;

describe('normalizeBearing', () => {
  it('wraps into [0, 2 PI)', () => {
    expect(normalizeBearing(0)).toBe(0);
    expect(normalizeBearing(TAU)).toBeCloseTo(0, 12);
    expect(normalizeBearing(-deg(90))).toBeCloseTo(deg(270), 12);
    expect(normalizeBearing(deg(725))).toBeCloseTo(deg(5), 12);
    expect(normalizeBearing(-1e-17)).toBe(0);
    for (const angle of [-100, -7, -0.1, 0.1, 7, 100]) {
      const wrapped = normalizeBearing(angle);
      expect(wrapped).toBeGreaterThanOrEqual(0);
      expect(wrapped).toBeLessThan(TAU);
    }
  });
});

describe('shortestTurn and retarget', () => {
  it('takes the short way round', () => {
    expect(shortestTurn(deg(350), deg(10))).toBeCloseTo(deg(20), 12);
    expect(shortestTurn(deg(10), deg(350))).toBeCloseTo(-deg(20), 12);
    expect(shortestTurn(0, deg(180))).toBeCloseTo(Math.PI, 12);
    expect(shortestTurn(deg(90), deg(90))).toBe(0);
  });

  it('keeps the needle value continuous over many turns', () => {
    let value = 0;
    for (const requested of [deg(170), deg(340), deg(150), deg(320), deg(130)]) {
      const next = retarget(value, requested);
      expect(Math.abs(next - value)).toBeLessThanOrEqual(Math.PI + 1e-9);
      expect(normalizeBearing(next)).toBeCloseTo(requested, 9);
      value = next;
    }
    // Five turns of 170 degrees the same way round end far outside [0, 2 PI).
    expect(Math.abs(value)).toBeGreaterThan(TAU);
  });
});

describe('bearings and directions', () => {
  it('puts north on -Z and east on +X', () => {
    expect(bearingToDirection(0).x).toBeCloseTo(0, 12);
    expect(bearingToDirection(0).z).toBeCloseTo(-1, 12);
    expect(bearingToDirection(deg(90)).x).toBeCloseTo(1, 12);
    expect(bearingToDirection(deg(180)).z).toBeCloseTo(1, 12);
    expect(bearingToDirection(deg(270)).x).toBeCloseTo(-1, 12);
  });

  it('round-trips', () => {
    for (const degrees of [0, 33, 90, 179, 180, 271, 359]) {
      const direction = bearingToDirection(deg(degrees));
      expect(directionToBearing(direction.x * 4, direction.z * 4)).toBeCloseTo(deg(degrees), 9);
    }
    expect(directionToBearing(0, 0)).toBe(0);
  });
});

describe('worldToBody', () => {
  it('undoes the turn of the body', () => {
    const body = new Group();
    const child = new Object3D();
    body.add(child);
    const world = new Vector3();
    for (const bodyYaw of [0, 0.6, -1.9, 7]) {
      const local = worldToBody(0.3, -0.4, bodyYaw);
      body.rotation.y = bodyYaw;
      child.position.set(local.x, 0, local.z);
      body.updateMatrixWorld(true);
      child.getWorldPosition(world);
      expect(world.x).toBeCloseTo(0.3, 9);
      expect(world.z).toBeCloseTo(-0.4, 9);
    }
  });
});

describe('needleYaw', () => {
  it('agrees with three.js: an object that rests along -Z points along the bearing', () => {
    for (const degrees of [0, 45, 90, 200, 315]) {
      const forward = new Vector3(0, 0, -1).applyEuler(new Euler(0, bearingToYaw(deg(degrees)), 0));
      const direction = bearingToDirection(deg(degrees));
      expect(forward.x).toBeCloseTo(direction.x, 9);
      expect(forward.z).toBeCloseTo(direction.z, 9);
    }
  });

  it('cancels the turn of the body', () => {
    const body = new Group();
    const needle = new Object3D();
    body.add(needle);
    const tip = new Object3D();
    tip.position.set(0, 0, -1);
    needle.add(tip);
    const world = new Vector3();
    for (const bodyYaw of [0, 0.7, -2.4, 11]) {
      for (const degrees of [0, 72, 144, 216, 288]) {
        body.rotation.y = bodyYaw;
        needle.rotation.y = needleYaw(deg(degrees), bodyYaw);
        body.updateMatrixWorld(true);
        tip.getWorldPosition(world);
        const direction = bearingToDirection(deg(degrees));
        expect(world.x).toBeCloseTo(direction.x, 9);
        expect(world.z).toBeCloseTo(direction.z, 9);
        expect(yawToBearing(needle.rotation.y, bodyYaw)).toBeCloseTo(deg(degrees), 9);
      }
    }
  });
});
