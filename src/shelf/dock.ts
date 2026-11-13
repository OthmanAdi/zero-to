/**
 * The resource shelf in the corner of the page: the Bookmark Bookshelf modules (shelf, motion, reader and the
 * travelling cover) wired to a roadmap stage. This file is the only place where those modules meet zero-to.
 *
 * Desktop: a small night shelf at the lower right, 380 by 196, with a header line, the row and a caption.
 * Phone: a round "Sources (5)" button that opens the same row in a bottom sheet.
 * Opening a volume shows a reader page written from the roadmap entry, with "Open original", "Pin to
 * notebook", "Mark as used" and a private note. Everything a learner does there goes to the session.
 */
// Order matters: the tokens and the base rules come before the module stylesheets, as in Bookshelf, and the
// dock's own rules come last so they can set the modules' tokens for zero-to.
import '../bookshelf/styles/tokens.css';
import './bookshelf-base.css';
import { createFlight, flightLayoutWidth, type Flight, type FlightEnd, type FlightStart } from '../bookshelf/app/flight';
import { createShelfMotion, prefersReducedMotion, type ShelfMotion } from '../bookshelf/motion';
import { mountReader, type ReaderHandle } from '../bookshelf/reader';
import { createCover, mountShelf, VARIANTS, type ShelfHandle, type Variant } from '../bookshelf/shelf';
import './dock.css';
import { uiLang } from '../i18n';
import { adaptiveShelfPaint } from './adaptive-paint';
import { dockHeader, dockHeaderParts, pinFor, placeOf, toShelfItems } from './items';
import { readerDoc, readerLabels } from './page';
import { say } from './strings';
import type { DockItem, ShelfDock, ShelfDockOptions, ShelfEntry, ShelfSession } from './types';

const NIGHT = VARIANTS.night as Variant;

/**
 * The look of the dock: Night Study's lamp, cloths and timing at the size of a small shelf. The shelf scales
 * a look by at most 1.5 to fit its scene, so these base sizes give volumes 90 px tall with 36 px spines,
 * and seven of them stand whole in 356 px. The row never loops: a stage has three to seven volumes.
 */
export const DOCK_VARIANT: Variant = {
  ...NIGHT,
  label: 'Night table',
  summary: 'A small night shelf at the corner of the map, lit by the lamp over its middle.',
  geometry: {
    ...NIGHT.geometry,
    spineWidth: 24,
    bookHeight: 60,
    coverWidth: 37,
    gap: 2,
    focusGap: 5,
    focusPush: 6,
    focusLift: 0,
    perspective: 420,
  },
  loop: false,
};

/** The same look in the phone's bottom sheet, which has room for taller volumes. */
export const SHEET_VARIANT: Variant = {
  ...DOCK_VARIANT,
  geometry: { ...DOCK_VARIANT.geometry, spineWidth: 30, bookHeight: 86, coverWidth: 53, gap: 3, focusGap: 7, focusPush: 10, perspective: 560 },
};

export const PHONE_QUERY = '(max-width: 760px)';

let dockCount = 0;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const clamp01 = (value: number): number => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1);

function sameIds(a: readonly ShelfEntry[], b: readonly ShelfEntry[]): boolean {
  return a.length === b.length && a.every((entry, index) => entry.resource.id === b[index]?.resource.id);
}

/** Where the cover lands beside the page, or null when that place is not on screen. */
function endOf(reader: ReaderHandle): FlightEnd | null {
  const target = reader.flightTarget();
  if (!target || target.width <= 0 || target.height <= 0) return null;
  const onScreen = target.y + target.height > 0 && target.y < window.innerHeight && target.x + target.width > 0 && target.x < window.innerWidth;
  return onScreen ? target : null;
}

export function createShelfDock(host: HTMLElement, session: ShelfSession, options: ShelfDockOptions = {}): ShelfDock {
  const ui = options.ui ?? uiLang();
  const lang = session.roadmap.lang;
  const reducedMotion =
    typeof options.reducedMotion === 'function'
      ? options.reducedMotion
      : options.reducedMotion === true
        ? () => true
        : prefersReducedMotion;
  const uid = `zt-dock-${++dockCount}`;

  let entries: ShelfEntry[] = [];
  let items: DockItem[] = [];
  let reader: ReaderHandle | null = null;
  let readerId: string | null = null;
  let flight: Flight | null = null;
  let coverLeavesOnMove = false;
  let closing: Promise<void> | null = null;
  let opener: HTMLElement | null = null;
  let layer: HTMLElement | null = options.readerHost ?? null;
  let ownLayer = false;
  let lastPresented: string | null = null;
  let destroyed = false;
  let pointerLast = false;
  let sheetOpen = false;

  // ---------------------------------------------------------------------------------------------------------
  // DOM

  const root = el('section', 'zt-dock');
  root.id = uid;
  root.lang = ui;
  root.setAttribute('aria-label', say('dock', undefined, ui));
  root.dataset.sheet = 'closed';
  root.style.setProperty('--zt-shelf-lit', '1');
  if (options.reducedMotion === true) root.dataset.motion = 'reduced';

  const toggle = el('button', 'zt-dock__toggle');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', `${uid}-panel`);
  const toggleSpines = el('span', 'zt-dock__toggle-spines');
  toggleSpines.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 3; i++) toggleSpines.appendChild(el('span', 'zt-dock__toggle-spine'));
  const toggleName = el('span', 'bb-visually-hidden');
  const toggleCount = el('span', 'zt-dock__toggle-count');
  toggleCount.setAttribute('aria-hidden', 'true');
  toggle.append(toggleSpines, toggleName, toggleCount);

  const scrim = el('div', 'zt-dock__scrim');
  scrim.setAttribute('aria-hidden', 'true');

  const panel = el('div', 'zt-dock__panel');
  panel.id = `${uid}-panel`;

  const head = el('div', 'zt-dock__head');
  const header = el('p', 'zt-dock__header');
  header.id = `${uid}-header`;
  const headerMain = el('span', 'zt-dock__header-main');
  // Read as one line, " · " between the parts; drawn as two when the marked states need their own line.
  const headerSep = el('span', 'bb-visually-hidden');
  const headerFlags = el('span', 'zt-dock__header-flags');
  header.append(headerMain, headerSep, headerFlags);
  const nav = el('div', 'zt-dock__nav');
  const prev = el('button', 'zt-dock__arrow zt-dock__arrow--prev');
  prev.type = 'button';
  prev.setAttribute('aria-label', say('prev', undefined, ui));
  prev.title = say('prev', undefined, ui);
  const next = el('button', 'zt-dock__arrow zt-dock__arrow--next');
  next.type = 'button';
  next.setAttribute('aria-label', say('next', undefined, ui));
  next.title = say('next', undefined, ui);
  for (const arrow of [prev, next]) arrow.appendChild(el('span', 'zt-dock__arrow-glyph')).setAttribute('aria-hidden', 'true');
  const sheetClose = el('button', 'zt-dock__close');
  sheetClose.type = 'button';
  sheetClose.setAttribute('aria-label', say('sheetClose', undefined, ui));
  sheetClose.appendChild(el('span', 'zt-dock__close-glyph')).setAttribute('aria-hidden', 'true');
  nav.append(prev, next, sheetClose);
  head.append(header, nav);

  const stage = el('div', 'zt-dock__stage');
  const plank = el('div', 'zt-dock__plank');
  plank.setAttribute('aria-hidden', 'true');
  const shelfHost = el('div', 'zt-dock__shelf');
  const dim = el('div', 'zt-dock__dim');
  dim.setAttribute('aria-hidden', 'true');
  stage.append(shelfHost);

  const caption = el('div', 'zt-dock__caption');
  const captionTitle = el('p', 'zt-dock__title');
  const captionWhy = el('p', 'zt-dock__why');
  const captionStatus = el('p', 'zt-dock__status');
  for (const line of [captionTitle, captionWhy]) {
    line.lang = lang;
    line.dir = 'auto';
  }
  caption.append(captionTitle, captionWhy, captionStatus);

  panel.append(head, plank, stage, dim, caption);
  root.append(toggle, scrim, panel);
  host.appendChild(root);

  // ---------------------------------------------------------------------------------------------------------
  // Shelf and motion

  const phoneMedia = typeof matchMedia === 'function' ? matchMedia(options.phoneQuery ?? PHONE_QUERY) : null;
  let phone = phoneMedia?.matches === true;
  root.dataset.mode = phone ? 'phone' : 'dock';

  let motionRef: ShelfMotion | null = null;
  const shelf: ShelfHandle = mountShelf(shelfHost, {
    items: [],
    variant: phone ? SHEET_VARIANT : DOCK_VARIANT,
    loop: false,
    label: say('shelf', undefined, ui),
    caption: false,
    arrows: false,
    onLoopChange: (loop) => motionRef?.setLoop(loop),
  });
  shelf.element.setAttribute('aria-describedby', header.id);
  const paint = adaptiveShelfPaint(shelf, reducedMotion);
  const themeRoot = options.themeRoot !== false;
  const rootVariantBefore = document.documentElement.dataset.variant;
  if (themeRoot) document.documentElement.dataset.variant = shelf.variant.name;

  const motion: ShelfMotion = createShelfMotion({
    count: 0,
    loop: shelf.loop,
    reducedMotion,
    timing: shelf.variant.motion,
    ...(options.clock ? { clock: options.clock } : {}),
  });
  motionRef = motion;

  const currentIndex = (): number => {
    if (items.length === 0) return -1;
    return Math.min(items.length - 1, Math.max(0, Math.round(motion.state.position)));
  };
  const current = (): DockItem | undefined => items[currentIndex()];

  const detachGesture = motion.attach(shelf.surface, {
    pxPerItem: () => shelf.pitch(),
    extent: () => shelf.surface.clientWidth,
    // The shelf knows its own spacing, so the grabbed volume stays under the hand, and on a standing row
    // a swipe comes back as a step.
    track: (start) => shelf.trackFrom(start),
    enabled: () => reader === null,
  });

  function writeCaption(): void {
    const item = current();
    if (!item) {
      captionTitle.textContent = '';
      captionWhy.textContent = '';
      captionStatus.textContent = say('empty', undefined, ui);
      delete captionStatus.dataset.status;
      return;
    }
    captionTitle.textContent = item.title;
    captionWhy.textContent = item.why;
    captionWhy.title = item.why;
    captionStatus.textContent = item.statusLine;
    captionStatus.dataset.status = item.status;
    captionStatus.title = item.statusSentence;
    root.dataset.presented = item.id;
  }

  function writeArrows(): void {
    const index = currentIndex();
    prev.setAttribute('aria-disabled', String(index <= 0));
    next.setAttribute('aria-disabled', String(index < 0 || index >= items.length - 1));
  }

  function landFlight(): void {
    flight?.destroy();
    flight = null;
    coverLeavesOnMove = false;
  }

  const stopMotion = motion.subscribe((state) => {
    shelf.setPose({ position: state.position, open: state.open, reduced: state.reduced, velocity: state.velocity * 1000 });
    if (flight) {
      if (coverLeavesOnMove && state.open < 1) {
        reader?.setCoverVisible(false);
        coverLeavesOnMove = false;
      }
      flight.set(state.openTime);
    }
    reader?.setReveal(state.openTime);
    shelf.element.dataset.settled = state.settled ? '1' : '0';
    const presented = current()?.id ?? null;
    if (presented !== lastPresented) {
      lastPresented = presented;
      writeCaption();
      writeArrows();
      options.onPresent?.(presented);
    }
  });

  const stopIntents = shelf.on((intent) => {
    if (intent.type === 'focus') motion.goTo(intent.slot);
    else if (intent.type === 'step') motion.step(intent.direction);
    else if (intent.type === 'jump') motion.goTo(intent.to === 'first' ? 0 : items.length - 1);
    else void open(intent.id);
  });

  const stepBy = (direction: -1 | 1): void => {
    const index = currentIndex();
    if (index < 0) return;
    const target = Math.min(items.length - 1, Math.max(0, index + direction));
    if (target !== index) motion.goTo(target);
  };
  prev.addEventListener('click', () => stepBy(-1));
  next.addEventListener('click', () => stepBy(1));

  // ---------------------------------------------------------------------------------------------------------
  // Phone sheet

  const panelVisible = (): boolean => !phone || sheetOpen;
  const syncPaint = (): void => paint.setVisible(panelVisible() && entries.length > 0);

  function setSheet(open: boolean, focusAfter = true): void {
    if (sheetOpen === open) return;
    sheetOpen = open;
    root.dataset.sheet = open ? 'open' : 'closed';
    toggle.setAttribute('aria-expanded', String(open));
    panel.toggleAttribute('inert', phone && !open);
    syncPaint();
    if (open) {
      shelf.refresh();
      if (focusAfter) requestAnimationFrame(() => shelf.focusCurrent());
    } else if (focusAfter) {
      toggle.focus({ preventScroll: true });
    }
  }

  function applyMode(): void {
    root.dataset.mode = phone ? 'phone' : 'dock';
    panel.setAttribute('role', phone ? 'dialog' : 'group');
    if (phone) panel.setAttribute('aria-label', say('dock', undefined, ui));
    else panel.removeAttribute('aria-label');
    panel.toggleAttribute('inert', phone && !sheetOpen);
    toggle.hidden = !phone;
    sheetClose.hidden = !phone;
    const wanted = phone ? SHEET_VARIANT : DOCK_VARIANT;
    if (shelf.variant !== wanted) {
      shelf.setVariant(wanted);
      motion.setLoop(shelf.loop);
      motion.setTiming(shelf.variant.motion);
    }
    shelf.refresh();
    syncPaint();
  }

  const onPhoneChange = (event: MediaQueryListEvent): void => {
    phone = event.matches;
    if (!phone && sheetOpen) setSheet(false, false);
    applyMode();
  };
  phoneMedia?.addEventListener('change', onPhoneChange);
  applyMode();

  toggle.addEventListener('click', () => setSheet(!sheetOpen));
  sheetClose.addEventListener('click', () => setSheet(false));
  scrim.addEventListener('click', () => setSheet(false));
  panel.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || reader || !phone || !sheetOpen || event.defaultPrevented) return;
    event.preventDefault();
    setSheet(false);
  });

  // ---------------------------------------------------------------------------------------------------------
  // Reader

  const onPointerInput = (): void => {
    pointerLast = true;
  };
  const onKeyInput = (): void => {
    pointerLast = false;
    delete shelf.element.dataset.pointer;
  };
  document.addEventListener('pointerdown', onPointerInput, true);
  document.addEventListener('keydown', onKeyInput, true);

  // Keys reach the reader from the first frame of an opening, wherever focus happens to be.
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!reader || event.defaultPrevented) return;
    if (reader.element.contains(document.activeElement)) return;
    if (reader.handleKey(event)) return;
    if (event.key !== 'Escape') return;
    event.preventDefault();
    void close();
  };
  document.addEventListener('keydown', onKeyDown);

  function readerLayer(): HTMLElement {
    if (layer) return layer;
    layer = el('div', 'zt-shelf-layer');
    layer.lang = ui;
    document.body.appendChild(layer);
    ownLayer = true;
    return layer;
  }

  function setBackgroundInert(inert: boolean): void {
    for (const element of options.background ?? []) element.inert = inert;
    root.inert = inert;
    document.documentElement.classList.toggle('zt-reading', inert);
  }

  const coverAspect = (): number => shelf.variant.geometry.coverWidth / shelf.variant.geometry.bookHeight;

  function takeOff(item: DockItem, active: ReaderHandle): boolean {
    if (!panelVisible()) return false;
    const placement = shelf.coverPlacement();
    const end = endOf(active);
    if (!placement || !end) return false;
    const start: FlightStart = { ...placement, width: placement.width * placement.scale, height: placement.height * placement.scale };
    const cover = createCover(item, undefined, { aspect: coverAspect() });
    const shelfCover = shelf.coverSize();
    const scale = shelfCover.width > 0 ? flightLayoutWidth(start, end) / shelfCover.width : 1;
    cover.style.setProperty('--bb-cover-k', String(scale));
    const spineEdge = Math.abs(Math.sin((placement.yaw * Math.PI) / 180)) * shelf.variant.geometry.spineWidth * scale;
    const flightOptions = {
      cover,
      clothClass: `bb-cloth--${item.cloth}`,
      start,
      end,
      spineEdge,
      sheen: { opacity: placement.sheen, sweep: placement.sweep },
      host: readerLayer(),
    };
    flight = paint.flight(flightOptions, item.id) ?? createFlight(flightOptions);
    flight.set(motion.state.openTime);
    return true;
  }

  /** "Pin to notebook" beside "Open original". The label stays; the pressed state and a filled pin show it is pinned. */
  function addPin(active: ReaderHandle, entry: ShelfEntry): void {
    const actions = active.element.querySelector('.bb-reader__actions');
    if (!actions) return;
    const id = entry.resource.id;
    const button = el('button', 'bb-button zt-reader__pin');
    button.type = 'button';
    button.appendChild(el('span', 'zt-reader__pin-glyph')).setAttribute('aria-hidden', 'true');
    button.append(say('pin', undefined, ui));
    const show = (): void => button.setAttribute('aria-pressed', String(session.isPinned(id)));
    show();
    button.addEventListener('click', () => {
      if (session.isPinned(id)) session.unpin(id);
      else {
        const place = placeOf(entry, session.roadmap);
        session.pin(pinFor(entry, place?.stageId ?? '', place?.waypointId));
      }
      show();
    });
    actions.appendChild(button);
  }

  async function open(id: string): Promise<void> {
    if (reader || destroyed) return;
    const index = items.findIndex((item) => item.id === id);
    const item = items[index];
    const entry = entries[index];
    if (!item || !entry) return;
    opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    if (currentIndex() !== index) motion.goTo(index, { immediate: true });

    const cover = createCover(item, undefined, { aspect: coverAspect() });
    readerId = id;
    const active = mountReader(readerLayer(), {
      doc: readerDoc(entry, session.roadmap, ui),
      // The page was written from the roadmap entry, and the reader says so under the title.
      example: true,
      cover,
      coverAspect: coverAspect(),
      labels: readerLabels(entry, ui),
      onClose: () => void close(),
      myNote: session.note(id),
      onMyNote: (text) => session.setNote(id, text),
      done: session.isUsed(id),
      onDone: (done) => {
        session.setUsed(id, done);
        refreshItems();
      },
    });
    reader = active;
    addPin(active, entry);

    const slot = active.coverSlotRect();
    const shelfCover = shelf.coverSize();
    if (slot && shelfCover.width > 0) cover.style.setProperty('--bb-cover-k', String(slot.width / shelfCover.width));
    const flying = !motion.state.reduced && !reducedMotion() && takeOff(item, active);
    active.setCoverVisible(!flying);
    setBackgroundInert(true);
    root.dataset.open = id;
    options.onOpenChange?.(id);

    await motion.setOpen(true);
    if (reader !== active || readerId !== id || motion.state.openTarget !== 1) return;
    active.setReveal(1);
    active.setCoverVisible(true);
    landFlight();
    active.focus();
  }

  function close(): Promise<void> {
    if (closing) return closing;
    const active = reader;
    if (!active) return Promise.resolve();
    const run = async (): Promise<void> => {
      const item = items.find((entry) => entry.id === readerId);
      if (motion.state.reduced || reducedMotion()) landFlight();
      else if (!flight && item) coverLeavesOnMove = takeOff(item, active);
      await motion.setOpen(false);
      if (reader !== active) return;
      const origin = opener;
      opener = null;
      const giveFocusBack = (): void => {
        const usable = origin !== null && origin.isConnected && origin.getClientRects().length > 0 && !shelf.element.contains(origin);
        if (usable) origin.focus({ preventScroll: true });
        else shelf.focusCurrent();
      };
      setBackgroundInert(false);
      if (pointerLast) shelf.element.dataset.pointer = '1';
      giveFocusBack();
      active.destroy();
      reader = null;
      readerId = null;
      delete root.dataset.open;
      landFlight();
      refreshItems();
      if (!document.activeElement || document.activeElement === document.body) giveFocusBack();
      options.onOpenChange?.(null);
    };
    closing = run().finally(() => {
      closing = null;
    });
    return closing;
  }

  // ---------------------------------------------------------------------------------------------------------
  // Entries

  function writeCounts(): void {
    const parts = dockHeaderParts(entries, ui);
    headerMain.textContent = parts.main;
    headerFlags.textContent = parts.flags;
    headerSep.textContent = parts.flags ? ' · ' : '';
    headerFlags.hidden = parts.flags === '';
    header.toggleAttribute('data-flagged', parts.flags !== '');
    // The name is "Sources (5)"; the round button itself shows the count beside three small spines.
    toggleName.textContent = say('phoneButton', { count: entries.length }, ui);
    toggleCount.textContent = String(entries.length);
    header.title = dockHeader(entries, ui);
    root.dataset.count = String(entries.length);
    root.dataset.empty = entries.length === 0 ? '1' : '0';
    syncPaint();
  }

  /** Redraws ticks after a change in the session. The row keeps its volumes and its place. */
  function refreshItems(): void {
    if (destroyed) return;
    items = toShelfItems(entries, session, ui);
    shelf.setItems(items);
    shelf.setPose({ position: motion.state.position, open: motion.state.open, reduced: motion.state.reduced });
    writeCaption();
  }

  function setEntries(next: readonly ShelfEntry[], presentId?: string | null): void {
    if (destroyed) return;
    const keep = presentId ?? null;
    if (sameIds(entries, next)) {
      entries = [...next];
      refreshItems();
      writeCounts();
      const index = keep === null ? -1 : items.findIndex((item) => item.id === keep);
      if (index >= 0 && index !== currentIndex()) motion.goTo(index, { immediate: reader !== null });
      return;
    }
    const before = current()?.id ?? null;
    entries = [...next];
    items = toShelfItems(entries, session, ui);
    shelf.setItems(items);
    const wanted = keep ?? before;
    let index = wanted === null ? -1 : items.findIndex((item) => item.id === wanted);
    if (index < 0) index = Math.max(0, entries.findIndex((entry) => entry.main));
    motion.setCount(items.length, Math.min(index, Math.max(0, items.length - 1)));
    shelf.setPose({ position: motion.state.position, open: motion.state.open, reduced: motion.state.reduced });
    lastPresented = null;
    writeCounts();
    writeCaption();
    writeArrows();
    lastPresented = current()?.id ?? null;
    options.onPresent?.(lastPresented);
  }

  const stopSession = session.subscribe?.(() => {
    refreshItems();
    if (reader && readerId) reader.setDone(session.isUsed(readerId));
    const pin = reader?.element.querySelector('.zt-reader__pin');
    if (pin && readerId) pin.setAttribute('aria-pressed', String(session.isPinned(readerId)));
  });

  writeCounts();
  writeCaption();
  writeArrows();

  return {
    element: root,
    setEntries,
    setLit(amount) {
      const lit = clamp01(amount);
      root.style.setProperty('--zt-shelf-lit', String(lit));
      root.dataset.lit = lit >= 1 ? 'full' : 'dim';
    },
    open,
    close,
    focus() {
      if (phone && !sheetOpen) toggle.focus();
      else shelf.focusCurrent();
    },
    get presented() {
      return current()?.id ?? null;
    },
    get isOpen() {
      return reader !== null;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerInput, true);
      document.removeEventListener('keydown', onKeyInput, true);
      phoneMedia?.removeEventListener('change', onPhoneChange);
      stopSession?.();
      stopMotion();
      stopIntents();
      detachGesture();
      landFlight();
      paint.destroy();
      reader?.destroy();
      reader = null;
      setBackgroundInert(false);
      motion.destroy();
      shelf.destroy();
      root.remove();
      if (ownLayer) layer?.remove();
      if (themeRoot) {
        if (rootVariantBefore === undefined) delete document.documentElement.dataset.variant;
        else document.documentElement.dataset.variant = rootVariantBefore;
      }
    },
  };
}
