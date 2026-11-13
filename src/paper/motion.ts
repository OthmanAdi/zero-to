/**
 * Motion kit: the springs, the easing curves and the camera fit that every moving thing in the scene shares.
 *
 * Nothing here touches the DOM, the clock or three.js. Time always comes in as `dt`, so a recording stepped at
 * 1/60 s and a live page at 120 Hz play the same motion.
 *
 * House rule for springs (stiffness `k`, damping `c`, unit mass): light things are underdamped and bounce
 * (a paper sheet is 150 / 12, damping ratio 0.49), heavy things sit near critical damping (a table pick is
 * 15 / 7.4, ratio 0.96).
 */

/** A point in scene space. A three.js `Vector3` fits, and so does a plain object. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** The state of one spring: where it is and how fast it moves. Stepping functions write into it. */
export interface Spring {
  x: number;
  v: number;
}

/** A spring at rest at `x`. */
export function spring(x = 0, v = 0): Spring {
  return { x, v };
}

/**
 * Advances a unit-mass spring by `dt` seconds towards `target`: x'' = k (target - x) - c x'.
 *
 * The step is the closed-form solution, not an Euler step. It is therefore stable for any frame time, gives the
 * same curve at any frame rate, and its energy (v^2 / 2 + k (x - target)^2 / 2) can never grow. The state is
 * changed in place and returned, so hot loops allocate nothing.
 */
export function stepSpringKC(state: Spring, target: number, k: number, c: number, dt: number): Spring {
  if (!(dt > 0)) return state;
  const x0 = state.x - target;
  const v0 = state.v;

  if (!(k > 0)) {
    // No pull, only drag: the value coasts to a stop.
    if (c > 1e-9) {
      const decay = Math.exp(-c * dt);
      state.x = target + x0 + (v0 * (1 - decay)) / c;
      state.v = v0 * decay;
    } else {
      state.x = target + x0 + v0 * dt;
    }
    return state;
  }

  const w = Math.sqrt(k);
  const half = Math.max(0, c) / 2;
  const disc = half * half - k;
  let x: number;
  let v: number;

  if (disc < -1e-9 * k) {
    // Underdamped: a decaying swing.
    const wd = Math.sqrt(-disc);
    const decay = Math.exp(-half * dt);
    const cos = Math.cos(wd * dt);
    const sin = Math.sin(wd * dt);
    const b = (v0 + half * x0) / wd;
    x = decay * (x0 * cos + b * sin);
    v = decay * ((b * wd - half * x0) * cos - (x0 * wd + half * b) * sin);
  } else if (disc > 1e-9 * k) {
    // Overdamped: two decays, no swing.
    const root = Math.sqrt(disc);
    const r1 = -half + root;
    const r2 = -half - root;
    const a = (v0 - r2 * x0) / (r1 - r2);
    const b = x0 - a;
    const e1 = Math.exp(r1 * dt);
    const e2 = Math.exp(r2 * dt);
    x = a * e1 + b * e2;
    v = a * r1 * e1 + b * r2 * e2;
  } else {
    // Critically damped: the fastest approach without a swing.
    const decay = Math.exp(-w * dt);
    const b = v0 + w * x0;
    x = decay * (x0 + b * dt);
    v = decay * (b - w * (x0 + b * dt));
  }

  state.x = target + x;
  state.v = v;
  return state;
}

/**
 * A critically damped chase at `omega` radians per second: no overshoot, 95 percent of the way after about
 * 4.74 / omega seconds. The page progress uses omega 8 (about 0.6 s).
 */
export function critDamp(state: Spring, target: number, omega: number, dt: number): Spring {
  if (!(dt > 0) || !(omega > 0)) return state;
  const x0 = state.x - target;
  const decay = Math.exp(-omega * dt);
  const b = state.v + omega * x0;
  const x = decay * (x0 + b * dt);
  state.v = decay * (b - omega * (x0 + b * dt));
  state.x = target + x;
  return state;
}

/** The energy of a unit-mass spring about its target. Used by tests and to decide when a spring is at rest. */
export function springEnergy(state: Spring, target: number, k: number): number {
  const x = state.x - target;
  return 0.5 * state.v * state.v + 0.5 * k * x * x;
}

/** True when a spring is close enough to its target, and slow enough, to stop stepping it. */
export function springAtRest(state: Spring, target: number, epsilon = 1e-4): boolean {
  return Math.abs(state.x - target) < epsilon && Math.abs(state.v) < epsilon * 10;
}

/** Puts a spring on its target with no speed. Reduced motion settles every spring this way. */
export function settleSpring(state: Spring, target: number): Spring {
  state.x = target;
  state.v = 0;
  return state;
}

/**
 * A floor for a spring: when the value has fallen below `floor`, it is put back on it and its speed is turned
 * round and scaled by `restitution` (0.2 for a paper sheet meeting the map, 0.25 for the pin). Returns true on
 * the frame of the hit.
 */
export function bounceFloor(state: Spring, floor: number, restitution: number): boolean {
  if (state.x >= floor) return false;
  state.x = floor;
  if (state.v < 0) state.v = -state.v * restitution;
  return true;
}

// ---------------------------------------------------------------------------------------------------------
// Small helpers the timelines are written in.

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Where `value` lies between `from` and `to`, clamped to 0..1. A segment of a timeline. */
export function seg(value: number, from: number, to: number): number {
  if (from === to) return value < from ? 0 : 1;
  return clamp01((value - from) / (to - from));
}

/** Smoothstep on 0..1. */
export function smooth(t: number): number {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
}

/** Frame-rate independent blend factor: `1 - exp(-rate * dt)`. */
export function damp(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

// ---------------------------------------------------------------------------------------------------------
// Easing curves. All take and return 0..1 (the springy ones leave that range on the way) and are exact at
// both ends.

export type Easing = (t: number) => number;

export const linear: Easing = (t) => clamp01(t);

/** Power 2. */
export const easeInQuad: Easing = (t) => {
  const u = clamp01(t);
  return u * u;
};
export const easeOutQuad: Easing = (t) => {
  const u = 1 - clamp01(t);
  return 1 - u * u;
};
export const easeInOutQuad: Easing = (t) => {
  const u = clamp01(t);
  return u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u);
};

/** Power 3. */
export const easeInCubic: Easing = (t) => {
  const u = clamp01(t);
  return u * u * u;
};
export const easeOutCubic: Easing = (t) => {
  const u = 1 - clamp01(t);
  return 1 - u * u * u;
};
export const easeInOutCubic: Easing = (t) => {
  const u = clamp01(t);
  return u < 0.5 ? 4 * u * u * u : 1 - 4 * (1 - u) * (1 - u) * (1 - u);
};

/** A fast start that never quite seems to stop. */
export const easeOutExpo: Easing = (t) => {
  const u = clamp01(t);
  if (u >= 1) return 1;
  // Rescaled so the curve starts at exactly 0 and ends at exactly 1.
  return (1 - Math.pow(2, -10 * u)) / (1 - Math.pow(2, -10));
};

/** Goes past the end by an amount set by `overshoot` and comes back. 1.70158 passes it by 10 percent. */
export function easeOutBack(t: number, overshoot = 1.70158): number {
  const u = clamp01(t) - 1;
  return 1 + (overshoot + 1) * u * u * u + overshoot * u * u;
}

/** Rings round the end like a plucked ruler. `period` is the length of one swing as a share of the duration. */
export function easeOutElastic(t: number, period = 0.3): number {
  const u = clamp01(t);
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const p = Math.max(1e-3, period);
  return Math.pow(2, -10 * u) * Math.sin(((u - p / 4) * (2 * Math.PI)) / p) + 1;
}

/** Drops and bounces three times, each lower. */
export const easeOutBounce: Easing = (t) => {
  const u = clamp01(t);
  const n = 7.5625;
  const d = 2.75;
  if (u < 1 / d) return n * u * u;
  if (u < 2 / d) {
    const w = u - 1.5 / d;
    return n * w * w + 0.75;
  }
  if (u < 2.5 / d) {
    const w = u - 2.25 / d;
    return n * w * w + 0.9375;
  }
  const w = u - 2.625 / d;
  return n * w * w + 0.984375;
};

/** The easings by the names the build notes use. */
export const EASE = {
  linear,
  cubicInOut: easeInOutCubic,
  power2In: easeInQuad,
  power2Out: easeOutQuad,
  power2InOut: easeInOutQuad,
  power3In: easeInCubic,
  power3Out: easeOutCubic,
  power3InOut: easeInOutCubic,
  expoOut: easeOutExpo,
  backOut: easeOutBack,
  elasticOut: easeOutElastic,
  bounceOut: easeOutBounce,
} as const;

// ---------------------------------------------------------------------------------------------------------
// The fitted camera.

/** A rectangle on the screen in normalised device coordinates: x and y run from -1 (left, bottom) to 1. */
export interface ScreenBox {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
}

/** A solved camera: stand at `position`, look at `target`, with a vertical lens of `fov` degrees. */
export interface CameraPose {
  position: Vec3;
  target: Vec3;
  distance: number;
  fov: number;
}

const RAD = Math.PI / 180;

/** The unit vector from the target to a camera at `elevation` degrees above the table and `yaw` degrees round. */
export function orbitDirection(elevation: number, yaw: number): Vec3 {
  const el = elevation * RAD;
  const az = yaw * RAD;
  return { x: Math.sin(az) * Math.cos(el), y: Math.sin(el), z: Math.cos(az) * Math.cos(el) };
}

interface Basis {
  rx: number;
  ry: number;
  rz: number;
  ux: number;
  uy: number;
  uz: number;
  fx: number;
  fy: number;
  fz: number;
}

function basisFor(dir: Vec3): Basis {
  // Forward looks from the camera at the target. Right is forward x world up, up is right x forward.
  const fx = -dir.x;
  const fy = -dir.y;
  const fz = -dir.z;
  let rx = -fz;
  let rz = fx;
  let length = Math.hypot(rx, rz);
  if (length < 1e-6) {
    // Looking straight down: keep the screen's right on world +X.
    rx = 1;
    rz = 0;
    length = 1;
  }
  rx /= length;
  rz /= length;
  const ry = 0;
  const ux = ry * fz - rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy - ry * fx;
  return { rx, ry, rz, ux, uy, uz, fx, fy, fz };
}

/**
 * Where a scene point lands on the screen for a pose, in normalised device coordinates. `z` is the distance in
 * front of the camera, so a point behind it has a negative `z`.
 */
export function projectToScreen(pose: CameraPose, point: Vec3, aspect: number): Vec3 {
  const dir = {
    x: pose.position.x - pose.target.x,
    y: pose.position.y - pose.target.y,
    z: pose.position.z - pose.target.z,
  };
  const length = Math.hypot(dir.x, dir.y, dir.z) || 1;
  dir.x /= length;
  dir.y /= length;
  dir.z /= length;
  const b = basisFor(dir);
  const tan = Math.tan((pose.fov * RAD) / 2);
  const px = point.x - pose.position.x;
  const py = point.y - pose.position.y;
  const pz = point.z - pose.position.z;
  const depth = px * b.fx + py * b.fy + pz * b.fz;
  const safe = Math.max(1e-6, depth);
  return {
    x: (px * b.rx + py * b.ry + pz * b.rz) / (safe * tan * aspect),
    y: (px * b.ux + py * b.uy + pz * b.uz) / (safe * tan),
    z: depth,
  };
}

/** Where the search starts, and how it converges. The defaults are the tuned values of the scene. */
export interface FitOptions {
  /** First distance from the target. */
  readonly startDistance?: number;
  /** Rounds of project, recentre, rescale. */
  readonly rounds?: number;
  /** Share of the centre error corrected per round. */
  readonly centreGain?: number;
  /** Exponent on the overflow ratio per round. Below 1 it approaches without hunting. */
  readonly scalePower?: number;
}

/**
 * Solves a camera pose instead of placing one: the camera looks from `elevation` and `yaw` (degrees) with a
 * vertical lens of `fov` degrees, and is moved until `points` fill `box` on a screen of the given `aspect`
 * (width / height). The direction never changes, only the look-at point and the distance, so a pose fits any
 * window shape and keeps its character.
 *
 * Yaw is measured from +Z towards +X: a negative yaw puts the camera left of the centre line.
 */
export function fitPose(
  points: readonly Vec3[],
  target: Vec3,
  elevation: number,
  yaw: number,
  fov: number,
  box: ScreenBox,
  aspect: number,
  options: FitOptions = {},
): CameraPose {
  const dir = orbitDirection(elevation, yaw);
  const b = basisFor(dir);
  const tan = Math.tan((fov * RAD) / 2);
  const ratio = aspect > 0 ? aspect : 1;
  const rounds = options.rounds ?? 18;
  const gain = options.centreGain ?? 0.9;
  const power = options.scalePower ?? 0.8;
  const boxWidth = Math.max(1e-6, box.x1 - box.x0);
  const boxHeight = Math.max(1e-6, box.y1 - box.y0);
  const boxX = (box.x0 + box.x1) / 2;
  const boxY = (box.y0 + box.y1) / 2;

  let tx = target.x;
  let ty = target.y;
  let tz = target.z;
  let distance = options.startDistance ?? 12.8;

  if (points.length > 0) {
    for (let round = 0; round < rounds; round += 1) {
      const cx = tx + dir.x * distance;
      const cy = ty + dir.y * distance;
      const cz = tz + dir.z * distance;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const point of points) {
        const px = point.x - cx;
        const py = point.y - cy;
        const pz = point.z - cz;
        const depth = Math.max(distance * 0.02, px * b.fx + py * b.fy + pz * b.fz);
        const sx = (px * b.rx + py * b.ry + pz * b.rz) / (depth * tan * ratio);
        const sy = (px * b.ux + py * b.uy + pz * b.uz) / (depth * tan);
        if (sx < minX) minX = sx;
        if (sx > maxX) maxX = sx;
        if (sy < minY) minY = sy;
        if (sy > maxY) maxY = sy;
      }
      // Recentre: slide the look-at point in the screen plane so the points' middle meets the box's middle.
      const errorX = (minX + maxX) / 2 - boxX;
      const errorY = (minY + maxY) / 2 - boxY;
      const shiftX = errorX * distance * tan * ratio * gain;
      const shiftY = errorY * distance * tan * gain;
      tx += b.rx * shiftX + b.ux * shiftY;
      ty += b.ry * shiftX + b.uy * shiftY;
      tz += b.rz * shiftX + b.uz * shiftY;
      // Rescale: step back or forward by the larger overflow.
      const overflow = Math.max((maxX - minX) / boxWidth, (maxY - minY) / boxHeight);
      if (overflow > 1e-9 && Number.isFinite(overflow)) distance *= Math.pow(overflow, power);
    }
  }

  return {
    position: { x: tx + dir.x * distance, y: ty + dir.y * distance, z: tz + dir.z * distance },
    target: { x: tx, y: ty, z: tz },
    distance,
    fov,
  };
}
