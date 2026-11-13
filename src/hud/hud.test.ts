import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { missingKeys, resetUiLang, setUiLang } from '../i18n';
import { classPlace, createSession, memoryStorage, type Session } from '../learn';
import { tabOrder } from '../learn/testing';
import { encodeRoadmap } from '../roadmap/share';
import langgraph from '../roadmap/samples/langgraph-for-a-python-dev.json';
import music from '../roadmap/samples/music-theory-for-a-class.json';
import photo from '../roadmap/samples/photography-basics.json';
import { sampleRoadmap } from '../roadmap/testing';
import type { Roadmap } from '../roadmap/types';
import type { ReadoutParts } from '../table/readout';
import { createHudBus, type HudEvent } from './bus';
import { enterLabel, enterState } from './controls';
import { PUBLIC_SITE, fragmentOf, otherSite, readFileText, readLink, roadmapFacts, shareBase, shareUrl, shortcutRows } from './dialogs';
import { words } from './hero';
import { LIST_DOCK_WIDE, createHud, mainVolumes, tableVolumes, walkVolumes, type Hud, type HudOptions } from './hud';
import { NOTE, marksKey, noteWidth, pickNoteSide, sideBox, type MiniMapMark } from './note';
import { shelfSessionOf, usedKey } from './shelf-session';
import { pinLine, type HudRoadmap } from './side-card';
import { HUD_STRINGS, LABEL_BUDGET, say, type HudKey } from './strings';

const DAY = '2026-12-07';
let huds: Hud[] = [];
let sessions: Session[] = [];

function open(roadmap: Roadmap = sampleRoadmap()): Session {
  const session = createSession(roadmap, memoryStorage(), { clock: () => `${DAY}T10:00:00.000Z`, saveOnPageHide: false });
  sessions.push(session);
  return session;
}

function table(roadmap: Roadmap = sampleRoadmap()): HudRoadmap[] {
  return [{ roadmap }, { roadmap: langgraph as unknown as Roadmap, example: true }, { roadmap: photo as unknown as Roadmap, example: true }];
}

function mount(session: Session = open(), options: HudOptions = {}): { hud: Hud; events: HudEvent[]; root: HTMLElement } {
  const root = document.createElement('div');
  document.body.append(root);
  const bus = createHudBus();
  const events: HudEvent[] = [];
  bus.on((event) => {
    if (event.type !== 'insets') events.push(event);
  });
  const hud = createHud(root, session, bus, { reducedMotion: true, ...options });
  huds.push(hud);
  hud.setRoadmaps(table(session.roadmap), 0);
  return { hud, events, root };
}

/** What Tab reaches while a mode is shown: nothing inside a part that is switched off. */
function reachable(root: HTMLElement): HTMLElement[] {
  return tabOrder(root).filter((el) => !el.closest('[inert], [data-off], dialog:not([open])'));
}

function parts(key: string, overrides: Partial<ReadoutParts> = {}): ReadoutParts {
  return {
    sheet: 0,
    hours: 42,
    hoursText: '42',
    totalHours: 42,
    card: null,
    cards: 20,
    stage: null,
    stages: 5,
    tier: null,
    line: '20 cards · 5 stages · to Gold',
    title: 'Zero to Rust, coming from Python',
    lang: 'en',
    key,
    ...overrides,
  };
}

const press = (key: string, target: EventTarget = window, init: KeyboardEventInit = {}): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
};

// The shelf's code is fetched on its own; the first fetch transforms its modules, which can take seconds here.
beforeAll(async () => {
  await import('../shelf');
}, 60_000);

afterEach(() => {
  for (const hud of huds) hud.destroy();
  for (const session of sessions) session.destroy();
  huds = [];
  sessions = [];
  document.body.replaceChildren();
  resetUiLang();
});

describe('strings', () => {
  it('has the same keys and placeholders in both languages', () => {
    expect(missingKeys(HUD_STRINGS)).toEqual([]);
  });

  it('fits every short label into its slot at a 320 px window, in both languages', () => {
    // 10.5 px label face: 0.6 em a glyph plus 0.14 em tracking is 7.8 px a character. A 288 px line holds 37.
    const perChar = 10.5 * (0.6 + 0.14);
    expect(Math.floor(288 / perChar)).toBe(37);
    const vars = { tier: 'Diamant', i: 8, k: 9, n: 9, count: 12, total: 8, day: '13. Nov. 2026', from: '10,5', to: '12,5', percent: 100 };
    const over: string[] = [];
    for (const lang of ['en', 'de'] as const) {
      for (const [key, budget] of Object.entries(LABEL_BUDGET) as [HudKey, number][]) {
        const text = say(key, vars, lang);
        if (text.length > budget) over.push(`${lang} ${key}: "${text}" has ${text.length} of ${budget}`);
        expect(budget).toBeLessThanOrEqual(46);
      }
    }
    expect(over).toEqual([]);
  });

  it('never says the learner is behind', () => {
    for (const lang of ['en', 'de'] as const) {
      for (const value of Object.values(HUD_STRINGS[lang])) {
        const text = typeof value === 'string' ? value : Object.values(value).join(' ');
        expect(text).not.toMatch(/\bbehind\b|\bim Rückstand\b|\bstreak|\bpoints\b|\bbadge/i);
      }
    }
  });
});

describe('readout', () => {
  it('writes to the document only when the readout changed', () => {
    const { hud, root } = mount();
    const number = root.querySelector('.zh-card-number')!;
    const line = root.querySelector('.zh-card-readline')!;
    const before = hud.readoutWrites;

    hud.setReadout(parts('0|12|a', { hoursText: '12' }));
    expect(hud.readoutWrites).toBe(before + 1);
    expect(number.textContent).toBe('12');
    expect(line.textContent).toBe('20 cards · 5 stages · to Gold');

    // The same key a hundred frames in a row touches nothing.
    let mutations = 0;
    const observer = new MutationObserver((list) => (mutations += list.length));
    observer.observe(root.querySelector('.zh-side')!, { subtree: true, childList: true, characterData: true, attributes: true });
    for (let i = 0; i < 100; i++) hud.setReadout(parts('0|12|a', { hoursText: '12' }));
    expect(observer.takeRecords().length + mutations).toBe(0);
    observer.disconnect();
    expect(hud.readoutWrites).toBe(before + 1);

    hud.setReadout(parts('0|42|hover', { hoursText: '42', card: 7, stage: 2, tier: 'silver', line: 'Card 7 of 20 · Stage 2 · Silver · about 11 h', title: 'Ownership' }));
    expect(hud.readoutWrites).toBe(before + 2);
    expect(root.querySelector('.zh-card-readtitle')!.textContent).toBe('Ownership');
    expect(root.querySelector('.zh-card-readtitle')!.getAttribute('lang')).toBe('en');
  });

  it('shows the hours of the roadmap before any readout arrives, and says they are an estimate', () => {
    const { root } = mount();
    expect(root.querySelector('.zh-card-number')!.textContent).toBe('42');
    expect(root.querySelector('.zh-card-unit')!.textContent).toBe('hours · estimate');
    expect(root.querySelector('.zh-card-hours .zh-sr')!.textContent).toBe('about 42 hours, an estimate');
  });
});

describe('focus order', () => {
  const group = (el: HTMLElement): string => {
    if (el.matches('.zh-skip')) return 'skip';
    if (el.matches('.zh-brand')) return 'brand';
    if (el.closest('.zh-nav-slot')) return 'nav';
    if (el.closest('.zh-tools')) return 'tools';
    if (el.matches('.zh-start')) return 'start';
    if (el.closest('.zh-controls')) return 'controls';
    if (el.closest('.zh-side')) return 'side';
    if (el.closest('.zh-note')) return 'note';
    if (el.closest('.zh-profile-host')) return 'profile';
    if (el.closest('.zh-shelf')) return 'shelf';
    return 'other';
  };
  const order = (root: HTMLElement): string[] => {
    const seen: string[] = [];
    for (const el of reachable(root)) {
      const name = group(el);
      if (seen[seen.length - 1] !== name) seen.push(name);
    }
    return seen;
  };

  it('on the table: skip link, brand, nav, tools, start chip, arrows and enter button, side card, shelf', async () => {
    const { hud, root } = mount();
    await hud.whenShelf();
    const tab = document.createElement('button');
    tab.textContent = 'Altitudes';
    hud.navSlot.append(tab);
    expect(order(root)).toEqual(['skip', 'brand', 'nav', 'tools', 'start', 'controls', 'side', 'shelf']);
    const controls = reachable(root).filter((el) => group(el) === 'controls');
    expect(controls.map((el) => el.getAttribute('aria-label') ?? el.textContent)).toEqual(['Previous roadmap', 'Walk this roadmapGo in at the pin', 'Next roadmap']);
  });

  it('in the walk: skip link, brand, tools, the note, the profile, the shelf', async () => {
    const { hud, root } = mount();
    await hud.whenShelf();
    hud.setMode('walk');
    hud.setActive({ kind: 'waypoint', waypointId: 'moves' });
    expect(order(root)).toEqual(['skip', 'brand', 'tools', 'note', 'profile', 'shelf']);
  });

  it('uses native controls with names for everything that can be reached', () => {
    const { hud, root } = mount();
    const check = (): void => {
      for (const el of reachable(root)) {
        expect(['a', 'button', 'input', 'select', 'textarea', 'summary', 'div'].includes(el.tagName.toLowerCase())).toBe(true);
        if (el.tagName === 'DIV') expect(el.getAttribute('role')).toBe('tabpanel');
        if (el.closest('.zl-card, .zt-dock')) continue;
        const name = el.getAttribute('aria-label') ?? el.textContent ?? '';
        expect(name.trim(), el.outerHTML.slice(0, 120)).not.toBe('');
      }
    };
    check();
    hud.setMode('walk');
    hud.setActive({ kind: 'waypoint', waypointId: 'moves' });
    check();
  });

  it('takes the parts of another mode out of the keyboard path', () => {
    const { hud, root } = mount();
    expect(root.querySelector('.zh-note')!.hasAttribute('inert')).toBe(true);
    hud.setMode('walk');
    expect(root.querySelector('.zh-note')!.hasAttribute('inert')).toBe(false);
    expect(root.querySelector('.zh-hero')!.hasAttribute('inert')).toBe(true);
    expect(root.querySelector('.zh-controls')!.hasAttribute('inert')).toBe(true);
    hud.setMode('list');
    expect(root.querySelector('.zh-note')!.hasAttribute('inert')).toBe(true);
    expect(root.querySelector('.zh-profile-host')!.hasAttribute('inert')).toBe(false);
  });
});

describe('the table', () => {
  it('shows the counter as plain text beside the arrows, with no picker', () => {
    const { hud, root } = mount();
    const counter = root.querySelector('.zh-counter')!;
    expect(counter.querySelector('[aria-hidden]')!.textContent).toBe('01 / 03');
    expect(counter.querySelector('.zh-sr')!.textContent).toBe('Roadmap 1 of 3');
    expect(counter.querySelector('button')).toBeNull();
    hud.select(2);
    expect(counter.querySelector('[aria-hidden]')!.textContent).toBe('03 / 03');
  });

  it('follows a switch at once: card, counter, enter button and shelf', async () => {
    const { hud, root } = mount();
    // The shelf's code comes on its own after the first frame's. Once it is there, the shelf follows at once.
    expect(await hud.whenShelf()).toBe(hud.shelf);
    const before = root.querySelector('.zh-shelf')!.innerHTML;
    expect(root.querySelector('.zh-card-title')!.textContent).toBe('Zero to Rust, coming from Python');
    hud.select(1);
    expect(root.querySelector('.zh-card-title')!.textContent).toBe('Zero to LangGraph, coming from Python');
    expect(root.querySelector('.zh-chip-example')!.hasAttribute('hidden')).toBe(false);
    expect(root.querySelector('.zh-enter-title')!.textContent).toBe('Walk this roadmap');
    expect(hud.shelf).not.toBeNull();
    expect(root.querySelector('.zh-shelf')!.innerHTML).not.toBe(before);
  });

  it('asks the director to turn, enter and start, and never does it itself', () => {
    const { hud, events, root } = mount();
    root.querySelector<HTMLButtonElement>('.zh-arrow[data-dir="next"]')!.click();
    root.querySelector<HTMLButtonElement>('.zh-arrow[data-dir="previous"]')!.click();
    root.querySelector<HTMLButtonElement>('.zh-enter')!.click();
    root.querySelector<HTMLButtonElement>('.zh-start')!.click();
    expect(events).toEqual([
      { type: 'turn', step: 1, by: 'arrow' },
      { type: 'turn', step: -1, by: 'arrow' },
      { type: 'enter', reviews: false },
      { type: 'start' },
    ]);
    expect(hud.mode).toBe('table');
    expect(hud.selected).toBe(0);
  });

  it('labels the enter button by state', () => {
    expect(enterLabel(enterState(false, 0, 5, 0))).toEqual({ title: 'Walk this roadmap', sub: 'Go in at the pin' });
    expect(enterLabel(enterState(true, 1, 5, 0))).toEqual({ title: 'Continue', sub: 'You are at stage 2' });
    expect(enterLabel(enterState(true, 1, 5, 2))).toEqual({ title: '2 reviews due', sub: 'Start there' });
    expect(enterLabel(enterState(true, 1, 5, 1)).title).toBe('1 review due');
    expect(enterLabel(enterState(true, 5, 5, 0)).sub).toBe('The route is walked');
  });

  it('moves the enter button and the pin line with progress', () => {
    const session = open();
    const { root } = mount(session);
    expect(root.querySelector('.zh-card-pin')!.textContent).toBe('The pin stands at the gate');
    for (const wp of session.roadmap.stages[0]!.waypoints) session.done(wp.id);
    expect(root.querySelector('.zh-card-pin')!.textContent).toBe('The pin stands in stage 2');
    expect(root.querySelector('.zh-enter-title')!.textContent).toBe('Continue');
    expect(root.querySelector('.zh-enter-sub')!.textContent).toBe('You are at stage 2');
    expect(pinLine({ roadmap: session.roadmap, progress: session.progress })).toBe('The pin stands in stage 2');
  });

  it('uses the opened roadmap title as the headline, and the site line for the gallery', () => {
    const { hud, root } = mount();
    const headline = root.querySelector('.zh-headline')!;
    expect(headline.textContent).toBe('Zero to Rust, coming from Python');
    expect(headline.getAttribute('lang')).toBe('en');
    hud.setRoadmaps(table().map((entry) => ({ ...entry, example: true })), 0);
    expect(headline.textContent).toBe('Any topic, from zero to the summit.');
    expect(headline.querySelector('em')!.textContent).toBe('summit');
  });
});

describe('keys', () => {
  it('turns the table with Left and Right and goes in with Enter', () => {
    const { events } = mount();
    press('ArrowRight');
    press('ArrowLeft');
    press('Enter', document.body);
    expect(events).toEqual([
      { type: 'turn', step: 1, by: 'key' },
      { type: 'turn', step: -1, by: 'key' },
      { type: 'enter', reviews: false },
    ]);
  });

  it('steps, ticks Done and folds the map in the walk', () => {
    const session = open();
    const { hud, events } = mount(session);
    hud.setMode('walk');
    hud.setActive({ kind: 'waypoint', waypointId: 'moves' });
    press('ArrowRight');
    press('d');
    expect(session.progress.waypoints.moves?.done).toBe(true);
    press('D');
    expect(session.progress.waypoints.moves?.done).toBe(false);
    press('Escape');
    press('l');
    expect(events).toEqual([{ type: 'step', step: 1 }, { type: 'fold' }, { type: 'mode', mode: 'list' }]);
  });

  it('leaves keys alone inside a field and with a modifier', () => {
    const { events, root } = mount();
    const field = document.createElement('input');
    root.append(field);
    press('ArrowRight', field);
    press('l', field);
    press('l', window, { ctrlKey: true });
    expect(events).toEqual([]);
  });

  it('opens the shortcut list with the question mark and the notebook with N', () => {
    const { root } = mount();
    press('?');
    const list = root.querySelector<HTMLDialogElement>('dialog[data-panel="shortcuts"]')!;
    expect(list.open).toBe(true);
    expect(list.textContent).toContain('Turn the table');
    // While a panel is open the page shortcuts rest.
    press('n');
    expect(root.querySelector('dialog[data-panel="notebook"]')).toBeNull();
    list.close();
    press('n');
    expect(root.querySelector<HTMLDialogElement>('dialog[data-panel="notebook"]')!.open).toBe(true);
  });

  it('lists every key of both views', () => {
    const rows = shortcutRows();
    expect(rows.table.map((row) => row[0])).toEqual(['Left, Right', 'Enter, Space', 'Escape', 'L', 'N', 'B', '?']);
    expect(rows.walk.map((row) => row[0])).toEqual(['Left, Right', 'D', 'Escape', 'L', 'N', 'B', '?']);
  });
});

describe('opening a roadmap from outside', () => {
  it('shows the counts and applies nothing until the visitor confirms', async () => {
    const { hud, events, root } = mount();
    const incoming = music as unknown as Roadmap;
    hud.preview(incoming, 'link');
    const dialog = root.querySelector<HTMLDialogElement>('dialog[data-panel="open"]')!;
    expect(dialog.open).toBe(true);
    const facts = roadmapFacts(incoming);
    const shown = [...dialog.querySelectorAll('.zh-fact')].map((row) => [row.querySelector('dt')!.textContent, row.querySelector('dd')!.textContent]);
    expect(shown).toEqual([
      ['Stages', String(facts.stages)],
      ['Steps', String(facts.steps)],
      ['Time', expect.stringMatching(/^about /)],
      ['Sources', String(facts.sources)],
      ['Links opened on', expect.stringContaining('2026')],
      ['Goes up to', 'Gold'],
      ['Language', 'EN'],
    ]);
    expect(dialog.textContent).toContain(incoming.title);

    // Seen, not applied: the table, the session and the bus are untouched.
    expect(events).toEqual([]);
    expect(hud.session.roadmap.id).toBe('rust-for-a-python-dev');
    expect(root.querySelector('.zh-card-title')!.textContent).toBe('Zero to Rust, coming from Python');

    dialog.querySelector<HTMLButtonElement>('[data-action="back"]')!.click();
    expect(events).toEqual([]);
    expect(dialog.querySelector('input[type="text"]')).not.toBeNull();

    hud.preview(incoming, 'file', 'music.json');
    expect(dialog.textContent).toContain('From the file music.json');
    dialog.querySelector<HTMLButtonElement>('[data-action="apply"]')!.click();
    expect(events).toEqual([{ type: 'open', roadmap: incoming, source: 'file' }]);
    expect(dialog.open).toBe(false);
  });

  it('closing the preview applies nothing', () => {
    const { hud, events, root } = mount();
    hud.preview(music as unknown as Roadmap, 'link');
    expect(hud.closePanel()).toBe(true);
    expect(root.querySelector<HTMLDialogElement>('dialog[data-panel="open"]')!.open).toBe(false);
    expect(events).toEqual([]);
  });

  it('reads a link, a bare fragment and a file, and refuses what is not a roadmap', async () => {
    const roadmap = sampleRoadmap();
    const fragment = await encodeRoadmap(roadmap);
    expect(fragmentOf(`https://example.org/#r=${fragment}`)).toBe(fragment);
    expect(fragmentOf(`r=${fragment}`)).toBe(fragment);
    expect(fragmentOf(fragment)).toBe(fragment);
    expect(fragmentOf('https://example.org/')).toBeNull();

    const fromLink = await readLink(`https://example.org/page#r=${fragment}`);
    expect(fromLink.ok && fromLink.roadmap.id).toBe(roadmap.id);
    expect(await readLink('   ')).toMatchObject({ ok: false, lang: 'ui' });
    expect(await readLink('https://example.org/')).toMatchObject({ ok: false, error: say('openNotLink') });
    expect(await readLink('#r=z1.AAAA')).toMatchObject({ ok: false, lang: 'en' });

    const fromFile = readFileText(JSON.stringify(roadmap), 'rust.json');
    expect(fromFile.ok && fromFile.source).toBe('file');
    expect(readFileText('{ not json', 'x.json')).toMatchObject({ ok: false, error: say('openBadFile') });
    const broken = readFileText(JSON.stringify({ ...roadmap, stages: [] }), 'x.json');
    expect(broken.ok).toBe(false);
    expect(!broken.ok && broken.issues.length).toBeGreaterThan(0);
  });

  it('says in the share dialog that progress never travels', async () => {
    const { hud, root } = mount(open(), { shareBase: 'https://example.org/' });
    hud.openPanel('share');
    const dialog = root.querySelector<HTMLDialogElement>('dialog[data-panel="share"]')!;
    expect(dialog.textContent).toContain('They are never part of a link.');
    const field = dialog.querySelector<HTMLInputElement>('input')!;
    await expect.poll(() => field.value).toMatch(/^https:\/\/example\.org\/#r=[zj]1\./);
    const back = await readLink(field.value);
    expect(back.ok && back.roadmap.id).toBe('rust-for-a-python-dev');
    expect(field.value).not.toContain('progress');
  });
});

describe('the floating note', () => {
  it('hosts the step card on three tabs and shows one part at a time', () => {
    const { hud, root } = mount();
    hud.setMode('walk');
    hud.setActive({ kind: 'waypoint', waypointId: 'moves' });
    const note = root.querySelector<HTMLElement>('.zh-note')!;
    expect(note.querySelector('.zh-note-title')!.textContent).toBe('Who owns the value');
    expect(note.querySelector('.zh-note-title')!.getAttribute('aria-live')).toBe('polite');
    expect(note.querySelectorAll('[aria-live="polite"]').length).toBeGreaterThanOrEqual(1);
    expect(note.querySelector('.zh-ribbon-hour')!.textContent).toMatch(/^Hour [\d.]+$/);
    expect(note.querySelector('.zh-ribbon-kick')!.textContent).toBe('Stage 2 · step 1 of 4');

    const tabs = [...note.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Note', 'Do', 'Take with you']);
    expect(note.dataset.tab).toBe('note');
    // The whole card is there: the predict question, the task, the key points to pin.
    expect(note.querySelector('[data-part="note"] .zl-predict')).not.toBeNull();
    expect(note.querySelector('[data-part="do"] .zl-task')).not.toBeNull();
    expect(note.querySelectorAll('[data-part="take"] .zl-pin').length).toBeGreaterThanOrEqual(4);

    tabs[2]!.click();
    expect(note.dataset.tab).toBe('take');
    expect(tabs[2]!.getAttribute('aria-selected')).toBe('true');
    expect(tabs[0]!.tabIndex).toBe(-1);
    expect(note.querySelector('[role="tabpanel"]')!.getAttribute('aria-labelledby')).toBe(tabs[2]!.id);
  });

  it('pins a key point from the note into the notebook, and the toolbar counts it', () => {
    const session = open();
    const { hud, root } = mount(session);
    hud.setMode('walk');
    hud.setActive({ kind: 'waypoint', waypointId: 'moves' });
    expect(root.querySelector<HTMLElement>('.zh-tool-count')!.hidden).toBe(true);
    root.querySelector<HTMLButtonElement>('[data-part="take"] .zl-pin')!.click();
    expect(session.notebook.size).toBe(1);
    expect(session.notebook.entries[0]!.kind).toBe('point');
    expect(root.querySelector<HTMLElement>('.zh-tool-count')!.textContent).toBe('1');
    expect(root.querySelector('[data-tool="notebook"]')!.getAttribute('aria-label')).toBe('Notebook, 1 entry');
  });

  it('opens a new step on its note tab, and shows signposts and camps without tabs', () => {
    const { hud, root } = mount();
    hud.setMode('walk');
    hud.setActive({ kind: 'waypoint', waypointId: 'moves' });
    hud.note.setTab('do');
    hud.setActive({ kind: 'signpost', stageId: 'ownership' });
    const note = root.querySelector<HTMLElement>('.zh-note')!;
    expect(note.dataset.kind).toBe('signpost');
    expect(note.querySelector<HTMLElement>('[role="tablist"]')!.hidden).toBe(true);
    expect(note.querySelector('.zh-note-title')!.textContent).toBe('Ownership ridge');
    expect(note.querySelector('.zh-ribbon-kick')!.textContent).toBe('Stage 2 · signpost');
    hud.setActive({ kind: 'camp', stageId: 'ownership' });
    expect(note.querySelector('.zl-camp')).not.toBeNull();
    hud.setActive({ kind: 'waypoint', waypointId: 'borrowing-examples' });
    expect(note.dataset.tab).toBe('note');
    hud.setActive(null);
    expect(note.hasAttribute('data-empty')).toBe(true);
  });

  it('asks the director to go when a card or a step arrow asks', () => {
    const { hud, events, root } = mount();
    hud.setMode('walk');
    hud.setActive({ kind: 'waypoint', waypointId: 'moves' });
    root.querySelector<HTMLButtonElement>('.zh-note-step[data-step="next"]')!.click();
    expect(events).toEqual([{ type: 'step', step: 1 }]);
  });

  it('hangs at the emptier side and never over the walker', () => {
    const viewport = { width: 1440, height: 900 };
    expect(noteWidth(1440)).toBe(340);
    expect(noteWidth(1024)).toBeCloseTo(296.96, 2);
    const left = sideBox('left', viewport, 500);
    const right = sideBox('right', viewport, 500);
    expect(left.left).toBe(NOTE.margin);
    expect(left.top).toBe(NOTE.top);
    expect(right.left + right.width).toBe(1440 - NOTE.margin);

    const sign = { x: 200, y: 300, weight: 40 };
    const route = [1, 2, 3].map((i) => ({ x: 1150 + i * 40, y: 300, weight: 6 }));
    expect(pickNoteSide([sign, ...route], viewport, 500)).toBe('right');
    expect(pickNoteSide(route, viewport, 500)).toBe('left');
    // A tie keeps the side it is on.
    expect(pickNoteSide([], viewport, 500, 'right')).toBe('right');
    expect(pickNoteSide([], viewport, 500, 'left')).toBe('left');
    // The walker decides against everything else.
    expect(pickNoteSide(route, viewport, 500, 'left', { x: 200, y: 300 })).toBe('right');
    expect(pickNoteSide([sign], viewport, 500, 'right', { x: 1200, y: 400 })).toBe('left');
  });
});

describe('the shelf', () => {
  it('shows the main source of every stage on the table, then the stage of you-are-here', () => {
    const session = open();
    const roadmap = session.roadmap;
    const mains = mainVolumes(roadmap);
    expect(mains.length).toBeGreaterThan(0);
    expect(mains.length).toBeLessThanOrEqual(roadmap.stages.length);
    expect(mains.every((entry) => entry.main)).toBe(true);
    expect(tableVolumes(roadmap, session.progress)).toEqual(mains);
    for (const wp of roadmap.stages[0]!.waypoints) session.done(wp.id);
    const second = tableVolumes(roadmap, session.progress);
    const stageTwo = new Set(roadmap.stages[1]!.waypoints.map((w) => w.id));
    expect(second.every((entry) => stageTwo.has(entry.for) || entry.for === 'project')).toBe(true);
  });

  it('shows the sources of the step the walker stands on in the walk', () => {
    const roadmap = sampleRoadmap();
    const step = roadmap.stages[1]!.waypoints[0]!;
    const volumes = walkVolumes(roadmap, { kind: 'waypoint', waypointId: step.id }, 'ownership');
    expect(volumes.map((entry) => entry.resource.id)).toEqual([...step.resources]);
    expect(volumes[0]!.main).toBe(true);
    expect(walkVolumes(roadmap, { kind: 'signpost', stageId: 'ownership' }, 'ownership').length).toBeGreaterThan(volumes.length);
    expect(walkVolumes(roadmap, null, null)).toEqual([]);
  });

  it('keeps "used", pins and notes of a volume in the learning session', () => {
    const session = open();
    const shelf = shelfSessionOf(session);
    const step = session.roadmap.stages[1]!.waypoints[0]!;
    const id = step.resources[0]!;
    let heard = 0;
    shelf.subscribe?.(() => (heard += 1));

    expect(shelf.isUsed(id)).toBe(false);
    shelf.setUsed(id, true);
    expect(shelf.isUsed(id)).toBe(true);
    expect(session.progress.answers[usedKey(id)]?.correct).toBe(true);
    shelf.setUsed(id, false);
    expect(shelf.isUsed(id)).toBe(false);

    shelf.pin({ kind: 'link', resourceId: id, text: 'A book: why', url: 'https://example.org/', stageId: 'ownership', waypointId: step.id });
    expect(shelf.isPinned(id)).toBe(true);
    // The same id the step card gives the link, so both show it as pinned.
    expect(session.notebook.has(`link:${step.id}:${id}`)).toBe(true);
    shelf.unpin(id);
    expect(shelf.isPinned(id)).toBe(false);

    shelf.setNote(id, 'read chapter 4 first');
    expect(shelf.note(id)).toBe('read chapter 4 first');
    expect(heard).toBeGreaterThanOrEqual(5);
  });

  it('fetches its code on its own: the overlay names the shelf only as a type and in a dynamic import', () => {
    for (const file of ['hud.ts', 'shelf-session.ts', 'index.ts']) {
      const source = readFileSync(join(import.meta.dirname, file), 'utf8');
      const statics = [...source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+'\.\.\/(?:shelf|bookshelf)[^']*';/gms)].map((m) => m[0]);
      expect(statics, file).toEqual([]);
    }
    expect(readFileSync(join(import.meta.dirname, 'hud.ts'), 'utf8')).toContain("import('../shelf')");
  });

  it('stands once its code has arrived, and B then focuses it', async () => {
    const { hud, root } = mount();
    const dock = await hud.whenShelf();
    expect(dock).not.toBeNull();
    expect(hud.shelf).toBe(dock);
    expect(root.querySelector('.zh-shelf .zt-dock')).not.toBeNull();
    const focus = vi.spyOn(dock!, 'focus');
    press('b');
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('folds into its round button in the list view, where the full shelf would stand over the reading column', async () => {
    const { hud, root } = mount();
    await hud.whenShelf();
    const form = (): string | undefined => root.querySelector<HTMLElement>('.zh-shelf .zt-dock')?.dataset.mode;
    // The window of the test is wider than a phone and narrower than LIST_DOCK_WIDE.
    expect(window.innerWidth).toBeLessThan(LIST_DOCK_WIDE);
    expect(window.innerWidth).toBeGreaterThan(760);
    expect(form()).toBe('dock');
    hud.setMode('list');
    expect(form()).toBe('phone');
    hud.setMode('walk');
    hud.setActive({ kind: 'waypoint', waypointId: 'moves' });
    expect(form()).toBe('dock');
  });
});

describe('share links', () => {
  const page = (url: string): { protocol: string; origin: string; pathname: string } => {
    const at = new URL(url);
    return { protocol: at.protocol, origin: at.origin, pathname: at.pathname };
  };

  it('go to the site root from a prerendered roadmap page and the gallery, which read their own roadmap first', () => {
    expect(shareBase(page('http://127.0.0.1:5236/roadmaps/rust-for-a-python-dev/'), true)).toBe('http://127.0.0.1:5236/');
    expect(shareBase(page('https://othmanadi.github.io/zero-to/roadmaps/rust-for-a-python-dev/index.html'), true)).toBe('https://othmanadi.github.io/zero-to/');
    expect(shareBase(page('https://othmanadi.github.io/zero-to/gallery/'), false)).toBe('https://othmanadi.github.io/zero-to/');
  });

  it('go to the public site from a file on a computer, or from another page with its own roadmap', () => {
    expect(PUBLIC_SITE).toBe('https://othmanadi.github.io/zero-to/');
    expect(shareBase(page('file:///C:/roadmaps/rust.html'), true)).toBe(PUBLIC_SITE);
    expect(shareBase(page('file:///home/someone/zero-to.html'), false)).toBe(PUBLIC_SITE);
    expect(shareBase(page('https://example.org/notes/rust.html'), true)).toBe(PUBLIC_SITE);
  });

  it('stay on any other page, without its query', () => {
    expect(shareBase(page('https://othmanadi.github.io/zero-to/?road=photography-basics&ui=de&still'), false)).toBe('https://othmanadi.github.io/zero-to/');
    expect(shareBase(page('http://127.0.0.1:5247/'), false)).toBe('http://127.0.0.1:5247/');
    expect(shareUrl('z1.abc', 'http://127.0.0.1:5247/')).toBe('http://127.0.0.1:5247/#r=z1.abc');
  });

  it('name the other site in the dialog when the link opens there', async () => {
    expect(otherSite(PUBLIC_SITE, { origin: 'null' })).toBe('othmanadi.github.io/zero-to');
    expect(otherSite('https://othmanadi.github.io/zero-to/', { origin: 'https://othmanadi.github.io' })).toBeNull();
    const { hud, root } = mount(open(), { shareBase: PUBLIC_SITE });
    hud.setMode('walk');
    hud.openPanel('share');
    const dialog = root.querySelector<HTMLDialogElement>('dialog[data-panel="share"]')!;
    expect(dialog.querySelector('[data-share-site]')!.textContent).toBe('The link opens the roadmap on othmanadi.github.io/zero-to.');
    const field = dialog.querySelector<HTMLInputElement>('input')!;
    await expect.poll(() => field.value).toMatch(/^https:\/\/othmanadi\.github\.io\/zero-to\/#r=[zj]1\./);
  });
});

describe('modes, language and insets', () => {
  it('shows the tools that belong to a view', () => {
    const { hud, root } = mount();
    const shown = (): string[] => [...root.querySelectorAll<HTMLElement>('.zh-tools .zh-tool')].filter((tool) => !tool.hidden).map((tool) => tool.dataset.tool ?? '');
    expect(shown()).toEqual(['list', 'open', 'help']);
    expect(root.querySelector<HTMLElement>('.zh-start')!.hidden).toBe(false);
    hud.setMode('walk');
    expect(shown()).toEqual(['list', 'notebook', 'share', 'fold', 'help']);
    expect(root.querySelector<HTMLElement>('.zh-start')!.hidden).toBe(true);
    hud.setMode('list');
    expect(shown()).toEqual(['map', 'notebook', 'share', 'help']);
    expect(root.querySelector('[data-tool="map"]')!.getAttribute('aria-label')).toBe('Map view');
  });

  it('keeps the whole name on the start chip and has a one-word label for a narrow window', () => {
    const { root } = mount();
    const chip = root.querySelector<HTMLButtonElement>('.zh-start')!;
    const short = chip.querySelector<HTMLElement>('.zh-start-short')!;
    expect(chip.getAttribute('aria-label')).toBe('Start a roadmap');
    expect(chip.querySelector('.zh-start-long')!.textContent).toBe('Start a roadmap');
    expect(short.textContent).toBe('Start');
    expect(short.getAttribute('aria-hidden')).toBe('true');
    setUiLang('de', false);
    expect(chip.getAttribute('aria-label')).toBe('Roadmap starten');
    expect(short.textContent).toBe('Starten');
    // The words a speaking visitor sees are part of the name (WCAG 2.5.3).
    for (const lang of ['en', 'de'] as const) {
      expect(say('startChip', {}, lang).toLowerCase()).toContain(say('startChipShort', {}, lang).toLowerCase());
    }
  });

  it('offers the teacher view only when the roadmap has a class or teacher notes', () => {
    const { hud, events, root } = mount(open(music as unknown as Roadmap));
    hud.setMode('walk');
    const teacher = root.querySelector<HTMLButtonElement>('[data-tool="teacher"]')!;
    expect(teacher.hidden).toBe(false);
    teacher.click();
    expect(teacher.getAttribute('aria-pressed')).toBe('true');
    expect(events).toEqual([{ type: 'teacher', on: true }]);
  });

  it('switches every word to German', () => {
    const session = open();
    const { hud, root } = mount(session);
    for (const wp of session.roadmap.stages[0]!.waypoints) session.done(wp.id);
    setUiLang('de', false);
    expect(root.querySelector('.zh-start')!.textContent).toContain('Roadmap starten');
    expect(root.querySelector('.zh-card-pin')!.textContent).toBe('Die Nadel steht in Etappe 2');
    expect(root.querySelector('.zh-enter-title')!.textContent).toBe('Weitergehen');
    expect(root.querySelector('.zh-arrow[data-dir="next"]')!.getAttribute('aria-label')).toBe('Nächste Roadmap');
    expect(root.querySelector('.zh-counter .zh-sr')!.textContent).toBe('Roadmap 1 von 3');
    hud.setMode('walk');
    hud.setActive({ kind: 'waypoint', waypointId: 'moves' });
    expect([...root.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual(['Notiz', 'Aufgabe', 'Mitnehmen']);
    expect(root.querySelector('.zh-ribbon-kick')!.textContent).toBe('Etappe 2 · Schritt 1 von 4');
    // Roadmap text keeps its own language.
    expect(root.querySelector('.zh-note-title')!.getAttribute('lang')).toBe('en');
  });

  it('takes a new session when another roadmap is entered', () => {
    const { hud, root } = mount();
    const next = open(photo as unknown as Roadmap);
    hud.setSession(next);
    hud.setMode('walk');
    hud.setActive({ kind: 'waypoint', waypointId: next.roadmap.stages[0]!.waypoints[0]!.id });
    expect(hud.session).toBe(next);
    expect(root.querySelector('.zh-note-title')!.textContent).toBe(next.roadmap.stages[0]!.waypoints[0]!.title);
    expect(root.querySelectorAll('button.zh-mark-camp')).toHaveLength(2);
  });

  it('reports insets as pixels and as a screen box', () => {
    const { hud } = mount();
    const insets = hud.setInsets();
    expect(insets.viewport.width).toBe(window.innerWidth);
    expect(insets.box.x0).toBe(-1);
    expect(insets.box.x1).toBe(1);
    expect(insets.box.y1).toBeLessThanOrEqual(1);
    expect(Object.keys(insets.parts)).toEqual(['header', 'headline', 'hero', 'side', 'shelf', 'note', 'profile']);
  });
});

describe('the mini map', () => {
  const marks = (dx = 0): MiniMapMark[] => [
    { id: 'moves', x: 100 + dx, y: 80, title: 'Who owns the value' },
    { id: 'borrow', x: 220 + dx, y: 120, title: 'Borrowing' },
  ];

  it('builds its dots again only when what they show changed, and a focused dot keeps the focus', () => {
    const { hud, root } = mount();
    hud.setMode('walk');
    hud.setActive({ kind: 'waypoint', waypointId: 'moves' });
    const canvas = document.createElement('canvas');
    canvas.width = 560;
    canvas.height = 300;
    const dots = (): HTMLButtonElement[] => [...root.querySelectorAll<HTMLButtonElement>('.zh-minimap-dot')];
    hud.setMiniMap(canvas, { x: 10, y: 10 }, marks());
    const first = dots();
    expect(first.map((dot) => dot.dataset.waypoint)).toEqual(['moves', 'borrow']);
    // The walker moves, and the walk hands over a new list of the same marks each time.
    for (let i = 0; i < 20; i++) hud.setMiniMap(canvas, { x: 10 + i, y: 10 }, marks());
    expect(dots().every((dot, i) => dot === first[i])).toBe(true);
    first[1]!.focus();
    expect(document.activeElement).toBe(first[1]);
    // The marks themselves move: the dots are built again and the focus stays on the same step.
    hud.setMiniMap(canvas, { x: 40, y: 10 }, marks(5));
    const second = dots();
    expect(second[1]).not.toBe(first[1]);
    expect(document.activeElement).toBe(second[1]);
    expect(marksKey(marks())).toBe(marksKey(marks().map((mark) => ({ ...mark }))));
    expect(marksKey(marks())).not.toBe(marksKey(marks(1)));
  });
});

describe('the style sheet', () => {
  it('resets buttons with zero specificity, so the class rules of a card or a volume in the overlay win', () => {
    const css = readFileSync(join(import.meta.dirname, 'hud.css'), 'utf8');
    expect(css).toMatch(/^:where\(\.zh-hud button\) \{[^}]*color: inherit;/m);
    expect(css).not.toMatch(/\.zh-hud :where\(button\)/);
  });
});

describe('headline words', () => {
  it('keeps punctuation with its word and never cuts a joined script into letters', () => {
    expect(words('Any topic, from zero', 'en').filter((w) => !w.space).map((w) => w.text)).toEqual(['Any', 'topic,', 'from', 'zero']);
    expect(words('Deutsch A1 von null', 'de').filter((w) => !w.space)).toHaveLength(4);
    const arabic = words('من الصفر إلى القمة', 'ar').filter((w) => !w.space);
    expect(arabic).toHaveLength(4);
    expect(arabic.map((w) => w.text).join(' ')).toBe('من الصفر إلى القمة');
  });
});

describe('the class flag on the strip', () => {
  /** The gallery roadmap for a class with a date on each session: Monday and Thursday from the given Monday. */
  function dated(firstMonday: string): Roadmap {
    const copy = structuredClone(music) as unknown as { class: { sessions: { date?: string }[] } };
    let day = Date.parse(`${firstMonday}T00:00:00Z`);
    copy.class.sessions.forEach((session, index) => {
      session.date = new Date(day).toISOString().slice(0, 10);
      day += (index % 2 === 0 ? 3 : 4) * 86_400_000;
    });
    return copy as unknown as Roadmap;
  }

  it('is not shown for the gallery roadmap, whose sessions carry no date', () => {
    const { hud, root } = mount(open(music as unknown as Roadmap));
    hud.setMode('walk');
    expect(root.querySelector<HTMLElement>('.zh-mark-class')!.hidden).toBe(true);
  });

  it('stands after the steps of the latest session dated today or earlier and names that session', () => {
    const roadmap = dated('2026-11-16');
    const session = open(roadmap);
    const { hud, root } = mount(session);
    hud.setMode('walk');
    const flag = root.querySelector<HTMLElement>('.zh-mark-class')!;
    // The seventh session is on the day of the test, 7 December.
    const place = classPlace(roadmap, session.trek, DAY)!;
    expect(place.session.n).toBe(7);
    expect(place.session.date).toBe(DAY);
    expect(flag.hidden).toBe(false);
    expect(parseFloat(flag.style.left)).toBeCloseTo(place.along * 100, 1);
    expect(flag.getAttribute('aria-label')).toBe(`The class is here: session 7, ${place.session.title}`);
    // It stands on the route between the step the class has done and the next one.
    const done = session.trek.waypoints.find((wp) => wp.id === place.waypointId)!;
    const next = session.trek.waypoints[session.trek.waypoints.indexOf(done) + 1]!;
    expect(place.along).toBeGreaterThan(done.along);
    expect(place.along).toBeLessThan(next.along);
    // Progress of the learner does not move it: it is the class's place, not theirs.
    session.done(session.roadmap.stages[0]!.waypoints[0]!.id);
    expect(parseFloat(flag.style.left)).toBeCloseTo(place.along * 100, 1);
  });

  it('is not shown before the first session', () => {
    const { hud, root } = mount(open(dated('2026-12-14')));
    hud.setMode('walk');
    expect(root.querySelector<HTMLElement>('.zh-mark-class')!.hidden).toBe(true);
  });
});

describe('the swap of the note', () => {
  const titleOf = (root: HTMLElement): string => root.querySelector('.zh-note-title')!.textContent ?? '';
  const hasCard = (root: HTMLElement): boolean => root.querySelector('.zh-note-body .zl-card') !== null;

  it('keeps the step that was there until the sheet has turned away, then shows the next one at once', () => {
    vi.useFakeTimers();
    try {
      const { hud, root } = mount(open(), { reducedMotion: false });
      hud.setMode('walk');
      const note = root.querySelector<HTMLElement>('.zh-note')!;
      // The first step comes in on a sheet that turns down. Nothing was there before, so nothing turns away.
      hud.setActive({ kind: 'waypoint', waypointId: 'moves' });
      expect(titleOf(root)).toBe('Who owns the value');
      expect(note.classList.contains('is-out')).toBe(false);
      expect(note.classList.contains('is-in')).toBe(true);
      vi.advanceTimersByTime(NOTE.turn + 60);
      expect(note.classList.contains('is-in')).toBe(false);

      hud.setActive({ kind: 'waypoint', waypointId: 'borrowing' });
      // The walker has a new step, the note still shows the whole old one while the sheet turns away.
      expect(hud.note.item).toEqual({ kind: 'waypoint', waypointId: 'borrowing' });
      expect(note.classList.contains('is-out')).toBe(true);
      expect(titleOf(root)).toBe('Who owns the value');
      expect(hasCard(root)).toBe(true);
      expect(root.querySelector('.zh-ribbon-hour')!.textContent).not.toBe('');
      vi.advanceTimersByTime(NOTE.out - 1);
      expect(titleOf(root)).toBe('Who owns the value');
      expect(hasCard(root)).toBe(true);
      // The moment it is turned away the next step is on it, whole, and the sheet comes back.
      vi.advanceTimersByTime(1);
      expect(titleOf(root)).toBe('Lend, do not give away');
      expect(hasCard(root)).toBe(true);
      expect(note.dataset.tab).toBe('note');
      expect(note.classList.contains('is-out')).toBe(false);
      expect(note.classList.contains('is-in')).toBe(true);
      vi.advanceTimersByTime(NOTE.turn + 60);
      expect(note.classList.contains('is-in')).toBe(false);
      // The whole swap is short: it used to leave the note empty for over a second.
      expect(NOTE.out + NOTE.turn).toBeLessThanOrEqual(600);
    } finally {
      vi.useRealTimers();
    }
  });

  it('builds only the step the walker ends on when he passes several during one turn', () => {
    vi.useFakeTimers();
    try {
      const { hud, root } = mount(open(), { reducedMotion: false });
      hud.setMode('walk');
      hud.setActive({ kind: 'waypoint', waypointId: 'moves' });
      vi.advanceTimersByTime(NOTE.turn + 60);
      hud.setActive({ kind: 'waypoint', waypointId: 'borrowing' });
      vi.advanceTimersByTime(60);
      hud.setActive({ kind: 'signpost', stageId: 'ownership' });
      vi.advanceTimersByTime(60);
      hud.setActive({ kind: 'camp', stageId: 'ownership' });
      expect(titleOf(root)).toBe('Who owns the value');
      vi.advanceTimersByTime(NOTE.out);
      expect(root.querySelector<HTMLElement>('.zh-note')!.dataset.kind).toBe('camp');
      expect(root.querySelector('.zl-camp')).not.toBeNull();
      expect(hud.note.item).toEqual({ kind: 'camp', stageId: 'ownership' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not turn at all when the walker comes back to the step that is still shown', () => {
    vi.useFakeTimers();
    try {
      const { hud, root } = mount(open(), { reducedMotion: false });
      hud.setMode('walk');
      const note = root.querySelector<HTMLElement>('.zh-note')!;
      hud.setActive({ kind: 'waypoint', waypointId: 'moves' });
      vi.advanceTimersByTime(NOTE.turn + 60);
      const card = root.querySelector('.zh-note-body .zl-card');
      hud.setActive({ kind: 'waypoint', waypointId: 'borrowing' });
      expect(note.classList.contains('is-out')).toBe(true);
      hud.setActive({ kind: 'waypoint', waypointId: 'moves' });
      expect(note.classList.contains('is-out')).toBe(false);
      expect(hud.note.item).toEqual({ kind: 'waypoint', waypointId: 'moves' });
      vi.advanceTimersByTime(NOTE.out + NOTE.turn + 100);
      expect(titleOf(root)).toBe('Who owns the value');
      // The card was never rebuilt, so an answer being typed would still be there.
      expect(root.querySelector('.zh-note-body .zl-card')).toBe(card);
      expect(note.classList.contains('is-in')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('changes at once, with no turn, when motion is reduced', () => {
    vi.useFakeTimers();
    try {
      const { hud, root } = mount(open(), { reducedMotion: true });
      hud.setMode('walk');
      const note = root.querySelector<HTMLElement>('.zh-note')!;
      hud.setActive({ kind: 'waypoint', waypointId: 'moves' });
      hud.setActive({ kind: 'waypoint', waypointId: 'borrowing' });
      expect(titleOf(root)).toBe('Lend, do not give away');
      expect(hasCard(root)).toBe(true);
      expect(note.classList.contains('is-out')).toBe(false);
      expect(note.classList.contains('is-in')).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the note and the walker', () => {
  const sideOf = (root: HTMLElement): string | undefined => root.querySelector<HTMLElement>('.zh-note')!.dataset.side;

  it('goes to the other side when the walker has been under it for half a second, and then rests', () => {
    const { hud, root } = mount();
    hud.setMode('walk');
    hud.setActive({ kind: 'waypoint', waypointId: 'moves' });
    const left = sideBox('left', { width: window.innerWidth, height: window.innerHeight }, 420);
    const right = sideBox('right', { width: window.innerWidth, height: window.innerHeight }, 420);
    /** Twenty frames a second from one moment to another, both included. */
    const run = (from: number, to: number): void => {
      for (let k = Math.round(from * 20); k <= Math.round(to * 20); k += 1) hud.frame(k / 20);
    };
    expect(sideOf(root)).toBe('left');
    // The walker beside the note: nothing happens, however long.
    hud.setWalker(0.3, { x: left.left + left.width + 200, y: 300 });
    run(0, 3);
    expect(sideOf(root)).toBe('left');
    // The camera moves on and he comes to stand under it.
    hud.setWalker(0.3, { x: left.left + left.width / 2, y: 300 });
    run(3.05, 3 + NOTE.dodge.after - 0.1);
    expect(sideOf(root)).toBe('left');
    run(3 + NOTE.dodge.after - 0.05, 3 + NOTE.dodge.after + 0.1);
    expect(sideOf(root)).toBe('right');
    // It does not flutter: under it again at once, it stays for its rest, and only then goes back.
    hud.setWalker(0.3, { x: right.left + right.width / 2, y: 300 });
    const moved = 3 + NOTE.dodge.after + 0.1;
    run(moved + 0.05, moved + NOTE.dodge.rest - 0.3);
    expect(sideOf(root)).toBe('right');
    run(moved + NOTE.dodge.rest - 0.25, moved + NOTE.dodge.rest + NOTE.dodge.after + 0.3);
    expect(sideOf(root)).toBe('left');
  });

  it('counts his whole figure, not only the top of his hat, and leaves an empty note where it is', () => {
    const { hud, root } = mount();
    hud.setMode('walk');
    const box = sideBox('left', { width: window.innerWidth, height: window.innerHeight }, 420);
    // No step yet: the note is only a line of text and may lie anywhere.
    hud.setWalker(0, { x: box.left + 50, y: box.top + 50 });
    for (let t = 0; t <= 2; t += 0.05) hud.frame(t);
    expect(sideOf(root)).toBe('left');
    // His hat is above the note, his body is behind it.
    hud.setActive({ kind: 'waypoint', waypointId: 'moves' });
    hud.setWalker(0.3, { x: box.left + 50, y: box.top - 16 - NOTE.dodge.figure + 10 });
    for (let t = 2.05; t <= 3; t += 0.05) hud.frame(t);
    expect(sideOf(root)).toBe('right');
  });

  it('stays where it is while it is being read', () => {
    const { hud, root } = mount();
    hud.setMode('walk');
    hud.setActive({ kind: 'waypoint', waypointId: 'moves' });
    const box = sideBox('left', { width: window.innerWidth, height: window.innerHeight }, 420);
    root.querySelector<HTMLButtonElement>('.zh-note [role="tab"]')!.focus();
    hud.setWalker(0.3, { x: box.left + 50, y: 300 });
    for (let t = 0; t <= 4; t += 0.05) hud.frame(t);
    expect(sideOf(root)).toBe('left');
    (document.activeElement as HTMLElement).blur();
    for (let t = 4.05; t <= 5; t += 0.05) hud.frame(t);
    expect(sideOf(root)).toBe('right');
  });

  it('tells the strip which stage the note is about, so both name the same stage at a camp', () => {
    const session = open();
    const { hud } = mount(session);
    hud.setMode('walk');
    const camp = session.trek.stages[0]!.endMinute / session.trek.totalMinutes;
    hud.setWalker(camp);
    hud.setActive({ kind: 'signpost', stageId: 'first-binary' });
    expect(hud.profile.readout).toBe('Hour 5.5 of 42 · Stage 1 · Bronze');
    hud.setActive({ kind: 'camp', stageId: 'first-binary' });
    expect(hud.profile.readout).toBe('Hour 5.5 of 42 · Stage 1 · Bronze');
    hud.setActive({ kind: 'waypoint', waypointId: 'moves' });
    expect(hud.profile.readout).toBe('Hour 5.5 of 42 · Stage 2 · Silver');
    // A review is about an earlier step, wherever the walker stands.
    hud.setActive({ kind: 'review', waypointId: 'toolchain' });
    expect(hud.profile.readout).toBe('Hour 5.5 of 42 · Stage 2 · Silver');
  });
});
