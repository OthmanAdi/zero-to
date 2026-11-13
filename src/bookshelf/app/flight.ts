/**
 * The flight of a volume from the shelf to its place beside the page, and back.
 *
 * One cover is laid out once at its landing size on a layer above everything, and only its transform
 * changes while it travels. The shelf hides its own volume and the reader hides its own cover for as
 * long as this one is in the air, so the volume is always in exactly one place.
 */

/** Where the presented cover stands on the shelf, in viewport px and degrees. */
export interface FlightStart {
  /** Centre of the cover face as drawn. */
  cx: number;
  cy: number;
  /** Size of the cover face before any turn or lean. */
  width: number;
  height: number;
  /** Sideways lean, negative to the left. */
  lean: number;
  /** How far the face is from square to the viewer. */
  yaw: number;
}

/** Where the cover lands beside the page, in viewport px. */
export interface FlightEnd {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One moment of the flight. Lengths in px, angles in degrees, the rest 0 to 1. */
export interface FlightPose {
  /** Foot of the cover: the middle of its lower edge. */
  x: number;
  y: number;
  scale: number;
  lean: number;
  yaw: number;
  /** Tip of the head toward the viewer, about the foot. Negative tips forward. */
  tip: number;
  /** Strength of the long shadow a lifted volume casts. */
  shadow: number;
  /** How much of the spine edge is still showing. */
  spine: number;
  /** How much of the highlight the cover had on the shelf is still on it. */
  light: number;
}

type Ease = (t: number) => number;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** A cubic Bézier timing curve through (0,0) and (1,1), solved for x by bisection. */
export function bezier(x1: number, y1: number, x2: number, y2: number): Ease {
  const at = (a: number, b: number, u: number): number => 3 * (1 - u) * (1 - u) * u * a + 3 * (1 - u) * u * u * b + u * u * u;
  return (t) => {
    const x = clamp01(t);
    if (x === 0 || x === 1) return x;
    let low = 0;
    let high = 1;
    for (let step = 0; step < 22; step++) {
      const middle = (low + high) / 2;
      if (at(x1, x2, middle) < x) low = middle;
      else high = middle;
    }
    return at(y1, y2, (low + high) / 2);
  };
}

const linear: Ease = (t) => clamp01(t);
const easeOut = bezier(0.2, 0, 0, 1);
const easeInOut = bezier(0.65, 0, 0.35, 1);

/** Progress of `time` through the window from `from` to `to`, eased. */
function within(time: number, from: number, to: number, ease: Ease): number {
  return ease((time - from) / (to - from));
}

/** Shares of the whole flight at which each beat begins and ends. */
const TIP_END = 0.2;
const CARRY_START = 0.143;
const CARRY_END = 0.8;
const TIP_BACK_END = 0.69;
const SPINE_GONE_FROM = 0.83;

const LIFT = 16;
const SETTLE = 2;
const NEAR = 0.024;
const TIP_ANGLE = -6;
const TURN_TOWARD = 8;

/**
 * The pose at `time`, where 0 is standing on the shelf and 1 is landed beside the page. The same curve
 * serves both directions, so a flight can be reversed at any moment without a jump.
 *
 * Going out: the volume tips its head forward and rises off the shelf, is carried on a path that climbs
 * first, turns a little toward where it is going, and settles the last two pixels into place.
 */
export function flightPose(time: number, start: FlightStart, end: FlightEnd): FlightPose {
  const t = clamp01(time);
  const startScale = end.width > 0 ? start.width / end.width : 1;
  const fromX = start.cx;
  const fromY = start.cy + start.height / 2;
  const toX = end.x + end.width / 2;
  const toY = end.y + end.height;

  const tipped = within(t, 0, TIP_END, easeOut) * (1 - within(t, TIP_END, TIP_BACK_END, easeInOut));
  const straight = within(t, 0, TIP_END, easeOut);
  const acrossX = within(t, CARRY_START, CARRY_END, easeInOut);
  const acrossY = within(t, CARRY_START, CARRY_END, easeOut);
  const landed = within(t, CARRY_END, 1, easeOut);
  const direction = Math.sign(toX - fromX);
  const towards = Math.sin(Math.PI * within(t, CARRY_START, CARRY_END, linear)) * TURN_TOWARD * direction;

  return {
    x: fromX + (toX - fromX) * acrossX,
    y: fromY + (toY - SETTLE - fromY) * acrossY - LIFT * tipped + SETTLE * landed,
    scale: (startScale + (1 - startScale) * acrossX) * (1 + NEAR * tipped),
    lean: start.lean * (1 - straight),
    yaw: start.yaw * (1 - straight) + towards,
    tip: TIP_ANGLE * tipped,
    shadow: within(t, 0, TIP_END, easeOut) * (1 - landed),
    spine: 1 - within(t, SPINE_GONE_FROM, 1, linear),
    light: 1 - acrossX,
  };
}

export interface FlightOptions {
  /** The cover to fly. It is moved into the flight layer and laid out at its landing size. */
  cover: HTMLElement;
  /** Class that gives the volume its cloth, for the spine edge. */
  clothClass?: string;
  start: FlightStart;
  end: FlightEnd;
  /** Width of the spine edge showing beside the cover at the start, in px at landing size. */
  spineEdge?: number;
  /** The highlight on the cover as it stands on the shelf: its opacity and the place of its band. */
  sheen?: { opacity: number; sweep: number };
  /** Where the layer goes. Defaults to the document body. */
  host?: HTMLElement;
}

export interface Flight {
  /** Places the volume for a moment of the flight: 0 on the shelf, 1 beside the page. */
  set(time: number): void;
  destroy(): void;
}

const round = (value: number): number => Math.round(value * 100) / 100;

/** The width the flying cover is laid out at: the larger of where it starts and where it lands. */
export function flightLayoutWidth(start: FlightStart, end: FlightEnd): number {
  return Math.max(start.width, end.width);
}

export function createFlight(options: FlightOptions): Flight {
  const { start, end } = options;
  const layer = document.createElement('div');
  layer.className = 'bb-flight';
  layer.setAttribute('aria-hidden', 'true');

  const book = document.createElement('div');
  book.className = options.clothClass ? `bb-flight__book ${options.clothClass}` : 'bb-flight__book';
  // Laid out once at the larger of its two sizes: a cover drops its type when it is drawn very small,
  // and a volume that lands in a small place must still read as itself when it leaves the shelf.
  const layoutWidth = flightLayoutWidth(start, end);
  const layoutHeight = end.width > 0 ? (layoutWidth * end.height) / end.width : end.height;
  const landing = layoutWidth > 0 ? end.width / layoutWidth : 1;
  book.style.width = `${layoutWidth}px`;
  book.style.height = `${layoutHeight}px`;

  const shadow = document.createElement('span');
  shadow.className = 'bb-flight__shadow';
  const spine = document.createElement('span');
  spine.className = 'bb-flight__spine';
  spine.style.width = `${Math.max(0, options.spineEdge ?? 0)}px`;

  book.append(shadow, spine, options.cover);
  // The same soft highlight the shelf lays over a presented cover, so the first frame in the air matches.
  const sheen = options.sheen && options.sheen.opacity > 0 ? document.createElement('span') : null;
  if (sheen && options.sheen) {
    sheen.className = 'bb-book__sheen';
    sheen.style.setProperty('--bb-sweep', String(options.sheen.sweep));
    book.appendChild(sheen);
  }
  layer.appendChild(book);
  (options.host ?? document.body).appendChild(layer);

  let last = '';
  const set = (time: number): void => {
    const pose = flightPose(time, start, end);
    const transform =
      `translate3d(${round(pose.x - layoutWidth / 2)}px, ${round(pose.y - layoutHeight)}px, 0) ` +
      `scale(${Math.round(pose.scale * landing * 1000) / 1000}) rotateZ(${round(pose.lean)}deg) ` +
      `rotateX(${round(pose.tip)}deg) rotateY(${round(pose.yaw)}deg)`;
    if (transform === last) return;
    last = transform;
    book.style.transform = transform;
    shadow.style.opacity = String(round(pose.shadow));
    spine.style.transform = `scaleX(${round(pose.spine)})`;
    if (sheen && options.sheen) sheen.style.setProperty('--bb-sheen', String(round(options.sheen.opacity * pose.light * 1000) / 1000));
  };

  return {
    set,
    destroy() {
      layer.remove();
    },
  };
}
