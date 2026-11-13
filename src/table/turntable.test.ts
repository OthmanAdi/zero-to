import { describe, expect, it } from 'vitest';
import { DIM_FLOOR, TURN, createTurntable, sheetScale, shortestSteps, slotPose, wrapDegrees } from './turntable';

const FRAME = 1 / 60;

/** Runs the table until `done` says so and returns the seconds it took. */
function run(table: ReturnType<typeof createTurntable>, done: () => boolean, limit = 10): number {
  let t = 0;
  while (!done() && t < limit) {
    table.advance(FRAME);
    t += FRAME;
  }
  return t;
}

describe('shortestSteps', () => {
  it('goes the shorter way round', () => {
    expect(shortestSteps(0, 1, 5)).toBe(1);
    expect(shortestSteps(0, 4, 5)).toBe(-1);
    expect(shortestSteps(0, 3, 5)).toBe(-2);
    expect(shortestSteps(4, 0, 5)).toBe(1);
    expect(shortestSteps(1, 5, 7)).toBe(-3);
    expect(shortestSteps(2, 2, 5)).toBe(0);
  });

  it('reaches the sheet straight across forwards when the count is even', () => {
    expect(shortestSteps(0, 3, 6)).toBe(3);
    expect(shortestSteps(0, 2, 4)).toBe(2);
  });
});

describe('createTurntable', () => {
  it('selects at once and turns by the shorter way', () => {
    const table = createTurntable(5);
    expect(table.select(4)).toBe(true);
    expect(table.selected).toBe(4);
    expect(table.target).toBeCloseTo(-72);
    expect(table.select(1)).toBe(true);
    // From sheet 4 to sheet 1 is two steps forwards, not three back.
    expect(table.target).toBeCloseTo(-72 + 144);
  });

  it('refuses a sheet that is not on the table or already selected', () => {
    const table = createTurntable(5);
    expect(table.select(0)).toBe(false);
    expect(table.select(5)).toBe(false);
    expect(table.select(-1)).toBe(false);
    expect(table.select(1.5)).toBe(false);
    expect(table.selected).toBe(0);
  });

  it('has covered nine tenths of a one-step pick after 0.9 s, give or take 0.1 s', () => {
    const table = createTurntable(5);
    table.select(1);
    const seconds = run(table, () => Math.abs(table.target - table.phi) <= table.step * 0.1);
    expect(seconds).toBeGreaterThan(0.8);
    expect(seconds).toBeLessThan(1.0);
  });

  it('is within 3 degrees of a one-step pick after 1.2 s, give or take 0.1 s, and does not swing past', () => {
    const table = createTurntable(5);
    table.select(1);
    let overshoot = 0;
    let t = 0;
    let within = -1;
    while (t < 4) {
      table.advance(FRAME);
      t += FRAME;
      overshoot = Math.max(overshoot, table.phi - table.target);
      if (within < 0 && Math.abs(table.target - table.phi) <= TURN.standWithin) within = t;
    }
    expect(within).toBeGreaterThan(1.1);
    expect(within).toBeLessThan(1.3);
    expect(overshoot).toBeLessThan(0.1);
  });

  it('lets a mountain stand only when the table is close and slow', () => {
    const table = createTurntable(5);
    expect(table.up).toBe(0);
    table.select(1);
    expect(table.up).toBe(-1);
    const seconds = run(table, () => table.up === 1);
    expect(Math.abs(table.target - table.phi)).toBeLessThanOrEqual(TURN.standWithin);
    expect(Math.abs(table.velocity)).toBeLessThan(TURN.standSlower);
    expect(seconds).toBeGreaterThan(0.9);
    expect(seconds).toBeLessThan(1.5);
  });

  it('carries on from where it is when picked again during a turn', () => {
    const table = createTurntable(5);
    table.select(1);
    run(table, () => false, 0.4);
    const phi = table.phi;
    const velocity = table.velocity;
    table.select(2);
    expect(table.phi).toBe(phi);
    expect(table.velocity).toBe(velocity);
    expect(table.target).toBeCloseTo(144);
    expect(table.up).toBe(-1);
    run(table, () => table.up === 2);
    expect(table.up).toBe(2);
  });

  it('turns more slowly by itself than for a person', () => {
    const person = createTurntable(5);
    person.select(1, 'person');
    const auto = createTurntable(5);
    auto.select(1, 'auto');
    const near = (table: ReturnType<typeof createTurntable>) => () => Math.abs(table.target - table.phi) <= 3;
    expect(run(auto, near(auto))).toBeGreaterThan(run(person, near(person)) * 1.5);
  });

  it('gives the same turn at 30 and at 120 frames per second', () => {
    const slow = createTurntable(5);
    const fast = createTurntable(5);
    slow.select(1);
    fast.select(1);
    for (let i = 0; i < 15; i += 1) slow.advance(1 / 30);
    for (let i = 0; i < 60; i += 1) fast.advance(1 / 120);
    expect(slow.phi).toBeCloseTo(fast.phi, 6);
  });

  it('settles at once for reduced motion and can be turned away for the intro', () => {
    const table = createTurntable(5);
    table.select(3);
    table.settle();
    expect(table.phi).toBe(table.target);
    expect(table.up).toBe(3);
    table.displace(TURN.introFrom);
    expect(table.phi - table.target).toBe(TURN.introFrom);
    expect(table.up).toBe(-1);
  });

  it('reports each sheet by its angle from the lit slot', () => {
    const table = createTurntable(5);
    expect(table.angleOf(0)).toBeCloseTo(0);
    expect(table.angleOf(1)).toBeCloseTo(-72);
    expect(table.angleOf(4)).toBeCloseTo(72);
    table.select(1);
    table.settle();
    expect(table.angleOf(1)).toBeCloseTo(0);
    expect(table.angleOf(0)).toBeCloseTo(72);
  });
});

describe('slotPose', () => {
  it('spaces 3 to 7 sheets evenly on the circle', () => {
    for (let count = 3; count <= 7; count += 1) {
      const poses = Array.from({ length: count }, (_, index) => slotPose(index, 17, count));
      for (let index = 0; index < count; index += 1) {
        const a = poses[index] as (typeof poses)[number];
        const b = poses[(index + 1) % count] as (typeof poses)[number];
        expect(Math.hypot(a.x, a.z)).toBeCloseTo(TURN.radius);
        expect(Math.abs(wrapDegrees(a.angle - b.angle))).toBeCloseTo(360 / count);
        // The chord between neighbours is the same all the way round.
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeCloseTo(2 * TURN.radius * Math.sin(Math.PI / count));
      }
    }
  });

  it('puts the selected sheet due south of the compass, facing the viewer', () => {
    const pose = slotPose(2, 2 * 72, 5);
    expect(pose.x).toBeCloseTo(0);
    expect(pose.z).toBeCloseTo(TURN.radius);
    expect(pose.yaw).toBeCloseTo(0);
    expect(pose.dim).toBeCloseTo(1);
  });

  it('brings the next sheet in from the left and dims sheets away from the lamp', () => {
    const next = slotPose(1, 0, 5);
    expect(next.x).toBeLessThan(0);
    expect(next.dim).toBeCloseTo(DIM_FLOOR);
    expect(slotPose(0, 35, 5).dim).toBeCloseTo(1 - (1 - DIM_FLOOR) / 2);
  });
});

describe('sheetScale', () => {
  it('keeps full size up to five sheets and shrinks them from six on', () => {
    expect(sheetScale(3)).toBe(1);
    expect(sheetScale(5)).toBe(1);
    expect(sheetScale(6)).toBeLessThan(1);
    expect(sheetScale(7)).toBeLessThan(sheetScale(6));
  });

  it('leaves a gap between the inner corners of neighbours', () => {
    for (let count = 6; count <= 7; count += 1) {
      const k = sheetScale(count);
      const cornerAngle = Math.atan2(2.1 * k, TURN.radius - 2.8 * k);
      expect(cornerAngle).toBeLessThan(Math.PI / count);
    }
    // Five full-size sheets fit too.
    expect(Math.atan2(2.1, TURN.radius - 2.8)).toBeLessThan(Math.PI / 5);
  });
});
