import type { UiLang, StringVars } from '../i18n';
import { spring, stepSpringKC, settleSpring } from '../paper/motion';
import { CARRY_ART, CARRY_KEYS, COMPASS, PEAKS, SIGNPOST, STEP_ART, groundPrint, type CarryKey, type Drawing } from './art';
import { copyText, h, rich, svg, type Child } from './dom';
import { STOPS, type StopId, type StopSpec, type StopState } from './model';
import { say, type SectionKey } from './strings';
import { createTicket, type TicketState, type TicketView } from './ticket';

/**
 * The eight stops as DOM. Each builder returns its section and three lists the page drives from the scroll:
 * what stands up while the station forms, what comes to the front step by step while the stop is held, and an
 * optional hook for anything that follows the hold more closely.
 */

export const SHAPES = ['volcano', 'ridge', 'massif', 'twin-peaks', 'plateau', 'canyon'] as const;
export const TRAILS = ['switchback', 'ridge-walk', 'spiral', 'valley-first', 'traverse'] as const;
export const GROUNDS = ['water', 'sand', 'grass', 'forest', 'dirt', 'scree', 'rock', 'snow'] as const;
export const POSTS = ['timber', 'cairn', 'trig-pillar', 'blaze-post', 'snow-pole', 'buoy', 'summit-flag'] as const;
export const TIERS = ['bronze', 'silver', 'gold', 'diamond'] as const;

export type ShapeId = (typeof SHAPES)[number];
export type TrailId = (typeof TRAILS)[number];
export type GroundId = (typeof GROUNDS)[number];
export type PostId = (typeof POSTS)[number];

/** The four themes with what each sets, as the skill's catalogue lists them. */
export const MAP_THEMES: readonly { readonly id: string; readonly ground: readonly GroundId[]; readonly post: PostId }[] = [
  { id: 'classic-topo', ground: ['grass', 'forest', 'rock', 'snow'], post: 'timber' },
  { id: 'alpine-winter', ground: ['forest', 'scree', 'rock', 'snow'], post: 'snow-pole' },
  { id: 'desert-expedition', ground: ['sand', 'dirt', 'rock'], post: 'cairn' },
  { id: 'coastal-survey', ground: ['water', 'sand', 'grass', 'rock'], post: 'buoy' },
];

/** One way to install the skill. `tested` is the day it was run from a release, or nothing while it has not been. */
export interface InstallPath {
  readonly id: 'claude' | 'codex' | 'other';
  readonly commands: readonly string[];
  /** A second way for the same agent. */
  readonly alternative?: readonly string[];
}

export const REPOSITORY = 'OthmanAdi/zero-to';
export const SKILLS_COMMAND = `npx skills add ${REPOSITORY} --skill zero-to`;

export const INSTALL_PATHS: readonly InstallPath[] = [
  { id: 'claude', commands: [SKILLS_COMMAND], alternative: [`/plugin marketplace add ${REPOSITORY}`, '/plugin install zero-to@zero-to'] },
  { id: 'codex', commands: [SKILLS_COMMAND] },
  { id: 'other', commands: [`git clone https://github.com/${REPOSITORY}.git`] },
];

export interface MapState {
  shape: ShapeId;
  trail: TrailId;
  theme: string;
  /** How often a new seed was rolled. */
  roll: number;
}

export interface PageState {
  readonly ticket: TicketState;
  readonly map: MapState;
  /** The question that is open, or -1. */
  faq: number;
}

export interface StopContext {
  readonly lang: UiLang;
  readonly idPrefix: string;
  readonly state: PageState;
  /** The day each install path was run, by id. A path without a day is shown as untested. */
  readonly tested: Readonly<Partial<Record<InstallPath['id'], string>>>;
  reduced(): boolean;
  onCopy?(command: string): void;
  /** Asks for a new print of the map sheet. */
  onMap?(): void;
}

export interface StopView {
  readonly spec: StopSpec;
  readonly section: HTMLElement;
  readonly box: HTMLElement;
  readonly title: HTMLElement;
  readonly tag: HTMLElement;
  readonly station: HTMLElement;
  /** What stands up, in order, while the station forms. */
  readonly ups: HTMLElement[];
  /** For each step of the hold, what comes to the front. */
  readonly steps: HTMLElement[][];
  /** Called with every new state, after the classes are set. */
  onState?(state: StopState, reduced: boolean): void;
  /** The ticket of the last stop. */
  readonly ticket?: TicketView;
  /** The part of the map stop the print goes into, and its caption. */
  readonly print?: { readonly group: SVGGElement; readonly caption: HTMLElement };
  dispose?(): void;
}

type Say = (key: SectionKey, vars?: StringVars) => string;

/** `twin-peaks` as `TwinPeaks`: the part of a string key that names an option. */
export const camel = (id: string): string => id.replace(/(^|-)([a-z])/g, (_whole, _dash: string, letter: string) => letter.toUpperCase());

const art = (drawing: Drawing, className = ''): SVGSVGElement => svg(drawing.viewBox, drawing.body, className);

function shell(ctx: StopContext, id: StopId, s: Say, tagKey: SectionKey, titleKey: SectionKey, copy: Child[], station: Child[], after: Child[] = []): StopView {
  const index = STOPS.findIndex((stop) => stop.id === id);
  const spec = STOPS[index] as StopSpec;
  const anchor = `${ctx.idPrefix}${spec.anchor}`;
  const number = String(index + 1).padStart(2, '0');
  const title = h('h2', { class: 'zt-headline zs-title', id: `${anchor}-title`, tabindex: -1 }, rich(s(titleKey)));
  const tag = h(
    'p',
    { class: 'zs-tag zt-label' },
    h('span', { class: 'zs-sr' }, `${s('stopOf', { n: index + 1, count: STOPS.length })}: `),
    h('span', { class: 'zs-tag-n', 'aria-hidden': 'true' }, number),
    h('span', {}, s(tagKey)),
  );
  const copyEl = h('div', { class: 'zs-copy' }, tag, title, ...copy);
  const stationEl = h('div', { class: 'zs-station' }, ...station);
  // What follows the station in reading order stands under the copy on a wide window.
  const box = h('div', { class: 'zs-box' }, copyEl, stationEl, after.length > 0 ? h('div', { class: 'zs-after' }, ...after) : null);
  const section = h('section', { class: `zs-stop zs-stop-${id}${spec.centred ? ' zs-centred' : ''}`, id: anchor, 'aria-labelledby': `${anchor}-title`, 'data-stop': id }, box);
  section.style.setProperty('--zs-hold', String(spec.hold));
  return { spec, section, box, title, tag, station: stationEl, ups: [], steps: [] };
}

const lede = (text: string): HTMLElement => h('p', { class: 'zs-lede zt-body' }, rich(text));
const body = (text: string, className = 'zs-text zt-body'): HTMLElement => h('p', { class: className }, rich(text));

// ---------------------------------------------------------------------------------------------------------
// 01 What it is, with the four altitudes.

function buildWhat(ctx: StopContext, s: Say): StopView {
  const print = groundPrint(1);
  const ground = h('div', { class: 'zs-ground' }, h('div', { class: 'zs-ground-paper' }, svg(print.viewBox, print.body)));
  const peaks = PEAKS.map((drawing, index) => {
    const cut = h('span', { class: 'zs-cut zs-peak' }, art(drawing));
    cut.style.setProperty('--x', `${15 + index * 23.4}%`);
    cut.style.setProperty('--y', `${47 + index * 2.5}%`);
    cut.style.setProperty('--w', `${(drawing.width / 800) * 128}%`);
    const shadow = h('i', { class: 'zs-cut-shadow' });
    shadow.style.setProperty('--x', `${15 + index * 23.4}%`);
    shadow.style.setProperty('--y', `${47 + index * 2.5}%`);
    shadow.style.setProperty('--w', `${(drawing.width / 800) * 128}%`);
    ground.append(shadow, cut);
    return cut;
  });
  const theatre = h('div', { class: 'zs-theatre zs-theatre-peaks', 'aria-hidden': 'true' }, ground);

  const cards = TIERS.map((tier) => {
    const key = `tier${camel(tier)}` as SectionKey;
    const card = h(
      'li',
      { class: 'zs-tier zs-card zt-on-paper', 'data-tier': tier },
      h('span', { class: 'zs-blaze', 'aria-hidden': 'true' }),
      h('h4', { class: 'zs-card-title' }, s(key)),
      h('p', { class: 'zt-small' }, s(`${key}Body` as SectionKey)),
    );
    return card;
  });

  const view = shell(
    ctx,
    'what',
    s,
    'whatTag',
    'whatTitle',
    [lede(s('whatLede')), body(s('whatBody')), h('h3', { class: 'zs-sub' }, s('whatTiers')), body(s('whatTiersBody'), 'zs-text zt-small')],
    [theatre, h('ul', { class: 'zs-tiers' }, ...cards)],
  );
  view.ups.push(...peaks, ...cards);
  view.steps.push(...TIERS.map((_tier, index) => [peaks[index] as HTMLElement, cards[index] as HTMLElement]));
  return view;
}

// ---------------------------------------------------------------------------------------------------------
// 02 How it works: four steps.

function buildHow(ctx: StopContext, s: Say): StopView {
  const steps = [1, 2, 3, 4].map((n) =>
    h(
      'li',
      { class: 'zs-step zs-card zt-on-paper' },
      h('span', { class: 'zs-step-art', 'aria-hidden': 'true' }, art(STEP_ART[n - 1] as Drawing)),
      h('span', { class: 'zs-step-n zt-number', 'aria-hidden': 'true' }, String(n)),
      h('h3', { class: 'zs-card-title' }, s(`how${n}` as SectionKey)),
      h('p', { class: 'zt-small' }, rich(s(`how${n}Body` as SectionKey))),
    ),
  );
  const slips = (['slipVerified', 'slipGated', 'slipUnverified', 'slipDead'] as const).map((key) => h('li', { class: `zs-slip zs-${key}` }, s(key)));
  const view = shell(
    ctx,
    'how',
    s,
    'howTag',
    'howTitle',
    [lede(s('howLede'))],
    [h('ol', { class: 'zs-steps' }, ...steps)],
    [h('ul', { class: 'zs-slips zt-data', 'aria-hidden': 'true' }, ...slips), body(s('howReport'), 'zs-text zt-small')],
  );
  view.ups.push(...steps);
  view.steps.push(...steps.map((step) => [step]));
  return view;
}

// ---------------------------------------------------------------------------------------------------------
// 03 On the trail: five cards round a compass, and two things the learner keeps.

const RING = { step: (72 * Math.PI) / 180, k: 15, c: 7.4, front: 1.32 } as const;

function buildTrail(ctx: StopContext, s: Say): StopView {
  const ringKeys = CARRY_KEYS.slice(0, 5) as CarryKey[];
  const orbCards = ringKeys.map((key) => h('span', { class: 'zs-orb-card' }, h('span', { class: 'zs-orb-face' }, art(CARRY_ART[key]))));
  const orbit = h('div', { class: 'zs-orbit', 'aria-hidden': 'true' }, h('span', { class: 'zs-orb-compass' }, art(COMPASS)), ...orbCards);

  const item = (key: CarryKey, titleKey: SectionKey, level: 'h3' | 'h4') =>
    h(
      'li',
      { class: 'zs-carry-item' },
      h('span', { class: 'zs-carry-art', 'aria-hidden': 'true' }, art(CARRY_ART[key])),
      h('div', {}, h(level, { class: 'zs-item-title' }, s(titleKey)), h('p', { class: 'zt-small' }, s(`${titleKey}Body` as SectionKey))),
    );
  const carried = ringKeys.map((key) => item(key, `carry${camel(key)}` as SectionKey, 'h3'));
  const kept = [item('notebook', 'keepNotebook', 'h4'), item('cairns', 'keepCairns', 'h4')];

  const view = shell(
    ctx,
    'trail',
    s,
    'trailTag',
    'trailTitle',
    [lede(s('trailLede'))],
    [orbit, h('ul', { class: 'zs-carry zs-sheet zt-on-paper' }, ...carried)],
    [h('h3', { class: 'zs-sub' }, s('keepTitle')), h('ul', { class: 'zs-keep' }, ...kept), body(s('trailRule'), 'zs-text zt-small zs-rule')],
  );
  view.ups.push(...orbCards, ...carried);
  view.steps.push(...carried.map((element, index) => [element, orbCards[index] as HTMLElement]), ...kept.map((element) => [element]));

  // The ring turns on a heavy, calm spring so the card of the current step comes to the front.
  const turn = spring(0);
  let target = 0;
  let frame = 0;
  let last = 0;
  const place = () => {
    orbCards.forEach((card, index) => {
      const angle = turn.x + index * RING.step;
      const depth = Math.cos(angle);
      const facing = Math.max(0, depth) ** 6;
      const scale = (0.66 + 0.2 * ((depth + 1) / 2)) * (1 + (RING.front - 1) * facing);
      card.style.setProperty('--ox', (Math.sin(angle) * 50).toFixed(2));
      card.style.setProperty('--oy', depth.toFixed(3));
      card.style.setProperty('--os', scale.toFixed(3));
      card.style.zIndex = String(10 + Math.round(depth * 10));
      card.style.setProperty('--od', (0.78 + 0.22 * ((depth + 1) / 2)).toFixed(3));
    });
  };
  const tick = (now: number) => {
    // The spring is solved in closed form, so a slow frame may take a long step.
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    stepSpringKC(turn, target, RING.k, RING.c, dt);
    place();
    frame = Math.abs(turn.x - target) > 0.002 || Math.abs(turn.v) > 0.002 ? requestAnimationFrame(tick) : 0;
  };
  const face = (index: number, immediate: boolean) => {
    const wanted = -index * RING.step;
    const full = Math.PI * 2;
    // By the shorter way round.
    target = wanted + Math.round((turn.x - wanted) / full) * full;
    if (immediate) {
      settleSpring(turn, target);
      place();
    } else if (!frame) {
      last = performance.now();
      frame = requestAnimationFrame(tick);
    }
  };
  place();
  let shown = 0;
  view.onState = (state, reduced) => {
    const index = state.step >= 0 && state.step < orbCards.length ? state.step : shown;
    if (index !== shown || reduced) {
      shown = index;
      face(index, reduced);
    }
  };
  view.dispose = () => cancelAnimationFrame(frame);
  return view;
}

// ---------------------------------------------------------------------------------------------------------
// 04 For a class: a weeks ruler with one strip per altitude and the sessions under it.

const PLAN = {
  weeks: 8,
  strips: [
    { tier: 'bronze', from: 1, to: 2 },
    { tier: 'silver', from: 3, to: 5 },
    { tier: 'gold', from: 6, to: 8 },
  ],
  /** Where the class flag stands, in weeks from the left edge. */
  today: 3.5,
} as const;

function buildClass(ctx: StopContext, s: Say): StopView {
  const weeks = Array.from({ length: PLAN.weeks }, (_unused, index) => h('span', { class: 'zs-week zt-label' }, s('planWeek', { n: index + 1 })));
  const strips = PLAN.strips.map((strip) => {
    const element = h('span', { class: 'zs-strip zt-label', 'data-tier': strip.tier }, s(`tier${camel(strip.tier)}` as SectionKey));
    element.style.gridColumn = `${strip.from} / ${strip.to + 1}`;
    return h('div', { class: 'zs-plan-row' }, element);
  });
  const sessions = h(
    'div',
    { class: 'zs-plan-row zs-plan-sessions' },
    ...Array.from({ length: PLAN.weeks }, (_unused, index) => h('span', { class: 'zs-session zt-data' }, String(index + 1))),
  );
  const today = h('span', { class: 'zs-today' }, h('span', { class: 'zs-today-flag zt-label' }, s('planToday')));
  today.style.setProperty('--at', `${(PLAN.today / PLAN.weeks) * 100}%`);
  const rows = [...strips, sessions];
  const plan = h(
    'figure',
    { class: 'zs-plan zs-sheet zt-on-paper' },
    h('div', { class: 'zs-plan-grid', 'aria-hidden': 'true' }, h('div', { class: 'zs-plan-row zs-plan-weeks' }, ...weeks), ...rows, today),
    h('figcaption', { class: 'zt-small' }, s('planCaption')),
  );

  const facts = (['classSessions', 'classFiles', 'classHandouts', 'classPrivate'] as const).map((key) =>
    h('li', { class: 'zs-fact' }, h('h3', { class: 'zs-item-title' }, s(key)), h('p', { class: 'zt-small' }, s(`${key}Body` as SectionKey))),
  );

  const view = shell(ctx, 'class', s, 'classTag', 'classTitle', [lede(s('classLede'))], [plan, h('ul', { class: 'zs-facts' }, ...facts)], [body(s('classFit'), 'zs-text zt-small zs-rule')]);
  view.ups.push(plan, ...facts);
  view.onState = (state, still) => {
    // One row goes down after another while the stop is held, then the flag marks where the class is.
    const through = still || state.phase === 'done' ? 1 : state.phase === 'active' ? state.hold : 0;
    rows.forEach((row, index) => row.classList.toggle('is-down', through > 0.04 + 0.14 * index));
    today.classList.toggle('is-down', through > 0.82);
  };
  return view;
}

// ---------------------------------------------------------------------------------------------------------
// 05 The map: a folded contour sheet and the options a roadmap can choose.

/** How many panels the sheet is folded into. */
export const FOLD_PANELS = 6;

function buildMap(ctx: StopContext, s: Say): StopView {
  const { map } = ctx.state;
  const printId = `${ctx.idPrefix}zs-print`;
  const source = svg('0 0 600 400', `<defs><g id="${printId}"></g></defs>`, 'zs-print-source');
  const group = source.querySelector('g') as SVGGElement;

  // The panels are nested, so each one folds on the edge of the one before it.
  let inner: HTMLElement | null = null;
  for (let index = FOLD_PANELS - 1; index >= 0; index -= 1) {
    const slice = svg(`${index * (600 / FOLD_PANELS)} 0 ${600 / FOLD_PANELS} 400`, `<use href="#${printId}"/>`);
    slice.setAttribute('preserveAspectRatio', 'none');
    const panel: HTMLElement = h('div', { class: 'zs-panel' }, h('div', { class: 'zs-panel-face' }, slice));
    panel.style.setProperty('--i', String(index));
    if (inner) panel.append(inner);
    inner = panel;
  }
  const sheet = h('div', { class: 'zs-fold-sheet' }, inner);
  const caption = h('figcaption', { class: 'zs-print-caption zt-small', 'aria-live': 'polite' }, s('mapPrintPlain'));
  const figure = h('figure', { class: 'zs-fold' }, h('div', { class: 'zs-fold-stage', 'aria-hidden': 'true' }, source, sheet), caption);

  const describe = h('p', { class: 'zs-describe zt-small', 'aria-live': 'polite' });
  const grounds = GROUNDS.map((ground) => h('li', { class: 'zs-swatch zt-data', 'data-ground': ground }, h('span', { class: 'zs-swatch-dot', 'aria-hidden': 'true' }), s(`ground${camel(ground)}` as SectionKey)));
  const posts = POSTS.map((post) => h('li', { class: 'zs-post zt-data', 'data-post': post }, s(`post${camel(post)}` as SectionKey)));

  const refresh = () => {
    const theme = MAP_THEMES.find((entry) => entry.id === map.theme) ?? (MAP_THEMES[0] as (typeof MAP_THEMES)[number]);
    grounds.forEach((element, index) => {
      const order = theme.ground.indexOf(GROUNDS[index] as GroundId);
      element.classList.toggle('is-in', order >= 0);
      element.style.order = order >= 0 ? String(order) : '20';
    });
    posts.forEach((element, index) => element.classList.toggle('is-in', POSTS[index] === theme.post));
    describe.replaceChildren(
      h('strong', {}, `${s(`shape${camel(map.shape)}` as SectionKey)}. `),
      s(`shape${camel(map.shape)}Body` as SectionKey),
      ' ',
      h('strong', {}, `${s(`trail${camel(map.trail)}` as SectionKey)}. `),
      s(`trail${camel(map.trail)}Body` as SectionKey),
    );
  };

  const chips = <T extends string>(ids: readonly T[], prefix: string, current: () => T, pick: (id: T) => void, labelKey: SectionKey) => {
    const labelId = `${ctx.idPrefix}zs-${prefix}-label`;
    const buttons = ids.map((id) => {
      const button = h('button', { type: 'button', class: 'zs-chip zt-data', 'aria-pressed': String(current() === id) }, s(`${prefix}${camel(id)}` as SectionKey));
      button.addEventListener('click', () => {
        pick(id);
        buttons.forEach((other, index) => other.setAttribute('aria-pressed', String(ids[index] === id)));
        refresh();
        ctx.onMap?.();
      });
      return button;
    });
    return h('div', { class: 'zs-group' }, h('h3', { class: 'zs-group-title zt-label', id: labelId }, s(labelKey)), h('div', { class: 'zs-chips', role: 'group', 'aria-labelledby': labelId }, ...buttons));
  };

  // A new seed draws a new landscape for the same choices.
  const roll = h('button', { type: 'button', class: 'zs-chip zs-roll zt-data' }, s('mapRoll'));
  roll.addEventListener('click', () => {
    map.roll += 1;
    ctx.onMap?.();
  });

  const options = h(
    'div',
    { class: 'zs-options' },
    h(
      'div',
      { class: 'zs-options-col' },
      chips(SHAPES, 'shape', () => map.shape, (id) => (map.shape = id), 'mapShape'),
      chips(TRAILS, 'trail', () => map.trail, (id) => (map.trail = id), 'mapTrail'),
      chips(MAP_THEMES.map((theme) => theme.id), 'theme', () => map.theme, (id) => (map.theme = id), 'mapTheme'),
      roll,
    ),
    h(
      'div',
      { class: 'zs-options-col' },
      h('div', { class: 'zs-group' }, h('h3', { class: 'zs-group-title zt-label' }, s('mapGround')), h('ul', { class: 'zs-swatches' }, ...grounds)),
      h('div', { class: 'zs-group' }, h('h3', { class: 'zs-group-title zt-label' }, s('mapSignposts')), h('ul', { class: 'zs-posts' }, ...posts)),
    ),
  );
  refresh();

  const view = shell(
    ctx,
    'map',
    s,
    'mapTag',
    'mapTitle',
    [lede(s('mapLede'))],
    [figure, options, describe],
    [body(s('mapHeight'), 'zs-text zt-small'), body(`${s('mapThemeBody')} ${s('mapGroundBody')} ${s('mapSignpostsBody')}`, 'zs-text zt-small')],
  );
  view.ups.push(options);
  view.onState = (state) => sheet.classList.toggle('is-open', state.form > 0.42);
  return { ...view, print: { group, caption } };
}

// ---------------------------------------------------------------------------------------------------------
// 06 Install.

function copyButton(command: string, s: Say, onCopy?: (command: string) => void): HTMLButtonElement {
  const label = h('span', {}, s('copy'));
  const button = h('button', { type: 'button', class: 'zs-copy-btn zt-label', 'aria-label': s('copyOf', { command }) }, label);
  let timer = 0;
  button.addEventListener('click', () => {
    void copyText(command).then((done) => {
      if (!done) return;
      label.textContent = s('copied');
      button.classList.add('is-done');
      onCopy?.(command);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        label.textContent = s('copy');
        button.classList.remove('is-done');
      }, 1600);
    });
  });
  return button;
}

const commandLine = (command: string, s: Say, onCopy?: (command: string) => void): HTMLElement =>
  h('div', { class: 'zs-cmd' }, h('code', { class: 'zt-data' }, command), copyButton(command, s, onCopy));

function buildInstall(ctx: StopContext, s: Say): StopView {
  const agents = INSTALL_PATHS.map((path) => {
    const key = `install${camel(path.id)}` as SectionKey;
    const day = ctx.tested[path.id];
    return h(
      'li',
      { class: 'zs-agent zs-card zt-on-paper' },
      h('div', { class: 'zs-agent-head' }, h('h3', { class: 'zs-card-title' }, s(key)), h('span', { class: `zs-state zt-label${day ? ' is-run' : ''}` }, day ? s('installTested', { date: day }) : s('installUntested'))),
      h('p', { class: 'zt-small' }, rich(s(`${key}Body` as SectionKey))),
      ...path.commands.map((command) => commandLine(command, s, ctx.onCopy)),
      path.alternative ? h('p', { class: 'zs-or zt-label' }, s('installOr')) : null,
      ...(path.alternative ?? []).map((command) => commandLine(command, s, ctx.onCopy)),
    );
  });
  const examples = (['exampleTopic', 'exampleStart', 'exampleClass'] as const).map((key) => h('li', {}, commandLine(s(key), s, ctx.onCopy)));
  const then = h('div', { class: 'zs-then' }, h('h3', { class: 'zs-sub' }, s('installThen')), body(s('installThenBody'), 'zs-text zt-small'), h('ul', { class: 'zs-examples' }, ...examples));
  const view = shell(ctx, 'install', s, 'installTag', 'installTitle', [lede(s('installLede')), body(s('installHonest'), 'zs-text zt-small zs-rule')], [h('ul', { class: 'zs-agents' }, ...agents)], [then]);
  view.ups.push(...agents);
  return view;
}

// ---------------------------------------------------------------------------------------------------------
// 07 Questions.

export const QUESTIONS = 8;

function buildQuestions(ctx: StopContext, s: Say): StopView {
  const items = Array.from({ length: QUESTIONS }, (_unused, index) => {
    const details = h(
      'details',
      { class: 'zs-q', name: `${ctx.idPrefix}zs-faq` },
      h('summary', {}, h('h3', { class: 'zs-item-title' }, s(`q${index + 1}` as SectionKey)), h('span', { class: 'zs-q-mark', 'aria-hidden': 'true' })),
      h('p', { class: 'zt-small' }, rich(s(`a${index + 1}` as SectionKey))),
    );
    details.open = ctx.state.faq === index;
    details.addEventListener('toggle', () => {
      if (details.open) ctx.state.faq = index;
      else if (ctx.state.faq === index) ctx.state.faq = -1;
    });
    return details;
  });
  const post = h('span', { class: 'zs-cut zs-post-art', 'aria-hidden': 'true' }, art(SIGNPOST));
  const view = shell(ctx, 'questions', s, 'questionsTag', 'questionsTitle', [lede(s('questionsLede')), post], [h('div', { class: 'zs-faq zs-sheet zt-on-paper' }, ...items)]);
  view.ups.push(post, view.station.firstElementChild as HTMLElement);
  return view;
}

// ---------------------------------------------------------------------------------------------------------
// 08 Start: the ticket.

function buildStart(ctx: StopContext, s: Say): StopView {
  const ticket = createTicket({ lang: ctx.lang, state: ctx.state.ticket, idPrefix: ctx.idPrefix, ...(ctx.onCopy ? { onCopy: ctx.onCopy } : {}) });
  const view = shell(ctx, 'start', s, 'startTag', 'startTitle', [lede(s('startLede'))], [ticket.element, body(s('stubLang'), 'zs-text zt-small zs-ticket-foot')]);
  view.ups.push(ticket.element);
  return { ...view, ticket };
}

const BUILDERS: Readonly<Record<StopId, (ctx: StopContext, s: Say) => StopView>> = {
  what: buildWhat,
  how: buildHow,
  trail: buildTrail,
  class: buildClass,
  map: buildMap,
  install: buildInstall,
  questions: buildQuestions,
  start: buildStart,
};

export function buildStops(ctx: StopContext): StopView[] {
  const s: Say = (key, vars) => say(key, vars, ctx.lang);
  return STOPS.map((stop) => BUILDERS[stop.id](ctx, s));
}

/** The label of a stop in the index tabs. */
export function navKey(id: StopId): SectionKey {
  return `nav${camel(id)}` as SectionKey;
}
