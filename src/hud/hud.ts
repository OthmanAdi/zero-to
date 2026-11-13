/**
 * The overlay: everything the visitor reads and touches on top of the 3D scene.
 *
 * It places the learning components and never owns state of its own. Progress belongs to the session, the mode,
 * the table and the scroll belong to the director. The overlay says what the visitor asked for on the bus, and
 * the director answers through the setters here.
 */
import { onUiLang, uiLang } from '../i18n';
import { createBrand } from '../look/brand';
import { ensurePaperEdge } from '../look/dom';
import '../look/look.css';
import {
  classPlace,
  learnSay,
  notebookPanel,
  paceChoices,
  predictState,
  type GoDetail,
  type MountedCard,
  type Session,
} from '../learn';
import type { ScreenBox } from '../paper/motion';
import { resourcesFor, type ShelfEntry } from '../roadmap/derive';
import { emptyProgress, summarise, youAreHere, type Progress } from '../roadmap/progress';
import type { Roadmap } from '../roadmap/types';
import type { ShelfDock } from '../shelf';
import type { ReadoutParts } from '../table/readout';
import type { HudBus, HudBy, HudMode } from './bus';
import { createCounter, createCreaseArrow, createEnterButton, enterState, type EnterState } from './controls';
import { createPanel, fillOpen, fillShare, fillShortcuts, type OpenDialog, type Panel } from './dialogs';
import { el, prefersReducedMotion, setText, toolButton, typingTarget } from './dom';
import { createHero } from './hero';
import './hud.css';
import { NOTE, createNote, pickNoteSide, sideBox, type HudItem, type MiniMapMark, type NoteFrame, type NoteSide, type WeightedPoint } from './note';
import { createProfile, type Profile } from './profile';
import { shelfSessionOf } from './shelf-session';
import { createSideCard, pinStage, type HudRoadmap } from './side-card';
import { say } from './strings';

export interface HudOptions {
  /** Reduced motion: `true` forces it (`?motion=reduced`), a function is asked every time. Default: the media query. */
  readonly reducedMotion?: boolean | (() => boolean);
  /** Keep the table's copy and controls out of sight until `playIntro()`. Default false. */
  readonly intro?: boolean;
  /** Listen for the shortcuts of section 7.4 on the window. Default true. */
  readonly keys?: boolean;
  /** Build the resource shelf. Default true. */
  readonly shelf?: boolean;
  /** The address share links are built on. Default: this page. */
  readonly shareBase?: string;
  /** A touch screen: the hint says "tap". Default: read from the pointer media query. */
  readonly touch?: boolean;
  /** The mode to start in. Default `table`. */
  readonly mode?: HudMode;
}

export interface HudRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** A point in window pixels. */
export interface HudPoint {
  readonly x: number;
  readonly y: number;
}

/** Where the scene's own anchors are on screen. The overlay hangs its table controls on them. */
export interface HudAnchors {
  /** Between the foot of the compass and the far edge of the lit sheet. */
  readonly enter?: HudPoint | null;
  /** Left and right of the lit sheet. */
  readonly previous?: HudPoint | null;
  readonly next?: HudPoint | null;
}

/** What the director takes off the camera's screen box, and the boxes it was worked out from. */
export interface HudInsets {
  readonly viewport: { readonly width: number; readonly height: number };
  /** Pixels the overlay takes from each edge of the window in this mode. */
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
  /** The same as a screen box in normalised device coordinates, for `fitPose`. */
  readonly box: ScreenBox;
  /** The measured boxes, null where a part is not shown. */
  readonly parts: {
    readonly header: HudRect | null;
    readonly headline: HudRect | null;
    readonly hero: HudRect | null;
    readonly side: HudRect | null;
    readonly shelf: HudRect | null;
    readonly note: HudRect | null;
    readonly profile: HudRect | null;
  };
}

export interface Hud {
  readonly element: HTMLElement;
  readonly bus: HudBus;
  readonly mode: HudMode;
  readonly selected: number;
  readonly session: Session;
  /** Where the director hangs the section tabs, between the brand and the tools. */
  readonly navSlot: HTMLElement;
  readonly profile: Profile;
  readonly note: NoteFrame;
  /** The resource shelf, or null while its code is still on the way (it is fetched after the first frame's code). */
  readonly shelf: ShelfDock | null;
  /** Resolves with the shelf once its code has arrived and it stands, or with null when there is none. */
  whenShelf(): Promise<ShelfDock | null>;
  /** How often the side card's readout was written to the document. */
  readonly readoutWrites: number;

  setMode(mode: HudMode): void;
  /** The roadmaps on the table and the one in the light. */
  setRoadmaps(list: readonly HudRoadmap[], selected: number): void;
  /** Another roadmap came into the light. The card, the counter, the enter button and the shelf follow at once. */
  select(index: number): void;
  /** The session of the roadmap that is walked. Call it when another roadmap is entered. */
  setSession(session: Session): void;
  /** The table's readout. The document is touched only when its `key` changed. */
  setReadout(parts: ReadoutParts | null): void;
  /** What the walker stands on: a waypoint, a signpost, a camp, a review or nothing. */
  setActive(item: HudItem): void;
  /** Hangs the note at a side. */
  placeNote(side: NoteSide): void;
  /** Picks the emptier side from what the settled camera shows, and hangs the note there. Returns the side. */
  placeNoteBy(points: readonly WeightedPoint[]): NoteSide;
  /** Measures the overlay and returns what the director subtracts from the camera box. */
  setInsets(): HudInsets;
  /** The drawing of the active stage and the walker's pixel on it. Marks become buttons over the drawing. */
  setMiniMap(canvas: HTMLCanvasElement | null, pixel: HudPoint | null, marks?: readonly MiniMapMark[]): void;
  /** Where the walker is along the route, 0 to 1, and optionally on screen, so the note stays off him. */
  setWalker(along: number, screen?: HudPoint | null): void;
  setAnchors(anchors: HudAnchors): void;
  setTeacher(on: boolean): void;
  /** Plays the entrance of the table's copy and controls with the timings of the intro. */
  playIntro(): void;
  /** Steps what moves by itself (the note's float). `time` is seconds. */
  frame(time: number): void;
  openPanel(name: 'shortcuts' | 'share' | 'open' | 'notebook' | 'pace', opener?: HTMLElement | null): void;
  /** Closes the open panel. Returns true when there was one. */
  closePanel(): boolean;
  /** Shows the preview of a roadmap that arrived from outside (a link in the address, a dropped file). */
  preview(roadmap: Roadmap, source: 'link' | 'file', name?: string): void;
  destroy(): void;
}

/** When each part of the table's interface arrives, in milliseconds after the intro starts. */
export const INTRO = { headline: 1200, lede: 1700, hint: 2200, controls: 2400, enter: 2600, side: 2050 } as const;

const rectOf = (node: Element | null | undefined): HudRect | null => {
  if (!node || !(node as HTMLElement).isConnected) return null;
  const box = node.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return null;
  return { left: box.left, top: box.top, width: box.width, height: box.height };
};

/** The main volume of every stage, in route order, without repeats: what the shelf shows before any progress. */
export function mainVolumes(roadmap: Roadmap): ShelfEntry[] {
  const out: ShelfEntry[] = [];
  const seen = new Set<string>();
  for (const stage of roadmap.stages) {
    const entry = resourcesFor(roadmap, stage.id).find((e) => e.main && !seen.has(e.resource.id));
    if (!entry) continue;
    seen.add(entry.resource.id);
    out.push(entry);
  }
  return out;
}

/** What stands on the shelf while the table is shown: the stage of you-are-here once there is progress. */
export function tableVolumes(roadmap: Roadmap, progress: Progress): ShelfEntry[] {
  const here = youAreHere(roadmap, progress);
  if (here && summarise(roadmap, progress).doneWaypoints > 0) return resourcesFor(roadmap, here.stageId);
  return mainVolumes(roadmap);
}

/**
 * What stands on the shelf in the walk: the sources of the step the walker stands on. At a camp it is the
 * project's own shelf, at a signpost or on the open trail the whole stage's.
 */
export function walkVolumes(roadmap: Roadmap, item: HudItem, stageId: string | null): ShelfEntry[] {
  if (item?.kind === 'waypoint' || (item?.kind === 'review' && item.waypointId)) {
    return resourcesFor(roadmap, item.waypointId as string);
  }
  if (!stageId) return [];
  const stage = resourcesFor(roadmap, stageId);
  if (item?.kind === 'camp') {
    const project = stage.filter((entry) => entry.for === 'project');
    if (project.length > 0) return project;
  }
  return stage;
}

const SHELF_MAX = 7;

/**
 * From this width the full shelf (380 px at 46 from the right edge) stands clear of the list view's 820 px reading
 * column. The style sheet gives the profile strip the room of the folded shelf below it (hud.css, list view).
 */
export const LIST_DOCK_WIDE = 1680;

/**
 * The resource shelf and the Bookshelf modules under it are the largest part of the overlay, and the first frame
 * of the table does not need them. Their code is fetched on its own, once, and the shelf stands when it arrives.
 */
type ShelfLib = typeof import('../shelf');
let shelfLib: ShelfLib | null = null;
let shelfLoad: Promise<ShelfLib | null> | null = null;
const loadShelf = (): Promise<ShelfLib | null> =>
  (shelfLoad ??= import('../shelf').then(
    (lib) => (shelfLib = lib),
    (cause: unknown) => {
      // A failed fetch leaves the page without a shelf, not without an overlay. The next call tries again.
      shelfLoad = null;
      console.warn('zero-to: the resource shelf could not be loaded', cause);
      return null;
    },
  ));

export function createHud(root: HTMLElement, session: Session, bus: HudBus, options: HudOptions = {}): Hud {
  const reduced: () => boolean =
    typeof options.reducedMotion === 'function' ? options.reducedMotion : options.reducedMotion === true ? () => true : prefersReducedMotion;
  const touch = options.touch ?? (typeof matchMedia === 'function' && matchMedia('(hover: none)').matches);

  let current = session;
  let mode: HudMode = options.mode ?? 'table';
  let mapMode: Exclude<HudMode, 'list'> = mode === 'list' ? 'table' : mode;
  let list: readonly HudRoadmap[] = [];
  let selected = 0;
  let active: HudItem = null;
  let teacher = false;
  let walkerScreen: HudPoint | null = null;
  let dock: ShelfDock | null = null;
  let dockKey = '';
  let entriesKey = '';
  let unsubscribe: (() => void) | null = null;
  let introTimers: ReturnType<typeof setTimeout>[] = [];
  let destroyed = false;

  ensurePaperEdge(document);
  root.classList.add('zh-hud');
  root.lang = uiLang();
  if (options.reducedMotion === true) root.dataset.motion = 'reduced';

  // ---- Header
  const skip = el('a', { class: 'zh-skip', href: '#zt-outline' });
  skip.addEventListener('click', (event) => {
    event.preventDefault();
    bus.emit({ type: 'mode', mode: 'list' });
  });
  const brand = el('button', { type: 'button', class: 'zh-brand' }, createBrand(document, { size: 34, wordmark: 18 }));
  brand.addEventListener('click', () => bus.emit({ type: 'home' }));
  const navSlot = el('div', { class: 'zh-nav-slot' });

  const toggleList = (): void => bus.emit({ type: 'mode', mode: mode === 'list' ? mapMode : 'list' });
  const tools = {
    list: toolButton('list', '', toggleList),
    notebook: toolButton('notebook', '', () => openPanel('notebook', tools.notebook)),
    share: toolButton('share', '', () => openPanel('share', tools.share)),
    open: toolButton('open', '', () => openPanel('open', tools.open)),
    teacher: toolButton('teacher', '', () => {
      setTeacher(!teacher);
      bus.emit({ type: 'teacher', on: teacher });
    }),
    fold: toolButton('fold', '', () => bus.emit({ type: 'fold' })),
    help: toolButton('help', '', () => openPanel('shortcuts', tools.help)),
  };
  const count = el('span', { class: 'zh-tool-count', 'aria-hidden': 'true', hidden: true });
  tools.notebook.append(count);
  tools.teacher.setAttribute('aria-pressed', 'false');
  const toolbar = el('div', { class: 'zh-tools', role: 'toolbar' }, tools.list, tools.notebook, tools.share, tools.open, tools.teacher, tools.fold, tools.help);
  // A narrow window shows the one-word label, so the section tab beside it keeps its room. The name stays whole.
  const chipLabel = el('span', { class: 'zh-start-long' });
  const chipShort = el('span', { class: 'zh-start-short', 'aria-hidden': 'true' });
  const chip = el(
    'button',
    { type: 'button', class: 'zh-start zt-on-paper' },
    el('span', { class: 'zh-dot', 'aria-hidden': 'true' }),
    chipLabel,
    chipShort,
    el('span', { class: 'zh-start-arrow', 'aria-hidden': 'true' }, '→'),
  );
  chip.addEventListener('click', () => bus.emit({ type: 'start' }));
  const header = el('header', { class: 'zh-header' }, brand, navSlot, toolbar, chip);

  // ---- Table
  const hero = createHero(root, reduced);
  const previous = createCreaseArrow('previous', () => bus.emit({ type: 'turn', step: -1, by: 'arrow' }));
  const next = createCreaseArrow('next', () => bus.emit({ type: 'turn', step: 1, by: 'arrow' }));
  const enter = createEnterButton((state: EnterState) => bus.emit({ type: 'enter', reviews: state.kind === 'reviews' }), reduced);
  // The counter says which roadmap is in the light. It is text beside the arrows, not a picker.
  const counter = createCounter();
  const controls = el('div', { class: 'zh-controls' }, counter.element, previous.element, enter.element, next.element);
  const side = createSideCard(root, (opener) => openPanel('share', opener));

  // ---- Walk
  const onGo = (detail: GoDetail): void => bus.emit({ type: 'go', ...detail });
  const note = createNote(root, current, {
    onGo,
    onStep: (step) => bus.emit({ type: 'step', step }),
    reducedMotion: reduced,
    onChange: () => bus.emit({ type: 'insets' }),
  });
  const profileHost = el('div', { class: 'zh-profile-host' });
  let profile = buildProfile();
  const shelfHost = el('div', { class: 'zh-shelf' });
  const panels = el('div', { class: 'zh-panels' });

  // Order in the document is the order of the keyboard: skip link, brand, nav, tools, start chip, arrows and
  // enter button, side card, note, profile, shelf.
  root.append(skip, header, hero.element, controls, side.element, note.element, profileHost, shelfHost, panels);

  function buildProfile(): Profile {
    const titles: Record<string, string> = {};
    for (const stage of current.roadmap.stages) {
      titles[stage.id] = stage.title;
      for (const wp of stage.waypoints) titles[wp.id] = wp.title;
    }
    const built = createProfile(profileHost, current.trek, {
      titles,
      lang: current.roadmap.lang,
      onGo: (target) => bus.emit({ type: 'go', ...target }),
      onPaceOffer: (anchor) => openPanel('pace', anchor),
    });
    built.onSeek((along) => bus.emit({ type: 'seek', along }));
    return built;
  }

  // ---- Panels: built when first opened
  const built = new Map<string, Panel>();
  let openDialog: OpenDialog | null = null;
  let notebookCard: MountedCard | null = null;
  let paceCard: MountedCard | null = null;

  const panel = (name: string, kind: 'sheet' | 'drawer' = 'sheet'): Panel => {
    let found = built.get(name);
    if (!found) {
      found = createPanel(panels, kind, name);
      built.set(name, found);
    }
    return found;
  };

  const lit = (): HudRoadmap | null => list[selected] ?? null;
  const litRoadmap = (): Roadmap => (mode === 'table' ? (lit()?.roadmap ?? current.roadmap) : current.roadmap);

  function openPanel(name: 'shortcuts' | 'share' | 'open' | 'notebook' | 'pace', opener?: HTMLElement | null): void {
    closePanel();
    if (name === 'shortcuts') {
      const p = panel(name);
      fillShortcuts(p);
      p.open(opener);
    } else if (name === 'share') {
      const p = panel(name);
      const roadmap = litRoadmap();
      void fillShare(p, roadmap, {
        onDownload: (r) => bus.emit({ type: 'download', roadmap: r }),
        ...(options.shareBase !== undefined ? { base: options.shareBase } : {}),
      });
      p.open(opener);
    } else if (name === 'open') {
      const p = panel(name);
      openDialog = fillOpen(p, { onApply: (roadmap, source) => bus.emit({ type: 'open', roadmap, source }) });
      p.open(opener);
    } else if (name === 'notebook') {
      const p = panel(name, 'drawer');
      p.setTitle(learnSay('notebookTitle'));
      notebookCard?.destroy();
      notebookCard = notebookPanel(current, { headingLevel: 3, onGo });
      p.body.replaceChildren(notebookCard.root);
      p.open(opener);
    } else {
      const p = panel(name);
      p.setTitle(learnSay('paceTitle'));
      paceCard?.destroy();
      paceCard = paceChoices(current, { headingLevel: 3, always: true });
      p.body.replaceChildren(paceCard.root);
      p.open(opener);
    }
  }

  function closePanel(): boolean {
    let closed = false;
    for (const p of built.values()) {
      if (p.isOpen) {
        p.close();
        closed = true;
      }
    }
    return closed;
  }

  const anyPanelOpen = (): boolean => [...built.values()].some((p) => p.isOpen);

  // ---- Shelf
  const background = (): HTMLElement[] => [header, hero.element, controls, side.element, note.element, profileHost];

  const progressOf = (entry: HudRoadmap): Progress =>
    entry.roadmap.id === current.roadmap.id ? current.progress : (entry.progress ?? emptyProgress(entry.roadmap.id, entry.roadmap.checkedOn));

  const stageOfActive = (): string | null => {
    if (!active) return current.here()?.stageId ?? current.roadmap.stages[0]?.id ?? null;
    if (active.kind === 'waypoint' || active.kind === 'review') {
      const id = active.waypointId;
      const stage = id ? current.roadmap.stages.find((s) => s.waypoints.some((w) => w.id === id)) : undefined;
      return stage?.id ?? current.here()?.stageId ?? current.roadmap.stages[0]?.id ?? null;
    }
    return active.stageId;
  };

  let shelfWaiting: Promise<ShelfDock | null> | null = null;

  /** Fetches the shelf's code if it has not arrived yet, then puts the shelf up and says the insets changed. */
  const whenShelf = (): Promise<ShelfDock | null> => {
    if (options.shelf === false || destroyed) return Promise.resolve(null);
    if (shelfLib) return Promise.resolve(dock);
    return (shelfWaiting ??= loadShelf().then((lib) => {
      shelfWaiting = null;
      if (!lib || destroyed) return null;
      syncShelf();
      bus.emit({ type: 'insets' });
      return dock;
    }));
  };

  const syncShelf = (): void => {
    if (options.shelf === false || destroyed) return;
    const onTable = mode === 'table';
    const entry = onTable ? lit() : null;
    const roadmap = entry?.roadmap ?? current.roadmap;
    const own = roadmap.id === current.roadmap.id;
    let entries: ShelfEntry[];
    let present: string | null = null;
    let light = 1;
    if (onTable) {
      entries = tableVolumes(roadmap, entry ? progressOf(entry) : current.progress);
    } else {
      entries = walkVolumes(roadmap, active, stageOfActive());
      if (active?.kind === 'waypoint') {
        present = entries.find((e) => e.main)?.resource.id ?? null;
        // The shelf waits in half light until the predict question is answered or skipped.
        if (predictState(current, active.waypointId) === 'open') light = 0;
      }
    }
    entries = entries.slice(0, SHELF_MAX);
    // The place is held from the start, so the entrance of the table times the shelf as if it had always been there.
    shelfHost.hidden = entries.length === 0;
    const lib = shelfLib;
    if (!lib) {
      void whenShelf();
      return;
    }
    // In the list view the full shelf would stand over the reading column, so below LIST_DOCK_WIDE it is the round
    // button that opens the bottom sheet, as on a phone.
    const folded = mode === 'list';
    const key = `${roadmap.id}|${own ? 'session' : 'guest'}|${uiLang()}|${folded ? 'list' : 'map'}`;
    if (key !== dockKey) {
      if (dock) {
        dock.destroy();
        // A dock that goes takes `inert` off everything it was given as background, also the parts this mode
        // keeps out of the keyboard's path. They get it back here.
        syncParts();
      }
      shelfHost.replaceChildren();
      dockKey = key;
      entriesKey = '';
      dock = lib.createShelfDock(shelfHost, own ? shelfSessionOf(current) : lib.createMemorySession(roadmap), {
        ui: uiLang(),
        ...(options.reducedMotion === true ? { reducedMotion: true } : {}),
        ...(folded ? { phoneQuery: `(max-width: ${LIST_DOCK_WIDE - 1}px)` } : {}),
        background: background(),
      });
    }
    const nextKey = `${mode}|${entries.map((e) => e.resource.id).join(',')}|${present ?? ''}`;
    if (nextKey !== entriesKey) {
      entriesKey = nextKey;
      dock?.setEntries(entries, present);
    }
    dock?.setLit(light);
  };

  // ---- The note keeps off the walker
  let lastFrame = Number.NaN;
  let coveredFor = 0;
  let dodgedAt = Number.NEGATIVE_INFINITY;

  /**
   * The side of the note is chosen when a step is reached, but the camera goes on moving after that, and at a
   * camp it has already crossed to the next panel. So the note can come to lie over the walker. When he has
   * been under it for half a second it goes to the other side. A note that is being read stays where it is.
   */
  const keepOffWalker = (time: number): void => {
    const dt = Number.isFinite(lastFrame) ? Math.min(0.1, Math.max(0, time - lastFrame)) : 0;
    lastFrame = time;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const at = walkerScreen;
    if (!at || !note.item || viewport.width <= NOTE.narrow || time - dodgedAt < NOTE.dodge.rest) {
      coveredFor = 0;
      return;
    }
    const pad = 16;
    const column = sideBox(note.side, viewport, 0);
    let under = at.x >= column.left - pad && at.x <= column.left + column.width + pad;
    if (under) {
      const height = note.element.getBoundingClientRect().height || 420;
      under = at.y + NOTE.dodge.figure >= column.top - pad && at.y <= column.top + height + pad;
    }
    if (under && (note.element.matches(':hover') || note.element.contains(document.activeElement))) under = false;
    coveredFor = under ? coveredFor + dt : 0;
    if (coveredFor < NOTE.dodge.after) return;
    coveredFor = 0;
    dodgedAt = time;
    note.place(note.side === 'left' ? 'right' : 'left');
  };

  /** The stage the note's item belongs to, so the strip's readout names the same stage at a camp. */
  const stageOfItem = (item: HudItem): number | null => {
    if (!item || item.kind === 'review') return null;
    const stages = current.roadmap.stages;
    const index = item.kind === 'waypoint' ? stages.findIndex((stage) => stage.waypoints.some((wp) => wp.id === item.waypointId)) : stages.findIndex((stage) => stage.id === item.stageId);
    return index >= 0 ? index : null;
  };

  // ---- What follows the session
  /** The class flag: after the steps of the latest session dated today or earlier. The map stands its own there. */
  const syncClass = (): void => {
    const place = teacher || current.roadmap.class ? classPlace(current.roadmap, current.trek, current.today()) : null;
    profile.setClass(place ? place.along : null, place ? say('classSession', { n: place.session.n, title: place.session.title }) : '');
  };

  const syncEnter = (): void => {
    const entry = lit();
    if (!entry) {
      enter.set({ kind: 'walk' });
      return;
    }
    const own = entry.roadmap.id === current.roadmap.id;
    const pin = pinStage({ ...entry, progress: progressOf(entry) });
    enter.set(enterState(pin.started, pin.stage, pin.stages, own ? current.due().length : 0));
  };

  const syncSession = (): void => {
    const size = current.notebook.size;
    count.hidden = size === 0;
    setText(count, String(size));
    tools.notebook.setAttribute('aria-label', size > 0 ? say('notebookCount', { count: size }) : say('notebook'));

    const here = current.here();
    const hereAlong = here ? (current.trek.waypoints.find((w) => w.id === here.waypointId)?.along ?? 0) : 1;
    profile.setHere(hereAlong);
    const pace = current.pace();
    profile.setPace(pace.status === 'before-start' ? null : pace.expectedAlong, pace.arrival);
    profile.setOffer(pace.offer);
    profile.setDue(current.due().map((item) => ({ waypointId: item.waypointId, title: item.title })));
    syncClass();
    const ratings: Record<string, number> = {};
    for (const [id, wp] of Object.entries(current.progress.waypoints)) if (wp.done) ratings[id] = wp.rating ?? 0;
    profile.setRatings(ratings);

    const entry = lit();
    if (entry && entry.roadmap.id === current.roadmap.id) side.setRoadmap({ ...entry, progress: current.progress }, false);
    syncEnter();
    syncShelf();
  };

  const listen = (): void => {
    unsubscribe?.();
    unsubscribe = current.subscribe(() => syncSession());
  };

  // ---- Words
  const hasTeacher = (): boolean =>
    current.roadmap.class !== undefined || current.roadmap.stages.some((stage) => stage.waypoints.some((w) => w.teacherNote !== undefined));

  const nameTool = (button: HTMLButtonElement, name: string): void => {
    button.setAttribute('aria-label', name);
    button.title = name;
  };

  const syncTools = (): void => {
    const table = mode === 'table';
    const walk = mode === 'walk';
    nameTool(tools.list, say(mode === 'list' ? 'mapView' : 'listView'));
    tools.list.dataset.tool = mode === 'list' ? 'map' : 'list';
    tools.notebook.hidden = table;
    tools.share.hidden = table;
    tools.open.hidden = !table;
    tools.teacher.hidden = table || !hasTeacher();
    tools.fold.hidden = !walk;
    chip.hidden = !table;
  };

  const relabel = (): void => {
    root.lang = uiLang();
    setText(skip, say('skip'));
    brand.setAttribute('aria-label', say('home'));
    toolbar.setAttribute('aria-label', say('tools'));
    nameTool(tools.notebook, say('notebook'));
    nameTool(tools.share, say('share'));
    nameTool(tools.open, say('open'));
    nameTool(tools.teacher, say('teacher'));
    nameTool(tools.fold, say('fold'));
    nameTool(tools.help, say('shortcuts'));
    setText(chipLabel, say('startChip'));
    setText(chipShort, say('startChipShort'));
    chip.setAttribute('aria-label', say('startChip'));
    note.element.setAttribute('aria-label', say('note'));
    syncTools();
  };

  const syncHero = (): void => {
    // The headline is the opened roadmap's own title. With only examples on the table it is the site's line.
    const first = list[0];
    if (first && !first.example) hero.set({ title: first.roadmap.title, lang: first.roadmap.lang, lede: first.roadmap.summary ?? null, touch });
    else hero.set({ title: null, touch });
  };

  // ---- Modes
  const show = (node: HTMLElement, on: boolean): void => {
    node.toggleAttribute('data-off', !on);
    node.toggleAttribute('inert', !on);
  };

  /** Which parts the mode shows; the others fade and leave the keyboard's path. */
  function syncParts(): void {
    const table = mode === 'table';
    show(hero.element, table);
    show(controls, table);
    show(side.element, table);
    show(note.element, mode === 'walk');
    show(profileHost, !table);
  }

  function setMode(nextMode: HudMode): void {
    mode = nextMode;
    if (nextMode !== 'list') mapMode = nextMode;
    root.dataset.mode = nextMode;
    syncParts();
    syncTools();
    syncShelf();
    bus.emit({ type: 'insets' });
  }

  function setTeacher(on: boolean): void {
    teacher = on;
    tools.teacher.setAttribute('aria-pressed', on ? 'true' : 'false');
    root.toggleAttribute('data-teacher', on);
  }

  // ---- Keys (section 7.4)
  const onKey = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (anyPanelOpen() || dock?.isOpen) return;
    if (typingTarget(event.target)) return;
    const key = event.key;
    const act = (run: () => void): void => {
      event.preventDefault();
      run();
    };
    if (key === '?') return act(() => openPanel('shortcuts', tools.help));
    if (key === 'l' || key === 'L') return act(toggleList);
    if (key === 'n' || key === 'N') return act(() => openPanel('notebook', tools.notebook));
    if (key === 'b' || key === 'B') return act(() => (dock ? dock.focus() : void whenShelf().then((ready) => ready?.focus())));
    if (key === 'Escape') {
      if (mode !== 'walk') return;
      if (note.expanded) return act(() => note.setExpanded(false));
      return act(() => bus.emit({ type: 'fold' }));
    }
    // Arrow keys on a tab list, a slider or a group of radio buttons belong to that control.
    const target = event.target instanceof Element ? event.target : null;
    const inWidget = target?.closest('[role="tablist"], [role="radiogroup"], [role="slider"]') != null;
    if ((key === 'ArrowLeft' || key === 'ArrowRight') && !inWidget) {
      const step = key === 'ArrowLeft' ? -1 : 1;
      if (mode === 'table') return act(() => bus.emit({ type: 'turn', step, by: 'key' as HudBy }));
      if (mode === 'walk') return act(() => bus.emit({ type: 'step', step }));
      return;
    }
    if ((key === 'd' || key === 'D') && mode === 'walk' && active?.kind === 'waypoint') {
      const id = active.waypointId;
      return act(() => current.done(id, !(current.progress.waypoints[id]?.done === true)));
    }
    if (key === 'Enter' && mode === 'table' && (target === document.body || target === root)) {
      return act(() => bus.emit({ type: 'enter', reviews: enter.state.kind === 'reviews' }));
    }
  };
  if (options.keys !== false) window.addEventListener('keydown', onKey);

  const offLang = onUiLang(() => {
    relabel();
    hero.relabel();
    side.relabel();
    previous.relabel();
    next.relabel();
    counter.relabel();
    enter.relabel();
    note.relabel();
    profile.relabel();
    dockKey = '';
    syncSession();
  });

  const onResize = (): void => {
    hero.fit();
    side.fit();
    bus.emit({ type: 'insets' });
  };
  // Titles are fitted again once the display face has arrived, because it sets wider than the fallback.
  void document.fonts?.ready?.then(() => {
    if (!destroyed) onResize();
  });
  window.addEventListener('resize', onResize);

  // ---- Start
  relabel();
  syncHero();
  listen();
  setMode(mode);
  syncSession();
  if (options.intro) root.dataset.intro = 'wait';

  const hud: Hud = {
    element: root,
    bus,
    get mode() {
      return mode;
    },
    get selected() {
      return selected;
    },
    get session() {
      return current;
    },
    navSlot,
    get profile() {
      return profile;
    },
    note,
    get shelf() {
      return dock;
    },
    whenShelf,
    get readoutWrites() {
      return side.writes;
    },

    setMode,
    setRoadmaps(nextList, nextSelected) {
      list = nextList;
      selected = Math.max(0, Math.min(nextList.length - 1, nextSelected));
      counter.set(selected, list.length);
      const entry = lit();
      side.setRoadmap(entry ? { ...entry, progress: progressOf(entry) } : null);
      syncHero();
      syncEnter();
      syncShelf();
    },
    select(nextSelected) {
      const to = Math.max(0, Math.min(list.length - 1, nextSelected));
      if (to === selected) return;
      selected = to;
      counter.set(selected, list.length);
      const entry = lit();
      side.setRoadmap(entry ? { ...entry, progress: progressOf(entry) } : null);
      syncEnter();
      syncShelf();
    },
    setSession(nextSession) {
      if (nextSession === current) return;
      current = nextSession;
      active = null;
      note.setSession(current);
      profile.destroy();
      profile = buildProfile();
      listen();
      syncTools();
      syncSession();
    },
    setReadout(parts) {
      side.setReadout(parts);
    },
    setActive(item) {
      active = item;
      note.setActive(item);
      profile.setStage(stageOfItem(item));
      syncShelf();
    },
    placeNote(nextSide) {
      note.place(nextSide);
    },
    placeNoteBy(points) {
      const box = note.element.getBoundingClientRect();
      const nextSide = pickNoteSide(points, { width: window.innerWidth, height: window.innerHeight }, box.height || 420, note.side, walkerScreen);
      note.place(nextSide);
      return nextSide;
    },
    setInsets() {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const parts = {
        header: rectOf(header),
        headline: mode === 'table' ? rectOf(hero.headline) : null,
        hero: mode === 'table' ? rectOf(hero.element) : null,
        side: mode === 'table' ? rectOf(side.element) : null,
        shelf: shelfHost.hidden ? null : rectOf(shelfHost.firstElementChild),
        note: mode === 'walk' ? rectOf(note.element.querySelector('.zh-note-paper')) : null,
        profile: mode === 'table' ? null : rectOf(profile.element),
      };
      const top = parts.header ? parts.header.top + parts.header.height : 0;
      // The profile runs along the bottom, so the panel is fitted above it. On a phone the note's peek is below it.
      const bottom = parts.profile ? Math.max(0, height - parts.profile.top) : 0;
      const px = { top, right: 0, bottom, left: 0 };
      return {
        viewport: { width, height },
        ...px,
        box: {
          x0: -1 + (2 * px.left) / Math.max(1, width),
          x1: 1 - (2 * px.right) / Math.max(1, width),
          y0: -1 + (2 * px.bottom) / Math.max(1, height),
          y1: 1 - (2 * px.top) / Math.max(1, height),
        },
        parts,
      };
    },
    setMiniMap(canvas, pixel, marks) {
      note.setMiniMap(canvas, pixel, marks);
    },
    setWalker(along, screen) {
      profile.setWalker(along);
      if (screen !== undefined) walkerScreen = screen;
    },
    setAnchors(anchors) {
      const put = (name: string, point: HudPoint | null | undefined): void => {
        if (point === undefined) return;
        if (point === null) {
          root.style.removeProperty(`--zh-${name}-x`);
          root.style.removeProperty(`--zh-${name}-y`);
          return;
        }
        root.style.setProperty(`--zh-${name}-x`, `${Math.round(point.x * 10) / 10}px`);
        root.style.setProperty(`--zh-${name}-y`, `${Math.round(point.y * 10) / 10}px`);
      };
      put('enter', anchors.enter);
      put('prev', anchors.previous);
      put('next', anchors.next);
    },
    setTeacher,
    playIntro() {
      for (const timer of introTimers) clearTimeout(timer);
      introTimers = [];
      if (reduced()) {
        delete root.dataset.intro;
        return;
      }
      root.dataset.intro = 'play';
      introTimers.push(
        setTimeout(() => hero.pop(), INTRO.headline),
        setTimeout(() => enter.drop(), INTRO.enter),
        // Once everything has arrived the entrance classes go, so nothing is left to replay.
        setTimeout(() => delete root.dataset.intro, INTRO.enter + 2200),
      );
    },
    frame(time) {
      if (mode !== 'walk') return;
      note.frame(time);
      keepOffWalker(time);
    },
    openPanel,
    closePanel,
    preview(roadmap, source, name) {
      closePanel();
      const p = panel('open');
      openDialog = fillOpen(p, { onApply: (r, s) => bus.emit({ type: 'open', roadmap: r, source: s }) });
      openDialog.showPreview(roadmap, source, name);
      p.open(null);
    },
    destroy() {
      destroyed = true;
      for (const timer of introTimers) clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      offLang();
      unsubscribe?.();
      notebookCard?.destroy();
      paceCard?.destroy();
      for (const p of built.values()) p.destroy();
      dock?.destroy();
      note.destroy();
      profile.destroy();
      root.replaceChildren();
      root.classList.remove('zh-hud');
    },
  };
  return hud;
}
