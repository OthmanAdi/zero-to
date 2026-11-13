import { Group, type Raycaster } from 'three';
import { bounceFloor, clamp01, settleSpring, spring, stepSpringKC } from '../paper/motion';
import type { Sheet } from '../paper/sheet';
import type { FrameTime } from '../scene/contract';

/**
 * How a cut-out stands up, lies down and answers a tap.
 *
 * Everything that stands on the map is hinged along its foot. It rises on a lively spring and lies down on a
 * softer one, and the map is a floor: a sheet that falls onto it bounces once. A tap makes a standing sheet
 * wobble about its foot for a moment and come to rest again.
 */
export const STAND = {
  /** Spring of a sheet standing up, and of one lying down. */
  rise: { k: 120, c: 9 },
  fall: { k: 70, c: 12 },
  /** Share of its speed a sheet keeps when it hits the map. */
  bounce: 0.2,
  /** Longest spring step in seconds, so a slow frame cannot throw a sheet through the map. */
  maxStep: 0.034,
  /** Height at which a lying sheet rests above the map, so it never fights the print for the same depth. */
  rest: 0.009,
  /** A tap wobble dies away over this many seconds. */
  wobbleSeconds: 1.75,
} as const;

const LYING = -Math.PI / 2;

/** How far a tapped sheet swings, in radians. Light sheets, which sway more, swing further. */
export function wobbleAmplitude(sway: number): number {
  return Math.min(0.092, 0.03 + 4.2 * Math.max(0, sway));
}

/** How fast a tapped sheet swings, in radians per second. */
export function wobbleRate(sway: number): number {
  return 6.4 + 290 * Math.max(0, sway);
}

/** The swing of a tapped sheet `elapsed` seconds after the tap. It starts at zero and has died away by 1.75 s. */
export function wobbleAngle(elapsed: number, amplitude: number, rate: number): number {
  if (!(elapsed > 0) || elapsed >= STAND.wobbleSeconds) return 0;
  const left = 1 - elapsed / STAND.wobbleSeconds;
  return Math.sin(elapsed * rate) * amplitude * left * left;
}

export interface StandOptions {
  /** Sway when standing, in radians. */
  readonly sway?: number;
  /** A number that sets the sheet's own sway rhythm. */
  readonly phase?: number;
  /** How far the sheet rises from lying, in radians. A quarter turn by default. A lake rises 0.3 to 0.36. */
  readonly rise?: number;
  /** Swing and speed of the tap wobble. By default they follow from the sway. */
  readonly wobble?: { readonly amplitude: number; readonly rate: number };
  /** Starts standing. By default a sheet starts lying on the map. */
  readonly up?: boolean;
  /** Own springs for rising and for lying down. By default the springs of `STAND`. */
  readonly springs?: { readonly rise: { readonly k: number; readonly c: number }; readonly fall: { readonly k: number; readonly c: number } };
}

export interface Stand {
  /** The hinge. Its origin is the middle of the foot. Add the sheet to it. */
  readonly hinge: Group;
  /** 0 lying, 1 standing, as it is now. It passes 1 for a moment when the spring overshoots. */
  readonly up: number;
  /** Where it is heading. */
  readonly standing: boolean;
  /** The fold of the hinge in radians: 0 upright, -PI / 2 lying. */
  readonly angle: number;
  /** The tap swing at this moment, in radians. */
  readonly swing: number;
  setUp(up: boolean, immediate?: boolean): void;
  /** Starts a wobble. Nothing happens while the sheet lies, or with reduced motion. */
  tap(): void;
  update(frame: FrameTime): void;
  readonly atRest: boolean;
}

export function createStand(options: StandOptions = {}): Stand {
  const hinge = new Group();
  const rise = options.rise ?? Math.PI / 2;
  const sway = options.sway ?? 0;
  const phase = options.phase ?? 0;
  const wobble = options.wobble ?? { amplitude: wobbleAmplitude(sway), rate: wobbleRate(sway) };
  let standing = options.up ?? false;
  const state = spring(standing ? LYING + rise : LYING);
  let tapped = false;
  let tapAt = -Infinity;
  let swing = 0;
  let atRest = true;

  const target = () => (standing ? LYING + rise : LYING);
  const upOf = () => (state.x - LYING) / rise;
  const apply = (swayNow: number) => {
    hinge.rotation.x = state.x;
    hinge.rotation.z = swayNow + swing;
    hinge.position.y = STAND.rest * (1 - clamp01(upOf()));
  };
  apply(0);

  return {
    hinge,
    get up() {
      return upOf();
    },
    get standing() {
      return standing;
    },
    get angle() {
      return state.x;
    },
    get swing() {
      return swing;
    },
    setUp(up, immediate = false) {
      standing = up;
      atRest = false;
      if (immediate) {
        settleSpring(state, target());
        apply(0);
      }
    },
    tap() {
      tapped = true;
    },
    update(frame) {
      if (frame.reduced) {
        settleSpring(state, target());
        swing = 0;
        tapped = false;
        tapAt = -Infinity;
        atRest = true;
        apply(0);
        return;
      }
      const dt = Math.min(frame.dt, STAND.maxStep);
      const { k, c } = standing ? (options.springs?.rise ?? STAND.rise) : (options.springs?.fall ?? STAND.fall);
      stepSpringKC(state, target(), k, c, dt);
      bounceFloor(state, LYING, STAND.bounce);
      const up = clamp01(upOf());
      if (tapped) {
        tapped = false;
        if (up > 0.25) tapAt = frame.t;
      }
      swing = wobbleAngle(frame.t - tapAt, wobble.amplitude, wobble.rate) * up;
      atRest = Math.abs(state.x - target()) < 1e-4 && Math.abs(state.v) < 1e-3;
      apply(Math.sin(frame.t * (0.26 + 0.045 * phase) + phase) * sway * up);
    },
    get atRest() {
      return atRest && swing === 0;
    },
  };
}

/**
 * True when a ray meets the paper of a sheet, not just its rectangle. The hit point is looked up in the
 * sheet's own outline, so a tap between the branches of a shrub goes through to whatever is behind it.
 * Returns the distance along the ray, or null.
 */
export function hitSheet(raycaster: Raycaster, sheet: Sheet): number | null {
  const hits = raycaster.intersectObject(sheet.mesh, false);
  for (const hit of hits) {
    if (!hit.uv) continue;
    const { width: fullWidth, height: fullHeight } = sheet.mesh.geometry.parameters;
    const padX = (fullWidth - sheet.width) / 2;
    const padY = (fullHeight - sheet.height) / 2;
    const u = (hit.uv.x * fullWidth - padX) / sheet.width;
    const v = (hit.uv.y * fullHeight - padY) / sheet.height;
    if (sheet.isPaper(u, v)) return hit.distance;
  }
  return null;
}
