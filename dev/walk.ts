/**
 * Dev page for the walk alone: the folded map of one roadmap opens, and scrolling walks the paper hiker along
 * its route. No table, no dive: the map is reached "without the hero", so it opens by itself at the start.
 *
 * Scroll, or use the keys: Left and Right go to the previous and next stop, Home and End to the ends.
 * Click or tap a cut-out to make it wobble.
 *
 * URL parameters:
 *   ?road=<id>         a gallery sample (default rust-for-a-python-dev)
 *   ?p=<0..1>          jump to this walk progress
 *   ?still=1&t=<s>     no loop: build everything, settle at p, step t seconds at 1/60 s (default 1.5), draw one
 *                      frame, then wait for window.__walk
 *   ?done=<n>          mark the first n waypoints as done, so you-are-here has moved
 *   ?pass=<n>          tick every arm of the first n checkpoints
 *   ?landing=<0..1>    show a moment of the landing after the dive instead of the rail
 *   ?fold=<0..1>       hold the map at this fold
 *   ?terrain=, ?trail= override the roadmap's mountain and way up
 *   ?stages=<2..8>     cut or repeat the stages to this number
 *   ?motion=reduced    reduced motion
 *   ?ui=de             interface language
 *   ?bare=1            the scene alone, without the stand-in note
 *   ?phone=1           treat the device as a phone
 */
import { Fog, Raycaster, Vector2, Vector3 } from 'three';
import { uiLang } from '../src/i18n';
import { createRoomOverlays, ensurePaperEdge } from '../src/look/dom';
import { formatHours } from '../src/look/format';
import '../src/look/look.css';
import { THEME } from '../src/look/theme';
import { injectTokens } from '../src/look/tokens';
import { loadFonts } from '../src/look/type';
import { critDamp, spring, type CameraPose } from '../src/paper/motion';
import { emptyProgress, markDone, setShow, checkpointPassed, type Progress } from '../src/roadmap/progress';
import german from '../src/roadmap/samples/deutsch-a1-von-null.json';
import langgraph from '../src/roadmap/samples/langgraph-for-a-python-dev.json';
import music from '../src/roadmap/samples/music-theory-for-a-class.json';
import photography from '../src/roadmap/samples/photography-basics.json';
import rust from '../src/roadmap/samples/rust-for-a-python-dev.json';
import statistics from '../src/roadmap/samples/statistics-for-data-work.json';
import type { Roadmap, Stage, TerrainKind, TrailKind } from '../src/roadmap/types';
import type { FrameTime, SceneEnvironment } from '../src/scene/contract';
import { createStage } from '../src/scene/stage';
import { MINI, PANEL, RAIL, createWalk, panelRoutePoints, type WalkItem, type WalkPart } from '../src/walk';

const params = new URLSearchParams(location.search);
const flag = (name: string): boolean => params.has(name) && params.get(name) !== '0';
const numberOf = (name: string, fallback: number): number => {
  const raw = params.get(name);
  const value = raw === null || raw === '' ? Number.NaN : Number(raw);
  return Number.isFinite(value) ? value : fallback;
};

const still = flag('still');
const reducedForced = params.get('motion') === 'reduced';
const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const isReduced = (): boolean => reducedForced || reducedQuery.matches;
const lang = uiLang();
document.body.classList.toggle('still', still);
document.body.classList.toggle('bare', flag('bare'));

// ---------------------------------------------------------------------------------------------------------
// The roadmap.

const SAMPLES = [rust, german, photography, langgraph, music, statistics] as unknown as Roadmap[];
let roadmap = structuredClone(SAMPLES.find((sample) => sample.id === params.get('road')) ?? SAMPLES[0]) as Roadmap;

const wantStages = Math.round(numberOf('stages', 0));
if (wantStages >= 2 && wantStages <= 8 && wantStages !== roadmap.stages.length) {
  const stages: Stage[] = Array.from({ length: wantStages }, (_, index) => {
    const source = roadmap.stages[index % roadmap.stages.length] as Stage;
    if (index < roadmap.stages.length) return source;
    return { ...source, id: `${source.id}-${index}`, waypoints: source.waypoints.map((waypoint) => ({ ...waypoint, id: `${waypoint.id}-${index}` })) };
  });
  roadmap = { ...roadmap, stages };
}
const terrain = params.get('terrain') as TerrainKind | null;
const trail = params.get('trail') as TrailKind | null;
if (terrain || trail) roadmap = { ...roadmap, map: { ...roadmap.map, ...(terrain ? { terrain } : {}), ...(trail ? { trail } : {}) } };

let progressData: Progress = emptyProgress(roadmap.id, roadmap.checkedOn);
const waypointIds = roadmap.stages.flatMap((stage) => stage.waypoints.map((waypoint) => waypoint.id));
for (const id of waypointIds.slice(0, Math.max(0, Math.round(numberOf('done', 0))))) progressData = markDone(progressData, roadmap, id, '2026-11-13T09:00:00Z');
roadmap.stages.slice(0, Math.max(0, Math.round(numberOf('pass', 0)))).forEach((stage) => {
  stage.checkpoint.show.forEach((_, index) => {
    progressData = setShow(progressData, stage.id, index, true, '2026-11-13T09:00:00Z');
  });
});

// ---------------------------------------------------------------------------------------------------------
// Stage and walk.

injectTokens();
ensurePaperEdge();
const canvas = document.getElementById('stage') as HTMLCanvasElement;
const stage = createStage({ canvas, reduced: isReduced, background: THEME.night, fov: RAIL.panel.fov });
const environment: SceneEnvironment = flag('phone') ? { ...stage.environment, phone: true, maxTexture: 1024 } : stage.environment;
stage.scene.fog = new Fog(THEME.night, 10, 60);

let walk: WalkPart;
const overlays = createRoomOverlays(document, { scrim: false });
overlays.style.zIndex = '1';
document.body.append(overlays);

// The stand-in note.
const note = document.createElement('aside');
note.className = 'dev-note zt-paper';
note.dataset.side = 'left';
note.hidden = true;
const tape = Object.assign(document.createElement('span'), { className: 'zt-tape' });
const kicker = Object.assign(document.createElement('span'), { className: 'dev-kicker zt-label' });
const noteTitle = Object.assign(document.createElement('h2'), { className: 'zt-title' });
noteTitle.dir = 'auto';
noteTitle.lang = roadmap.lang;
const mini = document.createElement('canvas');
mini.width = MINI.width;
mini.height = MINI.height;
const noteText = Object.assign(document.createElement('p'), { className: 'zt-small' });
noteText.dir = 'auto';
noteText.lang = roadmap.lang;
note.append(tape, kicker, noteTitle, mini, noteText);
const read = Object.assign(document.createElement('div'), { className: 'dev-read zt-label' });
document.body.append(note, read);

function size(): { width: number; height: number } {
  return { width: canvas.clientWidth || window.innerWidth, height: canvas.clientHeight || window.innerHeight };
}

/** What the stand-in overlay takes from the window, in screen units: on a narrow window the note's peek. */
function insets(): { bottom?: number; narrow: boolean } {
  const { width, height } = size();
  const narrow = width <= 760 || width / Math.max(1, height) < RAIL.narrowAspect;
  return narrow ? { bottom: (2 * 108) / height, narrow } : { narrow };
}

function reframe(): void {
  const { width, height } = size();
  walk.posesFor(width / Math.max(1, height), insets());
}

// ---------------------------------------------------------------------------------------------------------
// Progress: the scroll position, chased once by a critically damped spring.

const stretch = document.getElementById('stretch') as HTMLElement;
const smoothed = spring(0);
let target = 0;
const landingAt = params.has('landing') ? Math.min(1, Math.max(0, numberOf('landing', 0))) : null;

function scrollRange(): number {
  return Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
}
function readScroll(): void {
  target = Math.min(1, Math.max(0, window.scrollY / scrollRange()));
}
function scrollToProgress(p: number, smooth = true): void {
  window.scrollTo({ top: p * scrollRange(), behavior: smooth && !isReduced() ? 'smooth' : 'instant' });
}

const world = new Vector3();
function applyCamera(pose: CameraPose): void {
  const camera = stage.camera;
  camera.position.set(pose.position.x, pose.position.y, pose.position.z);
  // The landing starts a few hundredths from the red head: the near plane has to let it through.
  const near = landingAt !== null && landingAt < 0.5 ? 0.005 : 0.1;
  if (camera.fov !== pose.fov || camera.near !== near) {
    camera.fov = pose.fov;
    camera.near = near;
    camera.updateProjectionMatrix();
  }
  camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
  camera.updateMatrixWorld();
  const fog = stage.scene.fog as Fog;
  const range = walk.fogFor(pose.distance);
  fog.near = Math.max(range.near, 12);
  fog.far = Math.max(range.far, 46);
}

let lastItem = 'none';
let lastPixel = '';
function itemKey(item: WalkItem | null): string {
  if (!item) return '';
  return item.kind === 'waypoint' ? `waypoint:${item.waypointId}` : `${item.kind}:${item.stageId}`;
}

function writeNote(): void {
  const item = walk.activeItem;
  const key = itemKey(item);
  const { width, height } = size();
  if (key !== lastItem) {
    lastItem = key;
    note.hidden = item === null;
    if (item) {
      const stageData = roadmap.stages.find((entry) => entry.id === item.stageId) as Stage;
      const stageIndex = roadmap.stages.indexOf(stageData);
      if (item.kind === 'waypoint') {
        const waypoint = stageData.waypoints[item.index];
        const mark = walk.plan.panels[stageIndex]?.marks[item.index];
        kicker.textContent = mark ? `${formatHours(mark.minutesAfter - (waypoint?.minutes ?? 0), { lang, approx: false, unit: 'hours' })} · ${stageData.title}` : stageData.title;
        noteTitle.textContent = waypoint?.title ?? '';
        noteText.textContent = waypoint?.note ?? '';
      } else if (item.kind === 'signpost') {
        kicker.textContent = `Checkpoint · ${stageData.title}`;
        noteTitle.textContent = stageData.checkpoint.title;
        noteText.textContent = stageData.checkpoint.show.join(' · ');
      } else {
        kicker.textContent = `Camp · ${stageData.title}`;
        noteTitle.textContent = stageData.project?.title ?? '';
        noteText.textContent = stageData.project?.brief ?? '';
      }
      // The emptier side wins: the walker's own point is never covered.
      const projection = walk.projectActive(stage.camera, { width, height });
      const noteWidth = Math.min(340, width * 0.29);
      const score = (left: number): number => {
        let sum = 0;
        for (const point of projection.points) if (point.x >= left - 16 && point.x <= left + noteWidth + 16 && point.y >= 66 && point.y <= 82 + 330) sum += point.weight;
        if (projection.walker && projection.walker.x >= left - 16 && projection.walker.x <= left + noteWidth + 16 && projection.walker.y <= 82 + 330) sum += 1e6;
        return sum;
      };
      const left = score(40);
      const right = score(width - 40 - noteWidth);
      if (left !== right) note.dataset.side = left < right ? 'left' : 'right';
    }
  }
  if (!item) return;
  const map = walk.miniMap(walk.place.panel);
  if (!map) return;
  const pixel = map.pixel ? `${Math.round(map.pixel.x)},${Math.round(map.pixel.y)},${walk.place.panel}` : '';
  if (pixel === lastPixel) return;
  lastPixel = pixel;
  const context = mini.getContext('2d');
  if (!context) return;
  context.drawImage(map.canvas, 0, 0);
  if (map.pixel) {
    context.fillStyle = 'rgba(226, 73, 47, 0.22)';
    context.beginPath();
    context.arc(map.pixel.x, map.pixel.y, MINI.width / 34, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = THEME.signal;
    context.strokeStyle = THEME.paperHi;
    context.lineWidth = 2;
    context.beginPath();
    context.arc(map.pixel.x, map.pixel.y, MINI.width / 70, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }
}

function writeRead(): void {
  const place = walk.place;
  read.textContent = `p ${walk.progress.toFixed(3)}   stage ${place.panel + 1}/${walk.plan.panels.length}   ${Math.round(walk.along * 100)} % of the minutes   fold ${walk.fold.toFixed(2)}${walk.ready ? '' : `   building ${Math.round(walk.built * 100)} %`}`;
}

function step(frame: FrameTime): void {
  if (landingAt === null) {
    if (frame.reduced || still) smoothed.x = target;
    else critDamp(smoothed, target, 8, frame.dt);
    walk.setProgress(smoothed.x);
  }
  walk.update(frame);
  applyCamera(landingAt === null ? walk.cameraAt() : walk.landingPose(landingAt));
  writeNote();
  writeRead();
}

// ---------------------------------------------------------------------------------------------------------
// Input.

const raycaster = new Raycaster();
const ndc = new Vector2();
let down: { x: number; y: number } | null = null;
canvas.addEventListener('pointerdown', (event) => {
  down = { x: event.clientX, y: event.clientY };
});
canvas.addEventListener('pointerup', (event) => {
  if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6) return;
  const { width, height } = size();
  ndc.set((event.clientX / width) * 2 - 1, 1 - (event.clientY / height) * 2);
  raycaster.setFromCamera(ndc, stage.camera);
  const hit = walk.tap(raycaster.ray);
  document.documentElement.dataset.tap = hit ? `${hit.kind}:${hit.stageId}` : 'none';
  if (hit) console.info('tap', hit);
});

/** The stops of the walk in order, as walk progress. */
function stops(): number[] {
  const list: number[] = [];
  for (const stageData of roadmap.stages) {
    for (const waypoint of stageData.waypoints) {
      const at = walk.progressFor({ waypointId: waypoint.id });
      if (at !== null) list.push(at);
    }
    const sign = walk.progressFor({ stageId: stageData.id, kind: 'signpost' });
    if (sign !== null) list.push(sign);
    const camp = walk.progressFor({ stageId: stageData.id, kind: 'camp' });
    if (camp !== null) list.push(camp);
  }
  return list;
}
window.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
    const list = stops();
    const next = event.key === 'ArrowRight' ? list.find((at) => at > target + 0.002) : [...list].reverse().find((at) => at < target - 0.002);
    if (next !== undefined) scrollToProgress(next);
    event.preventDefault();
  } else if (event.key === 'Home') {
    scrollToProgress(0);
  } else if (event.key === 'End') {
    scrollToProgress(1);
  }
});
window.addEventListener('scroll', readScroll, { passive: true });
window.addEventListener('resize', () => {
  reframe();
  readScroll();
});

// ---------------------------------------------------------------------------------------------------------
// Start.

declare global {
  interface Window {
    __walk?: {
      ready: boolean;
      part: WalkPart;
      /** Screen positions in window pixels of what the checks measure. */
      measure(): {
        progress: number;
        fold: number;
        stage: number;
        walkerShown: boolean;
        walker: { x: number; y: number };
        walkerTop: { x: number; y: number };
        routeEnd: { x: number; y: number };
        solidEnd: { x: number; y: number };
        pin: { x: number; y: number };
        panels: { index: number; corners: { x: number; y: number }[]; inFrame: boolean }[];
        active: string;
      };
      /** Draws a frame and reads it back: mean brightness of each panel and where the route colour is. */
      read(): {
        /** Mean luminance (0 to 255) inside every panel's outline, where it is on screen. */
        panelLuma: (number | null)[];
        /** Pixels in the colour of the route in the whole frame, and within 14 px of the walker, the route's solid end and the pin. */
        signal: number;
        signalAtWalker: number;
        signalAtPin: number;
        /** The darkest and the brightest of nine points spread over the frame. */
        frameLuma: number[];
      };
    };
  }
}

function toScreen(position: Vector3): { x: number; y: number } {
  const { width, height } = size();
  const projected = position.clone().project(stage.camera);
  return { x: ((projected.x + 1) / 2) * width, y: ((1 - projected.y) / 2) * height };
}

/** The point of the drawn route at a length on the whole map, from the route's own points. */
function routePoint(length: number): Vector3 {
  const panels = walk.plan.panels;
  let panel = panels[panels.length - 1] as (typeof panels)[number];
  for (const candidate of panels) {
    if (length <= candidate.start + candidate.length + 1e-9) {
      panel = candidate;
      break;
    }
  }
  const local = Math.min(panel.length, Math.max(0, length - panel.start));
  const points = panelRoutePoints(panel);
  let a = points[0] as (typeof points)[number];
  let b = points[points.length - 1] as (typeof points)[number];
  for (let k = 1; k < points.length; k += 1) {
    if ((points[k] as (typeof points)[number]).s >= local) {
      a = points[k - 1] as (typeof points)[number];
      b = points[k] as (typeof points)[number];
      break;
    }
  }
  const t = b.s > a.s ? Math.min(1, Math.max(0, (local - a.s) / (b.s - a.s))) : 1;
  const x = a.x + (b.x - a.x) * t;
  const z = a.z + (b.z - a.z) * t;
  return walk.panelToWorld(panel.index, x, walk.groundAt(panel.index, x, z), z, new Vector3());
}

function measure(): ReturnType<NonNullable<Window['__walk']>['measure']> {
  const { width, height } = size();
  const place = walk.place;
  const panels = walk.plan.panels.map((panel) => {
    const corners = [
      [0, -PANEL.depth / 2],
      [PANEL.width, -PANEL.depth / 2],
      [PANEL.width, PANEL.depth / 2],
      [0, PANEL.depth / 2],
    ].map(([x, z]) => toScreen(walk.panelToWorld(panel.index, x as number, 0, z as number, world)));
    return { index: panel.index, corners, inFrame: corners.every((corner) => corner.x >= -2 && corner.x <= width + 2 && corner.y >= -2 && corner.y <= height + 2) };
  });
  return {
    progress: walk.progress,
    fold: walk.fold,
    stage: place.panel,
    walkerShown: walk.walkerShown,
    walker: toScreen(walk.walkerFeet(world)),
    walkerTop: toScreen(walk.walkerTop(world)),
    routeEnd: toScreen(routePoint(place.length)),
    solidEnd: toScreen(routePoint(walk.here.length)),
    pin: toScreen(walk.panelToWorld(walk.here.panel, walk.here.point.x, walk.groundAt(walk.here.panel, walk.here.point.x, walk.here.point.z), walk.here.point.z, world)),
    panels,
    active: itemKey(walk.activeItem),
  };
}

function readFrame(): ReturnType<NonNullable<Window['__walk']>['read']> {
  stage.renderer.render(stage.scene, stage.camera);
  const gl = stage.renderer.getContext();
  const bufferWidth = gl.drawingBufferWidth;
  const bufferHeight = gl.drawingBufferHeight;
  const data = new Uint8Array(bufferWidth * bufferHeight * 4);
  gl.readPixels(0, 0, bufferWidth, bufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, data);
  const { width, height } = size();
  const at = (x: number, y: number): [number, number, number] | null => {
    const px = Math.round((x / width) * bufferWidth);
    const py = bufferHeight - 1 - Math.round((y / height) * bufferHeight);
    if (px < 0 || py < 0 || px >= bufferWidth || py >= bufferHeight) return null;
    const index = (py * bufferWidth + px) * 4;
    return [data[index] as number, data[index + 1] as number, data[index + 2] as number];
  };
  const luma = (rgb: readonly number[]): number => 0.2126 * (rgb[0] as number) + 0.7152 * (rgb[1] as number) + 0.0722 * (rgb[2] as number);
  const isSignal = (rgb: readonly number[]): boolean => (rgb[0] as number) > 150 && (rgb[0] as number) - (rgb[1] as number) > 60 && (rgb[0] as number) - (rgb[2] as number) > 70;

  const measured = measure();
  const panelLuma = measured.panels.map((panel) => {
    const [a, b, c, d] = panel.corners as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
    let sum = 0;
    let count = 0;
    for (let j = 0; j < 20; j += 1) {
      for (let i = 0; i < 20; i += 1) {
        const u = 0.12 + (0.76 * (i + 0.5)) / 20;
        const v = 0.12 + (0.76 * (j + 0.5)) / 20;
        const x = (a.x * (1 - u) + b.x * u) * (1 - v) + (d.x * (1 - u) + c.x * u) * v;
        const y = (a.y * (1 - u) + b.y * u) * (1 - v) + (d.y * (1 - u) + c.y * u) * v;
        const rgb = at(x, y);
        if (!rgb) continue;
        sum += luma(rgb);
        count += 1;
      }
    }
    return count >= 80 ? sum / count : null;
  });
  let signal = 0;
  for (let index = 0; index < data.length; index += 4) if (isSignal([data[index] as number, data[index + 1] as number, data[index + 2] as number])) signal += 1;
  const near = (point: { x: number; y: number }, radius: number): number => {
    let found = 0;
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (dx * dx + dy * dy > radius * radius) continue;
        const rgb = at(point.x + dx, point.y + dy);
        if (rgb && isSignal(rgb)) found += 1;
      }
    }
    return found;
  };
  const frameLuma: number[] = [];
  for (const v of [0.1, 0.5, 0.9]) for (const u of [0.1, 0.5, 0.9]) frameLuma.push(luma(at(u * width, v * height) ?? [0, 0, 0]));
  return { panelLuma, signal, signalAtWalker: near(measured.walker, 14), signalAtPin: near(measured.pin, 14), frameLuma };
}

async function main(): Promise<void> {
  await loadFonts({ text: `${roadmap.title}${roadmap.stages.map((entry) => entry.title).join('')}` });
  walk = createWalk(environment, { roadmap, progress: progressData, lang });
  walk.setPassed(roadmap.stages.flatMap((entry, index) => (checkpointPassed(roadmap, progressData, entry.id) ? [index] : [])));
  stage.scene.add(walk.object);
  stretch.style.height = `${walk.plan.windows.viewports * 100 + 100}vh`;
  reframe();
  if (params.has('fold')) walk.setFold(numberOf('fold', 1));
  if (landingAt !== null) {
    walk.setProgress(0.086);
    walk.setFold(1);
    walk.setLanding(landingAt);
  }

  const startAt = params.has('p') ? Math.min(1, Math.max(0, numberOf('p', 0))) : null;
  if (startAt !== null) {
    scrollToProgress(startAt, false);
    target = startAt;
    smoothed.x = startAt;
    if (landingAt === null) walk.setProgress(startAt);
  } else {
    readScroll();
    smoothed.x = target;
  }

  if (still) {
    walk.finish();
    walk.update({ dt: 0, t: 0, reduced: isReduced() });
    walk.settle();
    const seconds = Math.max(0, numberOf('t', 1.5));
    const frames = Math.round(seconds * 60);
    for (let index = 0; index <= frames; index += 1) step({ dt: index === 0 ? 0 : 1 / 60, t: index / 60, reduced: isReduced() });
    stage.renderer.render(stage.scene, stage.camera);
    window.__walk = { ready: true, part: walk, measure, read: readFrame };
    return;
  }

  walk.update({ dt: 0, t: 0, reduced: isReduced() });
  if (startAt !== null) {
    walk.finish();
    walk.settle();
  }
  stage.onFrame(step);
  stage.start();
  window.__walk = { ready: true, part: walk, measure, read: readFrame };
}

void main();
