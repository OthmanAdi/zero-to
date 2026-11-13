import { describe, expect, it } from 'vitest';
import { WALK } from '../walk/timeline';
import {
  DIVE,
  FINALE,
  RETURN,
  WALK_TOP,
  divePose,
  diveSecondsAt,
  fallShare,
  finaleOpacity,
  foldAt,
  guardOpacity,
  hxAt,
  interfaceOpacity,
  isFinale,
  landingHandover,
  landingShare,
  mixPose,
  nearPlane,
  returnAt,
  stretchViewports,
  walkProgressAt,
  walkScrollFor,
  type DiveInput,
} from './timeline';

const hero: DiveInput = {
  from: { position: { x: -1.2, y: 9.5, z: 22 }, target: { x: 0, y: 0.5, z: 4 }, fov: 32 },
  head: { x: 0.4, y: 0.9, z: 5.2 },
  headDistance: 0.0647,
};

const distance = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe('the dive', () => {
  it('takes 4.4 seconds, eased in and out', () => {
    expect(hxAt(0)).toBe(0);
    expect(hxAt(DIVE.seconds)).toBe(1);
    expect(hxAt(DIVE.seconds / 2)).toBeCloseTo(0.5, 6);
    expect(hxAt(0.4)).toBeLessThan(0.01);
    let last = -1;
    for (let t = 0; t <= DIVE.seconds; t += 0.05) {
      expect(hxAt(t)).toBeGreaterThanOrEqual(last);
      last = hxAt(t);
    }
    for (const hx of [0, 0.1, 0.3, 0.5, 0.6, 0.9, 1]) expect(hxAt(diveSecondsAt(hx))).toBeCloseTo(hx, 6);
  });

  it('is fully red at hx 0.6, and across the whole cut', () => {
    expect(guardOpacity(0.6)).toBe(1);
    for (let hx = DIVE.guard.from; hx <= DIVE.guard.to + 1e-9; hx += 0.005) expect(guardOpacity(hx)).toBe(1);
    expect(guardOpacity(DIVE.guard.from - DIVE.guard.fade)).toBe(0);
    expect(guardOpacity(DIVE.guard.to + DIVE.guard.fade)).toBe(0);
    expect(guardOpacity(DIVE.guard.from - DIVE.guard.fade / 2)).toBeCloseTo(0.5, 6);
    expect(guardOpacity(0.3)).toBe(0);
    expect(guardOpacity(0.9)).toBe(0);
    expect(guardOpacity(Number.NaN)).toBe(0);
  });

  it('holds the red only round the cut: about two percent of the way on each side', () => {
    let red = 0;
    for (let hx = 0; hx <= 1; hx += 0.001) if (guardOpacity(hx) > 0) red += 0.001;
    expect(red).toBeGreaterThan(0.03);
    expect(red).toBeLessThan(0.06);
  });

  it('clears the interface before the camera falls, and starts the landing at the cut', () => {
    expect(interfaceOpacity(0)).toBe(1);
    expect(interfaceOpacity(DIVE.interfaceGone)).toBe(0);
    expect(fallShare(DIVE.fall.from)).toBe(0);
    expect(fallShare(DIVE.cut)).toBe(1);
    expect(landingShare(0.59)).toBeNull();
    expect(landingShare(DIVE.cut)).toBe(0);
    expect(landingShare(0.8)).toBeCloseTo(0.5, 6);
    expect(landingShare(1)).toBe(1);
  });

  it('starts on the hero shot and ends on the head, nearly overhead, at the distance that fills the frame', () => {
    const start = divePose(DIVE.fall.from, hero);
    expect(distance(start.position, hero.from.position)).toBeLessThan(1e-6);
    expect(distance(start.target, hero.from.target)).toBeLessThan(1e-6);

    const end = divePose(DIVE.cut, hero);
    expect(distance(end.target, hero.head)).toBeLessThan(1e-9);
    expect(end.distance).toBeCloseTo(hero.headDistance, 9);
    const up = (end.position.y - end.target.y) / end.distance;
    expect((Math.asin(up) * 180) / Math.PI).toBeCloseTo(DIVE.end.elevation, 6);
    const yaw = (Math.atan2(end.position.x - end.target.x, end.position.z - end.target.z) * 180) / Math.PI;
    expect(yaw).toBeCloseTo(DIVE.end.yaw, 6);
    expect(end.fov).toBe(32);
  });

  it('closes in without ever backing off, and looks at the head well before it arrives', () => {
    let last = Infinity;
    for (let hx = DIVE.fall.from; hx <= DIVE.cut + 1e-9; hx += 0.004) {
      const pose = divePose(hx, hero);
      expect(pose.distance).toBeLessThanOrEqual(last + 1e-9);
      last = pose.distance;
    }
    expect(distance(divePose(0.47, hero).target, hero.head)).toBeLessThan(1e-9);
  });

  it('fills the frame with the head before the guard lets go', () => {
    // A head of radius 0.038 fills a 32 degree lens corner to corner when its angular radius passes 28 degrees.
    const fills = (hx: number): boolean => Math.asin(Math.min(1, 0.038 / divePose(hx, hero).distance)) >= (28 * Math.PI) / 180;
    expect(fills(DIVE.cut)).toBe(true);
    expect(fills(0.45)).toBe(false);
  });

  it('keeps the near plane in front of the head and at rest far away', () => {
    expect(nearPlane(0.03)).toBe(DIVE.near.close);
    expect(nearPlane(hero.headDistance)).toBeLessThan(0.006);
    expect(nearPlane(hero.headDistance)).toBeLessThan(hero.headDistance - 0.038);
    expect(nearPlane(20)).toBe(DIVE.near.rest);
    expect(nearPlane(0.5)).toBeCloseTo(0.04, 6);
  });

  it('hands the camera from the landing to the rail at the very end', () => {
    expect(landingHandover(0.5)).toBe(0);
    expect(landingHandover(1)).toBe(1);
    const a = { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: -1 }, distance: 1, fov: 32 };
    const b = { position: { x: 2, y: 4, z: 6 }, target: { x: 2, y: 4, z: 2 }, distance: 4, fov: 34 };
    expect(mixPose(a, b, 0)).toEqual(a);
    expect(mixPose(a, b, 1)).toEqual(b);
    expect(mixPose(a, b, 0.5).fov).toBe(33);
  });
});

describe('the walk in the scroll', () => {
  it('starts where the first scene stands and ends at 1', () => {
    expect(WALK_TOP).toBeGreaterThan(WALK.handover);
    expect(WALK_TOP).toBeLessThan(WALK.stages.from + 0.01);
    expect(walkProgressAt(0, 9000)).toBe(WALK_TOP);
    expect(walkProgressAt(9000, 9000)).toBe(1);
    expect(walkProgressAt(-50, 9000)).toBe(WALK_TOP);
    expect(walkProgressAt(100, 0)).toBe(WALK_TOP);
  });

  it('maps scroll to progress and back, and never runs backwards', () => {
    let last = -1;
    for (let y = 0; y <= 9000; y += 250) {
      const p = walkProgressAt(y, 9000);
      expect(p).toBeGreaterThan(last);
      expect(walkScrollFor(p, 9000)).toBeCloseTo(y, 6);
      last = p;
    }
    expect(walkScrollFor(0, 9000)).toBe(0);
    expect(walkScrollFor(2, 9000)).toBe(9000);
  });

  it('gives the stretch one more viewport than the walk is long', () => {
    expect(stretchViewports(8)).toBe(9);
    expect(stretchViewports(30)).toBe(31);
    expect(stretchViewports(0)).toBe(2);
  });

  it('shows the finale line with the wide shot and takes it away before the map folds', () => {
    expect(isFinale(FINALE.from - 0.001)).toBe(false);
    expect(isFinale(FINALE.from)).toBe(true);
    expect(finaleOpacity(FINALE.from)).toBe(0);
    expect(finaleOpacity(0.9)).toBe(1);
    expect(finaleOpacity(FINALE.down)).toBe(0);
    expect(FINALE.shut).toBeGreaterThan(WALK.shut.to);
  });
});

describe('the way back', () => {
  it('waits, dims to 0.42, puts the lamp out, and swaps in the dark', () => {
    expect(returnAt(0)).toEqual({ curtain: 0, light: 1, swapped: false, done: false });
    expect(returnAt(RETURN.wait).curtain).toBe(0);
    const dimmed = returnAt(RETURN.wait + RETURN.curtain * 0.5);
    expect(dimmed.curtain).toBeGreaterThan(0);
    expect(dimmed.curtain).toBeLessThanOrEqual(RETURN.dim);
    expect(dimmed.light).toBe(1);
    const swap = RETURN.wait + RETURN.curtain + RETURN.out;
    const before = returnAt(swap - 0.001);
    expect(before.swapped).toBe(false);
    expect(before.curtain).toBeGreaterThan(0.99);
    expect(before.light).toBeLessThan(0.01);
    const after = returnAt(swap);
    expect(after.swapped).toBe(true);
    expect(after.curtain).toBe(1);
    expect(returnAt(swap + RETURN.reveal)).toEqual({ curtain: 0, light: 0, swapped: true, done: true });
  });

  it('never brightens before the swap and never darkens after it', () => {
    const swap = RETURN.wait + RETURN.curtain + RETURN.out;
    let last = -1;
    for (let t = 0; t < swap; t += 0.02) {
      expect(returnAt(t).curtain).toBeGreaterThanOrEqual(last - 1e-9);
      last = returnAt(t).curtain;
    }
    last = 2;
    for (let t = swap; t <= swap + RETURN.reveal; t += 0.02) {
      expect(returnAt(t).curtain).toBeLessThanOrEqual(last + 1e-9);
      last = returnAt(t).curtain;
    }
  });

  it('folds the map shut by hand in a little over a second', () => {
    expect(foldAt(0)).toBe(1);
    expect(foldAt(RETURN.fold)).toBe(0);
    expect(foldAt(RETURN.fold / 2)).toBeCloseTo(0.5, 6);
  });
});
