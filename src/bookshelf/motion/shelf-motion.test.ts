import { describe, expect, it, vi } from 'vitest';
import { createManualClock } from './clock';
import { createShelfMotion, type ShelfMotionOptions } from './shelf-motion';

function setup(options: Partial<ShelfMotionOptions> = {}) {
  const clock = createManualClock();
  const motion = createShelfMotion({ count: 12, clock, ...options });
  return { clock, motion };
}

/** Tracks whether a promise has resolved without awaiting it. */
function watch(promise: Promise<void>): { done: () => boolean } {
  let resolved = false;
  void promise.then(() => {
    resolved = true;
  });
  return { done: () => resolved };
}

const flush = (): Promise<void> => Promise.resolve();

describe('goTo and step', () => {
  it('starts settled on the initial index', () => {
    const { motion } = setup({ initial: 4 });
    expect(motion.state).toMatchObject({ position: 4, target: 4, focus: 4, settled: true, open: 0 });
  });

  it('goTo settles on the target and sets settled', () => {
    const { clock, motion } = setup();
    motion.goTo(5);
    expect(motion.state.settled).toBe(false);
    expect(motion.state.target).toBe(5);
    clock.advance(2000);
    expect(motion.state.position).toBe(5);
    expect(motion.state.velocity).toBe(0);
    expect(motion.state.settled).toBe(true);
  });

  it('rounds a fractional index to a whole target', () => {
    const { motion } = setup();
    motion.goTo(2.6);
    expect(motion.state.target).toBe(3);
  });

  it('step moves the target by one in either direction', () => {
    const { clock, motion } = setup({ initial: 3 });
    motion.step(1);
    expect(motion.state.target).toBe(4);
    motion.step(-1);
    motion.step(-1);
    expect(motion.state.target).toBe(2);
    clock.advance(2000);
    expect(motion.state.position).toBe(2);
  });

  it('never aims more than two volumes past the visible one when stepped repeatedly', () => {
    const { clock, motion } = setup({ initial: 3 });
    for (let press = 0; press < 12; press++) motion.step(1);
    expect(motion.state.target).toBe(5);
    clock.advance(500);
    const visible = Math.round(motion.state.position);
    expect(visible).toBeGreaterThan(3);
    for (let press = 0; press < 12; press++) motion.step(1);
    expect(motion.state.target).toBe(visible + 2);
    clock.advance(3000);
    expect(motion.state.position).toBe(visible + 2);
  });

  it('applies the same limit backwards and lets a reversal come back at once', () => {
    const { motion } = setup({ initial: 6 });
    for (let press = 0; press < 12; press++) motion.step(-1);
    expect(motion.state.target).toBe(4);
    motion.step(1);
    expect(motion.state.target).toBe(5);
  });

  it('loop true keeps the target unbounded and wraps focus', () => {
    const { clock, motion } = setup({ loop: true });
    motion.goTo(-1);
    expect(motion.state.target).toBe(-1);
    expect(motion.state.focus).toBe(11);
    clock.advance(2000);
    expect(motion.state.position).toBe(-1);

    motion.goTo(25);
    expect(motion.state.target).toBe(25);
    expect(motion.state.focus).toBe(1);
  });

  it('loop false clamps the target at both ends', () => {
    const { clock, motion } = setup({ loop: false });
    motion.goTo(-4);
    expect(motion.state.target).toBe(0);
    motion.goTo(99);
    expect(motion.state.target).toBe(11);
    expect(motion.state.focus).toBe(11);
    motion.step(1);
    expect(motion.state.target).toBe(11);
    clock.advance(3000);
    expect(motion.state.position).toBe(11);
  });

  it('reducedMotion true makes goTo instant', () => {
    const { clock, motion } = setup({ reducedMotion: true });
    motion.goTo(7);
    expect(motion.state.position).toBe(7);
    expect(motion.state.settled).toBe(true);
    expect(motion.state.reduced).toBe(true);
    expect(clock.pending()).toBe(0);
  });

  it('reads a reducedMotion function on every move', () => {
    let reduced = false;
    const { clock, motion } = setup({ reducedMotion: () => reduced });
    motion.goTo(2);
    expect(motion.state.position).toBe(0);
    clock.advance(2000);
    reduced = true;
    motion.goTo(6);
    expect(motion.state.position).toBe(6);
  });

  it('goTo with immediate jumps without a frame', () => {
    const { clock, motion } = setup();
    motion.goTo(4, { immediate: true });
    expect(motion.state.position).toBe(4);
    expect(motion.state.settled).toBe(true);
    expect(clock.pending()).toBe(0);
  });

  it('ignores goTo on an empty shelf', () => {
    const { clock, motion } = setup({ count: 0 });
    motion.goTo(3);
    expect(motion.state.target).toBe(0);
    expect(clock.pending()).toBe(0);
  });

  it('puts the frame loop to sleep when settled and wakes it on the next move', () => {
    const { clock, motion } = setup();
    expect(clock.pending()).toBe(0);
    motion.goTo(2);
    expect(clock.pending()).toBe(1);
    clock.advance(2000);
    expect(clock.pending()).toBe(0);
    motion.step(1);
    expect(clock.pending()).toBe(1);
  });
});

describe('setOpen', () => {
  it('runs for about openDuration, reaches exactly 1 and resolves', async () => {
    const { clock, motion } = setup({ openDuration: 900 });
    const opened = watch(motion.setOpen(true));
    expect(motion.state.openTarget).toBe(1);

    clock.advance(450);
    expect(motion.state.open).toBeGreaterThan(0.2);
    expect(motion.state.open).toBeLessThan(0.8);

    clock.advance(400);
    await flush();
    expect(opened.done()).toBe(false);

    clock.advance(150);
    await flush();
    expect(motion.state.open).toBe(1);
    expect(opened.done()).toBe(true);
    expect(motion.state.settled).toBe(true);
    expect(clock.pending()).toBe(0);
  });

  it('closes over closeDuration back to exactly 0', async () => {
    const { clock, motion } = setup({ openDuration: 900, closeDuration: 640 });
    void motion.setOpen(true);
    clock.advance(1000);
    const closed = watch(motion.setOpen(false));
    clock.advance(600);
    await flush();
    expect(closed.done()).toBe(false);
    clock.advance(100);
    await flush();
    expect(motion.state.open).toBe(0);
    expect(closed.done()).toBe(true);
  });

  it('resolves the first promise on reversal and heads back', async () => {
    const { clock, motion } = setup({ openDuration: 900, closeDuration: 640 });
    const first = watch(motion.setOpen(true));
    clock.advance(400);
    const midway = motion.state.open;
    expect(midway).toBeGreaterThan(0);

    const second = watch(motion.setOpen(false));
    await flush();
    expect(first.done()).toBe(true);
    expect(second.done()).toBe(false);

    clock.advance(100);
    expect(motion.state.open).toBeLessThan(midway);

    clock.advance(700);
    await flush();
    expect(motion.state.open).toBe(0);
    expect(second.done()).toBe(true);
  });

  it('immediate is instant and needs no frame', async () => {
    const { clock, motion } = setup();
    const opened = watch(motion.setOpen(true, { immediate: true }));
    expect(motion.state.open).toBe(1);
    expect(clock.pending()).toBe(0);
    await flush();
    expect(opened.done()).toBe(true);
    await motion.setOpen(false, { immediate: true });
    expect(motion.state.open).toBe(0);
  });

  it('resolves at once when already in the requested state', async () => {
    const { clock, motion } = setup();
    await motion.setOpen(false);
    expect(clock.pending()).toBe(0);
  });

  it('uses a short linear fade when motion is reduced', async () => {
    const { clock, motion } = setup({ reducedMotion: true });
    const opened = watch(motion.setOpen(true));
    clock.advance(75);
    expect(motion.state.open).toBeGreaterThan(0.4);
    expect(motion.state.open).toBeLessThan(0.6);
    clock.advance(100);
    await flush();
    expect(motion.state.open).toBe(1);
    expect(opened.done()).toBe(true);
  });
});

describe('first frame of an open or close', () => {
  /** A clock whose frames can carry any timestamp, including one earlier than the call that asked for them. */
  function frameClock(now: number) {
    let pending: ((time: number) => void) | null = null;
    return {
      now: () => now,
      request(callback: (time: number) => void) {
        pending = callback;
        return 1;
      },
      cancel() {
        pending = null;
      },
      fire(time: number) {
        const callback = pending;
        pending = null;
        callback?.(time);
      },
    };
  }

  it('moves open off 0 on a first frame stamped before the call', () => {
    const clock = frameClock(100);
    const motion = createShelfMotion({ count: 12, clock });
    void motion.setOpen(true);
    clock.fire(92);
    expect(motion.state.open).toBeGreaterThan(0);
    expect(motion.state.open).toBeLessThan(0.01);
  });

  it('moves open off 1 on a first closing frame stamped before the call', () => {
    const clock = frameClock(100);
    const motion = createShelfMotion({ count: 12, clock });
    void motion.setOpen(true, { immediate: true });
    void motion.setOpen(false);
    clock.fire(95);
    expect(motion.state.open).toBeLessThan(1);
    expect(motion.state.open).toBeGreaterThan(0.99);
  });

  it('measures the rest of the move from the first frame, not from the call', () => {
    const clock = frameClock(100);
    const motion = createShelfMotion({ count: 12, clock, openDuration: 600 });
    void motion.setOpen(true);
    clock.fire(150);
    clock.fire(150 + 300 - 1000 / 60);
    expect(motion.state.open).toBeCloseTo(0.5, 5);
  });

  it('does not jump when a move in progress is reversed', () => {
    const clock = frameClock(0);
    const motion = createShelfMotion({ count: 12, clock, openDuration: 600, closeDuration: 600 });
    void motion.setOpen(true);
    clock.fire(10);
    clock.fire(210);
    const before = motion.state.open;
    expect(before).toBeGreaterThan(0.05);
    void motion.setOpen(false);
    clock.fire(226);
    expect(Math.abs(motion.state.open - before)).toBeLessThan(0.03);
    expect(motion.state.open).toBeLessThanOrEqual(before);
  });
});

describe('opening while the row moves', () => {
  it('leaves the position and the speed of a moving row alone', () => {
    const { clock, motion } = setup();
    motion.goTo(5);
    clock.advance(150);
    const { position, velocity } = motion.state;
    expect(position).toBeGreaterThan(0.5);
    expect(position).toBeLessThan(5);
    void motion.setOpen(true);
    expect(motion.state.position).toBe(position);
    expect(motion.state.velocity).toBe(velocity);
    expect(motion.state.target).toBe(5);
    let previous = position;
    for (let frame = 0; frame < 20; frame++) {
      clock.advance(1000 / 60);
      expect(motion.state.position).toBeGreaterThanOrEqual(previous);
      previous = motion.state.position;
    }
  });

  it('finishes both moves and settles only when the last one is done', async () => {
    const { clock, motion } = setup({ openDuration: 300 });
    motion.goTo(5);
    clock.advance(100);
    const opened = watch(motion.setOpen(true));
    clock.advance(320);
    await flush();
    expect(motion.state.open).toBe(1);
    expect(opened.done()).toBe(true);
    expect(motion.state.settled).toBe(false);
    clock.advance(2000);
    expect(motion.state.position).toBe(5);
    expect(motion.state.settled).toBe(true);
  });

  it('keeps a goTo that arrives during the opening on the spring', () => {
    const { clock, motion } = setup({ openDuration: 600 });
    void motion.setOpen(true);
    clock.advance(200);
    motion.goTo(3);
    clock.advance(100);
    expect(motion.state.position).toBeGreaterThan(0);
    expect(motion.state.position).toBeLessThan(3);
    clock.advance(3000);
    expect(motion.state.position).toBe(3);
    expect(motion.state.open).toBe(1);
  });
});

describe('reversing an open or a close', () => {
  const frame = 1000 / 60;

  it('keeps open and openTime continuous when a closing is reversed', () => {
    const { clock, motion } = setup({ openDuration: 600, closeDuration: 400 });
    void motion.setOpen(true, { immediate: true });
    void motion.setOpen(false);
    clock.advance(200);
    const open = motion.state.open;
    const openTime = motion.state.openTime;
    expect(openTime).toBeLessThan(0.7);
    void motion.setOpen(true);
    clock.advance(frame);
    expect(motion.state.openTime).toBeGreaterThanOrEqual(openTime);
    expect(motion.state.openTime - openTime).toBeLessThan(0.05);
    expect(Math.abs(motion.state.open - open)).toBeLessThan(0.1);
  });

  it('spends the remaining distance, not a whole duration, when reversing', async () => {
    const { clock, motion } = setup({ openDuration: 600, closeDuration: 400 });
    void motion.setOpen(true);
    clock.advance(150);
    const reached = motion.state.openTime;
    const closed = watch(motion.setOpen(false));
    clock.advance(400 * reached - 2 * frame);
    await flush();
    expect(closed.done()).toBe(false);
    clock.advance(4 * frame);
    await flush();
    expect(closed.done()).toBe(true);
    expect(motion.state.open).toBe(0);
    expect(motion.state.openTime).toBe(0);
  });

  it('cancels an open that is reversed before its first frame without moving', async () => {
    const { clock, motion } = setup();
    const opened = watch(motion.setOpen(true));
    const closed = watch(motion.setOpen(false));
    await flush();
    expect(opened.done()).toBe(true);
    expect(closed.done()).toBe(true);
    clock.advance(500);
    expect(motion.state.open).toBe(0);
    expect(motion.state.openTime).toBe(0);
    expect(motion.state.openTarget).toBe(0);
  });
});

describe('subscribe', () => {
  it('fires immediately and then on frames', () => {
    const { clock, motion } = setup();
    const listener = vi.fn();
    motion.subscribe(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    motion.goTo(3);
    clock.advance(100);
    expect(listener.mock.calls.length).toBeGreaterThan(3);
    expect(listener.mock.calls[0]?.[0]).toBe(motion.state);
  });

  it('calls only on frames that changed something', () => {
    const { clock, motion } = setup();
    const listener = vi.fn();
    motion.subscribe(listener);
    motion.goTo(3);
    clock.advance(3000);
    const afterMove = listener.mock.calls.length;
    expect(afterMove).toBeGreaterThan(5);
    expect(motion.state.settled).toBe(true);

    // Aiming at where the row already is moves nothing and says nothing.
    motion.goTo(3);
    clock.advance(500);
    expect(listener).toHaveBeenCalledTimes(afterMove);
    expect(clock.pending()).toBe(0);
  });

  it('reports each distinct frame of a move exactly once', () => {
    const { clock, motion } = setup();
    const seen: number[] = [];
    motion.subscribe((state) => void seen.push(state.position));
    motion.goTo(2);
    clock.advance(400);
    for (let index = 1; index < seen.length; index++) expect(seen[index]).not.toBe(seen[index - 1]);
  });

  it('reports the settle itself, which is a change of its own', () => {
    const { clock, motion } = setup();
    const settled: boolean[] = [];
    motion.subscribe((state) => void settled.push(state.settled));
    motion.goTo(1);
    clock.advance(3000);
    expect(settled[0]).toBe(true);
    expect(settled.includes(false)).toBe(true);
    expect(settled[settled.length - 1]).toBe(true);
  });

  it('stops calling after unsubscribe', () => {
    const { clock, motion } = setup();
    const listener = vi.fn();
    const unsubscribe = motion.subscribe(listener);
    unsubscribe();
    motion.goTo(3);
    clock.advance(100);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('setCount, setLoop and destroy', () => {
  it('setCount keeps the focused item when the row grows', () => {
    const { clock, motion } = setup();
    motion.goTo(5);
    clock.advance(2000);
    motion.setCount(20);
    expect(motion.state).toMatchObject({ target: 5, focus: 5, position: 5, velocity: 0 });
  });

  it('setCount accepts an explicit focus', () => {
    const { motion } = setup({ loop: false });
    motion.setCount(8, 6);
    expect(motion.state).toMatchObject({ target: 6, position: 6 });
    motion.setCount(4, 9);
    expect(motion.state.target).toBe(3);
  });

  // Defect: setCount wraps the old target with the NEW count, so the focused item changes when the row grows.
  it('setCount keeps the same item when the looping target was outside the old row', () => {
    const { motion } = setup({ loop: true });
    motion.goTo(-1, { immediate: true });
    expect(motion.state.focus).toBe(11);
    motion.setCount(20);
    expect(motion.state.focus).toBe(11);
  });

  it('setLoop(false) folds an unbounded target into the row and keeps the focused item', () => {
    const { motion } = setup({ loop: true });
    motion.goTo(14, { immediate: true });
    expect(motion.state.focus).toBe(2);
    motion.setLoop(false);
    expect(motion.state).toMatchObject({ target: 2, focus: 2, position: 2 });
    motion.goTo(-3);
    expect(motion.state.target).toBe(0);
  });

  it('setLoop(true) keeps the focused item and allows unbounded targets again', () => {
    const { motion } = setup({ loop: false, initial: 9 });
    motion.setLoop(true);
    expect(motion.state.focus).toBe(9);
    motion.goTo(-2);
    expect(motion.state.target).toBe(-2);
  });

  it('destroy stops frames and listeners', () => {
    const { clock, motion } = setup();
    const listener = vi.fn();
    motion.subscribe(listener);
    motion.goTo(3);
    expect(clock.pending()).toBe(1);
    motion.destroy();
    expect(clock.pending()).toBe(0);
    clock.advance(500);
    expect(motion.state.position).toBe(0);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('destroy resolves an open call that is still running', async () => {
    const { motion } = setup();
    const opened = watch(motion.setOpen(true));
    motion.destroy();
    await flush();
    expect(opened.done()).toBe(true);
  });

  it('does not restart the frame loop after destroy', () => {
    const { clock, motion } = setup();
    motion.destroy();
    motion.goTo(3);
    expect(clock.pending()).toBe(0);
  });
});
