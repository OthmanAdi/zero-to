import type { PerspectiveCamera } from 'three';
import {
  clamp01,
  easeOutCubic,
  fitPose,
  orbitDirection,
  settleSpring,
  spring,
  stepSpringKC,
  type CameraPose,
  type ScreenBox,
  type Spring,
  type Vec3,
} from '../paper/motion';

/**
 * The hero shot. The camera is fitted, not placed: it looks from a fixed direction and is moved until the lit
 * sheet, its full-grown mountain and the compass fill a box on the screen. The box leaves the left of the
 * screen to the headline and the right to the side card.
 */
export const HERO_CAMERA = {
  wide: { elevation: 31, yaw: -4, fov: 32, box: { x0: -0.3, x1: 0.3, y0: -0.95, y1: 0.72 } },
  /** Narrow screens: the scene takes the lower part, under the headline. */
  narrow: { elevation: 47, yaw: -6, fov: 38, box: { x0: -0.9, x1: 0.9, y0: -0.74, y1: 0.5 } },
  /** The push of the intro: from this much farther and this many degrees higher, over this many seconds. */
  intro: { seconds: 3.4, back: 1.22, higher: 5 },
  /** The lean toward the pointer. */
  tilt: { k: 40, c: 11, yaw: 0.03, lift: 0.015 },
  /** A headline above the scene is cleared by this much, in screen units. */
  textGap: 0.035,
} as const;

/** True for a narrow screen: up to 760 px wide, or taller than it is wide by more than 0.85. */
export function isNarrow(width: number, height: number): boolean {
  return width <= 760 || width / Math.max(1, height) < 0.85;
}

export interface HeroShot {
  readonly elevation: number;
  readonly yaw: number;
  readonly fov: number;
  readonly box: ScreenBox;
}

export interface HeroPoseOptions {
  /**
   * The lower edge of the headline block in screen units (-1 bottom, 1 top), when it lies above the scene. The
   * top of the box moves down to clear it.
   */
  readonly clearBelow?: number;
  /** What overlays cover at the edges, in screen units, taken off the box. */
  readonly insets?: { readonly left?: number; readonly right?: number; readonly top?: number; readonly bottom?: number };
}

/** The shot for a window size. */
export function heroShot(width: number, height: number, options: HeroPoseOptions = {}): HeroShot {
  const base = isNarrow(width, height) ? HERO_CAMERA.narrow : HERO_CAMERA.wide;
  const insets = options.insets ?? {};
  let y1 = base.box.y1 - (insets.top ?? 0);
  if (options.clearBelow !== undefined && Number.isFinite(options.clearBelow)) y1 = Math.min(y1, options.clearBelow - HERO_CAMERA.textGap);
  const box: ScreenBox = {
    x0: base.box.x0 + (insets.left ?? 0),
    x1: base.box.x1 - (insets.right ?? 0),
    y0: base.box.y0 + (insets.bottom ?? 0),
    y1: Math.max(base.box.y0 + 0.3, y1),
  };
  return { elevation: base.elevation, yaw: base.yaw, fov: base.fov, box };
}

/** Solves the hero pose for the points the table hands out with `framePoints()`. */
export function heroPose(points: readonly Vec3[], width: number, height: number, options: HeroPoseOptions = {}): CameraPose {
  const shot = heroShot(width, height, options);
  return fitPose(points, { x: 0, y: 0.5, z: 3 }, shot.elevation, shot.yaw, shot.fov, shot.box, width / Math.max(1, height), { startDistance: 22 });
}

/** How far the intro push has come, 0 at the start and 1 when the camera has arrived. */
export function introPush(seconds: number): number {
  return easeOutCubic(clamp01(seconds / HERO_CAMERA.intro.seconds));
}

export interface HeroCameraInput {
  readonly dt: number;
  readonly reduced: boolean;
  /** Seconds since the intro started, or null when there is no intro. */
  readonly intro: number | null;
  /** Pointer in screen units, or null. */
  readonly pointer: { readonly x: number; readonly y: number } | null;
}

export interface HeroCamera {
  /** Solves the pose again, after a resize or when the sheets change. */
  frame(points: readonly Vec3[], width: number, height: number, options?: HeroPoseOptions): void;
  /** Places the camera for this frame. */
  apply(camera: PerspectiveCamera, input: HeroCameraInput): void;
  readonly pose: CameraPose | null;
}

/** The camera rig of the table view: the fitted pose, the push of the intro and the lean toward the pointer. */
export function createHeroCamera(): HeroCamera {
  let pose: CameraPose | null = null;
  let shot: HeroShot = heroShot(1440, 900);
  const tiltX: Spring = spring(0);
  const tiltY: Spring = spring(0);

  return {
    get pose() {
      return pose;
    },
    frame(points, width, height, options = {}) {
      shot = heroShot(width, height, options);
      pose = heroPose(points, width, height, options);
    },
    apply(camera, input) {
      if (!pose) return;
      const wantX = input.pointer && !input.reduced ? input.pointer.x : 0;
      const wantY = input.pointer && !input.reduced ? input.pointer.y : 0;
      if (input.reduced) {
        settleSpring(tiltX, 0);
        settleSpring(tiltY, 0);
      } else {
        stepSpringKC(tiltX, wantX, HERO_CAMERA.tilt.k, HERO_CAMERA.tilt.c, input.dt);
        stepSpringKC(tiltY, wantY, HERO_CAMERA.tilt.k, HERO_CAMERA.tilt.c, input.dt);
      }
      const arrived = input.intro === null || input.reduced ? 1 : introPush(input.intro);
      const distance = pose.distance * (1 + (HERO_CAMERA.intro.back - 1) * (1 - arrived));
      const elevation = shot.elevation + HERO_CAMERA.intro.higher * (1 - arrived);
      const yaw = shot.yaw + ((tiltX.x * HERO_CAMERA.tilt.yaw) / Math.PI) * 180;
      const direction = orbitDirection(elevation, yaw);
      const lift = tiltY.x * HERO_CAMERA.tilt.lift * pose.distance;
      camera.position.set(
        pose.target.x + direction.x * distance,
        pose.target.y + direction.y * distance + lift,
        pose.target.z + direction.z * distance,
      );
      if (camera.fov !== shot.fov) {
        camera.fov = shot.fov;
        camera.updateProjectionMatrix();
      }
      camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
    },
  };
}
