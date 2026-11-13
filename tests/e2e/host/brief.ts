import { uiLang } from '../../../src/i18n';
import { createBrand } from '../../../src/look/brand';
import { createRoomOverlays } from '../../../src/look/dom';
import { injectTokens } from '../../../src/look/tokens';
import type { Roadmap } from '../../../src/roadmap/types';
import { STOPS, loadSectionWords, mountSections, type BriefAction, type OwnPlan, type Sections, type SourceReceipt, type StartChoice, type StopId } from '../../../src/sections';

/**
 * A test host for the landing sections in roadmap mode. It mounts them the way a page with a person's own
 * roadmap does, with everything such a page passes: the roadmap, the link-check receipt, the learner's own
 * plan, a clock, a keeper for the start the permit hands over, and the take-along actions. A spec sets
 * `window.__host` before the page loads; the host records what the sections hand back in `window.__hostRecord`.
 *
 * URL: `?ui=de` for German, `?motion=reduced`, `?stop=<id>&hold=0..1` to open at a stop.
 */

export interface HostInput {
  /** A person's own roadmap. Without one the sections explain the skill. */
  readonly roadmap?: Roadmap | null;
  readonly receipt?: SourceReceipt | null;
  readonly plan?: OwnPlan | null;
  /** Today for the brief, YYYY-MM-DD. Without it the brief reads the page's clock. */
  readonly today?: string;
  /** Keep the start a torn permit hands over. Without a keeper the permit sends the visitor to the table. */
  readonly keepStart?: boolean;
  /** The take-along actions the page offers. */
  readonly actions?: readonly BriefAction[];
}

export interface HostRecord {
  readonly started: StartChoice[];
  readonly actions: BriefAction[];
}

interface HostWindow {
  __host?: HostInput;
  __hostRecord?: HostRecord;
  __sections?: Sections;
}

const host = window as unknown as HostWindow;
const input: HostInput = host.__host ?? {};
const record: HostRecord = { started: [], actions: [] };
host.__hostRecord = record;

const params = new URLSearchParams(location.search);
const forcedReduced = params.get('motion') === 'reduced';
const media = matchMedia('(prefers-reduced-motion: reduce)');

injectTokens();
document.documentElement.lang = uiLang();
document.body.append(createRoomOverlays(document, { vignette: false }));
document.getElementById('brand')?.append(createBrand(document));

await loadSectionWords(uiLang());

const root = document.getElementById('sections') as HTMLElement;
const actions: Partial<Record<BriefAction, () => void>> = {};
for (const name of input.actions ?? []) actions[name] = () => record.actions.push(name);
const sections = mountSections(root, {
  navHost: document.getElementById('nav-slot'),
  reduced: () => forcedReduced || media.matches,
  roadmap: input.roadmap ?? null,
  receipt: input.receipt ?? null,
  plan: input.plan ?? null,
  ...(input.today ? { today: new Date(`${input.today}T12:00:00Z`) } : {}),
  ...(input.keepStart ? { onStart: (choice: StartChoice) => void record.started.push(choice) } : {}),
  ...(input.actions ? { actions } : {}),
});
host.__sections = sections;

let frame = 0;
const show = (): void => {
  frame = 0;
  sections.update(sections.progressAt(window.scrollY));
};
const queue = (): void => {
  if (!frame) frame = requestAnimationFrame(show);
};
window.addEventListener('scroll', queue, { passive: true });
window.addEventListener('resize', queue);

/** Resolves once the stops are the roadmap's brief, which is fetched on its own when a roadmap is given. */
function briefBuilt(): Promise<void> {
  return new Promise((resolve) => {
    const check = (): void => {
      if (!input.roadmap || root.querySelector('.zs-stop.zs-brief')) resolve();
      else requestAnimationFrame(check);
    };
    check();
  });
}

await Promise.all([document.fonts.ready, briefBuilt()]);
sections.measure();
const stop = params.get('stop') as StopId | null;
if (stop && STOPS.some((entry) => entry.id === stop)) {
  const section = root.querySelector<HTMLElement>(`[data-stop="${stop}"]`);
  if (section) {
    const top = section.getBoundingClientRect().top + window.scrollY;
    const hold = Math.min(1, Math.max(0, Number(params.get('hold') ?? 0.5)));
    window.scrollTo(0, top + (section.hasAttribute('data-pin') ? (section.offsetHeight - window.innerHeight) * hold : 0));
  }
}
show();
document.documentElement.dataset.sections = 'ready';
