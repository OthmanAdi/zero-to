import type { ScreenBox, Vec3 } from '../paper/motion';
import type { StationSpot } from '../props/station';
import { FLOW, type StopId, type StopState } from '../sections/model';

/** The stops whose stations the page draws in 3D: the four altitudes and what a roadmap carries. */
export const STAGED_STOPS: readonly StopId[] = ['what', 'trail'];

/**
 * The stations of the landing page as plain numbers. A staged stop is a box of the page one window tall, and its
 * paper station is drawn in 3D where the flat drawing stood. The one canvas stays where it is: every frame it is
 * cleared to the night, and each picture is drawn into the rows its box has on the screen. That is the hero
 * while it is in view, and every staged station whose box is. Nothing here touches three.js or the document.
 */
export const STAGING = {
  /**
   * The camera on a station: degrees above the sheet, degrees round it (negative stands a little to the left)
   * and the lens in degrees. It is fitted, not placed: it is moved along that direction until the sheet and what
   * stands on it fill the station's place.
   */
  shot: { elevation: 27, yaw: -10, fov: 32, narrowFov: 40 },
  /** A window narrower than this, in CSS pixels, is narrow, as the sections count it: the lens is `narrowFov`. */
  narrow: 900,
  /**
   * A station with more than one thing on it is framed one thing at a time. The camera of a thing is `elevation`
   * degrees up and `yaw` degrees round, fitted to the thing and `side` sheet units on either side of it, from
   * `back` behind its foot to `front` beyond the route in front of it. The hold is cut into one share per thing.
   * Round each boundary between two shares the camera pans for `pan` of a share on a smooth step, and it dwells on
   * a thing for the rest. The sheet comes up bare: the first thing stands once the hold is `pop` in, each next one
   * when the pan towards it is `arrive` of the way.
   */
  focus: { elevation: 20, yaw: -9, side: 0.45, back: 0.5, front: 0.3, pan: 0.48, pop: 0.06, arrive: 0.5 },
  /**
   * The walker on a held station, in the station's units. He is `scale` times his size on the walk and waits
   * `sign` past the start of the route while the sheet comes up. On a station framed one thing at a time he
   * crosses the sheet with the camera: while a thing is framed he walks slowly from `before` short of it to
   * `after` past it, which is about 0.38 of the way between two peaks, and he does the rest of the way during the
   * pan, at about twice the pace. After the last thing he walks on to `end` past it. On the ring he stands.
   */
  walker: { scale: 1.1, sign: 0.12, before: 0.55, after: 0.17, end: 0.3 },
  /** Room left round the station inside its place, as a share of the place on each side. */
  margin: 0.03,
  /**
   * The station's lamp, seen from the middle of the sheet: `azimuth` degrees round it and `elevation` degrees
   * up, `reach` half sheet widths away and never nearer than `least`. `strength` is its light on the sheet next
   * to the table's lamp, `cone` its half angle in degrees, `penumbra` how soft the edge of its pool is, and
   * `bounce` the share of it that an unshadowed light at the lamp gives back as the room's fill.
   */
  lamp: { azimuth: 122, elevation: 34, reach: 3.4, least: 7.6, strength: 0.82, cone: 30, penumbra: 0.7, focus: 0.7, bounce: 0.07, shadowMap: 1024 },
  /** Light that has no direction, so that a shadow on the sheet keeps its colour. */
  ambient: 0.21,
  /**
   * The cloth a station lies on: its radius in sheet widths, and the share of that radius from which it fades
   * into the night, so the pool of the lamp has no edge.
   */
  cloth: { radius: 1.15, fadeFrom: 0.4 },
  /**
   * A station is built when the top of its box is within this many window heights of the top of the window:
   * `busy` while the table's intro plays or the page moves, `calm` once the table stands still.
   */
  build: { busy: 1.15, calm: 2.2 },
  /** Where the stations stand in the scene: this far from the table and from each other, out of each other's sight. */
  away: 400,
  apart: 60,
  /**
   * The hero's picture ends this far below the top of the sections, where their ground has become the night:
   * a share of the window's height, and never more than `most` pixels. `app.css` draws the same band.
   */
  band: { share: 0.3, most: 280 },
} as const;

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);
const smooth = (t: number): number => t * t * (3 - 2 * t);
const seg = (value: number, from: number, to: number): number => clamp01((value - from) / (to - from));

/**
 * Which thing the camera frames at a share of the hold, as a number: 0 on the first, 1.5 half way from the second
 * to the third. It dwells on each thing and pans between two round the boundary of their shares (`STAGING.focus`).
 * Before the hold it is on the first, after it on the last.
 */
export function focusAt(hold: number, count: number): number {
  const n = Math.max(1, Math.round(count));
  const pan = STAGING.focus.pan / n;
  let at = 0;
  for (let k = 1; k < n; k += 1) at += smooth(seg(hold, k / n - pan / 2, k / n + pan / 2));
  return at;
}

/** How many of a station's things stand at a state of its stop, when it is framed one thing at a time. */
export function standingAt(state: Pick<StopState, 'phase' | 'hold'>, count: number): number {
  const n = Math.max(0, Math.round(count));
  if (state.phase === 'done') return n;
  if (state.phase !== 'active' || state.hold < STAGING.focus.pop) return 0;
  const at = focusAt(state.hold, n);
  let up = Math.min(1, n);
  for (let k = 1; k < n; k += 1) if (at >= k - 1 + STAGING.focus.arrive) up += 1;
  return up;
}

/**
 * The form to give a station so that its first `up` things stand and no more. A station stands thing `k` of `n`
 * once its form passes `FLOW.start + FLOW.spread * k / n`: this is half way between two of those steps.
 */
export function formFor(up: number, count: number): number {
  const n = Math.max(1, Math.round(count));
  if (up <= 0) return 0;
  if (up >= n) return 1;
  return FLOW.start + (FLOW.spread * (up - 0.5)) / n;
}

/**
 * Where the walker is along a held station at a share of its hold, as x in the station's units. `things` are the
 * x of the things framed one at a time, in order, and `start` the start of the route. With nothing to frame he
 * waits at the start.
 */
export function walkerAt(hold: number, things: readonly number[], start: number): number {
  const n = things.length;
  const sign = start + STAGING.walker.sign;
  if (n === 0) return sign;
  const pan = STAGING.focus.pan / n;
  const knots: [number, number][] = [[0, sign]];
  things.forEach((x, k) => {
    // The dwell on a thing: from the end of the pan towards it to the start of the pan away from it.
    if (k > 0) knots.push([k / n + pan / 2, x - STAGING.walker.before]);
    knots.push(k === n - 1 ? [1, x + STAGING.walker.end] : [(k + 1) / n - pan / 2, x + STAGING.walker.after]);
  });
  const at = clamp01(hold);
  for (let index = 1; index < knots.length; index += 1) {
    const [toShare, toX] = knots[index] as [number, number];
    const [fromShare, fromX] = knots[index - 1] as [number, number];
    if (at <= toShare) return fromX + (toX - fromX) * seg(at, fromShare, toShare);
  }
  return (knots[knots.length - 1] as [number, number])[1];
}

/** The points a camera is fitted to for one spot of a station, and where it aims first. */
export interface SpotFrame {
  readonly points: readonly Vec3[];
  readonly target: Vec3;
}

/**
 * What the camera of one spot frames: the spot's foot widened by `side` on each side, from `back` behind it to
 * `front` beyond the route in front of it, and its top. `routeFront` is the depth of the route in front of the
 * spot, and `cx` where the station stands in the scene along x.
 */
export function spotFrame(spot: StationSpot, routeFront: number, cx: number, margin: { readonly side: number; readonly back: number; readonly front: number } = STAGING.focus): SpotFrame {
  const half = spot.width / 2 + margin.side;
  const far = spot.z - spot.depth / 2 - margin.back;
  const near = Math.max(spot.z + spot.depth / 2, routeFront) + margin.front;
  const points: Vec3[] = [];
  for (const x of [spot.x - half, spot.x + half]) for (const z of [far, near]) points.push({ x: cx + x, y: 0, z });
  points.push({ x: cx + spot.x, y: spot.height, z: spot.z });
  return { points, target: { x: cx + spot.x, y: spot.height * 0.32, z: (far + near) / 2 } };
}

/** A box on the screen in pixels, as `getBoundingClientRect` gives it. */
export interface Rows {
  readonly top: number;
  readonly height: number;
}

/**
 * The rows of the window a box covers, from the top: `from` is its first row and `to` the row after its last.
 * Null when no part of it is in the window.
 */
export function boxRows(box: Rows, viewport: number): { readonly from: number; readonly to: number } | null {
  if (!(viewport > 0) || !(box.height > 0)) return null;
  const from = Math.max(0, Math.round(box.top));
  const to = Math.min(Math.round(viewport), Math.round(box.top + box.height));
  return to - from >= 1 ? { from, to } : null;
}

/** The row after the last one the hero's picture is drawn in, for the top of the sections on the screen. 0 for none. */
export function heroRows(sectionsTop: number, viewport: number): number {
  if (!(viewport > 0)) return 0;
  const band = Math.min(viewport * STAGING.band.share, STAGING.band.most);
  return Math.max(0, Math.min(Math.round(viewport), Math.round(sectionsTop + band)));
}

export interface Place {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The place of a station's picture as a box of the screen (-1 left and bottom, 1 right and top), for a stop
 * whose own box stands at the top of the window. `place` and `box` are both read from the screen at the same
 * moment, wherever the page is scrolled to: only where the place lies inside the box counts.
 */
export function placeBox(place: Place, box: Place, width: number, viewport: number, margin: number = STAGING.margin): ScreenBox {
  const w = Math.max(1, width);
  const h = Math.max(1, viewport);
  const insetX = place.width * margin;
  const insetY = place.height * margin;
  const left = place.left - box.left + insetX;
  const right = place.left - box.left + place.width - insetX;
  const top = place.top - box.top + insetY;
  const bottom = place.top - box.top + place.height - insetY;
  return { x0: (left / w) * 2 - 1, x1: (right / w) * 2 - 1, y0: 1 - (bottom / h) * 2, y1: 1 - (top / h) * 2 };
}

/** Where a station's lamp hangs, measured from the middle of its sheet, and how far away that is. */
export function lampPlace(sheetWidth: number): { readonly x: number; readonly y: number; readonly z: number; readonly distance: number } {
  const { azimuth, elevation, reach, least } = STAGING.lamp;
  const az = (azimuth * Math.PI) / 180;
  const el = (elevation * Math.PI) / 180;
  const distance = Math.max(least, (sheetWidth / 2) * reach);
  return { x: distance * Math.sin(az) * Math.cos(el), y: distance * Math.sin(el), z: -distance * Math.cos(az) * Math.cos(el), distance };
}

/** The lamp's candela at a distance, so that the sheet under it is as bright as under the table's lamp at `least`. */
export function lampCandela(tableCandela: number, distance: number): number {
  return tableCandela * STAGING.lamp.strength * (distance / STAGING.lamp.least) ** 2;
}

/** How much of the cloth shows at a share of its radius: all of it in the middle, none at the rim. */
export function clothShows(share: number): number {
  const from = STAGING.cloth.fadeFrom;
  if (!(share > from)) return 1;
  if (share >= 1) return 0;
  const t = (share - from) / (1 - from);
  return 1 - t * t * (3 - 2 * t);
}
