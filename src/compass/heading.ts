/**
 * Bearings on the table.
 *
 * A bearing is an angle in radians, measured clockwise when the table is seen from above, starting at north.
 * North is the -Z direction of the scene (away from a camera that sits on +Z), east is +X. So a bearing `b`
 * points along (sin b, 0, -cos b).
 *
 * three.js turns the other way: a positive rotation about Y is counter-clockwise from above. The functions here
 * are the only place where that sign is handled.
 */
export const TAU = Math.PI * 2;

/** Wraps any angle into [0, 2*PI). */
export function normalizeBearing(angle: number): number {
  const wrapped = angle % TAU;
  const positive = wrapped < 0 ? wrapped + TAU : wrapped;
  // -1e-17 % TAU plus TAU rounds to TAU itself; fold that back to 0.
  return positive >= TAU ? 0 : positive;
}

/** The shortest signed turn from one bearing to another, in (-PI, PI]. Positive is clockwise. */
export function shortestTurn(from: number, to: number): number {
  const turn = normalizeBearing(to - from);
  return turn > Math.PI ? turn - TAU : turn;
}

/**
 * The value a needle that currently shows `current` (not wrapped) should travel to so that it ends on `requested`
 * by the shorter way round. The result is not wrapped either, so a spring can run on it without jumps.
 */
export function retarget(current: number, requested: number): number {
  return current + shortestTurn(current, requested);
}

/** Unit direction on the table for a bearing. */
export function bearingToDirection(bearing: number): { x: number; z: number } {
  return { x: Math.sin(bearing), z: -Math.cos(bearing) };
}

/** Bearing of a point on the table as seen from the compass, in [0, 2*PI). The origin gives 0. */
export function directionToBearing(x: number, z: number): number {
  if (x === 0 && z === 0) return 0;
  return normalizeBearing(Math.atan2(x, -z));
}

/** The `rotation.y` that makes an object whose rest direction is -Z point along a bearing. */
export function bearingToYaw(bearing: number): number {
  return -bearing;
}

/**
 * Heading compensation. The needle is a child of the compass body, and the body turns on its vertical axis by
 * `bodyYaw` (its `rotation.y`). This returns the local `rotation.y` the needle needs so that it still points
 * along `worldBearing` on the table.
 */
export function needleYaw(worldBearing: number, bodyYaw: number): number {
  return bearingToYaw(worldBearing) - bodyYaw;
}

/**
 * A flat vector given on the table (x east, z south), expressed in the frame of a body that is turned by
 * `bodyYaw` (its `rotation.y`). The opposite of what the turn does to its children.
 */
export function worldToBody(x: number, z: number, bodyYaw: number): { x: number; z: number } {
  const cos = Math.cos(bodyYaw);
  const sin = Math.sin(bodyYaw);
  return { x: x * cos - z * sin, z: x * sin + z * cos };
}

/** The bearing a needle with local `rotation.y = localYaw` shows on the table when the body is turned by `bodyYaw`. */
export function yawToBearing(localYaw: number, bodyYaw: number): number {
  return normalizeBearing(-(localYaw + bodyYaw));
}
