import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetUiLang, setUiLang } from '../i18n';
import { addDays } from '../roadmap/dates';
import type { Roadmap } from '../roadmap/types';
import { campCard } from './camp-card';
import { GO_EVENT, type GoDetail, type MountedCard } from './dom';
import { notebookPanel } from './notebook-panel';
import { paceChoices } from './pace-choices';
import { reviewCard } from './review-card';
import { createSession, type Session } from './session';
import { signpostCard } from './signpost-card';
import { memoryStorage } from './storage';
import { accessibleName, isNativeControl, sampleDraft, sampleRoadmap, tabOrder, throwingStorage } from './testing';
import { predictKey, predictState, waypointCard } from './waypoint-card';

const DAY = '2026-11-16';
let day = DAY;
let sessions: Session[] = [];
let cards: MountedCard[] = [];

function session(roadmap: Roadmap = sampleRoadmap(), storage: Parameters<typeof createSession>[1] = memoryStorage()): Session {
  const s = createSession(roadmap, storage, { clock: () => `${day}T10:00:00.000Z`, saveOnPageHide: false });
  sessions.push(s);
  return s;
}

function put<T extends MountedCard>(card: T): T {
  cards.push(card);
  document.body.append(card.root);
  return card;
}

const $ = <T extends Element = HTMLElement>(root: ParentNode, selector: string): T => {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`nothing matches ${selector}`);
  return found;
};
const $$ = <T extends Element = HTMLElement>(root: ParentNode, selector: string): T[] => [...root.querySelectorAll<T>(selector)];
const button = (root: ParentNode, label: string): HTMLButtonElement => {
  const found = $$<HTMLButtonElement>(root, 'button').find((b) => !b.closest('[hidden]') && (b.textContent ?? '').trim() === label);
  if (!found) throw new Error(`no visible button "${label}"`);
  return found;
};
const sourceLinks = (card: MountedCard): HTMLAnchorElement[] => $$<HTMLAnchorElement>(card.root, '.zl-source-title');

beforeEach(() => {
  day = DAY;
  setUiLang('en', false);
});
afterEach(() => {
  for (const card of cards) {
    card.destroy();
    card.root.remove();
  }
  for (const s of sessions) s.destroy();
  cards = [];
  sessions = [];
  resetUiLang();
});

describe('waypoint card: predict before reading', () => {
  it('stores a written guess before the sources open', () => {
    const s = session();
    const card = put(waypointCard(s, 'moves'));
    expect(predictState(s, 'moves')).toBe('open');
    expect(sourceLinks(card).every((a) => !a.hasAttribute('href'))).toBe(true);
    expect($(card.root, '.zl-sources').hasAttribute('data-locked')).toBe(true);

    // Other actions do not open the sources: only an answer or a skip does.
    s.done('toolchain');
    expect(sourceLinks(card).every((a) => !a.hasAttribute('href'))).toBe(true);

    const order: string[] = [];
    s.subscribe(() => order.push(`answer stored: ${s.progress.answers[predictKey('moves')] !== undefined}, open: ${sourceLinks(card).some((a) => a.hasAttribute('href'))}`));
    const save = button(card.root, 'Save my guess');
    expect(save.disabled).toBe(true);
    const area = $<HTMLTextAreaElement>(card.root, '.zl-predict textarea');
    area.value = 'It does not compile, a was moved';
    area.dispatchEvent(new Event('input'));
    expect(save.disabled).toBe(false);
    save.click();

    expect(s.progress.answers[predictKey('moves')]?.text).toBe('It does not compile, a was moved');
    expect(order[0]).toMatch(/^answer stored: true/);
    expect(predictState(s, 'moves')).toBe('answered');
    expect(sourceLinks(card).every((a) => a.getAttribute('href')?.startsWith('https://'))).toBe(true);
    expect($(card.root, '.zl-guess-text').textContent?.replace(/ /g, ' ')).toBe('It does not compile, a was moved');
  });

  it('"Skip" opens the sources too', () => {
    const s = session();
    const card = put(waypointCard(s, 'moves'));
    button(card.root, 'Skip').click();
    expect(predictState(s, 'moves')).toBe('skipped');
    expect(sourceLinks(card).every((a) => a.hasAttribute('href'))).toBe(true);
    expect($(card.root, '.zl-guess-text').textContent?.replace(/ /g, ' ')).toBe('You skipped the question.');
  });

  it('uses the options of a matching predict check as buttons, and checks the guess after reading', () => {
    const s = session();
    const card = put(waypointCard(s, 'guessing-game'));
    const guesses = $$<HTMLInputElement>(card.root, '.zl-predict input[type=radio]');
    expect(guesses).toHaveLength(3);
    guesses[1]?.click();
    button(card.root, 'Save my guess').click();
    expect(s.progress.answers['w:guessing-game:0']).toMatchObject({ choice: 1 });
    expect(s.progress.answers['w:guessing-game:0']?.correct).toBeUndefined();
    expect(sourceLinks(card)[0]?.getAttribute('href')).toBe('https://doc.rust-lang.org/book/ch02-00-guessing-game-tutorial.html');

    const check = $(card.root, '.zl-checks .zl-check');
    expect($$<HTMLInputElement>(check, 'input[type=radio]')[1]?.checked).toBe(true);
    button(check, 'Check my answer').click();
    expect(s.progress.answers['w:guessing-game:0']?.correct).toBe(true);
    expect($(check, '.zl-verdict').textContent?.replace(/ /g, ' ')).toContain('Right.');
    expect($(check, '.zl-explain').textContent?.replace(/ /g, ' ')).toContain('immutable unless declared with let mut');
    expect($(check, '[data-correct] .zl-option-mark').textContent?.replace(/ /g, ' ')).toContain('correct answer');
  });

  it('explains a wrong pick and names the right one', () => {
    const s = session();
    const card = put(waypointCard(s, 'enums'));
    button(card.root, 'Skip').click();
    const check = $(card.root, '.zl-checks .zl-check');
    $$<HTMLInputElement>(check, 'input[type=radio]')[0]?.click();
    button(check, 'Check my answer').click();
    expect(s.progress.answers['w:enums:0']).toMatchObject({ choice: 0, correct: false });
    expect($(check, '.zl-verdict').textContent?.replace(/ /g, ' ')).toContain('Not this one.');
    expect($(check, '.zl-correct').textContent?.replace(/ /g, ' ')).toContain('Refuses to compile');
    expect($(check, '.zl-explain').textContent?.replace(/ /g, ' ')).toContain('A match must cover every variant');
  });

  it('offers the side trail after a written answer marked "Not yet"', () => {
    const s = session();
    const card = put(waypointCard(s, 'moves'));
    const goes: GoDetail[] = [];
    card.root.addEventListener(GO_EVENT, (event) => goes.push((event as CustomEvent<GoDetail>).detail));
    const check = $(card.root, '.zl-checks .zl-check');
    button(check, 'Show the model answer').click();
    expect($(check, '.zl-explain').textContent?.replace(/ /g, ' ')).toContain('An integer is copied');
    button(check, 'Not yet').click();
    expect(s.progress.answers['w:moves:0']?.correct).toBe(false);
    const side = $$<HTMLButtonElement>(check, '.zl-side-go').find((b) => !b.closest('[hidden]'));
    expect(side?.textContent?.replace(/ /g, ' ')).toContain('Borrowing, by example');
    side?.click();
    expect(goes).toEqual([{ waypointId: 'borrowing-examples', stageId: 'ownership' }]);
  });
});

describe('waypoint card: done, rating and the notebook', () => {
  it('shows the four-step rating after Done and marks the chosen step by more than colour', () => {
    const s = session();
    const card = put(waypointCard(s, 'toolchain'));
    const rating = $(card.root, '.zl-rating');
    expect(rating.hidden).toBe(true);
    $<HTMLInputElement>(card.root, '.zl-done input[type=checkbox]').click();
    expect(s.progress.waypoints.toolchain?.done).toBe(true);
    expect(s.here()?.waypointId).toBe('guessing-game');
    expect(rating.hidden).toBe(false);

    const steps = $$(rating, '.zl-step');
    expect(steps.map((step) => (step.textContent ?? '').replace('✓', '').trim())).toEqual([
      'Saw it',
      'Did it with the guide',
      'Did it alone',
      'Could explain it',
    ]);
    $<HTMLInputElement>(steps[2] as HTMLElement, 'input').click();
    expect(s.progress.waypoints.toolchain?.rating).toBe(3);
    const chosen = steps.filter((step) => step.hasAttribute('data-chosen'));
    expect(chosen).toEqual([steps[2]]);
    // Marked by its checked radio, the tick and a status line in words, not by colour alone.
    expect($<HTMLInputElement>(steps[2] as HTMLElement, 'input').checked).toBe(true);
    expect($(steps[2] as HTMLElement, '.zl-step-tick').textContent?.replace(/ /g, ' ')).toBe('✓');
    expect($(card.root, '.zl-status').textContent?.replace(/ /g, ' ')).toContain('Did it alone');
    expect($(card.root, '.zl-next').textContent?.replace(/ /g, ' ')).toContain('One whole program');
  });

  it('pins and unpins a key point, the task and a link', () => {
    const s = session();
    const card = put(waypointCard(s, 'moves'));
    const pins = $$<HTMLButtonElement>(card.root, '.zl-pin');
    const point = pins.find((p) => p.getAttribute('aria-label') === 'Pin key point 2');
    point?.click();
    expect(s.notebook.get('point:moves:1')).toMatchObject({ kind: 'point', stageId: 'ownership', waypointId: 'moves' });
    expect(point?.getAttribute('aria-pressed')).toBe('true');
    point?.click();
    expect(s.notebook.has('point:moves:1')).toBe(false);
    expect(point?.getAttribute('aria-pressed')).toBe('false');

    pins.find((p) => p.getAttribute('aria-label') === 'Pin the task')?.click();
    pins.find((p) => p.getAttribute('aria-label') === 'Pin link 2')?.click();
    expect(s.notebook.entries.map((e) => e.kind)).toEqual(['task', 'link']);
    expect(s.notebook.get('link:moves:book-ownership-de')?.url).toBe('https://rust-lang-de.github.io/rustbook-de/ch04-01-what-is-ownership.html');
  });

  it('adds a line of the learner own and keeps a private note', () => {
    const s = session();
    const card = put(waypointCard(s, 'moves'));
    const own = $<HTMLInputElement>(card.root, '.zl-own input');
    own.value = 'Moves are like handing over a key.';
    $<HTMLFormElement>(card.root, '.zl-own').dispatchEvent(new Event('submit', { cancelable: true }));
    expect(s.notebook.entries[0]).toMatchObject({ kind: 'own', text: 'Moves are like handing over a key.', waypointId: 'moves' });
    expect(own.value).toBe('');

    const note = $<HTMLTextAreaElement>(card.root, '.zl-private textarea');
    note.value = 'Ask about Rc later.';
    note.dispatchEvent(new Event('change'));
    expect(s.progress.notes.moves).toBe('Ask about Rc later.');
  });

  it('says so when progress is kept in memory only', () => {
    const s = session(sampleRoadmap(), throwingStorage());
    const card = put(waypointCard(s, 'toolchain'));
    const notice = $(card.root, '.zl-notice');
    expect(notice.hidden).toBe(false);
    expect(notice.textContent?.replace(/ /g, ' ')).toContain('Kept for this visit only');
  });

  it('shows a gap line and the status of gated and unverified sources', () => {
    const draft = sampleDraft();
    draft.resources.push(
      { id: 'gated-one', title: 'A paid course', url: 'https://example.org/course', type: 'course', cost: 'paid', price: { amount: 29, currency: 'EUR', seenOn: '2026-11-10' }, lang: 'de', level: 'bronze', why: 'Why it is here.', check: { status: 'gated', on: '2026-11-13', http: 200, note: 'Lessons need an account.' } },
      { id: 'blocked-one', title: 'A blocked page', url: 'https://example.org/blocked', type: 'article', cost: 'free', lang: 'en', level: 'bronze', why: 'Why this one.', check: { status: 'unverified', on: '2026-11-13', http: 403, note: 'Automated access refused.' } },
    );
    draft.stages[0].waypoints[0].resources = ['rust-install', 'gated-one', 'blocked-one'];
    const s = session(draft as Roadmap);
    const card = put(waypointCard(s, 'toolchain'));
    const items = $$(card.root, '.zl-source');
    expect(items.map((i) => i.getAttribute('data-status'))).toEqual(['verified', 'gated', 'unverified']);
    expect($(items[0] as HTMLElement, '.zl-source-line').textContent?.replace(/ /g, ' ')).toBe('Free · about 10 min · opened 13 Nov 2026');
    expect($(items[1] as HTMLElement, '.zl-source-kind').textContent?.replace(/ /g, ' ')).toBe('Alternative · Course · in German');
    expect($(items[1] as HTMLElement, '.zl-source-flag').textContent?.replace(/ /g, ' ')).toContain('Login or paywall');
    expect($(items[1] as HTMLElement, '.zl-source-line').textContent?.replace(/ /g, ' ')).toContain('€29.00, seen on 10 Nov 2026');
    expect($(items[2] as HTMLElement, '.zl-source-flag').textContent?.replace(/ /g, ' ')).toContain('Could not be opened on 13 Nov 2026 (HTTP 403)');

    const gap = put(waypointCard(s, 'read-real-code'));
    expect($(gap.root, '.zl-gap-text').textContent?.replace(/ /g, ' ')).toContain('No source could be verified for this step.');
  });

  it('sets roadmap text as text, in the roadmap language', () => {
    const draft = sampleDraft();
    draft.lang = 'he';
    draft.stages[0].waypoints[0].title = '<img src=x onerror="window.hacked=1"> שלום';
    const s = session(draft as Roadmap);
    const card = put(waypointCard(s, 'toolchain'));
    expect(card.root.querySelector('img')).toBeNull();
    const title = $(card.root, '.zl-title');
    expect(title.textContent?.replace(/ /g, ' ')).toBe('<img src=x onerror="window.hacked=1"> שלום');
    expect(title.getAttribute('lang')).toBe('he');
    expect(title.getAttribute('dir')).toBe('auto');
    expect(card.root.getAttribute('lang')).toBe('en');
  });

  it('hands out its three parts and rebuilds in German', () => {
    const s = session();
    const card = put(waypointCard(s, 'toolchain'));
    expect(Object.values(card.parts).map((p) => p.dataset.part)).toEqual(['note', 'do', 'take']);
    setUiLang('de', false);
    expect(card.root.getAttribute('lang')).toBe('de');
    expect($(card.root, '.zl-done-word').textContent?.replace(/ /g, ' ')).toBe('Erledigt');
    expect(card.parts.take.dataset.part).toBe('take');
  });
});

describe('signpost and camp', () => {
  it('passes the signpost at its share and lists the stage ratings', () => {
    const s = session();
    s.done('structs');
    s.rate('structs', 2);
    const card = put(signpostCard(s, 'shaping-data'));
    const boxes = $$<HTMLInputElement>(card.root, '.zl-arm input[type=checkbox]');
    expect(boxes).toHaveLength(3);
    expect($(card.root, '.zl-meta').textContent?.replace(/ /g, ' ')).toContain('Tick 2 of 3 to pass.');
    boxes[0]?.click();
    expect(card.root.hasAttribute('data-passed')).toBe(false);
    expect($(card.root, '.zl-tally').textContent?.replace(/ /g, ' ')).toBe('1 of 3 ticked. 1 more to pass.');
    boxes[2]?.click();
    expect(s.passed('shaping-data')).toBe(true);
    expect(card.root.hasAttribute('data-passed')).toBe(true);
    expect($(card.root, '.zl-tally').textContent?.replace(/ /g, ' ')).toBe('2 of 3 ticked. Passed. The camp flag is up.');

    const selects = $$<HTMLSelectElement>(card.root, '.zl-rated select');
    expect(selects[0]?.value).toBe('2');
    if (selects[0]) {
      selects[0].value = '4';
      selects[0].dispatchEvent(new Event('change'));
    }
    expect(s.progress.waypoints.structs?.rating).toBe(4);
  });

  it('ticks rungs of the camp ladder', () => {
    const s = session();
    const card = put(campCard(s, 'ownership'));
    const boxes = $$<HTMLInputElement>(card.root, '.zl-rung input[type=checkbox]');
    expect(boxes).toHaveLength(2);
    boxes[0]?.click();
    expect(s.progress.rungs.ownership).toBe(1);
    expect($(card.root, '.zl-tally').textContent?.replace(/ /g, ' ')).toBe('1 of 2 rungs done');
    boxes[1]?.click();
    expect(s.progress.rungs.ownership).toBe(2);
    expect(card.root.hasAttribute('data-complete')).toBe(true);
    expect($$(card.root, '.zl-plain-list li').map((li) => li.textContent)).toContain('Batch file renamer');
  });
});

describe('review card', () => {
  it('runs a sitting of what is due and schedules the next review from the result', () => {
    const s = session();
    s.done('guessing-game');
    day = addDays(DAY, 1);
    const early = put(reviewCard(s, null));
    expect(early.root.textContent?.replace(/ /g, ' ')).toContain('Nothing to review today.');
    expect(early.root.textContent?.replace(/ /g, ' ')).toContain('The next review is on 18 Nov 2026.');

    day = addDays(DAY, 2);
    const card = put(reviewCard(s, null));
    expect($(card.root, '.zl-review-item .zl-sub').textContent?.replace(/ /g, ' ')).toBe('One whole program');
    const radios = $$<HTMLInputElement>(card.root, '.zl-review-item input[type=radio]');
    radios[1]?.click();
    button(card.root, 'Check my answer').click();
    expect(s.progress.waypoints['guessing-game']?.reviews).toEqual([{ on: addDays(DAY, 2), ok: true }]);
    expect(s.progress.waypoints['guessing-game']?.due).toBe(addDays(DAY, 9));
    expect($(card.root, '.zl-outcome').textContent?.replace(/ /g, ' ')).toBe('Remembered. Next time: 25 Nov 2026.');
    // A review does not overwrite the answer the learner gave on the card.
    expect(s.progress.answers['w:guessing-game:0']).toBeUndefined();
  });

  it('brings a missed step back on the first gap', () => {
    const s = session();
    s.done('moves');
    day = addDays(DAY, 2);
    const card = put(reviewCard(s, 'moves'));
    button(card.root, 'Show the model answer').click();
    button(card.root, 'Not yet').click();
    expect(s.progress.waypoints.moves?.due).toBe(addDays(DAY, 4));
    expect($(card.root, '.zl-outcome').textContent?.replace(/ /g, ' ')).toContain('It comes back on 20 Nov 2026');
  });
});

describe('pace choices', () => {
  it('shows the arrival and, when it runs past the date, four ways to fit', () => {
    const s = session();
    const card = put(paceChoices(s));
    expect(card.root.textContent?.replace(/ /g, ' ')).toContain('At 5 h a week you arrive around');
    expect($$(card.root, '.zl-choice')).toHaveLength(0);
    s.replan({ hoursPerWeek: 2 });
    const choices = $$<HTMLButtonElement>(card.root, '.zl-choice');
    expect(choices.map((c) => c.textContent?.replace(/ /g, ' '))).toEqual([
      'Work 3.5 h a week',
      // 2505 minutes at 2 h a week from 16 Nov 2026 is 147 days.
      'Move my date to 12 Apr 2027',
      'Stop at Silver',
      'Leave out the side trails',
    ]);
    expect(card.root.textContent?.replace(/ /g, ' ')).toContain('days after your date.');
    expect(card.root.textContent?.replace(/ /g, ' ')).not.toMatch(/behind/i);
    choices[0]?.click();
    expect(s.plan.hoursPerWeek).toBe(3.5);
    expect($$(card.root, '.zl-choice')).toHaveLength(0);
    button(card.root, 'Back to the original plan').click();
    expect(s.plan).toEqual({});
  });
});

describe('notebook panel', () => {
  it('lists, moves, removes and adds entries', () => {
    const s = session();
    s.pin({ id: 'point:moves:0', kind: 'point', text: 'One owner.', stageId: 'ownership', waypointId: 'moves' });
    s.pin({ id: 'task:moves', kind: 'task', text: 'Write three lines.', stageId: 'ownership', waypointId: 'moves' });
    const card = put(notebookPanel(s));
    expect($(card.root, '.zl-count-line').textContent?.replace(/ /g, ' ')).toBe('2 entries');
    const texts = () => $$(card.root, '.zl-entry-text').map((e) => e.textContent);
    expect(texts()).toEqual(['One owner.', 'Write three lines.']);
    $<HTMLButtonElement>(card.root, '[aria-label="Move entry 1 down"]').click();
    expect(texts()).toEqual(['Write three lines.', 'One owner.']);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Move entry 2 down'.replace('down', 'up'));
    $<HTMLButtonElement>(card.root, '[aria-label="Remove entry 1"]').click();
    expect(texts()).toEqual(['One owner.']);

    const own = $<HTMLInputElement>(card.root, '.zl-own input');
    own.value = 'My own line';
    $<HTMLFormElement>(card.root, '.zl-own').dispatchEvent(new Event('submit', { cancelable: true }));
    expect(s.notebook.entries.at(-1)).toMatchObject({ kind: 'own', text: 'My own line', stageId: 'first-binary', waypointId: 'toolchain' });
  });

  it('shows an empty state and disables the download until something is pinned', () => {
    const s = session();
    const card = put(notebookPanel(s));
    expect($(card.root, '.zl-empty').hidden).toBe(false);
    expect(button(card.root, 'Download as Markdown').disabled).toBe(true);
  });
});

describe('access', () => {
  function everyCard(s: Session): MountedCard[] {
    s.done('guessing-game');
    s.pin({ id: 'point:moves:0', kind: 'point', text: 'One owner.', stageId: 'ownership', waypointId: 'moves' });
    s.pin({ kind: 'link', text: 'Rust book', url: 'https://doc.rust-lang.org/book/', stageId: 'ownership', waypointId: 'moves' });
    day = addDays(DAY, 2);
    return [
      put(waypointCard(s, 'guessing-game')),
      put(waypointCard(s, 'moves')),
      put(signpostCard(s, 'ownership')),
      put(campCard(s, 'ownership')),
      put(reviewCard(s, null)),
      put(paceChoices(s, { always: true })),
      put(notebookPanel(s)),
    ];
  }

  it('uses native controls only, each with an accessible name, in document order', () => {
    const s = session();
    for (const card of everyCard(s)) {
      const order = tabOrder(card.root);
      expect(order.length).toBeGreaterThan(0);
      for (const el of order) {
        expect(isNativeControl(el), `${el.tagName} in ${card.root.className}`).toBe(true);
        expect(accessibleName(el), `${el.outerHTML.slice(0, 120)} in ${card.root.className}`).not.toBe('');
        expect(Number(el.getAttribute('tabindex') ?? 0)).toBeLessThanOrEqual(0);
      }
      // Tab follows the document: what tabOrder returns is in the order the elements appear.
      const all = [...card.root.querySelectorAll('*')];
      const positions = order.map((el) => all.indexOf(el));
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
    }
  });

  it('gives every card a heading that names it and a language', () => {
    const s = session();
    for (const card of everyCard(s)) {
      const labelledby = card.root.getAttribute('aria-labelledby') ?? '';
      expect(document.getElementById(labelledby)?.textContent?.trim()).not.toBe('');
      expect(card.root.getAttribute('lang')).toBe('en');
    }
  });
});
