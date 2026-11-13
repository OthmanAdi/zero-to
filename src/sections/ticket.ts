import { createRandom } from '../core/random';
import type { UiLang } from '../i18n';
import { createWordmark } from '../look/brand';
import { AUDIENCES, HOURS, TOPIC_MAX, ticketCommand, ticketReady, type Audience, type TicketChoice } from './command';
import { copyText, h, svg } from './dom';
import { say, type SectionKey } from './strings';

/**
 * The start ticket: a form that punches a topic, an audience and hours a week, and a stub that prints the
 * `/zero-to` command for them. Tearing the stub copies the command. Nothing is sent anywhere.
 */

export interface TicketState {
  topic: string;
  audience: Audience;
  hours: number;
  defaults: boolean;
}

export const DEFAULT_TICKET: Readonly<TicketState> = { topic: '', audience: 'self', hours: 5, defaults: false };

export interface TicketView {
  readonly element: HTMLElement;
  /** The line the ticket prints out of. The thread ends here. */
  readonly slot: HTMLElement;
  setTopic(topic: string): void;
}

export interface TicketOptions {
  readonly lang: UiLang;
  readonly state: TicketState;
  readonly idPrefix: string;
  onCopy?(command: string): void;
}

/** The stub's barcode: bars whose heights are a mountain profile, drawn from the command, so every topic prints its own. */
function profileBars(seed: string): string {
  const random = createRandom(`ticket/${seed}`);
  const peak = 0.3 + random() * 0.4;
  const second = random();
  let bars = '';
  const count = 46;
  for (let index = 0; index < count; index += 1) {
    const t = index / (count - 1);
    const main = Math.exp(-(((t - peak) / 0.2) ** 2));
    const side = 0.55 * Math.exp(-(((t - second) / 0.12) ** 2));
    const height = 6 + 30 * Math.min(1, Math.max(main, side) + 0.12 * random());
    const width = index % 3 === 0 ? 2.6 : 1.4;
    bars += `<rect x="${(index * 4.2).toFixed(1)}" y="${(40 - height).toFixed(1)}" width="${width}" height="${height.toFixed(1)}"/>`;
  }
  return bars;
}

export function createTicket(options: TicketOptions): TicketView {
  const { lang, state, idPrefix } = options;
  const s = (key: SectionKey): string => say(key, undefined, lang);
  const id = (name: string) => `${idPrefix}ticket-${name}`;
  const choice = (): TicketChoice => ({ topic: state.topic, audience: state.audience, hours: state.hours, defaults: state.defaults });

  const topic = h('input', {
    id: id('topic'),
    class: 'zs-input',
    type: 'text',
    name: 'topic',
    maxlength: TOPIC_MAX,
    placeholder: s('ticketTopicHint'),
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    enterkeyhint: 'done',
  });
  topic.value = state.topic;

  const radio = (name: string, value: string, label: string, checked: boolean) => {
    const input = h('input', { type: 'radio', name: id(name), value, class: 'zs-punch-input' });
    input.checked = checked;
    return { input, label: h('label', { class: 'zs-punch' }, input, h('span', { class: 'zs-punch-face' }, label)) };
  };

  const audienceLabel: Readonly<Record<Audience, string>> = {
    self: s('ticketSelf'),
    student: s('ticketStudent'),
    class: s('ticketClass'),
  };
  const audiences = AUDIENCES.map((value) => radio('for', value, audienceLabel[value], state.audience === value));
  const hours = HOURS.map((value) => radio('hours', String(value), value >= 20 ? s('ticketHoursMore') : String(value), state.hours === value));
  const hoursNote = h('p', { class: 'zs-ticket-note zt-small' }, s('ticketHoursClass'));
  const hoursSet = h(
    'fieldset',
    { class: 'zs-row' },
    h('legend', { class: 'zt-label' }, s('ticketHours')),
    h('div', { class: 'zs-punches' }, ...hours.map((item) => item.label)),
    hoursNote,
  );

  const defaults = h('input', { type: 'checkbox', name: 'defaults', class: 'zs-punch-input' });
  defaults.checked = state.defaults;

  const command = h('code', { class: 'zs-command', id: id('command') });
  const bars = svg('0 0 192 40', '', 'zs-bars');
  const tearLabel = h('span', {}, s('stubTear'));
  const tear = h(
    'button',
    { type: 'button', class: 'zs-tear', 'aria-describedby': id('command') },
    svg(
      '0 0 20 20',
      '<circle cx="5" cy="5" r="2.6" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="5" cy="15" r="2.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7.4 6.4 18 14M7.4 13.6 18 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
      'zs-scissors',
    ),
    tearLabel,
  );
  const status = h('p', { class: 'zs-status zt-small', role: 'status' });

  const stub = h(
    'div',
    { class: 'zs-stub' },
    h('p', { class: 'zt-label zs-stub-title' }, s('stubTitle')),
    command,
    bars,
    tear,
    status,
  );

  const main = h(
    'div',
    { class: 'zs-ticket-main' },
    h(
      'div',
      { class: 'zs-ticket-head zt-label' },
      (() => {
        const mark = createWordmark(document);
        mark.classList.add('zs-ticket-mark');
        return mark;
      })(),
      h('span', {}, s('ticketName')),
      h('span', { class: 'zs-ticket-no' }, s('ticketNo')),
    ),
    h('div', { class: 'zs-row' }, h('label', { class: 'zt-label', for: id('topic') }, s('ticketTopic')), topic),
    h(
      'fieldset',
      { class: 'zs-row' },
      h('legend', { class: 'zt-label' }, s('ticketFor')),
      h('div', { class: 'zs-punches' }, ...audiences.map((item) => item.label)),
    ),
    hoursSet,
    h('label', { class: 'zs-punch zs-punch-check' }, defaults, h('span', { class: 'zs-punch-face' }, s('ticketDefaults'))),
  );

  const form = h('form', { class: 'zs-ticket zt-on-paper', novalidate: true, 'aria-label': s('ticketName') }, main, stub);
  const slot = h('div', { class: 'zs-slot', 'aria-hidden': 'true' });
  const element = h('div', { class: 'zs-ticket-wrap' }, slot, h('div', { class: 'zs-ticket-rise' }, form));

  let torn = false;
  const print = () => {
    const line = ticketCommand(choice(), lang);
    command.textContent = line;
    bars.innerHTML = profileBars(line);
    const forClass = state.audience === 'class';
    hoursSet.classList.toggle('is-off', forClass);
    for (const item of hours) item.input.disabled = forClass;
    form.classList.toggle('is-ready', ticketReady(choice()));
  };
  const attach = () => {
    if (!torn) return;
    torn = false;
    stub.classList.remove('is-torn');
    tearLabel.textContent = s('stubTear');
    status.textContent = '';
  };

  form.addEventListener('submit', (event) => event.preventDefault());
  form.addEventListener('input', () => {
    state.topic = topic.value;
    state.audience = (audiences.find((item) => item.input.checked)?.input.value as Audience | undefined) ?? state.audience;
    const picked = hours.find((item) => item.input.checked);
    if (picked) state.hours = Number(picked.input.value);
    state.defaults = defaults.checked;
    status.textContent = '';
    attach();
    print();
  });
  tear.addEventListener('click', () => {
    if (!ticketReady(choice())) {
      status.textContent = s('stubEmpty');
      topic.focus();
      return;
    }
    const line = ticketCommand(choice(), lang);
    void copyText(line).then((done) => {
      status.textContent = s(done ? 'stubCopied' : 'stubFailed');
      if (!done) return;
      torn = true;
      stub.classList.add('is-torn');
      tearLabel.textContent = s('stubAgain');
      options.onCopy?.(line);
    });
  });

  print();
  return {
    element,
    slot,
    setTopic(next) {
      state.topic = next;
      topic.value = next;
      attach();
      print();
    },
  };
}
