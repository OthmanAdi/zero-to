import { describe, expect, it } from 'vitest';
import { WALK } from '../walk/timeline';
import type { CameraPose } from '../paper/motion';
import {
  DIVE,
  FINALE,
  RETURN,
  RETURN_SECONDS,
  RISE,
  WALK_TOP,
  WIPE,
  approachHx,
  cubicBezier,
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
  movePose,
  nearPlane,
  orbitMix,
  returnAt,
  riseHx,
  stretchViewports,
  walkProgressAt,
  walkScrollFor,
  wheelPixels,
  wipeCovered,
  wipeRadius,
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
  it('waits half a second, dims to 0.42 in 0.2 s, then moves the camera for 2.8 s', () => {
    expect(returnAt(0)).toEqual({ curtain: 0, light: 1, move: 0, swapped: false, grow: false, done: false });
    expect(returnAt(RETURN.wait).curtain).toBe(0);
    const dimmed = returnAt(RETURN.wait + RETURN.curtain * 0.5);
    expect(dimmed.curtain).toBeGreaterThan(0);
    expect(dimmed.curtain).toBeLessThan(RETURN.dim);
    const swap = RETURN.wait + RETURN.curtain;
    const before = returnAt(swap - 1e-6);
    expect(before.swapped).toBe(false);
    expect(before.curtain).toBeCloseTo(RETURN.dim, 4);
    const after = returnAt(swap);
    expect(after.swapped).toBe(true);
    expect(after.curtain).toBeCloseTo(RETURN.dim, 6);
    expect(after.move).toBe(0);
    expect(returnAt(swap + RETURN.move / 2).move).toBeCloseTo(0.5, 6);
    expect(returnAt(swap + RETURN.move)).toEqual({ curtain: 0, light: RETURN.low, move: 1, swapped: true, grow: true, done: true });
    expect(RETURN_SECONDS).toBeCloseTo(3.5, 6);
  });

  it('eases the move in and out, never stepping back, and lifts the curtain early in it', () => {
    const swap = RETURN.wait + RETURN.curtain;
    let last = -1;
    for (let t = swap; t <= swap + RETURN.move; t += 0.02) {
      const now = returnAt(t);
      expect(now.move).toBeGreaterThanOrEqual(last - 1e-9);
      last = now.move;
    }
    // Slow at both ends, fastest in the middle: power 2 in and out.
    expect(returnAt(swap + 0.1 * RETURN.move).move).toBeCloseTo(0.02, 6);
    expect(returnAt(swap + 0.9 * RETURN.move).move).toBeCloseTo(0.98, 6);
    expect(returnAt(swap + RETURN.lift).curtain).toBe(0);
    expect(returnAt(swap + RETURN.lift / 2).curtain).toBeGreaterThan(0);
  });

  it('keeps the lit mountain flat for most of the move and lets it grow before the camera arrives', () => {
    const swap = RETURN.wait + RETURN.curtain;
    expect(returnAt(swap + 0.5 * RETURN.move).grow).toBe(false);
    expect(returnAt(swap + (RETURN.grow + 0.01) * RETURN.move).grow).toBe(true);
    expect(returnAt(swap + (RETURN.grow + 0.01) * RETURN.move).done).toBe(false);
  });

  it('folds the map shut by hand in a little over a second', () => {
    expect(foldAt(0)).toBe(1);
    expect(foldAt(RETURN.fold)).toBe(0);
    expect(foldAt(RETURN.fold / 2)).toBeCloseTo(0.5, 6);
  });
});

describe('the camera move', () => {
  const close: CameraPose = { position: { x: 0, y: 3, z: 3 }, target: { x: 0, y: 0, z: 0 }, distance: Math.hypot(3, 3), fov: 34 };
  const wide: CameraPose = { position: { x: -2, y: 9, z: 20 }, target: { x: 0, y: 0.5, z: 4 }, distance: Math.hypot(2, 8.5, 16), fov: 32 };

  it('starts and ends on the two poses', () => {
    expect(orbitMix(close, wide, 0)).toEqual(close);
    expect(orbitMix(close, wide, 1)).toEqual(wide);
  });

  it('pulls back at an even rate of zoom and keeps looking at a point on the line between the two', () => {
    let last = 0;
    for (let t = 0; t <= 1; t += 0.05) {
      const pose = orbitMix(close, wide, t);
      expect(pose.distance).toBeGreaterThanOrEqual(last - 1e-9);
      last = pose.distance;
      expect(distance(pose.position, pose.target)).toBeCloseTo(pose.distance, 6);
    }
    expect(orbitMix(close, wide, 0.5).distance).toBeCloseTo(Math.sqrt(close.distance * wide.distance), 6);
  });

  it('carries a picture from one space to another by scale and offset', () => {
    const moved = movePose(close, 0.5, { x: 0, y: 0, z: 5.8 });
    expect(moved.target).toEqual({ x: 0, y: 0, z: 5.8 });
    expect(moved.distance).toBeCloseTo(close.distance / 2, 9);
    expect(moved.position.z).toBeCloseTo(5.8 + 1.5, 9);
    expect(moved.fov).toBe(close.fov);
  });
});

describe('entering another roadmap', () => {
  it('matches the browser curve cubic-bezier(.55,0,.85,.4) at its ends and its middle', () => {
    const curve = cubicBezier(0.55, 0, 0.85, 0.4);
    expect(curve(0)).toBe(0);
    expect(curve(1)).toBe(1);
    // An ease-in: slow to start, all of the speed at the end.
    expect(curve(0.25)).toBeLessThan(0.05);
    expect(curve(0.5)).toBeGreaterThan(0.08);
    expect(curve(0.5)).toBeLessThan(0.2);
    let last = 0;
    for (let t = 0; t <= 1.0001; t += 0.01) {
      expect(curve(t)).toBeGreaterThanOrEqual(last - 1e-9);
      last = curve(t);
    }
    // The linear curve is the line.
    const line = cubicBezier(0.25, 0.25, 0.75, 0.75);
    for (const t of [0.1, 0.37, 0.8]) expect(line(t)).toBeCloseTo(t, 6);
  });

  it('reaches the guard in 1.75 s and opens the circle 0.44 s before, from nothing to 150 percent in 0.42 s', () => {
    expect(approachHx(0)).toBe(0);
    expect(approachHx(WIPE.approach)).toBeCloseTo(DIVE.guard.from, 9);
    expect(approachHx(WIPE.approach * 4)).toBeCloseTo(DIVE.guard.from, 9);
    const start = WIPE.approach - WIPE.lead;
    expect(wipeRadius(start - 0.01)).toBeNull();
    expect(wipeRadius(start)).toBe(0);
    expect(wipeRadius(start + WIPE.seconds) as number).toBeCloseTo(150, 9);
    expect(wipeRadius(start + WIPE.seconds + 1)).toBe(150);
    expect(wipeRadius(start + WIPE.seconds / 2) as number).toBeLessThan(40);
    expect(wipeCovered(WIPE.approach - 0.01)).toBe(false);
    expect(wipeCovered(WIPE.approach)).toBe(true);
    // The circle opens while the camera is still falling, before the guard would come down by itself.
    expect(approachHx(start)).toBeLessThan(DIVE.guard.from - DIVE.guard.fade);
  });
});

describe('rising out of the map', () => {
  it('runs the dive backwards: the gate at 0, the table at 1', () => {
    expect(riseHx(0)).toBe(1);
    expect(riseHx(1)).toBe(0);
    expect(riseHx(-1)).toBe(1);
    expect(riseHx(0.4)).toBeCloseTo(0.6, 9);
  });

  it('reads a wheel in pixels, lines or pages', () => {
    expect(wheelPixels(-120, 0, 900)).toBe(-120);
    expect(wheelPixels(-3, 1, 900)).toBe(-3 * RISE.line);
    expect(wheelPixels(1, 2, 900)).toBeCloseTo(900 * RISE.page, 9);
  });
});
