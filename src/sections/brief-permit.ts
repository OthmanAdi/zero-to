import { createRandom } from '../core/random';
import type { StringVars, UiLang } from '../i18n';
import { createWordmark } from '../look/brand';
import { formatDay, formatHours } from '../look/format';
import { isRealDay } from '../roadmap/dates';
import type { Trek } from '../roadmap/derive';
import type { Roadmap } from '../roadmap/types';
import { clampHours, planPace, profileOf, proposedStart } from './brief-model';
import type { BriefKey } from './brief-words';
import { HIDDEN, h, svg } from './dom';

/**
 * The start permit: the ticket of the last stop when a person's own roadmap lies on the table. It punches a
 * start day and hours a week, and its stub prints the day of arrival over the profile of the route. Tearing the
 * stub hands the two values to the page, which keeps them with the learner's progress and goes to the route.
 */

/** What a torn permit carries. The shape is the one a learning session starts with. */
export interface StartChoice {
  /** The start day, `YYYY-MM-DD`. */
  readonly on: string;
  readonly hoursPerWeek: number;
}

/** The hours a week the permit offers beside the roadmap's own: the four answers of the interview. */
export const PERMIT_HOURS = [2, 5, 10, 20] as const;

export interface PermitOptions {
  readonly lang: UiLang;
  readonly idPrefix: string;
  readonly roadmap: Roadmap;
  readonly trek: Trek;
  /** Today, `YYYY-MM-DD`. */
  readonly today: string;
  /** The start day the learner already has. Default: the roadmap's own while it is ahead, today otherwise. */
  readonly start?: string;
  s(key: BriefKey, vars?: StringVars): string;
  /** An element whose text the roadmap wrote. */
  road<K extends keyof HTMLElementTagNameMap>(tag: K, text: string, className?: string): HTMLElementTagNameMap[K];
  /** What the permit prints under the title of the route: its stages and hours. */
  readonly facts: string;
  /** Called with the choice when the stub is torn off. Without it the permit sends the visitor to the table. */
  onStart?(choice: StartChoice): void;
  /** Takes the page back to the table. */
  toTable(): void;
}

export interface PermitView {
  readonly element: HTMLElement;
  /** What the stub shows now. */
  readonly choice: () => StartChoice;
}

/** The stub's barcode: bars whose heights are the profile of this route. */
export function profileBars(trek: Trek, count = 46): string {
  let bars = '';
  profileOf(trek, count).forEach((height, index) => {
    const tall = 5 + 31 * height;
    bars += `<rect x="${(index * 4.2).toFixed(1)}" y="${(40 - tall).toFixed(1)}" width="${index % 3 === 0 ? 2.6 : 1.4}" height="${tall.toFixed(1)}"/>`;
  });
  return bars;
}

/** A four-digit number that is always the same for the same roadmap. */
export const permitNumber = (id: string): string => String(1000 + Math.floor(createRandom(`permit/${id}`)() * 9000));

export function createPermit(options: PermitOptions): PermitView {
  const { lang, roadmap, trek, today, s } = options;
  const id = (name: string) => `${options.idPrefix}permit-${name}`;
  const planned = clampHours(roadmap.brief.hoursPerWeek);
  const state = { on: options.start ?? proposedStart(roadmap, today), hours: planned };
  const hoursText = (hours: number): string => formatHours(hours * 60, { lang, approx: false, unit: 'hours' });

  const day = h('input', { id: id('day'), class: 'zs-input zs-b-day', type: 'date', name: 'start', required: true });
  day.value = state.on;

  const values = [...new Set<number>([...PERMIT_HOURS, planned])].sort((a, b) => a - b);
  const hours = values.map((value) => {
    const input = h('input', { type: 'radio', name: id('hours'), value: String(value), class: 'zs-punch-input' });
    input.checked = value === planned;
    const face = h('span', { class: 'zs-punch-face' }, hoursText(value), value === planned ? h('span', { class: 'zs-b-plan-mark zt-label' }, s('permitPlan')) : null);
    return { value, input, label: h('label', { class: 'zs-punch' }, input, face) };
  });

  const arrival = h('output', { class: 'zs-b-arrival zt-number', id: id('arrival'), for: `${id('day')}` });
  const span = h('p', { class: 'zs-b-span zt-small' });
  const date = h('p', { class: 'zs-b-date zt-small' });
  const bars = svg('0 0 192 40', profileBars(trek), 'zs-bars');
  const tearLabel = h('span', {}, s('permitTear'));
  const tear = h(
    'button',
    { type: 'button', class: 'zs-tear', 'aria-describedby': id('arrival') },
    svg(
      '0 0 20 20',
      '<circle cx="5" cy="5" r="2.6" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="5" cy="15" r="2.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7.4 6.4 18 14M7.4 13.6 18 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
      'zs-scissors',
    ),
    tearLabel,
  );
  const status = h('p', { class: 'zs-status zt-small', role: 'status' });
  const stub = h('div', { class: 'zs-stub zs-b-stub' }, h('p', { class: 'zt-label zs-stub-title' }, s('permitArrive')), arrival, span, date, bars, tear, status);

  const mark = createWordmark(document);
  mark.classList.add('zs-ticket-mark');
  const main = h(
    'div',
    { class: 'zs-ticket-main' },
    h('div', { class: 'zs-ticket-head zt-label' }, mark, h('span', {}, s('permitName')), h('span', { class: 'zs-ticket-no' }, s('permitNo', { n: permitNumber(roadmap.id) }))),
    h('div', { class: 'zs-row zs-b-route' }, h('span', { class: 'zt-label' }, s('permitRoute')), h('p', {}, options.road('span', roadmap.title, 'zs-b-route-title'), h('span', { class: 'zs-b-route-facts zt-data' }, options.facts))),
    h('div', { class: 'zs-row' }, h('label', { class: 'zt-label', for: id('day') }, s('permitDay')), day),
    h('fieldset', { class: 'zs-row' }, h('legend', { class: 'zt-label' }, s('permitHours')), h('div', { class: 'zs-punches' }, ...hours.map((item) => item.label))),
  );
  const form = h('form', { class: 'zs-ticket zs-b-permit zt-on-paper is-ready', novalidate: true, 'aria-label': s('permitName') }, main, stub);
  const element = h('div', { class: 'zs-ticket-wrap' }, h('div', { class: 'zs-slot', ...HIDDEN }), h('div', { class: 'zs-ticket-rise' }, form));

  let torn = false;
  const valid = (): boolean => isRealDay(state.on);
  const print = (): void => {
    form.classList.toggle('is-ready', valid());
    if (!valid()) {
      arrival.textContent = '';
      span.textContent = '';
      date.textContent = '';
      return;
    }
    const plan = planPace(roadmap, state.hours, state.on, today, trek);
    arrival.textContent = formatDay(plan.arrival, { lang });
    span.textContent = s('permitSpan', { weeks: s('nWeeks', { count: Math.max(1, Math.ceil(plan.neededWeeks - 1e-9)) }), hours: hoursText(plan.hoursPerWeek) });
    date.textContent = plan.deadline ? s('permitDate', { day: formatDay(plan.deadline, { lang }) }) : '';
  };
  const attach = (): void => {
    status.textContent = '';
    if (!torn) return;
    torn = false;
    stub.classList.remove('is-torn');
    tearLabel.textContent = s('permitTear');
  };

  form.addEventListener('submit', (event) => event.preventDefault());
  form.addEventListener('input', () => {
    state.on = day.value;
    state.hours = hours.find((item) => item.input.checked)?.value ?? state.hours;
    attach();
    print();
  });
  tear.addEventListener('click', () => {
    if (!valid()) {
      status.textContent = s('permitBadDay');
      day.focus();
      return;
    }
    torn = true;
    stub.classList.add('is-torn');
    tearLabel.textContent = s('permitAgain');
    if (options.onStart) {
      status.textContent = s('permitStarted', { day: formatDay(state.on, { lang }) });
      options.onStart({ on: state.on, hoursPerWeek: state.hours });
    } else {
      // A page that keeps no start cannot claim one: it says where to go on and goes there.
      status.textContent = s('permitToTable');
      options.toTable();
    }
  });

  print();
  return { element, choice: () => ({ on: state.on, hoursPerWeek: state.hours }) };
}
