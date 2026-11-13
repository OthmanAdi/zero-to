import { readReceipt, readRoadmapText, readRoadmapValue, safeAddress, type Loaded, type Receipt } from '../src/app/load';
import { uiLang } from '../src/i18n';
import { createBrand } from '../src/look/brand';
import { createRoomOverlays } from '../src/look/dom';
import { injectTokens } from '../src/look/tokens';
import { isRealDay } from '../src/roadmap/dates';
import type { Roadmap } from '../src/roadmap/types';
import {
  STOPS,
  loadSectionWords,
  mountSections,
  saySections,
  type BriefAction,
  type GalleryExample,
  type Sections,
  type StartChoice,
  type StopId,
} from '../src/sections';

/**
 * The landing sections under a stand-in hero.
 *
 * URL: `?ui=de` for German, `?motion=reduced` for reduced motion, `?stop=<id>` to open at a stop (what, how,
 * trail, class, map, install, questions, start), `?hold=0..1` for how far into its hold, `?p=0..1` to open at
 * a share of the whole page, `?topic=` to punch a topic into the ticket.
 *
 * Roadmap mode, where the stops are the trip brief of a person's own roadmap. The page takes the first of these
 * that is there, in the order the app reads its sources:
 *
 * - `window.__sectionsInput = { roadmap, receipt }`, set before the page loads (a test's init script), for a file
 *   the dev server does not serve;
 * - `?src=<address>` of a roadmap file, fetched like the app's `?src=` (http and https only, relative to this page);
 * - `?road=<sample id>`, a gallery roadmap laid on the page as if it were a person's own.
 *
 * With one of them, `?receipt=<address>` adds the link-check receipt of the run ("38 opened, 31 kept"), and
 * `?today=YYYY-MM-DD` fixes the day the pace stop and the permit count from. A roadmap that cannot be read is
 * named in the stand-in hero and in the console, and the stops then explain the skill.
 *
 * The permit, the take-away actions and the copy buttons do nothing here but say what they would do: in the
 * console and in `window.__sectionsEvents`. `<html data-sections="ready">` is set once the stops are built and the
 * page stands where the address asked; `data-sections-mode` says which mode was asked for.
 */
const params = new URLSearchParams(location.search);
const forcedReduced = params.get('motion') === 'reduced';
const media = matchMedia('(prefers-reduced-motion: reduce)');

injectTokens();
document.documentElement.lang = uiLang();
document.body.append(createRoomOverlays(document, { vignette: false }));
document.getElementById('brand')?.append(createBrand(document));

interface Sample {
  readonly id: string;
  readonly title: string;
  readonly lang: string;
  readonly checkedOn: string;
  readonly freshness?: string;
}
const samples = import.meta.glob<Sample>('../src/roadmap/samples/*.json', { eager: true, import: 'default' });
const examples: GalleryExample[] = Object.values(samples).map((sample) => ({
  title: sample.title,
  lang: sample.lang,
  checkedOn: sample.checkedOn,
  ...(sample.freshness ? { freshness: sample.freshness } : {}),
}));

// ---- Roadmap mode: which roadmap, if any, and its receipt.

/** What a test may put on the window before the page loads. Both are checked like any file from outside. */
interface SectionsInput {
  readonly roadmap?: unknown;
  readonly receipt?: unknown;
}

/** What the page's controls asked for, in order. Nothing is sent anywhere. */
type SectionsEvent = { readonly kind: 'start'; readonly choice: StartChoice } | { readonly kind: 'action'; readonly action: BriefAction } | { readonly kind: 'copy'; readonly command: string };

declare global {
  interface Window {
    __sections?: Sections;
    __sectionsInput?: SectionsInput;
    __sectionsEvents?: SectionsEvent[];
  }
}

const events: SectionsEvent[] = [];
window.__sectionsEvents = events;
const record = (event: SectionsEvent): void => {
  events.push(event);
  console.info('[dev/sections]', JSON.stringify(event));
};

/** Fetches a text file, or says why it could not. */
async function fetchText(address: string): Promise<{ ok: true; text: string } | { ok: false; why: string }> {
  try {
    const response = await fetch(address);
    if (!response.ok) return { ok: false, why: `${address} answered ${response.status}` };
    // The dev server answers an address it has no file for with the app's page.
    if ((response.headers.get('content-type') ?? '').includes('text/html')) return { ok: false, why: `${address} answered with a web page, not a file: is the path right?` };
    return { ok: true, text: await response.text() };
  } catch (error) {
    return { ok: false, why: `${address} could not be fetched: ${error instanceof Error ? error.message : String(error)}` };
  }
}

const loadedWhy = (loaded: Extract<Loaded, { ok: false }>): string => `${loaded.reason}: ${loaded.issues.slice(0, 3).map((issue) => (issue.path ? `${issue.path}: ${issue.message}` : issue.message)).join('; ')}`;

/** The roadmap the address or a test asks for, null for the gallery, or the reason it could not be read. */
async function pickRoadmap(): Promise<{ roadmap: Roadmap | null; from: string; problem?: string }> {
  const input = window.__sectionsInput;
  if (input?.roadmap !== undefined) {
    const loaded = readRoadmapValue(input.roadmap);
    return loaded.ok ? { roadmap: loaded.roadmap, from: 'window.__sectionsInput' } : { roadmap: null, from: 'window.__sectionsInput', problem: loadedWhy(loaded) };
  }
  const raw = params.get('src');
  if (raw !== null && raw.trim() !== '') {
    const address = safeAddress(raw, location.href);
    if (!address) return { roadmap: null, from: `?src=${raw}`, problem: 'only http and https addresses are fetched' };
    const fetched = await fetchText(address);
    if (!fetched.ok) return { roadmap: null, from: `?src=${raw}`, problem: fetched.why };
    const loaded = readRoadmapText(fetched.text);
    return loaded.ok ? { roadmap: loaded.roadmap, from: `?src=${raw}` } : { roadmap: null, from: `?src=${raw}`, problem: loadedWhy(loaded) };
  }
  const road = params.get('road')?.trim();
  if (road) {
    const sample = Object.values(samples).find((entry) => entry.id === road);
    if (!sample) return { roadmap: null, from: `?road=${road}`, problem: `no gallery roadmap has the id "${road}"; the ids are ${Object.values(samples).map((entry) => entry.id).join(', ')}` };
    const loaded = readRoadmapValue(sample);
    return loaded.ok ? { roadmap: loaded.roadmap, from: `?road=${road}` } : { roadmap: null, from: `?road=${road}`, problem: loadedWhy(loaded) };
  }
  return { roadmap: null, from: 'gallery' };
}

/** The receipt from a test or from `?receipt=`, or null. A receipt that cannot be read is said, not shown. */
async function pickReceipt(): Promise<Receipt | null> {
  const input = window.__sectionsInput;
  if (input?.receipt !== undefined && input.receipt !== null) {
    const receipt = readReceipt(JSON.stringify(input.receipt));
    if (!receipt) console.error('[dev/sections] window.__sectionsInput.receipt is not a receipt: it needs opened, kept and checkedOn');
    return receipt;
  }
  const raw = params.get('receipt');
  if (raw === null || raw.trim() === '') return null;
  const address = safeAddress(raw, location.href);
  if (!address) {
    console.error(`[dev/sections] ?receipt=${raw}: only http and https addresses are fetched`);
    return null;
  }
  const fetched = await fetchText(address);
  if (!fetched.ok) {
    console.error(`[dev/sections] ?receipt=${raw}: ${fetched.why}`);
    return null;
  }
  const receipt = readReceipt(fetched.text);
  if (!receipt) console.error(`[dev/sections] ?receipt=${raw} is not a receipt: it needs opened, kept and checkedOn`);
  return receipt;
}

const todayParam = params.get('today');
const today = todayParam && /^\d{4}-\d{2}-\d{2}$/.test(todayParam) && isRealDay(todayParam) ? new Date(`${todayParam}T12:00:00Z`) : undefined;
if (todayParam && !today) console.error(`[dev/sections] ?today=${todayParam} is not a day; the page counts from now`);

// A German page fetches its words before it is built, so it never shows English first.
const [picked, receipt] = await Promise.all([pickRoadmap(), pickReceipt(), loadSectionWords(uiLang())]);
const roadmap = picked.roadmap;
document.documentElement.dataset.sectionsMode = roadmap ? 'roadmap' : 'gallery';

const note = document.getElementById('hero-note');
const label = document.getElementById('hero-label');
if (picked.problem) {
  console.error(`[dev/sections] ${picked.from}: ${picked.problem}`);
  if (note) {
    note.textContent = `The roadmap from ${picked.from} could not be read (${picked.problem}). The stops explain the skill instead.`;
    note.classList.add('dev-problem');
    note.setAttribute('role', 'alert');
  }
}
if (label) label.textContent = roadmap ? `dev/sections.html, roadmap mode: ${roadmap.id} (${picked.from})` : 'dev/sections.html, gallery mode';

const actions: Record<BriefAction, () => void> = {
  print: () => record({ kind: 'action', action: 'print' }),
  share: () => record({ kind: 'action', action: 'share' }),
  download: () => record({ kind: 'action', action: 'download' }),
  markdown: () => record({ kind: 'action', action: 'markdown' }),
  progress: () => record({ kind: 'action', action: 'progress' }),
};

const chip = document.getElementById('chip') as HTMLAnchorElement;
const root = document.getElementById('sections') as HTMLElement;
const sections = mountSections(root, {
  navHost: document.getElementById('nav-slot'),
  reduced: () => forcedReduced || media.matches,
  examples,
  topic: params.get('topic') ?? '',
  ...(roadmap ? { roadmap, receipt, actions, onStart: (choice: StartChoice) => record({ kind: 'start', choice }) } : {}),
  ...(today ? { today } : {}),
  onCopy: (command) => record({ kind: 'copy', command }),
  onStop(_index, id) {
    chip.classList.toggle('is-current', id === 'start');
  },
});
chip.textContent = saySections('navStart');
chip.addEventListener('click', (event) => {
  event.preventDefault();
  sections.go('start');
});

let frame = 0;
const show = () => {
  frame = 0;
  sections.update(sections.progressAt(window.scrollY));
};
const queue = () => {
  if (!frame) frame = requestAnimationFrame(show);
};
window.addEventListener('scroll', queue, { passive: true });
window.addEventListener('resize', queue);

/**
 * Resolves once the stops are in the document. In roadmap mode they are built only when the brief has been
 * fetched, so the page waits for them before it scrolls to a stop.
 */
function built(): Promise<void> {
  if (root.querySelector('[data-stop]')) return Promise.resolve();
  return new Promise((resolve) => {
    const watch = new MutationObserver(() => {
      if (!root.querySelector('[data-stop]')) return;
      watch.disconnect();
      resolve();
    });
    watch.observe(root, { childList: true, subtree: true });
  });
}

/** Opens the page where the address asks for it, once the layout has its fonts and its stops. */
async function place(): Promise<void> {
  await Promise.all([document.fonts.ready, built()]);
  sections.measure();
  const stop = params.get('stop') as StopId | null;
  const p = Number(params.get('p'));
  if (stop && STOPS.some((entry) => entry.id === stop)) {
    const section = root.querySelector<HTMLElement>(`[data-stop="${stop}"]`);
    if (section) {
      const top = section.getBoundingClientRect().top + window.scrollY;
      const hold = Math.min(1, Math.max(0, Number(params.get('hold') ?? 0.5)));
      const pinned = section.hasAttribute('data-pin');
      window.scrollTo(0, top + (pinned ? (section.offsetHeight - window.innerHeight) * hold : 0));
    }
  } else if (params.has('p') && Number.isFinite(p)) {
    window.scrollTo(0, (document.documentElement.scrollHeight - window.innerHeight) * Math.min(1, Math.max(0, p)));
  }
  show();
  document.documentElement.dataset.sections = 'ready';
}
void place();

window.__sections = sections;
