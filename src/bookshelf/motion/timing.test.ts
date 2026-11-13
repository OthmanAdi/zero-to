import { describe, expect, it } from 'vitest';
import { createManualClock } from './clock';
import { createShelfMotion, DEFAULT_TIMING, type MotionTiming } from './shelf-motion';

const measured: MotionTiming = {
  travel: { base: 1600, perItem: 200, max: 2100 },
  openDuration: 1100,
  closeDuration: 700,
  openHold: 170,
};

function setup(timing: Partial<MotionTiming> = measured) {
  const clock = createManualClock();
  const motion = createShelfMotion({ count: 12, loop: true, clock, timing });
  return { clock, motion };
}

describe('eased travel for programmed moves', () => {
  it('takes the base duration for one step and is half way at half time', () => {
    const { clock, motion } = setup();
    motion.step(1);
    clock.advance(800);
    expect(motion.state.position).toBeCloseTo(0.5, 1);
    expect(motion.state.settled).toBe(false);
    clock.advance(840);
    expect(motion.state.position).toBe(1);
    expect(motion.state.settled).toBe(true);
  });

  it('starts and ends slowly, with no overshoot', () => {
    const { clock, motion } = setup();
    motion.step(1);
    let highest = 0;
    const samples: number[] = [];
    for (let elapsed = 0; elapsed < 1700; elapsed += 100) {
      clock.advance(100);
      samples.push(motion.state.position);
      highest = Math.max(highest, motion.state.position);
    }
    expect(highest).toBeLessThanOrEqual(1);
    const firstStep = samples[0]!;
    const middleStep = samples[8]! - samples[7]!;
    expect(firstStep).toBeLessThan(middleStep);
  });

  it('starts a new travel at the speed the row already has', () => {
    const { clock, motion } = setup({ travel: { base: 600, perItem: 100, max: 900 } });
    motion.step(1);
    clock.advance(280);
    const before = motion.state.position;
    clock.advance(1000 / 60);
    const speedBefore = motion.state.position - before;
    expect(speedBefore).toBeGreaterThan(0.01);

    motion.step(1);
    const mark = motion.state.position;
    clock.advance(1000 / 60);
    const speedAfter = motion.state.position - mark;
    expect(speedAfter).toBeGreaterThan(speedBefore * 0.7);
    expect(speedAfter).toBeLessThan(speedBefore * 1.4);
    clock.advance(1500);
    expect(motion.state.position).toBe(2);
    expect(motion.state.settled).toBe(true);
  });

  it('never overshoots its target when the carried speed points the same way', () => {
    const { clock, motion } = setup({ travel: { base: 600, perItem: 100, max: 900 } });
    motion.step(1);
    clock.advance(200);
    motion.step(1);
    let highest = 0;
    for (let elapsed = 0; elapsed < 1200; elapsed += 1000 / 60) {
      clock.advance(1000 / 60);
      highest = Math.max(highest, motion.state.position);
    }
    expect(highest).toBeLessThan(2.05);
    expect(motion.state.position).toBe(2);
  });

  it('grows with distance and stops at the maximum', () => {
    const three = setup();
    three.motion.goTo(3);
    three.clock.advance(1900);
    expect(three.motion.state.settled).toBe(false);
    three.clock.advance(150);
    expect(three.motion.state.settled).toBe(true);

    const six = setup();
    six.motion.goTo(6);
    six.clock.advance(2000);
    expect(six.motion.state.settled).toBe(false);
    six.clock.advance(150);
    expect(six.motion.state.position).toBe(6);
    expect(six.motion.state.settled).toBe(true);
  });

  it('uses the spring when travel is null', () => {
    const { clock, motion } = setup(DEFAULT_TIMING);
    motion.step(1);
    clock.advance(900);
    expect(motion.state.position).toBe(1);
    expect(motion.state.settled).toBe(true);
  });

  it('can be switched at run time', () => {
    const { clock, motion } = setup(DEFAULT_TIMING);
    motion.setTiming(measured);
    motion.step(1);
    clock.advance(900);
    expect(motion.state.settled).toBe(false);
    motion.setTiming({ travel: null });
    clock.advance(900);
    motion.step(1);
    clock.advance(900);
    expect(motion.state.position).toBe(2);
    expect(motion.state.settled).toBe(true);
  });

  it('is skipped entirely with reduced motion', () => {
    const clock = createManualClock();
    const motion = createShelfMotion({ count: 12, clock, timing: measured, reducedMotion: true });
    motion.step(1);
    expect(motion.state.position).toBe(1);
  });
});

describe('open timing', () => {
  it('ignores openHold: the move starts at once and runs for the open duration', async () => {
    const { clock, motion } = setup();
    const opened = motion.setOpen(true);
    clock.advance(150);
    expect(motion.state.open).toBeGreaterThan(0.005);
    clock.advance(570);
    expect(motion.state.open).toBeGreaterThan(0.6);
    clock.advance(400);
    await opened;
    expect(motion.state.open).toBe(1);
    expect(motion.state.openTime).toBe(1);
    expect(motion.state.settled).toBe(true);
  });

  it('exposes linear time next to the eased value', () => {
    const { clock, motion } = setup({ openDuration: 1000, closeDuration: 1000 });
    void motion.setOpen(true);
    clock.advance(1000 / 60);
    clock.advance(250 - 1000 / 60);
    expect(motion.state.openTime).toBeCloseTo(0.25, 2);
    expect(motion.state.open).toBeLessThan(0.1);
    clock.advance(250);
    expect(motion.state.openTime).toBeCloseTo(0.5, 2);
    expect(motion.state.open).toBeGreaterThan(0.5);
  });

  it('moves openTime back to 0 on a close and keeps it continuous on a reversal', () => {
    const { clock, motion } = setup({ openDuration: 1000, closeDuration: 500 });
    void motion.setOpen(true);
    clock.advance(600);
    const before = motion.state.openTime;
    void motion.setOpen(false);
    clock.advance(1000 / 60);
    expect(motion.state.openTime).toBeLessThanOrEqual(before);
    expect(before - motion.state.openTime).toBeLessThan(0.05);
    clock.advance(600);
    expect(motion.state.openTime).toBe(0);
    expect(motion.state.open).toBe(0);
  });

  it('sets openTime with an immediate open and close', () => {
    const { motion } = setup();
    void motion.setOpen(true, { immediate: true });
    expect(motion.state.openTime).toBe(1);
    void motion.setOpen(false, { immediate: true });
    expect(motion.state.openTime).toBe(0);
  });

  it('defaults to a 700 ms opening and a 520 ms closing', () => {
    expect(DEFAULT_TIMING.openDuration).toBe(700);
    expect(DEFAULT_TIMING.closeDuration).toBe(520);
  });

  it('closes over the close duration', async () => {
    const { clock, motion } = setup();
    void motion.setOpen(true, { immediate: true });
    const closed = motion.setOpen(false);
    clock.advance(350);
    expect(motion.state.open).toBeLessThan(0.75);
    clock.advance(400);
    await closed;
    expect(motion.state.open).toBe(0);
  });

  it('fades in 150 ms with reduced motion', async () => {
    const clock = createManualClock();
    const motion = createShelfMotion({ count: 12, clock, timing: measured, reducedMotion: true });
    const opened = motion.setOpen(true);
    clock.advance(170);
    await opened;
    expect(motion.state.open).toBe(1);
  });
});
