import { clamp01, easeInOutCubic, fitPose, lerp, orbitDirection, seg, type CameraPose, type ScreenBox, type Vec3 } from '../paper/motion';
import { PANEL, clampPanels } from './fold';

/**
 * The camera rail of the walk. Every pose is fitted, not placed: the camera looks from a fixed direction and
 * is moved until a set of points fills a box on the screen, so the same rail works in any window.
 *
 * Map space: the origin is the middle of the shut map on the table, x runs to the right, z toward the viewer.
 * Panel 0 lies where the shut map lies. Panel i lies i panel widths to its right.
 */
export const RAIL = {
  shut: { elevation: 48, yaw: -7, narrow: { elevation: 58, yaw: -4 }, box: { x0: -0.42, x1: 0.42, y0: -0.78, y1: 0.7 } },
  panel: {
    elevation: 30,
    yaw: -9,
    fov: 34,
    narrowFov: 40,
    box: { x0: -0.8, x1: 0.98, y0: -0.98, y1: 0.84 },
    narrowBox: { x0: -0.94, x1: 0.94, y0: -0.6, y1: 0.66 },
    /** Height of the scenery band at the back of a panel, on its left and on its right. */
    scenery: [1.75, 2.0],
  },
  wide: { elevation: 30, yaw: -17, box: { x0: -0.95, x1: 0.95, y0: -0.8, y1: 0.34 }, narrowBox: { x0: -0.96, x1: 0.96, y0: -0.5, y1: 0.4 } },
  /** The hop between two panels: the camera rises, and its eye runs ahead of it. */
  hop: 0.44,
  hopLook: 0.35,
  lead: 0.52,
  /** Below this aspect a window is narrow. */
  narrowAspect: 0.85,
} as const;

/** What overlays cover at the edges of the window, in screen units (the screen is 2 wide and 2 high). */
export interface WalkInsets {
  readonly left?: number;
  readonly right?: number;
  readonly top?: number;
  readonly bottom?: number;
  /** True for a narrow window. By default a window narrower than 0.85 of its height is narrow. */
  readonly narrow?: boolean;
}

/** The left edge of panel `index` in map space when the map lies open. */
export function panelLeft(index: number): number {
  return -PANEL.width / 2 + index * PANEL.width;
}

function inset(box: ScreenBox, insets: WalkInsets): ScreenBox {
  const x0 = box.x0 + (insets.left ?? 0);
  const x1 = box.x1 - (insets.right ?? 0);
  const y0 = box.y0 + (insets.bottom ?? 0);
  const y1 = box.y1 - (insets.top ?? 0);
  // A box never closes: overlays that claim everything leave a strip in the middle.
  return { x0: Math.min(x0, x1 - 0.2), x1: Math.max(x1, x0 + 0.2), y0: Math.min(y0, y1 - 0.2), y1: Math.max(y1, y0 + 0.2) };
}

/** The points a panel's pose is fitted to: its front corners and the top of the scenery at its back. */
export function panelPoints(index: number): Vec3[] {
  const left = panelLeft(index);
  const right = left + PANEL.width;
  const front = PANEL.depth / 2;
  const back = -PANEL.depth / 2 + 0.5;
  return [
    { x: left, y: 0, z: front },
    { x: right, y: 0, z: front },
    { x: left, y: RAIL.panel.scenery[0], z: back },
    { x: right, y: RAIL.panel.scenery[1], z: back },
  ];
}

/**
 * The poses of the rail for a map of `count` panels: 0 the shut map, 1 to count one per panel, count + 1 the
 * whole map, count + 2 the shut map again.
 */
export function railPoses(count: number, aspect: number, insets: WalkInsets = {}): CameraPose[] {
  const n = clampPanels(count);
  const ratio = aspect > 0 ? aspect : 1;
  const narrow = insets.narrow ?? ratio < RAIL.narrowAspect;
  const fov = narrow ? RAIL.panel.narrowFov : RAIL.panel.fov;
  const half = { x: PANEL.width / 2, z: PANEL.depth / 2 };

  const shutPoints: Vec3[] = [
    { x: -half.x, y: 0, z: -half.z },
    { x: half.x, y: 0, z: -half.z },
    { x: -half.x, y: 0, z: half.z },
    { x: half.x, y: 0, z: half.z },
  ];
  const shutShot = narrow ? RAIL.shut.narrow : RAIL.shut;
  const shut = fitPose(shutPoints, { x: 0, y: 0, z: 0 }, shutShot.elevation, shutShot.yaw, fov, inset(RAIL.shut.box, insets), ratio);

  const poses: CameraPose[] = [shut];
  const panelBox = inset(narrow ? RAIL.panel.narrowBox : RAIL.panel.box, insets);
  for (let index = 0; index < n; index += 1) {
    const middle = panelLeft(index) + half.x;
    poses.push(fitPose(panelPoints(index), { x: middle, y: 0.4, z: 0 }, RAIL.panel.elevation, RAIL.panel.yaw, fov, panelBox, ratio));
  }

  // The whole map, with the legend on its left.
  const left = panelLeft(0) - PANEL.width * 0.55;
  const right = panelLeft(n);
  const widePoints: Vec3[] = [
    { x: left, y: 0, z: half.z },
    { x: right, y: 0, z: half.z },
    { x: left, y: 0.9, z: -half.z },
    { x: right, y: 0.9, z: -half.z },
  ];
  poses.push(fitPose(widePoints, { x: (left + right) / 2, y: 0, z: 0 }, RAIL.wide.elevation, RAIL.wide.yaw, fov, inset(narrow ? RAIL.wide.narrowBox : RAIL.wide.box, insets), ratio));
  poses.push({ position: { ...shut.position }, target: { ...shut.target }, distance: shut.distance, fov: shut.fov });
  return poses;
}

const mix3 = (a: Vec3, b: Vec3, t: number): Vec3 => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) });

/**
 * The camera at rail position `rail` (see `railAt`). Between two panels it hops: it rises on a half sine and
 * looks ahead of where it is, so the eye arrives before the dolly.
 */
export function cameraAt(rail: number, poses: readonly CameraPose[]): CameraPose {
  const last = poses.length - 1;
  const at = Math.min(last, Math.max(0, rail));
  const low = Math.min(last - 1, Math.floor(at));
  const f = at - low;
  const a = poses[low] as CameraPose;
  const b = poses[low + 1] as CameraPose;
  const position = mix3(a.position, b.position, f);
  const target = mix3(a.target, b.target, f);
  const panels = poses.length - 3;
  if (low >= 1 && low < panels && f > 0) {
    const hop = Math.sin(Math.PI * f);
    position.y += hop * RAIL.hop;
    target.y += hop * RAIL.hop * RAIL.hopLook;
    target.x += hop * RAIL.lead;
  }
  return { position, target, distance: Math.hypot(position.x - target.x, position.y - target.y, position.z - target.z), fov: lerp(a.fov, b.fov, f) };
}

/** The landing after the dive, as shares of its own progress. */
export const LANDING = {
  /** The head on the map is this much larger than the pin's head on the table. */
  head: 1.3,
  /** The camera arrives as it left the table: nearly overhead, inside the red. */
  arrive: { elevation: 80, yaw: 20 },
  /** It pulls back while the head presses flat into a printed dot. */
  pull: { from: 0, to: 0.2, elevation: 46, distance: 1.46 },
  press: { from: 0.03, to: 0.16 },
  /** The walker springs up. */
  walker: 0.15,
  /** The camera drops to his eye level. */
  eye: { from: 0.2, to: 0.48, elevation: 9, yaw: -16, distance: 1.05, height: 0.16 },
  /** The panel stands up round him. */
  panel: 0.24,
  /** The camera rises to the stage shot. */
  rise: { from: 0.42, to: 1 },
  /** Seconds the landing takes when it plays by itself. */
  seconds: 1.76,
} as const;

export interface LandingInput {
  /** Where the walker lands, on the ground, in map space. */
  readonly spot: Vec3;
  /** Centre of the red head while it still stands, in map space. */
  readonly head: Vec3;
  /** Distance from the centre of the head at which it fills the frame. */
  readonly headDistance: number;
  /** The pose the landing ends in. */
  readonly stage: CameraPose;
  /** Lens the dive arrives with. */
  readonly fov?: number;
}

/**
 * The camera during the landing, `u` from 0 (inside the red head) to 1 (the stage shot). It pulls back and
 * out of the head, drops to the walker's eye level and rises to the shot of his panel.
 */
export function landingPose(u: number, input: LandingInput): CameraPose {
  const t = clamp01(u);
  const pull = easeInOutCubic(seg(t, LANDING.pull.from, LANDING.pull.to));
  const eye = easeInOutCubic(seg(t, LANDING.eye.from, LANDING.eye.to));
  const rise = easeInOutCubic(seg(t, LANDING.rise.from, LANDING.rise.to));

  const elevation = lerp(lerp(LANDING.arrive.elevation, LANDING.pull.elevation, pull), LANDING.eye.elevation, eye);
  const yaw = lerp(LANDING.arrive.yaw, LANDING.eye.yaw, eye);
  const distance = lerp(lerp(input.headDistance, LANDING.pull.distance, pull), LANDING.eye.distance, eye);
  const ground: Vec3 = { x: input.spot.x, y: input.spot.y + lerp(0.06, LANDING.eye.height, eye), z: input.spot.z };
  const target = mix3(input.head, ground, pull);
  const direction = orbitDirection(elevation, yaw);
  const orbit: Vec3 = { x: target.x + direction.x * distance, y: target.y + direction.y * distance, z: target.z + direction.z * distance };

  const position = mix3(orbit, input.stage.position, rise);
  const look = mix3(target, input.stage.target, rise);
  return {
    position,
    target: look,
    distance: Math.hypot(position.x - look.x, position.y - look.y, position.z - look.z),
    fov: lerp(input.fov ?? input.stage.fov, input.stage.fov, rise),
  };
}
