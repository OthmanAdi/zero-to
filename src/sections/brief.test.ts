import { afterEach, describe, expect, it, vi } from 'vitest';
import { HUD_STRINGS } from '../hud/strings';
import { missingKeys } from '../i18n';
import { say as sayLearn } from '../learn/strings';
import { paceFor, deriveTrek } from '../roadmap/derive';
import { sampleRoadmap } from '../roadmap/testing';
import type { Roadmap } from '../roadmap/types';
import { validateRoadmap } from '../roadmap/validate';
import { BRIEF_ACTIONS, USE_QUESTIONS, buildBrief, loadBrief } from './brief';
import { BRIEF_DE } from './brief.de';
import { BRIEF_EN } from './brief.en';
import { RULER_MAX, classBrief, clampHours, countsOf, gapLines, mapBrief, planPace, profileOf, proposedStart, summitOf, tallySources, tiersOf, weekTicks, withPlan } from './brief-model';
import { permitNumber } from './brief-permit';
import { hasBriefWords, loadBriefWords, sayBrief } from './brief-words';
import { STOPS, mountSections, type Sections } from './index';
import { EN } from './words.en';

const WORDS = { en: BRIEF_EN, de: BRIEF_DE };
const TODAY = new Date(2026, 10, 13);

/** Two sources of the sample that are each the second source of their step, so the step keeps a verified one. */
const GATED = 'book-ownership-de';
const UNVERIFIED = 'cli-errors';
/** More sources that are the second of their step. */
const SECOND = ['book-hashmaps', 'cargo-guide', 'cli-testing'];

const source = (roadmap: any, id: string): any => roadmap.resources.find((resource: { id: string }) => resource.id === id);

/**
 * A person's own roadmap: the sample with another id, so it is not one of the gallery, a plan that started two
 * weeks ago, one gated and one unverified source and one more gap line.
 */
function own(change: (roadmap: any) => void = () => {}): Roadmap {
  const roadmap = sampleRoadmap() as any;
  roadmap.id = 'rust-on-weeknights';
  roadmap.title = 'Rust on weeknights';
  roadmap.brief = { ...roadmap.brief, hoursPerWeek: 4, startDate: '2026-11-02', deadline: '2027-02-28' };
  source(roadmap, GATED).check = { status: 'gated', on: '2026-11-13', http: 200, note: 'The outline was read, the lessons ask for an account.' };
  source(roadmap, UNVERIFIED).check = { status: 'unverified', on: '2026-11-13', http: 403, note: 'The page refused the automated client.' };
  roadmap.stages[1].waypoints[0].gap = 'No checked source with exercises was found.';
  change(roadmap);
  return roadmap as Roadmap;
}

let mounted: Sections | null = null;

async function mount(options: Parameters<typeof mountSections>[1] = {}): Promise<{ root: HTMLElement; sections: Sections }> {
  const root = document.createElement('main');
  document.body.append(root);
  mounted = mountSections(root, { lang: 'en', reduced: () => false, today: TODAY, ...options });
  if (options.roadmap) await vi.waitFor(() => expect(root.querySelector('.zs-brief')).not.toBeNull());
  return { root, sections: mounted };
}

const text = (root: ParentNode, selector: string): string => (root.querySelector(selector)?.textContent ?? '').replace(/ /g, ' ');

afterEach(() => {
  mounted?.destroy();
  mounted = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('the words of roadmap mode', () => {
  const texts = (lang: 'en' | 'de'): [string, string][] => Object.entries(WORDS[lang]).map(([key, value]) => [key, typeof value === 'string' ? value : Object.values(value).join(' ')]);

  it('has every key in both languages, with the same placeholders', () => {
    expect(missingKeys(WORDS)).toEqual([]);
  });

  it('shares no key with the words of the gallery, so a lookup never has to guess', () => {
    expect(Object.keys(BRIEF_EN).filter((key) => key in EN)).toEqual([]);
  });

  it('answers in English until the German words are fetched, and in German after', async () => {
    expect(hasBriefWords('en')).toBe(true);
    expect(hasBriefWords('de')).toBe(false);
    expect(sayBrief('tabHow', undefined, 'de')).toBe('Sources');
    await loadBriefWords('de');
    expect(hasBriefWords('de')).toBe(true);
    expect(sayBrief('tabHow', undefined, 'de')).toBe('Quellen');
    expect(sayBrief('nStages', { count: 1 }, 'de')).toBe('1 Etappe');
    expect(sayBrief('nStages', { count: 5 }, 'de')).toBe('5 Etappen');
    expect(sayBrief('nCamps', { count: 0 }, 'de')).toBe('Keine Lager');
  });

  it('uses no dash as a pause, no exclamation mark and no ellipsis', () => {
    for (const lang of ['en', 'de'] as const) {
      for (const [key, value] of texts(lang)) expect(value, `${lang}.${key}`).not.toMatch(/[–—!…]| - | -- /);
    }
  });

  it('uses no sales words', () => {
    const sales =
      /\b(amazing|awesome|powerful|seamless|effortless|revolutionary|supercharge|unlock|unleash|magic|blazing|game.?chang|cutting.edge|world.class|best.in.class|ultimate|stunning|beautiful|simply|easily|just works|mühelos|revolutionär|einzigartig|perfekt|genial|kinderleicht|nahtlos)\b/i;
    for (const lang of ['en', 'de'] as const) {
      for (const [key, value] of texts(lang)) expect(value, `${lang}.${key}`).not.toMatch(sales);
    }
  });

  it('has a tab label for every stop and one emphasised word in every headline', () => {
    const camel = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);
    for (const lang of ['en', 'de'] as const) {
      for (const stop of STOPS) expect(WORDS[lang][`tab${camel(stop.id)}` as keyof typeof BRIEF_EN], `${lang}.tab${camel(stop.id)}`).toBeTruthy();
      for (const key of ['srcTitleReceipt', 'cntTitle', 'paceTitle', 'paceTitleClass', 'mapOwnTitle', 'upTitle', 'gapTitle', 'goTitle'] as const) {
        expect((WORDS[lang][key] as string).match(/\*[^*]+\*/g), `${lang}.${key}`).toHaveLength(1);
      }
      for (const form of Object.values(WORDS[lang].srcTitle as Record<string, string>)) expect(form.match(/\*[^*]+\*/g)).toHaveLength(1);
    }
  });

  it('names the controls of the map by the labels they carry', () => {
    // The answers quote buttons of the table and of a step's note. When a label changes, the answer has to.
    for (const lang of ['en', 'de'] as const) {
      expect(WORDS[lang].useA1, lang).toContain(HUD_STRINGS[lang].enterWalk);
      for (const key of ['done', 'rating1', 'rating4'] as const) expect(WORDS[lang].useA2, `${lang}.${key}`).toContain(sayLearn(key, undefined, lang));
    }
    expect(BRIEF_EN.useA3).toContain(HUD_STRINGS.en.profileHint);
    expect(BRIEF_DE.useA3).toContain(HUD_STRINGS.de.profileHint);
  });

  it('never ends a German sentence on an abbreviation and a second full stop', () => {
    // German hours are printed "30 Std.", so a sentence must not put its own full stop behind them.
    for (const [key, value] of texts('de')) expect(value, key).not.toMatch(/\{hours\}\./);
  });
});

describe('the numbers of a brief', () => {
  it('is built from a roadmap that passes the validator and is not in the gallery', () => {
    const roadmap = own();
    expect(validateRoadmap(roadmap).ok).toBe(true);
    expect(roadmap.id).not.toBe(sampleRoadmap().id);
  });

  it('sorts the stages onto the four altitudes with their hours', () => {
    const roadmap = own();
    const tiers = tiersOf(roadmap);
    expect(tiers.map((tier) => tier.tier)).toEqual(['bronze', 'silver', 'gold', 'diamond']);
    expect(tiers.flatMap((tier) => tier.stages.map((stage) => stage.n))).toEqual(roadmap.stages.map((_stage, index) => index + 1));
    expect(tiers.reduce((sum, tier) => sum + tier.minutes, 0)).toBe(deriveTrek(roadmap).totalMinutes);
    expect(tiers[3]?.stages).toEqual([]);
    expect(summitOf(roadmap)).toBe('gold');
  });

  it('counts what the file holds', () => {
    const roadmap = own();
    const counts = countsOf(roadmap);
    const steps = roadmap.stages.flatMap((stage) => stage.waypoints);
    expect(counts.stages).toBe(roadmap.stages.length);
    expect(counts.steps).toBe(steps.length);
    expect(counts.sideTrails).toBe(steps.filter((step) => step.optional).length);
    expect(counts.camps).toBe(roadmap.stages.filter((stage) => stage.project).length);
    expect(counts.capstone).toBe(roadmap.capstone?.title ?? null);
    expect(counts.sources).toBe(roadmap.resources.length);
    expect(counts.gaps).toBe(steps.filter((step) => step.gap).length);
    expect(counts.practice).toBeGreaterThan(0);
    expect(counts.practice).toBeLessThanOrEqual(1);
    expect(counts.reviewDays).toEqual([2, 7, 21, 60]);
  });

  it('tallies the sources and lists every one that is not verified', () => {
    const roadmap = own();
    const tally = tallySources(roadmap, null, TODAY);
    expect(tally.total).toBe(roadmap.resources.length);
    expect(tally.status.verified + tally.status.gated + tally.status.unverified).toBe(tally.total);
    expect(tally.status.gated).toBe(1);
    expect(tally.status.unverified).toBe(1);
    expect(tally.flagged.map((resource) => resource.id)).toEqual([GATED, UNVERIFIED]);
    expect(tally.kinds.reduce((sum, [, count]) => sum + count, 0)).toBe(tally.total);
    expect(tally.kinds[0]?.[1]).toBeGreaterThanOrEqual(tally.kinds[tally.kinds.length - 1]?.[1] ?? 0);
    expect(tally.opened).toBeNull();
    expect(tally.age).toEqual({ days: 0, inDate: true });
    expect(tally.recheckAfter).toBe(90);
    expect(tallySources(own((draft) => (draft.freshness = 'fast')), null, TODAY).recheckAfter).toBe(30);
  });

  it('believes a receipt only when it fits the file', () => {
    const roadmap = own();
    const kept = roadmap.resources.length;
    expect(tallySources(roadmap, { opened: kept + 9, kept, dead: 6 }, TODAY)).toMatchObject({ opened: kept + 9, kept, dead: 6 });
    // A receipt of another run: the list beside the headline would contradict it.
    expect(tallySources(roadmap, { opened: 40, kept: kept + 1 }, TODAY)).toMatchObject({ opened: null, kept: null, dead: 0 });
    expect(tallySources(roadmap, { opened: kept - 1, kept }, TODAY)).toMatchObject({ opened: null, kept: null });
  });

  it('plans the pace with the arithmetic of the profile strip', () => {
    const roadmap = own();
    const plan = planPace(roadmap, 4, '2026-11-02', '2026-11-13');
    expect(plan.arrival).toBe(paceFor(roadmap, '2026-11-13').projectedArrival);
    expect(plan.daysPastDeadline).toBe(paceFor(roadmap, '2026-11-13').daysPastDeadline);
    expect(plan.strips).toHaveLength(roadmap.stages.length);
    plan.strips.forEach((strip, index) => {
      expect(strip.to).toBeGreaterThan(strip.from);
      if (index > 0) expect(strip.from).toBeCloseTo(plan.strips[index - 1]?.to ?? 0, 9);
    });
    expect(plan.strips[plan.strips.length - 1]?.to).toBeCloseTo(plan.neededWeeks, 9);
    // The ruler holds the route and the deadline.
    expect(plan.weeks).toBeGreaterThanOrEqual(Math.ceil(plan.neededWeeks));
    expect(plan.deadlineAt).toBeCloseTo(118 / 7, 9);
    expect(plan.todayAt).toBeCloseTo(11 / 7, 9);
    expect(plan.cut).toBe(false);
  });

  it('arrives sooner with more hours and later with fewer', () => {
    const roadmap = own();
    const slow = planPace(roadmap, 2, '2026-11-02', '2026-11-13');
    const fast = planPace(roadmap, 10, '2026-11-02', '2026-11-13');
    expect(fast.arrival < slow.arrival).toBe(true);
    expect(fast.neededWeeks).toBeCloseTo(slow.neededWeeks / 5, 9);
    expect(slow.daysPastDeadline).toBeGreaterThan(0);
    expect(fast.daysPastDeadline).toBeLessThan(0);
  });

  it('has no line for today before the start, and cuts a ruler that would run for years', () => {
    const roadmap = own((draft) => delete draft.brief.deadline);
    expect(planPace(roadmap, 4, '2026-12-01', '2026-11-13').todayAt).toBeNull();
    expect(planPace(roadmap, 4, '2026-11-02', '2026-11-13').deadlineAt).toBeNull();
    const far = planPace(own((draft) => (draft.brief.deadline = '2031-01-01')), 4, '2026-11-02', '2026-11-13');
    expect(far.weeks).toBe(RULER_MAX);
    expect(far.cut).toBe(true);
    expect(far.deadlineAt).toBeNull();
  });

  it('lays the plan of the learner over the plan of the file, and ignores what is not a plan', () => {
    const roadmap = own();
    expect(withPlan(roadmap, null)).toBe(roadmap);
    const mine = withPlan(roadmap, { startDay: '2026-11-20', hoursPerWeek: 8, deadline: '2027-03-31' });
    expect(mine.brief).toMatchObject({ startDate: '2026-11-20', hoursPerWeek: 8, deadline: '2027-03-31' });
    expect(roadmap.brief).toMatchObject({ startDate: '2026-11-02', hoursPerWeek: 4, deadline: '2027-02-28' });
    const odd = withPlan(roadmap, { startDay: 'tomorrow', hoursPerWeek: -3, deadline: '2027-02-30' });
    expect(odd.brief).toMatchObject({ startDate: '2026-11-02', hoursPerWeek: 4, deadline: '2027-02-28' });
  });

  it('keeps the hours inside what the control offers', () => {
    expect(clampHours(0)).toBe(1);
    expect(clampHours(400)).toBe(40);
    expect(clampHours(4.26)).toBe(4.5);
    expect(clampHours(Number.NaN)).toBe(1);
  });

  it('labels at most eight weeks of a ruler', () => {
    expect(weekTicks(6)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(weekTicks(17)).toEqual([1, 5, 9, 13, 17]);
    for (const weeks of [1, 9, 26, 52, 104]) {
      const ticks = weekTicks(weeks);
      expect(ticks[0]).toBe(1);
      expect(ticks.length).toBeLessThanOrEqual(8);
      expect(ticks[ticks.length - 1]).toBeLessThanOrEqual(weeks);
    }
  });

  it('proposes the planned start while it is ahead and today once it has passed', () => {
    expect(proposedStart(own(), '2026-11-13')).toBe('2026-11-13');
    expect(proposedStart(own((draft) => (draft.brief.startDate = '2026-12-01')), '2026-11-13')).toBe('2026-12-01');
    expect(proposedStart(own((draft) => delete draft.brief.startDate), '2026-11-13')).toBe('2026-11-13');
  });

  it('draws a profile that never goes down and ends on the summit', () => {
    const profile = profileOf(deriveTrek(own()), 46);
    expect(profile).toHaveLength(46);
    profile.forEach((height, index) => {
      expect(height).toBeGreaterThanOrEqual(index > 0 ? (profile[index - 1] as number) - 1e-9 : 0);
      expect(height).toBeLessThanOrEqual(1 + 1e-9);
    });
    expect(profile[45]).toBeCloseTo(1, 9);
  });

  it('reads the gaps and the map of the file', () => {
    const roadmap = own();
    const gaps = gapLines(roadmap);
    expect(gaps.some((gap) => gap.gap === 'No checked source with exercises was found.' && gap.stage === 2 && gap.stageTitle === roadmap.stages[1]?.title)).toBe(true);
    expect(gaps).toHaveLength(roadmap.stages.flatMap((stage) => stage.waypoints).filter((step) => step.gap).length);

    const map = mapBrief(own((draft) => (draft.map = { terrain: 'canyon', trail: 'random', surfaces: ['sand', 'rock'], signpost: 'cairn' })));
    expect(map.spec.terrain).toBe('canyon');
    expect(map.spec.trailWasRandom).toBe(true);
    expect(map.surfaces).toEqual(['sand', 'rock']);
    expect(map.signpost).toBe('cairn');
    const plain = mapBrief(own((draft) => {
      delete draft.map;
      delete draft.brief.theme;
    }));
    expect(plain.themeSet).toBe(false);
    expect(plain.theme).toBe('classic-topo');
    expect(plain.surfaces).toEqual(['grass', 'forest', 'rock', 'snow']);
    expect(plain.signpost).toBe('timber');
  });

  it('has no class brief without a class block, and finds where a class stands with one', () => {
    expect(classBrief(own(), '2026-11-02', '2026-11-13')).toBeNull();
    const taught = own((draft) => {
      draft.class = {
        size: 24,
        sessionsPerWeek: 2,
        sessionMinutes: 45,
        weeks: 2,
        sessions: [
          { n: 1, title: 'One', date: '2026-11-02', inClass: [] },
          { n: 2, title: 'Two', date: '2026-11-12', inClass: [] },
          { n: 3, title: 'Three', date: '2026-11-16', inClass: [] },
          { n: 4, title: 'Four', inClass: [] },
        ],
      };
      draft.stages[0].waypoints[0].teacherNote = 'Watch for the usual mix-up.';
    });
    const brief = classBrief(taught, '2026-11-02', '2026-11-13');
    expect(brief).toMatchObject({ size: 24, sessionsPerWeek: 2, sessionMinutes: 45, weeks: 2, teacherNotes: 1, current: 2 });
    expect(brief?.sessions.map((session) => session.at)).toEqual([0, 10 / 7, 2, 3.5 / 2]);
    expect(classBrief(taught, '2026-11-02', '2026-11-01')?.current).toBeNull();
  });

  it('prints the same permit number for the same roadmap', () => {
    expect(permitNumber('rust-on-weeknights')).toBe(permitNumber('rust-on-weeknights'));
    expect(permitNumber('rust-on-weeknights')).toMatch(/^\d{4}$/);
    expect(permitNumber('another-roadmap')).not.toBe(permitNumber('rust-on-weeknights'));
  });
});

describe('the page in roadmap mode', () => {
  it('explains the skill when it is given no roadmap, as before', async () => {
    const { root } = await mount();
    expect(root.querySelectorAll('.zs-stop')).toHaveLength(STOPS.length);
    expect(root.querySelector('.zs-brief')).toBeNull();
    expect(text(root, '[data-stop="what"] .zs-title')).toBe('A study plan you can walk.');
    expect(root.querySelector('.zs-tabs .zs-tab span:last-child')?.textContent).toBe('What');
  });

  it('turns all eight stops into the trip brief of the roadmap it is given', async () => {
    const roadmap = own();
    const { root } = await mount({ roadmap });
    expect(root.querySelectorAll('.zs-stop')).toHaveLength(STOPS.length);
    expect(root.querySelectorAll('.zs-stop.zs-brief')).toHaveLength(STOPS.length);
    expect([...root.querySelectorAll('.zs-stop')].map((stop) => (stop as HTMLElement).dataset.stop)).toEqual(STOPS.map((stop) => stop.id));
    expect([...root.querySelectorAll('.zs-tabs .zs-tab span:last-child')].map((tab) => tab.textContent)).toEqual(['Route', 'Sources', 'Counts', 'Pace', 'Map', 'Upkeep', 'Gaps']);
    // Nothing of the tour of the skill is left on the page.
    expect(root.textContent).not.toContain('A study plan you can walk');
    expect(root.textContent).not.toContain('Install the skill');
  });

  it('heads the first stop with the title of the roadmap and lists its stages by altitude with hours', async () => {
    const roadmap = own();
    const { root } = await mount({ roadmap });
    const title = root.querySelector('[data-stop="what"] .zs-title') as HTMLElement;
    expect(title.textContent).toBe('Rust on weeknights');
    expect(title.lang).toBe(roadmap.lang);
    expect(title.getAttribute('dir')).toBe('auto');
    expect(text(root, '[data-stop="what"] .zs-lede')).toBe(roadmap.summary);
    expect(text(root, '[data-stop="what"] .zs-copy')).toContain(`${roadmap.stages.length} stages, about 42 h`);

    const cards = [...root.querySelectorAll('[data-stop="what"] .zs-b-tier')];
    expect(cards.map((card) => (card as HTMLElement).dataset.tier)).toEqual(['bronze', 'silver', 'gold', 'diamond']);
    expect(cards.flatMap((card) => [...card.querySelectorAll('.zs-b-stages li .zs-b-stage-title > span:first-child')].map((node) => node.textContent))).toEqual(roadmap.stages.map((stage) => stage.title));
    expect(cards[3]?.classList.contains('is-off')).toBe(true);
    expect(cards[3]?.textContent).toContain('Not on this route');
    expect(root.querySelectorAll('[data-stop="what"] .zs-peak.is-off')).toHaveLength(1);
    expect(text(root, '[data-stop="what"] .zs-b-tier[data-tier="bronze"]')).toContain('about 5.5 h');
  });

  it('says how many sources there are, and "opened and kept" only with a receipt that fits', async () => {
    const roadmap = own();
    const kept = roadmap.resources.length;
    const plain = await mount({ roadmap });
    expect(text(plain.root, '[data-stop="how"] .zs-title')).toBe(`${kept} sources, each with a status.`);
    expect(plain.root.querySelector('[data-stop="how"] .zs-title em')?.textContent).toBe(String(kept));
    expect(plain.root.querySelector('.zs-slipDead')).toBeNull();
    plain.sections.destroy();
    document.body.replaceChildren();

    const { root } = await mount({ roadmap, receipt: { opened: kept + 9, kept, dead: 6 } });
    expect(text(root, '[data-stop="how"] .zs-title')).toBe(`${kept + 9} opened, ${kept} kept.`);
    expect(text(root, '[data-stop="how"] .zs-slips')).toContain(`${kept - 2} verified`);
    expect(text(root, '.zs-slipDead')).toBe('6 dead, not written');
  });

  it('lists every source that is not verified, with its status, its link and the note of the check', async () => {
    const roadmap = own();
    const { root } = await mount({ roadmap });
    const flags = [...root.querySelectorAll('[data-stop="how"] .zs-b-flag')];
    expect(flags.map((flag) => (flag as HTMLElement).dataset.status)).toEqual(['gated', 'unverified']);
    const link = flags[0]?.querySelector('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(source(roadmap, GATED).url);
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(flags[0]?.textContent).toContain('The outline was read, the lessons ask for an account.');
    expect(flags[1]?.textContent).toContain('The page refused the automated client.');

    const clean = own((draft) => {
      for (const resource of draft.resources) resource.check = { status: 'verified', on: '2026-11-13', http: 200 };
    });
    mounted?.destroy();
    document.body.replaceChildren();
    const second = await mount({ roadmap: clean });
    expect(second.root.querySelector('.zs-b-flag')).toBeNull();
    expect(second.root.textContent).toContain('Every source in this file is verified.');
  });

  it('folds away the sources that are not verified after the first two', async () => {
    const roadmap = own((draft) => {
      for (const id of SECOND) source(draft, id).check = { status: 'unverified', on: '2026-11-13', http: null, note: 'Timed out.' };
    });
    expect(validateRoadmap(roadmap).ok).toBe(true);
    const { root } = await mount({ roadmap });
    expect(root.querySelectorAll('[data-stop="how"] .zs-after > .zs-b-flagged > .zs-b-flag')).toHaveLength(2);
    expect(root.querySelectorAll('[data-stop="how"] .zs-b-more .zs-b-flag')).toHaveLength(3);
    expect(text(root, '.zs-b-more summary')).toBe('3 more');
  });

  it('counts what the roadmap carries', async () => {
    const roadmap = own();
    const counts = countsOf(roadmap);
    const { root } = await mount({ roadmap });
    const titles = [...root.querySelectorAll('[data-stop="trail"] .zs-carry .zs-item-title')].map((node) => (node.textContent ?? '').replace(/ /g, ' '));
    expect(titles).toEqual([
      `${counts.stages} stages, ${counts.steps} steps`,
      `${counts.signposts} signposts, ${counts.checks} checks`,
      `${counts.camps} camps`,
      `${counts.sources} sources`,
      'About 42 h',
    ]);
    expect(text(root, '[data-stop="trail"] .zs-b-capstone')).toBe(roadmap.capstone?.title);
    expect(text(root, '[data-stop="trail"] .zs-keep')).toContain('after 2, 7, 21 and 60 days');
  });

  it('sets the hours a week against the deadline, and the control changes the view', async () => {
    const roadmap = own();
    const { root } = await mount({ roadmap });
    const stop = root.querySelector('[data-stop="class"]') as HTMLElement;
    const range = stop.querySelector('.zs-b-range') as HTMLInputElement;
    const sentence = () => text(stop, '.zs-lede');
    expect(range.value).toBe('4');
    expect(sentence()).toBe('At 4 h a week the route takes 11 weeks. Starting on 2 Nov 2026, you arrive on 15 Jan 2027. That is 44 days before your date, 28 Feb 2027.');
    expect((stop.querySelector('.zs-b-reset') as HTMLElement).hidden).toBe(true);
    expect(stop.querySelectorAll('.zs-b-strip')).toHaveLength(roadmap.stages.length);
    expect((stop.querySelector('.zs-today:not(.zs-b-deadline)') as HTMLElement).hidden).toBe(false);
    expect((stop.querySelector('.zs-b-deadline') as HTMLElement).hidden).toBe(false);

    range.value = '2';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    expect(sentence()).toContain('At 2 h a week the route takes 21 weeks.');
    expect(sentence()).toContain('days after your date, 28 Feb 2027.');
    expect(text(stop, '.zs-b-pace-value')).toBe('2');
    const reset = stop.querySelector('.zs-b-reset') as HTMLButtonElement;
    expect(reset.hidden).toBe(false);
    // The roadmap itself is not touched: the control is for the view.
    expect(roadmap.brief.hoursPerWeek).toBe(4);
    reset.click();
    expect(range.value).toBe('4');
    expect(sentence()).toContain('At 4 h a week');
    expect(reset.hidden).toBe(true);
  });

  it('shows the teacher parts of a roadmap with a class block, and none without', async () => {
    const plain = await mount({ roadmap: own() });
    expect(plain.root.querySelector('.zs-b-sessions')).toBeNull();
    expect(text(plain.root, '[data-stop="class"] .zs-tag')).toContain('Pace');
    expect(plain.root.textContent).not.toContain('teacher note');
    plain.sections.destroy();
    document.body.replaceChildren();

    const taught = own((draft) => {
      draft.brief.audience = 'teacher';
      draft.class = {
        size: 24,
        ages: '14',
        sessionsPerWeek: 2,
        sessionMinutes: 45,
        weeks: 8,
        devices: 'shared',
        assessment: { mode: 'pass', note: 'A not yet can be repeated.' },
        handout: 'session',
        homework: true,
        sessions: [
          { n: 1, title: 'One', date: '2026-11-02', inClass: [] },
          { n: 2, title: 'Two', date: '2026-11-12', inClass: [] },
          { n: 3, title: 'Three', date: '2026-11-16', inClass: [] },
        ],
      };
      draft.stages[0].waypoints[0].teacherNote = 'Watch for the usual mix-up.';
    });
    const { root } = await mount({ roadmap: taught });
    const stop = root.querySelector('[data-stop="class"]') as HTMLElement;
    expect(text(stop, '.zs-tag')).toContain('Pace and sessions');
    expect(text(stop, '.zs-title')).toBe('Your class against the calendar.');
    expect(stop.querySelectorAll('.zs-b-session')).toHaveLength(3);
    expect(text(stop, '.zs-b-session.is-here')).toBe('2');
    expect(text(stop, '.zs-today:not(.zs-b-deadline) .zs-today-flag')).toBe('Class is here');
    const facts = text(stop, '.zs-facts');
    expect(facts).toContain('2 sessions a week of 45 minutes. The course runs for 8 weeks. 3 sessions are planned in the file.');
    expect(facts).toContain('24 students. Age: 14. Devices are shared in pairs.');
    expect(facts).toContain('Signpost tasks are marked as met or not yet. A not yet can be repeated.');
    expect(facts).toContain('1 step carries a teacher note. The student copy does not have it. A handout prints for each session. Homework is planned.');
  });

  it('names the mountain the file draws', async () => {
    const roadmap = own((draft) => (draft.map = { terrain: 'canyon', trail: 'traverse', surfaces: ['sand', 'rock'], signpost: 'cairn', seed: 'my-seed' }));
    const { root } = await mount({ roadmap });
    const stop = root.querySelector('[data-stop="map"]') as HTMLElement;
    expect(text(stop, '.zs-lede')).toContain('Canyon with a Traverse trail, drawn from the seed "my-seed".');
    expect([...stop.querySelectorAll('.zs-swatch')].map((node) => (node as HTMLElement).dataset.ground)).toEqual(['sand', 'rock']);
    expect(text(stop, '.zs-posts')).toContain('Cairn');
    expect(stop.textContent).toContain('The shape and the trail are set in the file.');
    expect(stop.textContent).toContain('This route climbs through 3 of the four.');
    // The map of the brief is the file's: it offers nothing to choose.
    expect(stop.querySelector('button')).toBeNull();
  });

  it('prints the two upkeep commands with the file names of this roadmap, and only the actions it was given', async () => {
    const copied: string[] = [];
    const ran: string[] = [];
    const { root } = await mount({ roadmap: own(), onCopy: (command) => copied.push(command), actions: { print: () => ran.push('print'), share: () => ran.push('share') } });
    const stop = root.querySelector('[data-stop="install"]') as HTMLElement;
    expect([...stop.querySelectorAll('.zs-cmd code')].map((node) => node.textContent)).toEqual([
      '/zero-to recheck rust-on-weeknights.roadmap.json',
      '/zero-to replan rust-on-weeknights.roadmap.json rust-on-weeknights-progress.json',
    ]);
    expect(text(stop, '.zs-state')).toBe('in date');
    const actions = [...stop.querySelectorAll('.zs-b-action')] as HTMLButtonElement[];
    expect(actions.map((button) => button.dataset.action)).toEqual(['print', 'share']);
    actions[1]?.click();
    expect(ran).toEqual(['share']);
    expect(BRIEF_ACTIONS).toContain('progress');
  });

  it('offers no action without a handler', async () => {
    const { root } = await mount({ roadmap: own() });
    expect(root.querySelector('.zs-b-action')).toBeNull();
    expect(root.querySelector('.zs-b-actions')).toBeNull();
  });

  it('opens with the gap lines and follows them with how to use the map', async () => {
    const roadmap = own();
    const gaps = gapLines(roadmap);
    const { root } = await mount({ roadmap });
    const items = [...root.querySelectorAll('[data-stop="questions"] details')] as HTMLDetailsElement[];
    expect(items).toHaveLength(gaps.length + USE_QUESTIONS);
    expect(items[0]?.open).toBe(true);
    expect(items.slice(0, gaps.length).every((item) => item.classList.contains('zs-b-gap'))).toBe(true);
    expect(root.querySelector('[data-stop="questions"]')?.textContent).toContain('No checked source with exercises was found.');
    expect(text(root, '[data-stop="questions"] .zs-lede')).toBe(`${gaps.length} steps carry a gap line: the agent could verify no source for them.`);
    expect(items[gaps.length]?.querySelector('summary')?.textContent).toBe('How do I walk the route?');
  });

  it('says so when a roadmap has no gap', async () => {
    const roadmap = own((draft) => {
      for (const stage of draft.stages) for (const step of stage.waypoints) delete step.gap;
    });
    const { root } = await mount({ roadmap });
    expect(root.querySelector('.zs-b-gap')).toBeNull();
    expect(text(root, '[data-stop="questions"] .zs-lede')).toBe('No step of this roadmap carries a gap line. The questions below are about the map.');
    expect(root.querySelectorAll('[data-stop="questions"] details')).toHaveLength(USE_QUESTIONS);
  });

  it('prints the arrival on the stub of the permit and hands the start to the page when it is torn', async () => {
    const started: unknown[] = [];
    const roadmap = own();
    const { root } = await mount({ roadmap, onStart: (choice) => started.push(choice) });
    const stop = root.querySelector('[data-stop="start"]') as HTMLElement;
    const day = stop.querySelector('.zs-b-day') as HTMLInputElement;
    // The start in the file has passed, so the permit proposes today.
    expect(day.value).toBe('2026-11-13');
    expect(text(stop, '.zs-b-arrival')).toBe('26 Jan 2027');
    expect(text(stop, '.zs-b-span')).toBe('11 weeks at 4 h a week');
    expect(text(stop, '.zs-b-date')).toBe('Your date: 28 Feb 2027');
    expect(text(stop, '.zs-b-route-title')).toBe('Rust on weeknights');
    expect(stop.querySelectorAll('.zs-bars rect')).toHaveLength(46);

    const ten = stop.querySelector('input[type="radio"][value="10"]') as HTMLInputElement;
    ten.checked = true;
    day.value = '2026-12-01';
    day.dispatchEvent(new Event('input', { bubbles: true }));
    expect(text(stop, '.zs-b-span')).toBe('5 weeks at 10 h a week');
    expect(planPace(roadmap, 10, '2026-12-01', '2026-11-13').arrival).toBe('2026-12-31');
    expect(text(stop, '.zs-b-arrival')).toBe('31 Dec 2026');

    (stop.querySelector('.zs-tear') as HTMLButtonElement).click();
    expect(started).toEqual([{ on: '2026-12-01', hoursPerWeek: 10 }]);
    expect(stop.querySelector('.zs-stub')?.classList.contains('is-torn')).toBe(true);
    expect(text(stop, '.zs-status')).toBe('Start set for 1 Dec 2026.');
    expect(stop.textContent).toContain('Your start day and hours are kept in this browser');
  });

  it('shows the plan of the permit at the pace stop once the page keeps the start', async () => {
    const { root } = await mount({ roadmap: own(), onStart: () => {} });
    const pace = root.querySelector('[data-stop="class"]') as HTMLElement;
    const stop = root.querySelector('[data-stop="start"]') as HTMLElement;
    expect(text(pace, '.zs-lede')).toContain('At 4 h a week the route takes 11 weeks. Starting on 2 Nov 2026');
    expect(text(pace, '.zs-facts')).toContain('2 Nov 2026, as the file says.');
    (stop.querySelector('input[type="radio"][value="10"]') as HTMLInputElement).checked = true;
    const day = stop.querySelector('.zs-b-day') as HTMLInputElement;
    day.value = '2026-12-01';
    day.dispatchEvent(new Event('input', { bubbles: true }));
    // Punching alone changes nothing above: the start is not set until the stub is torn.
    expect(text(pace, '.zs-lede')).toContain('Starting on 2 Nov 2026');
    (stop.querySelector('.zs-tear') as HTMLButtonElement).click();
    expect(text(pace, '.zs-lede')).toBe('At 10 h a week the route takes 5 weeks. Starting on 1 Dec 2026, you arrive on 31 Dec 2026. That is 59 days before your date, 28 Feb 2027.');
    expect(text(pace, '.zs-facts')).toContain('1 Dec 2026, the day on your permit.');
    expect((pace.querySelector('.zs-b-range') as HTMLInputElement).value).toBe('10');
    expect((pace.querySelector('.zs-b-reset') as HTMLElement).hidden).toBe(true);
  });

  it('starts from the plan the learner already has in this browser', async () => {
    const { root } = await mount({ roadmap: own(), onStart: () => {}, plan: { startDay: '2026-11-09', hoursPerWeek: 8, deadline: '2027-01-31' } });
    const pace = root.querySelector('[data-stop="class"]') as HTMLElement;
    expect(text(pace, '.zs-lede')).toContain('At 8 h a week the route takes 6 weeks. Starting on 9 Nov 2026');
    expect(text(pace, '.zs-lede')).toContain('your date, 31 Jan 2027.');
    expect(text(pace, '.zs-facts')).toContain('9 Nov 2026, the day on your permit.');
    expect(text(pace, '.zs-facts')).toContain('31 Jan 2027, the date in your own plan.');
    const stop = root.querySelector('[data-stop="start"]') as HTMLElement;
    expect((stop.querySelector('.zs-b-day') as HTMLInputElement).value).toBe('2026-11-09');
    expect((stop.querySelector('input[type="radio"]:checked') as HTMLInputElement).value).toBe('8');
    expect(text(root, '[data-stop="trail"] .zs-carry')).toContain('At 8 h a week that is 6 weeks.');
  });

  it('claims no start when the page gave it nowhere to keep one, and goes back to the table', async () => {
    const scrolled: number[] = [];
    const { root } = await mount({ roadmap: own(), scrollTo: (top) => scrolled.push(top) });
    const stop = root.querySelector('[data-stop="start"]') as HTMLElement;
    (stop.querySelector('.zs-tear') as HTMLButtonElement).click();
    expect(text(stop, '.zs-status')).toBe('Go on at the table at the top of the page.');
    expect(scrolled).toEqual([0]);
    // Nothing was kept, so the pace stop still shows the plan of the file.
    expect(text(root, '[data-stop="class"] .zs-facts')).toContain('2 Nov 2026, as the file says.');
    expect(stop.textContent).not.toContain('are kept in this browser');
  });

  it('does not tear a permit without a real start day', async () => {
    const started: unknown[] = [];
    const { root } = await mount({ roadmap: own(), onStart: (choice) => started.push(choice) });
    const stop = root.querySelector('[data-stop="start"]') as HTMLElement;
    const day = stop.querySelector('.zs-b-day') as HTMLInputElement;
    day.value = '';
    day.dispatchEvent(new Event('input', { bubbles: true }));
    (stop.querySelector('.zs-tear') as HTMLButtonElement).click();
    expect(started).toEqual([]);
    expect(text(stop, '.zs-status')).toBe('Choose a start day first.');
    expect(stop.querySelector('.zs-stub')?.classList.contains('is-torn')).toBe(false);
  });

  it('sets what a roadmap wrote as text, never as markup or marks', async () => {
    const roadmap = own((draft) => {
      draft.title = '<img src=x onerror=alert(1)> *bold* `code`';
      draft.summary = '<script>window.hacked = 1</script>';
      draft.stages[0].title = '<b>first</b>';
      source(draft, GATED).title = '<i>gated</i>';
    });
    const { root } = await mount({ roadmap });
    expect(root.querySelector('img, script')).toBeNull();
    // The only bold on the page is the number on a strip of the pace ruler.
    expect([...root.querySelectorAll('b')].every((node) => /^[0-9]+$/.test(node.textContent ?? ''))).toBe(true);
    expect(root.textContent).toContain('<b>first</b>');
    const title = root.querySelector('[data-stop="what"] .zs-title') as HTMLElement;
    expect(title.textContent).toBe('<img src=x onerror=alert(1)> *bold* `code`');
    expect(title.querySelector('em, code')).toBeNull();
    expect(text(root, '.zs-b-flag-title')).toContain('<i>gated</i>');
  });

  it('does not link a source whose address is not http or https', async () => {
    const roadmap = own((draft) => (source(draft, GATED).url = 'javascript:alert(1)'));
    const { root } = await mount({ roadmap });
    const first = root.querySelector('.zs-b-flag .zs-b-flag-title') as HTMLElement;
    expect(first.tagName).toBe('SPAN');
    expect(first.hasAttribute('href')).toBe(false);
  });

  it('changes between the two modes in place', async () => {
    const { root, sections } = await mount();
    expect(root.querySelector('.zs-brief')).toBeNull();
    sections.setRoadmap(own());
    await vi.waitFor(() => expect(root.querySelectorAll('.zs-stop.zs-brief')).toHaveLength(STOPS.length));
    expect(text(root, '[data-stop="what"] .zs-title')).toBe('Rust on weeknights');
    sections.setRoadmap(own((draft) => (draft.title = 'Another one')));
    expect(text(root, '[data-stop="what"] .zs-title')).toBe('Another one');
    sections.setRoadmap(null);
    expect(root.querySelector('.zs-brief')).toBeNull();
    expect(text(root, '[data-stop="what"] .zs-title')).toBe('A study plan you can walk.');
    expect(root.querySelector('.zs-tabs .zs-tab span:last-child')?.textContent).toBe('What');
  });

  it('shows nothing of the tour while the brief of a first roadmap is on its way', async () => {
    const root = document.createElement('main');
    document.body.append(root);
    mounted = mountSections(root, { lang: 'en', reduced: () => false, today: TODAY, roadmap: own() });
    // The page was mounted with a roadmap: the stops of the gallery never appear under it.
    expect(root.querySelector('.zs-stop')).toBeNull();
    expect(mounted.progressAt(500)).toBe(0);
    mounted.update(0.4);
    mounted.go('start');
    await vi.waitFor(() => expect(root.querySelectorAll('.zs-stop.zs-brief')).toHaveLength(STOPS.length));
  });

  it('builds the tour once when a roadmap is taken off before its brief has arrived', async () => {
    const { root, sections } = await mount();
    const first = root.querySelector('[data-stop="what"]');
    sections.setRoadmap(own());
    sections.setRoadmap(null);
    const second = root.querySelector('[data-stop="what"]');
    expect(second).not.toBe(first);
    expect(root.querySelector('.zs-brief')).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 60));
    // The brief has arrived by now. Nothing asked for it any more, so the page was left alone.
    expect(root.querySelector('[data-stop="what"]')).toBe(second);
    expect(root.querySelector('.zs-brief')).toBeNull();
  });

  it('speaks German when the page does, and keeps the roadmap in its own language', async () => {
    const roadmap = own();
    const { root, sections } = await mount({ roadmap });
    sections.setLang('de');
    await vi.waitFor(() => expect(root.lang).toBe('de'));
    await vi.waitFor(() => expect(root.querySelector('.zs-tabs .zs-tab span:last-child')?.textContent).toBe('Route'));
    expect([...root.querySelectorAll('.zs-tabs .zs-tab span:last-child')].map((tab) => tab.textContent)).toEqual(['Route', 'Quellen', 'Zahlen', 'Tempo', 'Karte', 'Pflege', 'Lücken']);
    expect(root.querySelectorAll('.zs-stop.zs-brief')).toHaveLength(STOPS.length);
    const title = root.querySelector('[data-stop="what"] .zs-title') as HTMLElement;
    expect(title.textContent).toBe('Rust on weeknights');
    expect(title.lang).toBe('en');
    expect(text(root, '[data-stop="what"] .zs-copy')).toContain('5 Etappen, ca. 42 Std., davon etwa');
    expect(text(root, '[data-stop="class"] .zs-lede')).toContain('Bei 4 Std. pro Woche dauert die Route 11 Wochen.');
    expect(text(root, '[data-stop="start"] .zs-title')).toBe('Loche deinen Start.');
    expect(root.textContent).not.toMatch(/\.\./);
  });

  it('builds the brief directly, in the order of the stops', async () => {
    const build = await loadBrief('en');
    expect(build).toBe(buildBrief);
    const views = build({ lang: 'en', idPrefix: 't-', state: { ticket: { topic: '', audience: 'self', hours: 5, defaults: false }, map: { shape: 'volcano', trail: 'spiral', theme: 'classic-topo', roll: 0 }, faq: 0 }, tested: {}, reduced: () => true }, own(), { today: TODAY });
    expect(views.map((view) => view.spec.id)).toEqual(STOPS.map((stop) => stop.id));
    expect(views.map((view) => view.nav)).toEqual(['Route', 'Sources', 'Counts', 'Pace', 'Map', 'Upkeep', 'Gaps', 'Start']);
    expect(views.every((view) => view.section.id.startsWith('t-'))).toBe(true);
    for (const view of views) view.dispose?.();
  });
});
