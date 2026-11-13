/**
 * One question to check yourself with. With options: pick one, then "Check my answer" says whether it was right
 * and explains why. Without options: write an answer in your own words, then compare it with the model answer and
 * say honestly whether you had it. Either way the explanation is the point, not the score.
 */
import type { Check } from '../roadmap/types';
import type { CheckAnswer } from '../roadmap/progress';
import { h, pinButton, requestGo, roadText, setPressed, setValueIfIdle, uid, type GoDetail } from './dom';
import { pinId } from './notebook';
import { findWaypoint, type Session } from './session';
import { say } from './strings';

export interface CheckBlockOptions {
  readonly session: Session;
  readonly check: Check;
  /** Where the answer is stored, from `checkKey`. */
  readonly key: string;
  readonly index: number;
  readonly total: number;
  /** The roadmap's language. */
  readonly lang: string;
  /** Store the answer in progress. False in a review sitting, where only the review result is kept. */
  readonly record: boolean;
  readonly stageId: string;
  readonly waypointId?: string;
  /** Called once the learner has a verdict: right or wrong, had it or not yet. */
  readonly onResult?: (ok: boolean) => void;
  readonly onGo?: (detail: GoDetail) => void;
}

export interface CheckBlock {
  readonly root: HTMLElement;
  update(): void;
}

interface LocalState {
  choice?: number;
  text?: string;
  correct?: boolean;
  revealed?: boolean;
}

export function checkBlock(options: CheckBlockOptions): CheckBlock {
  return options.check.options && options.check.options.length > 0 ? choiceCheck(options) : wordsCheck(options);
}

function readState(options: CheckBlockOptions, local: LocalState): LocalState {
  if (!options.record) return local;
  const stored: CheckAnswer | undefined = options.session.progress.answers[options.key];
  if (!stored) return local;
  const saved: LocalState = {
    ...(stored.choice !== undefined ? { choice: stored.choice } : {}),
    ...(stored.text !== undefined ? { text: stored.text } : {}),
    ...(stored.correct !== undefined ? { correct: stored.correct } : {}),
    // A saved guess without a verdict (from the predict question) is not revealed yet.
    revealed: stored.correct !== undefined || stored.choice === undefined,
  };
  // Until there is a verdict, what the learner changes on the page wins over what was saved.
  return saved.correct !== undefined ? saved : { ...saved, ...local };
}

function answerPin(options: CheckBlockOptions): HTMLButtonElement {
  const { session, check } = options;
  const id = pinId('answer', options.key);
  const button = pinButton(say('pin'), say('pinAnswer'));
  button.addEventListener('click', () => {
    if (session.notebook.has(id)) session.unpin(id);
    else {
      session.pin({
        id,
        kind: 'answer',
        text: `${check.q}\n${check.answer}`,
        stageId: options.stageId,
        ...(options.waypointId ? { waypointId: options.waypointId } : {}),
      });
    }
  });
  return button;
}

function sideTrailButton(options: CheckBlockOptions): HTMLButtonElement | null {
  const target = options.check.onMiss;
  if (!target || target === options.waypointId) return null;
  const node = findWaypoint(options.session.roadmap, target);
  if (!node) return null;
  const button = h(
    'button',
    { type: 'button', class: 'zl-btn zl-btn-quiet zl-side-go' },
    say('sideTrailGo'),
    ' ',
    roadText('span', node.waypoint.title, options.lang),
  );
  button.addEventListener('click', () => requestGo(button, { waypointId: target, stageId: node.stage.id }, options.onGo));
  return button;
}

function choiceCheck(options: CheckBlockOptions): CheckBlock {
  const { check, lang, session } = options;
  const choices = check.options ?? [];
  const name = uid('zl-choice');
  let local: LocalState = {};

  const marks: HTMLSpanElement[] = [];
  const inputs: HTMLInputElement[] = [];
  const rows = choices.map((text, i) => {
    const input = h('input', { type: 'radio', name, value: String(i), class: 'zl-radio' });
    const mark = h('span', { class: 'zl-option-mark' });
    inputs.push(input);
    marks.push(mark);
    input.addEventListener('change', () => {
      local = { ...local, choice: i };
      sync();
    });
    return h('label', { class: 'zl-option' }, input, roadText('span', text, lang, { class: 'zl-option-text' }), mark);
  });

  const checkButton = h('button', { type: 'button', class: 'zl-btn' }, say('checkAnswer'));
  const feedback = h('div', { class: 'zl-feedback', 'aria-live': 'polite' });
  const pin = answerPin(options);
  const side = sideTrailButton(options);

  const root = h(
    'fieldset',
    { class: 'zl-check', 'data-kind': check.kind },
    h(
      'legend',
      { class: 'zl-check-legend' },
      h('span', { class: 'zl-label' }, say('questionOf', { n: options.index + 1, total: options.total })),
      roadText('span', check.q, lang, { class: 'zl-q' }),
    ),
    h('div', { class: 'zl-options' }, ...rows),
    h('div', { class: 'zl-row' }, checkButton),
    feedback,
  );

  checkButton.addEventListener('click', () => {
    const choice = readState(options, local).choice ?? local.choice;
    if (choice === undefined) return;
    const correct = choice === check.correct;
    local = { choice, correct, revealed: true };
    if (options.record) session.answer(options.key, { choice, correct });
    sync();
    options.onResult?.(correct);
    feedback.focus({ preventScroll: true });
  });

  let shown = '';
  const sync = (): void => {
    const state = readState(options, local);
    const decided = state.correct !== undefined;
    inputs.forEach((input, i) => {
      input.checked = state.choice === i;
      input.disabled = decided;
    });
    checkButton.disabled = decided || state.choice === undefined;
    checkButton.hidden = decided;
    root.toggleAttribute('data-decided', decided);

    marks.forEach((mark, i) => {
      const words: string[] = [];
      if (decided && i === check.correct) words.push(`✓ ${say('correctMark')}`);
      else if (decided && i === state.choice) words.push(say('yourPick'));
      mark.textContent = words.join(' ');
      mark.parentElement?.toggleAttribute('data-correct', decided && i === check.correct);
      mark.parentElement?.toggleAttribute('data-picked', state.choice === i);
    });

    const signature = decided ? `${state.choice}:${state.correct}` : '';
    if (signature !== shown) {
      shown = signature;
      feedback.replaceChildren();
      if (decided) {
        feedback.setAttribute('tabindex', '-1');
        const right = state.correct === true;
        const correctText = check.correct !== undefined ? choices[check.correct] : undefined;
        feedback.append(
          h('p', { class: 'zl-verdict', 'data-right': right ? 'true' : 'false' }, h('span', { class: 'zl-verdict-mark', 'aria-hidden': 'true' }, right ? '✓' : '✗'), ' ', say(right ? 'right' : 'notThis')),
        );
        if (!right && correctText !== undefined) {
          feedback.append(h('p', { class: 'zl-correct' }, say('answerIs'), ' ', roadText('span', correctText, lang)));
        }
        feedback.append(roadText('p', check.answer, lang, { class: 'zl-explain' }));
        const actions = h('div', { class: 'zl-row' }, pin);
        if (!right && side) actions.append(side);
        feedback.append(actions);
      } else {
        feedback.removeAttribute('tabindex');
      }
    }
    setPressed(pin, session.notebook.has(pinId('answer', options.key)));
  };
  sync();
  return { root, update: sync };
}

function wordsCheck(options: CheckBlockOptions): CheckBlock {
  const { check, lang, session } = options;
  let local: LocalState = {};
  const qId = uid('zl-q');
  const areaId = uid('zl-answer');
  const hintId = uid('zl-hint');

  const area = h('textarea', { id: areaId, class: 'zl-field', rows: 3, maxlength: 2000, 'aria-describedby': hintId });
  area.addEventListener('input', () => {
    local = { ...local, text: area.value };
  });
  const reveal = h('button', { type: 'button', class: 'zl-btn' }, say('reveal'));
  const had = h('button', { type: 'button', class: 'zl-btn zl-btn-choice', 'aria-pressed': 'false' }, say('hadIt'));
  const notYet = h('button', { type: 'button', class: 'zl-btn zl-btn-choice', 'aria-pressed': 'false' }, say('notYet'));
  const pin = answerPin(options);
  const side = sideTrailButton(options);
  const sideRow = side ? h('div', { class: 'zl-row' }, side) : null;
  const modelId = uid('zl-model');
  const feedback = h(
    'div',
    { class: 'zl-feedback', hidden: true, tabindex: -1 },
    h('p', { class: 'zl-label', id: modelId }, say('modelAnswer')),
    roadText('p', check.answer, lang, { class: 'zl-explain', 'aria-describedby': modelId }),
    h('p', { class: 'zl-ask' }, say('didYouHaveIt')),
    h('div', { class: 'zl-row' }, had, notYet, pin),
    sideRow,
  );

  const root = h(
    'div',
    { class: 'zl-check', role: 'group', 'aria-labelledby': qId, 'data-kind': check.kind },
    h('p', { class: 'zl-label' }, say('questionOf', { n: options.index + 1, total: options.total })),
    roadText('p', check.q, lang, { class: 'zl-q', id: qId }),
    h('label', { class: 'zl-field-label', for: areaId }, say('yourAnswer')),
    h('p', { class: 'zl-hint', id: hintId }, say('yourAnswerHint')),
    area,
    h('div', { class: 'zl-row' }, reveal),
    feedback,
  );

  reveal.addEventListener('click', () => {
    local = { ...local, text: area.value, revealed: true };
    if (options.record) session.answer(options.key, { text: area.value });
    sync();
    feedback.focus({ preventScroll: true });
  });
  const mark = (ok: boolean): void => {
    local = { ...local, text: area.value, correct: ok, revealed: true };
    if (options.record) session.answer(options.key, { text: area.value, correct: ok });
    sync();
    options.onResult?.(ok);
  };
  had.addEventListener('click', () => mark(true));
  notYet.addEventListener('click', () => mark(false));

  const sync = (): void => {
    const state = readState(options, local);
    if (state.text !== undefined) setValueIfIdle(area, state.text);
    const revealed = state.revealed === true;
    feedback.hidden = !revealed;
    reveal.hidden = revealed;
    root.toggleAttribute('data-decided', state.correct !== undefined);
    setPressed(had, state.correct === true);
    setPressed(notYet, state.correct === false);
    if (sideRow) sideRow.hidden = state.correct !== false;
    setPressed(pin, session.notebook.has(pinId('answer', options.key)));
  };
  sync();
  return { root, update: sync };
}
