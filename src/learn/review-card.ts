/**
 * A review sitting: finished steps with questions come back after 2, 7, 21 and 60 days (or the roadmap's own
 * gaps). The learner answers from memory, sees the explanation, and the step's next review day follows from
 * the result. A miss starts the gaps short again. One sitting holds about ten minutes of questions.
 */
import { day as formatDay, hours as formatHours } from './format';
import { daysBetween } from '../roadmap/dates';
import { checkKey } from '../roadmap/progress';
import type { ReviewItem } from '../roadmap/derive';
import { checkBlock, type CheckBlock } from './check';
import { cardRoot, h, headingTag, roadText, uid, type CardOptions, type MountedCard } from './dom';
import { mount } from './mount';
import { storageNotice } from './notice';
import { findWaypoint, type Session } from './session';
import { say } from './strings';

/** Estimated minutes for answering one question in a review. */
export const REVIEW_MINUTES_PER_CHECK = 2;
/** A sitting holds about this many minutes. */
export const SITTING_MINUTES = 10;

export interface Sitting {
  readonly items: readonly ReviewItem[];
  readonly minutes: number;
  /** Due steps left for another sitting. */
  readonly rest: number;
}

/** The next sitting: the most overdue steps first, up to about ten minutes, always at least one step. */
export function reviewSitting(session: Session, today?: string): Sitting {
  const due = session.due(today);
  const items: ReviewItem[] = [];
  let minutes = 0;
  for (const item of due) {
    const checks = findWaypoint(session.roadmap, item.waypointId)?.waypoint.checks?.length ?? 0;
    const cost = Math.max(1, checks) * REVIEW_MINUTES_PER_CHECK;
    if (items.length > 0 && minutes + cost > SITTING_MINUTES) break;
    items.push(item);
    minutes += cost;
  }
  return { items, minutes, rest: due.length - items.length };
}

/** The earliest review day still ahead, or null. */
export function nextReviewDay(session: Session, today: string): string | null {
  let best: string | null = null;
  for (const [id, wp] of Object.entries(session.progress.waypoints)) {
    if (!wp.done || !wp.due || !findWaypoint(session.roadmap, id)?.waypoint.checks?.length) continue;
    if (daysBetween(today, wp.due) > 0 && (best === null || wp.due < best)) best = wp.due;
  }
  return best;
}

export interface ReviewCardOptions extends CardOptions {
  /** The day to review for, YYYY-MM-DD. Default: the session's today. */
  readonly today?: string;
}

/**
 * With a waypoint id, a sitting for that one step (a cairn on the map). With null, the next sitting of what is
 * due today.
 */
export function reviewCard(session: Session, waypointId: string | null, options: ReviewCardOptions = {}): MountedCard {
  const level = options.headingLevel ?? 3;
  const root = cardRoot('section', 'zl-review');
  const lang = session.roadmap.lang;

  const build = () => {
    const titleId = uid('zl-title');
    root.setAttribute('aria-labelledby', titleId);
    const today = options.today ?? session.today();
    const notice = storageNotice(session);
    const body = h('div', { class: 'zl-review-body' });
    const meta = h('p', { class: 'zl-meta' });
    root.append(
      h(
        'header',
        { class: 'zl-head' },
        h(headingTag(level), { class: 'zl-title', id: titleId }, say('reviewTitle')),
        h('p', { class: 'zl-meta' }, say('reviewIntro')),
        meta,
      ),
      notice.root,
      body,
    );

    let more: HTMLButtonElement | null = null;
    let open = 0;
    let blocks: CheckBlock[] = [];

    const render = (): void => {
      body.replaceChildren();
      blocks = [];
      more = null;
      let sitting: Sitting;
      if (waypointId) {
        const node = findWaypoint(session.roadmap, waypointId);
        const wp = session.progress.waypoints[waypointId];
        const item = node && wp?.done && node.waypoint.checks?.length
          ? { waypointId, stageId: node.stage.id, title: node.waypoint.title, due: wp.due ?? today, daysOverdue: wp.due ? Math.max(0, daysBetween(wp.due, today)) : 0 }
          : null;
        sitting = { items: item ? [item] : [], minutes: (node?.waypoint.checks?.length ?? 0) * REVIEW_MINUTES_PER_CHECK, rest: 0 };
      } else {
        sitting = reviewSitting(session, today);
      }

      if (sitting.items.length === 0) {
        meta.textContent = '';
        meta.hidden = true;
        body.append(h('p', { class: 'zl-note' }, say('reviewNone')));
        const next = nextReviewDay(session, today);
        if (next) body.append(h('p', { class: 'zl-hint' }, say('reviewNext', { day: formatDay(next) })));
        return;
      }
      meta.hidden = false;
      meta.textContent = say('reviewSitting', { count: sitting.items.length, time: formatHours(sitting.minutes) });
      open = sitting.items.length;

      for (const item of sitting.items) {
        const node = findWaypoint(session.roadmap, item.waypointId);
        if (!node) continue;
        const checks = node.waypoint.checks ?? [];
        const results = new Map<number, boolean>();
        const outcome = h('p', { class: 'zl-outcome', 'aria-live': 'polite' });
        const headId = uid('zl-item');
        const part = h(
          'section',
          { class: 'zl-part zl-review-item', 'aria-labelledby': headId },
          roadText(headingTag(level + 1), node.waypoint.title, lang, { class: 'zl-sub', id: headId }),
          h('p', { class: 'zl-label' }, item.daysOverdue > 0 ? say('dueSince', { day: formatDay(item.due) }) : say('dueToday')),
        );
        checks.forEach((check, i) => {
          const block = checkBlock({
            session,
            check,
            key: checkKey('waypoint', item.waypointId, i),
            index: i,
            total: checks.length,
            lang,
            record: false,
            stageId: item.stageId,
            waypointId: item.waypointId,
            ...(options.onGo ? { onGo: options.onGo } : {}),
            onResult: (ok) => {
              if (results.has(i)) return;
              results.set(i, ok);
              if (results.size < checks.length) return;
              const allRight = [...results.values()].every(Boolean);
              session.review(item.waypointId, allRight);
              const due = session.progress.waypoints[item.waypointId]?.due;
              outcome.textContent = !allRight
                ? say('reviewMiss', { day: due ? formatDay(due) : '' })
                : due
                  ? say('reviewOk', { day: formatDay(due) })
                  : say('reviewFinished');
              part.setAttribute('data-reviewed', allRight ? 'ok' : 'miss');
              open -= 1;
              if (open <= 0 && more) more.hidden = false;
            },
          });
          blocks.push(block);
          part.append(block.root);
        });
        part.append(outcome);
        body.append(part);
      }

      if (sitting.rest > 0) {
        body.append(h('p', { class: 'zl-hint' }, say('reviewLater', { count: sitting.rest })));
        more = h('button', { type: 'button', class: 'zl-btn', hidden: true }, say('reviewMore'));
        more.addEventListener('click', () => {
          render();
          (body.querySelector('input, textarea, button') as HTMLElement | null)?.focus({ preventScroll: true });
        });
        body.append(h('div', { class: 'zl-row' }, more));
      }
    };
    render();

    return {
      update() {
        notice.update();
        for (const block of blocks) block.update();
      },
    };
  };

  return mount(session, root, build);
}
