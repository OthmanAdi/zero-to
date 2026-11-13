/**
 * The four-step self-rating: saw it, did it with the guide, did it alone, could explain it. Native radio buttons;
 * the chosen step is marked by its checked radio, a tick, a heavier frame and bold type, and by its tier colour
 * last of all.
 */
import { TIER_NAMES } from '../scene/palette';
import type { Rating } from '../roadmap/progress';
import { h, uid } from './dom';
import type { Session } from './session';
import { say } from './strings';

export const RATINGS: readonly Rating[] = [1, 2, 3, 4];

export function ratingName(rating: Rating): string {
  return say(`rating${rating}`);
}

export interface RatingControl {
  readonly root: HTMLFieldSetElement;
  update(): void;
}

export function ratingControl(session: Session, waypointId: string): RatingControl {
  const name = uid('zl-rate');
  const inputs = new Map<Rating, HTMLInputElement>();
  const rows = RATINGS.map((rating) => {
    const input = h('input', { type: 'radio', name, value: String(rating), class: 'zl-radio' });
    inputs.set(rating, input);
    input.addEventListener('change', () => {
      if (input.checked) session.rate(waypointId, rating);
    });
    const pips = h('span', { class: 'zl-pips', 'aria-hidden': 'true' });
    for (let i = 1; i <= 4; i += 1) pips.append(h('span', { class: i <= rating ? 'zl-pip zl-pip-on' : 'zl-pip' }));
    return h(
      'label',
      { class: 'zl-step', 'data-step': rating, 'data-tier': TIER_NAMES[rating - 1] },
      input,
      pips,
      h('span', { class: 'zl-step-name' }, ratingName(rating)),
      h('span', { class: 'zl-step-tick', 'aria-hidden': 'true' }, '✓'),
    );
  });
  const root = h('fieldset', { class: 'zl-rating' }, h('legend', { class: 'zl-legend' }, say('ratingLegend')), h('div', { class: 'zl-steps' }, ...rows));

  const update = (): void => {
    const current = session.progress.waypoints[waypointId]?.rating;
    for (const [rating, input] of inputs) {
      input.checked = current === rating;
      input.parentElement?.toggleAttribute('data-chosen', current === rating);
    }
  };
  update();
  return { root, update };
}
