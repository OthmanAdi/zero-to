/**
 * The director: it puts every part on one page and keeps them in step.
 *
 * It owns the mode (table, dive, walk, list), the scroll and its one progress spring, the camera on the table,
 * through the dive and along the walk's rail, the red guard over the cut, where a roadmap is loaded from, which
 * roadmaps lie on the table, and the build queue. The parts never talk to each other: the table, the walk, the
 * overlay, the sections and the outline all hear from here, and all learning state lives in one session.
 */
import { Color, Fog, Raycaster, Vector2, Vector3, WebGLRenderTarget, type Light, type Object3D } from 'three';
import { onUiLang, setUiLang, uiLang, type UiLang } from '../i18n';
import { createHud, createHudBus, itemKey, readFileText, readLink, type Hud, type HudEvent, type HudItem, type HudRoadmap } from '../hud';
import { createSession, memoryStorage, progressKey, type Session, type StorageLike } from '../learn';
import { createRoomOverlays } from '../look/dom';
import { formatDay, formatHours } from '../look/format';
import { THEME, hexToRgb } from '../look/theme';
import { injectTokens } from '../look/tokens';
import { loadFonts } from '../look/type';
import { anchor, findOutline, hydrateOutline, printView, renderOutline, setNoindex, type HydratedOutline } from '../outline';
import { critDamp, easeInOutCubic, lerp, seg, smooth, spring, type CameraPose } from '../paper/motion';
import { loadProgressOrEmpty, type Progress } from '../roadmap/progress';
import { kelvinToHex, resolveTheme } from '../roadmap/themes';
import type { Roadmap } from '../roadmap/types';
import type { FrameTime } from '../scene/contract';
import { canUseWebGL, createStage, type Stage } from '../scene/stage';
import type { Sections } from '../sections';
import { HERO_CAMERA, INTRO, PIN, createHeroCamera, createTable, deriveSheet, isNarrow, sheetScale, type SheetSpec, type TablePart } from '../table';
import type { WalkItem, WalkPart } from '../walk';
import { createLibrary, tableEntries, type TableEntry } from './library';
import { ROADMAP_ELEMENT_ID, RECEIPT_ELEMENT_ID, issueLines, pickSource, readDebug, readReceipt, readRoadmapText, readRoadmapValue } from './load';
import { createModeMachine, isLocked, viewOf, type Mode, type View } from './modes';
import { createBuildQueue } from './queue';
import { say } from './strings';
import {
  DIVE,
  FINALE,
  RETURN,
  SCROLL,
  WALK_TOP,
  divePose,
  finaleOpacity,
  foldAt,
  guardOpacity,
  hxAt,
  isFinale,
  landingHandover,
  landingShare,
  mixPose,
  nearPlane,
  returnAt,
  stretchViewports,
  walkProgressAt,
  walkScrollFor,
} from './timeline';
import './app.css';

/** The gallery, in the order its sheets lie on the table. */
const GALLERY_ORDER = ['photography-basics', 'rust-for-a-python-dev', 'deutsch-a1-von-null', 'music-theory-for-a-class', 'statistics-for-data-work', 'langgraph-for-a-python-dev'];
const SHEETS = 5;
/** The walker has arrived when the smoothed progress is this close to where the scroll is. */
const NOTE_ARRIVED = 0.003;
/** Seconds into the intro at which the side card arrives. */
const SIDE_AT = 2.05;
const ZERO: FrameTime = { dt: 0, t: 0, reduced: false };

interface Info {
  readonly mode: Mode;
  /** Every mode the page has been in, oldest first. */
  readonly history: readonly Mode[];
  readonly view: View;
  readonly hx: number;
  readonly p: number;
  readonly selected: number;
  readonly roadmap: string;
  readonly lang: UiLang;
  readonly scrollY: number;
  readonly away: boolean;
  readonly walkReady: boolean;
  readonly intro: number | null;
  readonly here: { readonly stageId: string; readonly waypointId: string } | null;
  readonly sheet: { readonly share: number; readonly hereMinuteShare: number; readonly hereStage: number; readonly seed: string; readonly terrain: string; readonly trail: string; readonly grow: number } | null;
  readonly walker: { readonly along: number; readonly item: string; readonly panel: number; readonly shown: boolean } | null;
  readonly walkHere: number | null;
  readonly guard: number;
  readonly pin: { readonly x: number; readonly y: number; readonly visible: boolean } | null;
}

declare global {
  interface Window {
    __zt?: {
      readonly ready: boolean;
      info(): Info;
      /** Steps the page by hand at 1/60 s and draws one frame. */
      advance(seconds: number): Info;
      readonly session: Session;
      readonly table: TablePart | null;
      readonly walk: WalkPart | null;
      readonly hud: Hud;
      readonly sections: Sections | null;
    };
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  node.append(...children);
  return node;
}

function saveFile(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = el('a', { href: url, download: name, hidden: '' });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function toHudItem(item: WalkItem | null): HudItem {
  if (!item) return null;
  if (item.kind === 'waypoint') return { kind: 'waypoint', waypointId: item.waypointId };
  return { kind: item.kind, stageId: item.stageId };
}

export async function boot(): Promise<void> {
  const html = document.documentElement;
  const debug = readDebug(location.search);
  const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const isReduced = (): boolean => debug.reduced || reducedQuery.matches;
  const touch = window.matchMedia('(pointer: coarse)').matches;
  const fixed = debug.still || debug.hx !== null;

  injectTokens();
  html.classList.add('zt-app');
  html.lang = uiLang();
  if (debug.reduced) html.dataset.ztMotion = 'reduced';
  try {
    history.scrollRestoration = 'manual';
  } catch {
    // A sandboxed page may not set it. The page scrolls to its top by itself below.
  }

  // -------------------------------------------------------------------------------------------------------
  // The page's own elements.

  const layer = el('div', { id: 'zt-layer' });
  const guard = el('div', { id: 'zt-guard', 'aria-hidden': 'true' });
  const curtain = el('div', { id: 'zt-curtain', 'aria-hidden': 'true' });
  const drop = el('div', { id: 'zt-drop', 'aria-hidden': 'true' });
  const toastHost = el('div', { class: 'zt-toasts', role: 'status', 'aria-live': 'polite' });
  layer.append(toastHost);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const toast = (text: string, lines: readonly string[] = [], seconds = 9): void => {
    clearTimeout(toastTimer);
    const close = el('button', { type: 'button', 'aria-label': say('dismiss') }, '×');
    const body = el('div', {}, el('p', {}, text));
    if (lines.length > 0) body.append(el('ul', { lang: 'en' }, ...lines.map((line) => el('li', {}, line))));
    const box = el('div', { class: 'zt-toast' }, body, close);
    const clear = (): void => {
      if (box.isConnected) toastHost.replaceChildren();
    };
    close.addEventListener('click', clear);
    toastHost.replaceChildren(box);
    // A message with no time stays until it is closed: what went wrong while loading is not missed.
    if (seconds > 0) toastTimer = setTimeout(clear, seconds * 1000);
  };

  // -------------------------------------------------------------------------------------------------------
  // Which roadmap, and which roadmaps lie beside it.

  const sampleFiles = import.meta.glob<Roadmap>('../roadmap/samples/*.json', { eager: true, import: 'default' });
  const byId = new Map<string, Roadmap>();
  for (const sample of Object.values(sampleFiles)) byId.set(sample.id, sample);
  const samples: Roadmap[] = [...GALLERY_ORDER.flatMap((id) => (byId.has(id) ? [byId.get(id) as Roadmap] : [])), ...[...byId.values()].filter((sample) => !GALLERY_ORDER.includes(sample.id))];

  const storage: StorageLike | undefined = debug.done > 0 ? memoryStorage() : undefined;
  const library = createLibrary(storage);
  const readStored = (key: string): string | null => {
    try {
      return storage ? storage.getItem(key) : localStorage.getItem(key);
    } catch {
      return null;
    }
  };

  const source = pickSource({ inline: document.getElementById(ROADMAP_ELEMENT_ID)?.textContent ?? null, hash: location.hash, search: location.search }, location.href);
  let opened: Roadmap | null = null;
  let pendingPreview: { roadmap: Roadmap; source: 'link' | 'file'; name?: string } | null = null;
  const receipt = source.kind === 'inline' ? readReceipt(document.getElementById(RECEIPT_ELEMENT_ID)?.textContent) : null;

  if (source.kind === 'inline') {
    const result = readRoadmapText(source.text);
    if (result.ok) {
      opened = result.roadmap;
      // A page built for one roadmap is remembered, a gallery page is an example and is not.
      if (!byId.has(opened.id)) library.add(opened);
    } else {
      toast(say('inlineInvalid'), issueLines(result.issues), 0);
    }
  } else if (source.kind === 'sample') {
    opened = byId.get(source.id) ?? null;
    if (!opened) toast(say('sampleMissing', { id: source.id.slice(0, 60) }), [], 0);
  } else if (source.kind === 'link') {
    setNoindex();
    const result = await readLink(`#r=${source.fragment}`);
    if (result.ok) {
      const known = library.list().find((entry) => entry.id === result.roadmap.id);
      // A link that was opened here before goes straight onto the table. A new one is shown first.
      if (known && JSON.stringify(known.roadmap) === JSON.stringify(result.roadmap)) opened = known.roadmap;
      else pendingPreview = { roadmap: result.roadmap, source: 'link' };
    } else {
      toast(`${say('linkInvalid')} ${result.error}`, issueLines(result.issues), 0);
    }
  } else if (source.kind === 'address') {
    setNoindex();
    try {
      const response = await fetch(source.url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
      const result = response.ok ? readRoadmapValue(await response.json()) : null;
      if (result?.ok) pendingPreview = { roadmap: result.roadmap, source: 'file', name: source.url };
      else toast(say('addressFailed'), result ? issueLines(result.issues) : [], 0);
    } catch {
      toast(say('addressFailed'), [], 0);
    }
  }

  let entries: TableEntry[] = tableEntries(opened, library.list(), samples, SHEETS);
  let session: Session = createSession((entries[0] as TableEntry).roadmap, storage);
  if (debug.done > 0) {
    const steps = session.roadmap.stages.flatMap((stage) => stage.waypoints).filter((waypoint) => !waypoint.optional);
    for (const step of steps.slice(0, debug.done)) session.done(step.id);
  }

  const progressOf = (roadmap: Roadmap): Progress =>
    roadmap.id === session.roadmap.id ? session.progress : loadProgressOrEmpty(readStored(progressKey(roadmap.id)), roadmap.id, roadmap.checkedOn);
  const hudList = (): HudRoadmap[] => entries.map((entry) => ({ roadmap: entry.roadmap, progress: progressOf(entry.roadmap), example: entry.example }));
  const sheetSpecs = (): SheetSpec[] => entries.map((entry) => ({ roadmap: entry.roadmap, progress: progressOf(entry.roadmap), example: entry.example }));
  const setTitle = (): void => {
    document.title = opened ? say('titleRoadmap', { title: opened.title }) : say('title');
  };
  if (opened) setTitle();

  // -------------------------------------------------------------------------------------------------------
  // The outline: the roadmap as a page. It is the list view, and all there is without WebGL.

  const outlineHost = document.getElementById('zero-to-outline') ?? document.body.insertBefore(el('div', { id: 'zero-to-outline' }), document.body.firstChild);
  let outline: HydratedOutline | null = null;
  let outlineFor = '';
  let outlineLang = uiLang();
  const ensureOutline = (): void => {
    const roadmap = session.roadmap;
    if (outline && outlineFor === roadmap.id && outlineLang === uiLang()) return;
    outline?.destroy();
    outline = null;
    const found = findOutline(outlineHost);
    const usable = found && found.dataset.zoOutline === roadmap.id && found.dataset.zoHydrated === undefined && outlineLang === uiLang();
    if (!usable) outlineHost.replaceChildren(renderOutline(roadmap, { ui: uiLang() }));
    outlineFor = roadmap.id;
    outlineLang = uiLang();
    try {
      outline = hydrateOutline(outlineHost, session, { ui: uiLang() });
    } catch (error) {
      console.error(error);
    }
  };

  // -------------------------------------------------------------------------------------------------------
  // The overlay.

  const webgl = canUseWebGL() && !debug.list;
  const machine = createModeMachine();
  const bus = createHudBus();
  const hudRoot = el('div', { id: 'zt-hud' });
  const page = el('div', { id: 'zt-page' });
  const heroSpace = el('div', { class: 'zt-hero-space', id: 'top' });
  const sectionsRoot = el('main', { id: 'zt-sections' });
  const trek = el('div', { id: 'zt-trek', 'aria-hidden': 'true' });
  page.append(heroSpace, sectionsRoot, trek);
  const canvas = el('canvas', { id: 'zt-stage', 'aria-hidden': 'true', tabindex: '-1' });
  const overlays = createRoomOverlays(document, { scrim: true });
  // The overlay comes before the sections in the document, so the keyboard reaches the table's controls first.
  // The overlay is built out of sight. Shown from its first style on, no part of it fades in or out at load.
  hudRoot.style.display = 'none';
  document.body.append(canvas, overlays, hudRoot, page, layer, curtain, guard, drop);
  drop.textContent = say('dropHint');

  // A still frame plays the intro only when it asks for a moment of it with ?t=.
  const playIntro = webgl && !isReduced() && debug.hx === null && debug.p === null && !(debug.still && debug.t === null);
  const hudIntro = playIntro && !debug.still && debug.t === null;
  const hud = createHud(hudRoot, session, bus, {
    ...(debug.reduced ? { reducedMotion: true } : {}),
    intro: hudIntro,
    mode: webgl ? 'table' : 'list',
    touch,
  });
  hud.setRoadmaps(hudList(), 0);
  hudRoot.style.removeProperty('display');

  // The page's own controls: the finale, the way to you-are-here, the language and the link-check line.
  const finaleKicker = el('p', { class: 'zt-finale-kicker' });
  const finaleLine = el('h2', { class: 'zt-finale-line' });
  const finaleStart = el('button', { type: 'button', class: 'zt-chip', 'data-kind': 'go' });
  const finalePrint = el('button', { type: 'button', class: 'zt-chip', 'data-plain': '' });
  const finaleFold = el('button', { type: 'button', class: 'zt-chip', 'data-plain': '' });
  const finale = el('section', { class: 'zt-finale' }, finaleKicker, finaleLine, el('div', { class: 'zt-finale-actions' }, finaleStart, finalePrint, finaleFold));
  const jump = el('button', { type: 'button', class: 'zt-chip zt-jump', 'data-kind': 'go' });
  const langEn = el('button', { type: 'button', lang: 'en' }, 'EN');
  const langDe = el('button', { type: 'button', lang: 'de' }, 'DE');
  const langGroup = el('div', { class: 'zt-lang', role: 'group' }, langEn, langDe);
  const receiptLine = el('span', { class: 'zt-receipt' });
  const foot = el('div', { class: 'zt-foot' }, langGroup, receiptLine);
  const debugBox = el('pre', { class: 'zt-debug', hidden: '' });
  layer.append(finale, jump, foot, debugBox);
  debugBox.hidden = !debug.hud;

  const writeWords = (): void => {
    const roadmap = session.roadmap;
    html.lang = uiLang();
    drop.textContent = say('dropHint');
    finaleKicker.textContent = say('finaleKicker');
    const last = roadmap.capstone?.title ?? roadmap.stages[roadmap.stages.length - 1]?.checkpoint.title ?? roadmap.title;
    const closing = el('em', { lang: roadmap.lang, dir: 'auto' }, `${last.replace(/[.。!?]+$/u, '')}.`);
    finaleLine.replaceChildren(
      say('finaleLine', { stages: say('finaleStages', { count: roadmap.stages.length }), hours: formatHours(session.trek.totalMinutes, { lang: uiLang() }) }),
      ' ',
      closing,
    );
    const started = session.progress.startedAt;
    finaleStart.textContent = started ? say('finaleAgain') : say('finaleStart');
    finaleStart.title = started ? say('finaleStarted', { day: formatDay(started.slice(0, 10), { lang: uiLang() }) }) : '';
    finalePrint.textContent = say('finalePrint');
    finaleFold.textContent = say('finaleFold');
    jump.textContent = say('jumpHere');
    langGroup.setAttribute('aria-label', say('language'));
    langEn.setAttribute('aria-label', say('langEn'));
    langDe.setAttribute('aria-label', say('langDe'));
    langEn.setAttribute('aria-pressed', String(uiLang() === 'en'));
    langDe.setAttribute('aria-pressed', String(uiLang() === 'de'));
    receiptLine.textContent = receipt ? say('receipt', { opened: receipt.opened, kept: receipt.kept, day: formatDay(receipt.checkedOn, { lang: uiLang() }) }) : '';
    if (opened) setTitle();
  };
  writeWords();

  // -------------------------------------------------------------------------------------------------------
  // The scene.

  let stage: Stage | null = null;
  let table: TablePart | null = null;
  if (webgl) {
    try {
      stage = createStage({ canvas, reduced: isReduced, background: THEME.night, fov: HERO_CAMERA.wide.fov });
    } catch (error) {
      console.warn('zero-to: the 3D scene could not start, showing the list view.', error);
      stage = null;
    }
  }
  if (!stage) {
    // No map: the roadmap as a list, with every learning control working.
    html.classList.remove('map-view');
    html.classList.add('no-webgl');
    hud.setMode('list');
    machine.go('list');
    html.dataset.ztView = 'list';
    ensureOutline();
    if (!debug.list) toast(say('noWebgl'), [], 12);
  } else {
    html.classList.add('map-view');
    html.dataset.ztView = 'table';
  }

  const fonts = loadFonts({ text: entries.map((entry) => entry.roadmap.title).join('') });

  const sizeOf = (): { width: number; height: number } => ({ width: canvas.clientWidth || window.innerWidth, height: canvas.clientHeight || window.innerHeight });
  const camera = stage?.camera ?? null;
  const rig = createHeroCamera();
  // The fog is always in the scene, so no material is compiled twice. Over the table it starts far behind everything.
  const FOG_OFF = { near: 1e4, far: 1e5 } as const;
  const fog = new Fog(THEME.night, FOG_OFF.near, FOG_OFF.far);
  if (stage) stage.scene.fog = fog;
  const queue = createBuildQueue({ onError: (name, error) => console.error(`zero-to: building "${name}" failed`, error) });
  const raycaster = new Raycaster();
  const ndc = new Vector2();
  const scratch = new Vector3();
  const pointer = { x: 0, y: 0, has: false, speed: 0, lastX: 0, lastY: 0, lastAt: 0 };

  // Scene time: it stands still until the first smooth frames, then runs with the frames.
  let sceneT = 0;
  let started = false;
  let smoothFrames = 0;
  let waited = 0;
  let introFrom: number | null = playIntro ? 0 : null;
  let lastBy: string = 'scroll';
  let stoodFor = 0;
  let away = false;
  let covered = false;

  // The dive.
  let diveT = 0;
  let hx = debug.hx ?? 0;
  let held = 0;
  let crossed = false;
  let landAt = 0;
  let goAfter: number | null = null;
  let reviewFirst: string | null = null;
  let guardSampled = false;

  // The walk.
  let walk: WalkPart | null = null;
  let walkFor = '';
  let walkWarm = false;
  let walkToken = 0;
  let walkModule: Promise<typeof import('../walk')> | null = null;
  let walkLib: typeof import('../walk') | null = null;
  const progress = spring(0);
  let target = 0;
  let scrollAnim: { from: number; to: number; t: number; seconds: number } | null = null;
  let lastItem = '';
  let seenItem = '';
  let seenFor = 0;
  let reviewItem: HudItem = null;
  let placeIn = 0;
  let lastPixel = '';
  let stops: number[] = [];
  let finaleOn = false;
  let closing = false;

  // The way back, and the fade of reduced motion.
  let returning: { t: number; fold: number | null; from: CameraPose | null; swapped: boolean } | null = null;
  let fade: { t: number; half: boolean; action: () => void; then: Mode; wait?: () => boolean } | null = null;
  let sheetsStale = false;
  let listScroll = 0;

  const setPhase = (phase: 'dive' | 'land' | 'leave' | null): void => {
    if (phase) html.dataset.ztPhase = phase;
    else delete html.dataset.ztPhase;
  };

  // -------------------------------------------------------------------------------------------------------
  // Camera.

  const applyPose = (pose: CameraPose, near: number = DIVE.near.rest): void => {
    if (!camera) return;
    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    if (camera.fov !== pose.fov || camera.near !== near) {
      camera.fov = pose.fov;
      camera.near = near;
      camera.updateProjectionMatrix();
    }
    camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
    camera.updateMatrixWorld();
  };

  const poseNow = (): CameraPose | null => {
    if (!camera) return null;
    const direction = camera.getWorldDirection(scratch);
    const distance = 6;
    return {
      position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      target: { x: camera.position.x + direction.x * distance, y: camera.position.y + direction.y * distance, z: camera.position.z + direction.z * distance },
      distance,
      fov: camera.fov,
    };
  };

  const walkInsets = (): { bottom?: number; narrow: boolean } => {
    const { width, height } = sizeOf();
    const narrow = isNarrow(width, height);
    const insets = hud.setInsets();
    const bottom = hud.mode === 'walk' ? (2 * insets.bottom) / Math.max(1, height) : 0;
    // The strip along the bottom is glass over the cloth in front of the panel, and the narrow box already
    // leaves room under it: the panel keeps most of its size.
    return bottom > 0 ? { bottom: Math.min(0.5, bottom * (narrow ? 0.6 : 0.55)), narrow } : { narrow };
  };

  const reframe = (): void => {
    if (!stage) return;
    const { width, height } = sizeOf();
    if (table?.ready) {
      const narrow = isNarrow(width, height);
      const copy = narrow ? hudRoot.querySelector<HTMLElement>('.zh-headline') : null;
      const box = copy?.getBoundingClientRect();
      const clearBelow = box && box.height > 0 ? 1 - (2 * (box.bottom + 8)) / height : undefined;
      rig.frame(table.framePoints(), width, height, clearBelow === undefined ? {} : { clearBelow });
    }
    if (walk) walk.posesFor(width / Math.max(1, height), walkInsets());
  };

  // -------------------------------------------------------------------------------------------------------
  // The lamp takes the colour of the lit roadmap's map theme.

  const lampTint = new Color(1, 1, 1);
  const lampWant = new Color(1, 1, 1);
  const tintFor = (roadmap: Roadmap, into: Color): Color => {
    const base = hexToRgb(kelvinToHex(resolveTheme(undefined).lampKelvin));
    const own = hexToRgb(kelvinToHex(resolveTheme(roadmap.map?.theme).lampKelvin));
    const ratio = { r: own[0] / Math.max(0.01, base[0]), g: own[1] / Math.max(0.01, base[1]), b: own[2] / Math.max(0.01, base[2]) };
    const luma = 0.2126 * ratio.r + 0.7152 * ratio.g + 0.0722 * ratio.b;
    const strength = 0.6;
    return into.setRGB(lerp(1, ratio.r / luma, strength), lerp(1, ratio.g / luma, strength), lerp(1, ratio.b / luma, strength));
  };
  let tableLamps: Light[] = [];
  const findLamps = (root: Object3D, names: readonly string[]): Light[] => names.flatMap((name) => (root.getObjectByName(name) ? [root.getObjectByName(name) as Light] : []));
  const tintLamps = (dt: number): void => {
    lampTint.lerp(lampWant, isReduced() ? 1 : 1 - Math.exp(-3 * dt));
    if (Math.abs(lampTint.r - 1) + Math.abs(lampTint.g - 1) + Math.abs(lampTint.b - 1) < 1e-3) return;
    for (const lamp of tableLamps) lamp.color.multiply(lampTint);
  };

  // -------------------------------------------------------------------------------------------------------
  // The session follows the roadmap in the light.

  let unsubscribe: (() => void) | null = null;
  const syncWalk = (): void => {
    if (!walk || walkFor !== session.roadmap.id) return;
    const data = deriveSheet({ roadmap: session.roadmap, progress: session.progress });
    walk.setHere(data.hereMinuteShare);
    walk.setPassed(data.passed);
    walk.setDue(session.due().map((item) => item.waypointId));
    for (const stageData of session.roadmap.stages) {
      walk.setRungs(stageData.id, session.progress.rungs[stageData.id] ?? 0);
      walk.setTicked(stageData.id, stageData.checkpoint.show.map((_, index) => session.progress.shows[stageData.id]?.[index] === true));
    }
  };
  const listen = (): void => {
    unsubscribe?.();
    unsubscribe = session.subscribe((change) => {
      if (change.type !== 'progress') return;
      sheetsStale = true;
      syncWalk();
      if (change.action === 'start') writeWords();
    });
  };
  listen();

  const adopt = (index: number): void => {
    const entry = entries[index];
    if (!entry || entry.roadmap.id === session.roadmap.id) return;
    const previous = session;
    session = createSession(entry.roadmap, storage);
    hud.setSession(session);
    previous.destroy();
    listen();
    writeWords();
    if (machine.mode === 'list') ensureOutline();
  };

  // -------------------------------------------------------------------------------------------------------
  // The walk is fetched and built while the table is looked at.

  const loadWalk = (): Promise<typeof import('../walk')> => (walkModule ??= import('../walk'));
  const walkReady = (): boolean => walk !== null && walkFor === session.roadmap.id && walk.ready && walkWarm;

  const dropWalk = (): void => {
    walkToken += 1;
    queue.cancel('walk');
    queue.cancel('walk-warm');
    if (walk) {
      stage?.scene.remove(walk.object);
      walk.dispose();
    }
    walk = null;
    walkFor = '';
    walkWarm = false;
  };

  const warmWalk = (): void => {
    if (!stage || !walk || !camera) return;
    // One small frame of the whole open map, so its shaders are compiled and its prints are on the GPU before
    // the cut. The frame goes into a 64 px target and is never seen.
    const keep = { table: table?.object.visible ?? false, pose: poseNow(), near: camera.near };
    const target64 = new WebGLRenderTarget(64, 64);
    if (table) table.object.visible = false;
    walk.object.visible = true;
    walk.setFold(1);
    walk.setProgress(0.86);
    walk.update(ZERO);
    walk.settle();
    applyPose(walk.cameraAt(0.86));
    stage.renderer.setRenderTarget(target64);
    stage.renderer.render(stage.scene, camera);
    stage.renderer.setRenderTarget(null);
    target64.dispose();
    walk.setFold(null);
    walk.setProgress(0);
    walk.update(ZERO);
    walk.settle();
    walk.object.visible = false;
    if (table) table.object.visible = keep.table;
    if (keep.pose) applyPose(keep.pose, keep.near);
  };

  const wantWalk = (): void => {
    if (!stage) return;
    const roadmap = session.roadmap;
    if (walkFor === roadmap.id) return;
    dropWalk();
    walkFor = roadmap.id;
    const token = walkToken;
    const index = Math.max(0, entries.findIndex((entry) => entry.roadmap.id === roadmap.id));
    void loadWalk().then((module) => {
      walkLib = module;
      if (token !== walkToken || !stage) return;
      const part = module.createWalk(stage.environment, { roadmap, progress: session.progress, lang: uiLang(), number: index + 1, example: entries[index]?.example === true });
      part.object.visible = false;
      stage.scene.add(part.object);
      walk = part;
      for (const lamp of part.object.getObjectsByProperty('isSpotLight', true) as Light[]) lamp.color.multiply(tintFor(roadmap, new Color()));
      syncWalk();
      reframe();
      stops = [];
      queue.add('walk', () => {
        part.update(ZERO);
        return part.ready;
      });
      queue.add('walk-warm', () => {
        if (token === walkToken) {
          warmWalk();
          walkWarm = true;
        }
        return true;
      });
    });
  };

  const walkStops = (): number[] => {
    if (!walk || stops.length > 0) return stops;
    for (const stageData of session.roadmap.stages) {
      for (const waypoint of stageData.waypoints) {
        const at = walk.progressFor({ waypointId: waypoint.id });
        if (at !== null) stops.push(at);
      }
      for (const kind of ['signpost', 'camp'] as const) {
        const at = walk.progressFor({ stageId: stageData.id, kind });
        if (at !== null) stops.push(at);
      }
    }
    stops.sort((a, b) => a - b);
    return stops;
  };

  // -------------------------------------------------------------------------------------------------------
  // Scroll.

  const scrollRange = (): number => Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  const scrollNow = (y: number): void => window.scrollTo({ top: y, behavior: 'instant' });
  /** Walks him to a walk progress: 0.8 s to the next stop, longer for a longer way, never more than 3.2 s. */
  const scrollToProgress = (p: number, seconds?: number): void => {
    const to = walkScrollFor(p, scrollRange());
    const span = seconds ?? Math.min(SCROLL.longest, SCROLL.stepSeconds + Math.abs(to - window.scrollY) / SCROLL.pixelsPerSecond);
    if (isReduced() || span <= 0) {
      scrollAnim = null;
      scrollNow(to);
    } else {
      scrollAnim = { from: window.scrollY, to, t: 0, seconds: span };
    }
  };
  const stepScroll = (dt: number): void => {
    if (!scrollAnim) return;
    scrollAnim.t += dt;
    const k = Math.min(1, scrollAnim.t / scrollAnim.seconds);
    scrollNow(lerp(scrollAnim.from, scrollAnim.to, easeInOutCubic(k)));
    if (k >= 1) scrollAnim = null;
  };
  const locked = (): boolean => isLocked(machine.mode);

  const setView = (view: View): void => {
    html.dataset.ztView = view;
    if (view === 'walk' && walk) html.style.setProperty('--zt-stretch', String(stretchViewports(walk.plan.windows.viewports)));
  };

  // -------------------------------------------------------------------------------------------------------
  // The landing page: the table at the top, the sections under it.

  let sections: Sections | null = null;
  let landingQueued = 0;
  const showLanding = (): void => {
    landingQueued = 0;
    if (machine.mode !== 'table' && machine.mode !== 'return' && machine.mode !== 'boot') return;
    const y = window.scrollY;
    const viewport = window.innerHeight;
    const nowAway = y > viewport * 0.1;
    if (nowAway !== away) {
      away = nowAway;
      html.classList.toggle('zt-away', away);
    }
    sections?.update(sections.progressAt(y));
    // Once the sections cover the table, the table is not drawn.
    const nowCovered = y > viewport * 1.3;
    if (nowCovered !== covered) {
      covered = nowCovered;
      if (!fixed && stage) {
        if (covered) stage.stop();
        else stage.start();
      }
    }
  };
  const queueLanding = (): void => {
    if (!landingQueued) landingQueued = requestAnimationFrame(showLanding);
  };

  const mountSections = async (): Promise<void> => {
    if (!stage) return;
    const module = await import('../sections');
    await module.loadSectionWords(uiLang());
    const live = location.protocol === 'http:' || location.protocol === 'https:';
    sections = module.mountSections(sectionsRoot, {
      navHost: hud.navSlot,
      reduced: isReduced,
      topic: opened?.topic ?? '',
      examples: samples.map((sample) => ({ title: sample.title, lang: sample.lang, checkedOn: sample.checkedOn, ...(sample.freshness ? { freshness: sample.freshness } : {}) })),
      ...(live ? { links: { ...module.DEFAULT_LINKS, gallery: './gallery/' } } : {}),
    });
    showLanding();
  };

  // -------------------------------------------------------------------------------------------------------
  // Showing the table or the map.

  const showTable = (): void => {
    if (!stage || !table) return;
    if (!table.object.visible) table.object.visible = true;
    if (walk?.object.visible) walk.object.visible = false;
    fog.near = FOG_OFF.near;
    fog.far = FOG_OFF.far;
  };
  const showWalk = (): void => {
    if (!stage || !walk) return;
    if (table?.object.visible) table.object.visible = false;
    if (!walk.object.visible) walk.object.visible = true;
  };
  const setFog = (distance: number): void => {
    if (!walk) return;
    const range = walk.fogFor(distance);
    fog.near = Math.max(range.near, 12);
    fog.far = Math.max(range.far, 46);
  };

  // -------------------------------------------------------------------------------------------------------
  // One frame of the table.

  const tickTable = (frame: FrameTime, live: boolean): void => {
    if (!stage || !table || !camera) return;
    const { width, height } = sizeOf();
    const usePointer = live && pointer.has && !away;
    if (usePointer) {
      ndc.set((pointer.x / width) * 2 - 1, 1 - (pointer.y / height) * 2);
      table.setPointer(ndc.x, ndc.y);
    } else {
      table.setPointer(null, null);
    }
    const intro = introFrom === null ? null : frame.t - introFrom;
    if (intro !== null && intro >= INTRO.end) {
      introFrom = null;
      delete html.dataset.ztIntro;
    } else if (intro !== null && intro >= SIDE_AT && html.dataset.ztIntro === 'again') {
      html.dataset.ztIntro = '';
    }
    rig.apply(camera, { dt: frame.dt, reduced: frame.reduced, intro: introFrom === null ? null : intro, pointer: usePointer && !touch ? { x: ndc.x, y: ndc.y } : null });
    if (camera.near !== DIVE.near.rest) {
      camera.near = DIVE.near.rest;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
    let cursor = '';
    if (usePointer) {
      raycaster.setFromCamera(ndc, camera);
      if (table.hover(raycaster.ray, pointer.speed).kind !== 'none') cursor = 'pointer';
    } else {
      table.hover(null);
    }
    if (canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
    table.setExit(live ? 0 : hx);
    table.update(frame);
    tintLamps(frame.dt);
    if (live) {
      // The map of the lit roadmap is built ahead once somebody is here: their own roadmap, a pick, a pointer.
      stoodFor = table.standing === table.selected && introFrom === null ? stoodFor + frame.dt : 0;
      if (stoodFor > 0.8 && machine.mode === 'table' && (opened !== null || pointer.has || lastBy === 'person')) {
        adopt(table.selected);
        wantWalk();
      }
      const at = (name: 'enter' | 'arrowPrevious' | 'arrowNext'): { x: number; y: number } => {
        const point = (table as TablePart).anchor(name, scratch).project(camera);
        return { x: ((point.x + 1) / 2) * width, y: ((1 - point.y) / 2) * height };
      };
      hud.setAnchors({ enter: at('enter'), previous: at('arrowPrevious'), next: at('arrowNext') });
    }
  };

  // -------------------------------------------------------------------------------------------------------
  // The dive: one function of hero-exit progress.

  const sampleGuard = (): void => {
    if (!stage || !camera || guardSampled) return;
    guardSampled = true;
    // The guard takes the colour the head is drawn in, kept close to the route colour it stands for.
    stage.renderer.render(stage.scene, camera);
    const gl = stage.renderer.getContext();
    const pixel = new Uint8Array(4);
    gl.readPixels(Math.floor(gl.drawingBufferWidth / 2), Math.floor(gl.drawingBufferHeight / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    const signal = hexToRgb(THEME.signal).map((channel) => channel * 255) as [number, number, number];
    const near = (value: number, want: number, by: number): number => Math.round(Math.min(255, want + by, Math.max(0, want - by, value)));
    const shade = (by: number, offset: number): string =>
      `rgb(${near((pixel[0] as number) + offset, signal[0], by)} ${near((pixel[1] as number) + offset, signal[1], by)} ${near((pixel[2] as number) + offset, signal[2], by)})`;
    guard.style.setProperty('--zt-guard-a', shade(9, 5));
    guard.style.setProperty('--zt-guard-b', shade(8, 0));
    guard.style.setProperty('--zt-guard-c', shade(9, -6));
  };

  const crossCut = (): void => {
    if (!walk || crossed) return;
    crossed = true;
    setView('walk');
    hud.setMode('walk');
    setPhase('land');
    reframe();
    walk.setFold(1);
    walk.setProgress(landAt);
    walk.setLanding(0);
    walk.setLight(1);
    showWalk();
    walk.update(ZERO);
    walk.settle();
    progress.x = landAt;
    progress.v = 0;
    target = landAt;
    scrollAnim = null;
    scrollNow(walkScrollFor(landAt, scrollRange()));
    lastItem = '';
    lastPixel = '';
    stops = [];
  };

  /**
   * The pool of the map's lamp during the landing: on the walker while he comes up, then over to where the
   * walk keeps it, so the light does not jump when the landing hands over.
   */
  const aimLanding = (u: number): void => {
    if (!walk || !walkLib) return;
    const { PANEL, WALK_LIGHT, panelLeft, railAt } = walkLib;
    const count = walk.plan.panels.length;
    const rail = Math.min(count, Math.max(1, railAt(landAt, count, walk.plan.windows)));
    const here = walk.here;
    const k = smooth(seg(u, 0.4, 1));
    walk.aim({
      x: lerp(panelLeft(here.panel) + here.point.x, (rail - 1) * PANEL.width + WALK_LIGHT.aim.x, k),
      y: 0.1,
      z: lerp(here.point.z, WALK_LIGHT.aim.z, k),
    });
  };

  const applyHx = (frame: FrameTime): void => {
    if (!stage || !table || !camera) return;
    guard.style.opacity = String(guardOpacity(hx));
    const u = landingShare(hx);
    if (u === null || !walk || !crossed) {
      showTable();
      tickTable(frame, false);
      const pose = rig.pose;
      if (pose && hx > DIVE.fall.from) {
        const head = table.anchor('pin', scratch);
        const fall = divePose(Math.min(hx, DIVE.cut), {
          from: { position: { x: camera.position.x, y: camera.position.y, z: camera.position.z }, target: pose.target, fov: camera.fov },
          head: { x: head.x, y: head.y, z: head.z },
          headDistance: PIN.diveDistance * sheetScale(table.count),
        });
        applyPose(fall, nearPlane(fall.distance));
        if (hx > DIVE.guard.from - 0.03) sampleGuard();
      }
      return;
    }
    showWalk();
    walk.setLanding(u);
    walk.setProgress(landAt);
    // Inside the head the map's own lamp is low, so the red on this side of the cut is the red of the other. It
    // comes up to daylight while the camera pulls back.
    walk.setLight(lerp(DIVE.landingLight, 1, smooth(seg(u, 0.02, 0.28))));
    aimLanding(u);
    walk.update(frame);
    const pose = mixPose(walk.landingPose(u), walk.cameraAt(landAt), landingHandover(u));
    applyPose(pose, nearPlane(pose.distance));
    setFog(pose.distance);
    if (u >= DIVE.overlayAt && html.dataset.ztPhase === 'land') {
      setPhase(null);
      feedHud(frame, true);
    }
  };

  // -------------------------------------------------------------------------------------------------------
  // What the overlay hears while the walker walks.

  const feedHud = (frame: FrameTime, force = false): void => {
    if (!walk || !camera) return;
    const { width, height } = sizeOf();
    // While he lands the walk names nothing yet, but the note may already come in for the step he lands on.
    let under = walk.activeItem ?? (machine.mode === 'landing' || machine.mode === 'cut' ? walk.place.item.item : null);
    // When the page itself walks him somewhere (a step, a seek, a jump), the note is the one of that place from
    // the start, so it has arrived when he has.
    const ahead = scrollAnim && walkLib ? walkProgressAt(scrollAnim.to, scrollRange()) : null;
    if (ahead !== null && walkLib && ahead > WALK_TOP && ahead < FINALE.from) under = walkLib.placeAt(walk.plan, ahead).item.item;
    const item: HudItem = finaleOn ? null : (reviewItem ?? toHudItem(under));
    const key = itemKey(item);
    if (key !== seenItem) {
      seenItem = key;
      seenFor = 0;
    } else {
      seenFor += Math.max(frame.dt, 1 / 240);
    }
    // A swap of the note takes over a second. So the note changes when he has arrived at a step (or has been on
    // it for a while), and stays as it is for the steps he only passes on a long scroll.
    const arrived = ahead !== null || Math.abs(target - progress.x) < NOTE_ARRIVED;
    if (force || (key !== lastItem && (key === '' || (arrived && seenFor >= (ahead !== null ? 0 : 0.15)) || seenFor >= 1.6))) {
      lastItem = key;
      hud.setActive(item);
      placeIn = 0.25;
    }
    if (placeIn > 0) {
      placeIn -= Math.max(frame.dt, 1 / 240);
      if (placeIn <= 0 && item) hud.placeNoteBy(walk.projectActive(camera, { width, height }).points);
    }
    let screen: { x: number; y: number } | null = null;
    if (walk.walkerShown) {
      const top = walk.walkerTop(scratch).project(camera);
      screen = { x: ((top.x + 1) / 2) * width, y: ((1 - top.y) / 2) * height };
    }
    hud.setWalker(walk.along, screen);
    const map = item ? walk.miniMap(walk.place.panel) : null;
    const pixel = map ? `${walk.place.panel}/${map.pixel ? `${Math.round(map.pixel.x)},${Math.round(map.pixel.y)}` : ''}` : '';
    if (pixel !== lastPixel) {
      lastPixel = pixel;
      hud.setMiniMap(map?.canvas ?? null, map?.pixel ?? null, map?.marks ?? []);
    }
    // Offered only to somebody with progress who has walked away from it.
    const far = !finaleOn && deriveHere() > 0 && Math.abs(walk.along - deriveHere()) > 0.04 && machine.mode === 'walk';
    jump.toggleAttribute('data-on', far);
  };

  let hereShare = 0;
  let hereKey = '';
  const deriveHere = (): number => {
    const key = `${session.roadmap.id}/${session.progress.updatedAt ?? ''}`;
    if (key !== hereKey) {
      hereKey = key;
      hereShare = deriveSheet({ roadmap: session.roadmap, progress: session.progress }).hereMinuteShare;
    }
    return hereShare;
  };

  const tickWalk = (frame: FrameTime): void => {
    if (!walk) return;
    target = walkProgressAt(window.scrollY, scrollRange());
    if (frame.reduced || debug.still) {
      progress.x = target;
      progress.v = 0;
    } else {
      critDamp(progress, target, SCROLL.omega, Math.min(frame.dt, 0.034));
    }
    const p = Math.min(1, Math.max(0, progress.x));
    walk.setProgress(p);
    walk.update(frame);
    const pose = walk.cameraAt(p);
    applyPose(pose);
    setFog(pose.distance);

    const nowFinale = isFinale(p);
    if (nowFinale !== finaleOn) {
      finaleOn = nowFinale;
      machine.go(nowFinale ? 'finish' : 'walk');
      html.toggleAttribute('data-zt-finale', nowFinale);
      finale.toggleAttribute('data-on', nowFinale);
      if (nowFinale) reviewItem = null;
    }
    if (nowFinale) finale.style.setProperty('--zt-finale', finaleOpacity(p).toFixed(3));
    const nowClosing = p >= FINALE.closing;
    if (nowClosing !== closing) {
      closing = nowClosing;
      setPhase(closing ? 'leave' : null);
    }
    feedHud(frame);
    if (p >= FINALE.shut && target >= FINALE.shut && !scrollAnim) startReturn(false);
  };

  // -------------------------------------------------------------------------------------------------------
  // Going in.

  interface EnterOptions {
    /** Where to walk to once landed, as a share of the minutes. */
    readonly along?: number;
    readonly reviews?: boolean;
  }

  const prepareEnter = (options: EnterOptions): boolean => {
    if (!stage || !table) return false;
    adopt(table.selected);
    wantWalk();
    goAfter = null;
    reviewFirst = null;
    reviewItem = null;
    if (options.reviews) reviewFirst = session.due()[0]?.waypointId ?? null;
    else if (options.along !== undefined) goAfter = options.along;
    return true;
  };

  const landingProgress = (): number => {
    if (!walk) return 0;
    const here = deriveHere();
    return Math.max(WALK_TOP, (here > 0 ? walk.progressFor({ along: here }) : null) ?? WALK_TOP);
  };

  const afterLanding = (): void => {
    if (!walk) return;
    walk.setLanding(null);
    walk.setFold(null);
    walk.aim(null);
    setPhase(null);
    if (reviewFirst) {
      const at = walk.progressFor({ waypointId: reviewFirst });
      reviewItem = { kind: 'review', waypointId: reviewFirst };
      if (at !== null) scrollToProgress(at, 1.2);
      reviewFirst = null;
    } else if (goAfter !== null) {
      const at = walk.progressFor({ along: goAfter });
      if (at !== null && Math.abs(at - landAt) > 0.004) scrollToProgress(at, 1.4);
      goAfter = null;
    } else {
      // He came up on the pin, at the end of what is walked. Now he walks on to the step that is next.
      const at = hereProgress();
      if (at !== null && at > landAt + 0.001) scrollToProgress(at, 1.4);
    }
  };

  /** Walk progress at which the walker stands on the step of you-are-here. Null when nothing is walked yet. */
  const hereProgress = (): number | null => {
    const here = session.here();
    if (!walk || !here || deriveHere() <= 0) return null;
    return walk.progressFor({ waypointId: here.waypointId });
  };

  const enter = (options: EnterOptions = {}): void => {
    if (machine.mode !== 'table' || away || introBusy()) return;
    if (!prepareEnter(options)) return;
    hud.closePanel();
    if (isReduced()) {
      machine.go('fade');
      fade = {
        t: 0,
        half: false,
        then: 'walk',
        wait: () => walk !== null,
        action: () => {
          queue.flush();
          if (!walk) return;
          // Without the landing there is nothing to walk on from: he stands on the next step at once.
          landAt = hereProgress() ?? landingProgress();
          crossed = false;
          crossCut();
          setPhase(null);
          afterLanding();
          feedHud(ZERO, true);
        },
      };
      return;
    }
    machine.go('dive');
    setPhase('dive');
    diveT = 0;
    hx = 0;
    held = 0;
    crossed = false;
    guardSampled = false;
  };

  const introBusy = (): boolean => introFrom !== null && sceneT - introFrom < INTRO.grow;

  const tickDive = (frame: FrameTime): void => {
    if (debug.hx === null) {
      const next = hxAt(diveT + frame.dt);
      if (next >= DIVE.cut && !crossed) {
        // The red waits for a map that is still being built, but not for long: then the rest is built in one go.
        if (!walkReady()) {
          held += frame.dt;
          if (held >= DIVE.hold) queue.flush();
        }
        if (walkReady() && walk) {
          landAt = landingProgress();
          crossCut();
          diveT += frame.dt;
          hx = next;
        } else {
          hx = DIVE.cut;
        }
      } else {
        diveT += frame.dt;
        hx = next;
      }
    } else if (hx >= DIVE.cut && !crossed) {
      queue.flush();
      if (walk) {
        landAt = landingProgress();
        crossCut();
      }
    }
    if (machine.mode === 'dive' && hx >= DIVE.guard.from) machine.go('cut');
    if (machine.mode === 'cut' && hx >= DIVE.guard.to && crossed) machine.go('landing');
    applyHx(frame);
    if (machine.mode === 'landing' && hx >= 1 && debug.hx === null) {
      machine.go('walk');
      guard.style.opacity = '0';
      afterLanding();
    }
  };

  // -------------------------------------------------------------------------------------------------------
  // Going back.

  const swapToTable = (intro: boolean): void => {
    if (!stage || !table) return;
    finaleOn = false;
    closing = false;
    html.removeAttribute('data-zt-finale');
    finale.removeAttribute('data-on');
    jump.removeAttribute('data-on');
    setView('table');
    scrollAnim = null;
    scrollNow(0);
    away = false;
    html.classList.remove('zt-away');
    if (walk) {
      walk.setLight(1);
      walk.aim(null);
      walk.setFold(null);
      walk.setLanding(null);
      walk.setProgress(0);
      walk.update(ZERO);
      walk.settle();
    }
    showTable();
    hx = 0;
    if (sheetsStale) {
      sheetsStale = false;
      table.setSheets(sheetSpecs(), table.selected);
      hud.setRoadmaps(hudList(), table.selected);
    }
    table.setExit(0);
    hud.setActive(null);
    hud.setMode('table');
    setPhase(null);
    reframe();
    if (intro) {
      table.startIntro();
      introFrom = sceneT;
      html.dataset.ztIntro = 'again';
      hud.playIntro();
    }
    sections?.measure();
    showLanding();
  };

  function startReturn(byHand: boolean): void {
    if (machine.mode !== 'walk' && machine.mode !== 'finish') return;
    hud.closePanel();
    if (isReduced()) {
      machine.go('fade');
      fade = { t: 0, half: false, then: 'table', action: () => swapToTable(false) };
      return;
    }
    machine.go('return');
    setPhase('leave');
    scrollAnim = null;
    returning = { t: 0, fold: byHand && walk && walk.fold > 0.02 ? 0 : null, from: poseNow(), swapped: false };
  }

  const tickReturn = (frame: FrameTime): void => {
    const state = returning;
    if (!state || !walk) return;
    if (state.fold !== null) {
      // Folded by hand: the map shuts where the walker stood, and the camera goes to the shut map.
      state.fold += frame.dt;
      const k = Math.min(1, state.fold / RETURN.fold);
      walk.setFold(foldAt(state.fold));
      walk.update(frame);
      const shut = walk.cameraAt(1);
      const pose = state.from ? mixPose(state.from, shut, easeInOutCubic(k)) : shut;
      applyPose(pose);
      setFog(pose.distance);
      finale.style.setProperty('--zt-finale', '0');
      if (k >= 1) {
        state.fold = null;
        state.t = RETURN.wait * 0.6;
      }
      return;
    }
    state.t += frame.dt;
    const at = returnAt(state.t);
    curtain.style.opacity = at.curtain.toFixed(3);
    if (!at.swapped) {
      walk.setLight(at.light);
      walk.update(frame);
      const shut = walk.cameraAt(1);
      // The camera eases away from the shut map while its lamp goes out.
      const back = 1 + 0.05 * easeInOutCubic(Math.min(1, state.t / (RETURN.wait + RETURN.curtain + RETURN.out)));
      const pose: CameraPose = {
        ...shut,
        position: { x: shut.target.x + (shut.position.x - shut.target.x) * back, y: shut.target.y + (shut.position.y - shut.target.y) * back, z: shut.target.z + (shut.position.z - shut.target.z) * back },
      };
      applyPose(pose);
      setFog(pose.distance * back);
      return;
    }
    if (!state.swapped) {
      state.swapped = true;
      swapToTable(true);
    }
    tickTable(frame, true);
    if (at.done) {
      returning = null;
      curtain.style.opacity = '0';
      machine.go('table');
    }
  };

  const tickFade = (frame: FrameTime): void => {
    const state = fade;
    if (!state) return;
    state.t += Math.max(frame.dt, 1 / 60);
    const span = DIVE.fadeMs / 1000;
    if (!state.half) {
      curtain.style.opacity = String(Math.min(1, state.t / span));
      if (state.t >= span && (state.wait?.() ?? true)) {
        state.half = true;
        state.t = 0;
        state.action();
      }
    } else {
      curtain.style.opacity = String(1 - Math.min(1, state.t / span));
      if (state.t >= span) {
        fade = null;
        curtain.style.opacity = '0';
        machine.go(state.then);
      }
    }
    if (html.dataset.ztView === 'walk') tickWalkStill(frame);
    else tickTable(frame, false);
  };

  /** The map as it is, without reading the scroll: for the frames of a fade. */
  const tickWalkStill = (frame: FrameTime): void => {
    if (!walk) return;
    walk.update(frame);
    const pose = walk.cameraAt();
    applyPose(pose);
    setFog(pose.distance);
  };

  // -------------------------------------------------------------------------------------------------------
  // The list view.

  const setList = (on: boolean): void => {
    if (on) {
      if (!machine.go('list')) return;
      listScroll = window.scrollY;
      html.classList.remove('map-view');
      html.dataset.ztView = 'list';
      stage?.stop();
      ensureOutline();
      hud.setMode('list');
      scrollNow(0);
      const heading = outlineHost.querySelector<HTMLElement>('h1');
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
      return;
    }
    if (!stage || machine.mode !== 'list') return;
    const back = machine.from === 'walk' || machine.from === 'finish' ? machine.from : 'table';
    machine.go(back);
    html.classList.add('map-view');
    const view = viewOf(back);
    setView(view);
    hud.setMode(view === 'walk' ? 'walk' : 'table');
    if (sheetsStale && view === 'table' && table) {
      sheetsStale = false;
      table.setSheets(sheetSpecs(), table.selected);
      hud.setRoadmaps(hudList(), table.selected);
    }
    scrollNow(listScroll);
    reframe();
    if (!fixed) stage.start();
    showLanding();
  };

  // -------------------------------------------------------------------------------------------------------
  // A roadmap from outside goes onto the table.

  const applyOpened = (roadmap: Roadmap, from: 'link' | 'file'): void => {
    if (!library.add(roadmap)) toast(say('notKept'));
    opened = roadmap;
    if (from === 'link') setNoindex();
    entries = tableEntries(opened, library.list(), samples, SHEETS);
    const previous = session;
    session = createSession(roadmap, storage);
    hud.setSession(session);
    previous.destroy();
    listen();
    hud.setRoadmaps(hudList(), 0);
    dropWalk();
    if (table) {
      table.setAutoTurn(false);
      table.setSheets(sheetSpecs(), 0);
      tintFor(roadmap, lampWant);
      reframe();
    }
    sections?.setTopic(roadmap.topic);
    writeWords();
    if (machine.mode === 'list' || !stage) ensureOutline();
    else wantWalk();
    toast(say('opened', { title: roadmap.title }), [], 5);
  };

  // -------------------------------------------------------------------------------------------------------
  // What the overlay asks for.

  const atTable = (): boolean => machine.mode === 'table' && !away;

  const goTo = (p: number | null, seconds?: number): void => {
    if (p === null || (machine.mode !== 'walk' && machine.mode !== 'finish')) return;
    reviewItem = null;
    scrollToProgress(p, seconds);
  };

  const outlineGo = (kind: 'step' | 'signpost', id: string): void => {
    outline?.open(kind, id);
    document.getElementById(kind === 'step' ? anchor.step(id) : anchor.stage(id))?.scrollIntoView({ behavior: isReduced() ? 'instant' : 'smooth', block: 'start' });
  };

  bus.on((event: HudEvent) => {
    switch (event.type) {
      case 'turn':
        if (atTable() && table) {
          if (event.step > 0) table.next('person');
          else table.previous('person');
        }
        break;
      case 'enter':
        enter({ reviews: event.reviews });
        break;
      case 'seek':
        if (machine.mode === 'list') break;
        goTo(walk?.progressFor({ along: event.along }) ?? null);
        break;
      case 'go':
        if (machine.mode === 'list') {
          if (event.waypointId) outlineGo('step', event.waypointId);
          else if (event.stageId) outlineGo('signpost', event.stageId);
        } else if (event.waypointId) goTo(walk?.progressFor({ waypointId: event.waypointId }) ?? null);
        else if (event.stageId) goTo(walk?.progressFor({ stageId: event.stageId, kind: 'signpost' }) ?? null);
        break;
      case 'step': {
        const list = walkStops();
        const next = event.step > 0 ? list.find((at) => at > target + 0.002) : [...list].reverse().find((at) => at < target - 0.002);
        if (next !== undefined) goTo(next);
        break;
      }
      case 'mode':
        if (event.mode === 'list') setList(true);
        else setList(false);
        break;
      case 'fold':
        startReturn(true);
        break;
      case 'home':
        if (machine.mode === 'list') setList(false);
        else if (machine.mode === 'walk' || machine.mode === 'finish') startReturn(true);
        else if (machine.mode === 'table') window.scrollTo({ top: 0, behavior: isReduced() ? 'instant' : 'smooth' });
        break;
      case 'start':
        if (machine.mode === 'table') sections?.go('start');
        break;
      case 'open':
        applyOpened(event.roadmap, event.source);
        break;
      case 'download':
        saveFile(`${event.roadmap.id}.roadmap.json`, `${JSON.stringify(event.roadmap, null, 2)}\n`, 'application/json');
        break;
      case 'insets':
        reframe();
        break;
      case 'teacher':
        break;
    }
  });

  finaleStart.addEventListener('click', () => {
    if (!session.progress.startedAt) session.start({ on: session.today() });
    goTo(hereProgress() ?? WALK_TOP, 2.4);
  });
  finalePrint.addEventListener('click', () => printView('trail-card', session, { ui: uiLang() }));
  finaleFold.addEventListener('click', () => startReturn(true));
  jump.addEventListener('click', () => goTo(hereProgress() ?? WALK_TOP, 1.2));
  langEn.addEventListener('click', () => setUiLang('en'));
  langDe.addEventListener('click', () => setUiLang('de'));

  onUiLang((lang) => {
    writeWords();
    table?.repaint(lang);
    void import('../sections').then(async (module) => {
      await module.loadSectionWords(lang);
      sections?.setLang(lang);
    });
    // The map's prints are in the interface language: it is built again when it is next needed.
    if (machine.mode === 'table' || machine.mode === 'list') {
      dropWalk();
      if (stage && started) wantWalk();
    }
    if (machine.mode === 'list') ensureOutline();
  });

  // -------------------------------------------------------------------------------------------------------
  // Pointer, wheel, keys, files.

  if (stage) {
    canvas.addEventListener('pointermove', (event) => {
      if (event.pointerType !== 'mouse') return;
      const now = performance.now();
      const dt = Math.max(1, now - pointer.lastAt) / 1000;
      pointer.speed = Math.hypot(event.clientX - pointer.lastX, event.clientY - pointer.lastY) / dt;
      pointer.lastX = event.clientX;
      pointer.lastY = event.clientY;
      pointer.lastAt = now;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.has = true;
    });
    canvas.addEventListener('pointerleave', () => {
      pointer.has = false;
    });
    let down: { x: number; y: number } | null = null;
    canvas.addEventListener('pointerdown', (event) => {
      down = { x: event.clientX, y: event.clientY };
    });
    canvas.addEventListener('pointerup', (event) => {
      const from = down;
      down = null;
      if (!from || !camera) return;
      const dx = event.clientX - from.x;
      const dy = event.clientY - from.y;
      const { width, height } = sizeOf();
      ndc.set((event.clientX / width) * 2 - 1, 1 - (event.clientY / height) * 2);
      if (atTable() && table && !introBusy()) {
        // A swipe: more than 40 px sideways and more than 1.3 times as far as it went up or down.
        if (Math.abs(dx) > 40 && Math.abs(dx) > 1.3 * Math.abs(dy)) {
          if (dx < 0) table.next('person');
          else table.previous('person');
          return;
        }
        if (Math.hypot(dx, dy) > 8) return;
        raycaster.setFromCamera(ndc, camera);
        table.click(raycaster.ray);
      } else if ((machine.mode === 'walk' || machine.mode === 'finish') && walk && Math.hypot(dx, dy) <= 8) {
        raycaster.setFromCamera(ndc, camera);
        const hit = walk.tap(raycaster.ray);
        if (hit?.kind === 'signpost' || hit?.kind === 'camp') goTo(walk.progressFor({ stageId: hit.stageId, kind: hit.kind }));
        else if (hit?.kind === 'cairn' && hit.waypointId) goTo(walk.progressFor({ waypointId: hit.waypointId }));
        else if (hit?.kind === 'pin') goTo(walk.progressFor({ along: deriveHere() }));
      }
    });
  }

  const stopOwnScroll = (event: Event): void => {
    if (locked()) {
      if (event.cancelable) event.preventDefault();
      return;
    }
    scrollAnim = null;
  };
  window.addEventListener('wheel', stopOwnScroll, { passive: false });
  window.addEventListener('touchmove', stopOwnScroll, { passive: false });
  window.addEventListener('keydown', (event) => {
    if (!locked()) return;
    if ([' ', 'PageDown', 'PageUp', 'Home', 'End', 'ArrowDown', 'ArrowUp'].includes(event.key)) event.preventDefault();
  });
  let lockY = 0;
  window.addEventListener(
    'scroll',
    () => {
      if (machine.mode === 'table' || machine.mode === 'boot') queueLanding();
      else if (machine.mode === 'dive' || machine.mode === 'return') {
        if (Math.abs(window.scrollY - lockY) > 1 && !returning?.swapped) scrollNow(lockY);
        else if (returning?.swapped) queueLanding();
      }
    },
    { passive: true },
  );
  machine.onChange((mode) => {
    lockY = window.scrollY;
    html.dataset.ztMode = mode;
  });
  window.addEventListener('resize', () => {
    reframe();
    queueLanding();
  });

  const hasFile = (event: DragEvent): boolean => [...(event.dataTransfer?.types ?? [])].includes('Files');
  let dragDepth = 0;
  window.addEventListener('dragenter', (event) => {
    if (!hasFile(event)) return;
    dragDepth += 1;
    html.dataset.ztDrop = '';
  });
  window.addEventListener('dragleave', (event) => {
    if (!hasFile(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) delete html.dataset.ztDrop;
  });
  window.addEventListener('dragover', (event) => {
    if (hasFile(event)) event.preventDefault();
  });
  window.addEventListener('drop', (event) => {
    if (!hasFile(event)) return;
    event.preventDefault();
    dragDepth = 0;
    delete html.dataset.ztDrop;
    if (machine.mode !== 'table' && machine.mode !== 'list') return;
    const files = event.dataTransfer?.files;
    if (!files || files.length !== 1) {
      toast(say('dropMany'));
      return;
    }
    const file = files[0] as File;
    file
      .text()
      .then((text) => {
        const result = readFileText(text, file.name);
        if (result.ok) hud.preview(result.roadmap, 'file', file.name);
        else toast(result.issues.length > 0 ? say('fileInvalid') : result.error, issueLines(result.issues));
      })
      .catch(() => toast(say('fileUnreadable')));
  });

  // -------------------------------------------------------------------------------------------------------
  // The frame.

  let slow = 0;
  let ratio = stage ? stage.renderer.getPixelRatio() : 1;
  const watchFill = (dt: number): void => {
    if (!stage || fixed) return;
    // Fill rate: thirty frames in a row over 20 ms lower the pixel ratio a step, down to 1.
    slow = dt > 0.02 ? slow + 1 : 0;
    if (slow < 30 || ratio <= 1) return;
    slow = 0;
    ratio = Math.max(1, ratio - 0.25);
    const { width, height } = sizeOf();
    stage.renderer.setPixelRatio(ratio);
    stage.renderer.setSize(width, height, false);
  };
  if (stage) {
    const renderer = stage.renderer;
    // After the stage's own observer: a resize keeps the lowered ratio.
    new ResizeObserver(() => {
      if (renderer.getPixelRatio() <= ratio) {
        ratio = Math.min(ratio, renderer.getPixelRatio());
        return;
      }
      const { width, height } = sizeOf();
      renderer.setPixelRatio(ratio);
      renderer.setSize(width, height, false);
    }).observe(canvas);
  }

  const writeDebug = (): void => {
    if (!debug.hud) return;
    const place = walk?.place;
    debugBox.textContent = [
      `mode ${machine.mode}   view ${html.dataset.ztView ?? ''}   t ${sceneT.toFixed(2)}`,
      `hx ${hx.toFixed(3)}   guard ${guardOpacity(hx).toFixed(2)}   p ${progress.x.toFixed(4)} -> ${target.toFixed(4)}`,
      `walk ${walk ? `${Math.round(walk.built * 100)} %${walkWarm ? ' warm' : ''}   fold ${walk.fold.toFixed(2)}   stage ${(place?.panel ?? 0) + 1}/${walk.plan.panels.length}` : 'none'}`,
      `queue ${queue.waiting.join(', ') || 'idle'}   ratio ${ratio.toFixed(2)}   scroll ${Math.round(window.scrollY)}/${Math.round(scrollRange())}`,
    ].join('\n');
  };

  const begin = (): void => {
    if (started) return;
    started = true;
    html.dataset.zt = 'ready';
    if (hudIntro) hud.playIntro();
  };

  const tick = (raw: FrameTime): void => {
    if (!stage || !table) return;
    if (!started) {
      // The intro waits for the third smooth frame in a row, or 2.2 s: the first frames still link shaders.
      waited += raw.dt;
      smoothFrames = raw.dt > 0 && raw.dt < 0.034 ? smoothFrames + 1 : 0;
      if (smoothFrames >= 3 || waited >= 2.2 || !playIntro) begin();
    }
    const dt = started ? raw.dt : 0;
    sceneT += dt;
    const frame: FrameTime = { dt, t: sceneT, reduced: raw.reduced };
    watchFill(raw.dt);
    if (started) queue.run();
    stepScroll(dt);
    switch (machine.mode) {
      case 'table':
      case 'boot':
        tickTable(frame, true);
        break;
      case 'dive':
      case 'cut':
      case 'landing':
        tickDive(frame);
        break;
      case 'walk':
      case 'finish':
        tickWalk(frame);
        break;
      case 'return':
        tickReturn(frame);
        break;
      case 'fade':
        tickFade(frame);
        break;
      case 'list':
        break;
    }
    hud.frame(sceneT);
    writeDebug();
  };

  const info = (): Info => {
    const data = table?.sheetData(table.selected) ?? null;
    const here = session.here();
    const pin = table && camera && table.object.visible ? table.pinScreen(camera) : null;
    const { width, height } = sizeOf();
    return {
      mode: machine.mode,
      history: [...machine.history],
      view: (html.dataset.ztView as View | undefined) ?? 'table',
      hx,
      p: progress.x,
      selected: table?.selected ?? 0,
      roadmap: session.roadmap.id,
      lang: uiLang(),
      scrollY: window.scrollY,
      away,
      walkReady: walkReady(),
      intro: introFrom === null ? null : sceneT - introFrom,
      here: here ? { stageId: here.stageId, waypointId: here.waypointId } : null,
      sheet: data ? { share: data.share, hereMinuteShare: data.hereMinuteShare, hereStage: data.hereStage, seed: String(data.terrain.seed), terrain: data.terrain.template, trail: data.trail.template, grow: table?.grow ?? 0 } : null,
      walker: walk && walk.object.visible ? { along: walk.along, item: itemKey(toHudItem(walk.activeItem)), panel: walk.place.panel, shown: walk.walkerShown } : null,
      walkHere: walk ? walk.here.panel : null,
      guard: Number(guard.style.opacity || 0),
      pin: pin ? { x: ((pin.x + 1) / 2) * width, y: ((1 - pin.y) / 2) * height, visible: pin.visible } : null,
    };
  };

  const advance = (seconds: number): Info => {
    const frames = Math.max(0, Math.round(seconds * 60));
    for (let index = 0; index < frames; index += 1) tick({ dt: 1 / 60, t: 0, reduced: isReduced() });
    if (stage && machine.mode !== 'list') stage.renderer.render(stage.scene, stage.camera);
    return info();
  };

  window.__zt = {
    get ready() {
      return html.dataset.zt === 'ready';
    },
    info,
    advance,
    get session() {
      return session;
    },
    get table() {
      return table;
    },
    get walk() {
      return walk;
    },
    hud,
    get sections() {
      return sections;
    },
  };

  if (pendingPreview) hud.preview(pendingPreview.roadmap, pendingPreview.source, pendingPreview.name);

  if (!stage) {
    html.dataset.zt = 'ready';
    return;
  }

  // -------------------------------------------------------------------------------------------------------
  // Start: fonts, the table, one compiled frame, then the loop.

  const fontReport = await fonts;
  table = createTable(stage.environment, {
    sheets: sheetSpecs(),
    intro: playIntro,
    autoTurn: opened === null && !fixed,
    lang: uiLang(),
    touch,
  });
  stage.scene.add(table.object);
  tableLamps = findLamps(table.object, ['lamp-key', 'lamp-bounce', 'lamp-compass-beam']);
  tintFor((entries[0] as TableEntry).roadmap, lampWant);
  lampTint.copy(lampWant);
  // The covers are printed again if a face arrived after the cap.
  if (fontReport.missing.length > 0) void document.fonts?.ready?.then(() => table?.repaint());

  table.onSelect((index, by) => {
    lastBy = by;
    hud.select(index);
    const entry = entries[index];
    if (entry) tintFor(entry.roadmap, lampWant);
  });
  table.onReadout((parts) => hud.setReadout(parts));
  table.onStand((index) => {
    if (index >= 0 && machine.mode === 'table') adopt(index);
  });
  table.onEnter((request) => enter(request.stage >= 0 ? { along: request.minuteShare } : {}));
  if (table.readout) hud.setReadout(table.readout);

  machine.go('table');
  reframe();
  try {
    stage.renderer.compile(stage.scene, stage.camera);
  } catch {
    // Compiling ahead is a kindness to the first frame, never a need.
  }
  scrollNow(0);
  if (playIntro) html.dataset.ztIntro = '';

  stage.onFrame(tick);

  if (debug.p !== null) {
    // Straight into the walk, through the fade that stands in for the dive.
    const wanted = debug.p;
    await loadWalk();
    prepareEnter({});
    await loadWalk();
    await Promise.resolve();
    queue.flush();
    machine.go('fade');
    landAt = wanted;
    crossed = false;
    begin();
    crossCut();
    setPhase(null);
    (walk as WalkPart | null)?.setLanding(null);
    (walk as WalkPart | null)?.setFold(null);
    machine.go('walk');
    scrollNow(walkScrollFor(wanted, scrollRange()));
    progress.x = wanted;
    target = wanted;
  } else if (debug.hx !== null) {
    await loadWalk();
    prepareEnter({});
    await loadWalk();
    await Promise.resolve();
    begin();
    machine.go('dive');
    setPhase('dive');
    hx = debug.hx;
  }

  void mountSections();

  if (fixed || debug.still) {
    begin();
    advance(debug.t ?? (debug.hx !== null || debug.p !== null ? 2 : 6));
    if (!debug.still) stage.start();
    return;
  }
  if (debug.t !== null) {
    begin();
    advance(debug.t);
  }
  stage.start();
  // The walk's code is fetched once the hero is on screen.
  setTimeout(() => void loadWalk(), 1500);
}
