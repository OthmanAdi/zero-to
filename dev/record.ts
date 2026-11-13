/**
 * Dev page for frame-by-frame recordings of the real scene parts.
 *
 * Query: ?shot=compass|trails  &fps=15  &frame=N
 * Shot "compass": &spin=60 (turn of the body at frame 0, degrees)  &slot=5.8 (where the lamp's pool lies, z)
 * Shot "trails": &hold=seconds per mountain  &ui=0 (no caption)
 * Camera overrides for framing tests: &elev= &yaw= &dist= &fov= &dy= (raises the point looked at)
 *
 * The compass shot is an 8 second loop. It sets one option the hero does not: `motion.spinPeriod` is 16
 * seconds (the default is 40), so the body makes half a turn per loop and the loop closes.
 *
 * Nothing here reads the wall clock. Frame N of a shot is the state after N steps of 1/fps seconds from the
 * start of the timeline, so a capture script can take one screenshot per frame at any speed:
 *
 *   await page.evaluate((n) => window.__record.seek(n), n)
 *
 * `window.__record.frames` is the length of the loop. `<html data-ready="1">` is set after the first frame is
 * drawn and the fonts are in; `<html data-frame>` holds the frame on screen.
 */
import '../src/look/fonts.css';
import { Vector3 } from 'three';
import { TAU, createCompass, directionToBearing, type CompassPart } from '../src/compass';
import type { FrameTime } from '../src/scene/contract';
import type { SurfaceKind } from '../src/scene/palette';
import { createStage } from '../src/scene/stage';
import { createLamp, type LampState } from '../src/table/lamp';
import { createCloth, createTableTop } from '../src/table/room';
import {
  TERRAIN_TEMPLATES,
  TRAIL_TEMPLATES,
  resolveTerrainTemplate,
  resolveTrailTemplate,
  type TerrainSpec,
  type TerrainTemplate,
  type TrailSpec,
  type TrailTemplate,
} from '../src/terrain';
import { createTerrainModel, type TerrainPart } from '../src/terrain/model';

const params = new URLSearchParams(window.location.search);
const numberOf = (name: string, fallback: number): number => {
  const raw = params.get(name);
  const value = raw === null || raw === '' ? Number.NaN : Number(raw);
  return Number.isFinite(value) ? value : fallback;
};

const RAD = Math.PI / 180;
const shotName = params.get('shot') === 'trails' ? 'trails' : 'compass';
const fps = Math.min(60, Math.max(1, Math.round(numberOf('fps', 15))));
const step = 1 / fps;

const canvas = document.getElementById('view') as HTMLCanvasElement;
const caption = document.getElementById('caption') as HTMLDivElement;
const count = document.getElementById('count') as HTMLDivElement;
const html = document.documentElement;

/** A shot: a timeline of whole frames that can be started at certain frames and stepped forward from there. */
interface Shot {
  /** Frames in one loop. Frame `frames` shows what frame 0 shows. */
  readonly frames: number;
  /** The last frame at or before `frame` from which the timeline can start fresh. */
  keyframe(frame: number): number;
  /** Puts the scene into the state of a keyframe. */
  start(frame: number): void;
  /** Advances from `frame - 1` to `frame`. */
  advance(frame: number): void;
}

const stage = createStage({ canvas, reduced: () => false });
const { scene, camera, environment } = stage;

// The room of the hero: the cloth, the walnut turntable and the one lamp.
const cloth = createCloth(environment);
const top = createTableTop(environment);
const lamp = createLamp(environment, false);
scene.add(cloth.mesh, top.mesh, lamp.object);

function aimCamera(fov: number, elevationDeg: number, yawDeg: number, distance: number, target: Vector3): void {
  camera.fov = numberOf('fov', fov);
  camera.updateProjectionMatrix();
  const elevation = numberOf('elev', elevationDeg) * RAD;
  const yaw = numberOf('yaw', yawDeg) * RAD;
  const reach = numberOf('dist', distance);
  target.y += numberOf('dy', 0);
  const flat = Math.cos(elevation) * reach;
  camera.position.set(target.x + Math.sin(yaw) * flat, target.y + Math.sin(elevation) * reach, target.z + Math.cos(yaw) * flat);
  camera.lookAt(target);
}

// ---------------------------------------------------------------------------------------------------------
// Shot "compass": the compass of the hero, turning under the lamp, its needle swinging to three bearings.

/**
 * A start time for a loop of `seconds` in which the compass ends where it began. The bob (4 seconds) and the turn
 * (set to half a turn per loop; the gimbal looks the same after half a turn) repeat exactly. The wobble, the
 * swing of the rings, the tremble of the needle and the breath of the glow have periods that fit no short loop,
 * so this looks for the moment of scene time at which their values at the two ends of the loop agree best.
 * After half a turn a ring angle shows mirrored, so the rings must end at minus their start. The numbers are
 * those of `showpiecePose` and of the compass itself.
 */
function loopStart(seconds: number): number {
  const parts: readonly { amplitude: number; rate: number; phase: number; mirrored: boolean; weight: number }[] = [
    { amplitude: 0.035, rate: TAU / 7.3, phase: 0.6, mirrored: false, weight: 1 },
    { amplitude: 0.028, rate: TAU / 9.1, phase: 2.1, mirrored: false, weight: 1 },
    { amplitude: 0.16, rate: TAU / 11.3, phase: 1.2, mirrored: true, weight: 1 },
    { amplitude: 0.05, rate: TAU / 6.1, phase: 0, mirrored: true, weight: 1 },
    { amplitude: 0.006, rate: 2.3, phase: 0, mirrored: false, weight: 0.5 },
    { amplitude: 0.004, rate: 5.1, phase: 1, mirrored: false, weight: 0.5 },
    { amplitude: 0.07, rate: 1.3, phase: 0, mirrored: false, weight: 0.1 },
  ];
  let best = 0;
  let bestCost = Infinity;
  for (let i = 0; i < 2000000; i += 1) {
    const t = i * 0.01;
    let cost = 0;
    for (const part of parts) {
      const from = Math.sin(part.rate * t + part.phase);
      const to = Math.sin(part.rate * (t + seconds) + part.phase);
      const gap = part.amplitude * part.weight * (part.mirrored ? to + from : to - from);
      cost += gap * gap;
    }
    if (cost < bestCost) {
      bestCost = cost;
      best = t;
    }
  }
  return best;
}

function compassShot(): Shot {
  const seconds = 8;
  const frames = Math.round(seconds * fps);
  const spinPeriod = seconds * 2;
  const t0 = loopStart(seconds);
  // The bearings the needle is sent to, and when. It ends on the one it began with.
  const bearings = [312, 68, 196].map((degrees) => degrees * RAD) as [number, number, number];
  const swings: readonly { at: number; bearing: number }[] = [
    { at: 0.9, bearing: bearings[1] },
    { at: 3.3, bearing: bearings[2] },
    { at: 5.7, bearing: bearings[0] },
  ];
  const startYaw = numberOf('spin', 60) * RAD;

  // The compass as the table builds it: same size, lean and lamp.
  const compass: CompassPart = createCompass({
    environment,
    diameter: 3.2,
    lean: 0.32,
    heading: bearings[0],
    glow: 1,
    lightBearing: directionToBearing(-1.9, 2.6),
    lightElevation: 58 * RAD,
    restYaw: startYaw - (TAU * t0) / spinPeriod,
    motion: { spinPeriod },
  });
  scene.add(compass.object);

  const centre = new Vector3(0, (compass.topY + compass.bottomY) / 2, 0);
  const slot = new Vector3(0, 0, numberOf('slot', 5.8));
  aimCamera(24, 34, 0, 8.7, centre.clone());

  const light = (frame: FrameTime): LampState => ({
    t: frame.t,
    dt: frame.dt,
    reduced: false,
    on: 1,
    warm: 1,
    rake: 0,
    sun: 0,
    slot,
    focus: centre,
    compass: centre,
    compassOn: 1,
  });

  let fired = 0;
  return {
    frames,
    keyframe: () => 0,
    start() {
      fired = 0;
      compass.setHeading(bearings[0], { immediate: true });
      const frame = { dt: 0, t: t0, reduced: false };
      compass.update(frame);
      lamp.update(light(frame));
    },
    advance(frame) {
      const time = frame * step;
      for (; fired < swings.length; fired += 1) {
        const swing = swings[fired] as { at: number; bearing: number };
        if (swing.at >= time) break;
        compass.setHeading(swing.bearing);
      }
      const now = { dt: step, t: t0 + time, reduced: false };
      compass.update(now);
      lamp.update(light(now));
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// Shot "trails": paper mountains growing out of their contour prints, one template pair or seed after another.

interface TrailState {
  readonly template: TerrainTemplate | 'random';
  readonly trail: TrailTemplate | 'random';
  readonly seed: string;
  readonly stops: number;
  readonly surfaces: readonly SurfaceKind[] | 'auto';
}

const TRAIL_STATES: readonly TrailState[] = [
  { template: 'volcano', trail: 'spiral', seed: 'zero-to', stops: 6, surfaces: 'auto' },
  { template: 'ridge', trail: 'ridge-walk', seed: 'zero-to', stops: 5, surfaces: ['grass', 'forest', 'rock', 'snow'] },
  { template: 'massif', trail: 'switchback', seed: 'zero-to', stops: 7, surfaces: ['forest', 'rock', 'snow'] },
  // Three topics as seeds, with the mountain and the way up left to the seed. Between them they pick the three
  // shapes and the two trails the named states above leave out.
  { template: 'random', trail: 'random', seed: 'postgres', stops: 6, surfaces: 'auto' },
  { template: 'random', trail: 'random', seed: 'rust', stops: 6, surfaces: 'auto' },
  { template: 'random', trail: 'random', seed: 'git', stops: 8, surfaces: 'auto' },
];

function trailsShot(): Shot {
  const states = TRAIL_STATES;
  // Each state: the flat print for a moment, the growth at the model's own pace, then the standing mountain.
  const flat = 0.4;
  const perState = Math.round(numberOf('hold', 14 / states.length) * fps);
  const frames = perState * states.length;
  const showCaption = params.get('ui') !== '0';

  const focus = new Vector3(0, 0.45, 0);
  const slot = new Vector3(0, 0, 0);
  aimCamera(30, 27, -16, 7.1, new Vector3(0.1, -0.2, 0.2));

  const light = (frame: FrameTime): LampState => ({
    t: frame.t,
    dt: frame.dt,
    reduced: false,
    on: 1,
    warm: 1,
    rake: 1,
    sun: 0,
    slot,
    focus,
    compass: focus,
    compassOn: 0,
  });

  let part: TerrainPart | null = null;
  let growing = false;

  const nameOf = <Id extends string>(list: readonly { id: Id; name: string }[], id: Id): string =>
    list.find((entry) => entry.id === id)?.name ?? id;

  const build = (index: number): void => {
    const state = states[index] as TrailState;
    part?.dispose();
    const terrain: TerrainSpec = { seed: state.seed, template: state.template, roughness: 0.5 };
    const trail: TrailSpec = { seed: state.seed, template: state.trail, stops: state.stops };
    part = createTerrainModel({ terrain, trail, surfaces: state.surfaces, environment });
    scene.add(part.object);
    // The flat print first: the contours as they lie on the sheet.
    part.grow(0, true);
    growing = false;

    const mountain = nameOf(TERRAIN_TEMPLATES, resolveTerrainTemplate(terrain));
    const way = nameOf(TRAIL_TEMPLATES, resolveTrailTemplate(trail));
    const grounds = part.surfaces.filter((kind, i, all) => all.indexOf(kind) === i);
    (caption.querySelector('.name') as HTMLElement).textContent = `${mountain}, ${way.toLowerCase()} trail`;
    (caption.querySelector('.spec') as HTMLElement).textContent =
      `template ${state.template} · trail ${state.trail} · seed ${state.seed}\nground ${grounds.join(', ')}`;
    count.textContent = `${index + 1} / ${states.length}`;
    document.body.classList.toggle('captioned', showCaption);
    caption.hidden = !showCaption;
    count.hidden = !showCaption;
  };

  return {
    frames,
    keyframe: (frame) => Math.floor(frame / perState) * perState,
    start(frame) {
      build(Math.floor(frame / perState) % states.length);
      const now = { dt: 0, t: frame * step, reduced: false };
      lamp.update(light(now));
    },
    advance(frame) {
      const local = (frame % perState) * step;
      if (!growing && local > flat) {
        part?.playGrow();
        growing = true;
      }
      const now = { dt: step, t: frame * step, reduced: false };
      part?.update(now);
      lamp.update(light(now));
    },
  };
}

// ---------------------------------------------------------------------------------------------------------

const shot = shotName === 'trails' ? trailsShot() : compassShot();
let cursor = -1;

function seek(frame: number): number {
  const wanted = Math.max(0, Math.round(Number.isFinite(frame) ? frame : 0));
  const key = shot.keyframe(wanted);
  if (cursor < key || wanted < cursor) {
    shot.start(key);
    cursor = key;
  }
  while (cursor < wanted) {
    cursor += 1;
    // A keyframe on the way is a fresh start of its own.
    if (shot.keyframe(cursor) === cursor) shot.start(cursor);
    else shot.advance(cursor);
  }
  stage.renderer.render(scene, camera);
  html.dataset.frame = String(wanted);
  return wanted;
}

const record = { shot: shotName, fps, frames: shot.frames, seek, stage };
Object.assign(window, { __record: record });

declare global {
  interface Window {
    __record: typeof record;
  }
}

const first = numberOf('frame', 0);
seek(first);
void Promise.all([
  document.fonts.load("600 30px 'Fraunces'"),
  document.fonts.load("500 16px 'IBM Plex Mono'"),
  document.fonts.ready,
]).finally(() => {
  // Twice: the first draw compiles the programs and fills the shadow maps.
  seek(first);
  requestAnimationFrame(() => {
    seek(first);
    html.dataset.ready = '1';
  });
});
