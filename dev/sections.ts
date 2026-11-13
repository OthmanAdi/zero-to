import { uiLang } from '../src/i18n';
import { createBrand } from '../src/look/brand';
import { createRoomOverlays } from '../src/look/dom';
import { injectTokens } from '../src/look/tokens';
import { STOPS, loadSectionWords, mountSections, saySections, type GalleryExample, type StopId } from '../src/sections';

/**
 * The landing sections under a stand-in hero.
 *
 * URL: `?ui=de` for German, `?motion=reduced` for reduced motion, `?stop=<id>` to open at a stop (what, how,
 * trail, class, map, install, questions, start), `?hold=0..1` for how far into its hold, `?p=0..1` to open at
 * a share of the whole page, `?topic=` to punch a topic into the ticket.
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

// A German page fetches its words before it is built, so it never shows English first.
await loadSectionWords(uiLang());

const chip = document.getElementById('chip') as HTMLAnchorElement;
const root = document.getElementById('sections') as HTMLElement;
const sections = mountSections(root, {
  navHost: document.getElementById('nav-slot'),
  reduced: () => forcedReduced || media.matches,
  examples,
  topic: params.get('topic') ?? '',
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

/** Opens the page where the address asks for it, once the layout has its fonts. */
async function place(): Promise<void> {
  await document.fonts.ready;
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

declare global {
  interface Window {
    __sections?: typeof sections;
  }
}
window.__sections = sections;
