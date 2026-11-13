import { uiLang, type StringVars, type UiLang } from '../i18n';
import { createWordmark } from '../look/brand';
import type { Roadmap } from '../roadmap/types';
import type { BriefBuilder, BriefOptions } from './brief';
import { ensurePaperEdge } from '../look/dom';
import { CAMP } from './art';
import { HIDDEN, h, svg } from './dom';
import {
  PHONE_FIRST_GAP,
  STOPS,
  boxLeg,
  currentStop,
  goDuration,
  isUp,
  legPoints,
  linkAge,
  localScroll,
  pieceRange,
  progressFromScroll,
  stopState,
  threadHead,
  type Point,
  type StopId,
  type StopSpan,
  type StopState,
  type ThreadPiece,
} from './model';
import './sections.css';
import { MAP_THEMES, PLAIN_PRINT, REPOSITORY, buildStops, camel, navKey, type InstallPath, type PageState, type StopContext, type StopView } from './stops';
import { hasSectionWords, loadSectionWords, say, type SectionKey } from './strings';
import { createPiece, createWalker, type ThreadPieceView } from './thread';
import { DEFAULT_TICKET } from './ticket';

/**
 * The landing sections: the page under the hero. A red thread runs from stop to stop, and each stop is a paper
 * station that explains one part of the product. The text is the page. It is in the document as headings,
 * paragraphs, lists and one form, and it reads the same without scripts' motion, without WebGL and with
 * reduced motion. Everything that moves is decoration on top.
 *
 * The same stops serve two modes. With the gallery on the table they explain the skill. Given a person's own
 * roadmap they are that roadmap's trip brief: its stages, sources, counts, pace, map, upkeep, gaps and a permit
 * to start. The brief is built by `brief.ts`, which is fetched only when a roadmap is given.
 */

export interface SectionLinks {
  readonly repository?: string;
  readonly format?: string;
  readonly gallery?: string;
  readonly licence?: string;
  readonly changelog?: string;
}

/** A roadmap of the gallery, for the line in the footer that says how old its link check is. */
export interface GalleryExample {
  readonly title: string;
  /** Language of the title, for `lang` on its element. */
  readonly lang?: string;
  /** Day of the last full link check, `YYYY-MM-DD`. */
  readonly checkedOn: string;
  readonly freshness?: string;
  readonly href?: string;
}

export interface SectionsOptions extends BriefOptions {
  /**
   * A person's own roadmap. With one, the stops are its trip brief. Default: none, and the stops explain the
   * skill as they do for the gallery.
   */
  readonly roadmap?: Roadmap | null;
  /**
   * Interface language. Default: the page's (`uiLang()`). A page that starts in German awaits
   * `loadSectionWords('de')` before it mounts, or the sections show English until the German words arrive.
   */
  readonly lang?: UiLang;
  /** Reads the visitor's reduced-motion wish. Default: the media query. */
  readonly reduced?: () => boolean;
  /** Where the index tabs go, for example the slot in the page header. Default: a bar the sections fix to the top. */
  readonly navHost?: HTMLElement | null;
  /** A topic to punch into the ticket, for example the topic of the roadmap that is lit on the table. */
  readonly topic?: string;
  readonly links?: SectionLinks;
  readonly examples?: readonly GalleryExample[];
  /** The day each install path was run from a release. A path without a day is shown as untested. */
  readonly tested?: Readonly<Partial<Record<InstallPath['id'], string>>>;
  /** Put before every id the sections add to the document. Default: none. */
  readonly idPrefix?: string;
  /** The seed of the contour sheet at the map stop. Default: "zero-to". */
  readonly seed?: string;
  /** Where "back to the trailhead" leads. Default: "#top". */
  readonly topHref?: string;
  /** Called when another stop becomes the current one. -1 and null above the first stop. */
  onStop?(index: number, id: StopId | null): void;
  /** Called with every command a visitor copies. Nothing is sent anywhere by the sections themselves. */
  onCopy?(command: string): void;
}

export interface Sections {
  readonly root: HTMLElement;
  /**
   * Shows the sections at a scroll progress: 0 when the top of the root reaches the bottom of the window, 1
   * when the bottom of the root does. `progressAt` turns a scroll position into this number.
   */
  update(scrollProgress: number): void;
  /**
   * Changes the language in place. German words are fetched on first use: the page changes when they arrive.
   * Await `loadSectionWords(lang)` first to change in one step.
   */
  setLang(lang: UiLang): void;
  destroy(): void;
  /** The progress for a scroll position of the window. */
  progressAt(scrollY: number): number;
  /** Measures the layout again. Called by itself on resize and when fonts arrive. */
  measure(): void;
  /** Scrolls to a stop. */
  go(stop: number | StopId): void;
  setTopic(topic: string): void;
  /**
   * Puts a person's own roadmap on the page, or takes it off with null. The stops are built again: as the trip
   * brief of the roadmap, or as the tour of the skill. The page changes once the brief has been fetched.
   */
  setRoadmap(roadmap: Roadmap | null): void;
  /** The current stop, or -1 above the first. */
  readonly current: number;
  /** The length of thread drawn in the route colour, in pixels. */
  readonly threadDone: number;
}

/** The repository's address, from the one place that names it. */
const HOME = `https://github.com/${REPOSITORY}`;

export const DEFAULT_LINKS: SectionLinks = {
  repository: HOME,
  format: `${HOME}/blob/main/.agents/skills/zero-to/references/roadmap-format.md`,
  licence: `${HOME}/blob/main/LICENSE`,
};

/** The footer links in their order. The label of each is the string `link` plus its name: `linkRepository`. */
const LINK_KEYS: readonly (keyof SectionLinks)[] = ['repository', 'format', 'gallery', 'licence', 'changelog'];

/** Below this width the stops are not pinned and the index tabs fold into one. */
const NARROW = 900;

/** What the folded tab adds to a tab: the gap before its caret and the caret. */
const FOLD_CARET = 15;

/** The margin a row of tabs keeps from the window's edges when it has no header to stand in. */
const NAV_MARGIN = 46;

/** The sizes a station is tried at, largest first, until its stop fits the window. */
const FIT = [1, 0.94, 0.88, 0.82] as const;

interface Layout {
  viewport: number;
  width: number;
  top: number;
  height: number;
  spans: StopSpan[];
  pieces: ThreadPiece[];
  views: { view: ThreadPieceView; host: HTMLElement }[];
}

export function mountSections(root: HTMLElement, options: SectionsOptions = {}): Sections {
  let lang: UiLang = options.lang ?? uiLang();
  let roadmap = options.roadmap;
  // The builder of roadmap mode, and the language its words were fetched for.
  let brief: BriefBuilder | undefined;
  let briefLang: UiLang | undefined;
  const idPrefix = options.idPrefix ?? '';
  const media = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reduced = options.reduced ?? (() => Boolean(media?.matches));
  const state: PageState = {
    ticket: { ...DEFAULT_TICKET, topic: options.topic ?? '' },
    map: { shape: 'volcano', trail: 'spiral', theme: (MAP_THEMES[0] as (typeof MAP_THEMES)[number]).id, roll: 0 },
    faq: 0,
  };

  let stops: StopView[] = [];
  let gaps: HTMLElement[] = [];
  let tabs: HTMLAnchorElement[] = [];
  let nav: HTMLElement | null = null;
  let navToggle: HTMLButtonElement | null = null;
  let layout: Layout | null = null;
  let progress = 0;
  let current = -2;
  let threadDone = 0;
  let headPiece = -1;
  let destroyed = false;
  let scrollFrame = 0;
  let printWanted = '';
  let printShown = '';
  let pinKey = '';
  const applied: string[] = [];
  const manual: (number | null)[] = [];
  const walker = createWalker();
  // The night behind the header. It stands with the index tabs, and it is shown once the sections are under them.
  const band = h('div', { class: 'zs-band', ...HIDDEN });
  // The tabs are fitted again when their room changes: the window, the tools beside them, or their being shown.
  let navFrame = 0;
  const navObserver =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
          cancelAnimationFrame(navFrame);
          navFrame = requestAnimationFrame(fitNav);
        })
      : null;

  const s = (key: SectionKey, vars?: StringVars) => say(key, vars, lang);

  ensurePaperEdge(document);
  root.classList.add('zs-root');

  // -------------------------------------------------------------------------------------------------------
  // Building.

  const seedOf = () => `${options.seed ?? 'zero-to'}${state.map.roll > 0 ? `-${state.map.roll + 1}` : ''}`;

  function requestPrint(): void {
    const mapStop = stops.find((stop) => stop.print);
    if (!mapStop?.print) return;
    const { map } = state;
    const key = `${map.shape}/${map.trail}/${map.theme}/${seedOf()}/${lang}`;
    if (key === printWanted) return;
    printWanted = key;
    const target = mapStop.print;
    void import('./mapprint')
      .then(({ mapPrint }) => {
        if (destroyed || printWanted !== key) return;
        target.group.innerHTML = mapPrint({ shape: map.shape, trail: map.trail, theme: map.theme, seed: seedOf() });
        target.caption.textContent = s('mapPrint', { shape: s(`shape${camel(map.shape)}` as SectionKey), trail: s(`trail${camel(map.trail)}` as SectionKey), seed: seedOf() });
        printShown = key;
      })
      .catch(() => {
        // Without the generator the sheet keeps its plain print.
        printWanted = printShown;
      });
  }

  /** The label of a stop's tab: its own in roadmap mode, the gallery's otherwise. */
  const tabName = (index: number): string => stops[index]?.nav ?? s(navKey((STOPS[index] as (typeof STOPS)[number]).id));

  function buildNav(): HTMLElement {
    tabs = STOPS.filter((stop) => !stop.centred).map((stop, index) => {
      const link = h(
        'a',
        { class: 'zs-tab zt-label zt-on-paper', href: `#${idPrefix}${stop.anchor}` },
        h('span', { class: 'zs-tab-n', ...HIDDEN }, String(index + 1).padStart(2, '0')),
        h('span', {}, tabName(index)),
      );
      link.addEventListener('click', (event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        setNavOpen(false);
        go(index);
      });
      return link;
    });
    navToggle = h('button', { type: 'button', class: 'zs-tab zs-nav-toggle zt-label zt-on-paper', 'aria-expanded': 'false', 'aria-controls': `${idPrefix}zs-tabs` });
    navToggle.addEventListener('click', () => setNavOpen(navToggle?.getAttribute('aria-expanded') !== 'true'));
    const list = h('ol', { class: 'zs-tabs', id: `${idPrefix}zs-tabs` }, ...tabs.map((tab) => h('li', {}, tab)));
    const element = h('nav', { class: `zs-nav${options.navHost ? '' : ' zs-nav-fixed'}`, 'aria-label': s('navLabel') }, navToggle, list);
    element.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') setNavOpen(false);
    });
    return element;
  }

  function setNavOpen(open: boolean): void {
    navToggle?.setAttribute('aria-expanded', String(open));
    nav?.classList.toggle('is-open', open);
  }

  /**
   * Hangs the index tabs as a row when the row fits the room it is given, and folds them into one tab when it
   * does not: always under NARROW, and on a wider window when the header's tools, a longer language or the
   * labels of a roadmap leave the row too little room. A folded tab that is still wider than its room keeps
   * its number and caret only. Tabs that are not shown, as in a walk, are fitted once they are.
   */
  function fitNav(): void {
    const list = nav?.querySelector<HTMLElement>('.zs-tabs');
    if (!nav || !navToggle || !list || nav.offsetWidth === 0) return;
    const width = root.clientWidth || window.innerWidth || 1200;
    nav.classList.remove('zs-folded', 'zs-tight');
    const room = options.navHost ? options.navHost.clientWidth : width - 2 * NAV_MARGIN;
    if (width >= NARROW && list.scrollWidth <= room + 1) {
      setNavOpen(false);
      return;
    }
    nav.classList.add('zs-folded');
    // The folded tab names the stop it is at, so it can be as wide as the widest tab with its caret.
    const widest = Math.max(navToggle.offsetWidth, ...tabs.map((tab) => tab.offsetWidth + FOLD_CARET));
    nav.classList.toggle('zs-tight', widest > room + 1);
  }

  function buildFooter(): HTMLElement {
    const links = { ...DEFAULT_LINKS, ...options.links };
    const stamps = LINK_KEYS.filter((key) => links[key]).map((key, index) => {
      const stamp = h('a', { class: 'zs-stamp zt-label zt-on-paper', href: links[key] as string }, s(`link${camel(key)}` as SectionKey));
      stamp.style.setProperty('--tilt', `${[-3, 2, -1.5, 3, -2][index % 5]}deg`);
      return h('li', {}, stamp);
    });
    const today = options.today ?? new Date();
    const ages = (options.examples ?? [])
      .map((example) => {
        const age = linkAge(example.checkedOn, today, example.freshness);
        if (!age) return null;
        const title = h(example.href ? 'a' : 'span', { class: 'zs-age-title', lang: example.lang ?? null, dir: 'auto', href: example.href ?? null }, example.title);
        return h(
          'li',
          { class: 'zs-age' },
          title,
          h('span', { class: 'zs-age-line zt-data' }, age.days === 0 ? s('ageToday') : s('ageDays', { count: age.days }), ' · ', s(age.inDate ? 'ageInDate' : 'ageDue')),
        );
      })
      .filter((item): item is HTMLLIElement => item !== null);
    const mark = createWordmark(document);
    mark.classList.add('zs-foot-mark');
    return h(
      'footer',
      { class: 'zs-foot' },
      h('div', { class: 'zs-camp' }, svg(CAMP.viewBox, CAMP.body), h('p', { class: 'zt-title' }, s('footEnd'))),
      ages.length > 0 ? h('section', { class: 'zs-ages', 'aria-labelledby': `${idPrefix}zs-ages-title` }, h('h2', { class: 'zt-label', id: `${idPrefix}zs-ages-title` }, s('footGallery')), h('ul', {}, ...ages)) : null,
      h('div', { class: 'zs-foot-word', ...HIDDEN }, mark),
      h(
        'div',
        { class: 'zs-foot-row' },
        h('nav', { 'aria-label': s('footLinks') }, h('ul', { class: 'zs-stamps' }, ...stamps)),
        h('p', { class: 'zs-foot-note zt-small' }, s('footLicence')),
        h('a', { class: 'zs-top zt-label', href: options.topHref ?? '#top' }, s('footTop'), h('span', HIDDEN, ' ↑')),
      ),
    );
  }

  function build(): void {
    for (const stop of stops) stop.dispose?.();
    nav?.remove();
    const context: StopContext = {
      lang,
      idPrefix,
      state,
      tested: options.tested ?? {},
      reduced,
      onMap: requestPrint,
      ...(options.onCopy ? { onCopy: options.onCopy } : {}),
    };
    stops = roadmap && brief ? brief(context, roadmap, options) : buildStops(context);
    gaps = stops.map((stop, index) => {
      const gap = h('div', { class: 'zs-gap', ...HIDDEN });
      gap.style.setProperty('--zs-gap', String(stop.spec.gap));
      if (index === 0) gap.classList.add('zs-gap-first');
      return gap;
    });
    nav = buildNav();
    const parts: Node[] = [];
    stops.forEach((stop, index) => parts.push(gaps[index] as HTMLElement, stop.section));
    root.replaceChildren(...(options.navHost ? [] : [band, nav]), ...parts, buildFooter());
    options.navHost?.append(band, nav);
    navObserver?.disconnect();
    navObserver?.observe(nav);
    if (options.navHost) navObserver?.observe(options.navHost);
    root.lang = lang;

    for (const stop of stops) if (stop.print) stop.print.group.innerHTML = PLAIN_PRINT;
    printWanted = '';
    printShown = '';

    stops.forEach((stop, index) => {
      manual[index] = null;
      applied[index] = '';
      // Pointing at a thing, or tabbing to it, brings it to the front while the pointer or the focus stays.
      stop.steps.forEach((elements, step) => {
        const lead = elements[0];
        if (!lead) return;
        const set = (value: number | null) => () => {
          manual[index] = value;
          render();
        };
        lead.addEventListener('pointerenter', set(step));
        lead.addEventListener('pointerleave', set(null));
        lead.addEventListener('focusin', set(step));
        lead.addEventListener('focusout', set(null));
      });
    });
    for (const stop of stops) for (const element of stop.ups) if (!element.matches('.zs-cut, .zs-orb-card')) element.classList.add('zs-rise');
    layout = null;
    pinKey = '';
    headPiece = -1;
    current = -2;
  }

  // -------------------------------------------------------------------------------------------------------
  // Measuring.

  function measure(): void {
    if (destroyed) return;
    const viewport = window.innerHeight || document.documentElement.clientHeight || 800;
    const width = root.clientWidth || window.innerWidth || 1200;
    const still = reduced();
    const narrow = width < NARROW;
    root.style.setProperty('--zs-vh', `${viewport}px`);
    root.classList.toggle('zs-narrow', narrow);
    root.classList.toggle('zs-still', still);
    root.classList.add('zs-live');
    (gaps[0] as HTMLElement | undefined)?.style.setProperty('--zs-gap', String(narrow ? PHONE_FIRST_GAP : (STOPS[0] as (typeof STOPS)[number]).gap));

    // A stop is pinned when it has a hold, motion is wanted, the window is wide and tall enough and its box
    // fits the window. That is decided once per window size, so opening a question never unpins a stop.
    const key = `${width}/${viewport}/${still}/${lang}`;
    if (key !== pinKey) {
      pinKey = key;
      const canPin = !still && !narrow && viewport >= 620;
      for (const stop of stops) {
        stop.section.removeAttribute('data-pin');
        stop.station.style.removeProperty('zoom');
      }
      for (const stop of stops) {
        if (!canPin || stop.spec.hold <= 0) continue;
        // A station that is a little too tall for the window is drawn a little smaller, so the stop can pin.
        for (const zoom of FIT) {
          if (zoom < 1) stop.station.style.setProperty('zoom', String(zoom));
          if (stop.box.offsetHeight <= viewport) {
            stop.section.setAttribute('data-pin', '');
            break;
          }
        }
        if (!stop.section.hasAttribute('data-pin')) stop.station.style.removeProperty('zoom');
      }
    }

    const rootBox = root.getBoundingClientRect();
    const scrollY = window.scrollY || 0;
    const gutter = narrow ? 18 : 46;
    const band = narrow ? 30 : 54;
    const spans: StopSpan[] = [];
    const pieces: ThreadPiece[] = [];
    const views: Layout['views'] = [];
    root.querySelectorAll('.zs-thread').forEach((node) => node.remove());

    let from = width * 0.5;
    stops.forEach((stop, index) => {
      const pinned = stop.section.hasAttribute('data-pin');
      const sectionBox = stop.section.getBoundingClientRect();
      const top = sectionBox.top - rootBox.top;
      const boxHeight = pinned ? viewport : sectionBox.height;
      const hold = pinned ? stop.spec.hold * viewport : 0;
      spans.push({ top, box: boxHeight, hold });

      const gap = gaps[index] as HTMLElement;
      const gapBox = gap.getBoundingClientRect();
      const enter = stop.spec.centred ? width / 2 : gutter;
      const leg = createPiece(legPoints(stop.spec.leg, from, enter, width, gapBox.height), width, gapBox.height, {
        deco: `${index}/${Math.round(width / 40)}`,
        rings: stop.spec.leg === 'meander',
      });
      gap.append(leg.element);
      const legRange = pieceRange(gapBox.top - rootBox.top, gapBox.height, 0, viewport);
      pieces.push({ from: legRange[0], to: legRange[1], length: leg.line.length });
      views.push({ view: leg, host: gap });

      const exit = Math.max(gutter + 80, Math.min(width - 60, width * stop.spec.exit));
      let points: Point[];
      if (stop.spec.centred) {
        const tagBox = stop.tag.getBoundingClientRect();
        points = boxLeg(width, boxHeight, gutter, band, exit, tagBox.top - stop.box.getBoundingClientRect().top - 8);
      } else {
        points = boxLeg(width, boxHeight, gutter, band, exit);
      }
      const inside = createPiece(points, width, boxHeight);
      stop.box.prepend(inside.element);
      const insideRange = pieceRange(top, boxHeight, hold, viewport);
      // The short drop to the tag of the centred stop is walked at the pace of the scroll, so the walker
      // arrives when the tag does.
      pieces.push({ from: insideRange[0], to: stop.spec.centred ? insideRange[0] + inside.line.length : insideRange[1], length: inside.line.length });
      views.push({ view: inside, host: stop.box });
      from = exit;
    });

    layout = { viewport, width, top: rootBox.top + scrollY, height: root.offsetHeight, spans, pieces, views };
    headPiece = -1;
    applied.fill('');
    render();
    fitNav();
  }

  // -------------------------------------------------------------------------------------------------------
  // Showing a scroll position.

  function apply(stop: StopView, index: number, shown: StopState, still: boolean): void {
    const step = manual[index] ?? shown.step;
    const key = `${still ? 1 : Math.round(shown.form * 200)}/${step}/${shown.phase}/${Math.round(shown.hold * 100)}`;
    if (applied[index] === key) return;
    applied[index] = key;
    const count = stop.ups.length;
    stop.ups.forEach((element, at) => element.classList.toggle('is-up', still || isUp(shown.form, at, count)));
    stop.steps.forEach((elements, at) => {
      for (const element of elements) element.classList.toggle('is-on', at === step);
    });
    stop.section.toggleAttribute('data-focus', step >= 0);
    stop.section.dataset.phase = shown.phase;
    stop.onState?.(still ? { ...shown, form: 1 } : shown, still);
    if (stop.print && shown.phase !== 'ahead') requestPrint();
  }

  function render(): void {
    if (!layout || destroyed) return;
    const { viewport, spans, pieces, views } = layout;
    const y = localScroll(progress, layout.height, viewport);
    const still = reduced();

    // From the moment the top of the sections passes the top of the window, something scrolls under the header.
    band.classList.toggle('is-on', y > 0);
    stops.forEach((stop, index) => apply(stop, index, stopState(spans[index] as StopSpan, stop.spec.steps, viewport, y), still));

    const now = currentStop(spans, viewport, y);
    if (now !== current) {
      current = now;
      tabs.forEach((tab, index) => {
        if (index === now) tab.setAttribute('aria-current', 'location');
        else tab.removeAttribute('aria-current');
      });
      const spec = STOPS[now];
      // The folded tab of a narrow window names the stop it is at.
      const tabbed = spec && now < tabs.length ? spec : null;
      navToggle?.classList.toggle('is-current', Boolean(tabbed));
      navToggle?.replaceChildren(
        ...[
          tabbed ? h('span', { class: 'zs-sr' }, `${s('navMenu')}: `) : null,
          tabbed ? h('span', { class: 'zs-tab-n', ...HIDDEN }, String(now + 1).padStart(2, '0')) : null,
          h('span', { class: 'zs-toggle-name' }, tabbed ? tabName(now) : s('navMenu')),
          h('span', { class: 'zs-caret', ...HIDDEN }),
        ].filter((node): node is HTMLSpanElement => node !== null),
      );
      options.onStop?.(now, spec?.id ?? null);
    }

    const head = threadHead(pieces, y);
    threadDone = head.done;
    if (head.piece !== headPiece) {
      // Everything behind the head is done, everything ahead is not.
      views.forEach(({ view }, index) => {
        if (index !== head.piece) {
          view.setDone(index < head.piece ? view.line.length : 0);
          view.setHead(null);
        }
      });
      headPiece = head.piece;
    }
    const here = views[head.piece];
    if (here) {
      const point = here.view.setDone(head.along);
      const visible = y > (pieces[0] as ThreadPiece).from - viewport * 0.4;
      here.view.setHead(visible ? point : null);
      if (visible) walker.place(here.host, point, head.done, still);
      else walker.hide();
    }
  }

  // -------------------------------------------------------------------------------------------------------
  // Going to a stop.

  function scrollWindow(top: number, seconds: number): void {
    cancelAnimationFrame(scrollFrame);
    if (seconds <= 0) {
      window.scrollTo(0, top);
      return;
    }
    const start = window.scrollY;
    const began = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - began) / (seconds * 1000));
      const eased = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      window.scrollTo(0, start + (top - start) * eased);
      if (t < 1) scrollFrame = requestAnimationFrame(step);
    };
    scrollFrame = requestAnimationFrame(step);
  }

  function go(target: number | StopId): void {
    if (!layout) measure();
    const index = typeof target === 'number' ? target : STOPS.findIndex((stop) => stop.id === target);
    const stop = stops[index];
    const span = layout?.spans[index];
    if (!stop || !span || !layout) return;
    // A pinned stop is entered a little way into its hold, so its first thing is already in front.
    const top = Math.max(0, layout.top + span.top + (span.hold > 0 ? Math.min(60, span.hold * 0.06) : 0));
    const seconds = reduced() ? 0 : goDuration(top - window.scrollY);
    if (options.scrollTo) options.scrollTo(top, seconds);
    else scrollWindow(top, seconds);
    try {
      history.replaceState(history.state, '', `#${stop.section.id}`);
    } catch {
      // A sandboxed page may not rewrite its address. The scroll still happens.
    }
    stop.title.focus({ preventScroll: true });
  }

  // -------------------------------------------------------------------------------------------------------
  // Life.

  /**
   * Builds the page in the current language. If its words are still on their way, builds again when they arrive.
   * A page with a roadmap waits for the brief first and keeps what it shows until then. If the brief cannot be
   * fetched, the stops explain the skill.
   */
  function rebuild(): void {
    if (roadmap && briefLang !== lang) {
      const wanted = lang;
      void import('./brief')
        .then((module) => module.loadBrief(wanted))
        .then(
          (builder) => {
            brief = builder;
            briefLang = wanted;
            // A roadmap that was taken off again while the brief was on its way needs no second build.
            return Boolean(roadmap);
          },
          () => {
            roadmap = null;
            return true;
          },
        )
        .then((build) => {
          if (build && !destroyed && lang === wanted) rebuild();
        });
      return;
    }
    build();
    measure();
    if (hasSectionWords(lang)) return;
    const wanted = lang;
    void loadSectionWords(wanted).then(() => {
      if (destroyed || lang !== wanted || !hasSectionWords(wanted)) return;
      build();
      measure();
    });
  }

  rebuild();

  let resizeFrame = 0;
  const remeasure = () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(measure);
  };
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(remeasure) : null;
  observer?.observe(root);
  window.addEventListener('resize', remeasure);
  media?.addEventListener?.('change', remeasure);
  void document.fonts?.ready?.then(remeasure);
  const stopOwnScroll = () => cancelAnimationFrame(scrollFrame);
  window.addEventListener('wheel', stopOwnScroll, { passive: true });
  window.addEventListener('touchstart', stopOwnScroll, { passive: true });

  return {
    root,
    update(scrollProgress) {
      progress = Number.isFinite(scrollProgress) ? Math.min(1, Math.max(0, scrollProgress)) : 0;
      render();
    },
    setLang(next) {
      if (next === lang) return;
      lang = next;
      rebuild();
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(resizeFrame);
      cancelAnimationFrame(scrollFrame);
      cancelAnimationFrame(navFrame);
      observer?.disconnect();
      navObserver?.disconnect();
      window.removeEventListener('resize', remeasure);
      window.removeEventListener('wheel', stopOwnScroll);
      window.removeEventListener('touchstart', stopOwnScroll);
      media?.removeEventListener?.('change', remeasure);
      for (const stop of stops) stop.dispose?.();
      nav?.remove();
      band.remove();
      root.replaceChildren();
      root.classList.remove('zs-root', 'zs-live', 'zs-narrow', 'zs-still');
      root.style.removeProperty('--zs-vh');
    },
    progressAt(scrollY) {
      if (!layout) return 0;
      return progressFromScroll(scrollY, layout.top, layout.height, layout.viewport);
    },
    measure,
    go,
    setTopic(topic) {
      stops.find((stop) => stop.ticket)?.ticket?.setTopic(topic);
    },
    setRoadmap(next) {
      roadmap = next;
      rebuild();
    },
    get current() {
      return Math.max(-1, current);
    },
    get threadDone() {
      return threadDone;
    },
  };
}
