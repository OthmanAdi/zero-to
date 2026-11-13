import { createRandom } from '../core/random';

/**
 * The landing sections as plain numbers: which stops there are, how the page's scroll becomes the state of each
 * stop, and how the red thread is drawn and measured. Nothing here touches the DOM, so every rule can be tested
 * without a browser.
 *
 * All heights are in pixels measured from the top of the sections root. `y` is the scroll position in the same
 * frame: the distance from the top of the root to the top of the window.
 */

export const STOP_IDS = ['what', 'how', 'trail', 'class', 'map', 'install', 'questions', 'start'] as const;
export type StopId = (typeof STOP_IDS)[number];

/** The shape a leg of the thread takes on its way to a stop. No two neighbours share one. */
export type LegShape = 'curve' | 'straight' | 'switchbacks' | 'arc' | 'meander' | 'drop' | 'sweep';

export interface StopSpec {
  readonly id: StopId;
  /** The fragment a link to the stop uses. */
  readonly anchor: string;
  /**
   * Empty space before the stop, in window heights. The thread crosses it. A third of a window at most: with
   * the padding of the two boxes round it, the next stop's heading is in view before the last cards have left.
   */
  readonly gap: number;
  /** How long the stop stays pinned, in window heights. 0 for a stop that is read and used, not played. */
  readonly hold: number;
  /** How many things the stop brings to the front one after another while it is pinned. */
  readonly steps: number;
  readonly leg: LegShape;
  /** Where the thread leaves the stop, as a share of its width. */
  readonly exit: number;
  /** The last stop is laid out round the middle, and the thread comes in from above. */
  readonly centred?: boolean;
}

export const STOPS: readonly StopSpec[] = [
  { id: 'what', anchor: 'what-it-is', gap: 0.26, hold: 1.4, steps: 4, leg: 'curve', exit: 0.62 },
  { id: 'how', anchor: 'how-it-works', gap: 0.24, hold: 1.4, steps: 4, leg: 'straight', exit: 0.72 },
  { id: 'trail', anchor: 'on-the-trail', gap: 0.32, hold: 1.9, steps: 7, leg: 'switchbacks', exit: 0.74 },
  { id: 'class', anchor: 'for-a-class', gap: 0.26, hold: 1.2, steps: 4, leg: 'arc', exit: 0.48 },
  { id: 'map', anchor: 'the-map', gap: 0.3, hold: 1.1, steps: 1, leg: 'meander', exit: 0.56 },
  { id: 'install', anchor: 'install', gap: 0.26, hold: 0, steps: 1, leg: 'sweep', exit: 0.68 },
  { id: 'questions', anchor: 'questions', gap: 0.26, hold: 0, steps: 1, leg: 'curve', exit: 0.5 },
  { id: 'start', anchor: 'start', gap: 0.32, hold: 0, steps: 1, leg: 'drop', exit: 0.5, centred: true },
];

/** The first gap is shorter on a phone, where the hero is shorter too. */
export const PHONE_FIRST_GAP = 0.14;

export const FLOW = {
  /** A stop is the current one from this many window heights before its top reaches the top of the window. */
  navLead: 0.45,
  /** A pinned station forms between these two distances before it pins, in window heights. */
  formFrom: 0.9,
  formTo: 0.06,
  /** A stop that is not pinned forms while its top crosses this part of the window. */
  flowFormFrom: 0.95,
  flowFormTo: 0.45,
  /** The head of the thread keeps to this height of the window. */
  headLine: 0.55,
  /** A cut-out stands up when the station has formed this far: `start + spread * k / n`. */
  start: 0.05,
  spread: 0.8,
} as const;

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

function seg(value: number, from: number, to: number): number {
  if (!(to > from)) return value < from ? 0 : 1;
  return clamp01((value - from) / (to - from));
}

// ---------------------------------------------------------------------------------------------------------
// Scroll.

/**
 * The share of the sections that has been scrolled: 0 when the top of the root reaches the bottom of the
 * window, 1 when the bottom of the root does. `mountSections().update` takes this number.
 */
export function progressFromScroll(scrollY: number, rootTop: number, rootHeight: number, viewport: number): number {
  if (!(rootHeight > 0)) return 0;
  return clamp01((scrollY - rootTop + viewport) / rootHeight);
}

/** The scroll position inside the root for a progress: the inverse of `progressFromScroll` with `rootTop` 0. */
export function localScroll(progress: number, rootHeight: number, viewport: number): number {
  return clamp01(progress) * rootHeight - viewport;
}

/** Seconds a jump to another stop takes: longer for a longer way, never more than 3.2. */
export function goDuration(distance: number): number {
  return Math.min(3.2, 0.8 + Math.abs(distance) / 4000);
}

// ---------------------------------------------------------------------------------------------------------
// Stops.

/** Where one stop lies in the root. */
export interface StopSpan {
  /** Top of its section. */
  readonly top: number;
  /** Height of its box: the window when it is pinned, its own height when it is not. */
  readonly box: number;
  /** Pixels it stays pinned. 0 when it is not pinned. */
  readonly hold: number;
}

export type StopPhase = 'ahead' | 'forming' | 'active' | 'done';

export interface StopState {
  /** 0 to 1: how far the station has formed. */
  readonly form: number;
  /** 0 to 1: how far through its hold the stop is. */
  readonly hold: number;
  /** Which of its things is in front, or -1 before the hold starts and after it ends. */
  readonly step: number;
  readonly phase: StopPhase;
}

/** The scroll range in which a stop plays its hold. A stop that is not pinned plays it while it crosses the window. */
export function holdRange(span: StopSpan, viewport: number): readonly [from: number, to: number] {
  if (span.hold > 0) return [span.top, span.top + span.hold];
  const from = span.top - viewport * 0.4;
  return [from, Math.max(from + viewport * 0.3, span.top + span.box - viewport * 0.7)];
}

export function stopState(span: StopSpan, steps: number, viewport: number, y: number): StopState {
  const pinned = span.hold > 0;
  const form = pinned
    ? seg(y, span.top - viewport * FLOW.formFrom, span.top - viewport * FLOW.formTo)
    : seg(y, span.top - viewport * FLOW.flowFormFrom, span.top - viewport * FLOW.flowFormTo);
  const [from, to] = holdRange(span, viewport);
  const hold = seg(y, from, to);
  const count = Math.max(1, Math.round(steps));
  const playing = y >= from && y < to;
  const step = playing ? Math.min(count - 1, Math.floor(hold * count)) : -1;
  const phase: StopPhase = y >= to ? 'done' : y >= from ? 'active' : form > 0 ? 'forming' : 'ahead';
  return { form, hold, step, phase };
}

/**
 * The stop the index tabs show as current: the last one whose top is within `FLOW.navLead` window heights below
 * the top of the window, or -1 above the first stop. It never goes back while `y` grows.
 */
export function currentStop(spans: readonly StopSpan[], viewport: number, y: number): number {
  let current = -1;
  for (let index = 0; index < spans.length; index += 1) {
    const span = spans[index] as StopSpan;
    if (y >= span.top - viewport * FLOW.navLead) current = index;
    else break;
  }
  return current;
}

/** True when cut-out `index` of `count` stands at this form. Cut-outs stand up one after another. */
export function isUp(form: number, index: number, count: number): boolean {
  return form > FLOW.start + (FLOW.spread * index) / Math.max(1, count);
}

// ---------------------------------------------------------------------------------------------------------
// The thread.

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A sampled path with a running length table. */
export interface Polyline {
  readonly points: readonly Point[];
  /** `lengths[i]` is the length of the path from its start to `points[i]`. */
  readonly lengths: readonly number[];
  readonly length: number;
}

export function polyline(points: readonly Point[]): Polyline {
  const lengths: number[] = [0];
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1] as Point;
    const b = points[index] as Point;
    lengths.push((lengths[index - 1] as number) + Math.hypot(b.x - a.x, b.y - a.y));
  }
  return { points, lengths, length: lengths[lengths.length - 1] ?? 0 };
}

/** The index of the last point at or before `length` along the path. A binary search in the length table. */
export function indexAt(line: Polyline, length: number): number {
  let low = 0;
  let high = line.lengths.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((line.lengths[middle] as number) <= length) low = middle;
    else high = middle - 1;
  }
  return low;
}

export interface PathPoint extends Point {
  /** Direction of travel, in radians. */
  readonly angle: number;
  /** The index of the last sampled point behind this one. */
  readonly index: number;
}

/** The point at a length along the path, between its samples. */
export function pointAt(line: Polyline, length: number): PathPoint {
  const last = line.points.length - 1;
  if (last < 1) {
    const only = line.points[0] ?? { x: 0, y: 0 };
    return { x: only.x, y: only.y, angle: Math.PI / 2, index: 0 };
  }
  const at = Math.min(line.length, Math.max(0, length));
  const index = Math.min(last - 1, indexAt(line, at));
  const a = line.points[index] as Point;
  const b = line.points[index + 1] as Point;
  const span = (line.lengths[index + 1] as number) - (line.lengths[index] as number);
  const t = span > 0 ? (at - (line.lengths[index] as number)) / span : 0;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle: Math.atan2(b.y - a.y, b.x - a.x), index };
}

/**
 * One leg of the thread, from `(from, 0)` at the top of a gap to `(to, height)` at its bottom, as sampled
 * points. `width` is the room the leg may use. Every shape leaves and arrives heading straight down, so it
 * joins the legs inside the boxes without a kink, and its height never turns back.
 */
export function legPoints(shape: LegShape, from: number, to: number, width: number, height: number, samples = 96): Point[] {
  const span = to - from;
  const side = span >= 0 ? 1 : -1;
  const ease = (t: number): number => t * t * (3 - 2 * t);
  // Zero at both ends with a zero slope there, one in the middle.
  const hump = (t: number): number => Math.sin(Math.PI * t) ** 2;
  const reach = Math.min(width * 0.22, 260);
  const offset = (t: number): number => {
    switch (shape) {
      case 'curve':
        return span * ease(t);
      case 'straight':
        return span * ease(seg(t, 0.06, 0.94));
      case 'arc':
        return span * ease(t) + reach * side * hump(t);
      case 'sweep':
        return span * ease(t) - reach * 1.2 * side * hump(t ** 0.8);
      case 'switchbacks':
        return span * ease(t) + Math.min(width * 0.15, 180) * Math.sin(Math.PI * 5 * t) * hump(t) ** 0.5;
      case 'meander':
        return span * ease(t) + Math.min(width * 0.08, 100) * Math.sin(Math.PI * 4 * t) * hump(t) ** 0.5;
      case 'drop':
        return span * ease(seg(t, 0, 0.4));
    }
  };
  const out: Point[] = [];
  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples;
    out.push({ x: Math.min(width - 16, Math.max(16, from + offset(t))), y: height * t });
  }
  return out;
}

/**
 * The thread inside a stop's box: down the gutter, round a corner, along the foot of the box and out through
 * its bottom edge at `exit`. A centred box takes the thread straight down to `stopAt` and ends it there.
 */
export function boxLeg(width: number, height: number, gutter: number, band: number, exit: number, stopAt?: number): Point[] {
  if (stopAt !== undefined) {
    return [
      { x: width / 2, y: 0 },
      { x: width / 2, y: Math.max(1, Math.min(height, stopAt)) },
    ];
  }
  const foot = height - band;
  const radius = Math.min(26, band - 4, Math.abs(exit - gutter) / 2);
  const out: Point[] = [{ x: gutter, y: 0 }];
  const turn = exit >= gutter ? 1 : -1;
  const corner = (cx: number, cy: number, from: number, to: number) => {
    for (let step = 0; step <= 8; step += 1) {
      const angle = from + ((to - from) * step) / 8;
      out.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
    }
  };
  // Down the gutter, then turn towards the exit.
  if (turn > 0) corner(gutter + radius, foot - radius, Math.PI, Math.PI / 2);
  else corner(gutter - radius, foot - radius, 0, Math.PI / 2);
  // Along the foot, then turn down and leave.
  if (turn > 0) corner(exit - radius, foot + radius, -Math.PI / 2, 0);
  else corner(exit + radius, foot + radius, -Math.PI / 2, -Math.PI);
  out.push({ x: exit, y: height });
  return out;
}

export type DecoKind = 'tussock' | 'stone' | 'cairn';

export interface Deco extends Point {
  readonly kind: DecoKind;
  readonly flip: boolean;
  readonly size: number;
}

/**
 * Small things beside a leg: a tussock, a stone or a cairn every 120 to 340 pixels, from a seeded stream, so a
 * page always grows the same trail.
 */
export function decorate(line: Polyline, seed: string): Deco[] {
  const random = createRandom(`thread/${seed}`);
  const out: Deco[] = [];
  let at = 60 + random() * 120;
  while (at < line.length - 50) {
    const here = pointAt(line, at);
    const side = random() < 0.5 ? -1 : 1;
    const away = 16 + random() * 14;
    const roll = random();
    out.push({
      x: here.x + Math.cos(here.angle + Math.PI / 2) * away * side,
      y: here.y + Math.sin(here.angle + Math.PI / 2) * away * side,
      kind: roll < 0.55 ? 'tussock' : roll < 0.9 ? 'stone' : 'cairn',
      flip: random() < 0.5,
      size: 0.85 + random() * 0.4,
    });
    at += 120 + random() * 220;
  }
  return out;
}

/**
 * One piece of the thread: a leg across a gap, or the leg inside a box. The head travels it while the scroll
 * runs from `from` to `to`, at an even pace.
 */
export interface ThreadPiece {
  readonly from: number;
  readonly to: number;
  readonly length: number;
}

/**
 * The scroll range of a piece. The head keeps near `FLOW.headLine` of the window, so it enters a piece when the
 * top of the piece reaches that line and leaves when the bottom does. A pinned box holds the head for its hold
 * as well. Pieces that touch on the page therefore touch in scroll.
 */
export function pieceRange(top: number, height: number, hold: number, viewport: number): readonly [from: number, to: number] {
  const from = top - viewport * FLOW.headLine;
  return [from, from + height + hold];
}

export interface ThreadHead {
  /** The piece the head is on. */
  readonly piece: number;
  /** Length walked on that piece. */
  readonly along: number;
  /** Length walked on the whole thread. */
  readonly done: number;
}

/** Where the head of the thread is at a scroll position. `done` never shrinks while `y` grows. */
export function threadHead(pieces: readonly ThreadPiece[], y: number): ThreadHead {
  let done = 0;
  for (let index = 0; index < pieces.length; index += 1) {
    const piece = pieces[index] as ThreadPiece;
    if (y < piece.to || index === pieces.length - 1) {
      const along = piece.length * seg(y, piece.from, piece.to);
      return { piece: index, along, done: done + along };
    }
    done += piece.length;
  }
  return { piece: 0, along: 0, done: 0 };
}

/** The length of thread that is drawn in the route colour at a scroll position. */
export function threadLength(pieces: readonly ThreadPiece[], y: number): number {
  return threadHead(pieces, y).done;
}

// ---------------------------------------------------------------------------------------------------------
// Link age, for the gallery line in the footer.

export interface LinkAge {
  /** Whole days since the links were opened. Never negative. */
  readonly days: number;
  /** True while a recheck is not yet suggested: 30 days for a fast topic, 90 for any other. */
  readonly inDate: boolean;
}

export function linkAge(checkedOn: string, today: Date, freshness?: string): LinkAge | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(checkedOn);
  if (!match) return null;
  const then = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  if (!Number.isFinite(then)) return null;
  const days = Math.max(0, Math.round((now - then) / 86_400_000));
  return { days, inDate: days <= (freshness === 'fast' ? 30 : 90) };
}
