import { describe, expect, it } from 'vitest';
import type { FrameTime } from '../scene/contract';
import { CAMP, DUE_RING, MAX_RUNGS } from './camp';
import { TIP_RISE } from './prop';
import { STAND, createStand, wobbleAmplitude, wobbleAngle, wobbleRate } from './stand';
import { CARRIES, STATION } from './station';
import { WALKER, walkCycle } from './walker';

const frame = (t: number, dt = 1 / 60, reduced = false): FrameTime => ({ t, dt, reduced });

function run(stand: ReturnType<typeof createStand>, from: number, seconds: number, each?: (t: number) => void): number {
  let t = from;
  const end = from + seconds;
  while (t < end - 1e-9) {
    t += 1 / 60;
    stand.update(frame(t));
    each?.(t);
  }
  return t;
}

describe('the tap wobble', () => {
  it('swings further and faster for light sheets, up to a limit', () => {
    expect(wobbleAmplitude(0)).toBeCloseTo(0.03);
    expect(wobbleAmplitude(0.0012)).toBeCloseTo(0.035, 3);
    expect(wobbleAmplitude(0.014)).toBeCloseTo(0.0888, 4);
    expect(wobbleAmplitude(0.1)).toBe(0.092);
    expect(wobbleRate(0.0012)).toBeCloseTo(6.748, 3);
    expect(wobbleRate(0)).toBeCloseTo(6.4);
  });

  it('starts at zero, stays inside its amplitude and has died away after 1.75 s', () => {
    expect(wobbleAngle(0, 0.092, 9)).toBe(0);
    expect(wobbleAngle(-1, 0.092, 9)).toBe(0);
    expect(wobbleAngle(STAND.wobbleSeconds, 0.092, 9)).toBe(0);
    expect(wobbleAngle(3, 0.092, 9)).toBe(0);
    let peak = 0;
    for (let t = 0; t <= STAND.wobbleSeconds; t += 0.005) peak = Math.max(peak, Math.abs(wobbleAngle(t, 0.092, 9)));
    expect(peak).toBeGreaterThan(0.06);
    expect(peak).toBeLessThanOrEqual(0.092);
    // The envelope falls all the way: later swings are smaller than earlier ones.
    const early = Math.abs(wobbleAngle(Math.PI / 18, 0.14, 9));
    const late = Math.abs(wobbleAngle(Math.PI / 18 + (4 * Math.PI) / 9, 0.14, 9));
    expect(late).toBeLessThan(early);
  });
});

describe('a stand', () => {
  it('starts lying, rises on its spring with a small overshoot and comes to rest upright', () => {
    const stand = createStand({ sway: 0 });
    expect(stand.up).toBe(0);
    expect(stand.hinge.rotation.x).toBeCloseTo(-Math.PI / 2);
    stand.setUp(true);
    let highest = 0;
    run(stand, 0, 3, () => (highest = Math.max(highest, stand.up)));
    expect(highest).toBeGreaterThan(1);
    expect(highest).toBeLessThan(1.35);
    expect(stand.up).toBeCloseTo(1, 3);
    expect(stand.hinge.rotation.x).toBeCloseTo(0, 3);
    expect(stand.hinge.position.y).toBeCloseTo(0, 5);
    expect(stand.atRest).toBe(true);
  });

  it('lies down on the softer spring and never goes through the map', () => {
    const stand = createStand({ up: true });
    stand.setUp(false);
    let lowest = Infinity;
    run(stand, 0, 3, () => (lowest = Math.min(lowest, stand.angle)));
    expect(lowest).toBeGreaterThanOrEqual(-Math.PI / 2 - 1e-9);
    expect(stand.up).toBeCloseTo(0, 3);
    expect(stand.hinge.position.y).toBeCloseTo(STAND.rest, 4);
  });

  it('rises only part of the way for a lake', () => {
    const stand = createStand({ rise: TIP_RISE });
    stand.setUp(true);
    run(stand, 0, 3);
    expect(stand.hinge.rotation.x).toBeCloseTo(-Math.PI / 2 + TIP_RISE, 3);
    expect(TIP_RISE).toBeGreaterThanOrEqual(0.3);
    expect(TIP_RISE).toBeLessThanOrEqual(0.36);
  });

  it('wobbles when tapped while standing, and not while lying', () => {
    const standing = createStand({ up: true, sway: 0.006 });
    let t = run(standing, 0, 0.2);
    standing.tap();
    let widest = 0;
    t = run(standing, t, 1, () => (widest = Math.max(widest, Math.abs(standing.swing))));
    expect(widest).toBeGreaterThan(0.02);
    expect(widest).toBeLessThanOrEqual(wobbleAmplitude(0.006));
    run(standing, t, 1.2);
    expect(standing.swing).toBe(0);

    const lying = createStand();
    lying.tap();
    let moved = 0;
    run(lying, 0, 1, () => (moved = Math.max(moved, Math.abs(lying.swing))));
    expect(moved).toBe(0);
  });

  it('settles at once and holds still with reduced motion', () => {
    const stand = createStand({ sway: 0.014 });
    stand.setUp(true);
    stand.tap();
    stand.update(frame(1, 1 / 60, true));
    expect(stand.up).toBe(1);
    expect(stand.hinge.rotation.z).toBe(0);
    stand.update(frame(2, 1 / 60, true));
    expect(stand.hinge.rotation.z).toBe(0);
    expect(stand.atRest).toBe(true);
  });

  it('can be put up without motion', () => {
    const stand = createStand();
    stand.setUp(true, true);
    expect(stand.up).toBe(1);
  });

  it('survives a very slow frame', () => {
    const stand = createStand();
    stand.setUp(true);
    stand.update(frame(1, 0.1));
    expect(stand.up).toBeLessThan(1.5);
    expect(stand.angle).toBeGreaterThanOrEqual(-Math.PI / 2);
  });
});

describe('the walk cycle', () => {
  it('stands still at rest: no bob, no rock, feet a little apart', () => {
    const pose = walkCycle(3.3, 0);
    expect(pose.bob).toBe(0);
    expect(pose.lean).toBeCloseTo(0);
    expect(pose.nearLeg).toBeCloseTo(0.05);
    expect(pose.farLeg).toBeCloseTo(-0.05);
    expect(pose.stickTip.y).toBe(0);
    expect(Math.abs(pose.breath - 1)).toBeLessThanOrEqual(0.012);
  });

  it('swings the legs against each other, and the free arm against the near leg', () => {
    for (let phase = 0; phase < 4; phase += 0.07) {
      const pose = walkCycle(phase, 1);
      expect(pose.nearLeg + pose.farLeg).toBeCloseTo(0);
      expect(Math.abs(pose.nearLeg)).toBeLessThanOrEqual(WALKER.stride + 1e-9);
      expect(Math.sign(pose.farArm)).toBe(Math.sign(pose.nearLeg));
      expect(pose.bob).toBeGreaterThanOrEqual(0);
      expect(pose.bob).toBeLessThanOrEqual(WALKER.bob + 1e-9);
      expect(Math.abs(pose.lean)).toBeLessThanOrEqual(WALKER.lean + 1e-9);
      expect(pose.stickTip.y).toBeGreaterThanOrEqual(0);
      expect(pose.breath).toBe(1);
    }
  });

  it('is highest as the legs pass and lowest at full stride', () => {
    expect(walkCycle(0.5, 1).bob).toBeCloseTo(WALKER.bob);
    expect(walkCycle(0.5, 1).nearLeg).toBeCloseTo(0);
    expect(walkCycle(1, 1).bob).toBeCloseTo(0);
    expect(Math.abs(walkCycle(1, 1).nearLeg)).toBeCloseTo(WALKER.stride);
  });

  it('repeats every two steps and scales with the pace', () => {
    const a = walkCycle(0.37, 1);
    const b = walkCycle(2.37, 1);
    expect(b.nearLeg).toBeCloseTo(a.nearLeg);
    expect(b.bob).toBeCloseTo(a.bob);
    expect(walkCycle(0.37, 0.5).bob).toBeCloseTo(a.bob / 2);
    expect(walkCycle(0.37, 7).bob).toBeCloseTo(a.bob);
    expect(walkCycle(0.37, -1).bob).toBe(0);
  });

  it('keeps the numbers of the brief', () => {
    expect(WALKER.height).toBe(0.29);
    expect(WALKER.bob).toBe(0.032);
    expect(WALKER.lean).toBe(0.07);
    expect(WALKER.yaw).toBe(-0.14);
    expect(WALKER.phasePerUnit).toBe(12.9);
    expect(WALKER.idle).toBe(0.4);
    expect(WALKER.blend).toBe(8);
    expect(WALKER.wobble).toEqual({ amplitude: 0.14, rate: 9 });
  });
});

describe('camp, cairn and station constants', () => {
  it('has a place on the pole for each of three flags, the first highest', () => {
    expect(CAMP.slots).toHaveLength(MAX_RUNGS);
    expect(CAMP.slots[0]).toBeGreaterThan(CAMP.slots[1]);
    expect(CAMP.slots[1]).toBeGreaterThan(CAMP.slots[2]);
    expect(CAMP.slots[0]).toBeLessThan(CAMP.pole.height);
    expect(CAMP.slots[2] - CAMP.rest - 2 * CAMP.restStep).toBeGreaterThan(0.2);
  });

  it('lays the due ring wide enough to clear the cairn', () => {
    expect(DUE_RING.radius - DUE_RING.band / 2).toBeGreaterThan(0.18);
  });

  it('keeps the station numbers of the brief', () => {
    expect(STATION.sheet.altitudes[0]).toBeCloseTo(7.9);
    expect(STATION.orbit.radius).toBe(1.4);
    expect((STATION.orbit.step * 180) / Math.PI).toBeCloseTo(72);
    expect(STATION.orbit.front).toBe(1.32);
    expect(STATION.anchorLift).toBe(0.12);
    expect(CARRIES).toHaveLength(5);
    expect(STATION.start + STATION.spread).toBeLessThan(1);
  });
});
