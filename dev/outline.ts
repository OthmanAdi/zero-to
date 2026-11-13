/**
 * Dev page for the outline: a gallery roadmap as the list view, hydrated on a learner's session. It also
 * hydrates a page that the prerender script wrote with this file as its shell, which is how the browser tests
 * check the prerendered HTML.
 *
 * URL parameters:
 *   ?road=<sample id>   the roadmap (default rust-for-a-python-dev); a prerendered page brings its own
 *   ?ui=de              interface language
 *   ?teacher=1          teacher notes and session plans in the outline
 *   ?today=YYYY-MM-DD   fake clock (noon UTC of that day)
 *   ?fresh=1            clear this roadmap's stored progress, plan and notebook first
 *   ?seed=1             start from a few finished steps, a ticked signpost and pinned notes (in memory)
 *   ?print=trail-card|outline|notebook|teacher   prepare that print, for print emulation
 *   ?preview=1          with ?print, show the print pages on screen as A4 sheets
 */
import { injectTokens } from '../src/look';
import { createSession, memoryStorage, notebookKey, planKey, progressKey, type StorageLike } from '../src/learn';
import { hydrateOutline, preparePrint, PRINT_KINDS, renderOutline, type PrintKind } from '../src/outline';
import { validateRoadmap } from '../src/roadmap/validate';
import type { Roadmap } from '../src/roadmap/types';

const params = new URLSearchParams(location.search);
const files = import.meta.glob('../src/roadmap/samples/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const byId = new Map<string, unknown>(Object.entries(files).map(([path, data]) => [path.replace(/^.*\/(.+)\.json$/, '$1'), data]));

function load(): Roadmap {
  const inline = document.getElementById('zero-to-roadmap')?.textContent?.trim();
  const raw = inline ? (JSON.parse(inline) as unknown) : byId.get(params.get('road') ?? 'rust-for-a-python-dev') ?? byId.get('rust-for-a-python-dev');
  const result = validateRoadmap(raw);
  if (!result.ok) throw new Error(`dev/outline: the roadmap does not validate: ${result.errors.map((e) => e.message).join('; ')}`);
  return result.roadmap;
}

injectTokens();
const roadmap = load();
const host = document.getElementById('zero-to-outline') ?? document.body;
const teacher = params.get('teacher') === '1';
if (!host.querySelector('[data-zo-outline]')) host.replaceChildren(renderOutline(roadmap, { teacher }));
document.title = `zero-to dev: outline · ${roadmap.title}`;

const today = params.get('today');
const clock = today && /^\d{4}-\d{2}-\d{2}$/.test(today) ? () => today : undefined;
const seed = params.get('seed') === '1';
let storage: StorageLike | null | undefined;
if (seed) storage = memoryStorage();
if (params.get('fresh') === '1') {
  for (const key of [progressKey(roadmap.id), planKey(roadmap.id), notebookKey(roadmap.id)]) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Storage blocked: the session falls back to memory by itself.
    }
  }
}
const session = createSession(roadmap, storage, clock ? { clock } : {});

if (seed) {
  const steps = roadmap.stages.flatMap((s) => s.waypoints).filter((w) => !w.optional);
  for (const w of steps.slice(0, 3)) session.done(w.id);
  if (steps[0]) session.rate(steps[0].id, 3);
  if (steps[1]) session.rate(steps[1].id, 2);
  const first = roadmap.stages[0];
  if (first) {
    session.show(first.id, 0, true);
    const w = first.waypoints[0];
    if (w) {
      session.pin({ kind: 'point', text: w.takeaways?.[0] ?? w.note, stageId: first.id, waypointId: w.id });
      session.pin({ kind: 'task', text: w.do, stageId: first.id, waypointId: w.id });
      const resource = roadmap.resources.find((r) => r.id === w.resources[0]);
      if (resource) session.pin({ kind: 'link', text: resource.title, url: resource.url, stageId: first.id, waypointId: w.id });
    }
    session.pin({ kind: 'own', text: 'My own line, written in the notebook.', stageId: first.id });
  }
  session.start({ on: roadmap.brief.startDate ?? session.today() });
}

const outline = hydrateOutline(host, session, { teacher });

const print = params.get('print') as PrintKind | null;
if (print && PRINT_KINDS.includes(print)) {
  preparePrint(print, session);
  if (params.get('preview') === '1') document.documentElement.dataset.printPreview = '';
}

document.documentElement.dataset.ready = '';
Object.assign(window, { zoDev: { session, outline, roadmap } });
