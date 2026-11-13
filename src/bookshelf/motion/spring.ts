/**
 * Damped spring on one value, integrated in small fixed substeps so it stays
 * stable when a frame is late. Unit mass.
 */
export interface SpringConfig {
  /** Higher is faster. 200 reaches 95% of a one-unit move in about 340 ms when critically damped. */
  stiffness: number;
  /** 1 is critically damped (no overshoot). Below 1 overshoots. */
  dampingRatio: number;
  /** Distance and speed below which the spring snaps to its target. */
  restDistance: number;
  restSpeed: number;
}

export const SETTLE_SPRING: SpringConfig = {
  stiffness: 200,
  dampingRatio: 1,
  restDistance: 0.0008,
  restSpeed: 0.0004,
};

export interface SpringState {
  value: number;
  /** Units per millisecond. */
  velocity: number;
}

const SUBSTEP_MS = 4;
const MAX_FRAME_MS = 64;

/** Advances `state` toward `target` by `dtMs`. Returns true once at rest on the target. */
export function stepSpring(state: SpringState, target: number, dtMs: number, config: SpringConfig = SETTLE_SPRING): boolean {
  const damping = 2 * config.dampingRatio * Math.sqrt(config.stiffness);
  let remaining = Math.min(Math.max(dtMs, 0), MAX_FRAME_MS);

  while (remaining > 0) {
    const stepSeconds = Math.min(SUBSTEP_MS, remaining) / 1000;
    remaining -= SUBSTEP_MS;
    const velocityPerSecond = state.velocity * 1000;
    const acceleration = -config.stiffness * (state.value - target) - damping * velocityPerSecond;
    const nextVelocity = velocityPerSecond + acceleration * stepSeconds;
    state.value += nextVelocity * stepSeconds;
    state.velocity = nextVelocity / 1000;
  }

  const atRest =
    Math.abs(state.value - target) < config.restDistance && Math.abs(state.velocity) < config.restSpeed;
  if (atRest) {
    state.value = target;
    state.velocity = 0;
  }
  return atRest;
}

export type Easing = (t: number) => number;

export const easeInOutCubic: Easing = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutCubic: Easing = (t) => 1 - Math.pow(1 - t, 3);
export const linear: Easing = (t) => t;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Hermite smoothstep on 0..1, flat at both ends. */
export function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/** Mathematical modulo: the result is always in 0..n-1. */
export function wrapIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return ((index % count) + count) % count;
}
