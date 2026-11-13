import { clamp01, easeInOutCubic, easeInOutQuad, easeOutCubic, lerp, orbitDirection, seg, smooth, type CameraPose, type Vec3 } from '../paper/motion';
import { WALK } from '../walk/timeline';

/**
 * The page's own timelines as plain numbers: the dive through the red pin, the walk's stretch of the scroll,
 * the finale and the way back to the table. Nothing here touches the scene or the document.
 */

/** The dive, in hero-exit progress `hx` (0 on the table, 1 on the open map). */
export const DIVE = {
  /** Seconds the dive takes, eased cubic in and out. */
  seconds: 4.4,
  /** The table's interface has gone by here. */
  interfaceGone: 0.1,
  /** The camera falls onto the pin between these. */
  fall: { from: 0.08, to: 0.6 },
  /** The table is taken away and the open map stands behind the pin. */
  cut: 0.6,
  /** A sheet in the colour of the pin's head covers the frame between these, fading over `fade` on each side. */
  guard: { from: 0.585, to: 0.615, fade: 0.01 },
  /** The camera at the end of the fall: nearly overhead, turned a little. */
  end: { elevation: 80, yaw: 20 },
  /** The near plane follows the camera's distance between these limits, so the head is never clipped. */
  near: { close: 0.005, rest: 0.1, share: 0.08 },
  /** Strength of the map's own lights at the first moment of the landing, inside the red head. */
  landingLight: 0.5,
  /** Seconds the red may be held for a map that is still being built. */
  hold: 1.2,
  /** The overlay of the walk arrives when the landing is this far. */
  overlayAt: 0.6,
  /** Reduced motion: no dive, a sheet in the colour of the dark room fades over this many milliseconds. */
  fadeMs: 150,
} as const;

/** Hero-exit progress `seconds` into the dive. */
export function hxAt(seconds: number): number {
  return easeInOutCubic(clamp01(seconds / DIVE.seconds));
}

/** The inverse of `hxAt`: seconds into the dive at which it is at `hx`. */
export function diveSecondsAt(hx: number): number {
  const y = clamp01(hx);
  const x = y < 0.5 ? Math.cbrt(y / 4) : 1 - Math.cbrt((1 - y) * 2) / 2;
  return x * DIVE.seconds;
}

/** Opacity of the red guard at `hx`: 1 across the cut, 0 away from it. */
export function guardOpacity(hx: number): number {
  const { from, to, fade } = DIVE.guard;
  if (!(hx > from - fade) || !(hx < to + fade)) return 0;
  return Math.min(seg(hx, from - fade, from), 1 - seg(hx, to, to + fade));
}

/** How far the camera has fallen toward the pin, 0 to 1. */
export function fallShare(hx: number): number {
  return seg(hx, DIVE.fall.from, DIVE.fall.to);
}

/** The landing on the map, 0 inside the red head and 1 on the stage shot. Null before the cut. */
export function landingShare(hx: number): number | null {
  return hx < DIVE.cut ? null : seg(hx, DIVE.cut, 1);
}

/** Opacity of the table's interface during the dive. */
export function interfaceOpacity(hx: number): number {
  return 1 - smooth(seg(hx, 0, DIVE.interfaceGone));
}

/** The near plane for a camera this far from what it looks at. */
export function nearPlane(distance: number): number {
  return Math.min(DIVE.near.rest, Math.max(DIVE.near.close, distance * DIVE.near.share));
}

export interface DiveInput {
  /** The camera on the table when the dive starts. */
  readonly from: { readonly position: Vec3; readonly target: Vec3; readonly fov: number };
  /** Centre of the pin's head. */
  readonly head: Vec3;
  /** Distance from the centre of the head at which the head fills the frame. */
  readonly headDistance: number;
}

const DEG = 180 / Math.PI;

/**
 * The camera during the fall. It turns from the hero shot to nearly overhead, looks at the pin's head long
 * before it arrives, and closes the distance at an even rate of zoom that picks up toward the end, so the
 * head grows into the frame without a jump.
 */
export function divePose(hx: number, input: DiveInput): CameraPose {
  const { from, head } = input;
  const f = fallShare(hx);
  const vx = from.position.x - from.target.x;
  const vy = from.position.y - from.target.y;
  const vz = from.position.z - from.target.z;
  const startDistance = Math.max(1e-6, Math.hypot(vx, vy, vz));
  const startElevation = Math.asin(Math.min(1, Math.max(-1, vy / startDistance))) * DEG;
  const startYaw = Math.atan2(vx, vz) * DEG;

  const turn = smooth(f);
  const look = easeOutCubic(seg(f, 0, 0.72));
  const zoom = f ** 1.8;
  const elevation = lerp(startElevation, DIVE.end.elevation, turn);
  const yaw = lerp(startYaw, DIVE.end.yaw, turn);
  const distance = Math.exp(lerp(Math.log(startDistance), Math.log(Math.max(1e-6, input.headDistance)), zoom));
  const target: Vec3 = { x: lerp(from.target.x, head.x, look), y: lerp(from.target.y, head.y, look), z: lerp(from.target.z, head.z, look) };
  const direction = orbitDirection(elevation, yaw);
  return {
    position: { x: target.x + direction.x * distance, y: target.y + direction.y * distance, z: target.z + direction.z * distance },
    target,
    distance,
    fov: from.fov,
  };
}

/** A pose between two poses. */
export function mixPose(a: CameraPose, b: CameraPose, t: number): CameraPose {
  const k = clamp01(t);
  const position = { x: lerp(a.position.x, b.position.x, k), y: lerp(a.position.y, b.position.y, k), z: lerp(a.position.z, b.position.z, k) };
  const target = { x: lerp(a.target.x, b.target.x, k), y: lerp(a.target.y, b.target.y, k), z: lerp(a.target.z, b.target.z, k) };
  return { position, target, distance: Math.hypot(position.x - target.x, position.y - target.y, position.z - target.z), fov: lerp(a.fov, b.fov, k) };
}

/** The landing hands the camera to the rail over the last part of its way. */
export function landingHandover(u: number): number {
  return smooth(seg(u, 0.78, 1));
}

// ---------------------------------------------------------------------------------------------------------
// The walk's stretch of the scroll.

/** Progress smoothing: one critically damped spring, 95 percent there in about 0.6 s. */
export const SCROLL = { omega: 8, settle: 0.6, stepSeconds: 0.8, longest: 3.2, pixelsPerSecond: 4000 } as const;

/**
 * Walk progress at the top of the walk's stretch. The dive hands over at 0.086, and the first panel's scene has
 * stood up a moment later, at the start of the first stage: that is where the landing ends and the scroll begins.
 */
export const WALK_TOP = WALK.stages.from + 0.004;

/** Walk progress for a scroll position. */
export function walkProgressAt(scrollY: number, range: number): number {
  const share = range > 0 ? clamp01(scrollY / range) : 0;
  return WALK_TOP + (1 - WALK_TOP) * share;
}

/** The scroll position for a walk progress: the inverse of `walkProgressAt`. */
export function walkScrollFor(progress: number, range: number): number {
  return clamp01((progress - WALK_TOP) / (1 - WALK_TOP)) * Math.max(0, range);
}

/** Height of the walk's stretch in viewports: its own length and one more for the window. */
export function stretchViewports(viewports: number): number {
  return Math.max(1, viewports) + 1;
}

/** The finale starts with the wide shot. The map is shut and the way back starts at `shut`. */
export const FINALE = { from: WALK.wide.from, line: WALK.wide.from + 0.02, down: WALK.down.from, closing: WALK.shut.from - 0.004, shut: 0.992 } as const;

export function isFinale(progress: number): boolean {
  return progress >= FINALE.from;
}

/** How much of the finale line shows at a walk progress: it comes with the wide shot and goes as the map folds. */
export function finaleOpacity(progress: number): number {
  return Math.min(smooth(seg(progress, FINALE.line, FINALE.line + 0.025)), 1 - smooth(seg(progress, FINALE.down - 0.012, FINALE.down)));
}

// ---------------------------------------------------------------------------------------------------------
// Entering another roadmap: the opening circle.

/**
 * A CSS easing curve, `cubic-bezier(x1, y1, x2, y2)`, as a function of time. The time axis is solved by Newton
 * steps with a bisection to fall back on, so the result matches the browser's curve to well under a pixel.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const x = (s: number): number => ((ax * s + bx) * s + cx) * s;
  const dx = (s: number): number => (3 * ax * s + 2 * bx) * s + cx;
  const y = (s: number): number => ((ay * s + by) * s + cy) * s;
  return (t: number): number => {
    const want = clamp01(t);
    if (want === 0 || want === 1) return want;
    let s = want;
    for (let index = 0; index < 8; index += 1) {
      const error = x(s) - want;
      if (Math.abs(error) < 1e-7) return y(s);
      const slope = dx(s);
      if (Math.abs(slope) < 1e-6) break;
      s -= error / slope;
    }
    let low = 0;
    let high = 1;
    s = want;
    for (let index = 0; index < 40; index += 1) {
      const at = x(s);
      if (Math.abs(at - want) < 1e-7) break;
      if (at < want) low = s;
      else high = s;
      s = (low + high) / 2;
    }
    return y(s);
  };
}

/**
 * Picking another roadmap and going in at once. Its map has not been started, so the dive takes a shorter way
 * to the red: `approach` seconds to the guard, while that map is built. Red opens as a circle from the pin's
 * place on the screen `lead` seconds before the end of the approach and covers the frame in `seconds`, then it
 * holds for at most `DIVE.hold` more while the build finishes.
 */
export const WIPE = { approach: 1.75, lead: 0.44, seconds: 0.42, to: 150, curve: [0.55, 0, 0.85, 0.4] } as const;

const wipeCurve = cubicBezier(...WIPE.curve);

/** Hero-exit progress `seconds` into the shorter approach: eased in and out, ending on the guard. */
export function approachHx(seconds: number): number {
  return DIVE.guard.from * easeInOutCubic(clamp01(seconds / WIPE.approach));
}

/**
 * Radius of the opening circle in CSS percent (of the window's normalised diagonal) `seconds` into the
 * approach. Null before the circle starts. 150 percent covers the window from any point in it.
 */
export function wipeRadius(seconds: number): number | null {
  const start = WIPE.approach - WIPE.lead;
  if (seconds < start) return null;
  return WIPE.to * wipeCurve(clamp01((seconds - start) / WIPE.seconds));
}

/** True once the approach has ended and the circle covers the frame. */
export function wipeCovered(seconds: number): boolean {
  return seconds >= Math.max(WIPE.approach, WIPE.approach - WIPE.lead + WIPE.seconds);
}

// ---------------------------------------------------------------------------------------------------------
// Rising out of the map, and scrolling back in.

/**
 * Above the top of the walk lies the dive, played by the scroll: scrolling up at the gate lifts the camera out
 * through the red pin to the table, scrolling down takes it back in and lands at the gate. The band is `band`
 * windows long. The page must have rested at the top for `dwell` seconds first, so the last of a fast scroll up
 * does not carry on out of the map.
 */
export const RISE = { band: 1.6, dwell: 0.3, line: 40, page: 0.875 } as const;

/** Hero-exit progress for a share of the rise: 0 at the gate (hx 1), 1 on the table (hx 0). */
export function riseHx(rise: number): number {
  return 1 - clamp01(rise);
}

/** How far a wheel event moves the page, in pixels, whatever unit it came in. */
export function wheelPixels(deltaY: number, deltaMode: number, viewport: number): number {
  if (deltaMode === 1) return deltaY * RISE.line;
  if (deltaMode === 2) return deltaY * viewport * RISE.page;
  return deltaY;
}

// ---------------------------------------------------------------------------------------------------------
// The way back to the table.

/**
 * Once the map is shut: a pause, then a curtain dims the room to `dim` in `curtain` seconds, and the camera
 * makes one `move` second power-2 in-out move from the shut map back to the hero shot over the table, where the
 * map lies as the lit sheet. The table takes the map's place under the dimmed curtain at the start of the move,
 * and the curtain lifts over its first `lift` seconds. The lit mountain lies flat in its print until `grow` of
 * the move, then grows, so it stands as the camera settles.
 */
export const RETURN = { wait: 0.5, curtain: 0.2, dim: 0.42, move: 2.8, lift: 0.9, low: 0.62, grow: 0.72, fold: 1.1 } as const;

export interface ReturnState {
  /** Opacity of the dark curtain. */
  readonly curtain: number;
  /** Strength of the walk's own lights before the swap. */
  readonly light: number;
  /** The camera move from the shut map to the hero shot, eased, 0 to 1. */
  readonly move: number;
  /** True once the table has taken the map's place. */
  readonly swapped: boolean;
  /** True once the lit mountain may grow again. */
  readonly grow: boolean;
  /** True when the way back is over. */
  readonly done: boolean;
}

/** Power-2 in and out. */
export function easePower2InOut(t: number): number {
  return easeInOutQuad(t);
}

/** The way back, `seconds` after the map shut. */
export function returnAt(seconds: number): ReturnState {
  const t = Math.max(0, seconds);
  const swapAt = RETURN.wait + RETURN.curtain;
  if (t < swapAt) {
    const dim = easeInOutQuad(seg(t, RETURN.wait, swapAt));
    return { curtain: RETURN.dim * dim, light: lerp(1, RETURN.low, dim), move: 0, swapped: false, grow: false, done: false };
  }
  const m = clamp01((t - swapAt) / RETURN.move);
  const lift = smooth(seg(t - swapAt, 0, RETURN.lift));
  return { curtain: RETURN.dim * (1 - lift), light: RETURN.low, move: easePower2InOut(m), swapped: true, grow: m >= RETURN.grow, done: m >= 1 };
}

/** Seconds from the map shutting to the end of the way back. */
export const RETURN_SECONDS = RETURN.wait + RETURN.curtain + RETURN.move;

/** Folding the map by hand (the fold button, Escape): how far it is open `seconds` after the request. */
export function foldAt(seconds: number): number {
  return 1 - easeInOutCubic(clamp01(seconds / RETURN.fold));
}

/** Elevation and yaw in degrees of a camera round what it looks at. */
function orbitOf(pose: CameraPose): { elevation: number; yaw: number; distance: number } {
  const vx = pose.position.x - pose.target.x;
  const vy = pose.position.y - pose.target.y;
  const vz = pose.position.z - pose.target.z;
  const distance = Math.max(1e-6, Math.hypot(vx, vy, vz));
  return { elevation: Math.asin(Math.min(1, Math.max(-1, vy / distance))) * DEG, yaw: Math.atan2(vx, vz) * DEG, distance };
}

/**
 * A camera move from one pose to another: the point looked at slides along a line, the camera swings round it
 * by elevation and yaw (the short way), and the distance changes at an even rate of zoom, so a move from close
 * over a sheet to the wide shot of the table pulls back without a lurch.
 */
export function orbitMix(a: CameraPose, b: CameraPose, t: number): CameraPose {
  const k = clamp01(t);
  if (k <= 0) return a;
  if (k >= 1) return b;
  const from = orbitOf(a);
  const to = orbitOf(b);
  let turn = to.yaw - from.yaw;
  if (turn > 180) turn -= 360;
  if (turn < -180) turn += 360;
  const target = { x: lerp(a.target.x, b.target.x, k), y: lerp(a.target.y, b.target.y, k), z: lerp(a.target.z, b.target.z, k) };
  const distance = Math.exp(lerp(Math.log(from.distance), Math.log(to.distance), k));
  const direction = orbitDirection(lerp(from.elevation, to.elevation, k), from.yaw + turn * k);
  return {
    position: { x: target.x + direction.x * distance, y: target.y + direction.y * distance, z: target.z + direction.z * distance },
    target,
    distance,
    fov: lerp(a.fov, b.fov, k),
  };
}

/**
 * The same camera in another place: every point of the pose is scaled by `scale` round the origin and then
 * moved by `offset`. A camera that looks at the shut map in the walk's space looks at the lit sheet on the
 * table this way, with the same picture.
 */
export function movePose(pose: CameraPose, scale: number, offset: Vec3): CameraPose {
  const at = (point: Vec3): Vec3 => ({ x: point.x * scale + offset.x, y: point.y * scale + offset.y, z: point.z * scale + offset.z });
  return { position: at(pose.position), target: at(pose.target), distance: pose.distance * scale, fov: pose.fov };
}
