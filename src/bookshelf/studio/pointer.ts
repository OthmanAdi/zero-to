/**
 * How Studio answers the pointer, as plain arithmetic: the light follows the hand with a short lag and
 * comes to rest, and the presented volume leans toward the hand on a spring. Nothing here touches the
 * page or WebGL, so it can be checked by itself.
 */

/** Time constant of the light following the pointer, in ms. */
export const FOLLOW_MS = 160;
/** Time constant of the light going back to rest once the pointer has left or lies still, in ms. */
export const HOME_MS = 300;
/** After this long without a move, the light goes back to rest. */
export const IDLE_MS = 2500;
/** A pointer further than this outside the scene, in px, is not over the shelf and is ignored. */
export const OUTSIDE_PX = 80;
/** Nearer its target than this, a value has arrived and drawing can stop. */
export const SETTLED = 0.002;
/** Steps the pointer place is rounded to; a move that stays within one step asks for nothing. */
export const QUANTUM = 1 / 256;

/** Moves `value` toward `target` for `dt` ms with time constant `tau` ms. Never passes the target. */
export function ease(value: number, target: number, dt: number, tau: number): number {
  if (dt <= 0) return value;
  return value + (target - value) * (1 - Math.exp(-dt / Math.max(1e-3, tau)));
}

export interface Follower {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
}

export const follower = (): Follower => ({ x: 0, y: 0, targetX: 0, targetY: 0 });

/**
 * Steps a follower by `dt` ms and says whether it still has to move. It snaps onto the target once it is
 * within SETTLED, so a still pointer ends in a still picture.
 */
export function follow(state: Follower, dt: number, tau: number): boolean {
  state.x = ease(state.x, state.targetX, dt, tau);
  state.y = ease(state.y, state.targetY, dt, tau);
  if (Math.abs(state.targetX - state.x) < SETTLED && Math.abs(state.targetY - state.y) < SETTLED) {
    state.x = state.targetX;
    state.y = state.targetY;
    return false;
  }
  return true;
}

/**
 * Where a pointer at (clientX, clientY) is over a box, -1 to 1 each way and rounded to QUANTUM, or null
 * when it is more than `outside` px away from the box.
 */
export function pointerPlace(
  clientX: number,
  clientY: number,
  box: { left: number; top: number; width: number; height: number },
  outside = OUTSIDE_PX,
): { x: number; y: number } | null {
  if (clientX < box.left - outside || clientX > box.left + box.width + outside) return null;
  if (clientY < box.top - outside || clientY > box.top + box.height + outside) return null;
  const round = (value: number) => Math.round(Math.max(-1, Math.min(1, value)) / QUANTUM) * QUANTUM;
  return {
    x: round(((clientX - box.left) / Math.max(1, box.width)) * 2 - 1),
    y: round(((clientY - box.top) / Math.max(1, box.height)) * 2 - 1),
  };
}

/** Stiffness and damping of the tilt: a damping ratio near 0.74, so it passes its target by about 3 %. */
export const TILT_STIFFNESS = 90;
export const TILT_DAMPING = 14;
/** Most the presented volume turns toward the pointer, in degrees: about its upright and its level axis. */
export const TILT_YAW = 7;
export const TILT_PITCH = 4;

export interface Spring {
  value: number;
  velocity: number;
}

/**
 * Steps a damped spring toward `target` by `dt` ms, in slices of 4 ms at most so a long frame cannot make
 * it fly apart. Returns whether it is still moving.
 */
export function spring(state: Spring, target: number, dt: number, stiffness = TILT_STIFFNESS, damping = TILT_DAMPING): boolean {
  let left = Math.min(dt, 200) / 1000;
  while (left > 0) {
    const h = Math.min(left, 0.004);
    state.velocity += (stiffness * (target - state.value) - damping * state.velocity) * h;
    state.value += state.velocity * h;
    left -= h;
  }
  if (Math.abs(target - state.value) < SETTLED && Math.abs(state.velocity) < SETTLED * 4) {
    state.value = target;
    state.velocity = 0;
    return false;
  }
  return true;
}
