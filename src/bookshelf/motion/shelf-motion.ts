import { browserClock, type Clock } from './clock';
import { attachDrag } from './gesture';
import { clamp, easeInOutCubic, linear, SETTLE_SPRING, stepSpring, wrapIndex, type SpringConfig } from './spring';

export type Unsubscribe = () => void;

/**
 * Everything a renderer needs to draw one frame. `position` is a float in item
 * units: 3.4 means "40% of the way from volume 3 to volume 4". With `loop` on
 * it is unbounded and the renderer wraps it.
 */
export interface ShelfMotionState {
  position: number;
  /** Items per millisecond. */
  velocity: number;
  /** Whole index the shelf is settling on. Unbounded when looping. */
  target: number;
  /** `target` wrapped into 0..count-1. */
  focus: number;
  /**
   * How far `position` lies outside a finite row, in items: negative before the first volume, positive past the
   * last, 0 inside the row and always 0 when looping. A renderer can lay out `position - overscroll` and
   * translate the whole row by `overscroll`.
   */
  overscroll: number;
  /** 0 closed, 1 open. Already eased. */
  open: number;
  /** Linear time of the open or close, 0 closed to 1 open, not eased. Reversing keeps it continuous. */
  openTime: number;
  /** Where `open` is heading. */
  openTarget: 0 | 1;
  dragging: boolean;
  /** True when nothing is moving. The frame loop sleeps while this holds. */
  settled: boolean;
  /** True when motion is reduced: moves are instant and open is a short fade. */
  reduced: boolean;
}

/**
 * Eased travel for programmed moves (arrow keys, arrow buttons, picking a spine).
 * Duration in ms is `min(max, base + perItem * (items - 1))`, eased in and out. A travel that begins while the
 * row is moving starts at the speed the row has and slows into the new target.
 */
export interface TravelTiming {
  base: number;
  perItem: number;
  max: number;
}

/** All durations in ms. A plain object so a renderer's variant can carry it without importing this module. */
export interface MotionTiming {
  /** Null means programmed moves use the same spring as a released drag. */
  travel: TravelTiming | null;
  openDuration: number;
  closeDuration: number;
  /** Accepted so older callers compile; the opening starts at once and this value is ignored. */
  openHold: number;
}

export const DEFAULT_TIMING: MotionTiming = { travel: null, openDuration: 700, closeDuration: 520, openHold: 0 };

export interface ShelfMotionOptions {
  count: number;
  loop?: boolean;
  initial?: number;
  /** Fixed value, or a function read on every move so a media query can change it live. */
  reducedMotion?: boolean | (() => boolean);
  clock?: Clock;
  spring?: SpringConfig;
  timing?: Partial<MotionTiming>;
  /** Shorthand for `timing.openDuration` and `timing.closeDuration`. */
  openDuration?: number;
  closeDuration?: number;
}

/** What a host learns when a drag begins, to decide which row position keeps the grabbed item under the pointer. */
export interface TrackStart {
  /** Pointer x at the press, in client px. */
  x: number;
  /** What the press landed on. */
  target: EventTarget | null;
  /** Row position when the drag began, in items. */
  position: number;
}

export interface AttachOptions {
  /** Horizontal distance between two neighbouring volumes at rest, in px. Used when `track` is absent or declines. */
  pxPerItem: () => number;
  /** Width of the visible scene in px. It bounds how far a finite row can be pulled past its end. */
  extent?: () => number;
  /**
   * Called when a drag begins. Return a function from pointer x to row position and the drag follows it, so
   * what was grabbed stays under the pointer whatever the spacing. Return null to drag by `pxPerItem`.
   */
  track?: (start: TrackStart) => ((x: number) => number) | null;
  /** Return false to ignore a pointerdown, for example while a book is open. */
  enabled?: () => boolean;
}

export interface ShelfMotion {
  readonly state: Readonly<ShelfMotionState>;
  /** Called on every frame that changed something, and once immediately. */
  subscribe(listener: (state: Readonly<ShelfMotionState>) => void): Unsubscribe;
  goTo(index: number, options?: { immediate?: boolean }): void;
  step(direction: -1 | 1): void;
  setCount(count: number, focus?: number): void;
  /** Switches between an endless row and a row with two ends, keeping the centred volume. */
  setLoop(loop: boolean): void;
  /** Changes travel and open timing, for example when the look changes. Missing fields keep their value. */
  setTiming(timing: Partial<MotionTiming>): void;
  /** Resolves when the open or close has finished, or was replaced by the opposite call. */
  setOpen(open: boolean, options?: { immediate?: boolean }): Promise<void>;
  /** Wires pointer drag and horizontal wheel on an element. */
  attach(element: HTMLElement, options: AttachOptions): Unsubscribe;
  destroy(): void;
}

const FLICK_SPEED = 0.35; // px per ms
const FLICK_MIN_TRAVEL = 24; // px
const FLICK_DECAY_MS = 325;
/** Window of recent positions that gives the speed of a released drag. */
const RELEASE_VELOCITY_WINDOW_MS = 80;
/** Window of recent wheel positions that gives the speed of a trackpad scroll. */
const WHEEL_VELOCITY_WINDOW_MS = 50;
const FLICK_MAX_ITEMS = 6;
/** Every release looks this far ahead before it snaps, so a gentle push never slides back against the hand. */
const RELEASE_PROJECTION_MS = 180;
/** How far past the visible volume repeated steps may aim. A held key never queues further than this. */
const STEP_LEAD_ITEMS = 2;
/** Resistance at the start of a pull past the end of a finite row; it grows stiffer as the pull lengthens. */
const OVERSCROLL_RESISTANCE = 0.55;
/** Pull limit in items when the host does not report the scene width. */
const DEFAULT_OVERSCROLL_ITEMS = 8;
const REDUCED_FADE_MS = 150;
const WHEEL_SETTLE_MS = 140;
/**
 * A move that leaves rest counts its first frame as one frame already travelled, so that frame differs from
 * the resting state. The time between the call and that frame is unknown and the frame may even carry an
 * earlier timestamp than the call.
 */
const FIRST_FRAME_MS = 1000 / 60;

/** Row position at a moment, in items. Release speed is measured from these, never from pixels. */
interface PositionSample {
  time: number;
  position: number;
}

const POSITION_SAMPLES = 16;

function pushSample(samples: PositionSample[], time: number, position: number): void {
  samples.push({ time, position });
  if (samples.length > POSITION_SAMPLES) samples.shift();
}

/**
 * Items per millisecond over the samples no older than `windowMs` before `now`. Zero when they say nothing.
 *
 * With `bridge`, a single sample inside the window is measured against the one before it. Moves arrive with
 * the frames, and a frame that comes late leaves only the last move of a throw inside the window: the
 * pointer was moving all the same, at the speed of that last stretch. A pointer that rested has no sample
 * inside the window at all, and still carries no speed.
 */
function sampleVelocity(samples: PositionSample[], now: number, windowMs: number, bridge = false): number {
  let first: PositionSample | undefined;
  let last: PositionSample | undefined;
  let before: PositionSample | undefined;
  for (const sample of samples) {
    if (now - sample.time > windowMs) {
      before = sample;
      continue;
    }
    first ??= sample;
    last = sample;
  }
  if (bridge && first && first === last && before) first = before;
  if (!first || !last || last.time <= first.time) return 0;
  return (last.position - first.position) / (last.time - first.time);
}

interface Travel {
  from: number;
  to: number;
  /** Items per millisecond when the travel began. */
  velocity: number;
  /** Null until the first frame of the travel. */
  start: number | null;
  span: number;
}

export function createShelfMotion(options: ShelfMotionOptions): ShelfMotion {
  const clock = options.clock ?? browserClock;
  const spring = options.spring ?? SETTLE_SPRING;
  let loop = options.loop ?? true;
  const timing: MotionTiming = { ...DEFAULT_TIMING, ...options.timing };
  if (options.openDuration !== undefined) timing.openDuration = options.openDuration;
  if (options.closeDuration !== undefined) timing.closeDuration = options.closeDuration;

  let count = Math.max(0, Math.floor(options.count));
  const start = clampIndex(options.initial ?? 0);

  const state: ShelfMotionState = {
    position: start,
    velocity: 0,
    target: start,
    focus: wrapIndex(start, count),
    overscroll: 0,
    open: 0,
    openTime: 0,
    openTarget: 0,
    dragging: false,
    settled: true,
    reduced: readReduced(),
  };

  const listeners = new Set<(state: Readonly<ShelfMotionState>) => void>();
  let frame: number | null = null;
  let lastTime = 0;
  let destroyed = false;
  let travel: Travel | null = null;

  // Open tween bookkeeping. `openRaw` is linear time, `state.open` is eased.
  let openRaw = 0;
  let openFrom = 0;
  let openStartTime: number | null = null;
  let openSpan = 0;
  let openResolvers: Array<() => void> = [];

  let dragOrigin = 0;
  let dragBias = 0;
  let wheelRaw = 0;
  let wheelSamples: PositionSample[] = [];
  let wheelVelocity = 0;
  let overscrollItems = DEFAULT_OVERSCROLL_ITEMS;
  let dragStartTarget = 0;
  let dragTravel = 0;
  let dragSamples: PositionSample[] = [];
  let dragTrack: ((x: number) => number) | null = null;

  function readReduced(): boolean {
    const value = options.reducedMotion;
    return typeof value === 'function' ? value() : value === true;
  }

  function clampIndex(index: number): number {
    if (count <= 0) return 0;
    const whole = Math.round(index);
    return loop ? whole : clamp(whole, 0, count - 1);
  }

  function syncOverscroll(): void {
    if (loop || count <= 0) {
      state.overscroll = 0;
      return;
    }
    state.overscroll = state.position - clamp(state.position, 0, count - 1);
  }

  // What listeners last saw. A frame that leaves all of it as it was costs them nothing.
  const emitted = { ...state };

  function differsFromEmitted(): boolean {
    return (
      state.position !== emitted.position ||
      state.velocity !== emitted.velocity ||
      state.target !== emitted.target ||
      state.focus !== emitted.focus ||
      state.overscroll !== emitted.overscroll ||
      state.open !== emitted.open ||
      state.openTime !== emitted.openTime ||
      state.openTarget !== emitted.openTarget ||
      state.dragging !== emitted.dragging ||
      state.settled !== emitted.settled ||
      state.reduced !== emitted.reduced
    );
  }

  function emit(): void {
    Object.assign(emitted, state);
    for (const listener of listeners) listener(state);
  }

  function setTarget(index: number): void {
    state.target = clampIndex(index);
    state.focus = wrapIndex(state.target, count);
  }

  function wake(): void {
    state.settled = false;
    if (frame !== null || destroyed) return;
    lastTime = clock.now();
    frame = clock.request(tick);
  }

  function resolveOpen(): void {
    const resolvers = openResolvers;
    openResolvers = [];
    for (const resolve of resolvers) resolve();
  }

  function stepTravel(active: Travel, time: number, dt: number): boolean {
    if (active.start === null) active.start = time - FIRST_FRAME_MS;
    const t = active.span <= 0 ? 1 : clamp((time - active.start) / active.span, 0, 1);
    // The second term is a Hermite tangent: it carries the starting speed in and is zero, with zero slope, at t = 1.
    const carried = active.velocity * active.span * t * (1 - t) * (1 - t);
    const next = active.from + (active.to - active.from) * easeInOutCubic(t) + carried;
    state.velocity = dt > 0 ? (next - state.position) / dt : 0;
    state.position = next;
    if (t < 1) return false;
    state.position = state.target;
    state.velocity = 0;
    travel = null;
    return true;
  }

  function stepOpen(time: number): boolean {
    if (openRaw === state.openTarget) return true;
    if (openStartTime === null) {
      // The tween runs on the clock of the frames, not on the clock of the call that asked for it.
      const fromRest = openFrom === 0 || openFrom === 1;
      openStartTime = fromRest ? time - FIRST_FRAME_MS : time;
    }
    const t = openSpan <= 0 ? 1 : clamp((time - openStartTime) / openSpan, 0, 1);
    openRaw = openFrom + (state.openTarget - openFrom) * t;
    const ease = state.reduced ? linear : easeInOutCubic;
    state.openTime = openRaw;
    state.open = ease(openRaw);
    if (t < 1) return false;
    openRaw = state.openTarget;
    state.openTime = state.openTarget;
    state.open = state.openTarget;
    resolveOpen();
    return true;
  }

  function tick(time: number): void {
    frame = null;
    if (destroyed) return;
    const dt = time - lastTime;
    lastTime = time;

    let positionResting = false;
    if (!state.dragging) {
      if (travel) {
        positionResting = stepTravel(travel, time, dt);
      } else {
        const body = { value: state.position, velocity: state.velocity };
        positionResting = stepSpring(body, state.target, dt, spring);
        state.position = body.value;
        state.velocity = body.velocity;
      }
    }

    const openResting = stepOpen(time);
    syncOverscroll();
    state.settled = positionResting && openResting && !state.dragging;
    if (differsFromEmitted()) emit();
    // A held pointer or wheel moves nothing between events: sleep, and let the next event wake the loop.
    const moving = !openResting || (!state.dragging && !positionResting);
    if (moving) frame = clock.request(tick);
  }

  function goTo(index: number, goOptions: { immediate?: boolean } = {}): void {
    if (count <= 0) return;
    state.reduced = readReduced();
    setTarget(index);
    if (goOptions.immediate || state.reduced) {
      travel = null;
      state.position = state.target;
      state.velocity = 0;
      syncOverscroll();
      emit();
      if (openRaw === state.openTarget && !state.dragging) state.settled = true;
      return;
    }
    const distance = Math.abs(state.target - state.position);
    if (timing.travel && distance > 0) {
      const { base, perItem, max } = timing.travel;
      const span = Math.min(max, base + perItem * Math.max(0, distance - 1));
      travel = { from: state.position, to: state.target, velocity: state.velocity, start: null, span };
    } else {
      travel = null;
    }
    wake();
  }

  function step(direction: -1 | 1): void {
    const limit = Math.round(state.position) + direction * STEP_LEAD_ITEMS;
    const next = state.target + direction;
    // A target already beyond the limit (an explicit goTo) stays where it is; a step never pulls it back.
    goTo(direction > 0 ? Math.min(next, Math.max(limit, state.target)) : Math.max(next, Math.min(limit, state.target)));
  }

  function setCount(next: number, focus?: number): void {
    // Read the focused item before the count changes: a looping target only means something for the old row.
    const kept = state.focus;
    count = Math.max(0, Math.floor(next));
    const index = clampIndex(focus ?? Math.min(kept, Math.max(count - 1, 0)));
    travel = null;
    state.position = index;
    state.velocity = 0;
    setTarget(index);
    syncOverscroll();
    emit();
  }

  function setOpen(open: boolean, openOptions: { immediate?: boolean } = {}): Promise<void> {
    const target: 0 | 1 = open ? 1 : 0;
    state.reduced = readReduced();
    // A reversal ends the previous call's promise: that open or close is over.
    resolveOpen();
    state.openTarget = target;

    if (openOptions.immediate) {
      openRaw = target;
      state.openTime = target;
      state.open = target;
      emit();
      return Promise.resolve();
    }
    if (openRaw === target) return Promise.resolve();

    const full = state.reduced ? REDUCED_FADE_MS : open ? timing.openDuration : timing.closeDuration;
    openFrom = openRaw;
    openSpan = full * Math.abs(target - openRaw);
    openStartTime = null;
    const done = new Promise<void>((resolve) => openResolvers.push(resolve));
    wake();
    return done;
  }

  /** Pull of `distance` items past an end of a finite row to the distance the row actually moves. */
  function resist(distance: number): number {
    return (1 - 1 / ((distance * OVERSCROLL_RESISTANCE) / overscrollItems + 1)) * overscrollItems;
  }

  /** The inverse of `resist`. */
  function unresist(moved: number): number {
    const share = Math.min(moved / overscrollItems, 0.999999);
    return (share / (1 - share)) * (overscrollItems / OVERSCROLL_RESISTANCE);
  }

  /** Where a finite row actually sits when the pointer asks for `position`: it gives progressively less past the ends. */
  function limitDragPosition(position: number): number {
    if (loop || count <= 0) return position;
    const max = count - 1;
    if (position < 0) return -resist(-position);
    if (position > max) return max + resist(position - max);
    return position;
  }

  /** The position the pointer would have to ask for to put a finite row at `position`. */
  function unlimitPosition(position: number): number {
    if (loop || count <= 0) return position;
    const max = count - 1;
    if (position < 0) return -unresist(-position);
    if (position > max) return max + unresist(position - max);
    return position;
  }

  function attach(element: HTMLElement, attachOptions: AttachOptions): Unsubscribe {
    const isEnabled = (): boolean => (attachOptions.enabled ? attachOptions.enabled() : true) && count > 0;
    const pitch = (): number => Math.max(1, attachOptions.pxPerItem());
    const measureOverscroll = (): void => {
      overscrollItems = attachOptions.extent ? Math.max(1, attachOptions.extent() / pitch()) : DEFAULT_OVERSCROLL_ITEMS;
    };

    const detachDrag = attachDrag(
      element,
      {
        onStart(_event, origin) {
          travel = null;
          state.dragging = true;
          state.velocity = 0;
          measureOverscroll();
          // Grabbing a row that is still pulled past its end carries on from where the pointer would have put it.
          dragOrigin = unlimitPosition(state.position);
          dragBias = dragOrigin - state.position;
          dragStartTarget = state.target;
          dragTravel = 0;
          dragSamples = [];
          dragTrack = attachOptions.track?.({ x: origin.x, target: origin.target, position: state.position }) ?? null;
          wake();
        },
        onMove(dx, event, x) {
          dragTravel = dx;
          state.position = limitDragPosition(dragTrack ? dragTrack(x) + dragBias : dragOrigin - dx / pitch());
          syncOverscroll();
          pushSample(dragSamples, event.timeStamp, state.position);
          setTarget(state.position);
          wake();
        },
        onEnd(_velocityX, cancelled, time) {
          // A released drag always settles on the spring, whatever the travel timing: it has to feel held.
          travel = null;
          state.dragging = false;
          const itemsPerMs = cancelled ? 0 : sampleVelocity(dragSamples, time, RELEASE_VELOCITY_WINDOW_MS, true);
          const isFlick = !cancelled && Math.abs(itemsPerMs) * pitch() >= FLICK_SPEED && Math.abs(dragTravel) >= FLICK_MIN_TRAVEL;
          let destination = Math.round(state.position + itemsPerMs * (isFlick ? FLICK_DECAY_MS : RELEASE_PROJECTION_MS));
          if (isFlick && destination === dragStartTarget) {
            // A flick always moves at least one volume in its direction.
            destination = dragStartTarget + (itemsPerMs > 0 ? 1 : -1);
          }
          // A throw carries the row no further than this from where the drag began. A hand that has itself
          // taken the row further than that is not undone: the row never goes back behind where it was let go.
          const here = Math.round(state.position);
          destination = clamp(
            destination,
            Math.min(dragStartTarget - FLICK_MAX_ITEMS, here),
            Math.max(dragStartTarget + FLICK_MAX_ITEMS, here),
          );
          setTarget(destination);
          state.velocity = cancelled || state.reduced ? 0 : itemsPerMs;
          if (state.reduced) {
            state.position = state.target;
            syncOverscroll();
          }
          wake();
        },
      },
      { shouldStart: () => isEnabled() && state.open === 0 },
    );

    let wheelTimer: ReturnType<typeof setTimeout> | null = null;
    const onWheel = (event: WheelEvent): void => {
      if (!isEnabled() || state.open !== 0) return;
      const sideways = event.shiftKey ? event.deltaY : event.deltaX;
      // Plain vertical wheel belongs to the page.
      if (!event.shiftKey && Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      event.preventDefault();
      travel = null;
      if (wheelTimer === null) {
        measureOverscroll();
        wheelRaw = unlimitPosition(state.position);
        wheelSamples = [];
      }
      state.dragging = true;
      wheelRaw += sideways / pitch();
      state.position = limitDragPosition(wheelRaw);
      syncOverscroll();
      state.velocity = 0;
      const now = clock.now();
      pushSample(wheelSamples, now, state.position);
      // Taken at every event: once the events stop, the last one tells how fast the scroll was going.
      wheelVelocity = sampleVelocity(wheelSamples, now, WHEEL_VELOCITY_WINDOW_MS);
      setTarget(state.position);
      wake();
      if (wheelTimer !== null) clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => {
        wheelTimer = null;
        state.dragging = false;
        state.reduced = readReduced();
        const itemsPerMs = state.reduced ? 0 : wheelVelocity;
        const here = Math.round(state.position);
        setTarget(clamp(Math.round(state.position + itemsPerMs * RELEASE_PROJECTION_MS), here - FLICK_MAX_ITEMS, here + FLICK_MAX_ITEMS));
        state.velocity = itemsPerMs;
        if (state.reduced) {
          state.position = state.target;
          syncOverscroll();
        }
        wake();
      }, WHEEL_SETTLE_MS);
    };
    element.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      detachDrag();
      element.removeEventListener('wheel', onWheel);
      if (wheelTimer !== null) clearTimeout(wheelTimer);
    };
  }

  return {
    state,
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    goTo,
    step,
    setCount,
    setLoop(value) {
      loop = value;
      setCount(count, state.focus);
    },
    setTiming(next) {
      Object.assign(timing, next);
    },
    setOpen,
    attach,
    destroy() {
      destroyed = true;
      if (frame !== null) clock.cancel(frame);
      frame = null;
      listeners.clear();
      resolveOpen();
    },
  };
}
