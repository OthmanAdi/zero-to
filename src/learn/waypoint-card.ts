/**
 * The waypoint card: the working note for one step. It teaches in the order learning works best:
 *
 * 1. Note: what the step gives, then the predict question, answered or skipped before the sources open.
 * 2. Do: the hands-on task, questions to check yourself with, "Done" and the four-step self-rating.
 * 3. Take with you: key points, the task and the links to pin into the notebook, a line of your own and a private
 *    note.
 *
 * The three parts are also handed out one by one, so a floating note can put them on tabs.
 */
import { formatNumber } from '../look/format';
import { day as formatDay, hours as formatHours } from './format';
import { checkKey, type Position } from '../roadmap/progress';
import type { Resource, Waypoint } from '../roadmap/types';
import { checkBlock, type CheckBlock } from './check';
import {
  cardRoot,
  h,
  headingTag,
  pinButton,
  requestGo,
  roadText,
  setPressed,
  setValueIfIdle,
  uid,
  type CardOptions,
  type MountedCard,
} from './dom';
import { mount } from './mount';
import { NOTEBOOK_MAX_ENTRIES, NOTEBOOK_MAX_TEXT, pinId, type NotebookDraft } from './notebook';
import { storageNotice } from './notice';
import { ratingControl, ratingName } from './rating';
import { resourceList } from './resources';
import { findWaypoint, NOTE_MAX, type Session } from './session';
import { say } from './strings';

/** Where a free-text guess (or a skip) for a waypoint's predict question is stored. */
export const predictKey = (waypointId: string): string => `p:${waypointId}`;

/** The check whose options serve as buttons for the predict question: the first predict check with options. */
export function predictCheckIndex(waypoint: Waypoint): number {
  return waypoint.checks?.findIndex((c) => c.kind === 'predict' && (c.options?.length ?? 0) > 0) ?? -1;
}

/**
 * `none`: the step asks nothing before reading. `open`: the question waits, and the sources are locked.
 * `answered` and `skipped` open the sources. The shelf uses this to rise from 0.6 to full light.
 */
export type PredictState = 'none' | 'open' | 'answered' | 'skipped';

export function predictState(session: Session, waypointId: string): PredictState {
  const node = findWaypoint(session.roadmap, waypointId);
  if (!node?.waypoint.predict) return 'none';
  const answers = session.progress.answers;
  const index = predictCheckIndex(node.waypoint);
  if (index >= 0 && answers[checkKey('waypoint', waypointId, index)]?.choice !== undefined) return 'answered';
  const own = answers[predictKey(waypointId)];
  if (!own) return 'open';
  return own.text && own.text.trim() !== '' ? 'answered' : 'skipped';
}

export interface WaypointCard extends MountedCard {
  /** The three parts, for a frame that shows them on tabs. They live inside `root` until moved. */
  readonly parts: { readonly note: HTMLElement; readonly do: HTMLElement; readonly take: HTMLElement };
}

const NOTE_SAVE_DELAY = 400;

export function waypointCard(session: Session, waypointId: string, options: CardOptions = {}): WaypointCard {
  const node = findWaypoint(session.roadmap, waypointId);
  if (!node) throw new Error(`waypointCard: no waypoint "${waypointId}" in this roadmap`);
  const { roadmap } = session;
  const { waypoint, stage, stageIndex, waypointIndex } = node;
  const lang = roadmap.lang;
  const level = options.headingLevel ?? 3;
  const root = cardRoot('article', 'zl-waypoint', { 'data-waypoint': waypoint.id, 'data-stage': stage.id });
  let parts = { note: root, do: root, take: root } as { note: HTMLElement; do: HTMLElement; take: HTMLElement };

  const build = () => {
    const titleId = uid('zl-title');
    root.setAttribute('aria-labelledby', titleId);
    const resources = waypoint.resources
      .map((id) => roadmap.resources.find((r) => r.id === id))
      .filter((r): r is Resource => r !== undefined);

    // ---- Header
    const status = h('p', { class: 'zl-status' });
    const header = h(
      'header',
      { class: 'zl-head' },
      h(
        'p',
        { class: 'zl-kicker zl-label' },
        say('stageOf', { n: stageIndex + 1, total: roadmap.stages.length }),
        ' · ',
        say('stepOf', { n: waypointIndex + 1, total: stage.waypoints.length }),
        waypoint.optional ? h('span', { class: 'zl-tag' }, say('sideTrail')) : null,
      ),
      roadText(headingTag(level), waypoint.title, lang, { class: 'zl-title', id: titleId }),
      h(
        'p',
        { class: 'zl-meta' },
        say('meta', { time: formatHours(waypoint.minutes), practice: formatHours(waypoint.practiceMinutes, { approx: false }) }),
      ),
      status,
    );

    // ---- Note
    const noteHeadId = uid('zl-part');
    const notePart = h(
      'section',
      { class: 'zl-part', 'data-part': 'note', 'aria-labelledby': noteHeadId },
      h(headingTag(level + 1), { class: 'zl-part-head zl-label', id: noteHeadId }, say('partNote')),
      roadText('p', waypoint.note, lang, { class: 'zl-note' }),
    );

    const predict = waypoint.predict ? predictBlock(session, waypoint, level + 2) : null;
    if (predict) notePart.append(predict.root);

    const sourcesHeadId = uid('zl-sources');
    const lockHint = h('p', { class: 'zl-lock' }, say('sourcesLocked'));
    const list = resources.length > 0 ? resourceList({ resources, lang, mainFirst: true }) : null;
    const sources = h(
      'div',
      { class: 'zl-sources', role: 'group', 'aria-labelledby': sourcesHeadId },
      h(headingTag(level + 2), { class: 'zl-sub', id: sourcesHeadId }, say('sources')),
      lockHint,
      list ? list.root : null,
      waypoint.gap
        ? h('div', { class: 'zl-gap' }, h('p', { class: 'zl-label' }, say('noSource')), roadText('p', waypoint.gap, lang, { class: 'zl-gap-text' }))
        : list
          ? null
          : h('p', { class: 'zl-label' }, say('noSource')),
    );
    notePart.append(sources);

    // ---- Do
    const doHeadId = uid('zl-part');
    const doPart = h(
      'section',
      { class: 'zl-part', 'data-part': 'do', 'aria-labelledby': doHeadId },
      h(headingTag(level + 1), { class: 'zl-part-head zl-label', id: doHeadId }, say('partDo')),
      roadText('p', waypoint.do, lang, { class: 'zl-task' }),
    );

    const checks: CheckBlock[] = (waypoint.checks ?? []).map((check, index, all) =>
      checkBlock({
        session,
        check,
        key: checkKey('waypoint', waypoint.id, index),
        index,
        total: all.length,
        lang,
        record: true,
        stageId: stage.id,
        waypointId: waypoint.id,
        ...(options.onGo ? { onGo: options.onGo } : {}),
      }),
    );
    if (checks.length > 0) {
      doPart.append(
        h(
          'div',
          { class: 'zl-checks' },
          h(headingTag(level + 2), { class: 'zl-sub' }, say('checksTitle')),
          ...checks.map((c) => c.root),
        ),
      );
    }

    const doneId = uid('zl-done');
    const doneHintId = uid('zl-done-hint');
    const doneBox = h('input', { type: 'checkbox', id: doneId, class: 'zl-check-box', 'aria-describedby': doneHintId });
    doneBox.addEventListener('change', () => session.done(waypoint.id, doneBox.checked));
    const notice = storageNotice(session);
    const rating = ratingControl(session, waypoint.id);
    const nextLine = h('div', { class: 'zl-next', 'aria-live': 'polite' });
    doPart.append(
      h(
        'div',
        { class: 'zl-done' },
        h('label', { class: 'zl-done-label', for: doneId }, doneBox, h('span', { class: 'zl-done-word' }, say('done'))),
        h('p', { class: 'zl-hint', id: doneHintId }, say('doneHint')),
      ),
      notice.root,
      rating.root,
      nextLine,
    );

    // ---- Take with you
    const takeHeadId = uid('zl-part');
    const takePart = h(
      'section',
      { class: 'zl-part', 'data-part': 'take', 'aria-labelledby': takeHeadId },
      h(headingTag(level + 1), { class: 'zl-part-head zl-label', id: takeHeadId }, say('partTake')),
    );

    const pins: { readonly button: HTMLButtonElement; readonly id: string }[] = [];
    const togglePin = (button: HTMLButtonElement, id: string, draft: () => NotebookDraft): void => {
      pins.push({ button, id });
      button.addEventListener('click', () => {
        if (session.notebook.has(id)) session.unpin(id);
        else session.pin(draft());
      });
    };

    const points = waypoint.takeaways && waypoint.takeaways.length > 0 ? waypoint.takeaways : [waypoint.note];
    const pointList = h('ul', { class: 'zl-pins', role: 'list' });
    points.forEach((text, i) => {
      const textId = uid('zl-point');
      const button = pinButton(say('pin'), say('pinPoint', { n: i + 1 }));
      button.setAttribute('aria-describedby', textId);
      togglePin(button, pinId('point', waypoint.id, i), () => ({
        id: pinId('point', waypoint.id, i),
        kind: 'point',
        text,
        stageId: stage.id,
        waypointId: waypoint.id,
      }));
      pointList.append(h('li', { class: 'zl-pin-row' }, roadText('p', text, lang, { class: 'zl-pin-text', id: textId }), button));
    });
    takePart.append(h(headingTag(level + 2), { class: 'zl-sub' }, say('keyPoints')), pointList);

    const taskButton = pinButton(say('pin'), say('pinTask'));
    togglePin(taskButton, pinId('task', waypoint.id), () => ({
      id: pinId('task', waypoint.id),
      kind: 'task',
      text: waypoint.do,
      stageId: stage.id,
      waypointId: waypoint.id,
    }));
    takePart.append(
      h(headingTag(level + 2), { class: 'zl-sub' }, say('task')),
      h('ul', { class: 'zl-pins', role: 'list' }, h('li', { class: 'zl-pin-row' }, roadText('p', waypoint.do, lang, { class: 'zl-pin-text zl-pin-text-short' }), taskButton)),
    );

    if (resources.length > 0) {
      const linkList = h('ul', { class: 'zl-pins', role: 'list' });
      resources.forEach((resource, i) => {
        const id = pinId('link', waypoint.id, resource.id);
        const textId = uid('zl-link');
        const button = pinButton(say('pin'), say('pinLink', { n: i + 1 }));
        button.setAttribute('aria-describedby', textId);
        togglePin(button, id, () => ({ id, kind: 'link', text: resource.title, url: resource.url, stageId: stage.id, waypointId: waypoint.id }));
        linkList.append(h('li', { class: 'zl-pin-row' }, roadText('p', resource.title, resource.lang, { class: 'zl-pin-text', id: textId }), button));
      });
      takePart.append(h(headingTag(level + 2), { class: 'zl-sub' }, say('links')), linkList);
    }

    const full = h('p', { class: 'zl-notice', role: 'status', hidden: true }, say('notebookFull', { max: formatNumber(NOTEBOOK_MAX_ENTRIES) }));
    takePart.append(full);

    // A line of the learner's own.
    const ownId = uid('zl-own');
    const ownHintId = uid('zl-own-hint');
    const ownInput = h('input', { type: 'text', id: ownId, class: 'zl-field', maxlength: NOTEBOOK_MAX_TEXT, 'aria-describedby': ownHintId, dir: 'auto' });
    const ownSaved = h('p', { class: 'zl-saved', 'aria-live': 'polite' });
    const ownForm = h(
      'form',
      { class: 'zl-own' },
      h('label', { class: 'zl-field-label', for: ownId }, say('ownLine')),
      h('p', { class: 'zl-hint', id: ownHintId }, say('ownLineHint', { max: formatNumber(NOTEBOOK_MAX_TEXT) })),
      h('div', { class: 'zl-field-row' }, ownInput, h('button', { type: 'submit', class: 'zl-btn' }, say('addLine'))),
      ownSaved,
    );
    ownForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const added = session.pin({ kind: 'own', text: ownInput.value, stageId: stage.id, waypointId: waypoint.id });
      if (added) {
        ownInput.value = '';
        ownSaved.textContent = say('saved');
      }
    });
    takePart.append(ownForm);

    // The private note: only in this browser, never shared.
    const noteId = uid('zl-private');
    const noteHintId = uid('zl-private-hint');
    const counterId = uid('zl-count');
    const noteArea = h('textarea', {
      id: noteId,
      class: 'zl-field',
      rows: 4,
      maxlength: NOTE_MAX,
      dir: 'auto',
      'aria-describedby': `${noteHintId} ${counterId}`,
    });
    const counter = h('p', { class: 'zl-count', id: counterId });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const saveNote = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      session.note(waypoint.id, noteArea.value);
    };
    const showCount = (): void => {
      counter.textContent = say('charsLeft', { count: formatNumber(Math.max(0, NOTE_MAX - Array.from(noteArea.value).length)) });
    };
    noteArea.addEventListener('input', () => {
      showCount();
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(saveNote, NOTE_SAVE_DELAY);
    });
    noteArea.addEventListener('change', saveNote);
    noteArea.addEventListener('blur', saveNote);
    takePart.append(
      h(
        'div',
        { class: 'zl-private' },
        h('label', { class: 'zl-field-label', for: noteId }, say('privateNote')),
        h('p', { class: 'zl-hint', id: noteHintId }, say('privateNoteHint', { max: formatNumber(NOTE_MAX) })),
        noteArea,
        counter,
      ),
    );

    root.append(header, notePart, doPart, takePart);
    parts = { note: notePart, do: doPart, take: takePart };

    const update = (): void => {
      const progress = session.progress.waypoints[waypoint.id];
      const done = progress?.done === true;
      const words: string[] = [];
      if (done && progress?.doneOn) words.push(say('doneOn', { day: formatDay(progress.doneOn) }));
      if (progress?.rating) words.push(ratingName(progress.rating));
      status.textContent = words.join(' · ');
      status.hidden = words.length === 0;
      root.toggleAttribute('data-done', done);

      predict?.update();
      const state = predictState(session, waypoint.id);
      const locked = state === 'open';
      list?.setLocked(locked);
      lockHint.hidden = !locked || !list;
      sources.toggleAttribute('data-locked', locked);

      for (const check of checks) check.update();
      doneBox.checked = done;
      notice.update();
      rating.root.hidden = !done;
      rating.update();
      updateNext(nextLine, session, waypoint.id, done, lang, options.onGo);

      for (const pin of pins) setPressed(pin.button, session.notebook.has(pin.id));
      full.hidden = !session.notebook.full;
      setValueIfIdle(noteArea, session.progress.notes[waypoint.id] ?? '');
      showCount();
    };
    update();
    return {
      update,
      dispose() {
        if (timer !== undefined) saveNote();
      },
    };
  };

  const mounted = mount(session, root, build);
  return {
    ...mounted,
    get parts() {
      return parts;
    },
  };
}

function updateNext(line: HTMLElement, session: Session, waypointId: string, done: boolean, lang: string, onGo: CardOptions['onGo']): void {
  const here: Position | null = done ? session.here() : null;
  const signature = done ? (here ? `${here.waypointId}` : 'end') : '';
  if (line.dataset.shows === signature) return;
  line.dataset.shows = signature;
  line.replaceChildren();
  if (!done) return;
  if (!here) {
    line.append(h('p', { class: 'zl-next-text' }, say('routeDone')));
    return;
  }
  if (here.waypointId === waypointId) return;
  const node = findWaypoint(session.roadmap, here.waypointId);
  if (!node) return;
  const go = h('button', { type: 'button', class: 'zl-btn' }, say('goThere'));
  go.addEventListener('click', () => requestGo(go, { waypointId: here.waypointId, stageId: here.stageId }, onGo));
  line.append(h('p', { class: 'zl-next-text' }, say('nextStep'), ' ', roadText('span', node.waypoint.title, lang, { class: 'zl-next-title' })), go);
}

/**
 * The predict question. With a matching check that has options, the options are buttons. Otherwise a short text
 * field. "Skip" is always there: the question is an invitation, not a gate the learner can get stuck at.
 */
function predictBlock(session: Session, waypoint: Waypoint, level: number): { readonly root: HTMLElement; update(): void } {
  const lang = session.roadmap.lang;
  const index = predictCheckIndex(waypoint);
  const check = index >= 0 ? waypoint.checks?.[index] : undefined;
  const choiceKey = check ? checkKey('waypoint', waypoint.id, index) : null;
  const textKey = predictKey(waypoint.id);
  const headId = uid('zl-predict');
  let editing = false;

  const save = h('button', { type: 'button', class: 'zl-btn zl-btn-strong' }, say('saveGuess'));
  const skip = h('button', { type: 'button', class: 'zl-btn zl-btn-quiet' }, say('skip'));
  const change = h('button', { type: 'button', class: 'zl-btn zl-btn-quiet' }, say('changeGuess'));

  const ask = h('div', { class: 'zl-predict-ask' });
  const inputs: HTMLInputElement[] = [];
  let area: HTMLTextAreaElement | null = null;
  if (check?.options) {
    const name = uid('zl-guess');
    const group = h('fieldset', { class: 'zl-options-group' }, h('legend', { class: 'zl-field-label' }, say('yourGuess')));
    const box = h('div', { class: 'zl-options' });
    check.options.forEach((text, i) => {
      const input = h('input', { type: 'radio', name, value: String(i), class: 'zl-radio' });
      input.addEventListener('change', () => sync());
      inputs.push(input);
      box.append(h('label', { class: 'zl-option' }, input, roadText('span', text, lang, { class: 'zl-option-text' })));
    });
    group.append(box);
    ask.append(group);
  } else {
    const areaId = uid('zl-guess');
    area = h('textarea', { id: areaId, class: 'zl-field', rows: 2, maxlength: NOTEBOOK_MAX_TEXT, dir: 'auto' });
    area.addEventListener('input', () => sync());
    ask.append(h('label', { class: 'zl-field-label', for: areaId }, say('yourGuess')), area);
  }
  ask.append(h('div', { class: 'zl-row' }, save, skip));

  const guessText = h('p', { class: 'zl-guess-text', dir: 'auto' });
  const next = h('p', { class: 'zl-guess-next' });
  const result = h(
    'div',
    { class: 'zl-predict-result', 'aria-live': 'polite' },
    h('p', { class: 'zl-label zl-guess-label' }, say('yourGuess')),
    guessText,
    next,
    h('div', { class: 'zl-row' }, change),
  );

  const root = h(
    'div',
    { class: 'zl-predict', role: 'group', 'aria-labelledby': headId },
    h(headingTag(level), { class: 'zl-sub', id: headId }, say('predictTitle')),
    roadText('p', waypoint.predict ?? '', lang, { class: 'zl-q' }),
    h('p', { class: 'zl-hint' }, say('predictWhy')),
    ask,
    result,
  );

  const chosen = (): number => inputs.findIndex((input) => input.checked);

  save.addEventListener('click', () => {
    if (choiceKey) {
      const choice = chosen();
      if (choice < 0) return;
      session.answer(choiceKey, { choice });
    } else if (area) {
      if (area.value.trim() === '') return;
      session.answer(textKey, { text: area.value.trim() });
    }
    editing = false;
    sync();
    change.focus({ preventScroll: true });
  });
  skip.addEventListener('click', () => {
    session.answer(textKey, { text: '' });
    editing = false;
    sync();
    change.focus({ preventScroll: true });
  });
  change.addEventListener('click', () => {
    editing = true;
    sync();
    (inputs[0] ?? area)?.focus({ preventScroll: true });
  });

  const sync = (): void => {
    const state = predictState(session, waypoint.id);
    const answers = session.progress.answers;
    const stored = choiceKey ? answers[choiceKey] : undefined;
    const verdict = stored?.correct !== undefined;
    const asking = state === 'open' || editing;
    ask.hidden = !asking;
    result.hidden = asking;
    root.dataset.state = state;
    // Once the matching check has its verdict, the guess is part of the record and stays as it was.
    change.hidden = verdict;
    if (asking) {
      const previous = stored?.choice !== undefined ? inputs[stored.choice] : undefined;
      if (previous && chosen() < 0) previous.checked = true;
      if (area && document.activeElement !== area && area.value === '') area.value = answers[textKey]?.text ?? '';
      save.disabled = choiceKey ? chosen() < 0 : (area?.value.trim() ?? '') === '';
      return;
    }
    if (state === 'skipped') {
      guessText.textContent = say('guessSkipped');
      guessText.removeAttribute('lang');
      next.textContent = '';
      next.hidden = true;
      return;
    }
    next.hidden = false;
    next.textContent = say('guessNext');
    if (choiceKey && stored?.choice !== undefined) {
      guessText.textContent = check?.options?.[stored.choice] ?? '';
      guessText.setAttribute('lang', lang);
    } else {
      guessText.textContent = answers[textKey]?.text ?? '';
      guessText.removeAttribute('lang');
    }
  };
  sync();
  return { root, update: sync };
}
