/**
 * Dev page for the learning core: the Rust sample, every card type and the notebook, on the night table.
 *
 * URL parameters:
 *   ?today=YYYY-MM-DD   fake clock (noon UTC of that day)
 *   ?ui=de              interface language
 *   ?card=all|waypoint|signpost|camp|review|pace|notebook   one card alone (default all)
 *   ?wp=<waypoint id>   the waypoint card (default guessing-game)
 *   ?stage=<stage id>   the signpost and camp (default ownership)
 *   ?storage=local|memory|blocked   where progress goes (default local)
 *   ?seed=1             start from a few days of made-up progress, in memory, so reviews are due today
 *   ?statuses=1         add a gated and an unverified source to the waypoint, to show their status lines
 *   ?slow=1             a slower plan (2 h a week), so the pace card shows its choices
 *   ?reset=1            clear this roadmap's stored progress and notebook first
 */
import sample from '../src/roadmap/samples/rust-for-a-python-dev.json';
import { tokensCss } from '../src/look/theme';
import { typeTokens } from '../src/look/type';
import { validateRoadmap } from '../src/roadmap/validate';
import { addDays } from '../src/roadmap/dates';
import type { Roadmap } from '../src/roadmap/types';
import {
  campCard,
  createSession,
  GO_EVENT,
  memoryStorage,
  notebookKey,
  notebookPanel,
  paceChoices,
  planKey,
  progressKey,
  reviewCard,
  signpostCard,
  waypointCard,
  type GoDetail,
  type MountedCard,
  type StorageLike,
} from '../src/learn';

const params = new URLSearchParams(location.search);
const todayParam = params.get('today');
const today = todayParam && /^\d{4}-\d{2}-\d{2}$/.test(todayParam) ? todayParam : new Date().toISOString().slice(0, 10);
const only = params.get('card') ?? 'all';
let waypointId = params.get('wp') ?? 'guessing-game';
const stageId = params.get('stage') ?? 'ownership';

const style = document.createElement('style');
style.textContent = `${tokensCss(typeTokens())}
.dev { box-sizing: border-box; max-width: 1360px; margin: 0 auto; padding: 22px 16px 64px; }
.dev-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 18px; margin-bottom: 26px; color: var(--zt-text-soft); }
.dev-head h1 { margin: 0; font: 500 22px/1.2 var(--zt-font-display); color: var(--zt-text); letter-spacing: -0.01em; }
.dev-head p { margin: 0; font: 12px/1.5 var(--zt-font-label); color: var(--zt-text-faint); }
.dev-head label { font: 12px var(--zt-font-label); color: var(--zt-text-soft); display: inline-flex; gap: 8px; align-items: center; max-width: 100%; min-width: 0; }
.dev-head select { font: 14px var(--zt-font-text); background: var(--zt-night-soft); color: var(--zt-text); border: 1px solid #2a3446; border-radius: 6px; min-height: 36px; padding: 4px 8px; min-width: 0; max-width: 100%; flex: 1 1 auto; }
.dev-head a { color: var(--zt-text-soft); font: 12px var(--zt-font-label); }
.dev-head a:focus-visible, .dev-head select:focus-visible { outline: 2px solid var(--zt-lamp); outline-offset: 2px; }
.dev-table { column-width: 380px; column-gap: 40px; }
.dev-note { break-inside: avoid; display: block; margin: 0 0 44px; position: relative; padding-top: 10px; }
.dev-note > .dev-tag { display: block; margin: 0 0 12px; font: 11px/1.4 var(--zt-font-label); color: var(--zt-text-faint); letter-spacing: 0.02em; }
.dev-note .zl-card::before { content: ''; position: absolute; top: -9px; left: 50%; width: 70px; height: 20px; margin-left: -35px; transform: rotate(-3deg); background: var(--zt-tape); box-shadow: 0 1px 2px rgba(0,0,0,0.18); }
.dev-log { position: fixed; left: 16px; bottom: 12px; margin: 0; font: 12px var(--zt-font-label); color: var(--zt-text-faint); pointer-events: none; }
.dev-alone { max-width: 440px; margin: 0 auto; }
@media (max-width: 520px) { .dev { padding: 16px 16px 56px; } .dev-head { margin-bottom: 20px; } .dev-note { margin-bottom: 36px; } }
`;
document.head.append(style);

// ---- The roadmap
const roadmap = structuredClone(sample) as unknown as Roadmap & { resources: Roadmap['resources'][number][] };
if (params.get('statuses') === '1') {
  const draft = roadmap as unknown as { resources: unknown[]; stages: { waypoints: { id: string; resources: string[] }[] }[] };
  draft.resources.push(
    {
      id: 'dev-gated',
      title: 'An example course behind a login',
      by: 'Example school',
      url: 'https://example.org/course',
      type: 'course',
      cost: 'paid',
      price: { amount: 29, currency: 'EUR', seenOn: '2026-11-10' },
      lang: 'de',
      level: 'bronze',
      why: 'Shows how a gated source reads on the card. Not part of the real sample.',
      check: { status: 'gated', on: '2026-11-13', http: 200, note: 'The lessons need an account.' },
    },
    {
      id: 'dev-unverified',
      title: 'An example page that refused the checker',
      url: 'https://example.org/blocked',
      type: 'article',
      cost: 'free',
      lang: 'en',
      level: 'bronze',
      why: 'Shows how an unverified source reads on the card. Not part of the real sample.',
      check: { status: 'unverified', on: '2026-11-13', http: 403, note: 'Automated access was refused.' },
    },
  );
  for (const stage of draft.stages) {
    for (const waypoint of stage.waypoints) if (waypoint.id === waypointId) waypoint.resources.push('dev-gated', 'dev-unverified');
  }
}
if (params.get('slow') === '1') (roadmap.brief as { hoursPerWeek: number }).hoursPerWeek = 2;
const check = validateRoadmap(roadmap);

// ---- Storage and clock
const blocked: StorageLike = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};
const seed = params.get('seed') === '1';
const storageKind = seed ? 'memory' : (params.get('storage') ?? 'local');
const storage: StorageLike | null | undefined =
  storageKind === 'blocked' ? blocked : storageKind === 'memory' ? memoryStorage() : undefined;
if (params.get('reset') === '1') {
  for (const key of [progressKey(roadmap.id), notebookKey(roadmap.id), planKey(roadmap.id)]) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Blocked storage: nothing to clear.
    }
  }
}

let clockDay = today;
const session = createSession(roadmap, storage, { clock: () => `${clockDay}T12:00:00.000Z` });

if (seed) {
  // A few days of learning, so the cards show filled states and two reviews are due today.
  clockDay = addDays(today, -6);
  session.done('toolchain');
  session.rate('toolchain', 3);
  session.pin({ id: 'point:toolchain:1', kind: 'point', text: roadmap.stages[0]?.waypoints[0]?.takeaways?.[1] ?? '', stageId: 'first-binary', waypointId: 'toolchain' });
  clockDay = addDays(today, -3);
  session.answer('w:guessing-game:0', { choice: 1 });
  session.done('guessing-game');
  session.rate('guessing-game', 2);
  clockDay = addDays(today, -2);
  session.answer('p:moves', { text: 'It will not compile, because a was moved into b.' });
  session.done('first-drills');
  session.done('moves');
  session.rate('moves', 3);
  session.show('first-binary', 0, true);
  session.show('first-binary', 1, true);
  session.rung('first-binary', 1);
  session.show('ownership', 0, true);
  session.pin({ id: 'link:moves:book-ownership', kind: 'link', text: 'The Rust Programming Language, chapter 4.1: What Is Ownership?', url: 'https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html', stageId: 'ownership', waypointId: 'moves' });
  session.pin({ kind: 'own', text: 'A move is like handing over the only key to a flat.', stageId: 'ownership', waypointId: 'moves' });
  clockDay = today;
}

// ---- The page
const app = document.getElementById('app') as HTMLElement;
const dev = document.createElement('div');
dev.className = 'dev';
app.append(dev);

const head = document.createElement('header');
head.className = 'dev-head';
const h1 = document.createElement('h1');
h1.textContent = 'Learning cards';
const info = document.createElement('p');
info.textContent = `${roadmap.title} · today ${today} · storage ${session.storage.kind}${session.storage.reason ? ` (${session.storage.reason})` : ''} · ${check.ok ? 'roadmap valid' : `roadmap has ${check.errors.length} errors`}`;
const pick = document.createElement('label');
pick.textContent = 'Waypoint';
const select = document.createElement('select');
for (const stage of roadmap.stages) {
  const group = document.createElement('optgroup');
  group.label = stage.title;
  for (const waypoint of stage.waypoints) {
    const option = document.createElement('option');
    option.value = waypoint.id;
    option.textContent = waypoint.title;
    group.append(option);
  }
  select.append(group);
}
select.value = waypointId;
pick.append(select);
const langLink = document.createElement('a');
const other = new URLSearchParams(location.search);
other.set('ui', (params.get('ui') ?? 'en') === 'de' ? 'en' : 'de');
langLink.href = `?${other.toString()}`;
langLink.textContent = other.get('ui') === 'de' ? 'Deutsch' : 'English';
head.append(h1, info, pick, langLink);
dev.append(head);

const table = document.createElement('main');
table.className = only === 'all' ? 'dev-table' : 'dev-alone';
dev.append(table);

function note(tag: string, card: MountedCard): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'dev-note';
  wrap.dataset.card = tag.split('(')[0];
  const label = document.createElement('span');
  label.className = 'dev-tag';
  label.textContent = tag;
  label.setAttribute('aria-hidden', 'true');
  wrap.append(label, card.root);
  return wrap;
}

let waypointWrap: HTMLElement | null = null;
let waypointMounted: MountedCard | null = null;
function showWaypoint(id: string): void {
  waypointId = id;
  waypointMounted?.destroy();
  waypointMounted = waypointCard(session, id);
  const next = note(`waypointCard('${id}')`, waypointMounted);
  if (waypointWrap) waypointWrap.replaceWith(next);
  else table.append(next);
  waypointWrap = next;
}

const want = (name: string): boolean => only === 'all' || only === name;
if (want('waypoint')) showWaypoint(waypointId);
if (want('signpost')) table.append(note(`signpostCard('${stageId}')`, signpostCard(session, stageId)));
if (want('camp') && roadmap.stages.find((s) => s.id === stageId)?.project) table.append(note(`campCard('${stageId}')`, campCard(session, stageId)));
if (want('review')) table.append(note('reviewCard(null)', reviewCard(session, null)));
if (want('pace')) table.append(note('paceChoices()', paceChoices(session, { always: params.get('always') === '1' })));
if (want('notebook')) table.append(note('notebookPanel()', notebookPanel(session)));

select.addEventListener('change', () => {
  if (want('waypoint')) showWaypoint(select.value);
});

const log = document.createElement('p');
log.className = 'dev-log';
log.setAttribute('aria-live', 'polite');
document.body.append(log);
document.addEventListener(GO_EVENT, (event) => {
  const detail = (event as CustomEvent<GoDetail>).detail;
  log.textContent = `go: ${detail.waypointId ?? detail.stageId ?? ''}`;
  if (detail.waypointId && want('waypoint')) {
    select.value = detail.waypointId;
    showWaypoint(detail.waypointId);
    waypointWrap?.scrollIntoView({ block: 'start' });
  }
});

Object.assign(window as unknown as Record<string, unknown>, { session });
