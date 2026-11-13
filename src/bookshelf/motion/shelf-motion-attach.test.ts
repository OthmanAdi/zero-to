import { afterEach, describe, expect, it, vi } from 'vitest';
import { createManualClock } from './clock';
import { createShelfMotion, type AttachOptions, type ShelfMotionOptions } from './shelf-motion';

const PITCH = 100;

interface PointerInit {
  x: number;
  y?: number;
  t?: number;
}

function pointer(type: string, init: PointerInit): PointerEvent {
  const event = new PointerEvent(type, {
    pointerId: 1,
    clientX: init.x,
    clientY: init.y ?? 0,
    pointerType: 'mouse',
    button: 0,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, 'timeStamp', { value: init.t ?? 0 });
  return event;
}

function setup(options: Partial<ShelfMotionOptions> = {}, enabled?: () => boolean, track?: AttachOptions['track']) {
  const clock = createManualClock();
  const motion = createShelfMotion({ count: 12, clock, ...options });
  const element = document.createElement('div');
  document.body.appendChild(element);
  element.setPointerCapture = vi.fn();
  const detach = motion.attach(element, { pxPerItem: () => PITCH, enabled, track });
  const fire = (type: string, init: PointerInit): void => {
    element.dispatchEvent(pointer(type, init));
  };
  /** Presses at x = 500 and moves to 500 + dx with timestamps spaced `gap` ms apart. */
  const drag = (dx: number, gap = 200): void => {
    fire('pointerdown', { x: 500, t: 0 });
    fire('pointermove', { x: 500 + dx / 2, t: gap });
    fire('pointermove', { x: 500 + dx, t: gap * 2 });
  };
  return { clock, motion, element, detach, fire, drag };
}

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('motion.attach drag', () => {
  it('moves position by +1 when dragged left by one pitch', () => {
    const { motion, drag } = setup();
    drag(-PITCH);
    expect(motion.state.position).toBeCloseTo(1, 10);
    expect(motion.state.dragging).toBe(true);
    expect(motion.state.settled).toBe(false);
  });

  it('moves position by -1 when dragged right by one pitch', () => {
    const { motion, drag } = setup({ initial: 4 });
    drag(PITCH);
    expect(motion.state.position).toBeCloseTo(3, 10);
  });

  it('sleeps while the pointer is held still and wakes on the next move', () => {
    const { clock, motion, fire } = setup();
    const listener = vi.fn();
    motion.subscribe(listener);
    fire('pointerdown', { x: 500, t: 0 });
    fire('pointermove', { x: 400, t: 20 });
    clock.advance(100);
    const calls = listener.mock.calls.length;
    expect(motion.state.dragging).toBe(true);
    expect(motion.state.settled).toBe(false);
    clock.advance(1000);
    expect(listener).toHaveBeenCalledTimes(calls);
    expect(clock.pending()).toBe(0);

    fire('pointermove', { x: 350, t: 1200 });
    expect(clock.pending()).toBe(1);
    clock.advance(50);
    expect(listener.mock.calls.length).toBeGreaterThan(calls);
    expect(motion.state.position).toBeCloseTo(1.5, 10);
  });

  it('settles on a whole index after a slow release', () => {
    const { clock, motion, drag, fire } = setup();
    drag(-130);
    fire('pointerup', { x: 370, t: 1000 });
    expect(motion.state.dragging).toBe(false);
    expect(motion.state.target).toBe(1);
    clock.advance(2000);
    expect(motion.state.position).toBe(1);
    expect(motion.state.settled).toBe(true);
  });

  it('a gentle release moving forward lands on the next volume instead of sliding back', () => {
    const { clock, motion, fire } = setup();
    fire('pointerdown', { x: 500, t: 0 });
    fire('pointermove', { x: 170, t: 1000 });
    fire('pointermove', { x: 160, t: 1033 });
    expect(motion.state.position).toBeCloseTo(3.4, 10);
    fire('pointerup', { x: 160, t: 1040 });
    expect(motion.state.target).toBe(4);
    expect(motion.state.velocity).toBeGreaterThan(0);
    clock.advance(200);
    expect(motion.state.position).toBeGreaterThan(3.4);
    clock.advance(3000);
    expect(motion.state.position).toBe(4);
  });

  it('a gentle release moving backward lands on the previous volume', () => {
    const { motion, fire } = setup({ initial: 5 });
    fire('pointerdown', { x: 500, t: 0 });
    fire('pointermove', { x: 530, t: 1000 });
    fire('pointermove', { x: 540, t: 1033 });
    expect(motion.state.position).toBeCloseTo(4.6, 10);
    fire('pointerup', { x: 540, t: 1040 });
    expect(motion.state.target).toBe(4);
  });

  it('a release that rested on the pointer still snaps to the nearest volume', () => {
    const { motion, fire } = setup();
    fire('pointerdown', { x: 500, t: 0 });
    fire('pointermove', { x: 160, t: 1000 });
    fire('pointerup', { x: 160, t: 1500 });
    expect(motion.state.target).toBe(3);
  });

  it('carries the speed of the last 80 ms of positions, not the speed of the whole drag', () => {
    const { motion, fire } = setup();
    fire('pointerdown', { x: 900, t: 0 });
    fire('pointermove', { x: 500, t: 100 });
    fire('pointermove', { x: 495, t: 400 });
    fire('pointermove', { x: 490, t: 440 });
    fire('pointermove', { x: 485, t: 480 });
    fire('pointerup', { x: 485, t: 480 });
    // 10 px in 80 ms is 0.125 px/ms, which is 0.00125 items per ms at a pitch of 100.
    expect(motion.state.velocity).toBeCloseTo(0.00125, 6);
  });

  it('carries no speed when the pointer rested for longer than the window before release', () => {
    const { motion, fire } = setup();
    fire('pointerdown', { x: 900, t: 0 });
    fire('pointermove', { x: 700, t: 20 });
    fire('pointermove', { x: 500, t: 40 });
    fire('pointerup', { x: 500, t: 400 });
    expect(motion.state.velocity).toBe(0);
    expect(motion.state.target).toBe(4);
  });

  it('a fast flick moves at least one volume in its direction', () => {
    const { clock, motion, fire } = setup({ initial: 5 });
    fire('pointerdown', { x: 500, t: 0 });
    fire('pointermove', { x: 485, t: 30 });
    fire('pointermove', { x: 470, t: 60 });
    fire('pointerup', { x: 470, t: 60 });
    expect(motion.state.target).toBeGreaterThanOrEqual(6);
    clock.advance(3000);
    expect(Number.isInteger(motion.state.position)).toBe(true);
    expect(motion.state.position).toBe(motion.state.target);
  });

  it('a flick right moves at least one volume right, which is lower', () => {
    const { motion, fire } = setup({ initial: 5 });
    fire('pointerdown', { x: 500, t: 0 });
    fire('pointermove', { x: 515, t: 30 });
    fire('pointermove', { x: 530, t: 60 });
    fire('pointerup', { x: 530, t: 60 });
    expect(motion.state.target).toBeLessThanOrEqual(4);
  });

  it('still moves one volume when the projected flick lands on the start', () => {
    const clock = createManualClock();
    const motion = createShelfMotion({ count: 12, clock });
    const element = document.createElement('div');
    element.setPointerCapture = vi.fn();
    motion.attach(element, { pxPerItem: () => 1000 });
    const fire = (type: string, init: PointerInit): void => {
      element.dispatchEvent(pointer(type, init));
    };
    fire('pointerdown', { x: 500, t: 0 });
    fire('pointermove', { x: 485, t: 30 });
    fire('pointermove', { x: 470, t: 60 });
    fire('pointerup', { x: 470, t: 60 });
    expect(motion.state.target).toBe(1);
  });

  it('a very fast flick moves at most six volumes', () => {
    const { motion, fire } = setup();
    fire('pointerdown', { x: 900, t: 0 });
    fire('pointermove', { x: 600, t: 10 });
    fire('pointermove', { x: 300, t: 20 });
    fire('pointerup', { x: 300, t: 20 });
    expect(motion.state.target).toBe(6);
  });

  it('a pointercancel returns to the nearest whole index without a flick', () => {
    const { clock, motion, drag, fire } = setup();
    drag(-140);
    fire('pointercancel', { x: 360, t: 400 });
    expect(motion.state.target).toBe(1);
    expect(motion.state.velocity).toBe(0);
    clock.advance(2000);
    expect(motion.state.position).toBe(1);
  });

  it('with loop false, resists dragging past the start and settles back inside', () => {
    const { clock, motion, drag, fire } = setup({ loop: false });
    drag(2 * PITCH);
    expect(motion.state.position).toBeLessThan(0);
    expect(motion.state.position).toBeGreaterThan(-1);
    expect(motion.state.target).toBe(0);
    fire('pointerup', { x: 700, t: 1000 });
    clock.advance(2000);
    expect(motion.state.position).toBe(0);
  });

  it('with loop false, resists dragging past the end and settles back inside', () => {
    const { clock, motion, drag, fire } = setup({ loop: false, count: 5, initial: 4 });
    drag(-3 * PITCH);
    // Raw travel would be 7, three items past the end. The default pull limit is eight items:
    // (1 - 1 / (3 * 0.55 / 8 + 1)) * 8.
    expect(motion.state.position).toBeCloseTo(4 + (1 - 1 / ((3 * 0.55) / 8 + 1)) * 8, 10);
    expect(motion.state.overscroll).toBeCloseTo(motion.state.position - 4, 10);
    expect(motion.state.target).toBe(4);
    fire('pointerup', { x: 200, t: 1000 });
    clock.advance(2000);
    expect(motion.state.position).toBe(4);
  });

  it('reports the overscroll in items and clears it when the row is back inside', () => {
    const { clock, motion, drag, fire } = setup({ loop: false });
    expect(motion.state.overscroll).toBe(0);
    drag(PITCH);
    expect(motion.state.overscroll).toBe(motion.state.position);
    expect(motion.state.overscroll).toBeLessThan(0);
    fire('pointerup', { x: 600, t: 1000 });
    clock.advance(2000);
    expect(motion.state.overscroll).toBe(0);
  });

  it('gives less and less the further a finite row is pulled, and never more than the limit', () => {
    const pulled: number[] = [];
    for (const items of [1, 2, 4, 8, 20, 200]) {
      const { motion, drag } = setup({ loop: false });
      drag(items * PITCH);
      pulled.push(-motion.state.overscroll);
    }
    for (let index = 1; index < pulled.length; index++) expect(pulled[index]!).toBeGreaterThan(pulled[index - 1]!);
    // The first items resist at 0.55 and every step gives less than the one before.
    expect(pulled[0]!).toBeGreaterThan(0.5);
    expect(pulled[0]!).toBeLessThan(0.55);
    expect(pulled[1]! - pulled[0]!).toBeLessThan(pulled[0]!);
    expect(pulled[pulled.length - 1]!).toBeLessThan(8);
  });

  it('uses the scene width to bound the pull when the host gives it', () => {
    const clock = createManualClock();
    const motion = createShelfMotion({ count: 12, clock, loop: false });
    const element = document.createElement('div');
    element.setPointerCapture = vi.fn();
    motion.attach(element, { pxPerItem: () => PITCH, extent: () => 400 });
    element.dispatchEvent(pointer('pointerdown', { x: 500, t: 0 }));
    element.dispatchEvent(pointer('pointermove', { x: 5000, t: 20 }));
    expect(motion.state.overscroll).toBeLessThan(0);
    expect(motion.state.overscroll).toBeGreaterThan(-4);
    expect(motion.state.overscroll).toBeLessThan(-3);
  });

  it('starts returning on the spring at once after release and never freezes', () => {
    const { clock, motion, drag, fire } = setup({ loop: false });
    drag(3 * PITCH);
    fire('pointerup', { x: 800, t: 1000 });
    const pulledTo = motion.state.position;
    expect(pulledTo).toBeLessThan(-0.5);
    let previous = pulledTo;
    for (let frame = 0; frame < 20; frame++) {
      clock.advance(1000 / 60);
      expect(motion.state.position).toBeGreaterThan(previous);
      previous = motion.state.position;
    }
    clock.advance(3000);
    expect(motion.state.position).toBe(0);
    expect(motion.state.settled).toBe(true);
  });

  it('does not jump when a row that is still pulled past its end is grabbed again', () => {
    const { clock, motion, drag, fire } = setup({ loop: false });
    drag(3 * PITCH);
    fire('pointerup', { x: 800, t: 1000 });
    clock.advance(100);
    const before = motion.state.position;
    fire('pointerdown', { x: 500, t: 1200 });
    fire('pointermove', { x: 510, t: 1210 });
    fire('pointermove', { x: 500, t: 1220 });
    expect(motion.state.position).toBeCloseTo(before, 6);
  });

  it('with loop true, dragging past index 0 is not resisted', () => {
    const { motion, drag } = setup({ loop: true });
    drag(2 * PITCH);
    expect(motion.state.position).toBeCloseTo(-2, 10);
    expect(motion.state.focus).toBe(10);
  });

  it('enabled returning false blocks drag', () => {
    const { motion, drag } = setup({}, () => false);
    drag(-PITCH);
    expect(motion.state.position).toBe(0);
    expect(motion.state.dragging).toBe(false);
  });

  it('blocks drag while a book is open', () => {
    const { motion, drag } = setup();
    void motion.setOpen(true, { immediate: true });
    drag(-PITCH);
    expect(motion.state.position).toBe(0);
  });

  it('blocks drag on an empty shelf', () => {
    const { motion, drag } = setup({ count: 0 });
    drag(-PITCH);
    expect(motion.state.dragging).toBe(false);
  });

  it('leaves vertical scrolling and pinching to the browser while attached and restores it after detach', () => {
    const { element, detach } = setup();
    expect(element.style.touchAction).toBe('pan-y pinch-zoom');
    detach();
    expect(element.style.touchAction).toBe('');
  });
});

describe('motion.attach track', () => {
  /** A row whose spacing grows to the right: position(x) is not linear in x. */
  const curve = (x: number): number => 2 + (x - 500) / 100 / (1 + (x - 500) / 1000);

  it('follows the function it is given instead of the fixed pitch', () => {
    const track = vi.fn(() => curve);
    const { motion, fire } = setup({}, undefined, track);
    fire('pointerdown', { x: 500, t: 0 });
    fire('pointermove', { x: 600, t: 20 });
    expect(motion.state.position).toBeCloseTo(curve(600), 10);
    fire('pointermove', { x: 900, t: 40 });
    expect(motion.state.position).toBeCloseTo(curve(900), 10);
    expect(motion.state.position).not.toBeCloseTo(2 + 4, 3);
    expect(motion.state.dragging).toBe(true);
  });

  it('hands the press x, what was pressed and the current position to track', () => {
    const track = vi.fn((): ((x: number) => number) | null => null);
    const { motion, element, fire } = setup({ initial: 3 }, undefined, track);
    const inner = document.createElement('span');
    element.appendChild(inner);
    inner.dispatchEvent(pointer('pointerdown', { x: 480, t: 0 }));
    fire('pointermove', { x: 440, t: 20 });
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith({ x: 480, target: inner, position: 3 });
    expect(motion.state.position).toBeCloseTo(3.4, 10);
  });

  it('uses the fixed pitch when track returns null', () => {
    const { motion, drag } = setup({}, undefined, () => null);
    drag(-PITCH);
    expect(motion.state.position).toBeCloseTo(1, 10);
  });

  it('asks track once per drag and releases with the tracked speed', () => {
    const track = vi.fn(() => curve);
    const { motion, fire } = setup({}, undefined, track);
    fire('pointerdown', { x: 500, t: 0 });
    fire('pointermove', { x: 520, t: 20 });
    fire('pointermove', { x: 540, t: 40 });
    fire('pointermove', { x: 560, t: 60 });
    fire('pointerup', { x: 560, t: 60 });
    expect(track).toHaveBeenCalledTimes(1);
    const expected = (curve(560) - curve(520)) / 40;
    expect(motion.state.velocity).toBeCloseTo(expected, 6);
  });

  it('keeps the rubber band at the ends of a finite row on a tracked drag', () => {
    const { motion, fire } = setup({ loop: false }, undefined, () => (x: number) => (500 - x) / 100 - 2);
    fire('pointerdown', { x: 500, t: 0 });
    fire('pointermove', { x: 800, t: 20 });
    expect(motion.state.position).toBeLessThan(0);
    expect(motion.state.position).toBeGreaterThan(-5);
  });
});

describe('motion.attach wheel', () => {
  function wheel(element: HTMLElement, init: WheelEventInit): WheelEvent {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
    Object.defineProperty(event, 'shiftKey', { value: init.shiftKey === true });
    element.dispatchEvent(event);
    return event;
  }

  it('moves the shelf on a horizontal wheel and prevents the page scroll', () => {
    const { motion, element } = setup();
    const event = wheel(element, { deltaX: PITCH, deltaY: 0 });
    expect(event.defaultPrevented).toBe(true);
    expect(motion.state.position).toBeCloseTo(1, 10);
  });

  it('leaves a plain vertical wheel to the page', () => {
    const { motion, element } = setup();
    const event = wheel(element, { deltaX: 0, deltaY: PITCH });
    expect(event.defaultPrevented).toBe(false);
    expect(motion.state.position).toBe(0);
  });

  it('treats shift plus vertical wheel as sideways', () => {
    const { motion, element } = setup();
    const event = wheel(element, { deltaY: PITCH, shiftKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(motion.state.position).toBeCloseTo(1, 10);
  });

  it('settles on a whole index shortly after the wheel stops', () => {
    vi.useFakeTimers();
    const { clock, motion, element } = setup();
    wheel(element, { deltaX: 130 });
    expect(motion.state.dragging).toBe(true);
    vi.advanceTimersByTime(200);
    expect(motion.state.dragging).toBe(false);
    expect(motion.state.target).toBe(1);
    clock.advance(2000);
    expect(motion.state.position).toBe(1);
  });

  it('carries the speed of a trackpad scroll into the settle', () => {
    vi.useFakeTimers();
    const { clock, motion, element } = setup();
    for (let event = 0; event < 6; event++) {
      wheel(element, { deltaX: 5 });
      clock.advance(10);
    }
    expect(motion.state.position).toBeCloseTo(0.3, 10);
    vi.advanceTimersByTime(200);
    expect(motion.state.dragging).toBe(false);
    expect(motion.state.velocity).toBeGreaterThan(0.004);
    expect(motion.state.target).toBe(1);
    clock.advance(3000);
    expect(motion.state.position).toBe(1);
  });

  it('measures the scroll speed over the last 50 ms only', () => {
    vi.useFakeTimers();
    const { clock, motion, element } = setup();
    wheel(element, { deltaX: 60 });
    clock.advance(300);
    wheel(element, { deltaX: 1 });
    clock.advance(10);
    wheel(element, { deltaX: 1 });
    vi.advanceTimersByTime(200);
    expect(motion.state.velocity).toBeCloseTo(0.001, 6);
    expect(motion.state.target).toBe(1);
  });

  it('settles on the nearest volume when a single wheel notch arrives', () => {
    vi.useFakeTimers();
    const { motion, element } = setup();
    wheel(element, { deltaX: 130 });
    vi.advanceTimersByTime(200);
    expect(motion.state.velocity).toBe(0);
    expect(motion.state.target).toBe(1);
  });

  it('lands a trackpad scroll at once under reduced motion', () => {
    vi.useFakeTimers();
    const { motion, element } = setup({ reducedMotion: true });
    wheel(element, { deltaX: 130 });
    vi.advanceTimersByTime(200);
    expect(motion.state.position).toBe(1);
    expect(motion.state.velocity).toBe(0);
  });

  it('resists a wheel pushed past the end of a finite row', () => {
    const { motion, element } = setup({ loop: false, count: 5, initial: 4 });
    wheel(element, { deltaX: 3 * PITCH });
    expect(motion.state.overscroll).toBeGreaterThan(0.5);
    expect(motion.state.overscroll).toBeLessThan(3);
    expect(motion.state.position).toBeCloseTo(4 + motion.state.overscroll, 10);
  });

  it('ignores the wheel when disabled or detached', () => {
    const disabled = setup({}, () => false);
    expect(wheel(disabled.element, { deltaX: PITCH }).defaultPrevented).toBe(false);

    const attached = setup();
    attached.detach();
    expect(wheel(attached.element, { deltaX: PITCH }).defaultPrevented).toBe(false);
    expect(attached.motion.state.position).toBe(0);
  });
});
