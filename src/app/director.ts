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
import type { HydratedOutline } from '../outline';
import { clamp01, critDamp, easeInOutCubic, lerp, seg, smooth, spring, type CameraPose } from '../paper/motion';
import { loadProgressOrEmpty, serialiseProgress, type Progress } from '../roadmap/progress';
import { kelvinToHex, resolveTheme } from '../roadmap/themes';
import type { Roadmap } from '../roadmap/types';
import type { FrameTime } from '../scene/contract';
import { canUseWebGL, createStage, type Stage } from '../scene/stage';
import type { Sections, StartChoice } from '../sections';
import { COVER, HERO_CAMERA, INTRO, PIN, TURN, createHeroCamera, createTable, deriveSheet, isNarrow, sheetScale, type SheetSpec, type TablePart } from '../table';
import type { WalkItem, WalkPart } from '../walk';
import { createChooser } from './empty';
import { createLibrary, tableEntries, type TableEntry, type TableShows } from './library';
import { ROADMAP_ELEMENT_ID, RECEIPT_ELEMENT_ID, issueLines, pickSource, readDebug, readReceipt, readRoadmapText, readRoadmapValue } from './load';
import { createModeMachine, isLocked, viewOf, type Mode, type View } from './modes';
import { createBuildQueue } from './queue';
import { say } from './strings';
import {
  DIVE,
  FINALE,
  RETURN,
  RISE,
  SCROLL,
  WALK_TOP,
  WIPE,
  approachHx,
  diveSecondsAt,
  divePose,
  finaleOpacity,
  foldAt,
  guardOpacity,
  hxAt,
  isFinale,
  landingHandover,
  landingShare,
  mixPose,
  movePose,
  nearPlane,
  orbitMix,
  returnAt,
  riseHx,
  stretchViewports,
  walkProgressAt,
  walkScrollFor,
  wheelPixels,
  wipeCovered,
  wipeRadius,
} from './timeline';
import './app.css';

/**
 * Set to false by the build of the single-file viewer (`scripts/build-viewer.ts`). The viewer is the page the
 * skill writes one person's roadmap into, so it carries no gallery: none of the examples, and no way to them.
 * The hosted site and the dev server leave it unset, which means true.
 */
declare const __ZERO_TO_GALLERY__: boolean | undefined;
const GALLERY = typeof __ZERO_TO_GALLERY__ === 'undefined' || __ZERO_TO_GALLERY__;

/** How many examples lie on the table when it shows the gallery. */
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
  /** The compass on the screen, as a circle around its rings, in CSS pixels; null while the table is not drawn. */
  readonly compass: { readonly x: number; readonly y: number; readonly r: number } | null;
  /** Radius of the opening circle in percent while it opens, else null. */
  readonly wipe: number | null;
  /** How far the camera has risen out of the map, 0 at the gate and 1 on the table, while it rises; else null. */
  readonly rise: number | null;
  /** True while the lit mountain is held flat. */
  readonly flat: boolean;
  /** Opacity of the dark curtain. */
  readonly curtain: number;
  /** Device pixels per CSS pixel the canvas is drawn at. */
  readonly ratio: number;
  /** True while "Jump to where you are" is offered. */
  readonly jump: boolean;
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

/**
 * Marks the running page noindex, for a roadmap that came from a share link or an address: crawlers never read
 * the fragment, so such a page must not be indexed as the page it replaced. The outline package has the same
 * helper; it is written out here so the outline's code stays out of the first download.
 */
function setNoindex(): void {
  let tag = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
  if (!tag) {
    tag = document.createElement('meta');
    tag.name = 'robots';
    document.head.append(tag);
  }
  tag.content = 'noindex';
}

/** True when a key press belongs to a field or a widget that moves its own focus, not to the page. */
function ownKey(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return true;
  return target.closest('[role="tablist"], [role="radiogroup"], [role="slider"], dialog') !== null;
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
  /** The last message that stays until it is closed: what went wrong while loading. */
  let problem: { readonly text: string; readonly lines: readonly string[] } | null = null;
  const toast = (text: string, lines: readonly string[] = [], seconds = 9): void => {
    clearTimeout(toastTimer);
    if (seconds <= 0) problem = { text, lines };
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
  // Which roadmap, and what lies beside it.
  //
  // A roadmap that was given (a page built for it, a share link, an address, a file) lies on the table alone:
  // no examples beside it, nothing to turn to and no word of them in the sections. Only without one does the
  // table show the gallery, and only the hosted site carries it. Its examples are fetched when they are shown.

  type GalleryLib = typeof import('./gallery');
  let galleryModule: Promise<GalleryLib> | null = null;
  const loadGalleryLib = (): Promise<GalleryLib> | null => (GALLERY ? (galleryModule ??= import('./gallery')) : null);
  let samples: Roadmap[] = [];
  const byId = new Map<string, Roadmap>();
  const fetchGallery = async (): Promise<void> => {
    const lib = loadGalleryLib();
    if (!lib || samples.length > 0) return;
    try {
      samples = await (await lib).loadGallery();
    } catch (error) {
      console.error('zero-to: the gallery could not be loaded', error);
      samples = [];
    }
    for (const sample of samples) byId.set(sample.id, sample);
  };

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
  // The examples are on their way while the rest starts, when the page is going to show them.
  const galleryAhead = source.kind === 'gallery' || source.kind === 'sample' ? fetchGallery() : null;
  let opened: Roadmap | null = null;
  /** True while the table holds a roadmap that was given, false while it shows the gallery. */
  let given = false;
  let pendingPreview: { roadmap: Roadmap; source: 'link' | 'file'; name?: string } | null = null;
  const receipt = source.kind === 'inline' ? readReceipt(document.getElementById(RECEIPT_ELEMENT_ID)?.textContent) : null;
  /** The roadmap the receipt was written for: the one in the page. */
  let receiptFor = '';

  // The outline's code is fetched when it is needed: for the list view, a print, or a page without WebGL.
  type OutlineLib = typeof import('../outline');
  let outlineModule: Promise<OutlineLib> | null = null;
  let outlineLib: OutlineLib | null = null;
  const loadOutline = (): Promise<OutlineLib> =>
    (outlineModule ??= import('../outline').then((module) => {
      outlineLib = module;
      return module;
    }));

  if (source.kind === 'inline') {
    const result = readRoadmapText(source.text);
    if (result.ok) {
      opened = result.roadmap;
      receiptFor = opened.id;
      // An example's own page on the hosted site shows the gallery with that example in the light. Any other
      // page was built for this one roadmap: it is remembered, and it lies on the table alone.
      const lib = loadGalleryLib();
      if (lib && (await lib).GALLERY_IDS.includes(opened.id)) await fetchGallery();
      given = !byId.has(opened.id);
      if (given) library.add(opened);
    } else {
      toast(say(GALLERY ? 'inlineInvalid' : 'inlineInvalidAlone'), issueLines(result.issues), 0);
    }
  } else if (source.kind === 'sample') {
    await galleryAhead;
    opened = byId.get(source.id) ?? null;
    if (!opened) toast(say(GALLERY ? 'sampleMissing' : 'sampleMissingAlone', { id: source.id.slice(0, 60) }), [], 0);
  } else if (source.kind === 'link') {
    setNoindex();
    const result = await readLink(`#r=${source.fragment}`);
    if (result.ok) {
      const known = library.list().find((entry) => entry.id === result.roadmap.id);
      // The link's roadmap is what the page is for, so it lies on the table at once. One opened here before is
      // simply there. A new one is previewed first, and this browser keeps it only once the visitor opens it.
      given = true;
      if (known && JSON.stringify(known.roadmap) === JSON.stringify(result.roadmap)) {
        opened = known.roadmap;
      } else {
        opened = result.roadmap;
        pendingPreview = { roadmap: result.roadmap, source: 'link' };
      }
    } else {
      toast(`${say('linkInvalid')} ${result.error}`, issueLines(result.issues), 0);
    }
  } else if (source.kind === 'address') {
    setNoindex();
    try {
      const response = await fetch(source.url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
      const result = response.ok ? readRoadmapValue(await response.json()) : null;
      if (result?.ok) {
        given = true;
        opened = result.roadmap;
        pendingPreview = { roadmap: result.roadmap, source: 'file', name: source.url };
      } else {
        toast(say('addressFailed'), result ? issueLines(result.issues) : [], 0);
      }
    } catch {
      toast(say('addressFailed'), [], 0);
    }
  }
  if (!given) await fetchGallery();

  if (!given && samples.length === 0) {
    // Nothing to show: the viewer opened as it is, or with a roadmap that could not be read. It asks for one.
    html.dataset.zt = 'choose';
    const chooser = createChooser(document.body, library.list(), problem);
    chooser.element.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
    const choice = await chooser.chosen;
    chooser.destroy();
    toastHost.replaceChildren();
    delete html.dataset.zt;
    opened = choice.roadmap;
    given = true;
    if (choice.source === 'link') setNoindex();
    if (!library.add(opened)) toast(say('notKept'));
  }

  const shows = (): TableShows => (given && opened ? { kind: 'given', roadmap: opened } : { kind: 'gallery', first: opened });
  let entries: TableEntry[] = tableEntries(shows(), samples, SHEETS);
  /** The page says how many sheets lie on the table, and whose they are: with one there is nothing to turn to. */
  const markTable = (): void => {
    html.dataset.ztSheets = String(entries.length);
    html.dataset.ztTable = given ? 'given' : 'gallery';
  };
  markTable();
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
  // A page the hosted site wrote for the gallery (the root, the gallery page) carries the examples as its text.
  // Given a roadmap of its own (a share link, an address, a file) the page is that roadmap's: the examples go.
  const dropIndexText = (): void => {
    for (const index of outlineHost.querySelectorAll('[data-zo-home], [data-zo-gallery]')) index.remove();
  };
  if (given) dropIndexText();
  let outline: HydratedOutline | null = null;
  let outlineFor = '';
  let outlineLang = uiLang();
  /**
   * True while the list view is the gallery's index rather than one roadmap: a gallery page opened without the
   * map (no WebGL, or `?view=list`) before anybody chose an example. Each example is a link from there.
   */
  let indexShown = false;

  /** The site's root, from an example's own page or the gallery page as well as from the root itself. */
  const siteRoot = (): string => {
    const path = location.pathname;
    const at = path.search(/(?:roadmaps\/[^/]+|gallery)\/(?:index\.html)?$/);
    return at >= 0 ? path.slice(0, at) : path.replace(/[^/]*$/, '');
  };
  /** An example opened on this page by its id, keeping the page's other switches. */
  const exampleHref = (id: string, hash = ''): string => {
    const params = new URLSearchParams(location.search);
    params.set('road', id);
    return `?${params.toString()}${hash}`;
  };

  const showIndex = async (): Promise<void> => {
    const lib = await loadOutline();
    outline?.destroy();
    outline = null;
    outlineFor = '';
    // A built site has the index in the page already, written before any script ran. It stays as it is.
    const written = outlineHost.querySelector<HTMLElement>('[data-zo-home], [data-zo-gallery]');
    if (written && written.getAttribute('lang') === uiLang()) return;
    // Without it (the dev server, a build that was not prerendered, another language) it is written here, and
    // its links open each example on this page.
    const { toDom } = await import('../outline/tree');
    lib.ensureOutlineStyles(document);
    const tree = toDom(lib.galleryTree(samples, uiLang())) as HTMLElement;
    for (const link of tree.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      const match = /^(?:\.\.\/)?roadmaps\/([^/]+)\/(#.*)?$/.exec(link.getAttribute('href') ?? '');
      if (match?.[1]) link.setAttribute('href', exampleHref(match[1], match[2] ?? ''));
    }
    outlineHost.replaceChildren(tree);
    outlineLang = uiLang();
  };

  const ensureOutline = async (): Promise<void> => {
    html.toggleAttribute('data-zt-index', indexShown);
    syncListBar();
    if (indexShown) {
      await showIndex();
      return;
    }
    const lib = await loadOutline();
    const roadmap = session.roadmap;
    if (outline && outlineFor === roadmap.id && outlineLang === uiLang()) return;
    outline?.destroy();
    outline = null;
    const found = lib.findOutline(outlineHost);
    const usable = found && found.dataset.zoOutline === roadmap.id && found.dataset.zoHydrated === undefined && outlineLang === uiLang();
    if (!usable) outlineHost.replaceChildren(lib.renderOutline(roadmap, { ui: uiLang() }));
    outlineFor = roadmap.id;
    outlineLang = uiLang();
    try {
      outline = lib.hydrateOutline(outlineHost, session, { ui: uiLang() });
    } catch (error) {
      console.error(error);
    }
  };
  const showOutline = (): void => {
    void ensureOutline().catch((error: unknown) => console.error('zero-to: the list view could not be built', error));
  };

  // Above the list: a way to open another roadmap, and on the hosted site the way from an example back to all
  // of them. A given roadmap gets no word of the gallery.
  const listOpen = el('button', { type: 'button', class: 'zt-chip', 'data-plain': '' });
  const listExamples = el('a', { class: 'zt-chip', 'data-plain': '' });
  const listBar = el('nav', { class: 'zt-listbar' }, listExamples, listOpen);
  outlineHost.before(listBar);
  function syncListBar(): void {
    listBar.setAttribute('aria-label', say('listBar'));
    listOpen.textContent = say('listOpen');
    listExamples.textContent = say('listExamples');
    listExamples.hidden = !GALLERY || given || indexShown;
    listExamples.setAttribute('href', `${siteRoot()}${debug.list ? '?view=list' : ''}`);
  }
  syncListBar();

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
    receiptLine.textContent = receipt && receiptFor === roadmap.id ? say('receipt', { opened: receipt.opened, kept: receipt.kept, day: formatDay(receipt.checkedOn, { lang: uiLang() }) }) : '';
    syncListBar();
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
  let listReady: Promise<void> = Promise.resolve();
  if (!stage) {
    // No map: the roadmap as a list, with every learning control working.
    html.classList.remove('map-view');
    html.classList.add('no-webgl');
    hud.setMode('list');
    machine.go('list');
    html.dataset.ztView = 'list';
    // A gallery page without the map is the gallery's index, as its HTML already is. One roadmap's outline is
    // shown only once one was chosen: an example's own page, `?road=`, or a roadmap that was given.
    indexShown = !given && source.kind === 'gallery';
    listReady = ensureOutline().catch((error: unknown) => console.error('zero-to: the list view could not be built', error));
    if (!debug.list) toast(say(indexShown ? 'noWebglIndex' : 'noWebgl'), [], 12);
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
  /** The shorter approach of a roadmap whose map was not started yet, with its opening circle. */
  let crossing: { t: number } | null = null;
  let wipe: number | null = null;

  // Rising out of the map at the top of the walk, and scrolling back in.
  const rise = spring(0);
  let riseTarget = 0;
  let topFor = 0;
  let touchY: number | null = null;

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
  let returning: { t: number; fold: number | null; from: CameraPose | null; swapped: boolean; start: CameraPose | null } | null = null;
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

  /** The camera as the hero rig has just placed it, looking at the rig's own target. */
  const heroNow = (): CameraPose | null => {
    const pose = rig.pose;
    if (!camera || !pose) return null;
    const { x, y, z } = camera.position;
    return { position: { x, y, z }, target: pose.target, distance: Math.hypot(x - pose.target.x, y - pose.target.y, z - pose.target.z), fov: camera.fov };
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

  /** How much of the shelf dock's width the walk's screen box gives way to on a desktop. */
  const DOCK_GIVE = 0.45;
  const walkInsets = (): { bottom?: number; right?: number; narrow: boolean } => {
    const { width, height } = sizeOf();
    const narrow = isNarrow(width, height);
    const insets = hud.setInsets();
    if (hud.mode !== 'walk' || insets.bottom <= 0) return { narrow };
    const bottom = (2 * insets.bottom) / Math.max(1, height);
    // On a phone the strip lies over the cloth in front of the panel, and the narrow box already leaves room
    // under it: the panel keeps most of its size.
    if (narrow) return { bottom: Math.min(0.5, bottom * 0.6), narrow };
    // On a desktop the panel's front edge ends above the strip and its readout row, with a little air, so the
    // readout never lies on lit paper (the profile's box holds the readout row). The shelf dock stands in the
    // corner beside the strip: the box gives way to it on the right, so the panel's front corner stays clear of
    // it. Only part of the way, or the panel would slide under the note on the left.
    const dock = insets.parts.shelf;
    const right = dock && dock.top < height - insets.bottom ? (DOCK_GIVE * 2 * Math.max(0, width - dock.left)) / Math.max(1, width) : 0;
    return { bottom: Math.min(0.6, bottom + (2 * 10) / Math.max(1, height)), ...(right > 0 ? { right } : {}), narrow };
  };

  /** The lowest edge of the hero copy (headline, lede and hint) in CSS pixels, or null when none of it is laid out. */
  const copyBottom = (): number | null => {
    let bottom: number | null = null;
    for (const part of hudRoot.querySelectorAll<HTMLElement>('.zh-hero > :is(.zh-headline, .zh-lede, .zh-hint)')) {
      const box = part.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) bottom = Math.max(bottom ?? 0, box.bottom);
    }
    return bottom;
  };
  /** The top of the camera's screen box under a copy that ends at `bottom` px, in screen units, with a gap of 8 px. */
  const clearBelowOf = (bottom: number, height: number): number => 1 - (2 * (bottom + 8)) / height;
  /** The least share of a phone's height the scene keeps under the copy. Below it the lede keeps to two lines. */
  const SCENE_LEAST = 0.5;

  const reframe = (): void => {
    if (!stage) return;
    const { width, height } = sizeOf();
    if (table?.ready) {
      const narrow = isNarrow(width, height);
      let clearBelow: number | undefined;
      if (narrow) {
        // On a phone the scene starts under all of the copy, not only the headline, so the compass never lies on
        // the lede or the hint. When that leaves the scene less than about half of the screen, the lede is held
        // to two lines, measured again, and the scene starts under that.
        delete html.dataset.ztLede;
        let bottom = copyBottom();
        const scene = (at: number): number => (clearBelowOf(at, height) - HERO_CAMERA.textGap - HERO_CAMERA.narrow.box.y0) / 2;
        if (bottom !== null && scene(bottom) < SCENE_LEAST) {
          html.dataset.ztLede = 'short';
          bottom = copyBottom();
        }
        if (bottom !== null) clearBelow = clearBelowOf(bottom, height);
      } else {
        delete html.dataset.ztLede;
      }
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
    if (machine.mode === 'list') showOutline();
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
      // The walk asks the session's clock, so the class flag on the map and the strip agree on what today is.
      const part = module.createWalk(stage.environment, {
        roadmap,
        progress: session.progress,
        lang: uiLang(),
        number: index + 1,
        example: entries[index]?.example === true,
        today: () => session.today(),
      });
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

  /** What a roadmap can be taken away as, from the brief's upkeep stop: the roadmap that is open now. */
  const briefActions = {
    print: (): void => void loadOutline().then(({ printView }) => printView('trail-card', session, { ui: uiLang() })),
    share: (): void => hud.openPanel('share'),
    download: (): void => saveFile(`${session.roadmap.id}.roadmap.json`, `${JSON.stringify(session.roadmap, null, 2)}\n`, 'application/json'),
    markdown: (): void =>
      void loadOutline().then(({ roadmapToMarkdown }) =>
        saveFile(`${session.roadmap.id}.md`, roadmapToMarkdown(session.roadmap, { ui: uiLang(), teacher: false }), 'text/markdown;charset=utf-8'),
      ),
    progress: (): void => saveFile(`${session.roadmap.id}-progress.json`, `${serialiseProgress(session.progress)}\n`, 'application/json'),
  };

  /**
   * The permit at the brief's last stop is torn off: the start is kept with the learner's progress, and the walk
   * begins from the table, at the top of the page. The tear is seen first, then the page goes up and dives.
   */
  const startFromPermit = (choice: StartChoice): void => {
    session.start(choice);
    if (machine.mode !== 'table') return;
    const reduced = isReduced();
    window.setTimeout(
      () => {
        if (machine.mode !== 'table') return;
        if (reduced) scrollNow(0);
        else window.scrollTo({ top: 0, behavior: 'smooth' });
        const began = performance.now();
        const arrive = (): void => {
          if (machine.mode !== 'table') return;
          if (window.scrollY > 1 && performance.now() - began < 2600) {
            requestAnimationFrame(arrive);
            return;
          }
          scrollNow(0);
          // `enter` waits for the table to be in view, which the scroll handler finds out a frame later.
          showLanding();
          dive();
        };
        // The intro's clock stands still while the sections cover the table. Torn off before the intro had ended,
        // the permit waits for it to end, unless the visitor scrolls away from the table or goes elsewhere first.
        const dive = (): void => {
          if (machine.mode !== 'table' || away) return;
          if (introBusy()) {
            requestAnimationFrame(dive);
            return;
          }
          enter({});
        };
        requestAnimationFrame(arrive);
      },
      reduced ? 0 : 650,
    );
  };

  let sectionsToken = 0;
  const mountSections = async (): Promise<void> => {
    if (!stage) return;
    const token = (sectionsToken += 1);
    const module = await import('../sections');
    await module.loadSectionWords(uiLang());
    if (token !== sectionsToken) return;
    sections?.destroy();
    const live = location.protocol === 'http:' || location.protocol === 'https:';
    // A given roadmap: the stops are its trip brief, and nothing on the page speaks of the gallery.
    const own = given ? session.roadmap : null;
    const kept = own !== null && receipt !== null && receiptFor === own.id;
    sections = module.mountSections(sectionsRoot, {
      navHost: hud.navSlot,
      reduced: isReduced,
      topic: opened?.topic ?? '',
      roadmap: own,
      ...(own
        ? {
            ...(kept ? { receipt } : {}),
            plan: session.plan,
            onStart: startFromPermit,
            actions: briefActions,
          }
        : {
            examples: samples.map((sample) => ({ title: sample.title, lang: sample.lang, checkedOn: sample.checkedOn, ...(sample.freshness ? { freshness: sample.freshness } : {}) })),
            ...(live ? { links: { ...module.DEFAULT_LINKS, gallery: `${siteRoot()}gallery/` } } : {}),
          }),
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

  /**
   * The red over the frame. Across the cut it fades in and out with `hx`. On the shorter approach it opens as a
   * circle from the pin's place on the screen, and then holds while the map is finished.
   */
  const paintGuard = (): void => {
    if (wipe === null) {
      guard.style.opacity = String(guardOpacity(hx));
      if (guard.style.clipPath) guard.style.clipPath = '';
      return;
    }
    guard.style.opacity = '1';
    if (wipe >= WIPE.to || !table || !camera) {
      if (guard.style.clipPath) guard.style.clipPath = '';
      return;
    }
    const { width, height } = sizeOf();
    const pin = table.pinScreen(camera);
    const x = pin.visible ? ((pin.x + 1) / 2) * width : width / 2;
    const y = pin.visible ? ((1 - pin.y) / 2) * height : height / 2;
    guard.style.setProperty('--zt-guard-x', `${x.toFixed(1)}px`);
    guard.style.setProperty('--zt-guard-y', `${y.toFixed(1)}px`);
    guard.style.clipPath = `circle(${wipe.toFixed(3)}% at ${x.toFixed(1)}px ${y.toFixed(1)}px)`;
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
        if (hx > DIVE.guard.from - 0.03 || wipe !== null) sampleGuard();
      }
      paintGuard();
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
    paintGuard();
    // On the way down the walk's overlay comes in before the landing ends. Rising, the scroll decides.
    if (machine.mode !== 'rise' && u >= DIVE.overlayAt && html.dataset.ztPhase === 'land') {
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
    // A swap of the note takes 0.55 s, and a run of them would flicker. So the note changes when he has arrived at
    // a step (or has been on it for a while), and stays as it is for the steps he only passes on a long scroll.
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
    // How long the page has rested at the gate: only then does a scroll up lift the camera out of the map.
    topFor = window.scrollY <= 1 && Math.abs(target - WALK_TOP) < 1e-4 && Math.abs(progress.x - WALK_TOP) < 0.002 && !scrollAnim ? topFor + frame.dt : 0;
    if (p >= FINALE.shut && target >= FINALE.shut && !scrollAnim) startReturn(false);
  };

  // -------------------------------------------------------------------------------------------------------
  // Rising out of the map, and scrolling back in.

  const canRise = (): boolean => machine.mode === 'walk' && !isReduced() && !finaleOn && topFor >= RISE.dwell && walk !== null && walkReady() && table !== null && rig.pose !== null;

  /** Starts the rise from the gate. Returns false when the page is not resting at the gate. */
  const startRise = (): boolean => {
    if (!canRise() || !walk || !machine.go('rise')) return false;
    hud.closePanel();
    reviewItem = null;
    scrollAnim = null;
    rise.x = 0;
    rise.v = 0;
    riseTarget = 0;
    hx = 1;
    crossed = true;
    landAt = WALK_TOP;
    progress.x = WALK_TOP;
    progress.v = 0;
    target = WALK_TOP;
    guardSampled = false;
    jump.removeAttribute('data-on');
    walk.setFold(1);
    walk.setProgress(landAt);
    setPhase('land');
    return true;
  };

  /** Moves the rise by a scroll of `pixels`: up is positive. The band is RISE.band windows long. */
  const riseBy = (pixels: number): void => {
    riseTarget = clamp01(riseTarget + pixels / Math.max(1, RISE.band * window.innerHeight));
  };

  /** Back down at the gate: the walk takes over the scroll again. */
  const landFromRise = (): void => {
    if (!walk) return;
    rise.x = 0;
    rise.v = 0;
    riseTarget = 0;
    hx = 1;
    machine.go('walk');
    guard.style.opacity = '0';
    walk.setLanding(null);
    walk.setFold(null);
    walk.aim(null);
    walk.setLight(1);
    walk.setProgress(WALK_TOP);
    progress.x = WALK_TOP;
    progress.v = 0;
    target = WALK_TOP;
    topFor = 0;
    lastItem = '';
    lastPixel = '';
    setPhase(null);
    feedHud(ZERO, true);
  };

  const tickRise = (frame: FrameTime): void => {
    if (frame.reduced) {
      rise.x = riseTarget;
      rise.v = 0;
    } else {
      critDamp(rise, riseTarget, SCROLL.omega, Math.min(frame.dt, 0.034));
    }
    rise.x = clamp01(rise.x);
    hx = riseHx(rise.x);
    if (window.scrollY > 0) scrollNow(0);
    applyHx(frame);
    // The whole overlay steps back while the camera is between the map and the table, on either side of the cut.
    if (html.dataset.ztPhase !== 'land') setPhase('land');
    if (riseTarget <= 0 && rise.x < 0.002) {
      landFromRise();
    } else if (riseTarget >= 1 && rise.x > 0.996) {
      // All the way out: the table, as the landing page has it.
      rise.x = 1;
      swapToTable();
      machine.go('table');
    }
  };

  /** A scroll of `pixels` (up is positive) from the visitor. True when the rise took it. */
  const riseScroll = (pixels: number): boolean => {
    if (machine.mode === 'rise') {
      riseBy(pixels);
      return true;
    }
    if (pixels > 0 && machine.mode === 'walk' && startRise()) {
      riseBy(pixels);
      return true;
    }
    return false;
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
    // A roadmap whose map was never started, because it was picked a moment ago or nobody had shown interest.
    const fresh = table !== null && entries[table.selected]?.roadmap.id !== walkFor;
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
    crossing = fresh ? { t: 0 } : null;
    wipe = null;
  };

  const introBusy = (): boolean => introFrom !== null && sceneT - introFrom < INTRO.grow;

  const tickDive = (frame: FrameTime): void => {
    if (debug.hx === null && crossing && !crossed) {
      // The shorter approach: the map is built while the camera falls, the red opens from the pin and holds
      // until the map is ready, at most `DIVE.hold` more. Then the dive goes on from the cut as usual.
      crossing.t += frame.dt;
      hx = approachHx(crossing.t);
      wipe = wipeRadius(crossing.t);
      if (wipeCovered(crossing.t)) {
        if (!walkReady()) {
          held += frame.dt;
          if (held >= DIVE.hold) queue.flush();
        }
        if (walkReady() && walk) {
          landAt = landingProgress();
          crossCut();
          crossing = null;
          wipe = null;
          hx = DIVE.cut;
          diveT = diveSecondsAt(DIVE.cut);
        }
      }
    } else if (debug.hx === null) {
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

  /**
   * The table takes the map's place: the page is the landing page again, at its top, with the same roadmap in
   * the light. The intro is not played again. `keepPhase` leaves the overlay hidden while the camera still moves.
   */
  const swapToTable = (keepPhase = false): void => {
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
    wipe = null;
    crossing = null;
    guard.style.opacity = '0';
    if (sheetsStale) {
      sheetsStale = false;
      table.setSheets(sheetSpecs(), table.selected);
      hud.setRoadmaps(hudList(), table.selected);
    }
    table.setExit(0);
    hud.setActive(null);
    hud.setMode('table');
    if (!keepPhase) setPhase(null);
    reframe();
    sections?.measure();
    showLanding();
  };

  /**
   * The camera that looks at the shut map in the walk's space, moved to look at the lit sheet on the table with
   * the same picture. The map's middle is the walk's origin; the lit sheet lies at the slot, a little smaller.
   */
  const ontoTable = (pose: CameraPose): CameraPose => {
    const across = walkLib ? COVER.body.width / walkLib.PANEL.width : 1;
    return movePose(pose, sheetScale(table?.count ?? 5) * across, { x: 0, y: 0, z: TURN.radius });
  };

  function startReturn(byHand: boolean): void {
    if (machine.mode !== 'walk' && machine.mode !== 'finish') return;
    hud.closePanel();
    if (isReduced()) {
      machine.go('fade');
      fade = { t: 0, half: false, then: 'table', action: () => swapToTable() };
      return;
    }
    machine.go('return');
    setPhase('leave');
    scrollAnim = null;
    returning = { t: 0, fold: byHand && walk && walk.fold > 0.02 ? 0 : null, from: poseNow(), swapped: false, start: null };
  }

  const tickReturn = (frame: FrameTime): void => {
    const state = returning;
    if (!state || !walk || !table) return;
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
        state.from = shut;
        state.t = RETURN.wait * 0.6;
      }
      return;
    }
    state.t += frame.dt;
    const at = returnAt(state.t);
    curtain.style.opacity = at.curtain.toFixed(3);
    if (!at.swapped) {
      // The map lies shut. The room dims a little and the map's own lamp with it.
      walk.setLight(at.light);
      walk.update(frame);
      const shut = walk.cameraAt(1);
      applyPose(shut);
      setFog(shut.distance);
      state.from = shut;
      return;
    }
    if (!state.swapped) {
      // Under the dimmed curtain the shut map becomes the lit sheet on the table, flat in its print, seen by the
      // same camera. From here on it is one camera move back to the hero shot.
      state.swapped = true;
      state.start = ontoTable(state.from ?? walk.cameraAt(1));
      swapToTable(true);
      table.holdFlat(true, true);
    }
    if (at.grow && table.flat) table.holdFlat(false);
    tickTable(frame, false);
    const hero = heroNow();
    if (state.start && hero) applyPose(orbitMix(state.start, hero, at.move));
    if (at.done) {
      returning = null;
      curtain.style.opacity = '0';
      if (table.flat) table.holdFlat(false);
      setPhase(null);
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
      hud.setMode('list');
      scrollNow(0);
      void ensureOutline()
        .then(() => {
          if (machine.mode !== 'list') return;
          const heading = outlineHost.querySelector<HTMLElement>('h1');
          if (heading) {
            heading.tabIndex = -1;
            heading.focus({ preventScroll: true });
          }
        })
        .catch((error: unknown) => console.error('zero-to: the list view could not be built', error));
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
    if (from === 'link') setNoindex();
    // The roadmap of a link or an address lies on the table already while its preview is read: opening it keeps it.
    const there = given && opened !== null && opened.id === roadmap.id && session.roadmap.id === roadmap.id && JSON.stringify(opened) === JSON.stringify(roadmap);
    opened = roadmap;
    given = true;
    indexShown = false;
    dropIndexText();
    if (!there) {
      // From now on the table holds this roadmap alone, and the page is about it: no examples, no turning.
      entries = tableEntries(shows(), samples, SHEETS);
      markTable();
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
      writeWords();
      if (machine.mode === 'list' || !stage) showOutline();
      else wantWalk();
      // The stops become the roadmap's trip brief, and the footer loses the gallery.
      void mountSections();
    }
    setTitle();
    toast(say('opened', { title: roadmap.title }), [], 5);
    // The preview's dialog closes after this. When it had nothing to give the focus back to, the focus goes to
    // where the page goes on from: the enter button, or the list's heading.
    setTimeout(() => settleFocus(machine.mode === 'list' ? 'list' : 'table', true), 0);
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
    void loadOutline().then(({ anchor }) => {
      outline?.open(kind, id);
      document.getElementById(kind === 'step' ? anchor.step(id) : anchor.stage(id))?.scrollIntoView({ behavior: isReduced() ? 'instant' : 'smooth', block: 'start' });
    });
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
        // Half way out of the map already: the rest of the way out.
        if (machine.mode === 'rise') riseTarget = 1;
        else startReturn(true);
        break;
      case 'home':
        if (machine.mode === 'list') setList(false);
        else if (machine.mode === 'rise') riseTarget = 1;
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
  listOpen.addEventListener('click', () => hud.openPanel('open', listOpen));
  finalePrint.addEventListener('click', () => void loadOutline().then(({ printView }) => printView('trail-card', session, { ui: uiLang() })));
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
    if (machine.mode === 'list') showOutline();
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
        // The class flag stands where the class is today: a tap walks there.
        else if (hit?.kind === 'flag' && walk.classAlong !== null) goTo(walk.progressFor({ along: walk.classAlong }));
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
  // At the gate the scroll goes on upward, out of the map, and back down in. The page itself stays at its top
  // meanwhile, so the wheel, a finger and the keys move the rise instead of the document.
  window.addEventListener(
    'wheel',
    (event) => {
      if (event.deltaY !== 0 && riseScroll(-wheelPixels(event.deltaY, event.deltaMode, window.innerHeight))) {
        if (event.cancelable) event.preventDefault();
        return;
      }
      stopOwnScroll(event);
    },
    { passive: false },
  );
  window.addEventListener(
    'touchstart',
    (event) => {
      touchY = event.touches.length === 1 ? (event.touches[0]?.clientY ?? null) : null;
    },
    { passive: true },
  );
  window.addEventListener(
    'touchmove',
    (event) => {
      const y = event.touches.length === 1 ? (event.touches[0]?.clientY ?? null) : null;
      // A finger moving down scrolls the page up.
      const pixels = y !== null && touchY !== null ? y - touchY : 0;
      touchY = y;
      if (pixels !== 0 && riseScroll(pixels)) {
        if (event.cancelable) event.preventDefault();
        return;
      }
      if (machine.mode === 'rise' && event.cancelable) event.preventDefault();
      stopOwnScroll(event);
    },
    { passive: false },
  );
  window.addEventListener('touchend', () => {
    touchY = null;
  });
  const KEY_SCROLL = [' ', 'PageDown', 'PageUp', 'Home', 'End', 'ArrowDown', 'ArrowUp'];
  window.addEventListener('keydown', (event) => {
    if ((machine.mode === 'rise' || machine.mode === 'walk') && KEY_SCROLL.includes(event.key) && !event.defaultPrevented && !ownKey(event) && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const page = window.innerHeight * RISE.page;
      const up = event.key === 'ArrowUp' || event.key === 'PageUp' || event.key === 'Home' || (event.key === ' ' && event.shiftKey);
      const pixels = event.key === 'Home' || event.key === 'End' ? Number.POSITIVE_INFINITY : event.key.startsWith('Arrow') ? RISE.line : page;
      if (riseScroll(up ? pixels : -pixels)) {
        event.preventDefault();
        return;
      }
    }
    if (!locked()) return;
    if (KEY_SCROLL.includes(event.key)) event.preventDefault();
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

  // -------------------------------------------------------------------------------------------------------
  // Where the keyboard is after the view changes. A part that steps back takes the focus with it, so the focus
  // goes to where the page goes on from: the note on the map, the enter button on the table, the list tool after
  // the list view. Only when it was lost, or when a key started the change; a click keeps its own place.

  /** True when the last thing the visitor did was press a key, false after a pointer or the wheel. */
  let keyed = false;
  /**
   * True when a control held the focus as the change began. The browser hands the focus to the page as soon as
   * that control is made inert, so by the end only this remembers that the focus was lost rather than never set.
   */
  let heldFocus = false;
  window.addEventListener('keydown', () => (keyed = true), true);
  for (const type of ['pointerdown', 'wheel'] as const) window.addEventListener(type, () => (keyed = false), { capture: true, passive: true });

  type FocusPlace = 'walk' | 'table' | 'list' | 'back';
  const focusTarget = (place: FocusPlace): HTMLElement | null => {
    let target: HTMLElement | null = null;
    if (place === 'walk') target = hudRoot.querySelector<HTMLElement>('.zh-note-title');
    else if (place === 'table') target = hudRoot.querySelector<HTMLElement>('.zh-enter');
    else if (place === 'list') target = outlineHost.querySelector<HTMLElement>('h1');
    else target = hudRoot.querySelector<HTMLElement>('.zh-tool[data-tool="list"]');
    // A heading takes the focus without joining the order of the Tab key.
    if (target && (place === 'walk' || place === 'list') && !target.hasAttribute('tabindex')) target.tabIndex = -1;
    return target;
  };
  /** `closed`: a dialog that held the focus has just closed and gave it to the page. */
  function settleFocus(place: FocusPlace, closed = false): void {
    const active = document.activeElement;
    const onPage = !(active instanceof HTMLElement) || active === document.body || active === html;
    const lost =
      onPage ||
      !(active as HTMLElement).isConnected ||
      (active as HTMLElement).closest('[inert], [data-off], [hidden]') !== null ||
      (active as HTMLElement).getClientRects().length === 0 ||
      getComputedStyle(active as HTMLElement).visibility === 'hidden';
    const held = heldFocus;
    heldFocus = false;
    if (!lost || (onPage && !keyed && !closed && !held)) return;
    const target = focusTarget(place);
    if (target) giveFocus(target, 8);
  }
  /** Focuses a part that may still be on its way in: a hidden one cannot take the focus, so it is tried again. */
  const giveFocus = (target: HTMLElement, tries: number): void => {
    const ready = target.isConnected && target.getClientRects().length > 0 && getComputedStyle(target).visibility !== 'hidden' && !target.closest('[inert]');
    // The ring shows when a key started it; after a click the focus moves without one, where browsers allow.
    if (ready) target.focus({ preventScroll: true, focusVisible: keyed });
    else if (tries > 0) setTimeout(() => giveFocus(target, tries - 1), 100);
  };
  machine.onChange((mode, previous) => {
    if (mode === 'dive' || mode === 'fade' || mode === 'return' || mode === 'rise' || mode === 'list') {
      const active = document.activeElement;
      heldFocus = active instanceof HTMLElement && active !== document.body && active !== html;
    }
    let place: FocusPlace | null = null;
    if (mode === 'walk' && (previous === 'landing' || previous === 'fade')) place = 'walk';
    else if (mode === 'table' && (previous === 'return' || previous === 'fade' || previous === 'rise')) place = 'table';
    else if (previous === 'list' && mode !== 'list') place = 'back';
    // After the frame's own work: the landing hands over the note, the list view puts the map back.
    if (place) setTimeout(() => settleFocus(place), 0);
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
      case 'rise':
        tickRise(frame);
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
    let compass: Info['compass'] = null;
    if (table && camera && table.object.visible) {
      // The table hands out the compass's top, bottom and four sides last among the points it is framed by.
      const screen = table
        .framePoints()
        .slice(-6)
        .map((point) => {
          scratch.set(point.x, point.y, point.z).project(camera);
          return { x: ((scratch.x + 1) / 2) * width, y: ((1 - scratch.y) / 2) * height };
        });
      const x = screen.reduce((sum, point) => sum + point.x, 0) / screen.length;
      const y = screen.reduce((sum, point) => sum + point.y, 0) / screen.length;
      compass = { x, y, r: Math.max(...screen.map((point) => Math.hypot(point.x - x, point.y - y))) };
    }
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
      compass,
      wipe,
      rise: machine.mode === 'rise' ? rise.x : null,
      flat: table?.flat ?? false,
      curtain: Number(curtain.style.opacity || 0),
      ratio: stage ? stage.renderer.getPixelRatio() : 1,
      jump: jump.hasAttribute('data-on'),
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
    await listReady;
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
