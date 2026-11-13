/**
 * The floating note: the sheet of paper that follows the walker. It is a working card, not a caption.
 *
 * The frame is ours (tape, the hour ribbon, the title, the mini map, the tabs, the data row). What is inside is
 * the learning card of the step, the signpost, the camp or the review, built by the learning package and shown
 * here in a compact form: one part at a time, on the tabs Note, Do and Take with you.
 *
 * On a wide window the note hangs at the emptier side of the map, a little crooked, and straightens when the
 * visitor reaches for it. On a phone it is a bottom sheet with a peek of kicker and title.
 */
import { uiLang } from '../i18n';
import { formatHours, formatNumber, roundHours } from '../look/format';
import {
  campCard,
  findStage,
  findWaypoint,
  reviewCard,
  signpostCard,
  waypointCard,
  type GoDetail,
  type MountedCard,
  type Session,
} from '../learn';
import type { TrekStage } from '../roadmap/derive';
import { el, fitLines, icon, prefersReducedMotion, setRoadText, setText, uid } from './dom';
import { say } from './strings';

/** What the walker stands on. `null` is the open trail before the first step. */
export type HudItem =
  | { readonly kind: 'waypoint'; readonly waypointId: string }
  | { readonly kind: 'signpost'; readonly stageId: string }
  | { readonly kind: 'camp'; readonly stageId: string }
  | { readonly kind: 'review'; readonly waypointId: string | null }
  | null;

export type NoteSide = 'left' | 'right';
export type NoteTab = 'note' | 'do' | 'take';

export const NOTE_TABS: readonly NoteTab[] = ['note', 'do', 'take'];

/** The numbers of the note that are behaviour, not taste. */
export const NOTE = {
  /** Distance from the window's side and top on a wide window. */
  margin: 40,
  top: 82,
  maxWidth: 340,
  widthShare: 0.29,
  /** Resting tilt in degrees and the float: `y = sin(0.8 t) * 4 px`, `rot = sin(0.55 t + 1.3) * 0.6 deg`. */
  tilt: -1.2,
  floatY: 4,
  floatRot: 0.6,
  /**
   * Swap: a turn of the sheet. The step that was there stays readable until the next one is ready, the sheet
   * turns away with it in `out` ms and comes back with the new step in `turn` ms. The paper is never shown bare.
   */
  out: 170,
  turn: 380,
  /** A move to the other side takes 1.4 s. */
  move: 1400,
  /** The mini map is drawn 560 px wide. The walker's dot is W/70 and its halo W/34. */
  mapWidth: 560,
  mapHeight: 300,
  dot: 1 / 70,
  halo: 1 / 34,
  /** Phone: the peek, and how much of the height the open sheet takes. */
  peek: 96,
  sheetShare: 0.7,
  /** Below this width the note is a bottom sheet. */
  narrow: 760,
  /**
   * A note that has come to lie over the walker goes to the other side once he has been under it for `after`
   * seconds, and then stays for `rest` seconds whatever happens. `figure` is how far below the top of his hat
   * the walker still counts, in pixels.
   */
  dodge: { after: 0.5, rest: 2.4, figure: 64 },
} as const;

export function itemKey(item: HudItem): string {
  if (!item) return '';
  return item.kind === 'waypoint' || item.kind === 'review' ? `${item.kind}:${item.waypointId ?? ''}` : `${item.kind}:${item.stageId}`;
}

/** The note's width on a wide window. */
export function noteWidth(viewportWidth: number): number {
  return Math.min(NOTE.maxWidth, viewportWidth * NOTE.widthShare);
}

export interface WeightedPoint {
  readonly x: number;
  readonly y: number;
  /** Trail signs weigh 40, route points 6, props up to 3. */
  readonly weight: number;
}

export interface SideBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** The box the note takes at a side, for a window and a note height. */
export function sideBox(side: NoteSide, viewport: { readonly width: number; readonly height: number }, height: number): SideBox {
  const width = noteWidth(viewport.width);
  return { left: side === 'left' ? NOTE.margin : viewport.width - NOTE.margin - width, top: NOTE.top, width, height };
}

/**
 * The emptier side wins. `points` are what the settled camera shows of the active panel (route, signs, props),
 * in window pixels. The walker's own point is never covered: a side that holds it loses at once. A tie keeps
 * the side the note is on, so it does not wander.
 */
export function pickNoteSide(
  points: readonly WeightedPoint[],
  viewport: { readonly width: number; readonly height: number },
  height: number,
  current: NoteSide = 'left',
  walker: { readonly x: number; readonly y: number } | null = null,
  pad = 16,
): NoteSide {
  const score = (side: NoteSide): number => {
    const box = sideBox(side, viewport, height);
    const inside = (p: { readonly x: number; readonly y: number }): boolean =>
      p.x >= box.left - pad && p.x <= box.left + box.width + pad && p.y >= box.top - pad && p.y <= box.top + box.height + pad;
    if (walker && inside(walker)) return Number.POSITIVE_INFINITY;
    let sum = 0;
    for (const point of points) if (inside(point)) sum += point.weight;
    return sum;
  };
  const left = score('left');
  const right = score('right');
  if (left === right) return current;
  return left < right ? 'left' : 'right';
}

export interface MiniMapMark {
  readonly id: string;
  /** In pixels of the base canvas. */
  readonly x: number;
  readonly y: number;
  /** Roadmap text: the waypoint's title. */
  readonly title: string;
}

/** What the dots of a mini map show: ids, titles and places to a tenth of a pixel. Equal keys need no rebuild. */
export function marksKey(marks: readonly MiniMapMark[]): string {
  return marks.map((mark) => `${mark.id}@${Math.round(mark.x * 10)},${Math.round(mark.y * 10)}:${mark.title}`).join('|');
}

export interface NoteOptions {
  /** A card asked to go somewhere, or a mini map dot was pressed. */
  readonly onGo?: (detail: GoDetail) => void;
  readonly onStep?: (step: -1 | 1) => void;
  readonly reducedMotion?: () => boolean;
  /** Called when the tab changes or the phone sheet opens or shuts. */
  readonly onChange?: () => void;
}

export interface NoteFrame {
  readonly element: HTMLElement;
  readonly item: HudItem;
  readonly side: NoteSide;
  readonly tab: NoteTab;
  /** Phone only: whether the sheet is pulled up. */
  readonly expanded: boolean;
  setSession(session: Session): void;
  setActive(item: HudItem): void;
  place(side: NoteSide): void;
  setTab(tab: NoteTab): void;
  setExpanded(open: boolean): void;
  /** The base drawing of the stage and the walker's pixel on it. The frame adds the walker's dot and halo. */
  setMiniMap(base: HTMLCanvasElement | null, pixel: { readonly x: number; readonly y: number } | null, marks?: readonly MiniMapMark[]): void;
  /** Steps the float. `time` is seconds. */
  frame(time: number): void;
  relabel(): void;
  destroy(): void;
}

interface Head {
  readonly hour: string;
  readonly kick: string;
  readonly title: string;
  readonly lang: string;
  readonly data: readonly (readonly [label: string, value: string])[];
  readonly stage: number;
}

export function createNote(host: HTMLElement, session: Session, options: NoteOptions = {}): NoteFrame {
  const reduced = options.reducedMotion ?? prefersReducedMotion;
  let current = session;
  let item: HudItem = null;
  let key = '';
  let side: NoteSide = 'left';
  let tab: NoteTab = 'note';
  let expanded = false;
  let card: MountedCard | null = null;
  let swapTimer: ReturnType<typeof setTimeout> | undefined;
  let inTimer: ReturnType<typeof setTimeout> | undefined;
  let pending: HudItem | undefined;
  let mapBase: HTMLCanvasElement | null = null;
  let mapPixel: { x: number; y: number } | null = null;
  let mapMarks: readonly MiniMapMark[] = [];
  let lastDot = '';
  let unsubscribe: (() => void) | null = null;
  let calm = 1;
  let lastTime = Number.NaN;

  const isNarrow = (): boolean => typeof matchMedia === 'function' && matchMedia(`(max-width: ${NOTE.narrow}px)`).matches;

  const panelId = uid('zh-panel');
  const titleId = uid('zh-note-title');

  // ---- Frame
  const hour = el('span', { class: 'zh-ribbon-hour' });
  const kick = el('span', { class: 'zh-ribbon-kick zt-label' });
  const ribbon = el('p', { class: 'zh-ribbon' }, hour, kick);
  // The title is the one part that is announced: a new step under the walker says its name once.
  const title = el('h2', { class: 'zh-note-title zt-title', id: titleId, 'aria-live': 'polite', dir: 'auto' });
  const titleMask = el('div', { class: 'zh-note-mask' }, title);

  const grip = el('button', { type: 'button', class: 'zh-note-grip', 'aria-expanded': 'false', 'aria-controls': panelId });
  grip.append(el('span', { class: 'zh-note-grip-bar', 'aria-hidden': 'true' }), icon('up'));

  const previous = el('button', { type: 'button', class: 'zh-note-step', 'data-step': 'previous' }, el('span', { 'aria-hidden': 'true' }, '←'));
  const next = el('button', { type: 'button', class: 'zh-note-step', 'data-step': 'next' }, el('span', { 'aria-hidden': 'true' }, '→'));
  previous.addEventListener('click', () => options.onStep?.(-1));
  next.addEventListener('click', () => options.onStep?.(1));
  const steps = el('div', { class: 'zh-note-steps' }, previous, next);

  const head = el('header', { class: 'zh-note-head' }, ribbon, titleMask);

  const mapCanvas = el('canvas', { class: 'zh-minimap-canvas', width: NOTE.mapWidth, height: NOTE.mapHeight, role: 'img' });
  const mapDots = el('div', { class: 'zh-minimap-dots' });
  const mapStage = el('span', { class: 'zh-minimap-stage zt-label', 'aria-hidden': 'true' });
  const miniMap = el('div', { class: 'zh-minimap zh-row', hidden: true }, mapCanvas, mapStage, mapDots);

  const tabButtons = new Map<NoteTab, HTMLButtonElement>();
  const tablist = el('div', { class: 'zh-tabs zh-row', role: 'tablist' });
  for (const name of NOTE_TABS) {
    const button = el('button', {
      type: 'button',
      class: 'zh-tab',
      role: 'tab',
      id: `${panelId}-${name}`,
      'aria-controls': panelId,
      'aria-selected': 'false',
      tabindex: -1,
      'data-tab': name,
    });
    button.addEventListener('click', () => setTab(name, true));
    tabButtons.set(name, button);
    tablist.append(button);
  }
  tablist.addEventListener('keydown', (event) => {
    const order = NOTE_TABS;
    const at = order.indexOf(tab);
    let to = -1;
    if (event.key === 'ArrowRight') to = (at + 1) % order.length;
    else if (event.key === 'ArrowLeft') to = (at + order.length - 1) % order.length;
    else if (event.key === 'Home') to = 0;
    else if (event.key === 'End') to = order.length - 1;
    if (to < 0) return;
    event.preventDefault();
    event.stopPropagation();
    setTab(order[to] as NoteTab, true);
    tabButtons.get(order[to] as NoteTab)?.focus();
  });

  const body = el('div', { class: 'zh-note-body zh-row', id: panelId, role: 'tabpanel', tabindex: -1 });
  const empty = el('p', { class: 'zh-note-empty zt-small' });
  const data = el('dl', { class: 'zh-note-data' });
  const foot = el('footer', { class: 'zh-note-foot zh-row' }, data, steps);

  const paper = el('div', { class: 'zh-note-paper zt-paper' }, el('span', { class: 'zt-tape', 'aria-hidden': 'true' }), grip, head, miniMap, tablist, body, foot);
  const floater = el('div', { class: 'zh-note-float' }, paper);
  const root = el('aside', { class: 'zh-note', 'data-side': side, 'data-tab': tab, 'data-kind': 'none', lang: uiLang() }, floater);
  root.setAttribute('aria-labelledby', titleId);

  // ---- What the head says about an item
  const hoursAt = (minute: number): string => formatNumber(roundHours(minute), { fraction: 1 });

  const headFor = (it: HudItem): Head | null => {
    if (!it) return null;
    const { roadmap, trek } = current;
    const lang = roadmap.lang;
    if (it.kind === 'review') {
      const node = it.waypointId ? findWaypoint(roadmap, it.waypointId) : undefined;
      return { hour: say('reviewKick'), kick: '', title: node?.waypoint.title ?? say('reviewKick'), lang: node ? lang : uiLang(), data: [], stage: node?.stageIndex ?? 0 };
    }
    if (it.kind === 'waypoint') {
      const node = findWaypoint(roadmap, it.waypointId);
      if (!node) return null;
      const stage = trek.stages[node.stageIndex] as TrekStage;
      const before = node.stage.waypoints.slice(0, node.waypointIndex).reduce((sum, w) => sum + w.minutes, 0);
      const from = stage.startMinute + before;
      const wp = node.waypoint;
      return {
        hour: say('hour', { n: hoursAt(from) }),
        kick: say('stageStep', { i: node.stageIndex + 1, k: node.waypointIndex + 1, n: node.stage.waypoints.length }),
        title: wp.title,
        lang,
        data: [
          [say('timeLabel'), formatHours(wp.minutes)],
          [say('practiceLabel'), formatHours(Math.min(wp.practiceMinutes, wp.minutes), { approx: false })],
          [say('stretchLabel'), say('stretch', { from: hoursAt(from), to: hoursAt(from + wp.minutes) })],
        ],
        stage: node.stageIndex,
      };
    }
    const found = findStage(roadmap, it.stageId);
    if (!found) return null;
    const stage = trek.stages[found.index] as TrekStage;
    return {
      hour: say('hour', { n: hoursAt(stage.endMinute) }),
      kick: say(it.kind === 'signpost' ? 'signpostKick' : 'campKick', { i: found.index + 1 }),
      title: it.kind === 'signpost' ? found.stage.checkpoint.title : (found.stage.project?.title ?? found.stage.title),
      lang,
      data: [],
      stage: found.index,
    };
  };

  const onGo = (detail: GoDetail): void => options.onGo?.(detail);

  const buildCard = (it: HudItem): MountedCard | null => {
    if (!it) return null;
    try {
      if (it.kind === 'waypoint') return waypointCard(current, it.waypointId, { headingLevel: 3, onGo });
      if (it.kind === 'signpost') return signpostCard(current, it.stageId, { headingLevel: 3, onGo });
      if (it.kind === 'camp') return campCard(current, it.stageId, { headingLevel: 3, onGo });
      return reviewCard(current, it.waypointId, { headingLevel: 3, onGo });
    } catch {
      // An id that is not in this roadmap: the note stays empty instead of breaking the page.
      return null;
    }
  };

  const fill = (it: HudItem): void => {
    card?.destroy();
    card = null;
    item = it;
    key = itemKey(it);
    const info = headFor(it);
    root.dataset.kind = it?.kind ?? 'none';
    setText(hour, info?.hour ?? '');
    setText(kick, info?.kick ?? '');
    kick.hidden = !info?.kick;
    if (info) setRoadText(title, info.title, info.lang);
    else setRoadText(title, say('noteEmpty'), uiLang());
    if (!isNarrow()) fitLines(title);
    data.replaceChildren(
      ...(info?.data ?? []).map(([label, value]) => el('div', { class: 'zh-note-datum' }, el('dt', { class: 'zt-label' }, label), el('dd', { class: 'zt-data' }, value))),
    );
    foot.hidden = !info;
    tablist.hidden = it?.kind !== 'waypoint';
    setText(mapStage, info ? say('miniMapStage', { i: info.stage + 1, n: current.roadmap.stages.length }) : '');
    mapCanvas.setAttribute('aria-label', info ? say('miniMap', { i: info.stage + 1 }) : '');
    card = buildCard(it);
    body.replaceChildren(card ? card.root : empty);
    body.scrollTop = 0;
    if (it?.kind === 'waypoint') {
      body.setAttribute('aria-labelledby', `${panelId}-${tab}`);
    } else {
      body.removeAttribute('aria-labelledby');
    }
    root.toggleAttribute('data-empty', !it);
    syncSteps();
  };

  const syncSteps = (): void => {
    const nodes = current.trek.waypoints;
    const id = item?.kind === 'waypoint' ? item.waypointId : null;
    const at = id === null ? -1 : nodes.findIndex((w) => w.id === id);
    previous.disabled = at === 0;
    next.disabled = false;
  };

  // ---- Tabs
  function setTab(name: NoteTab, byHand = false): void {
    tab = name;
    root.dataset.tab = name;
    for (const [id, button] of tabButtons) {
      const on = id === name;
      button.setAttribute('aria-selected', on ? 'true' : 'false');
      button.tabIndex = on ? 0 : -1;
    }
    if (item?.kind === 'waypoint') body.setAttribute('aria-labelledby', `${panelId}-${name}`);
    if (byHand) {
      body.scrollTop = 0;
      options.onChange?.();
    }
  }

  // ---- Swap: the sheet turns away with the step that was on it and comes back with the next one. The old
  // step stays readable until the new one is built, and the turn is short, so the note never stands empty.
  const swapTo = (it: HudItem): void => {
    if (itemKey(it) === key && (it === null) === (item === null)) {
      // Back to what is already shown while a turn was about to start: nothing to turn.
      if (pending !== undefined) {
        clearTimeout(swapTimer);
        pending = undefined;
        root.classList.remove('is-out');
      }
      return;
    }
    if (reduced() || key === '' || root.hidden) {
      clearTimeout(swapTimer);
      pending = undefined;
      root.classList.remove('is-out');
      fill(it);
      // A new step opens on its note, because the predict question comes before anything else.
      setTab('note');
      if (!reduced()) restartIn();
      return;
    }
    pending = it;
    if (root.classList.contains('is-out')) return;
    root.classList.remove('is-in');
    root.classList.add('is-out');
    swapTimer = setTimeout(() => {
      const target = pending as HudItem;
      pending = undefined;
      fill(target);
      setTab('note');
      root.classList.remove('is-out');
      restartIn();
    }, NOTE.out);
  };

  const restartIn = (): void => {
    root.classList.remove('is-in');
    // Reading a box starts the entrance again from its first frame.
    void root.offsetWidth;
    root.classList.add('is-in');
    // The class goes once the sheet lies, so a later change of the layout cannot play the turn again.
    clearTimeout(inTimer);
    inTimer = setTimeout(() => root.classList.remove('is-in'), NOTE.turn + 60);
  };

  // ---- Mini map: the base drawing, then the walker's dot with its halo and paper ring.
  const drawMap = (): void => {
    miniMap.hidden = mapBase === null;
    if (!mapBase) return;
    const dotKey = `${mapBase.width}x${mapBase.height}:${mapPixel ? `${Math.round(mapPixel.x)},${Math.round(mapPixel.y)}` : '-'}`;
    if (dotKey === lastDot) return;
    lastDot = dotKey;
    if (mapCanvas.width !== mapBase.width) mapCanvas.width = mapBase.width;
    if (mapCanvas.height !== mapBase.height) mapCanvas.height = mapBase.height;
    const ctx = mapCanvas.getContext('2d');
    if (!ctx) return;
    const W = mapCanvas.width;
    ctx.clearRect(0, 0, W, mapCanvas.height);
    ctx.drawImage(mapBase, 0, 0);
    if (!mapPixel) return;
    ctx.fillStyle = 'rgba(226, 73, 47, 0.22)';
    ctx.beginPath();
    ctx.arc(mapPixel.x, mapPixel.y, W * NOTE.halo, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e2492f';
    ctx.strokeStyle = '#fbf8f1';
    ctx.lineWidth = Math.max(1.5, W / 280);
    ctx.beginPath();
    ctx.arc(mapPixel.x, mapPixel.y, W * NOTE.dot, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  };

  /**
   * The dots are buttons, so they are built again only when what they show changed. The walk hands over a new
   * list of marks every time the walker moves; a dot that has the keyboard's focus keeps it through a rebuild.
   */
  const buildDots = (): void => {
    const focusedId = mapDots.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.waypoint : undefined;
    mapDots.replaceChildren();
    if (!mapBase) return;
    for (const mark of mapMarks) {
      const button = el('button', { type: 'button', class: 'zh-minimap-dot', 'data-waypoint': mark.id });
      button.setAttribute('aria-label', say('goTo', { title: mark.title }));
      button.style.left = `${(mark.x / mapBase.width) * 100}%`;
      button.style.top = `${(mark.y / mapBase.height) * 100}%`;
      button.addEventListener('click', () => options.onGo?.({ waypointId: mark.id }));
      mapDots.append(button);
      if (mark.id === focusedId) button.focus({ preventScroll: true });
    }
  };

  // ---- Phone sheet
  const setExpanded = (open: boolean): void => {
    expanded = open;
    root.toggleAttribute('data-expanded', open);
    grip.setAttribute('aria-expanded', open ? 'true' : 'false');
    grip.setAttribute('aria-label', say(open ? 'sheetClose' : 'sheetOpen'));
    syncInert();
    options.onChange?.();
  };

  const syncInert = (): void => {
    const shut = isNarrow() && !expanded;
    for (const part of [miniMap, tablist, body, foot]) part.toggleAttribute('inert', shut);
  };

  grip.addEventListener('click', () => {
    if (dragMoved) {
      dragMoved = false;
      return;
    }
    setExpanded(!expanded);
  });

  // Dragging the head of the sheet: follow the finger, then settle open or shut.
  let dragStart: number | null = null;
  let dragMoved = false;
  const onDragStart = (event: PointerEvent): void => {
    if (!isNarrow() || event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest('.zh-note-step')) return;
    dragStart = event.clientY;
    dragMoved = false;
  };
  const onDragMove = (event: PointerEvent): void => {
    if (dragStart === null) return;
    const dy = event.clientY - dragStart;
    if (Math.abs(dy) < 6 && !dragMoved) return;
    dragMoved = true;
    root.classList.add('is-dragging');
    root.style.setProperty('--zh-drag', `${dy}px`);
  };
  const onDragEnd = (event: PointerEvent): void => {
    if (dragStart === null) return;
    const dy = event.clientY - dragStart;
    dragStart = null;
    root.classList.remove('is-dragging');
    root.style.removeProperty('--zh-drag');
    if (!dragMoved) return;
    if (dy < -40) setExpanded(true);
    else if (dy > 40) setExpanded(false);
    // The click that follows a drag on the grip must not toggle the sheet again.
    setTimeout(() => {
      dragMoved = false;
    }, 0);
  };
  head.addEventListener('pointerdown', onDragStart);
  grip.addEventListener('pointerdown', onDragStart);
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', onDragEnd);
  window.addEventListener('pointercancel', onDragEnd);
  const media = typeof matchMedia === 'function' ? matchMedia(`(max-width: ${NOTE.narrow}px)`) : null;
  const onMedia = (): void => syncInert();
  media?.addEventListener?.('change', onMedia);

  const relabel = (): void => {
    root.lang = uiLang();
    tablist.setAttribute('aria-label', say('tabs'));
    setText(tabButtons.get('note') as HTMLElement, say('tabNote'));
    setText(tabButtons.get('do') as HTMLElement, say('tabDo'));
    setText(tabButtons.get('take') as HTMLElement, say('tabTake'));
    previous.setAttribute('aria-label', say('previousStep'));
    previous.title = say('previousStep');
    next.setAttribute('aria-label', say('nextStep'));
    next.title = say('nextStep');
    setText(empty, say('noteEmpty'));
    grip.setAttribute('aria-label', say(expanded ? 'sheetClose' : 'sheetOpen'));
    // The frame's own words change with the language. The card inside rebuilds itself.
    const info = headFor(item);
    setText(hour, info?.hour ?? '');
    setText(kick, info?.kick ?? '');
    if (!item) setRoadText(title, say('noteEmpty'), uiLang());
    data.replaceChildren(
      ...(info?.data ?? []).map(([label, value]) => el('div', { class: 'zh-note-datum' }, el('dt', { class: 'zt-label' }, label), el('dd', { class: 'zt-data' }, value))),
    );
    setText(mapStage, info ? say('miniMapStage', { i: info.stage + 1, n: current.roadmap.stages.length }) : '');
    mapCanvas.setAttribute('aria-label', info ? say('miniMap', { i: info.stage + 1 }) : '');
    buildDots();
  };

  const listen = (): void => {
    unsubscribe?.();
    unsubscribe = current.subscribe(() => syncSteps());
  };

  relabel();
  setTab('note');
  fill(null);
  syncInert();
  listen();
  host.append(root);

  return {
    element: root,
    get item() {
      return pending !== undefined ? pending : item;
    },
    get side() {
      return side;
    },
    get tab() {
      return tab;
    },
    get expanded() {
      return expanded;
    },
    setSession(next) {
      current = next;
      listen();
      clearTimeout(swapTimer);
      pending = undefined;
      root.classList.remove('is-out');
      fill(null);
    },
    setActive: swapTo,
    place(next) {
      if (next === side) return;
      side = next;
      root.dataset.side = next;
    },
    setTab: (name) => setTab(name),
    setExpanded,
    setMiniMap(base, pixel, marks) {
      const baseChanged = base !== mapBase;
      mapBase = base;
      mapPixel = pixel ? { x: pixel.x, y: pixel.y } : null;
      const marksChanged = marks !== undefined && marks !== mapMarks && marksKey(marks) !== marksKey(mapMarks);
      if (marks !== undefined) mapMarks = marks;
      if (marksChanged || baseChanged) buildDots();
      if (baseChanged) lastDot = '';
      drawMap();
    },
    frame(time) {
      if (reduced() || isNarrow()) {
        if (floater.style.transform) floater.style.transform = '';
        lastTime = Number.NaN;
        return;
      }
      const dt = Number.isFinite(lastTime) ? Math.min(0.1, Math.max(0, time - lastTime)) : 0;
      lastTime = time;
      // A note that is being read holds still: the float eases out under the pointer or the keyboard.
      const held = root.matches(':hover') || root.contains(document.activeElement);
      calm += ((held ? 0 : 1) - calm) * (1 - Math.exp(-6 * dt));
      const y = Math.sin(0.8 * time) * NOTE.floatY * calm;
      const rot = Math.sin(0.55 * time + 1.3) * NOTE.floatRot * calm;
      floater.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0) rotate(${rot.toFixed(3)}deg)`;
    },
    relabel,
    destroy() {
      clearTimeout(swapTimer);
      clearTimeout(inTimer);
      unsubscribe?.();
      card?.destroy();
      window.removeEventListener('pointermove', onDragMove);
      window.removeEventListener('pointerup', onDragEnd);
      window.removeEventListener('pointercancel', onDragEnd);
      media?.removeEventListener?.('change', onMedia);
      root.remove();
    },
  };
}
