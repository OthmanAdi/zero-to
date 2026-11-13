import { TAU } from './heading';

/**
 * The showpiece motion of the compass: a slow bob, a slow turn, a gentle wobble and the rocking of the gimbal
 * rings. Everything is a pure function of the scene time, so a recording or a still frame at time `t` always
 * shows the same pose.
 */
export interface ShowpieceMotion {
  /** How far the compass rises and sinks from its rest height, in scene units. */
  readonly bobHeight: number;
  /** Seconds for one full bob. */
  readonly bobPeriod: number;
  /** Seconds for one full turn on the vertical axis. */
  readonly spinPeriod: number;
  /** Largest tilt of the wobble, in radians. */
  readonly wobble: number;
  /** Largest swing of the outer ring about its pivots, in radians. */
  readonly ringSwing: number;
  /** Largest rock of the inner ring about the bowl pivots, in radians. */
  readonly ringRock: number;
}

export const SHOWPIECE_MOTION: ShowpieceMotion = {
  bobHeight: 0.06,
  bobPeriod: 4,
  spinPeriod: 40,
  wobble: 0.035,
  ringSwing: 0.16,
  ringRock: 0.05,
};

export interface ShowpiecePose {
  /** Vertical offset from the rest height, in scene units. */
  readonly bob: number;
  /** 0 at the lowest point of the bob, 1 at the highest, 0.5 at rest. */
  readonly lift: number;
  /** Turn of the body on its vertical axis, in radians (a three.js `rotation.y`, so counter-clockwise from above). */
  readonly spin: number;
  /** Tilt towards +X, in radians. */
  readonly wobbleX: number;
  /** Tilt towards +Z, in radians. */
  readonly wobbleZ: number;
  /** Outer ring angle about its pivots, in radians. */
  readonly ringSwing: number;
  /** Inner ring angle about the bowl pivots, in radians. */
  readonly ringRock: number;
}

const REST_POSE: ShowpiecePose = { bob: 0, lift: 0.5, spin: 0, wobbleX: 0, wobbleZ: 0, ringSwing: 0, ringRock: 0 };

/** The pose at scene time `t`. With reduced motion the compass rests: no bob, no turn, no wobble. */
export function showpiecePose(t: number, motion: ShowpieceMotion = SHOWPIECE_MOTION, reduced = false): ShowpiecePose {
  if (reduced) return REST_POSE;
  const bobPhase = Math.sin((TAU * t) / Math.max(0.01, motion.bobPeriod));
  // Two periods that never line up, so the wobble does not read as a loop.
  const wobbleX = motion.wobble * Math.sin((TAU * t) / 7.3 + 0.6);
  const wobbleZ = motion.wobble * 0.8 * Math.sin((TAU * t) / 9.1 + 2.1);
  return {
    bob: motion.bobHeight * bobPhase,
    lift: 0.5 + 0.5 * bobPhase,
    spin: (TAU * t) / Math.max(0.01, motion.spinPeriod),
    wobbleX,
    wobbleZ,
    ringSwing: motion.ringSwing * Math.sin((TAU * t) / 11.3 + 1.2),
    ringRock: motion.ringRock * Math.sin((TAU * t) / 6.1),
  };
}

export interface ContactShadow {
  /** Radius factor: 1 at the lowest point, smaller when the compass is higher. */
  readonly scale: number;
  /** Darkness factor: 1 at the lowest point, lighter when the compass is higher. */
  readonly strength: number;
}

/** The contact shadow shrinks and fades as the compass rises. `lift` is 0 at the lowest point and 1 at the highest. */
export function contactShadow(lift: number): ContactShadow {
  const k = Math.min(1, Math.max(0, lift));
  return { scale: 1 - 0.16 * k, strength: 1 - 0.3 * k };
}

/** Frame-rate independent easing towards a target: after 1/rate seconds about 63 % of the way is covered. */
export function damp(current: number, target: number, rate: number, dt: number): number {
  if (!(dt > 0)) return current;
  return target + (current - target) * Math.exp(-rate * dt);
}

/** Clamps to [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * A small tilt as an axis and an angle. `tipX` leans the top of the compass towards +X and `tipZ` towards +Z,
 * both in radians. For the small angles used here the two simply add up.
 */
export function tipToAxisAngle(tipX: number, tipZ: number): { x: number; y: number; z: number; angle: number } {
  const angle = Math.hypot(tipX, tipZ);
  if (angle < 1e-9) return { x: 1, y: 0, z: 0, angle: 0 };
  // Turning +Y towards the direction d = (tipX, 0, tipZ) is a right-handed turn about Y x d.
  return { x: tipZ / angle, y: 0, z: -tipX / angle, angle };
}
