/**
 * Dev page for the overlay: the whole interface over a stand-in for the scene, with a real learning session on a
 * sample roadmap. A small director made for this page answers the overlay's requests, so every control can be
 * tried without the 3D scene.
 *
 * URL parameters:
 *   ?mode=table|walk|list   the view to start in (default table)
 *   ?road=<sample id>       the roadmap in slot 0 (default rust-for-a-python-dev)
 *   ?gallery=1              slot 0 is an example too, so the headline is the site's own line
 *   ?select=<i>             the roadmap in the light, counted from 0
 *   ?done=<n>               the first n steps are done and rated
 *   ?today=YYYY-MM-DD       the clock (default: three weeks after the roadmap's start date)
 *   ?p=<0..1>               where the walker is along the route (walk)
 *   ?item=signpost|camp|review   what the note shows instead of the step under the walker
 *   ?tab=note|do|take       the note's tab
 *   ?side=left|right        hang the note at a side instead of picking the emptier one
 *   ?sheet=1                phone: the note pulled up
 *   ?panel=shortcuts|share|open|notebook|pace|preview   a panel to open
 *   ?hover=<card>           a readout as if that contour card were under the pointer (table)
 *   ?ui=de                  interface language
 *   ?intro=1                play the entrance of the table
 *   ?motion=reduced         reduced motion
 *   ?bg=<url>, ?bgwalk=<url>   a picture of the real scene behind the overlay
 *   ?storage=local          keep progress in this browser (default: memory, so every load starts the same)
 *   ?still=1                no dev controls, for screenshots
 *
 * Keys are the overlay's own (section 7.4). `window.__hud` holds the overlay, the session and the fake director.
 */
import { setUiLang, uiLang } from '../src/i18n';
import { createRoomOverlays } from '../src/look/dom';
import { formatHours, formatNumber, roundHours } from '../src/look/format';
import { THEME, mix } from '../src/look/theme';
import { injectTokens } from '../src/look/tokens';
import { loadFonts } from '../src/look/type';
import { createSession, type Session } from '../src/learn';
import { addDays } from '../src/roadmap/dates';
import { deriveTrek, type Trek } from '../src/roadmap/derive';
import deutsch from '../src/roadmap/samples/deutsch-a1-von-null.json';
import langgraph from '../src/roadmap/samples/langgraph-for-a-python-dev.json';
import music from '../src/roadmap/samples/music-theory-for-a-class.json';
import photo from '../src/roadmap/samples/photography-basics.json';
import rust from '../src/roadmap/samples/rust-for-a-python-dev.json';
import stats from '../src/roadmap/samples/statistics-for-data-work.json';
import type { Roadmap } from '../src/roadmap/types';
import { say as sayTable, tierKey as tableTierKey } from '../src/table/strings';
import type { ReadoutParts } from '../src/table/readout';
import {
  createHud,
  createHudBus,
  type HudEvent,
  type HudItem,
  type HudMode,
  type HudPoint,
  type HudRoadmap,
  type MiniMapMark,
  type NoteSide,
  type NoteTab,
  type WeightedPoint,
} from '../src/hud';

const params = new URLSearchParams(location.search);
const flag = (name: string): boolean => params.has(name) && params.get(name) !== '0';
const still = flag('still');
const reduced = params.get('motion') === 'reduced';
document.body.classList.toggle('still', still);
if (params.get('ui') === 'de' || params.get('ui') === 'en') setUiLang(params.get('ui') as 'de' | 'en', false);
document.documentElement.lang = uiLang();
injectTokens();

// ---- Roadmaps on the table
const SAMPLES = [rust, langgraph, deutsch, photo, stats, music] as unknown as Roadmap[];
const wanted = params.get('road');
const first = SAMPLES.find((r) => r.id === wanted) ?? (SAMPLES[0] as Roadmap);
const others = SAMPLES.filter((r) => r !== first).slice(0, 4);

const today = params.get('today') ?? addDays(first.brief.startDate ?? '2026-11-16', 21);
const openSession = (roadmap: Roadmap): Session =>
  createSession(roadmap, params.get('storage') === 'local' ? undefined : null, { clock: () => today, saveOnPageHide: params.get('storage') === 'local' });

let session = openSession(first);
const doneCount = Math.max(0, Number(params.get('done') ?? 0) || 0);
session.trek.waypoints.slice(0, doneCount).forEach((wp, i) => {
  session.done(wp.id, true);
  session.rate(wp.id, ((i % 3) + 2) as 2 | 3 | 4);
});

let list: HudRoadmap[] = [{ roadmap: first, example: flag('gallery') }, ...others.map((roadmap) => ({ roadmap, example: true }))];
let selected = Math.max(0, Math.min(list.length - 1, Number(params.get('select') ?? 0) || 0));

// ---- The page
const backdrop = document.getElementById('backdrop') as HTMLCanvasElement;
const picture = document.getElementById('picture') as HTMLImageElement;
const outline = document.getElementById('zt-outline') as HTMLElement;
const overlays = createRoomOverlays(document, { scrim: true });
document.body.insertBefore(overlays, outline);
const root = document.getElementById('hud') as HTMLElement;

const bus = createHudBus();
const hud = createHud(root, session, bus, {
  ...(reduced ? { reducedMotion: true } : {}),
  intro: flag('intro'),
});

// ---- The walk, faked: every item of the route in order, each with its share of the route.
interface RouteItem {
  readonly item: Exclude<HudItem, null>;
  readonly from: number;
  readonly to: number;
  readonly stage: number;
}

function routeItems(roadmap: Roadmap, trek: Trek): RouteItem[] {
  const out: RouteItem[] = [];
  roadmap.stages.forEach((stage, stageIndex) => {
    const ts = trek.stages[stageIndex];
    if (!ts || trek.totalMinutes <= 0) return;
    const a0 = ts.startMinute / trek.totalMinutes;
    const a1 = ts.endMinute / trek.totalMinutes;
    const span = a1 - a0;
    // 88 percent of a stage belongs to its steps, 7 to the signpost and 5 to the camp.
    let minute = 0;
    for (const wp of stage.waypoints) {
      const from = a0 + span * 0.88 * (minute / Math.max(1, ts.minutes));
      minute += wp.minutes;
      const to = a0 + span * 0.88 * (minute / Math.max(1, ts.minutes));
      out.push({ item: { kind: 'waypoint', waypointId: wp.id }, from, to, stage: stageIndex });
    }
    const campFrom = stage.project ? a0 + span * 0.95 : a1;
    out.push({ item: { kind: 'signpost', stageId: stage.id }, from: a0 + span * 0.88, to: campFrom, stage: stageIndex });
    if (stage.project) out.push({ item: { kind: 'camp', stageId: stage.id }, from: campFrom, to: a1, stage: stageIndex });
  });
  return out;
}

let items = routeItems(session.roadmap, session.trek);
let along = Math.max(0, Math.min(1, Number(params.get('p') ?? 0.3) || 0));
let mode: HudMode = (['table', 'walk', 'list'] as const).find((m) => m === params.get('mode')) ?? 'table';
const forcedSide = params.get('side') === 'left' || params.get('side') === 'right' ? (params.get('side') as NoteSide) : null;
const forcedItem = params.get('item');

const itemAt = (value: number): RouteItem | null => items.find((entry) => value >= entry.from && value < entry.to) ?? items[items.length - 1] ?? null;

/** Where the fake walker stands on screen: he crosses the lit panel from left to right, a little uphill. */
function walkerScreen(entry: RouteItem | null): HudPoint {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const mine = entry ? items.filter((e) => e.stage === entry.stage) : [];
  const a0 = mine[0]?.from ?? 0;
  const a1 = mine[mine.length - 1]?.to ?? 1;
  const f = a1 > a0 ? (along - a0) / (a1 - a0) : 0;
  const narrow = w <= 760;
  return narrow ? { x: w * (0.22 + 0.56 * f), y: h * (0.5 - 0.06 * f) } : { x: w * (0.34 + 0.36 * f), y: h * (0.62 - 0.1 * f) };
}

// ---- Stand-in scene
const ctx = backdrop.getContext('2d') as CanvasRenderingContext2D;

function ellipse(x: number, y: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
}

function paintTable(w: number, h: number): void {
  const entry = list[selected] as HudRoadmap;
  const tier = entry.roadmap.brief.targetTier;
  const narrow = w <= 760;
  ctx.fillStyle = THEME.night;
  ctx.fillRect(0, 0, w, h);
  // The turntable under one lamp.
  const cx = w * 0.5;
  const cy = h * (narrow ? 0.8 : 0.86);
  const rx = w * (narrow ? 0.95 : 0.62);
  const ry = h * (narrow ? 0.34 : 0.56);
  const wood = ctx.createRadialGradient(cx, h * 0.74, 10, cx, cy, rx);
  wood.addColorStop(0, mix(THEME.walnut, THEME.lampLight, 0.28));
  wood.addColorStop(0.3, THEME.walnut);
  wood.addColorStop(0.75, THEME.walnutDeep);
  wood.addColorStop(1, '#0c0907');
  ctx.fillStyle = wood;
  ellipse(cx, cy, rx, ry);
  ctx.fill();
  ctx.strokeStyle = 'rgba(7, 5, 4, 0.9)';
  ctx.lineWidth = 2;
  ellipse(cx, cy, rx * 0.955, ry * 0.955);
  ctx.stroke();
  // Sheets in the shade, left and right.
  const sheet = (x: number, y: number, sw: number, sh: number, skew: number, colour: string, alpha: number): void => {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(x + skew, y);
    ctx.lineTo(x + sw + skew * 0.4, y + sh * 0.08);
    ctx.lineTo(x + sw, y + sh);
    ctx.lineTo(x - skew * 0.3, y + sh * 0.9);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };
  if (!narrow) {
    sheet(w * 0.09, h * 0.62, w * 0.2, h * 0.3, w * 0.03, THEME.cover.diamond, 0.22);
    sheet(w * 0.66, h * 0.6, w * 0.2, h * 0.28, -w * 0.02, THEME.cover.bronze, 0.2);
  }
  // The compass floats over the middle.
  const compassY = h * (narrow ? 0.42 : 0.36);
  const compassR = Math.min(w, h) * (narrow ? 0.13 : 0.14);
  const glow = ctx.createRadialGradient(cx, compassY, compassR * 0.4, cx, compassY, compassR * 2.4);
  glow.addColorStop(0, 'rgba(255, 217, 160, 0.22)');
  glow.addColorStop(1, 'rgba(255, 217, 160, 0)');
  ctx.fillStyle = glow;
  ellipse(cx, compassY, compassR * 2.4, compassR * 2.4);
  ctx.fill();
  ctx.strokeStyle = THEME.brass;
  ctx.lineWidth = Math.max(3, compassR * 0.09);
  ellipse(cx, compassY, compassR, compassR * 0.82);
  ctx.stroke();
  ctx.fillStyle = mix(THEME.paperHi, THEME.brass, 0.15);
  ellipse(cx, compassY, compassR * 0.72, compassR * 0.6);
  ctx.fill();
  // The sheet in the light, with a few contour cards.
  const sw = w * (narrow ? 0.6 : 0.26);
  const sx = cx - sw / 2;
  const sy = h * (narrow ? 0.56 : 0.64);
  const sh = h * (narrow ? 0.22 : 0.34);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(sx + 8, sy + 14, sw, sh);
  sheet(sx, sy, sw, sh, sw * 0.03, THEME.cover[tier], 1);
  for (let i = 0; i < 7; i++) {
    ctx.fillStyle = i % 2 ? THEME.card : THEME.paper;
    ctx.strokeStyle = 'rgba(31, 42, 61, 0.35)';
    ctx.lineWidth = 1;
    ellipse(cx + i * 3, sy + sh * 0.55 - i * sh * 0.035, sw * (0.4 - i * 0.045), sh * (0.34 - i * 0.04));
    ctx.fill();
    ctx.stroke();
  }
}

function paintWalk(w: number, h: number, walker: HudPoint): void {
  const narrow = w <= 760;
  ctx.fillStyle = THEME.night;
  ctx.fillRect(0, 0, w, h);
  const top = h * (narrow ? 0.3 : 0.36);
  const bottom = h * (narrow ? 0.66 : 0.84);
  const panel = (x0: number, x1: number, lit: boolean): void => {
    const lean = (x1 - x0) * 0.16;
    const paper = ctx.createLinearGradient(0, top, 0, bottom);
    paper.addColorStop(0, lit ? THEME.paperShade : '#5c5a57');
    paper.addColorStop(1, lit ? THEME.paperHi : '#77736d');
    ctx.fillStyle = paper;
    ctx.beginPath();
    ctx.moveTo(x0 + lean, top);
    ctx.lineTo(x1 + lean, top);
    ctx.lineTo(x1, bottom);
    ctx.lineTo(x0, bottom);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(31, 42, 61, 0.14)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 9; i++) {
      ctx.beginPath();
      const yy = top + ((bottom - top) * i) / 9;
      ctx.moveTo(x0 + lean * (1 - i / 9), yy);
      ctx.bezierCurveTo(x0 + (x1 - x0) * 0.3, yy - 18, x0 + (x1 - x0) * 0.7, yy + 16, x1 + lean * (1 - i / 9), yy - 4);
      ctx.stroke();
    }
  };
  panel(-w * 0.3, w * (narrow ? 0.08 : 0.2), false);
  panel(w * (narrow ? 0.1 : 0.22), w * (narrow ? 0.9 : 0.78), true);
  panel(w * (narrow ? 0.92 : 0.8), w * 1.3, false);
  // The route: walked part solid, the rest dashed.
  const x0 = narrow ? w * 0.22 : w * 0.34;
  const x1 = narrow ? w * 0.78 : w * 0.7;
  const yOf = (x: number): number => walker.y + (narrow ? -0.06 : -0.1) * h * ((x - walker.x) / (x1 - x0));
  ctx.strokeStyle = THEME.signal;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x0 - w * 0.08, yOf(x0 - w * 0.08));
  ctx.lineTo(walker.x, walker.y);
  ctx.stroke();
  ctx.setLineDash([9, 7]);
  ctx.beginPath();
  ctx.moveTo(walker.x, walker.y);
  ctx.lineTo(x1 + w * 0.08, yOf(x1 + w * 0.08));
  ctx.stroke();
  ctx.setLineDash([]);
  // The walker: a small dark figure with a stick.
  ctx.fillStyle = THEME.ink;
  ctx.beginPath();
  ctx.arc(walker.x, walker.y - 34, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(walker.x - 4, walker.y - 29, 8, 18);
  ctx.fillRect(walker.x - 4, walker.y - 12, 3, 12);
  ctx.fillRect(walker.x + 1, walker.y - 12, 3, 12);
  ctx.strokeStyle = THEME.ink;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(walker.x + 9, walker.y - 26);
  ctx.lineTo(walker.x + 12, walker.y);
  ctx.stroke();
}

function paintBackdrop(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const scale = Math.min(2, window.devicePixelRatio || 1);
  if (backdrop.width !== Math.round(w * scale) || backdrop.height !== Math.round(h * scale)) {
    backdrop.width = Math.round(w * scale);
    backdrop.height = Math.round(h * scale);
  }
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const source = mode === 'walk' ? params.get('bgwalk') : params.get('bg');
  picture.hidden = !source || mode === 'list';
  if (source && picture.getAttribute('src') !== source) picture.src = source;
  // The picture was taken with the sheet in the middle. The overlay expects it clear of the shelf, as the
  // director will frame it, so the picture is moved by the same amount.
  const stageX = w <= 760 ? w / 2 : Math.min(w / 2, w - 46 - 380 - 50 - 0.153 * w);
  picture.style.transform = mode === 'table' ? `translateX(${Math.round(stageX - w / 2)}px)` : '';
  outline.hidden = mode !== 'list';
  overlays.hidden = mode === 'list';
  (overlays.querySelector('.zt-scrim') as HTMLElement).hidden = mode !== 'table';
  if (mode === 'walk') paintWalk(w, h, walkerScreen(itemAt(along)));
  else paintTable(w, h);
}

// ---- Mini map, drawn here in place of the walk's own
const maps = new Map<number, { base: HTMLCanvasElement; marks: MiniMapMark[]; curve: (f: number) => HudPoint }>();

function miniMap(stageIndex: number): { base: HTMLCanvasElement; marks: MiniMapMark[]; curve: (f: number) => HudPoint } {
  const cached = maps.get(stageIndex);
  if (cached) return cached;
  const W = 560;
  const H = 300;
  const base = document.createElement('canvas');
  base.width = W;
  base.height = H;
  const c = base.getContext('2d') as CanvasRenderingContext2D;
  c.fillStyle = THEME.card;
  c.fillRect(0, 0, W, H);
  // Contours: rings round two hills, every fifth one stronger.
  const hills = [
    { x: W * (0.3 + 0.07 * stageIndex), y: H * 0.36, r: 150 },
    { x: W * 0.78, y: H * (0.7 - 0.05 * stageIndex), r: 120 },
  ];
  hills.forEach((hill, hi) => {
    for (let i = 1; i <= 10; i++) {
      c.strokeStyle = `rgba(31, 42, 61, ${i % 5 === 0 ? 0.34 : 0.16})`;
      c.lineWidth = 1;
      c.beginPath();
      for (let a = 0; a <= 64; a++) {
        const angle = (a / 64) * Math.PI * 2;
        const wobble = 1 + 0.12 * Math.sin(angle * 3 + i * 0.6 + hi) + 0.06 * Math.sin(angle * 7 + stageIndex);
        const r = (hill.r * i * wobble) / 10;
        const px = hill.x + Math.cos(angle) * r * 1.3;
        const py = hill.y + Math.sin(angle) * r * 0.8;
        if (a === 0) c.moveTo(px, py);
        else c.lineTo(px, py);
      }
      c.closePath();
      c.stroke();
    }
  });
  const curve = (f: number): HudPoint => ({
    x: W * (0.07 + 0.86 * f),
    y: H * (0.74 - 0.42 * f) + Math.sin(f * Math.PI * 2.2 + stageIndex) * H * 0.09,
  });
  c.strokeStyle = 'rgba(226, 73, 47, 0.55)';
  c.lineWidth = 2.5;
  c.setLineDash([8, 6]);
  c.beginPath();
  for (let i = 0; i <= 60; i++) {
    const point = curve(i / 60);
    if (i === 0) c.moveTo(point.x, point.y);
    else c.lineTo(point.x, point.y);
  }
  c.stroke();
  c.setLineDash([]);
  const mine = items.filter((entry) => entry.stage === stageIndex);
  const a0 = mine[0]?.from ?? 0;
  const a1 = mine[mine.length - 1]?.to ?? 1;
  const marks: MiniMapMark[] = [];
  c.font = `400 13px ${getComputedStyle(document.documentElement).getPropertyValue('--zt-font-label') || 'monospace'}`;
  mine.forEach((entry, i) => {
    if (entry.item.kind !== 'waypoint') return;
    const id = entry.item.waypointId;
    const point = curve(((entry.from + entry.to) / 2 - a0) / (a1 - a0));
    const title = session.roadmap.stages[stageIndex]?.waypoints.find((w) => w.id === id)?.title ?? id;
    c.fillStyle = THEME.ink;
    c.beginPath();
    c.arc(point.x, point.y, 4, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = 'rgba(31, 42, 61, 0.82)';
    const label = title.length > 22 ? `${title.slice(0, 21)}…` : title;
    c.fillText(label, Math.min(point.x + 9, W - c.measureText(label).width - 6), point.y + (i % 2 ? 20 : -10));
    marks.push({ id, x: point.x, y: point.y, title });
  });
  // North.
  c.strokeStyle = THEME.ink;
  c.fillStyle = THEME.ink;
  c.lineWidth = 1.5;
  c.beginPath();
  c.moveTo(W - 26, 46);
  c.lineTo(W - 26, 16);
  c.stroke();
  c.beginPath();
  c.moveTo(W - 26, 10);
  c.lineTo(W - 31, 22);
  c.lineTo(W - 21, 22);
  c.closePath();
  c.fill();
  const built = { base, marks, curve };
  maps.set(stageIndex, built);
  return built;
}

// ---- The readout, faked: the hours count up as if the mountain grew.
function readout(grow: number, hoverCard: number | null): ReadoutParts {
  const entry = list[selected] as HudRoadmap;
  const trek = deriveTrek(entry.roadmap);
  const lang = uiLang();
  const cards = [12, 16, 20, 24][['bronze', 'silver', 'gold', 'diamond'].indexOf(entry.roadmap.brief.targetTier)] ?? 16;
  const hours = roundHours(trek.totalMinutes * grow);
  const hoursText = formatNumber(hours, { lang, fraction: 1 });
  let line: string;
  let title = entry.roadmap.title;
  let stage: number | null = null;
  if (hoverCard !== null) {
    stage = Math.min(trek.stages.length, Math.max(1, Math.ceil((hoverCard / cards) * trek.stages.length)));
    const ts = trek.stages[stage - 1];
    line = [
      sayTable('cardOf', { k: hoverCard, n: cards }),
      sayTable('stage', { i: stage }),
      ts ? sayTable(tableTierKey(ts.tier)) : '',
      ts ? formatHours(ts.minutes) : '',
    ].join(' · ');
    title = ts?.title ?? title;
  } else {
    line = [
      sayTable('cards', { count: cards }),
      sayTable('stages', { count: trek.stages.length }),
      sayTable('toTier', { tier: sayTable(tableTierKey(entry.roadmap.brief.targetTier)) }),
    ].join(' · ');
  }
  return {
    sheet: selected,
    hours,
    hoursText,
    totalHours: roundHours(trek.totalMinutes),
    card: hoverCard,
    cards,
    stage,
    stages: trek.stages.length,
    tier: stage ? (trek.stages[stage - 1]?.tier ?? null) : null,
    line,
    title,
    lang: entry.roadmap.lang,
    key: `${selected}|${hoursText}|${line}|${title}`,
  };
}

let growTimer = 0;
function growReadout(): void {
  cancelAnimationFrame(growTimer);
  const hover = params.has('hover') ? Number(params.get('hover')) : null;
  if (reduced || still) {
    hud.setReadout(readout(1, hover));
    return;
  }
  const started = performance.now();
  const step = (): void => {
    const t = Math.min(1, (performance.now() - started) / 1250);
    const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    hud.setReadout(readout(eased, t >= 1 ? hover : null));
    if (t < 1) growTimer = requestAnimationFrame(step);
  };
  growTimer = requestAnimationFrame(step);
}

// ---- The fake director
function syncWalk(): void {
  const entry = itemAt(along);
  const screen = walkerScreen(entry);
  hud.setWalker(along, screen);
  let item: HudItem = entry?.item ?? null;
  if (forcedItem === 'signpost' || forcedItem === 'camp') {
    const stage = session.roadmap.stages[entry?.stage ?? 0];
    if (stage) item = forcedItem === 'camp' && stage.project ? { kind: 'camp', stageId: stage.id } : { kind: 'signpost', stageId: stage.id };
  } else if (forcedItem === 'review') {
    item = { kind: 'review', waypointId: null };
  }
  hud.setActive(item);
  if (entry) {
    const map = miniMap(entry.stage);
    const mine = items.filter((e) => e.stage === entry.stage);
    const a0 = mine[0]?.from ?? 0;
    const a1 = mine[mine.length - 1]?.to ?? 1;
    hud.setMiniMap(map.base, map.curve(a1 > a0 ? (along - a0) / (a1 - a0) : 0), map.marks);
  }
  if (forcedSide) {
    hud.placeNote(forcedSide);
  } else {
    // What the settled camera would show: the route across the panel, a sign near its start.
    const w = window.innerWidth;
    const h = window.innerHeight;
    const points: WeightedPoint[] = [{ x: w * 0.3, y: h * 0.58, weight: 40 }];
    for (let i = 0; i <= 10; i++) points.push({ x: w * (0.26 + 0.5 * (i / 10)), y: h * (0.64 - 0.12 * (i / 10)), weight: 6 });
    hud.placeNoteBy(points);
  }
  if (mode === 'walk') paintBackdrop();
  scrub.value = String(Math.round(along * 1000));
}

function setMode(next: HudMode): void {
  mode = next;
  hud.setMode(next);
  paintBackdrop();
  if (next === 'walk') syncWalk();
  for (const button of modeButtons) button.setAttribute('aria-pressed', button.dataset.mode === next ? 'true' : 'false');
  log(`mode ${next}`);
}

function select(index: number): void {
  selected = (index + list.length) % list.length;
  hud.select(selected);
  paintBackdrop();
  growReadout();
}

const logLine = document.createElement('span');
function log(text: string): void {
  logLine.textContent = text;
  document.documentElement.dataset.last = text;
}

function goToItem(match: (entry: RouteItem) => boolean): void {
  const found = items.find(match);
  if (!found) return;
  along = found.from + (found.to - found.from) * 0.5;
  syncWalk();
}

bus.on((event: HudEvent) => {
  if (event.type !== 'insets') log(event.type);
  switch (event.type) {
    case 'turn':
      select(selected + event.step);
      break;
    case 'enter': {
      const entry = list[selected] as HudRoadmap;
      if (entry.roadmap.id !== session.roadmap.id) {
        session = openSession(entry.roadmap);
        hud.setSession(session);
        items = routeItems(session.roadmap, session.trek);
        maps.clear();
      }
      const here = session.here();
      setMode('walk');
      if (here) goToItem((e) => e.item.kind === 'waypoint' && e.item.waypointId === here.waypointId);
      break;
    }
    case 'fold':
    case 'home':
      setMode('table');
      break;
    case 'mode':
      setMode(event.mode);
      break;
    case 'seek':
      along = event.along;
      syncWalk();
      break;
    case 'go':
      if (event.waypointId) goToItem((e) => e.item.kind === 'waypoint' && e.item.waypointId === event.waypointId);
      else if (event.stageId) goToItem((e) => e.item.kind !== 'waypoint' && e.item.kind !== 'review' && e.item.stageId === event.stageId);
      break;
    case 'step': {
      const at = items.findIndex((entry) => entry === itemAt(along));
      const to = items[Math.max(0, Math.min(items.length - 1, at + event.step))];
      if (to) {
        along = to.from + (to.to - to.from) * 0.5;
        syncWalk();
      }
      break;
    }
    case 'open':
      list = [{ roadmap: event.roadmap }, ...list.filter((entry) => entry.roadmap.id !== event.roadmap.id)].slice(0, 5);
      selected = 0;
      hud.setRoadmaps(list, selected);
      paintBackdrop();
      growReadout();
      break;
    default:
      break;
  }
});

// ---- Dev controls, hung where the section tabs will hang
const strip = document.createElement('div');
strip.className = 'dev-strip';
const modeButtons = (['table', 'walk', 'list'] as const).map((name) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = name;
  button.dataset.mode = name;
  button.addEventListener('click', () => setMode(name));
  return button;
});
const scrub = document.createElement('input');
scrub.type = 'range';
scrub.min = '0';
scrub.max = '1000';
scrub.setAttribute('aria-label', 'Walker along the route');
scrub.addEventListener('input', () => {
  along = Number(scrub.value) / 1000;
  if (mode === 'walk') syncWalk();
});
const langButton = document.createElement('button');
langButton.type = 'button';
langButton.textContent = uiLang() === 'de' ? 'EN' : 'DE';
langButton.addEventListener('click', () => {
  setUiLang(uiLang() === 'de' ? 'en' : 'de', false);
  document.documentElement.lang = uiLang();
  langButton.textContent = uiLang() === 'de' ? 'EN' : 'DE';
  growReadout();
});
strip.append(...modeButtons, scrub, langButton, logLine);
hud.navSlot.append(strip);

outline.append(
  Object.assign(document.createElement('h1'), { textContent: first.title }),
  ...first.stages.flatMap((stage) => {
    const steps = document.createElement('ol');
    for (const wp of stage.waypoints) steps.append(Object.assign(document.createElement('li'), { textContent: wp.title }));
    return [Object.assign(document.createElement('h2'), { textContent: stage.title }), steps];
  }),
);

// ---- Start
hud.setRoadmaps(list, selected);
setMode(mode);
growReadout();

const tab = params.get('tab');
if (tab === 'note' || tab === 'do' || tab === 'take') hud.note.setTab(tab as NoteTab);
if (flag('sheet')) hud.note.setExpanded(true);

window.addEventListener('resize', () => {
  paintBackdrop();
  if (mode === 'walk') syncWalk();
});

let last = 0;
function loop(now: number): void {
  if (now - last > 30) {
    last = now;
    hud.frame(now / 1000);
  }
  requestAnimationFrame(loop);
}
if (!reduced && !still) requestAnimationFrame(loop);

void loadFonts({ text: list.map((entry) => entry.roadmap.title).join(' ') }).then(() => {
  maps.clear();
  if (mode === 'walk') syncWalk();
  if (flag('intro')) hud.playIntro();
  const panel = params.get('panel');
  if (panel === 'preview') hud.preview(others[0] as Roadmap, 'link');
  else if (panel === 'shortcuts' || panel === 'share' || panel === 'open' || panel === 'notebook' || panel === 'pace') hud.openPanel(panel);
  document.documentElement.dataset.hud = 'ready';
});

Object.assign(window, {
  __hud: {
    hud,
    bus,
    get session() {
      return session;
    },
    setMode,
    select,
    seek(value: number) {
      along = value;
      syncWalk();
    },
    insets: () => hud.setInsets(),
    /** Where the fake walker stands on screen right now. */
    walker: () => walkerScreen(itemAt(along)),
  },
});
