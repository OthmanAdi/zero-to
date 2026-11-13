import type { StringVars, UiLang } from '../i18n';
import { safeUrl } from '../learn/notebook';
import { languageName, statusSentence } from '../learn/resources';
import { say as sayLearn } from '../learn/strings';
import { formatDay, formatHours, formatNumber } from '../look/format';
import { addDays } from '../roadmap/dates';
import { deriveTrek, type Trek } from '../roadmap/derive';
import type { Resource, Roadmap } from '../roadmap/types';
import { TIER_NAMES } from '../scene/palette';
import { SIGNPOST } from './art';
import './brief.css';
import {
  HOURS_RANGE,
  classBrief,
  clampHours,
  countsOf,
  gapLines,
  mapBrief,
  planPace,
  summitOf,
  tallySources,
  tiersOf,
  weekTicks,
  withPlan,
  type ClassBrief,
  type OwnPlan,
  type SourceReceipt,
} from './brief-model';
import { createPermit, type StartChoice } from './brief-permit';
import { isBriefKey, loadBriefWords, sayBrief, type BriefKey } from './brief-words';
import { HIDDEN, h, rich, type Child } from './dom';
import { GROUNDS, PLAIN_PRINT, POSTS, RING_KEYS, art, body, camel, carryItem, commandLine, foldSheet, lede, peakTheatre, ringStop, shell, small, type StopContext, type StopView } from './stops';
import { loadSectionWords, say, type SectionKey } from './strings';

/**
 * The eight stops in roadmap mode: the trip brief of the roadmap that lies on the table. Each stop keeps the
 * station and the motion it has in the gallery and says something else: the stages by altitude, the sources
 * with their statuses, the counts, the pace against the calendar, the mountain the file draws, how to keep the
 * file current, the gaps, and a permit that sets the start.
 *
 * Everything a roadmap wrote is set as text, never as markup, and carries the roadmap's language. This file is
 * fetched only when a page has a roadmap of its own, so a gallery visitor never carries it.
 */

/** What a roadmap can be taken away as. The page offers an action only when it is given a handler for it. */
export const BRIEF_ACTIONS = ['print', 'share', 'download', 'markdown', 'progress'] as const;
export type BriefAction = (typeof BRIEF_ACTIONS)[number];

export interface BriefOptions {
  /** The link-check counts of the run that wrote the roadmap. */
  readonly receipt?: SourceReceipt | null;
  /**
   * The learner's own plan from their browser: a start day, hours a week, a deadline. The pace stop and the
   * permit start from it. Default: the plan of the file.
   */
  readonly plan?: OwnPlan | null;
  /** Today. Default: now. */
  readonly today?: Date;
  /** Called when the start permit is torn off. */
  onStart?(choice: StartChoice): void;
  readonly actions?: Readonly<Partial<Record<BriefAction, () => void>>>;
  /** Scrolls the page to `top` in `seconds`. Default: the window's own smooth scroll. */
  scrollTo?(top: number, seconds: number): void;
}

type Key = BriefKey | SectionKey;

interface Brief {
  readonly ctx: StopContext;
  readonly roadmap: Roadmap;
  /** The roadmap with the learner's own plan laid over the file's. Pace is worked out from this one. */
  readonly paced: Roadmap;
  /** Called when the permit sets a start the page keeps, so the pace stop shows the same plan. */
  readonly started: ((choice: StartChoice) => void)[];
  readonly options: BriefOptions;
  readonly trek: Trek;
  readonly lang: UiLang;
  /** Today, `YYYY-MM-DD`. */
  readonly today: string;
  readonly now: Date;
  s(key: Key, vars?: StringVars): string;
  /** An element whose text the roadmap wrote: it carries the roadmap's language and finds its own direction. */
  road<K extends keyof HTMLElementTagNameMap>(tag: K, text: string, className?: string): HTMLElementTagNameMap[K];
  /** "about 6 h", and "6 h" where a line already says it is an estimate. */
  hours(minutes: number, bare?: boolean): string;
  day(value: string): string;
}

const ACTION_KEY: Readonly<Record<BriefAction, BriefKey>> = { print: 'actPrint', share: 'actShare', download: 'actDownload', markdown: 'actMarkdown', progress: 'actProgress' };

const tabKey = (id: string): BriefKey => `tab${camel(id)}` as BriefKey;

/** Marks a stop as part of a brief and gives it the tab label it has in roadmap mode. */
function finish(view: StopView, b: Brief): StopView {
  view.section.classList.add('zs-brief');
  return { ...view, nav: b.s(tabKey(view.spec.id)) };
}

// ---------------------------------------------------------------------------------------------------------
// 01 The route: the roadmap's own title, and its stages by altitude.

function buildRoute(b: Brief): StopView {
  const { roadmap, trek, s } = b;
  const { theatre, peaks } = peakTheatre();
  const summit = summitOf(roadmap);
  const cards = tiersOf(roadmap, trek).map((tier, index) => {
    const on = tier.stages.length > 0;
    if (!on) peaks[index]?.classList.add('is-off');
    return h(
      'li',
      { class: `zs-tier zs-card zt-on-paper zs-b-tier${on ? '' : ' is-off'}`, 'data-tier': tier.tier },
      h('span', { class: 'zs-blaze', ...HIDDEN }),
      h('h4', { class: 'zs-card-title' }, s(`tier${camel(tier.tier)}` as SectionKey)),
      h('p', { class: 'zs-b-tier-sum zt-data' }, on ? b.hours(tier.minutes) : s('routeOff')),
      on
        ? h(
            'ol',
            { class: 'zs-b-stages' },
            ...tier.stages.map((stage) =>
              h(
                'li',
                {},
                h('span', { class: 'zs-sr' }, `${s('routeStage', { n: stage.n })}: `),
                h('span', { class: 'zs-b-stage-n zt-data', ...HIDDEN }, String(stage.n)),
                h('span', { class: 'zs-b-stage-title' }, b.road('span', stage.title), ' ', h('span', { class: 'zs-b-stage-h zt-data' }, b.hours(stage.minutes, true))),
              ),
            ),
          )
        : null,
    );
  });

  const counts = countsOf(roadmap, trek);
  // The lede is the summary, or the goal when the file has no summary. A goal that is not the lede gets its own line.
  const goal = roadmap.summary ? roadmap.brief.goal?.trim() : undefined;
  const figures = s('routeFigures', { stages: s('nStages', { count: counts.stages }), hours: b.hours(counts.minutes), practice: Math.round(counts.practice * 100) });
  const view = shell<Key>(
    b.ctx,
    'what',
    s,
    'routeTag',
    document.createTextNode(roadmap.title),
    [
      b.road('p', roadmap.summary ?? roadmap.brief.goal ?? roadmap.topic, 'zs-lede zt-body'),
      body(`${figures} ${s('routeChecked', { day: b.day(roadmap.checkedOn) })}`),
      goal ? h('p', { class: 'zs-text zt-small zs-b-goal' }, h('span', { class: 'zt-label' }, s('routeGoal')), b.road('span', goal)) : null,
      h('h3', { class: 'zs-sub' }, s('routeTiers')),
      small(summit === 'diamond' ? s('routeTop') : s('routeEnds', { tier: s(`tier${camel(summit)}` as SectionKey) })),
    ],
    [theatre, h('ul', { class: 'zs-tiers zs-b-tiers' }, ...cards)],
  );
  // The headline is the roadmap's title: its language, its direction, and a smaller size when it is long.
  view.title.lang = roadmap.lang;
  view.title.dir = 'auto';
  view.title.classList.add('zs-b-title');
  if (roadmap.title.length > 34) view.title.classList.add('is-long');
  view.ups.push(...peaks, ...cards);
  // The card leads its step, so pointing at a card or tabbing to it brings its peak forward too.
  view.steps.push(...cards.map((card, index) => [card, peaks[index] as HTMLElement]));
  return view;
}

// ---------------------------------------------------------------------------------------------------------
// 02 Sources: opened and kept, and every status that is not verified.

/** How many sources that are not verified are listed before the rest folds away. */
const FLAGGED_SHOWN = 2;

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

function buildSources(b: Brief): StopView {
  const { roadmap, s, lang } = b;
  const tally = tallySources(roadmap, b.options.receipt, b.now);
  const learn = (key: string): string => sayLearn(key as Parameters<typeof sayLearn>[0], undefined, lang);

  const stat = (titleKey: BriefKey, big: number, bigLabel: string, rows: readonly (readonly [string, number])[], notes: Child[]): HTMLElement =>
    h(
      'li',
      { class: 'zs-step zs-card zt-on-paper zs-b-stat' },
      h('h3', { class: 'zs-card-title' }, s(titleKey)),
      h('p', { class: 'zs-b-big' }, h('span', { class: 'zs-step-n zt-number' }, formatNumber(big, { lang, fraction: 0 })), ' ', h('span', { class: 'zt-label' }, bigLabel)),
      rows.length > 0 ? h('dl', { class: 'zs-b-rows zt-data' }, ...rows.map(([name, count]) => h('div', {}, h('dt', {}, name), h('dd', {}, String(count))))) : null,
      ...notes,
    );
  const note = (text: string): HTMLElement => h('p', { class: 'zt-small' }, rich(text));

  const budget = tally.budget;
  let budgetLine = '';
  if (budget) {
    if (budget.max === null) budgetLine = s('srcBudgetOpen');
    else if (budget.max === 0) budgetLine = s('srcBudgetFree');
    else budgetLine = s('srcBudget', { amount: money(budget.max, budget.currency, lang) });
  }
  const kinds = tally.kinds.slice(0, 3).map(([kind, count]) => [learn(`type.${kind}`), count] as const);
  const moreKinds = tally.kinds.length - kinds.length;
  const age = tally.age;
  const cards = [
    stat(
      'srcStatus',
      tally.status.verified,
      s('bigVerified'),
      [
        [s('stGated'), tally.status.gated],
        [s('stUnverified'), tally.status.unverified],
      ],
      [note(s('srcStatusBody'))],
    ),
    stat(
      'srcCost',
      tally.cost.free,
      s('bigFree'),
      [
        [learn('cost.freemium'), tally.cost.freemium],
        [learn('cost.paid'), tally.cost.paid],
      ],
      budgetLine ? [note(budgetLine)] : [],
    ),
    stat('srcKind', tally.kinds.length, s('bigKinds', { count: tally.kinds.length }), kinds, [
      moreKinds > 0 ? note(s('srcKindMore', { count: moreKinds })) : null,
      tally.langs.length > 0 ? note(s('srcLangs', { list: list(tally.langs.map((code) => languageName(code, lang)), lang) })) : null,
    ]),
    stat('srcAge', age?.days ?? 0, s('bigDays', { count: age?.days ?? 0 }), [], [
      note(s('srcAgeDay', { day: b.day(tally.checkedOn) })),
      age ? note(age.inDate ? s('srcRecheckFrom', { days: tally.recheckAfter, day: b.day(addDays(tally.checkedOn, tally.recheckAfter)) }) : s('srcRecheckDue')) : null,
    ]),
  ];

  const slip = (name: 'Verified' | 'Gated' | 'Unverified' | 'Dead', count: number): HTMLElement | null =>
    count > 0 ? h('li', { class: `zs-slip zs-slip${name}` }, s(`srcSlip${name}`, { count })) : null;
  const slips = h(
    'ul',
    { class: 'zs-slips zt-data' },
    slip('Verified', tally.status.verified),
    slip('Gated', tally.status.gated),
    slip('Unverified', tally.status.unverified),
    slip('Dead', tally.dead),
  );

  const flag = (resource: Resource): HTMLElement => {
    const href = safeUrl(resource.url);
    const name = resource.check.status === 'gated' ? 'Gated' : 'Unverified';
    const title = b.road(href ? 'a' : 'span', resource.title, 'zs-b-flag-title');
    title.lang = resource.lang;
    if (href) {
      title.setAttribute('href', href);
      title.setAttribute('target', '_blank');
      title.setAttribute('rel', 'noopener noreferrer');
      title.append(h('span', { class: 'zs-sr' }, ` ${learn('opensNewTab')}`));
    }
    const why = resource.check.note?.trim();
    return h(
      'li',
      { class: 'zs-b-flag', 'data-status': resource.check.status },
      h('span', { class: `zs-slip zs-slip${name} zt-data` }, s(`slip${name}`)),
      h('span', { class: 'zs-b-flag-head' }, title, h('span', { class: 'zs-b-flag-host zt-data' }, hostOf(resource.url))),
      why ? b.road('p', why, 'zt-small') : h('p', { class: 'zt-small' }, statusSentence(resource, lang) ?? ''),
    );
  };
  const flagged = tally.flagged;
  const rest = flagged.slice(FLAGGED_SHOWN);
  const after: Child[] =
    flagged.length === 0
      ? [small(s('srcAllVerified'), ' zs-rule')]
      : [
          h('h3', { class: 'zs-sub' }, s('srcFlagged')),
          small(s('srcFlaggedBody', { count: flagged.length })),
          h('ul', { class: 'zs-b-flagged' }, ...flagged.slice(0, FLAGGED_SHOWN).map(flag)),
          rest.length > 0 ? h('details', { class: 'zs-b-more' }, h('summary', { class: 'zt-label' }, s('srcMore', { count: rest.length })), h('ul', { class: 'zs-b-flagged' }, ...rest.map(flag))) : null,
        ];

  const receipt = tally.opened !== null && tally.kept !== null;
  const view = shell<Key>(
    b.ctx,
    'how',
    s,
    'srcTag',
    rich(receipt ? s('srcTitleReceipt', { opened: tally.opened as number, kept: tally.kept as number }) : s('srcTitle', { count: tally.total })),
    [lede(receipt ? s('srcLedeReceipt', { opened: tally.opened as number, kept: tally.kept as number }) : s('srcLede')), slips],
    [h('ul', { class: 'zs-steps zs-b-stats' }, ...cards)],
    after,
  );
  view.ups.push(...cards);
  view.steps.push(...cards.map((card) => [card]));
  return view;
}

const capital = (text: string): string => text.charAt(0).toLocaleUpperCase() + text.slice(1);

function money(amount: number, currency: string, lang: UiLang): string {
  try {
    return new Intl.NumberFormat(lang, { style: 'currency', currency, maximumFractionDigits: Number.isInteger(amount) ? 0 : 2 }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

/** A list in words. English is set the British way, as the days are: "2, 7, 21 and 60". */
function list(items: readonly string[], lang: UiLang): string {
  try {
    return new Intl.ListFormat(lang === 'en' ? 'en-GB' : lang, { style: 'long', type: 'conjunction' }).format(items);
  } catch {
    return items.join(', ');
  }
}

// ---------------------------------------------------------------------------------------------------------
// 03 Counts: what this roadmap carries.

function buildCounts(b: Brief): StopView {
  const { roadmap, trek, s, lang } = b;
  const counts = countsOf(roadmap, trek);
  const tally = tallySources(roadmap, null, b.now);
  const perWeek = clampHours(b.paced.brief.hoursPerWeek);
  const weeks = Math.max(1, Math.ceil(counts.minutes / (perWeek * 60) - 1e-9));
  const langs = tally.langs.length > 0 ? ` ${s('srcLangs', { list: list(tally.langs.map((code) => languageName(code, lang)), lang) })}` : '';

  const row: Readonly<Record<(typeof RING_KEYS)[number], readonly [string, string]>> = {
    stages: [`${s('nStages', { count: counts.stages })}, ${s('nSteps', { count: counts.steps })}`, `${s('cntStagesBody')}${counts.sideTrails > 0 ? ` ${s('cntSideTrails', { count: counts.sideTrails })}` : ''}`],
    checkpoints: [`${s('nSignposts', { count: counts.signposts })}, ${s('nChecks', { count: counts.checks })}`, s('cntShows', { count: counts.shows })],
    projects: [s('nCamps', { count: counts.camps }), counts.camps > 0 ? s('cntCampsBody') : s('cntNoCamps')],
    sources: [s('nSources', { count: counts.sources }), `${s('cntFree', { count: tally.cost.free })}${langs}`],
    pace: [capital(b.hours(counts.minutes)), s('cntPaceBody', { practice: Math.round(counts.practice * 100), hours: b.hours(perWeek * 60, true), weeks: s('nWeeks', { count: weeks }) })],
    notebook: [s('keepNotebook'), s('cntTakeaways', { count: counts.takeaways })],
    cairns: [s('keepCairns'), s('cntReviews', { count: counts.reviewSteps, days: list(counts.reviewDays.map(String), lang) })],
  };
  const item = (key: (typeof RING_KEYS)[number], level: 'h3' | 'h4') => carryItem(key, row[key][0], row[key][1], level);
  const rows = RING_KEYS.map((key) => item(key, 'h3'));
  if (counts.capstone) rows[2]?.querySelector('p')?.append(` ${s('cntCapstone')} `, b.road('span', counts.capstone, 'zs-b-capstone'));
  const kept = [item('notebook', 'h4'), item('cairns', 'h4')];
  return ringStop<Key>(b.ctx, s, 'cntTag', 'cntTitle', [lede(s('cntLede'))], rows, kept, [
    h('h3', { class: 'zs-sub' }, s('keepTitle')),
    h('ul', { class: 'zs-keep' }, ...kept),
    small(s('trailRule'), ' zs-rule'),
  ]);
}

// ---------------------------------------------------------------------------------------------------------
// 04 Pace: hours a week against the deadline, and the sessions of a class.

function buildPace(b: Brief): StopView {
  const { roadmap, paced, trek, s, lang, today } = b;
  const own = b.options.plan ?? {};
  let planned = clampHours(paced.brief.hoursPerWeek);
  let startDate = paced.brief.startDate ?? today;
  // Whose start this is: the learner's own, the file's, or nobody's yet.
  let startFrom: 'own' | 'file' | 'none' = own.startDay && paced.brief.startDate === own.startDay ? 'own' : roadmap.brief.startDate ? 'file' : 'none';
  let klass = classBrief(roadmap, startDate, today);
  const id = `${b.ctx.idPrefix}zs-pace`;
  let hours = planned;
  let plan = planPace(paced, hours, startDate, today, trek);
  const bare = (value: number): string => b.hours(value * 60, true);

  // The control. It changes what this stop shows and nothing else.
  const range = h('input', { id, class: 'zs-b-range', type: 'range', min: HOURS_RANGE.min, max: HOURS_RANGE.max, step: HOURS_RANGE.step });
  range.value = String(hours);
  const value = h('output', { class: 'zs-b-pace-value zt-number', for: id });
  const reset = h('button', { type: 'button', class: 'zs-b-reset zt-label' });
  const control = h('div', { class: 'zs-b-control' }, h('label', { class: 'zt-label', for: id }, s('paceControl')), range, value, reset);

  // The ruler: the weeks, one row per altitude with a strip per stage, and for a class its sessions.
  const weeksRow = h('div', { class: 'zs-plan-row zs-plan-weeks zs-b-weeks' });
  const tiers = TIER_NAMES.filter((tier) => trek.stages.some((stage) => stage.tier === tier));
  const strips = new Map<number, HTMLElement>();
  const rows: HTMLElement[] = tiers.map((tier) => {
    const row = h('div', { class: 'zs-plan-row zs-b-row' });
    trek.stages.forEach((stage, index) => {
      if (stage.tier !== tier) return;
      const strip = h(
        'span',
        { class: 'zs-strip zs-b-strip zt-label', 'data-tier': tier, title: `${s('routeStage', { n: index + 1 })}: ${stage.title} · ${b.hours(stage.minutes)}` },
        h('b', {}, String(index + 1)),
        b.road('span', stage.title),
      );
      strips.set(index, strip);
      row.append(strip);
    });
    return row;
  });
  const marks = (klass?.sessions ?? []).map((session) =>
    h('span', { class: `zs-session zs-b-session zt-data${session.n === klass?.current ? ' is-here' : ''}`, title: s('clsSession', { n: session.n, title: session.title }) }, String(session.n)),
  );
  if (marks.length > 0) rows.push(h('div', { class: `zs-plan-row zs-b-row zs-b-sessions${marks.length > 12 ? ' is-dense' : ''}` }, ...marks));

  const todayLine = h('span', { class: 'zs-today' }, h('span', { class: 'zs-today-flag zt-label' }, klass?.current != null ? s('planToday') : s('paceToday')));
  const dateLine = h('span', { class: 'zs-today zs-b-deadline' }, h('span', { class: 'zs-today-flag zt-label' }, s('paceDate')));
  const caption = h('figcaption', { class: 'zt-small' });
  const grid = h('div', { class: 'zs-plan-grid zs-b-grid', ...HIDDEN }, weeksRow, ...rows, todayLine, dateLine);
  const figure = h('figure', { class: 'zs-plan zs-sheet zt-on-paper zs-b-plan' }, control, grid, caption);
  const sentence = h('p', { class: 'zs-lede zt-body', 'aria-live': 'polite' });

  const share = (weeks: number): string => `${(Math.min(1, Math.max(0, weeks / plan.weeks)) * 100).toFixed(2)}%`;
  const draw = (): void => {
    plan = planPace(paced, hours, startDate, today, trek);
    const span = plan.weeks;
    // A class stands where its latest dated session is. Without one, the line marks today.
    const here = klass?.current != null ? (klass.sessions.find((session) => session.n === klass?.current) ?? null) : null;
    reset.textContent = s('paceReset', { hours: bare(planned) });
    range.value = String(hours);
    range.setAttribute('aria-valuetext', s('paceValue', { hours: bare(hours) }));
    value.textContent = formatNumber(hours, { lang, fraction: 1 });
    reset.hidden = hours === planned;

    const ticks = weekTicks(span);
    weeksRow.replaceChildren(
      ...ticks.map((week, index) => {
        // A last cell that is shorter than the others has no room for its label.
        const length = (ticks[index + 1] ?? span + 1) - week;
        const cell = h('span', { class: 'zs-week zt-label' }, index > 0 && length < (ticks[1] as number) - (ticks[0] as number) ? null : s('planWeek', { n: week }));
        cell.style.flexGrow = String(length);
        return cell;
      }),
    );
    plan.strips.forEach((strip, index) => {
      const element = strips.get(index);
      if (!element) return;
      element.style.setProperty('--from', share(strip.from));
      element.style.setProperty('--to', share(Math.max(strip.from, strip.to)));
      element.classList.toggle('is-out', strip.from >= span);
    });
    marks.forEach((mark, index) => {
      const at = klass?.sessions[index]?.at ?? 0;
      mark.style.setProperty('--at', share(at));
      mark.hidden = at < 0 || at > span;
    });
    const at = here ? here.at : plan.todayAt;
    const place = (line: HTMLElement, weeks: number | null): void => {
      line.hidden = weeks === null || weeks > span;
      if (weeks === null) return;
      line.style.setProperty('--at', share(weeks));
      // A flag near an end of the ruler hangs inwards, so it stays on the sheet.
      line.classList.toggle('is-end', weeks / span > 0.86);
      line.classList.toggle('is-start', weeks / span < 0.1);
    };
    place(todayLine, at);
    place(dateLine, plan.deadlineAt);
    // Two flags that would overlap: the date steps down a line.
    dateLine.classList.toggle('is-low', at !== null && plan.deadlineAt !== null && Math.abs(at - plan.deadlineAt) / span < 0.2);

    const weeks = s('nWeeks', { count: Math.max(1, Math.ceil(plan.neededWeeks - 1e-9)) });
    let text = s('paceArrive', { hours: bare(hours), weeks, start: b.day(startDate), day: b.day(plan.arrival) });
    if (plan.deadline !== null && plan.daysPastDeadline !== null) {
      const deadline = b.day(plan.deadline);
      const late = plan.daysPastDeadline;
      text += ` ${late === 0 ? s('paceOnDay', { deadline }) : s(late > 0 ? 'paceLate' : 'paceEarly', { count: Math.abs(late), deadline })}`;
    }
    sentence.textContent = text;
    caption.textContent = `${s('paceCaption', { start: b.day(startDate) })}${plan.cut ? ` ${s('paceCut', { weeks: s('nWeeks', { count: span }) })}` : ''}`;
  };
  range.addEventListener('input', () => {
    hours = clampHours(Number(range.value));
    draw();
  });
  reset.addEventListener('click', () => {
    hours = planned;
    draw();
    range.focus();
  });
  draw();

  const fact = (title: string, ...lines: Child[]): HTMLElement => h('li', { class: 'zs-fact' }, h('h3', { class: 'zs-item-title' }, title), h('p', { class: 'zt-small' }, ...lines));
  const startText = (): string => (startFrom === 'none' ? s('paceStartOpen') : s(startFrom === 'own' ? 'paceStartYours' : 'paceStartBody', { day: b.day(startDate) }));
  const startFact = fact(s('paceStart'), startText());
  const ownDate = Boolean(own.deadline) && plan.deadline === own.deadline;
  const facts = klass ? classFacts(b, klass) : [
    startFact,
    fact(s('paceDate'), plan.deadline ? s(ownDate ? 'paceDateYours' : 'paceDeadlineBody', { day: b.day(plan.deadline) }) : s('paceNoDeadline')),
    fact(s('paceSlip'), s('paceSlipBody')),
    fact(s('paceReal'), s('paceRealBody')),
  ];

  const view = shell<Key>(b.ctx, 'class', s, klass ? 'paceTagClass' : 'paceTag', klass ? 'paceTitleClass' : 'paceTitle', [sentence], [figure, h('ul', { class: 'zs-facts' }, ...facts)], [
    small(s('paceViewOnly'), ' zs-rule'),
  ]);
  view.ups.push(figure, ...facts);
  // A permit torn further down sets the learner's own start: this stop then shows that plan.
  b.started.push((choice) => {
    startDate = choice.on;
    startFrom = 'own';
    planned = clampHours(choice.hoursPerWeek);
    hours = planned;
    klass = classBrief(roadmap, startDate, today);
    (startFact.lastElementChild as HTMLElement).textContent = startText();
    draw();
  });
  rows.forEach((row, index) => row.style.setProperty('--i', String(index)));
  view.onState = (state, still) => {
    // One row goes down after another while the stop is held, then the lines mark today and the date. A stop
    // that is not pinned (a phone) has no hold to follow: there the rows fall, one after another, once the
    // sheet is well inside the window, so the lines are seen while the sheet is.
    const pinned = view.section.hasAttribute('data-pin');
    const inView = (): boolean => figure.getBoundingClientRect().top < (window.innerHeight || 800) * 0.72;
    const through = still || state.phase === 'done' ? 1 : pinned ? (state.phase === 'active' ? state.hold : 0) : inView() ? 1 : 0;
    grid.classList.toggle('is-flow', !pinned);
    rows.forEach((row, index) => row.classList.toggle('is-down', through > 0.04 + 0.14 * index));
    todayLine.classList.toggle('is-down', through > 0.82);
    dateLine.classList.toggle('is-down', through > 0.82);
  };
  return view;
}

function classFacts(b: Brief, klass: ClassBrief): HTMLElement[] {
  const { s } = b;
  const fact = (title: string, ...lines: Child[]): HTMLElement => h('li', { class: 'zs-fact' }, h('h3', { class: 'zs-item-title' }, title), h('p', { class: 'zt-small' }, ...lines));
  const join = (...parts: (string | null | false | undefined)[]): string => parts.filter(Boolean).join(' ');
  const devices = klass.devices ? s(`clsDevices${camel(klass.devices)}` as BriefKey) : null;
  const assessment = klass.assessment ? s(`clsAssess${camel(klass.assessment.mode)}` as BriefKey) : null;
  const note = klass.assessment?.note?.trim();
  return [
    fact(
      s('clsSessions'),
      join(
        s('clsSessionsBody', { count: klass.sessionsPerWeek, minutes: klass.sessionMinutes }),
        klass.weeks !== null && s('clsWeeks', { count: klass.weeks }),
        klass.sessions.length > 0 && s('clsPlanned', { count: klass.sessions.length }),
      ),
    ),
    fact(s('clsGroup'), join(s('clsSize', { count: klass.size }), klass.ages && s('clsAges', { ages: klass.ages }), devices)),
    ...(assessment ? [fact(s('clsAssess'), assessment, note ? ' ' : null, note ? b.road('span', note) : null)] : []),
    fact(
      s('clsTeacher'),
      join(
        s('clsNotes', { count: klass.teacherNotes }),
        klass.handout === 'session' && s('clsHandoutSession'),
        klass.handout === 'stage' && s('clsHandoutStage'),
        klass.homework === true && s('clsHomework'),
        klass.homework === false && s('clsNoHomework'),
      ),
    ),
  ];
}

// ---------------------------------------------------------------------------------------------------------
// 05 The map: the mountain this file draws.

function buildOwnMap(b: Brief): StopView {
  const { roadmap, s } = b;
  const map = mapBrief(roadmap);
  const { spec } = map;
  const shape = s(`shape${camel(spec.terrain)}` as SectionKey);
  const trail = s(`trail${camel(spec.trail)}` as SectionKey);
  const { figure, sheet, group, caption } = foldSheet(b.ctx, s('mapPrintPlain'));
  group.innerHTML = PLAIN_PRINT;

  const group_ = (titleKey: SectionKey, ...children: Child[]): HTMLElement => h('div', { class: 'zs-group' }, h('h3', { class: 'zs-group-title zt-label' }, s(titleKey)), ...children);
  const named = (name: string, text: string): HTMLElement => h('p', { class: 'zs-b-named zt-small' }, h('strong', {}, `${name}. `), text);
  const known = <T extends string>(all: readonly T[], id: string): id is T => (all as readonly string[]).includes(id);
  const grounds = map.surfaces.map((ground) =>
    h('li', { class: 'zs-swatch zt-data is-in', 'data-ground': ground }, h('span', { class: 'zs-swatch-dot', ...HIDDEN }), known(GROUNDS, ground) ? s(`ground${camel(ground)}` as SectionKey) : ground),
  );
  const post = known(POSTS, map.signpost) ? s(`post${camel(map.signpost)}` as SectionKey) : map.signpost;
  const options = h(
    'div',
    { class: 'zs-options zs-b-map' },
    h(
      'div',
      { class: 'zs-options-col' },
      group_('mapShape', named(shape, s(`shape${camel(spec.terrain)}Body` as SectionKey))),
      group_('mapTrail', named(trail, s(`trail${camel(spec.trail)}Body` as SectionKey))),
    ),
    h(
      'div',
      { class: 'zs-options-col' },
      group_('mapGround', h('ol', { class: 'zs-swatches' }, ...grounds)),
      group_('mapSignposts', h('ul', { class: 'zs-posts' }, h('li', { class: 'zs-post zt-data is-in' }, post))),
      group_('mapTheme', h('ul', { class: 'zs-posts' }, h('li', { class: 'zs-post zt-data is-in' }, s(`theme${camel(map.theme)}` as SectionKey), map.themeSet ? null : ` (${s('mapDefault')})`))),
    ),
  );

  const chosen = spec.terrainWasRandom ? (spec.trailWasRandom ? 'mapSeedBoth' : 'mapSeedShape') : spec.trailWasRandom ? 'mapSeedTrail' : 'mapSet';
  const used = TIER_NAMES.indexOf(summitOf(roadmap)) + 1;
  const view = shell<Key>(b.ctx, 'map', s, 'mapOwnTag', 'mapOwnTitle', [lede(s('mapOwnLede', { shape, trail, seed: spec.seed }))], [figure, options], [
    small(s(chosen)),
    small(s('mapUses', { count: used })),
  ]);
  view.ups.push(options);

  // The print is the roadmap's own mountain, drawn by the generator the map uses. It is fetched when the stop comes near.
  let asked = false;
  let gone = false;
  view.onState = (state) => {
    sheet.classList.toggle('is-open', state.form > 0.42);
    if (asked || state.phase === 'ahead') return;
    asked = true;
    void import('./mapprint')
      .then(({ mapPrint }) => {
        if (gone) return;
        group.innerHTML = mapPrint({ shape: spec.terrain, trail: spec.trail, theme: map.theme, seed: spec.seed, ...(spec.surfaces === 'auto' ? {} : { surfaces: spec.surfaces }) });
        caption.textContent = s('mapOwnPrint');
      })
      .catch(() => {
        // Without the generator the sheet keeps its plain print.
      });
  };
  view.dispose = () => {
    gone = true;
  };
  return view;
}

// ---------------------------------------------------------------------------------------------------------
// 06 Upkeep: recheck, replan and what to take along.

function buildUpkeep(b: Brief): StopView {
  const { roadmap, s } = b;
  const tally = tallySources(roadmap, null, b.now);
  const file = `${roadmap.id}.roadmap.json`;
  const card = (titleKey: BriefKey, state: HTMLElement | null, ...children: Child[]): HTMLElement =>
    h('li', { class: 'zs-agent zs-card zt-on-paper' }, h('div', { class: 'zs-agent-head' }, h('h3', { class: 'zs-card-title' }, s(titleKey)), state), ...children);
  const state = tally.age ? h('span', { class: `zs-state zt-label${tally.age.inDate ? ' is-run' : ''}` }, s(tally.age.inDate ? 'ageInDate' : 'ageDue')) : null;
  const actions = BRIEF_ACTIONS.flatMap((name) => {
    const run = b.options.actions?.[name];
    if (!run) return [];
    const button = h('button', { type: 'button', class: 'zs-b-action zt-label', 'data-action': name }, s(ACTION_KEY[name]));
    button.addEventListener('click', () => run());
    return [button];
  });
  const cards = [
    card('upRecheck', state, h('p', { class: 'zt-small' }, s('upRecheckBody', { day: b.day(roadmap.checkedOn) })), commandLine(`/zero-to recheck ${file}`, s, b.ctx.onCopy)),
    card('upReplan', null, h('p', { class: 'zt-small' }, s('upReplanBody')), commandLine(`/zero-to replan ${file} ${roadmap.id}-progress.json`, s, b.ctx.onCopy)),
    card('upTake', null, h('p', { class: 'zt-small' }, s('upTakeBody')), actions.length > 0 ? h('div', { class: 'zs-b-actions' }, ...actions) : null),
  ];
  const view = shell<Key>(b.ctx, 'install', s, 'upTag', 'upTitle', [lede(s('upLede')), small(s('upFile'), ' zs-rule')], [h('ul', { class: 'zs-agents' }, ...cards)]);
  view.ups.push(...cards);
  return view;
}

// ---------------------------------------------------------------------------------------------------------
// 07 Gaps, and how to use the map.

/** How many questions about the map follow the gap lines. */
export const USE_QUESTIONS = 5;

function buildGaps(b: Brief): StopView {
  const { roadmap, s } = b;
  const gaps = gapLines(roadmap);
  const name = `${b.ctx.idPrefix}zs-faq`;
  const mark = () => h('span', { class: 'zs-q-mark', ...HIDDEN });
  const items: HTMLElement[] = gaps.map((gap) =>
    h(
      'details',
      { class: 'zs-q zs-b-gap', name },
      h('summary', {}, h('h3', { class: 'zs-item-title' }, h('span', { class: 'zs-b-gap-label zt-label' }, s('gapLabel')), b.road('span', gap.title)), mark()),
      b.road('p', gap.gap, 'zt-small'),
      h('p', { class: 'zs-b-gap-where zt-data' }, `${s('routeStage', { n: gap.stage })}: `, b.road('span', gap.stageTitle)),
    ),
  );
  for (let index = 1; index <= USE_QUESTIONS; index += 1) {
    items.push(h('details', { class: 'zs-q', name }, h('summary', {}, h('h3', { class: 'zs-item-title' }, s(`use${index}` as BriefKey)), mark()), h('p', { class: 'zt-small' }, rich(s(`useA${index}` as BriefKey)))));
  }
  // The first line is open: a gap when there is one, the first question when there is none.
  (items[0] as HTMLDetailsElement).open = true;
  const post = h('span', { class: 'zs-cut zs-post-art', ...HIDDEN }, art(SIGNPOST));
  const view = shell<Key>(b.ctx, 'questions', s, 'gapTag', 'gapTitle', [lede(s('gapLede', { count: gaps.length })), post], [h('div', { class: 'zs-faq zs-sheet zt-on-paper' }, ...items)]);
  view.ups.push(post, view.station.firstElementChild as HTMLElement);
  return view;
}

// ---------------------------------------------------------------------------------------------------------
// 08 Start: the permit.

function buildGo(b: Brief): StopView {
  const { s } = b;
  const onStart = b.options.onStart;
  const permit = createPermit({
    lang: b.lang,
    idPrefix: b.ctx.idPrefix,
    roadmap: b.paced,
    trek: b.trek,
    today: b.today,
    ...(b.options.plan?.startDay && b.paced.brief.startDate === b.options.plan.startDay ? { start: b.options.plan.startDay } : {}),
    s,
    road: b.road,
    facts: `${s('nStages', { count: b.roadmap.stages.length })}, ${b.hours(b.trek.totalMinutes)}`,
    // A start is announced to the pace stop only when the page keeps it.
    ...(onStart
      ? {
          onStart: (choice: StartChoice) => {
            for (const listener of b.started) listener(choice);
            onStart(choice);
          },
        }
      : {}),
    toTable: () => {
      if (b.options.scrollTo) b.options.scrollTo(0, 1.2);
      else window.scrollTo({ top: 0, behavior: b.ctx.reduced() ? 'auto' : 'smooth' });
    },
  });
  const view = shell<Key>(b.ctx, 'start', s, 'goTag', 'goTitle', [lede(s('goLede'))], [permit.element, b.options.onStart ? small(s('goFoot'), ' zs-ticket-foot') : null]);
  view.ups.push(permit.element);
  return view;
}

// ---------------------------------------------------------------------------------------------------------

const BUILDERS = [buildRoute, buildSources, buildCounts, buildPace, buildOwnMap, buildUpkeep, buildGaps, buildGo] as const;

/** The eight stops as the trip brief of one roadmap, in the order of `STOPS`. */
export function buildBrief(ctx: StopContext, roadmap: Roadmap, options: BriefOptions = {}): StopView[] {
  const lang = ctx.lang;
  const now = options.today ?? new Date();
  const b: Brief = {
    ctx,
    roadmap,
    paced: withPlan(roadmap, options.plan),
    started: [],
    options,
    trek: deriveTrek(roadmap),
    lang,
    now,
    today: formatDay(now, { style: 'iso' }),
    s: (key, vars) => (isBriefKey(key) ? sayBrief(key, vars, lang) : say(key, vars, lang)),
    road: (tag, text, className) => h(tag, { class: className ?? null, lang: roadmap.lang, dir: 'auto' }, text),
    hours: (minutes, bare = false) => formatHours(minutes, { lang, ...(bare ? { approx: false, unit: 'hours' as const } : {}) }),
    day: (value) => formatDay(value, { lang }),
  };
  return BUILDERS.map((build) => finish(build(b), b));
}

export type BriefBuilder = typeof buildBrief;

/** Resolves with the builder once the words of a language are there. Never rejects: without German it builds in English. */
export async function loadBrief(lang: UiLang): Promise<BriefBuilder> {
  await Promise.all([loadBriefWords(lang), loadSectionWords(lang)]);
  return buildBrief;
}
