/**
 * Dev page for the hero: the turntable under the lamp, the compass over its middle, five or six roadmaps round
 * it and the mountain growing on the sheet in the light.
 *
 * Keys: Left and Right turn the table, Enter goes in (logged only), I plays the intro again.
 *
 * URL parameters:
 *   ?road=<id>         the roadmap in slot 0 (default rust-for-a-python-dev)
 *   ?sheets=3..7       how many sheets lie on the table (default 5)
 *   ?done=<n>          mark the first n waypoints of slot 0 as done, so the pin has moved
 *   ?still=1&t=<s>     no loop: step to scene time t at 1/60 s, draw one frame, then wait for window.__table
 *   ?pick=<i>@<s>      in still mode, select sheet i at scene time s (several, comma-separated)
 *   ?intro=0           start settled, without the intro
 *   ?auto=1            let the table turn by itself, as it does for the gallery
 *   ?motion=reduced    reduced motion
 *   ?ui=de             interface language
 *   ?hx=<0..1>         hero-exit progress of the dive
 *   ?bare=1            no overlay, the scene alone
 *   ?phone=1           treat the device as a phone
 *
 * The overlay drawn here (headline, card, arrows, counter) is a stand-in for this page only.
 */
import { Raycaster, Vector2, Vector3 } from 'three';
import { uiLang } from '../src/i18n';
import { createBrand } from '../src/look/brand';
import { createRoomOverlays } from '../src/look/dom';
import '../src/look/look.css';
import { THEME } from '../src/look/theme';
import { injectTokens } from '../src/look/tokens';
import { loadFonts } from '../src/look/type';
import { emptyProgress, markDone, type Progress } from '../src/roadmap/progress';
import sample from '../src/roadmap/samples/rust-for-a-python-dev.json';
import type { Roadmap, TerrainKind, TierName, TrailKind } from '../src/roadmap/types';
import type { FrameTime, SceneEnvironment } from '../src/scene/contract';
import { createStage } from '../src/scene/stage';
import {
  HERO_CAMERA,
  createHeroCamera,
  createTable,
  heroShot,
  isNarrow,
  sayTable,
  type ReadoutParts,
  type SheetSpec,
  type TableHit,
  type TablePart,
} from '../src/table';

const params = new URLSearchParams(location.search);
const flag = (name: string): boolean => params.has(name) && params.get(name) !== '0';
const numberOf = (name: string, fallback: number): number => {
  const raw = params.get(name);
  const value = raw === null || raw === '' ? Number.NaN : Number(raw);
  return Number.isFinite(value) ? value : fallback;
};

const still = flag('still');
const stillTime = numberOf('t', 6);
const reducedForced = params.get('motion') === 'reduced';
const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const isReduced = (): boolean => reducedForced || reducedQuery.matches;
const lang = uiLang();
document.body.classList.toggle('still', still);
document.body.classList.toggle('bare', flag('bare'));

// ---------------------------------------------------------------------------------------------------------
// Roadmaps. Until the gallery samples exist, the table shows the Rust sample and copies of it with other
// subjects, tiers and map options, so every cover and every mountain differs.

const base = sample as unknown as Roadmap;

interface Variant {
  readonly id: string;
  readonly title: string;
  readonly lang: string;
  readonly goal: string;
  readonly target: TierName;
  readonly tiers: readonly TierName[];
  readonly terrain: TerrainKind;
  readonly trail: TrailKind;
}

const VARIANTS: readonly Variant[] = [
  { id: 'sourdough', title: 'Zero to sourdough bread', lang: 'en', goal: 'Bake a loaf you would serve to guests.', target: 'silver', tiers: ['bronze', 'bronze', 'silver'], terrain: 'volcano', trail: 'spiral' },
  { id: 'halbmarathon', title: 'Von null zum ersten Halbmarathon', lang: 'de', goal: '21,1 km ohne Gehpause laufen.', target: 'gold', tiers: ['bronze', 'silver', 'silver', 'gold'], terrain: 'ridge', trail: 'ridge-walk' },
  { id: 'watercolour', title: 'Zero to watercolour landscapes', lang: 'en', goal: 'Paint a landscape from life in one sitting.', target: 'diamond', tiers: ['bronze', 'silver', 'gold', 'gold', 'diamond'], terrain: 'twin-peaks', trail: 'valley-first' },
  { id: 'sheet-music', title: 'Zero to reading sheet music', lang: 'en', goal: 'Sight-read a simple piece at tempo.', target: 'bronze', tiers: ['bronze', 'bronze'], terrain: 'plateau', trail: 'traverse' },
  { id: 'shodo', title: 'ゼロから始める書道', lang: 'ja', goal: '楷書で自分の名前を美しく書く。', target: 'silver', tiers: ['bronze', 'silver', 'silver', 'silver'], terrain: 'canyon', trail: 'switchback' },
  { id: 'statistics', title: 'Zero to statistics for people who avoided maths', lang: 'en', goal: 'Read a study and judge its numbers.', target: 'gold', tiers: ['bronze', 'silver', 'gold'], terrain: 'massif', trail: 'spiral' },
];

function variant(v: Variant): Roadmap {
  const copy = structuredClone(base) as unknown as {
    id: string;
    title: string;
    topic: string;
    lang: string;
    brief: { targetTier: TierName; goal: string };
    map: { terrain: TerrainKind; trail: TrailKind; seed: string; surfaces: 'auto' };
    stages: { id: string; tier: TierName }[];
  };
  copy.id = v.id;
  copy.title = v.title;
  copy.topic = v.title;
  copy.lang = v.lang;
  copy.brief.targetTier = v.target;
  copy.brief.goal = v.goal;
  copy.map = { terrain: v.terrain, trail: v.trail, seed: v.id, surfaces: 'auto' };
  copy.stages = v.tiers.map((tier, index) => ({ ...structuredClone(copy.stages[index % copy.stages.length] as { id: string; tier: TierName }), id: `stage-${index + 1}`, tier }));
  return copy as unknown as Roadmap;
}

const roadmaps: Roadmap[] = [base, ...VARIANTS.map(variant)];
const wantedRoad = params.get('road');
const opened = Math.max(0, roadmaps.findIndex((roadmap) => roadmap.id === wantedRoad));
const ordered = [...roadmaps.slice(opened), ...roadmaps.slice(0, opened)];
const sheetCount = Math.min(7, Math.max(3, Math.round(numberOf('sheets', 5))));

function progressFor(roadmap: Roadmap, done: number): Progress | null {
  if (done <= 0) return null;
  let progress = emptyProgress(roadmap.id, roadmap.checkedOn);
  const ids = roadmap.stages.flatMap((stage) => stage.waypoints.map((waypoint) => waypoint.id));
  for (const id of ids.slice(0, done)) progress = markDone(progress, roadmap, id, '2026-11-13T09:00:00Z');
  return progress;
}

const sheetSpecs: SheetSpec[] = ordered.slice(0, sheetCount).map((roadmap, index) => ({
  roadmap,
  progress: index === 0 ? progressFor(roadmap, Math.round(numberOf('done', 0))) : null,
  example: index !== 0,
}));

// ---------------------------------------------------------------------------------------------------------
// Stage, table, camera.

injectTokens();
const canvas = document.getElementById('stage') as HTMLCanvasElement;
const stage = createStage({ canvas, reduced: isReduced, background: THEME.night, fov: HERO_CAMERA.wide.fov });
const environment: SceneEnvironment = flag('phone') ? { ...stage.environment, phone: true, maxTexture: 1024 } : stage.environment;
const touch = window.matchMedia('(pointer: coarse)').matches;

const table: TablePart = createTable(environment, {
  sheets: sheetSpecs,
  intro: !(params.get('intro') === '0') && !isReduced(),
  autoTurn: flag('auto'),
  lang,
  touch,
});
stage.scene.add(table.object);

const rig = createHeroCamera();
const pointer = { x: 0, y: 0, has: false, speed: 0, lastX: 0, lastY: 0, lastAt: 0 };
const raycaster = new Raycaster();
const ndc = new Vector2();
let hit: TableHit = { kind: 'none', sheet: -1, card: -1, stage: -1 };
let sceneTime = 0;
let introFrom: number | null = table.ready && params.get('intro') !== '0' && !isReduced() ? 0 : null;

function size(): { width: number; height: number } {
  return { width: canvas.clientWidth || window.innerWidth, height: canvas.clientHeight || window.innerHeight };
}

function reframe(): void {
  const { width, height } = size();
  const narrow = isNarrow(width, height);
  // On a narrow screen the headline lies above the scene, so the top of the box clears its lower edge. The lede
  // under it may lie over the far side of the table.
  const text = document.querySelector<HTMLElement>('.dev-copy');
  const clearBelow = narrow && text && !flag('bare') ? 1 - (2 * (text.getBoundingClientRect().bottom - 26)) / height : undefined;
  rig.frame(table.framePoints(), width, height, clearBelow === undefined ? {} : { clearBelow });
}

function step(frame: FrameTime): void {
  sceneTime = frame.t;
  const { width, height } = size();
  if (pointer.has) {
    ndc.set((pointer.x / width) * 2 - 1, 1 - (pointer.y / height) * 2);
    table.setPointer(ndc.x, ndc.y);
  } else {
    table.setPointer(null, null);
  }
  rig.apply(stage.camera, {
    dt: frame.dt,
    reduced: frame.reduced,
    intro: introFrom === null ? null : frame.t - introFrom,
    pointer: pointer.has && !touch ? { x: ndc.x, y: ndc.y } : null,
  });
  stage.camera.updateMatrixWorld();
  if (pointer.has) {
    raycaster.setFromCamera(ndc, stage.camera);
    hit = table.hover(raycaster.ray, pointer.speed);
  } else {
    hit = table.hover(null);
  }
  table.update(frame);
  canvas.style.cursor = hit.kind === 'none' ? '' : 'pointer';
  placeOverlay(frame.t);
}

// ---------------------------------------------------------------------------------------------------------
// The stand-in overlay.

const overlays = createRoomOverlays(document, { scrim: true });
overlays.style.zIndex = '1';
document.body.append(overlays);

const dev = document.createElement('div');
dev.className = 'dev';
document.body.append(dev);
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
};

const brand = el('div', 'dev-brand');
brand.append(createBrand(document));
const copy = el('div', 'dev-copy');
const headline = el('h1', 'zt-headline');
headline.append('Any topic, from zero to the ', Object.assign(document.createElement('em'), { textContent: 'summit' }), '.');
const lede = el('p', 'zt-body', 'Type one prompt, get a trail map you can walk: stages, checkpoints and sources that were opened and checked.');
const hint = el('div', 'dev-hint zt-label', touch ? 'Tap a map to turn the table' : 'Point at the mountain to read its stages');
copy.append(headline, lede, hint);

const card = el('div', 'dev-card');
const chip = el('span', 'dev-chip zt-label');
const meta = el('div', 'dev-meta zt-label');
const title = el('h2', 'zt-title');
title.dir = 'auto';
const goal = el('p', 'dev-goal zt-small');
goal.dir = 'auto';
const hours = el('div', 'dev-hours');
const hoursNumber = el('span', 'zt-number');
const hoursUnit = el('span', 'zt-label', sayTable('hours'));
hours.append(hoursNumber, hoursUnit);
const line = el('div', 'dev-line zt-label');
const stageTitle = el('div', 'dev-stage zt-small');
stageTitle.dir = 'auto';
const pinLine = el('div', 'dev-pin zt-label');
card.append(chip, meta, title, goal, hours, line, stageTitle, pinLine);

const count = el('div', 'dev-count zt-label');
const blazes: HTMLButtonElement[] = sheetSpecs.map((spec, index) => {
  const button = el('button', 'dev-blaze');
  button.type = 'button';
  button.style.setProperty('--tier', THEME.tier[spec.roadmap.brief.targetTier]);
  button.setAttribute('aria-label', spec.roadmap.title);
  button.addEventListener('click', () => table.select(index));
  return button;
});
const counter = el('span', '');
count.append(...blazes, counter);

const previous = el('button', 'dev-arrow', '←');
previous.type = 'button';
previous.setAttribute('aria-label', 'Previous roadmap');
previous.addEventListener('click', () => table.previous());
const next = el('button', 'dev-arrow', '→');
next.type = 'button';
next.setAttribute('aria-label', 'Next roadmap');
next.addEventListener('click', () => table.next());
const enter = el('button', 'dev-enter');
enter.type = 'button';
const ball = el('span', 'dev-ball');
const enterText = el('span', 'zt-label', 'Walk this roadmap');
enterText.append(Object.assign(document.createElement('small'), { textContent: 'Go in at the pin' }));
enter.append(ball, enterText);
enter.addEventListener('click', () => console.info('enter', { sheet: table.selected, stage: -1 }));
dev.append(brand, copy, card, count, previous, next, enter);

const TIER_KEY = { bronze: 'tierBronze', silver: 'tierSilver', gold: 'tierGold', diamond: 'tierDiamond' } as const;

function writeSelection(): void {
  const data = table.sheetData(table.selected);
  if (!data) return;
  const tier = THEME.tier[data.tier];
  card.style.setProperty('--tier', tier);
  previous.style.setProperty('--tier', tier);
  next.style.setProperty('--tier', tier);
  chip.textContent = sayTable('toTier', { tier: sayTable(TIER_KEY[data.tier]) });
  meta.textContent = `${sayTable('stages', { count: data.stageCount })} · ${data.roadmap.lang.toUpperCase()}${data.spec.example ? ` · ${sayTable('example')}` : ''}`;
  title.textContent = data.roadmap.title;
  title.lang = data.roadmap.lang;
  goal.textContent = data.roadmap.brief.goal ?? data.roadmap.summary ?? '';
  goal.lang = data.roadmap.lang;
  pinLine.textContent =
    data.hereStage >= data.stageCount ? sayTable('pinSummit') : data.hereMinuteShare <= 0 ? sayTable('pinGate') : sayTable('pinStage', { i: data.hereStage + 1 });
  blazes.forEach((button, index) => button.setAttribute('aria-current', String(index === table.selected)));
  counter.replaceChildren(Object.assign(document.createElement('b'), { textContent: String(table.selected + 1).padStart(2, '0') }), ` / ${String(table.count).padStart(2, '0')}`);
}

function writeReadout(parts: ReadoutParts): void {
  hoursNumber.textContent = parts.hoursText;
  line.textContent = parts.line;
  stageTitle.textContent = parts.stage === null ? '' : parts.title;
  stageTitle.lang = parts.lang;
}

table.onSelect(writeSelection);
table.onReadout(writeReadout);
table.onEnter((request) => console.info('enter', request));
writeSelection();
if (table.readout) writeReadout(table.readout);

const world = new Vector3();
function place(node: HTMLElement, name: Parameters<TablePart['anchor']>[0]): void {
  const { width, height } = size();
  table.anchor(name, world).project(stage.camera);
  node.style.transform = `translate(${((world.x + 1) / 2) * width}px, ${((1 - world.y) / 2) * height}px)`;
}

/** When each part of the overlay comes in, in seconds of the intro. */
const ARRIVE: readonly (readonly [HTMLElement, number])[] = [
  [brand, 1.2],
  [copy, 1.2],
  [card, 1.7],
  [count, 2.2],
  [previous, 2.2],
  [next, 2.2],
  [enter, 2.6],
];

function placeOverlay(t: number): void {
  place(previous, 'arrowPrevious');
  place(next, 'arrowNext');
  place(enter, 'enter');
  const intro = introFrom === null ? Infinity : t - introFrom;
  for (const [node, at] of ARRIVE) node.dataset.in = intro >= at ? '1' : '0';
}

// ---------------------------------------------------------------------------------------------------------
// Input.

function setPointer(event: PointerEvent): void {
  const nowMs = performance.now();
  const dt = Math.max(1, nowMs - pointer.lastAt) / 1000;
  pointer.speed = Math.hypot(event.clientX - pointer.lastX, event.clientY - pointer.lastY) / dt;
  pointer.lastX = event.clientX;
  pointer.lastY = event.clientY;
  pointer.lastAt = nowMs;
  pointer.x = event.clientX;
  pointer.y = event.clientY;
  pointer.has = true;
}
canvas.addEventListener('pointermove', (event) => {
  if (event.pointerType === 'mouse') setPointer(event);
});
canvas.addEventListener('pointerleave', () => {
  pointer.has = false;
});
let swipeStart: { x: number; y: number } | null = null;
canvas.addEventListener('pointerdown', (event) => {
  swipeStart = { x: event.clientX, y: event.clientY };
});
canvas.addEventListener('pointerup', (event) => {
  const start = swipeStart;
  swipeStart = null;
  const { width, height } = size();
  if (start) {
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    // A swipe: more than 40 px sideways and more than 1.3 times as far as it went up or down.
    if (Math.abs(dx) > 40 && Math.abs(dx) > 1.3 * Math.abs(dy)) {
      if (dx < 0) table.next();
      else table.previous();
      return;
    }
    if (Math.hypot(dx, dy) > 8) return;
  }
  ndc.set((event.clientX / width) * 2 - 1, 1 - (event.clientY / height) * 2);
  raycaster.setFromCamera(ndc, stage.camera);
  table.click(raycaster.ray);
});
window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  if (event.key === 'ArrowRight') table.next();
  else if (event.key === 'ArrowLeft') table.previous();
  else if (event.key === 'Enter' && document.activeElement === document.body) console.info('enter', { sheet: table.selected, stage: -1 });
  else if (event.key === 'i' || event.key === 'I') {
    table.startIntro();
    introFrom = sceneTime;
  }
});
window.addEventListener('resize', reframe);

// ---------------------------------------------------------------------------------------------------------
// Running: a loop, or stepped time for stills and tests.

interface TableInfo {
  readonly t: number;
  readonly selected: number;
  readonly standing: number;
  readonly grow: number;
  readonly phi: number;
  readonly count: number;
  readonly readout: ReadoutParts | null;
  readonly viewport: { readonly width: number; readonly height: number };
  /** Screen pixels. */
  readonly pin: { readonly x: number; readonly y: number; readonly visible: boolean };
  readonly sheet: readonly { readonly x: number; readonly y: number }[];
  readonly compass: { readonly x: number; readonly y: number; readonly r: number };
  readonly box: { readonly x0: number; readonly x1: number; readonly y0: number; readonly y1: number };
  readonly headline: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };
  /** Height of the lit mountain: in scene units, and of its silhouette on the screen in pixels. */
  readonly mountain: { readonly height: number; readonly silhouette: number };
}

const FRAME = 1 / 60;
let stepped = 0;

function toPixels(point: Vector3): { x: number; y: number } {
  const { width, height } = size();
  point.project(stage.camera);
  return { x: ((point.x + 1) / 2) * width, y: ((1 - point.y) / 2) * height };
}

function info(): TableInfo {
  const { width, height } = size();
  const pin = table.pinScreen(stage.camera);
  const points = table.framePoints();
  const sheet = points.slice(0, 4).map((p) => toPixels(new Vector3(p.x, p.y, p.z)));
  const centre = toPixels(table.anchor('compass', new Vector3()));
  const top = points[8];
  const bottom = points[9];
  const topPx = top ? toPixels(new Vector3(top.x, top.y, top.z)) : centre;
  const bottomPx = bottom ? toPixels(new Vector3(bottom.x, bottom.y, bottom.z)) : centre;
  const shot = heroShot(width, height);
  const head = headline.getBoundingClientRect();
  // The silhouette: from the middle of the lit cover up to the height its mountain has right now, on the screen.
  const foot = table.anchor('sheet', new Vector3());
  const mountainHeight = table.height;
  const peak = toPixels(new Vector3(foot.x, foot.y + mountainHeight, foot.z));
  const silhouette = Math.max(0, toPixels(foot.clone()).y - peak.y);
  return {
    t: sceneTime,
    selected: table.selected,
    standing: table.standing,
    grow: table.grow,
    phi: table.phi,
    count: table.count,
    readout: table.readout,
    viewport: { width, height },
    pin: { x: ((pin.x + 1) / 2) * width, y: ((1 - pin.y) / 2) * height, visible: pin.visible },
    sheet,
    compass: { x: centre.x, y: (topPx.y + bottomPx.y) / 2, r: Math.abs(bottomPx.y - topPx.y) / 2 },
    box: shot.box,
    headline: { left: head.left, top: head.top, right: head.right, bottom: head.bottom },
    mountain: { height: mountainHeight, silhouette },
  };
}

function draw(): void {
  stage.renderer.render(stage.scene, stage.camera);
}

/** Steps the scene by `seconds` at 1/60 s and draws one frame. */
function advance(seconds: number): TableInfo {
  const steps = Math.max(0, Math.round(seconds / FRAME));
  for (let i = 0; i < steps; i += 1) {
    stepped += 1;
    step({ dt: FRAME, t: stepped * FRAME, reduced: isReduced() });
  }
  if (steps === 0) step({ dt: 0, t: stepped * FRAME, reduced: isReduced() });
  draw();
  return info();
}

/** Reads a rectangle of the drawn frame, top-left origin, as RGBA bytes. */
function pixels(x: number, y: number, width: number, height: number): number[] {
  draw();
  const gl = stage.renderer.getContext();
  const ratio = stage.renderer.getPixelRatio();
  const w = Math.max(1, Math.round(width * ratio));
  const h = Math.max(1, Math.round(height * ratio));
  const out = new Uint8Array(w * h * 4);
  gl.readPixels(Math.round(x * ratio), Math.round(gl.drawingBufferHeight - (y + height) * ratio), w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
  return Array.from(out);
}

/** A checksum of the drawn frame, to tell whether two frames are the same picture. */
function hash(): number {
  draw();
  const gl = stage.renderer.getContext();
  const out = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
  gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, out);
  let value = 0x811c9dc5;
  for (let i = 0; i < out.length; i += 1) value = Math.imul(value ^ (out[i] as number), 0x01000193);
  return value >>> 0;
}

/** The name of the graphics renderer, to tell a software renderer from a GPU. */
function rendererName(): string {
  const gl = stage.renderer.getContext();
  const extension = gl.getExtension('WEBGL_debug_renderer_info');
  return String(extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
}

/**
 * Milliseconds one frame takes: the mean of a few updates and draws. One pixel is read back after every draw,
 * because that is the only call that waits until the frame is really drawn.
 */
function frameMs(frames = 6): number {
  const gl = stage.renderer.getContext();
  const one = new Uint8Array(4);
  const from = performance.now();
  for (let i = 0; i < frames; i += 1) {
    stepped += 1;
    step({ dt: FRAME, t: stepped * FRAME, reduced: isReduced() });
    draw();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one);
  }
  return (performance.now() - from) / frames;
}

const api = {
  ready: Promise.resolve() as Promise<void>,
  table,
  info,
  advance,
  pixels,
  hash,
  rendererName,
  frameMs,
  heights: () => Array.from({ length: table.count }, (_, index) => table.heightOf(index)),
  select: (index: number) => table.select(index),
  next: () => table.next(),
  previous: () => table.previous(),
  exit: (hx: number) => table.setExit(hx),
  pointer: (x: number | null, y: number | null, speed = 0) => {
    if (x === null || y === null) pointer.has = false;
    else {
      pointer.x = x;
      pointer.y = y;
      pointer.speed = speed;
      pointer.has = true;
    }
  },
  hit: () => hit,
};
declare global {
  interface Window {
    __table: typeof api;
  }
}
window.__table = api;

async function boot(): Promise<void> {
  // Covers are printed twice: at once in whatever face is there, and again when the real faces have arrived.
  const titles = sheetSpecs.map((spec) => spec.roadmap.title).join(' ');
  await loadFonts({ text: titles });
  table.repaint();
  reframe();
  if (params.has('hx')) table.setExit(numberOf('hx', 0));

  if (still) {
    const picks = (params.get('pick') ?? '')
      .split(',')
      .map((item) => item.split('@').map(Number))
      .filter((pair): pair is [number, number] => pair.length === 2 && pair.every(Number.isFinite))
      .sort((a, b) => a[1] - b[1]);
    let at = 0;
    for (const [index, when] of picks) {
      if (when > stillTime) break;
      advance(when - at);
      at = when;
      table.select(index);
    }
    advance(stillTime - at);
  } else {
    stage.onFrame(step);
    stage.start();
  }
  document.documentElement.dataset.table = 'ready';
}

api.ready = boot();
