import './shelf.css';
import './cover.css';
import './variants.css';
import {
  createBook,
  createBookend,
  dropPrint,
  ensurePrint,
  letterSpine,
  redress,
  relabel,
  setReal,
  type BookendNode,
  type BookNode,
} from './book';
import { stayers } from './body-order';
import { carriedTurn, leanShare, stepFollower, stepRock, waveAt, waveDelay, type Sprung, type WaveSample } from './weight';
import { fitTitle, forgetTitleWidths, type TitleFont } from './title-fit';
import {
  blendPose,
  computeRow,
  computeStandingRow,
  easeTravel,
  extentOf,
  fitGeometry,
  giveOf,
  pitchAt,
  presentedReach,
  pullOf,
  restPitch,
  rowLoops,
  rowStands,
  samePose,
  settleOf,
  solvePosition,
  swayOf,
  swayShare,
  visibleRange,
  volumeSize,
  type SlotPose,
  type VolumeSize,
} from './layout';
import { faceShades, resolveLight, sheenOf, sweepOf } from './light';
import { resolveVariant } from './variants';
import type {
  FrameBookend,
  FrameVolume,
  Geometry,
  Light,
  Pose,
  ShelfFrame,
  ShelfHandle,
  ShelfIntent,
  ShelfItem,
  ShelfOptions,
  Variant,
} from './types';

const DEG = Math.PI / 180;
/** Room kept above the books for a leaning or lifted volume, and below for the contact shadow. */
const HEADROOM = 26;
const FLOOR_ROOM = 30;
/**
 * While a volume is out of the row its neighbours stand aside, the nearest by this many px at scale 1,
 * each further one by less, up to `PART_REACH` slots away. Nothing leaves the scene.
 */
const PART = 28;
const PART_REACH = 4;
/** The printed cover is laid on a volume closer than this many steps to the centre and dropped beyond the second. */
const PRINT_NEAR = 1.5;
const PRINT_FAR = 2.5;
/**
 * Standing volumes have weight: while the row travels their heads trail a little behind their feet. The
 * lean is this many degrees for each volume a second the row moves, and never more than `SWAY_MOST`.
 * The heads are on a spring (acceleration = stiffness x distance - damping x speed, in seconds), so the
 * lean comes on without a step and rocks back past upright once when the row stops.
 */
const SWAY_PER_SPEED = 0.24;
const SWAY_MOST = 3.2;
const SWAY_STIFFNESS = 180;
const SWAY_DAMPING = 15;
/** A lean and a speed of the heads, in degrees and degrees a second, below which they stand upright. */
const SWAY_REST = 0.02;
const SWAY_REST_SPEED = 0.25;
/**
 * The lean runs down the row as a wave: each volume takes it up this long after the one before it,
 * counted from the middle of the row, and none later than `WAVE_MOST_MS`. That much of the lean is kept.
 */
const WAVE_PER_SLOT_MS = 18;
const WAVE_MOST_MS = 144;
/** The spine width, in px at scale 1, that takes the whole lean. A thicker volume stands firmer. */
const SWAY_EVEN_SPINE = 60;
/**
 * A turning volume has weight too: its turn and lean are carried by a follower on a spring of this
 * stiffness and damping ratio, which keeps its speed when the row slows. `TURN_GAIN` of what the follower
 * is ahead goes into the drawn turn, never more than `TURN_MOST` of a full turn. The row's own position
 * is not touched: it still arrives without swinging past.
 */
const TURN_STIFFNESS = 170;
const TURN_DAMPING_RATIO = 0.78;
const TURN_GAIN = 0.2;
const TURN_MOST = 1.03;
/** A follower this close to a fully turned volume, and this slow, has arrived. */
const TURN_REST = 0.002;
const TURN_REST_SPEED = 0.02;
/** A turn that changes by more than this in one frame is a jump, not a travel: nothing is carried through it. */
const TURN_JUMP = 0.4;
/** The frame assumed to have passed when something starts from rest, in ms. */
const FIRST_STEP_MS = 16;
/** A change of shade smaller than this cannot be seen. */
const SHADE_STEP = 0.002;
/**
 * Share of the measured room a fitted spine title may fill. The room of other spine widths is worked out
 * from one measured spine, and a letter cut at the end of a title is worse than a title a little smaller.
 */
const TITLE_ROOM = 0.97;
/** Space a pasted label keeps around its title along the spine, in spine widths, at each end. */
const LABEL_INSET = 0.16;
/** Below this spine width in px the number at the head would fall under 9 px, so it is left off. */
const NARROW_SPINE = 40;
/** A bookend's plate is this share of the look's spine width thick, and never thinner than the minimum. */
const BOOKEND_SHARE = 0.1;
const BOOKEND_MIN = 4;
/** How tall a bookend stands, as a share of the look's volume height. */
const BOOKEND_TALL = 0.62;
/** The lamp's place in the scene is written again only once it has moved this many px. */
const LAMP_STEP = 0.5;
/** Space in px a standing row keeps between each bookend and the edge of the scene. */
const BOOKEND_AIR = 4;
/**
 * A row that stands still is pulled along by the hand a volume for each pitch of travel. Pulled past its
 * first or last volume it has nowhere to go, and gives at most this far, in px.
 */
const GIVE_MOST = 28;
/** A pull of this many px past an end takes such a row about two thirds of the way to that limit. */
const GIVE_REACH = 90;
/**
 * Where nothing may move by itself such a row does not follow the hand. A pull let go faster than this
 * many px per ms, after at least this many px, is then a swipe to the next volume. The speed is that of
 * the last of the pull, this many ms of it.
 */
const SWIPE_SPEED = 0.35;
const SWIPE_TRAVEL = 24;
const SWIPE_WINDOW_MS = 80;
/** A touch that moves less than this many px and lifts within this many ms is a tap. */
const TAP_SLOP = 10;
const TAP_MAX_MS = 700;
/** After a touch that was held too long to be a tap, the click the browser still sends is ignored for this long, in ms. */
const HELD_CLICK_MS = 400;
/**
 * A mouse that crosses the scene faster than this many px per ms is on its way somewhere else, and no spine
 * rises to it. Its speed is taken over stretches of at least `PASSING_SPAN_MS`. It goes on counting as
 * passing until `PASSING_REST_MS` have gone by without such a stretch: by then it has slowed down or
 * stopped. Moves further apart than `PASSING_STALE_MS` say nothing about speed.
 */
const PASSING_SPEED = 0.4;
const PASSING_SPAN_MS = 16;
const PASSING_REST_MS = 60;
const PASSING_STALE_MS = 150;
/** A touch that begins this close to the side of the window is the system's own edge swipe, in px. */
const EDGE_PX = 20;
const MIN_SCALE = 0.5;
const MAX_SCALE = 1.5;

/** A volume whose place changed with the items takes this long to travel there, in ms. */
const TRAVEL_MS = 360;
/** A volume whose item left the row lifts and fades for this long before it is taken away, in ms. */
const LEAVE_MS = 220;
/** No arrival takes longer than this, in ms: after it a volume that came in is an ordinary volume again. */
const ENTER_MS = 700;
/** A volume that was just added carries an outline for this long, so the eye finds it, in ms. */
const ARRIVED_MS = 1200;
/** When a whole new row comes in, each volume follows the one nearer the centre by this many ms. */
const STAGGER_MS = 22;
const STAGGER_REACH = 12;
/** A volume that was just added waits this long before it comes down, so its neighbours have made room, in ms. */
const ARRIVE_WAIT_MS = 140;

/** After the shelf's own arrow moved the row, the volume it came to rest on is said once this long after the last change, in ms. */
const SAY_AFTER_MS = 350;
/** The old caption leaves quickly and the new one arrives a little slower, so the eye lands on it. */
const CAPTION_OUT_MS = 90;
const CAPTION_IN_MS = 160;

interface CaptionText {
  title: string;
  meta: string;
  /** True when the meta line is the person's own note rather than the source. */
  note: boolean;
}

/** Where the session remembers that a shelf has already come in once. */
const ARRIVED_KEY = 'bookmark-bookshelf:arrived';

/**
 * True the first time a shelf is mounted in a browser session, and never again in it. Where the session
 * cannot be written to, no mount counts as the first, so a row never comes in on every page.
 */
function firstInSession(): boolean {
  try {
    if (sessionStorage.getItem(ARRIVED_KEY) !== null) return false;
    sessionStorage.setItem(ARRIVED_KEY, '1');
    return sessionStorage.getItem(ARRIVED_KEY) === '1';
  } catch {
    return false;
  }
}

/** Counts mounted shelves, so ids inside each one stay unique on a page with several. */
let shelfCount = 0;

function wrap(index: number, count: number): number {
  return count <= 0 ? 0 : ((index % count) + count) % count;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

export function mountShelf(host: HTMLElement, options: ShelfOptions): ShelfHandle {
  let items: ShelfItem[] = options.items.slice();
  let variant: Variant = resolveVariant(options.variant);
  let light: Light = resolveLight(variant.light);
  let loop = options.loop ?? variant.loop;
  /**
   * The row does not travel: it stands in the scene, whole and in the middle where it fits. A hand that
   * drags it moves the position along it all the same, so the volumes turn as they are pulled.
   */
  let fixed = false;
  /** How far from the middle of the scene the presented volume of such a row may stand, in px. */
  let standWithin = Number.POSITIVE_INFINITY;
  let pose: Pose = options.pose ?? { position: 0, open: 0 };
  let geometry: Geometry = variant.geometry;
  let sceneWidth = 0;
  let centre = Number.NaN;
  let openSlot: number | null = null;
  /** Pose of the centred volume as last drawn. */
  let presented: SlotPose | null = null;
  /** The position last drawn, and which way the row was going when it got there: up the row, down it, or neither. */
  let shown = 0;
  let heading = 0;
  /** How far standing volumes lean behind the travel right now, in degrees, and when that was worked out. */
  const sway: Sprung = { value: 0, speed: 0 };
  let swayAt = 0;
  /** That lean over the last moments, oldest first: volumes further from the middle take it up later. */
  const wave: WaveSample[] = [];
  /**
   * What each turning volume carries, by slot: its follower, the turn the layout gave it last frame, and
   * the frame that last drew it. A volume at rest has none and is drawn exactly as the layout says.
   */
  const turns = new Map<number, Sprung & { weight: number; seen: number }>();
  let turnAt = 0;
  let frameCount = 0;
  /**
   * Where a lamp stands along the scene, in px from its centre: over the presented volume. A travelling
   * row brings that volume to the centre; in a row that stands still the lamp goes to the volume.
   */
  let lampX = 0;
  let lampWritten = 0;
  /** Each item's volume size at the current scale; null when every volume has the look's size. */
  let sizes: VolumeSize[] | null = null;
  const sizeOf = (slot: number): VolumeSize => sizeAt(slot) ?? geometry;
  /** The spine title's font as the page sets it, and how many spine widths the other spine parts take. */
  let titleFont: TitleFont = { family: 'serif', weight: '600', letterSpacing: 0, upper: false };
  let spineParts = 1.45;
  const nodes = new Map<number, BookNode>();
  /**
   * Volumes taken out of their slots because the items or the kind of row changed, by item id. The next
   * frame takes each volume it needs from here before it builds one, so nothing that stays is built again.
   */
  let pool: Map<string, BookNode[]> | null = null;
  /** A volume was added, or a copy became the real one: the order in the document has to be checked. */
  let disordered = false;
  /** What the volumes are called is out of date: an item, its place or the length of the row changed. */
  let labelsStale = false;
  /**
   * Set while the items are being changed, when motion is wanted: volumes built now are new to the row and
   * come in, the ones named in `arrive` from above; volumes whose item left go out instead of vanishing.
   */
  let entering: { arrive: Set<string> } | null = null;
  /** The frame asked for while volumes travel to new places or straighten up. The shelf keeps no other clock. */
  let frame: number | null = null;
  /** The host has set a pose since the shelf's last frame of its own. */
  let posed = false;
  /** Where the lamp travels from after the row changed, and when that began. */
  let lampFrom: number | null = null;
  let lampFromAt = 0;
  /** How far the whole row is drawn aside right now, in px: a row that stands still gives when pulled past an end. */
  let rowGive = 0;
  /**
   * The hand pulling such a row, with where it has been lately. `steps` says the row stays as it is under
   * the hand and a swipe is to be reported as a step. Null when nothing holds the row.
   */
  let pull: { from: number; steps: boolean; samples: Array<{ time: number; x: number }> } | null = null;
  /** The row on its way back after the hand let go: how far it had given, how fast it moved, and when. */
  let giveBack: { from: number; speed: number; at: number } | null = null;
  let giveFrame: number | null = null;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (run: () => void, ms: number): void => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      run();
    }, ms);
    timers.add(timer);
  };
  /** True when nothing may move by itself: every change of the row is then drawn at once. */
  const reducedQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const still = (): boolean =>
    pose.reduced === true || typeof requestAnimationFrame !== 'function' || reducedQuery?.matches === true;
  /** What was last written on the shelf itself, so a frame that changes neither writes neither. */
  let wroteEmpty: boolean | null = null;
  let wroteOpen = '0';
  const listeners = new Set<(intent: ShelfIntent) => void>();
  const frameListeners = new Set<(frame: ShelfFrame) => void>();
  /** The volumes of the frame being drawn, collected only while a frame listener is attached. */
  let frameVolumes: FrameVolume[] | null = null;
  let lastFrame: ShelfFrame | null = null;
  /** Set once mounting is done, so a host is never called back before it has the handle. */
  let mounted = false;
  /** Keyboard focus was in the row when its volumes were placed again: make sure it ends on the centre. */
  let refocus = false;
  const bookends = { start: createBookend('start'), end: createBookend('end') };

  const root = el('section', 'bb-shelf');
  root.setAttribute('aria-label', options.label ?? 'Bookshelf');
  root.dataset.variant = variant.name;
  root.dataset.open = '0';
  root.style.setProperty('--bb-light-tint', light.tint);

  const scene = el('div', 'bb-shelf__scene');
  const backdrop = el('div', 'bb-shelf__backdrop');
  backdrop.setAttribute('aria-hidden', 'true');
  const row = el('ul', 'bb-shelf__row');
  row.setAttribute('role', 'list');
  const floor = el('div', 'bb-shelf__floor');
  floor.setAttribute('aria-hidden', 'true');
  scene.append(backdrop, floor, row);
  row.append(bookends.start.element, bookends.end.element);

  const nav = el('div', 'bb-shelf__nav');
  const previous = el('button', 'bb-shelf__arrow bb-shelf__arrow--prev');
  previous.type = 'button';
  previous.setAttribute('aria-label', 'Previous volume');
  previous.textContent = '←';
  const next = el('button', 'bb-shelf__arrow bb-shelf__arrow--next');
  next.type = 'button';
  next.setAttribute('aria-label', 'Next volume');
  next.textContent = '→';
  nav.append(previous, next);
  nav.hidden = options.arrows === false;

  const caption = el('div', 'bb-shelf__caption');
  caption.setAttribute('aria-hidden', 'true');
  const captionTitle = el('p', 'bb-shelf__title');
  const captionMeta = el('p', 'bb-shelf__meta');
  caption.append(captionTitle, captionMeta);
  let captionFade: Animation | null = null;
  let nextCaption: CaptionText | null = null;
  caption.hidden = options.caption === false;

  // How to use the row, read with every volume's name, so the keyboard model never has to be guessed.
  const hint = el('p', 'bb-shelf__hint', 'Arrow keys move along the shelf, Enter opens.');
  hint.id = `bb-shelf-hint-${++shelfCount}`;

  // Pressing one of the shelf's own arrows moves no focus, so where the row came to rest is said instead.
  const status = el('p', 'bb-shelf__status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  let sayWhenRested = false;
  let sayTimer: ReturnType<typeof setTimeout> | null = null;

  const actions = el('div', 'bb-shelf__actions');
  const empty = el('p', 'bb-shelf__empty', 'This shelf is empty.');
  empty.hidden = true;

  root.append(scene, nav, caption, actions, empty, hint, status);
  host.appendChild(root);

  const emit = (intent: ShelfIntent): void => {
    for (const listener of listeners) listener(intent);
  };

  function measure(): void {
    sceneWidth = scene.clientWidth || root.clientWidth || 1280;
    const available = Math.max(120, (scene.clientHeight || 400) - HEADROOM - FLOOR_ROOM);
    const base = variant.geometry;
    const byHeight = available / base.bookHeight;
    // On a narrow screen the turned cover and at least one spine each side must still fit.
    const byWidth = (sceneWidth * 0.94) / (base.coverWidth + 2 * (base.spineWidth + base.gap) + 2 * base.focusGap);
    const factor = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(byHeight, byWidth)));
    geometry = fitGeometry(base, factor);
    root.style.setProperty('--bb-spine-w', `${geometry.spineWidth}px`);
    root.style.setProperty('--bb-book-h', `${geometry.bookHeight}px`);
    root.style.setProperty('--bb-cover-w', `${geometry.coverWidth}px`);
    root.style.setProperty('--bb-floor-y', `${FLOOR_ROOM}px`);
    root.style.setProperty('--bb-gap', `${geometry.gap}px`);
    root.style.setProperty('--bb-bookend-w', `${bookendWidth()}px`);
    root.style.setProperty('--bb-bookend-h', `${geometry.bookHeight * BOOKEND_TALL}px`);
    scene.style.perspective = `${geometry.perspective}px`;
    measureSizes();
    decideRow();
  }

  /**
   * A row that would leave part of the stage bare does not travel: it stands whole in the middle of the
   * scene between two bookends, and the presented volume turns where it stands. A longer row repeats, so
   * the stage is full wherever the row stops, and at most a sliver of it can be seen twice at the edges.
   */
  function decideRow(): void {
    // Past each end volume stands its bookend, with a little air between it and the edge of the scene.
    const ends = bookendWidth() + BOOKEND_AIR;
    const sized = sizes ? sizeOf : undefined;
    const wants = options.loop ?? variant.loop;
    // A row goes round only where no volume could be seen twice. A shorter one stands, and is moved along
    // just enough to keep the presented volume in view where it is wider than the scene.
    const next = wants && rowLoops(geometry, items.length, sceneWidth, sized);
    fixed = !next && (wants || rowStands(geometry, items.length, sceneWidth, sized, ends));
    const nearer = geometry.perspective / Math.max(1, geometry.perspective - geometry.focusPush);
    standWithin = Math.max(0, (sceneWidth / 2 - ends) / nearer - presentedReach(geometry, items.length, sized));
    if (!fixed && (pull || rowGive !== 0)) {
      // Only a row that stands still gives.
      pull = null;
      giveBack = null;
      drawGive(0);
    }
    root.dataset.loop = next ? '1' : '0';
    root.dataset.fixed = fixed ? '1' : '0';
    if (next === loop) return;
    loop = next;
    // Slots mean something else in the other kind of row, so every volume is placed again.
    repool();
    if (mounted) options.onLoopChange?.(loop);
  }

  /** Takes every volume out of its slot, to be placed again by the item it shows. */
  function repool(): void {
    refocus = refocus || row.contains(document.activeElement);
    labelsStale = true;
    openSlot = null;
    if (nodes.size === 0) return;
    pool ??= new Map();
    for (const node of nodes.values()) {
      node.offset = node.slot - centre;
      const waiting = pool.get(node.item.id);
      if (waiting) waiting.push(node);
      else pool.set(node.item.id, [node]);
    }
    nodes.clear();
    centre = Number.NaN;
  }

  /** The waiting volume that shows `item`, to stand in `slot`. Of several copies, the one that stood nearest. */
  function claim(item: ShelfItem, slot: number): BookNode | undefined {
    const waiting = pool?.get(item.id);
    if (!waiting || waiting.length === 0) return undefined;
    const want = slot - centre;
    let best = 0;
    for (let index = 0; index < waiting.length; index++) {
      const node = waiting[index]!;
      // The copy that holds keyboard focus goes on being the one that is presented.
      if (slot === centre && node.control !== null && node.control === document.activeElement) return waiting.splice(index, 1)[0];
      if (Math.abs(node.offset - want) < Math.abs(waiting[best]!.offset - want)) best = index;
    }
    return waiting.splice(best, 1)[0];
  }

  /** Whatever is still waiting shows an item that has left the row, or stands out of sight. */
  function emptyPool(): void {
    if (!pool) return;
    for (const waiting of pool.values()) for (const node of waiting) dismiss(node);
    pool = null;
  }

  /**
   * Takes a volume out of the row. One that was on show lifts, tilts and fades where it stood while its
   * neighbours close the gap; it is no longer a volume to assistive technology from the first moment.
   */
  function dismiss(node: BookNode): void {
    const element = node.element;
    if (!entering || !node.drawn || !element.isConnected) {
      element.remove();
      return;
    }
    setReal(node, false, 0);
    element.classList.remove('is-centre', 'is-rising', 'is-arriving', 'is-arrived');
    // Nothing can pick it or look it up any more.
    delete element.dataset.slot;
    delete element.dataset.index;
    delete element.dataset.id;
    // At the end of the row in the document, so it never stands between two volumes that are read in order.
    row.appendChild(element);
    element.classList.add('is-leaving');
    later(() => element.remove(), LEAVE_MS);
  }

  /** Every volume now in the row starts from where it is drawn and travels to wherever it belongs next. */
  function beginTravel(): void {
    if (still()) return;
    const now = performance.now();
    for (const node of nodes.values()) {
      node.from = node.drawn;
      node.fromAt = now;
    }
    for (const bookend of [bookends.start, bookends.end]) {
      bookend.from = bookend.x;
      bookend.fromAt = now;
    }
    lampFrom = lampX;
    lampFromAt = now;
  }

  /** A volume new to the row comes in: dropped from above when the host says it was just added, risen otherwise. */
  function bringIn(node: BookNode, delay: number): void {
    const element = node.element;
    const dropped = entering?.arrive.has(node.item.id) === true;
    if (dropped) delay += ARRIVE_WAIT_MS;
    if (delay > 0) element.style.setProperty('--bb-delay', `${delay}ms`);
    element.classList.add(dropped ? 'is-arriving' : 'is-rising');
    // Left on, the class would run the arrival again whenever the volume is moved in the document.
    later(() => {
      element.classList.remove('is-rising', 'is-arriving');
      element.style.removeProperty('--bb-delay');
    }, delay + ENTER_MS);
    if (!dropped) return;
    element.classList.add('is-arrived');
    later(() => element.classList.remove('is-arrived'), ARRIVED_MS);
  }

  function drawGive(value: number): void {
    rowGive = value;
    row.style.transform = value === 0 ? '' : `translate3d(${value.toFixed(2)}px, 0, 0)`;
  }

  /** Brings the row back from where a pull left it, the way a row settles on a volume. */
  function settleGive(): void {
    giveFrame = null;
    if (!giveBack || !alive) return;
    const seconds = (performance.now() - giveBack.at) / 1000;
    const value = settleOf(giveBack.from, giveBack.speed, seconds);
    if (seconds > 0.05 && Math.abs(value) < 0.1) {
      giveBack = null;
      drawGive(0);
      return;
    }
    drawGive(value);
    giveFrame = requestAnimationFrame(settleGive);
  }

  /**
   * The hand lets go of a row that stands still. Whoever follows the drag carries the row on from the
   * position and the speed it was let go with; a row that had given past an end settles back. Where the
   * row did not follow the hand, a pull let go at speed was a swipe, and the row steps to the next volume.
   */
  function letGo(cancelled: boolean): void {
    const held = pull;
    if (!held) return;
    pull = null;
    const now = performance.now();
    const recent = held.samples.filter((sample) => now - sample.time <= SWIPE_WINDOW_MS);
    const first = recent[0];
    const last = recent[recent.length - 1];
    const speed = first && last && last.time > first.time ? (last.x - first.x) / (last.time - first.time) : 0;
    const travel = (held.samples[held.samples.length - 1]?.x ?? held.from) - held.from;
    if (held.steps && !cancelled && Math.abs(speed) >= SWIPE_SPEED && Math.abs(travel) >= SWIPE_TRAVEL && speed * travel > 0) {
      const direction = speed < 0 ? 1 : -1;
      // Once whatever recognised the drag has finished with this release: it would put the row back.
      later(() => emit({ type: 'step', direction }), 0);
    }
    if (rowGive === 0) return;
    // The row was following the hand less and less; it carries on at the speed it had, then comes back.
    const following = ((GIVE_MOST - Math.abs(rowGive)) / GIVE_REACH) * speed * 1000;
    giveBack = { from: rowGive, speed: cancelled ? 0 : following, at: now };
    if (giveFrame === null) giveFrame = requestAnimationFrame(settleGive);
  }

  /**
   * Asks for a frame of the shelf's own, to carry on something no pose drives: volumes travelling to new
   * places, or straightening up after the row has stopped. While the host is posing every frame anyway,
   * its frames draw all of it and this one only waits.
   */
  function requestFrame(): void {
    if (frame !== null || !alive) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      if (!alive) return;
      if (posed) {
        posed = false;
        requestFrame();
      } else render();
    });
  }

  /**
   * Keeps the volumes in the document in the order of the shelf, the real one of each item before any
   * copy, so the row reads in order to assistive technology. Only the volumes that stand in the wrong place
   * are moved, and never the one that holds keyboard focus: moving an element takes focus off it and
   * starts its animations again.
   */
  function orderRow(): void {
    disordered = false;
    if (nodes.size === 0) return;
    const count = items.length;
    const rank = (node: BookNode): number => (node.control ? node.index : count + node.slot + 1e9);
    const wanted = [...nodes.values()].sort((one, other) => rank(one) - rank(other));
    const place = new Map<Element, number>();
    wanted.forEach((node, index) => place.set(node.element, index));
    const standing: Element[] = [];
    for (let element = row.firstElementChild; element; element = element.nextElementSibling) {
      if (place.has(element)) standing.push(element);
    }
    const held = document.activeElement;
    const stay = stayers(
      standing.map((element) => place.get(element) ?? 0),
      held ? standing.findIndex((element) => element.contains(held)) : -1,
    );
    const settled = new Set(standing.filter((_, index) => stay[index]));
    if (settled.size === wanted.length) return;
    const first = standing.find((_, index) => stay[index]) ?? null;
    let previous: Element | null = null;
    for (const node of wanted) {
      if (!settled.has(node.element)) row.insertBefore(node.element, previous ? previous.nextSibling : first);
      previous = node.element;
    }
  }

  /**
   * Works out each volume's own size at the current scale. A shelf whose items carry no size skips it all.
   * Volumes waiting to be placed again get theirs when they are placed.
   */
  function measureSizes(): void {
    const any = items.some((item) => item.thickness !== undefined || item.stature !== undefined);
    sizes = any ? items.map((item) => volumeSize(geometry, item.thickness, item.stature)) : null;
    for (const node of nodes.values()) {
      applySize(node);
      fitSpine(node);
    }
  }

  function sizeAt(slot: number): VolumeSize | undefined {
    return sizes?.[wrap(slot, items.length)];
  }

  /**
   * Fits the spine's lettering. The font and the share of the spine its other parts take are read from
   * the page once per refresh; volumes built while the row moves reuse them and read no layout.
   */
  function fitSpine(node: BookNode): void {
    const size = sizeOf(node.slot);
    const label = node.treatment === 'label' ? 2 * LABEL_INSET * size.spineWidth : 0;
    const length = (size.bookHeight - spineParts * size.spineWidth) * TITLE_ROOM - label;
    letterSpine(node, fitTitle(node.item.title, { length, breadth: size.spineWidth }, titleFont));
    // Too narrow for a number at the head to stay at a readable size: leave it off rather than shrink it.
    node.element.toggleAttribute('data-narrow', size.spineWidth < NARROW_SPINE);
  }

  function readLettering(): void {
    // A look asks for the number at the head of each spine through a custom property.
    root.dataset.mark = getComputedStyle(root).getPropertyValue('--bb-spine-mark').trim() === '1' ? '1' : '0';
    const node = nodes.get(centre) ?? nodes.values().next().value;
    if (!node || !node.title.isConnected) return;
    const style = getComputedStyle(node.title);
    const fontSize = parseFloat(style.fontSize) || 16;
    const font: TitleFont = {
      family: style.fontFamily || titleFont.family,
      weight: style.fontWeight || titleFont.weight,
      letterSpacing: (parseFloat(style.letterSpacing) || 0) / fontSize,
      upper: style.textTransform === 'uppercase',
    };
    const size = sizeOf(node.slot);
    const room = node.title.clientHeight;
    const parts = room > 0 ? (size.bookHeight - room) / size.spineWidth : spineParts;
    const changed =
      Math.abs(parts - spineParts) > 0.01 ||
      font.family !== titleFont.family ||
      font.weight !== titleFont.weight ||
      Math.abs(font.letterSpacing - titleFont.letterSpacing) > 0.001 ||
      font.upper !== titleFont.upper;
    titleFont = font;
    spineParts = parts;
    if (changed) for (const each of nodes.values()) fitSpine(each);
  }

  function applySize(node: BookNode): void {
    const size = sizeAt(node.slot);
    const style = node.element.style;
    if (!size) {
      style.removeProperty('--bb-spine-w');
      style.removeProperty('--bb-book-h');
      style.removeProperty('--bb-cover-w');
      return;
    }
    style.setProperty('--bb-spine-w', `${size.spineWidth}px`);
    style.setProperty('--bb-book-h', `${size.bookHeight}px`);
    style.setProperty('--bb-cover-w', `${size.coverWidth}px`);
  }

  function isReal(slot: number): boolean {
    if (!loop) return true;
    const count = items.length;
    const first = centre - Math.floor((count - 1) / 2);
    return slot >= first && slot < first + count;
  }

  /** Keeps exactly one operable control per item and one tab stop for the whole row. */
  function syncSemantics(moveFocus: boolean): void {
    for (const node of nodes.values()) {
      const real = isReal(node.slot);
      if (real !== (node.control !== null)) disordered = true;
      setReal(node, real, items.length, hint.id);
      if (labelsStale) relabel(node, items.length);
      const stop = node.slot === centre ? 0 : -1;
      if (node.control && node.control.tabIndex !== stop) node.control.tabIndex = stop;
      node.element.classList.toggle('is-centre', node.slot === centre);
    }
    labelsStale = false;
    if (disordered) orderRow();
    if (moveFocus) nodes.get(centre)?.control?.focus({ preventScroll: true });
  }

  /**
   * An arrow that has nowhere to go says so and does nothing. It stays focusable: a button that goes dead
   * under the finger pressing it would drop keyboard focus on the floor.
   */
  function syncArrows(): void {
    const count = items.length;
    const ends: Array<[HTMLButtonElement, boolean]> = [
      [previous, !loop && (count === 0 || centre <= 0)],
      [next, !loop && (count === 0 || centre >= count - 1)],
    ];
    for (const [button, spent] of ends) {
      if (spent === (button.getAttribute('aria-disabled') === 'true')) continue;
      if (spent) button.setAttribute('aria-disabled', 'true');
      else button.removeAttribute('aria-disabled');
    }
  }

  /** Says where the row has come to rest, once it has stopped changing, after one of the shelf's arrows moved it. */
  function sayRest(): void {
    if (!sayWhenRested) return;
    if (sayTimer !== null) {
      timers.delete(sayTimer);
      clearTimeout(sayTimer);
    }
    sayTimer = setTimeout(() => {
      if (sayTimer !== null) timers.delete(sayTimer);
      sayTimer = null;
      sayWhenRested = false;
      const index = wrap(centre, items.length);
      const item = items[index];
      if (item) status.textContent = `${item.title}, ${index + 1} of ${items.length}`;
    }, SAY_AFTER_MS);
    timers.add(sayTimer);
  }

  function syncCaption(): void {
    syncArrows();
    sayRest();
    const item = items[wrap(centre, items.length)];
    // The note says why the link was kept; without one, where it comes from.
    const note = item?.note?.trim() ?? '';
    showCaption({ title: item?.title ?? '', meta: note || item?.source || '', note: note !== '' });
    root.dataset.focus = String(wrap(centre, items.length));
    root.dataset.focusId = item?.id ?? '';
  }

  function writeCaption(text: CaptionText): void {
    captionTitle.textContent = text.title;
    captionMeta.textContent = text.meta;
    captionMeta.classList.toggle('is-note', text.note);
  }

  /**
   * A new caption replaces the old one by a quick fade out and a slower fade in, never by sliding. While
   * the row travels fast the fade simply continues and the caption that lands is the latest one.
   */
  function showCaption(text: CaptionText): void {
    const quiet = pose.reduced === true || typeof caption.animate !== 'function' || reducedQuery?.matches === true;
    if (quiet || caption.hidden || captionTitle.textContent === '') {
      captionFade?.cancel();
      captionFade = null;
      writeCaption(text);
      return;
    }
    if (!captionFade && captionTitle.textContent === text.title && captionMeta.textContent === text.meta) {
      // The same volume is still presented: its caption stays as it is.
      captionMeta.classList.toggle('is-note', text.note);
      return;
    }
    nextCaption = text;
    if (captionFade) return;
    const out = caption.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: CAPTION_OUT_MS,
      easing: 'ease-in',
      fill: 'forwards',
    });
    captionFade = out;
    out.onfinish = () => {
      if (captionFade !== out) return;
      captionFade = null;
      if (nextCaption) writeCaption(nextCaption);
      nextCaption = null;
      caption.animate([{ opacity: 0 }, { opacity: 1 }], { duration: CAPTION_IN_MS, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
      out.cancel();
    };
  }

  function syncNodes(from: number, to: number): void {
    for (const [slot, node] of nodes) {
      if (slot >= from && slot <= to) continue;
      // Never recycle the volume that holds keyboard focus.
      if (node.control && node.control === document.activeElement) continue;
      // It waits to be taken up again: in a row that goes round, the volume leaving at one end is the
      // one wanted at the other.
      node.offset = slot - centre;
      pool ??= new Map();
      const waiting = pool.get(node.item.id);
      if (waiting) waiting.push(node);
      else pool.set(node.item.id, [node]);
      nodes.delete(slot);
    }
    let kept = nodes.size;
    let built: BookNode[] | null = null;
    for (let slot = from; slot <= to; slot++) {
      if (nodes.has(slot)) continue;
      const index = wrap(slot, items.length);
      const item = items[index];
      if (!item) continue;
      let node = claim(item, slot);
      if (node) {
        redress(node, item, index, slot);
        kept++;
      } else {
        node = createBook(item, index, slot);
        if (entering) (built ??= []).push(node);
      }
      applySize(node);
      fitSpine(node);
      setReal(node, isReal(slot), items.length, hint.id);
      nodes.set(slot, node);
      disordered = true;
    }
    // A whole new row comes in from the centre outward; a volume joining others comes in at once.
    if (built) for (const node of built) bringIn(node, kept === 0 ? Math.min(STAGGER_REACH, Math.abs(node.slot - centre)) * STAGGER_MS : 0);
    emptyPool();
  }

  /** Most volumes hold still in most frames: write a shade only when it has visibly changed. */
  function writeShade(node: BookNode | BookendNode, face: 0 | 1 | 2, film: HTMLElement, value: number): void {
    if (Math.abs(node.shades[face] - value) <= SHADE_STEP) return;
    node.shades[face] = value;
    film.style.opacity = value.toFixed(3);
  }

  /** Stands a bookend against the outer side of the end volume, or hides it where the row has no end in view. */
  function placeBookend(bookend: BookendNode, x: number | null): void {
    const element = bookend.element;
    if (x === null) {
      if (!element.hidden) element.hidden = true;
      bookend.x = null;
      bookend.from = null;
      return;
    }
    if (bookend.from !== null) {
      const t = (travelNow() - bookend.fromAt) / TRAVEL_MS;
      if (t >= 1 || Math.abs(bookend.from - x) < 0.25) bookend.from = null;
      else {
        x = bookend.from + (x - bookend.from) * easeTravel(t);
        travelling = true;
      }
    }
    if (bookend.x === null && entering) {
      // A bookend that was not there comes in with the volumes, after the one it stands beside.
      const delay = Math.min(STAGGER_REACH, items.length) * STAGGER_MS;
      element.style.setProperty('--bb-delay', `${delay}ms`);
      element.classList.add('is-rising');
      later(() => {
        element.classList.remove('is-rising');
        element.style.removeProperty('--bb-delay');
      }, delay + ENTER_MS);
    }
    if (element.hidden) element.hidden = false;
    if (x !== bookend.x) element.style.transform = `translate3d(${x}px, 0, 0)`;
    bookend.x = x;
    const shades = faceShades(light, 0, light.lamp ? (x - lampX) / geometry.coverWidth : 0);
    writeShade(bookend, 0, bookend.edgeShade, shades.spine);
    writeShade(bookend, 1, bookend.frontShade, shades.front);
    writeShade(bookend, 2, bookend.backShade, shades.back);
  }

  /** The time of the frame being drawn, read once and only while something travels. */
  let frameNow = -1;
  let travelling = false;
  const travelNow = (): number => (frameNow < 0 ? (frameNow = performance.now()) : frameNow);

  function render(): void {
    const count = items.length;
    frameNow = -1;
    travelling = false;
    frameVolumes = frameListeners.size > 0 ? [] : null;
    if (wroteEmpty !== (count === 0)) {
      wroteEmpty = count === 0;
      empty.hidden = count > 0;
      root.dataset.empty = count > 0 ? '0' : '1';
    }
    if (count === 0) {
      for (const node of nodes.values()) node.element.remove();
      nodes.clear();
      syncArrows();
      // The scene of an empty shelf is not shown, so nothing is left in it to go out slowly.
      entering = null;
      emptyPool();
      placeBookend(bookends.start, null);
      placeBookend(bookends.end, null);
      captionFade?.cancel();
      captionFade = null;
      writeCaption({ title: '', meta: '', note: false });
      // An empty shelf has no centred volume.
      centre = Number.NaN;
      presented = null;
      root.dataset.focus = '';
      root.dataset.focusId = '';
      emitFrame([]);
      return;
    }

    const position = fixed
      ? Math.min(count - 1, Math.max(0, pose.position))
      : loop
        ? pose.position
        : Math.min(count - 1 + 0.49, Math.max(-0.49, pose.position));
    if (position !== shown) {
      heading = Math.sign(position - shown);
      shown = position;
    }
    const nextCentre = Math.round(position);
    const centreChanged = nextCentre !== centre;
    const focusInside = centreChanged && row.contains(document.activeElement);
    centre = nextCentre;

    const sized = sizes ? sizeOf : undefined;
    // A row that stands still shows every volume it has.
    const range = fixed ? { from: 0, to: count - 1 } : visibleRange(position, geometry, sceneWidth, count, loop, 2, sized);
    // Every link has its volume in the row, drawn or not, so each can be reached by its control: the
    // ones out of view are kept without being drawn.
    const first = loop ? centre - Math.floor((count - 1) / 2) : 0;
    syncNodes(Math.min(range.from, first), Math.max(range.to, first + count - 1));
    if (centreChanged) {
      syncSemantics(focusInside || refocus);
      refocus = false;
      syncCaption();
    }
    if (disordered) orderRow();

    // Heads trail the feet: moving up the row takes the volumes left, so they lean right.
    const weighty = !still();
    const speed = weighty ? (pose.velocity ?? 0) : 0;
    if (!weighty) {
      // Nothing moves by itself: no lean, no wave and nothing carried.
      sway.value = 0;
      sway.speed = 0;
      wave.length = 0;
      turns.clear();
    } else if (speed !== 0 || wave.length > 0) {
      const now = travelNow();
      const elapsed = wave.length === 0 ? FIRST_STEP_MS : now - swayAt;
      if (elapsed > 0) {
        swayAt = now;
        const wanted = swayOf(speed, SWAY_PER_SPEED, SWAY_MOST);
        stepRock(sway, wanted, elapsed, SWAY_STIFFNESS, SWAY_DAMPING);
        if (Math.abs(sway.value) > SWAY_MOST) {
          // Held at the limit, the heads gather no more speed to throw them back with.
          sway.value = Math.sign(sway.value) * SWAY_MOST;
          sway.speed = 0;
        }
        if (wanted === 0 && Math.abs(sway.value) < SWAY_REST && Math.abs(sway.speed) < SWAY_REST_SPEED) {
          sway.value = 0;
          sway.speed = 0;
        }
        wave.push({ time: now, value: sway.value });
        // One sample from before the longest delay is kept, so the furthest volume still reads between two.
        while (wave.length > 2 && wave[1]!.time <= now - WAVE_MOST_MS) wave.shift();
        if (sway.value === 0 && sway.speed === 0 && wave.every((sample) => sample.value === 0)) wave.length = 0;
      }
      // The row may have come to rest while its volumes are still straightening up.
      if (wave.length > 0) travelling = true;
    }
    const frameId = ++frameCount;
    let turnStep = -1;
    /** The time the followers are stepped by in this frame, read once and only when one is. */
    const turnElapsed = (): number => {
      if (turnStep < 0) {
        const now = travelNow();
        turnStep = turns.size === 0 || now - turnAt > 100 ? FIRST_STEP_MS : Math.max(0, now - turnAt);
        turnAt = now;
      }
      return turnStep;
    };

    const opening = pose.open > 0;
    if (opening && openSlot === null) openSlot = centre;
    if (!opening) openSlot = null;
    // The host carries a copy of the cover to the page. The shelf only leaves its place empty and makes
    // room around it. Under reduced motion nothing in the row moves; the page simply fades in over it.
    const parting = opening && !pose.reduced && openSlot !== null;
    const scale = geometry.bookHeight / variant.geometry.bookHeight;

    presented = null;
    let start: number | null = null;
    let end: number | null = null;
    // A bookend presses against the end volume; a hair of space keeps the two faces from flickering.
    const bookendGap = bookendWidth() / 2 + 1;
    const standing = fixed ? computeStandingRow(position, geometry, count, sized, standWithin) : null;
    const poses = standing ? standing.poses : computeRow(position, geometry, range.from, range.to, sized);
    lampX = standing ? standing.origin : 0;
    if (lampFrom !== null) {
      // The lamp goes with the volume it stands over, at the same pace.
      const t = (travelNow() - lampFromAt) / TRAVEL_MS;
      if (t >= 1 || Math.abs(lampFrom - lampX) < 0.25) lampFrom = null;
      else {
        lampX = lampFrom + (lampX - lampFrom) * easeTravel(t);
        travelling = true;
      }
    }
    if (light.lamp && Math.abs(lampX - lampWritten) > LAMP_STEP) {
      // The look can lay its pool of light on the floor where the lamp stands.
      lampWritten = lampX;
      root.style.setProperty('--bb-lamp-x', `${lampX.toFixed(1)}px`);
    }
    // A bookend is shorter than a volume: it meets a volume leaning toward it below the head.
    const bookendTall = geometry.bookHeight * BOOKEND_TALL;
    if (nodes.size > poses.length) {
      // Volumes kept for their controls stand out of view and are not drawn at all.
      for (const node of nodes.values()) {
        const away = node.slot < range.from || node.slot > range.to;
        if (node.wrote.away === away) continue;
        node.wrote.away = away;
        node.element.classList.toggle('is-away', away);
        // Wherever it was last drawn means nothing once it is out of view.
        if (away) node.drawn = null;
      }
    }
    for (const live of poses) {
      const node = nodes.get(live.slot);
      if (!node) continue;
      if (node.wrote.away) {
        node.wrote.away = false;
        node.element.classList.remove('is-away');
      }
      let slotPose = live;
      const before = node.drawn;
      if (node.from) {
        // After the row changed around it, a volume travels and turns from where it stood to where it belongs.
        const t = (travelNow() - node.fromAt) / TRAVEL_MS;
        // While the items are still being changed the pose may yet be set elsewhere, so nothing is settled early.
        if (t >= 1 || (!entering && samePose(node.from, live))) node.from = null;
        else {
          slotPose = blendPose(node.from, live, easeTravel(t));
          travelling = true;
        }
      }
      node.drawn = slotPose;
      if (slotPose.slot === centre) presented = slotPose;
      // The print is laid on well before the volume starts to turn and kept a while after, so a volume
      // drifting back and forth at the edge of the band does not build and drop it over and over.
      const distance = Math.abs(slotPose.slot - position);
      // Every cover keeps the look's proportion, however tall its volume is.
      if (distance < PRINT_NEAR || slotPose.slot === openSlot || slotPose.weight > 0) {
        ensurePrint(node, geometry.coverWidth / geometry.bookHeight);
      } else if (distance > PRINT_FAR) dropPrint(node);

      const offset = parting && openSlot !== null ? slotPose.slot - openSlot : Number.NaN;
      const reach = Math.abs(offset);
      const away = reach > 0 && reach <= PART_REACH ? Math.sign(offset) * PART * scale * (1 - reach / 5) * pose.open : 0;
      // A volume that stands as it stood is not written to: most of the row holds still in most frames.
      const style = node.element.style;
      const wrote = node.wrote;
      if (wrote.out !== (reach === 0)) {
        wrote.out = reach === 0;
        style.visibility = wrote.out ? 'hidden' : '';
      }
      // Only volumes standing at rest lean with the travel: the presented one and the two beside it hold still.
      // The lean reaches a volume later the further it stands from the middle, and a thick one takes less of it.
      const share = wave.length === 0 ? 0 : swayShare(distance);
      const rocked =
        share === 0
          ? 0
          : waveAt(wave, travelNow() - waveDelay(distance, WAVE_PER_SLOT_MS, WAVE_MOST_MS)) *
            share *
            leanShare(sizeOf(slotPose.slot).spineWidth / scale, SWAY_EVEN_SPINE);
      const tilt = Math.abs(rocked) < 0.0005 ? 0 : Math.min(SWAY_MOST, Math.max(-SWAY_MOST, rocked));
      const leaning = tilt === 0 ? '' : `rotateZ(${tilt.toFixed(3)}deg) `;

      // A volume that turns in a travelling row carries its turn and lean a little past where the row puts them.
      let angle = slotPose.angle;
      let lean = slotPose.lean;
      let turn = turns.get(slotPose.slot);
      const stepped = Math.abs(slotPose.weight - (turn ? turn.weight : before ? before.weight : slotPose.weight));
      if (!weighty || slotPose !== live || slotPose.weight <= 0 || stepped > TURN_JUMP) {
        // At rest out of the turn, on its way to a new place, or put somewhere at once: as the layout says.
        if (turn) turns.delete(slotPose.slot);
      } else {
        // Under a hand the row has no speed of its own, and a volume held there is not carried past it.
        if (!turn && speed !== 0 && stepped > 0 && before && before.slot === slotPose.slot) {
          turnElapsed();
          turn = { value: before.weight, speed: 0, weight: before.weight, seen: frameId };
          turns.set(slotPose.slot, turn);
        }
        if (turn) {
          stepFollower(turn, turn.weight, slotPose.weight, turnElapsed(), TURN_STIFFNESS, TURN_DAMPING_RATIO);
          turn.weight = slotPose.weight;
          turn.seen = frameId;
          if (slotPose.weight === 1 && Math.abs(turn.value - 1) < TURN_REST && Math.abs(turn.speed) < TURN_REST_SPEED) {
            turns.delete(slotPose.slot);
          } else {
            const carried = carriedTurn(slotPose.weight, turn.value, TURN_GAIN, TURN_MOST) / slotPose.weight;
            angle = Math.round(slotPose.angle * carried * 1000) / 1000;
            lean = Math.round(slotPose.lean * carried * 1000) / 1000;
            travelling = true;
          }
        }
      }
      const transform =
        slotPose.lean === 0
          ? `translate3d(${slotPose.x + away}px, ${-slotPose.lift}px, ${slotPose.z}px) ${leaning}rotateY(${-angle}deg)`
          : `translate3d(${slotPose.x + slotPose.corner + away}px, ${-slotPose.lift}px, ${slotPose.z}px) ` +
            `rotateZ(${lean}deg) translateX(${-slotPose.corner}px) ${leaning}rotateY(${-angle}deg)`;
      if (wrote.transform !== transform) {
        wrote.transform = transform;
        style.transform = transform;
      }
      if (frameVolumes) {
        const size = sizeOf(slotPose.slot);
        frameVolumes.push({
          id: node.item.id,
          index: node.index,
          slot: slotPose.slot,
          item: node.item,
          element: node.element,
          spineWidth: size.spineWidth,
          bookHeight: size.bookHeight,
          coverWidth: size.coverWidth,
          x: slotPose.x + away,
          corner: slotPose.lean === 0 ? 0 : slotPose.corner,
          lean,
          tilt,
          angle,
          lift: slotPose.lift,
          z: slotPose.z,
          weight: slotPose.weight,
          centre: slotPose.slot === centre,
          hidden: wrote.out,
        });
      }
      if (wrote.raised !== slotPose.weight > 0) {
        wrote.raised = slotPose.weight > 0;
        style.zIndex = wrote.raised ? '2' : '';
      }

      // Distance of the volume's middle from the lamp, in cover widths.
      const along = light.lamp
        ? (slotPose.x - lampX + away + (geometry.coverWidth * Math.sin(angle * DEG)) / 2) / geometry.coverWidth
        : 0;
      const shades = faceShades(light, angle, along);
      writeShade(node, 0, node.spineShade, shades.spine);
      writeShade(node, 1, node.coverShade, shades.front);
      writeShade(node, 2, node.backShade, shades.back);
      if (slotPose.weight > 0 || node.turn !== 0) {
        const turning = slotPose.weight > 0;
        const turned = turning ? Math.sin(angle * DEG) : 0;
        if (turned !== node.turn || wrote.sheen === '') {
          node.turn = turned;
          style.setProperty('--bb-turn', String(turned));
        }
        const sheen = turning ? sheenOf(light, angle, along).toFixed(4) : '0';
        if (wrote.sheen !== sheen) {
          wrote.sheen = sheen;
          style.setProperty('--bb-sheen', sheen);
        }
        const sweep = sweepOf(turning ? slotPose.weight : 0).toFixed(4);
        if (wrote.sweep !== sweep) {
          wrote.sweep = sweep;
          style.setProperty('--bb-sweep', sweep);
        }
      }
      if (wrote.turned !== slotPose.weight > 0.98) {
        wrote.turned = slotPose.weight > 0.98;
        node.element.classList.toggle('is-turned', wrote.turned);
      }

      // A bookend stands where its end of the row belongs and travels there by itself, whichever volume ends up beside it.
      if (!loop && live.slot === 0) start = extentOf(live, sizeOf(0), bookendTall)[0] + away - bookendGap;
      if (!loop && live.slot === count - 1) end = extentOf(live, sizeOf(count - 1), bookendTall)[1] + away + bookendGap;
    }
    placeBookend(bookends.start, start);
    placeBookend(bookends.end, end);
    // A volume that was not drawn in this frame carries nothing into the next one it is drawn in.
    for (const [slot, turn] of turns) if (turn.seen !== frameId) turns.delete(slot);

    const open = pose.open <= 0 ? '0' : pose.open >= 1 ? '1' : 'moving';
    if (open !== wroteOpen) {
      wroteOpen = open;
      root.dataset.open = open;
    }
    if (frameVolumes) emitFrame(frameVolumes);
    if (travelling) requestFrame();
  }

  /** Hands the frame just drawn to whoever paints it a second time. */
  function emitFrame(volumes: FrameVolume[]): void {
    frameVolumes = null;
    if (frameListeners.size === 0) return;
    const ends: FrameBookend[] = [];
    const endHeight = geometry.bookHeight * BOOKEND_TALL;
    for (const bookend of [bookends.start, bookends.end]) {
      if (bookend.x === null || bookend.element.hidden) continue;
      ends.push({ x: bookend.x, width: bookendWidth(), height: endHeight, depth: geometry.coverWidth * 0.55 });
    }
    const current: ShelfFrame = {
      scene,
      width: sceneWidth,
      height: scene.clientHeight || 400,
      floorY: FLOOR_ROOM,
      perspective: geometry.perspective,
      rowGive,
      gap: geometry.gap,
      volumes,
      bookends: ends,
      light,
      lampX,
      open: pose.open,
      variant: variant.name,
    };
    lastFrame = current;
    for (const listener of frameListeners) listener(current);
  }

  function bookendWidth(): number {
    return Math.max(BOOKEND_MIN, geometry.spineWidth * BOOKEND_SHARE);
  }

  function activate(book: HTMLElement): void {
    if (pose.open > 0) return;
    const slot = Number(book.dataset.slot);
    const index = Number(book.dataset.index);
    const item = items[index];
    if (!item || Number.isNaN(slot)) return;
    // The volume in the centre opens when it is at rest there or still arriving. One the row is leaving is
    // brought back instead: by the time anything opened, another volume would stand in the centre.
    const away = shown - slot;
    const arriving = Math.abs(away) < 0.25 || away * heading < 0;
    if (slot === centre && arriving) emit({ type: 'open', id: item.id, index });
    else emit({ type: 'focus', id: item.id, index, slot });
  }

  // Touch taps are recognised here from pointer events instead of waiting for `click`: after a quick swipe
  // some browsers swallow the next tap's click, and a volume that ignores a tap feels broken.
  let touchDown: { id: number; x: number; y: number; time: number; book: HTMLElement } | null = null;
  let handledTapUntil = 0;
  let ignoreClickUntil = 0;
  /** Touches now on the scene. With more than one it is a pinch or a second hand, and nothing follows the first. */
  const fingers = new Set<number>();
  /** The press now on the scene began at the very side of the window. */
  let fromEdge = false;

  const onPointerDown = (event: PointerEvent): void => {
    touchDown = null;
    fromEdge = false;
    if (event.pointerType === 'mouse') {
      fingers.clear();
      return;
    }
    // The first finger of a new gesture: whatever went before is over, even if its release was never seen.
    if (event.isPrimary !== false) fingers.clear();
    fingers.add(event.pointerId);
    if (fingers.size > 1) {
      // A second finger: neither lifting is a tap, and a row held by the first is let go where it is.
      letGo(true);
      return;
    }
    fromEdge =
      event.pointerType === 'touch' &&
      typeof innerWidth === 'number' &&
      (event.clientX < EDGE_PX || event.clientX > innerWidth - EDGE_PX);
    const book = (event.target as Element | null)?.closest<HTMLElement>('.bb-book');
    if (book) touchDown = { id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp, book };
  };

  /** Where the mouse was when its speed was last taken, and the wait that ends its passing. */
  let passingFrom: { x: number; y: number; time: number } | null = null;
  let passingTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Tells a mouse that is crossing the row from one that has come to a volume. While it is passing the
   * shelf says so in `data-passing`, and the style sheet raises no spine: a sweep along the row would
   * otherwise play the spines like piano keys.
   */
  function notePassing(event: PointerEvent): void {
    if (event.pointerType !== 'mouse') return;
    const from = passingFrom;
    const span = from ? event.timeStamp - from.time : Number.POSITIVE_INFINITY;
    if (span < PASSING_SPAN_MS) return;
    passingFrom = { x: event.clientX, y: event.clientY, time: event.timeStamp };
    if (!from || span > PASSING_STALE_MS) return;
    if (Math.hypot(event.clientX - from.x, event.clientY - from.y) / span < PASSING_SPEED) return;
    if (passingTimer === null) root.dataset.passing = '1';
    else {
      timers.delete(passingTimer);
      clearTimeout(passingTimer);
    }
    const wait = setTimeout(() => {
      timers.delete(wait);
      passingTimer = null;
      delete root.dataset.passing;
    }, PASSING_REST_MS);
    passingTimer = wait;
    timers.add(wait);
  }

  // A touch that ever leaves the slop radius is a drag for good, even if it comes back to where it started.
  const onPointerMove = (event: PointerEvent): void => {
    notePassing(event);
    if (!touchDown || touchDown.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - touchDown.x, event.clientY - touchDown.y) > TAP_SLOP) touchDown = null;
  };

  const onPointerUp = (event: PointerEvent): void => {
    letGo(false);
    fingers.delete(event.pointerId);
    const down = touchDown;
    touchDown = null;
    if (!down || down.id !== event.pointerId) return;
    const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
    if (moved > TAP_SLOP) return;
    if (event.timeStamp - down.time > TAP_MAX_MS) {
      // A thumb rested on a volume and lifted is not a tap, whatever click the browser makes of it.
      ignoreClickUntil = event.timeStamp + HELD_CLICK_MS;
      return;
    }
    handledTapUntil = event.timeStamp + TAP_MAX_MS;
    activate(down.book);
  };

  const onPointerCancel = (event: PointerEvent): void => {
    touchDown = null;
    fingers.delete(event.pointerId);
    letGo(true);
  };

  // A drag can also end by losing the pointer without a release.
  const onLostCapture = (event: PointerEvent): void => {
    if (event.target === scene) letGo(true);
  };

  const onClick = (event: MouseEvent): void => {
    // Skip the browser's own click for a tap that was already handled above: one activation per tap.
    // A click with detail 0 comes from the keyboard or from script, never from that tap, so it always counts.
    const fromKeyboard = event.detail === 0;
    if (!fromKeyboard && (event.timeStamp < handledTapUntil || event.timeStamp < ignoreClickUntil)) return;
    const book = (event.target as Element | null)?.closest<HTMLElement>('.bb-book');
    if (book) activate(book);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (pose.open > 0 || event.altKey || event.ctrlKey || event.metaKey) return;
    const intent: ShelfIntent | null =
      event.key === 'ArrowRight'
        ? { type: 'step', direction: 1 }
        : event.key === 'ArrowLeft'
          ? { type: 'step', direction: -1 }
          : event.key === 'Home'
            ? { type: 'jump', to: 'first' }
            : event.key === 'End'
              ? { type: 'jump', to: 'last' }
              : null;
    if (!intent) return;
    event.preventDefault();
    emit(intent);
  };

  // A screen reader can move focus straight to any volume. Bring that volume to the centre.
  const onFocusIn = (event: FocusEvent): void => {
    const book = (event.target as Element | null)?.closest<HTMLElement>('.bb-book');
    if (!book) return;
    const slot = Number(book.dataset.slot);
    const index = Number(book.dataset.index);
    const item = items[index];
    if (item && slot !== centre) emit({ type: 'focus', id: item.id, index, slot });
  };

  const onArrow = (button: HTMLButtonElement, direction: -1 | 1): void => {
    if (button.getAttribute('aria-disabled') === 'true') return;
    sayWhenRested = true;
    emit({ type: 'step', direction });
  };
  const onPrevious = (): void => onArrow(previous, -1);
  const onNext = (): void => onArrow(next, 1);

  row.addEventListener('click', onClick);
  scene.addEventListener('pointerdown', onPointerDown);
  scene.addEventListener('pointermove', onPointerMove);
  scene.addEventListener('pointerup', onPointerUp);
  scene.addEventListener('pointercancel', onPointerCancel);
  scene.addEventListener('lostpointercapture', onLostCapture);
  row.addEventListener('keydown', onKeyDown);
  row.addEventListener('focusin', onFocusIn);
  previous.addEventListener('click', onPrevious);
  next.addEventListener('click', onNext);

  const refresh = (): void => {
    measure();
    render();
    readLettering();
  };

  // Titles measured before the web fonts arrived were measured in a fallback face.
  let alive = true;
  void document.fonts?.ready.then(() => {
    if (!alive) return;
    forgetTitleWidths();
    for (const node of nodes.values()) fitSpine(node);
  });
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(refresh) : null;
  observer?.observe(scene);

  // The first row of a session rises into place from the centre outward; after that a row is simply there.
  if (items.length > 0 && !still() && firstInSession()) entering = { arrive: new Set() };
  refresh();
  entering = null;
  mounted = true;

  return {
    element: root,
    surface: scene,
    actions,
    get variant() {
      return variant;
    },
    get loop() {
      return loop;
    },
    get fixed() {
      return fixed;
    },
    setItems(nextItems, change) {
      const kept = items[wrap(centre, items.length)]?.id;
      const place = Number.isNaN(centre) ? 0 : wrap(centre, items.length);
      if (!still()) {
        entering = { arrive: new Set(change?.arrive) };
        // A host usually sets the pose right after the items: volumes it brings into view then come in too.
        const mine = entering;
        queueMicrotask(() => {
          if (entering === mine) entering = null;
        });
      }
      beginTravel();
      repool();
      items = nextItems.slice();
      // The presented volume stays presented while it is on the shelf; once it is gone, the one in its place is.
      const index = kept === undefined ? -1 : items.findIndex((item) => item.id === kept);
      pose = { ...pose, position: index >= 0 ? index : Math.min(place, Math.max(0, items.length - 1)) };
      measureSizes();
      decideRow();
      render();
    },
    setPose(nextPose) {
      pose = nextPose;
      posed = true;
      render();
    },
    setVariant(nextVariant) {
      variant = resolveVariant(nextVariant);
      light = resolveLight(variant.light);
      root.dataset.variant = variant.name;
      root.style.setProperty('--bb-light-tint', light.tint);
      // Every volume stays and goes to its place in the new look; its cover is printed again for the new proportions.
      beginTravel();
      for (const node of nodes.values()) dropPrint(node);
      refresh();
    },
    pitch() {
      if (!sizes || sizes.length === 0) return restPitch(geometry);
      return sizes.reduce((sum, size) => sum + size.spineWidth, 0) / sizes.length + geometry.gap;
    },
    pitchAt: (position) => pitchAt(position, geometry, sizes ? sizeOf : undefined),
    trackFrom(start) {
      if (items.length === 0) return null;
      // A swipe in from the side of the window belongs to the system: the row stays where it is.
      if (fromEdge) return () => start.position;
      if (fixed) {
        const held = { from: start.x, steps: still(), samples: [{ time: performance.now(), x: start.x }] };
        pull = held;
        const feel = (x: number): boolean => {
          if (pull !== held || fingers.size > 1) return false;
          held.samples.push({ time: performance.now(), x });
          if (held.samples.length > 8) held.samples.shift();
          return true;
        };
        if (held.steps) {
          // Nothing may move by itself: the row stays as it is under the hand, and a swipe is a step.
          return (x) => {
            feel(x);
            return start.position;
          };
        }
        const sized = sizes ? sizeOf : undefined;
        const last = items.length - 1;
        const within = (position: number): number => Math.min(last, Math.max(0, position));
        // The row stands where it is, so no volume can stay under the hand. The position goes with the hand
        // instead, a volume for each pitch of travel, and the volumes turn as they are pulled.
        let at = within(start.position);
        /** Where the hand asks for, in volumes: past an end it runs on, and the row gives by that much. */
        let asked = at;
        if (rowGive !== 0 && (rowGive < 0 ? at >= last : at <= 0)) {
          // Caught on its way back from an end, the row carries on from as far as it still gives.
          if (giveFrame !== null) cancelAnimationFrame(giveFrame);
          giveFrame = null;
          giveBack = null;
          asked = at - pullOf(rowGive, GIVE_MOST, GIVE_REACH) / pitchAt(at, geometry, sized);
        }
        let lastX = start.x;
        return (x) => {
          if (!feel(x)) return at;
          const pitch = pitchAt(at, geometry, sized);
          asked -= (x - lastX) / pitch;
          lastX = x;
          at = within(asked);
          // A row on its way back from an earlier pull is left to finish unless this pull reaches an end.
          if (asked !== at || giveBack === null) {
            if (giveFrame !== null) cancelAnimationFrame(giveFrame);
            giveFrame = null;
            giveBack = null;
            drawGive(asked === at ? 0 : giveOf((at - asked) * pitch, GIVE_MOST, GIVE_REACH));
          }
          return at;
        };
      }
      const sized = sizes ? sizeOf : undefined;
      // Read once, when the drag begins: where the middle of the row is on screen.
      const box = scene.getBoundingClientRect();
      const middle = box.left + box.width / 2;
      const grabbed = start.x - middle;
      const book = start.target instanceof Element ? start.target.closest<HTMLElement>('.bb-book') : null;
      let slot = book && row.contains(book) ? Number(book.dataset.slot ?? Number.NaN) : Number.NaN;
      if (Number.isNaN(slot)) {
        // The press landed between volumes or on the floor: the nearest volume is the one that is held.
        let nearest = Number.POSITIVE_INFINITY;
        for (const node of nodes.values()) {
          if (!node.drawn) continue;
          const [left, right] = extentOf(node.drawn, sizeOf(node.slot));
          const distance = Math.max(left - grabbed, grabbed - right, 0);
          if (distance < nearest) {
            nearest = distance;
            slot = node.slot;
          }
        }
        if (Number.isNaN(slot)) return null;
      }
      const pose = computeRow(start.position, geometry, slot, slot, sized)[0];
      if (!pose) return null;
      const [left, right] = extentOf(pose, sizeOf(slot));
      // The hand holds a point of the volume, given as a share of its width, and keeps it as the volume turns.
      const share = Math.min(1, Math.max(0, (grabbed - left) / Math.max(1, right - left)));
      const beside = grabbed - (left + (right - left) * share);
      let last = start.position;
      let lastX = start.x;
      return (x) => {
        // With a second finger down the hand is doing something else: the row waits where it is.
        if (fingers.size > 1) return last;
        const guess = last - (x - lastX) / pitchAt(last, geometry, sized);
        last = solvePosition(x - middle - beside, geometry, slot, share, guess, sized);
        lastX = x;
        return last;
      };
    },
    coverSize: () => ({ width: geometry.coverWidth, height: geometry.bookHeight }),
    coverBox() {
      const cover = nodes.get(centre)?.cover;
      if (!cover) return null;
      const box = cover.getBoundingClientRect();
      return { x: box.left, y: box.top, width: box.width, height: box.height };
    },
    coverPlacement() {
      const cover = nodes.get(centre)?.cover;
      if (!cover || !presented) return null;
      // A rotated, slightly turned rectangle keeps its centre at the centre of its bounding box to well
      // under a pixel, so one layout read gives the centre of the face as drawn.
      const box = cover.getBoundingClientRect();
      const turn = presented.angle * DEG;
      const size = sizeOf(centre);
      const half = size.spineWidth / 2;
      // Depth of the face's centre: the cover hinges on the spine's edge and turns about the spine's middle.
      const depth = presented.z + half * Math.sin(turn) - (size.coverWidth / 2) * Math.cos(turn);
      const along = light.lamp ? (presented.x - lampX + (size.coverWidth * Math.sin(turn)) / 2) / geometry.coverWidth : 0;
      return {
        cx: box.left + box.width / 2,
        cy: box.top + box.height / 2,
        width: size.coverWidth,
        height: size.bookHeight,
        lean: presented.lean,
        yaw: 90 - presented.angle,
        scale: geometry.perspective / Math.max(1, geometry.perspective - depth),
        sheen: presented.weight > 0 ? sheenOf(light, presented.angle, along) : 0,
        sweep: sweepOf(presented.weight),
      };
    },
    focusCurrent() {
      nodes.get(centre)?.control?.focus({ preventScroll: true });
    },
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onFrame(listener) {
      frameListeners.add(listener);
      // The row may be standing still: draw once so the new listener has a frame to paint.
      lastFrame = null;
      render();
      if (lastFrame === null && frameListeners.has(listener)) emitFrame([]);
      return () => frameListeners.delete(listener);
    },
    refresh,
    destroy() {
      alive = false;
      if (frame !== null) cancelAnimationFrame(frame);
      if (giveFrame !== null) cancelAnimationFrame(giveFrame);
      for (const timer of timers) clearTimeout(timer);
      captionFade?.cancel();
      observer?.disconnect();
      row.removeEventListener('click', onClick);
      scene.removeEventListener('pointerdown', onPointerDown);
      scene.removeEventListener('pointermove', onPointerMove);
      scene.removeEventListener('pointerup', onPointerUp);
      scene.removeEventListener('pointercancel', onPointerCancel);
      scene.removeEventListener('lostpointercapture', onLostCapture);
      row.removeEventListener('keydown', onKeyDown);
      row.removeEventListener('focusin', onFocusIn);
      previous.removeEventListener('click', onPrevious);
      next.removeEventListener('click', onNext);
      listeners.clear();
      frameListeners.clear();
      root.remove();
    },
  };
}
