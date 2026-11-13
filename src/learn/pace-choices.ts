/**
 * Pace in plain words: when the learner arrives at this rate, and the date they set. When the arrival runs past
 * the date by more than 15 percent, four ways to make it fit, each with its own arrival: more hours, a later date,
 * a lower summit, no side trails. Never "you are behind".
 */
import { day as formatDay, hours as formatHours } from './format';
import { cardRoot, h, headingTag, uid, type CardOptions, type MountedCard } from './dom';
import { mount } from './mount';
import type { PaceChoice } from './pace';
import type { Session } from './session';
import { say } from './strings';

export interface PaceChoicesOptions extends CardOptions {
  /** The day to work out the pace for, YYYY-MM-DD. Default: the session's today. */
  readonly today?: string;
  /** Show the choices even when the plan fits. Default false. */
  readonly always?: boolean;
  /** Called after a choice was applied to the session's plan. */
  readonly onChoose?: (choice: PaceChoice) => void;
}

function hoursText(hours: number): string {
  return say('choiceHours', { hours: formatHours(hours * 60, { approx: false, unit: 'hours' }) });
}

function choiceLabel(choice: PaceChoice): string {
  switch (choice.kind) {
    case 'hours':
      return hoursText(choice.hoursPerWeek ?? 0);
    case 'date':
      return say('choiceDate', { day: formatDay(choice.deadline ?? choice.arrival) });
    case 'summit':
      return say('choiceSummit', { tier: say(`tier.${choice.summit ?? 'bronze'}`) });
    case 'side-trails':
      return say('choiceSideTrails');
  }
}

export function paceChoices(session: Session, options: PaceChoicesOptions = {}): MountedCard {
  const level = options.headingLevel ?? 3;
  const root = cardRoot('section', 'zl-pace');

  const build = () => {
    const titleId = uid('zl-title');
    root.setAttribute('aria-labelledby', titleId);
    const arrive = h('p', { class: 'zl-note' });
    const date = h('p', { class: 'zl-meta' });
    const walked = h('p', { class: 'zl-meta' });
    const late = h('p', { class: 'zl-late' });
    const list = h('ul', { class: 'zl-choices', role: 'list' });
    const changed = h('div', { class: 'zl-changed' });
    const reset = h('button', { type: 'button', class: 'zl-btn zl-btn-quiet' }, say('resetPlan'));
    reset.addEventListener('click', () => session.replan(null));
    changed.append(h('p', { class: 'zl-hint' }, say('planChanged')), h('div', { class: 'zl-row' }, reset));

    root.append(
      h(
        'header',
        { class: 'zl-head' },
        h(headingTag(level), { class: 'zl-title zl-title-small', id: titleId }, say('paceTitle')),
      ),
      arrive,
      date,
      walked,
      late,
      list,
      changed,
      h('p', { class: 'zl-hint' }, say('paceNote')),
    );

    let shown = '';
    const update = (): void => {
      const day = options.today ?? session.today();
      const pace = session.pace(day);
      if (pace.remainingMinutes === 0) {
        arrive.textContent = say('arrived');
      } else if (pace.byRealPace) {
        arrive.textContent = say('arriveReal', { day: formatDay(pace.arrival) });
      } else {
        arrive.textContent = say('arrive', {
          hours: formatHours(pace.hoursPerWeek * 60, { approx: false, unit: 'hours' }),
          day: formatDay(pace.arrival),
        });
      }
      date.textContent = pace.deadline ? say('yourDate', { day: formatDay(pace.deadline) }) : say('noDate');
      walked.textContent = say('walked', {
        done: formatHours(pace.doneMinutes, { approx: false }),
        total: formatHours(pace.totalMinutes),
      });

      const showChoices = (pace.offer || options.always === true) && pace.remainingMinutes > 0;
      const days = pace.daysPastDeadline ?? 0;
      late.hidden = !showChoices || days <= 0;
      late.textContent = days > 0 ? `${say('lateBy', { count: days })} ${say('waysToFit')}` : '';
      changed.hidden = !pace.changed;

      const choices = showChoices ? session.choices(day) : [];
      const signature = choices.map((c) => `${c.kind}:${c.arrival}:${c.hoursPerWeek ?? ''}:${c.summit ?? ''}`).join('|');
      if (signature === shown) return;
      shown = signature;
      list.replaceChildren();
      list.hidden = choices.length === 0;
      for (const choice of choices) {
        const button = h('button', { type: 'button', class: 'zl-btn zl-choice' }, choiceLabel(choice));
        const detail = [say('choiceArrive', { day: formatDay(choice.arrival) })];
        if (choice.savedMinutes && choice.savedMinutes > 0) detail.push(say('choiceSaves', { time: formatHours(choice.savedMinutes) }));
        const detailId = uid('zl-choice');
        button.setAttribute('aria-describedby', detailId);
        button.addEventListener('click', () => {
          session.replan(choice.change);
          options.onChoose?.(choice);
        });
        list.append(h('li', { class: 'zl-choice-row', 'data-kind': choice.kind }, button, h('p', { class: 'zl-hint', id: detailId }, detail.join(' '))));
      }
    };
    update();
    return { update };
  };

  return mount(session, root, build);
}
