/**
 * The signpost at the end of a stage: show, test or explain. One tick per `show` item, the checkpoint's questions
 * with their explanations, and the stage's self-ratings, which can be corrected here and walked again.
 */
import { DEFAULT_PASS_SHARE } from '../roadmap/types';
import { checkKey, type Rating } from '../roadmap/progress';
import { checkBlock, type CheckBlock } from './check';
import { cardRoot, h, headingTag, requestGo, roadText, uid, type CardOptions, type MountedCard } from './dom';
import { mount } from './mount';
import { storageNotice } from './notice';
import { RATINGS, ratingName } from './rating';
import { findStage, type Session } from './session';
import { say } from './strings';

/** How many `show` items pass a checkpoint: `pass` (default 0.8) of them, rounded up, at least one. */
export function needToPass(showCount: number, pass: number = DEFAULT_PASS_SHARE): number {
  return Math.max(1, Math.ceil(pass * showCount - 1e-9));
}

export function signpostCard(session: Session, stageId: string, options: CardOptions = {}): MountedCard {
  const found = findStage(session.roadmap, stageId);
  if (!found) throw new Error(`signpostCard: no stage "${stageId}" in this roadmap`);
  const { roadmap } = session;
  const { stage, index: stageIndex } = found;
  const checkpoint = stage.checkpoint;
  const lang = roadmap.lang;
  const level = options.headingLevel ?? 3;
  const root = cardRoot('article', 'zl-signpost', { 'data-stage': stage.id });

  const build = () => {
    const titleId = uid('zl-title');
    root.setAttribute('aria-labelledby', titleId);
    const total = checkpoint.show.length;
    const need = needToPass(total, checkpoint.pass);

    const header = h(
      'header',
      { class: 'zl-head' },
      h('p', { class: 'zl-kicker zl-label' }, say('stageOf', { n: stageIndex + 1, total: roadmap.stages.length }), ' · ', say('signpost')),
      roadText(headingTag(level), checkpoint.title, lang, { class: 'zl-title', id: titleId }),
      h('p', { class: 'zl-meta' }, say('signpostIntro'), ' ', say('passRule', { count: need, total })),
    );

    const boxes = checkpoint.show.map((text, i) => {
      const id = uid('zl-show');
      const box = h('input', { type: 'checkbox', id, class: 'zl-check-box' });
      box.addEventListener('change', () => session.show(stage.id, i, box.checked));
      return { box, row: h('li', { class: 'zl-arm' }, h('label', { class: 'zl-arm-label', for: id }, box, roadText('span', text, lang, { class: 'zl-arm-text' }))) };
    });
    const tally = h('p', { class: 'zl-tally', role: 'status' });
    const showHeadId = uid('zl-show-head');
    const arms = h(
      'div',
      { class: 'zl-arms', role: 'group', 'aria-labelledby': showHeadId },
      h(headingTag(level + 1), { class: 'zl-part-head zl-label', id: showHeadId }, say('canShow')),
      h('ul', { class: 'zl-arm-list', role: 'list' }, ...boxes.map((b) => b.row)),
      tally,
    );
    const lock = roadmap.brief.gating === 'gated' ? h('p', { class: 'zl-lock-note' }, say('gatedLock')) : null;
    const notice = storageNotice(session);

    const checks: CheckBlock[] = (checkpoint.checks ?? []).map((check, i, all) =>
      checkBlock({
        session,
        check,
        key: checkKey('checkpoint', stage.id, i),
        index: i,
        total: all.length,
        lang,
        record: true,
        stageId: stage.id,
        ...(options.onGo ? { onGo: options.onGo } : {}),
      }),
    );
    const checksPart =
      checks.length > 0
        ? h('section', { class: 'zl-part' }, h(headingTag(level + 1), { class: 'zl-part-head zl-label' }, say('testYourself')), ...checks.map((c) => c.root))
        : null;

    // The stage's ratings: correct one here, or walk a low one again.
    const ratingRows = stage.waypoints.map((waypoint) => {
      const titleRef = uid('zl-rated');
      const select = h('select', { class: 'zl-select', 'aria-labelledby': titleRef });
      select.append(h('option', { value: '' }, say('ratingNone')));
      for (const rating of RATINGS) select.append(h('option', { value: String(rating) }, `${rating} · ${ratingName(rating)}`));
      select.addEventListener('change', () => {
        const value = select.value === '' ? null : (Number(select.value) as Rating);
        session.rate(waypoint.id, value);
      });
      const again = h('button', { type: 'button', class: 'zl-btn zl-btn-quiet' });
      again.addEventListener('click', () => requestGo(again, { waypointId: waypoint.id, stageId: stage.id }, options.onGo));
      const state = h('span', { class: 'zl-rated-state' });
      const row = h(
        'li',
        { class: 'zl-rated' },
        h('p', { class: 'zl-rated-title' }, roadText('span', waypoint.title, lang, { id: titleRef }), waypoint.optional ? h('span', { class: 'zl-tag' }, say('sideTrail')) : null, state),
        h('div', { class: 'zl-field-row' }, select, again),
      );
      return { waypoint, select, again, state, row };
    });
    const ratingsPart = h(
      'section',
      { class: 'zl-part' },
      h(headingTag(level + 1), { class: 'zl-part-head zl-label' }, say('ratingsTitle')),
      h('p', { class: 'zl-hint' }, say('ratingsHint')),
      h('ul', { class: 'zl-rated-list', role: 'list' }, ...ratingRows.map((r) => r.row)),
    );

    root.append(header, arms, lock ?? '', notice.root, checksPart ?? '', ratingsPart);

    const update = (): void => {
      const row = session.progress.shows[stage.id] ?? [];
      boxes.forEach(({ box }, i) => {
        box.checked = row[i] === true;
        box.closest('li')?.toggleAttribute('data-ticked', row[i] === true);
      });
      const ticked = checkpoint.show.filter((_, i) => row[i] === true).length;
      const passed = session.passed(stage.id);
      root.toggleAttribute('data-passed', passed);
      const line = `${say('ticked', { count: ticked, total })}. ${passed ? say('passed') : say('toGo', { count: Math.max(0, need - ticked) })}`;
      if (tally.textContent !== line) tally.textContent = line;
      notice.update();
      for (const check of checks) check.update();
      for (const r of ratingRows) {
        const wp = session.progress.waypoints[r.waypoint.id];
        const value = wp?.rating ? String(wp.rating) : '';
        if (r.select.value !== value) r.select.value = value;
        const state = wp?.done ? '' : say('notDoneYet');
        r.state.textContent = state ? ` · ${state}` : '';
        // An open step gets "Go there", a low rating "Walk it again"; a confident or unrated finished step needs neither.
        const label = wp?.done ? (wp.rating !== undefined && wp.rating <= 2 ? say('walkAgain') : '') : say('goThere');
        r.again.hidden = label === '';
        if (label && r.again.textContent !== label) r.again.textContent = label;
      }
    };
    update();
    return { update };
  };

  return mount(session, root, build);
}
