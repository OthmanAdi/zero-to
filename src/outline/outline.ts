/**
 * The outline: a roadmap as a plain, calm reading page. It is the page's HTML before any script runs (what search
 * engines index and what a school computer without WebGL shows), the list view of the site, and the print.
 *
 * `outlineTree` builds it once; `outlineHtml` writes it as text for the build and `renderOutline` as DOM for the
 * browser, so both carry exactly the same text. Headings run h1 (title), h2 (stages, capstone, class), h3 (steps,
 * signposts, camps, sessions), h4 (parts of a step) and never skip a level.
 *
 * Every interactive control is added later by `hydrateOutline` into the places marked with `data-zo-*`.
 */
import { uiLang, type UiLang } from '../i18n';
import { day as formatDay, hours as formatHours } from '../learn/format';
import { safeUrl } from '../learn/notebook';
import { languageName, resourceLine, statusSentence } from '../learn/resources';
import { say as learnSay } from '../learn/strings';
import { deriveTrek, type Trek } from '../roadmap/derive';
import { emptyProgress, type Progress } from '../roadmap/progress';
import { TIER_NAMES } from '../scene/palette';
import type { Check, Resource, Roadmap, Stage, Waypoint } from '../roadmap/types';
import { hereAlong } from './marks';
import { profileTree, type ProfileMarks } from './profile';
import { say } from './strings';
import { ensureOutlineStyles } from './styles';
import { el, road, toDom, toHtml, type ONode } from './tree';

export interface OutlineOptions {
  /** Interface language of the labels. Roadmap text is always set in the roadmap's own language. */
  readonly ui?: UiLang;
  /** Teacher notes and the plan of each session (opener, exit question, materials). Default false. */
  readonly teacher?: boolean;
  /** Marks for the profile. Default: the pin at the roadmap's entry, nothing walked. */
  readonly marks?: ProfileMarks;
}

/** Anchors of the outline, so the map, the share link and the gallery can link into it. */
export const anchor = {
  stage: (id: string): string => `s-${id}`,
  step: (id: string): string => `w-${id}`,
  signpost: (stageId: string): string => `c-${stageId}`,
  camp: (stageId: string): string => `p-${stageId}`,
} as const;

const SEP = ' · ';

export function percent(share: number, ui: UiLang): string {
  return new Intl.NumberFormat(ui, { style: 'percent', maximumFractionDigits: 0 }).format(Math.max(0, Math.min(1, share)));
}

export function tierName(tier: string, ui: UiLang): string {
  return learnSay(`tier.${tier}` as 'tier.bronze', undefined, ui);
}

/** The highest tier the roadmap reaches. */
export function summitTier(roadmap: Roadmap): string {
  let top = 0;
  for (const stage of roadmap.stages) top = Math.max(top, TIER_NAMES.indexOf(stage.tier));
  return TIER_NAMES[top] ?? 'bronze';
}

/** "5 stages · about 42 h · up to Gold": the line under a roadmap's kicker, in the search pages too. */
export function factsLine(roadmap: Roadmap, trek: Trek, ui: UiLang): string {
  return [
    say('stages', { count: roadmap.stages.length }, ui),
    formatHours(trek.totalMinutes, { lang: ui }),
    say('upTo', { tier: tierName(summitTier(roadmap), ui) }, ui),
  ].join(SEP);
}

/** "Links opened on 13 Nov 2026 · 24 sources: 21 opened and kept, 2 behind a login or paywall". */
export function checkedLine(roadmap: Roadmap, ui: UiLang): string {
  const count = (status: string): number => roadmap.resources.filter((r) => r.check.status === status).length;
  const parts = [say('verifiedCount', { count: count('verified') }, ui)];
  if (count('gated') > 0) parts.push(say('gatedCount', { count: count('gated') }, ui));
  if (count('unverified') > 0) parts.push(say('unverifiedCount', { count: count('unverified') }, ui));
  return `${say('checkedOn', { day: formatDay(roadmap.checkedOn, { lang: ui }) }, ui)}${SEP}${say('sources', { count: roadmap.resources.length }, ui)}: ${parts.join(', ')}`;
}

/** The sentence under the profile. */
export function profileCaption(roadmap: Roadmap, trek: Trek, ui: UiLang, here?: number | null): string {
  const first = roadmap.stages[0]?.tier ?? 'bronze';
  const sentence = say(
    'profileDesc',
    {
      stages: say('stages', { count: roadmap.stages.length }, ui),
      time: formatHours(trek.totalMinutes, { lang: ui }),
      from: tierName(first, ui),
      to: tierName(summitTier(roadmap), ui),
    },
    ui,
  );
  if (here === null || here === undefined || here <= 0) return `${sentence} ${say('estimates', undefined, ui)}`;
  const where = here >= 1 ? say('profileDone', undefined, ui) : say('profileHere', { along: percent(here, ui) }, ui);
  return `${sentence} ${where} ${say('estimates', undefined, ui)}`;
}

function entryIndexOf(roadmap: Roadmap): number {
  const id = roadmap.brief.entry;
  const index = id === undefined ? 0 : roadmap.stages.findIndex((s) => s.id === id);
  return index < 0 ? 0 : index;
}

function head(roadmap: Roadmap, trek: Trek, ui: UiLang): ONode {
  const { brief, lang } = roadmap;
  const facts = [
    say(`audience.${brief.audience}`, undefined, ui),
    say(`start.${brief.startLevel}`, undefined, ui),
    say('perWeek', { hours: formatHours(brief.hoursPerWeek * 60, { lang: ui, approx: false, unit: 'hours' }) }, ui),
    brief.startDate ? say('startOn', { day: formatDay(brief.startDate, { lang: ui }) }, ui) : null,
    brief.deadline ? say('goalOn', { day: formatDay(brief.deadline, { lang: ui }) }, ui) : null,
  ].filter((f): f is string => f !== null);
  return el(
    'header',
    { class: 'zo-head' },
    el('p', { class: 'zo-kicker' }, el('span', { class: 'zo-kicker-word' }, say('kicker', undefined, ui)), SEP, factsLine(roadmap, trek, ui)),
    road('h1', roadmap.title, lang, { class: 'zo-title' }),
    roadmap.summary ? road('p', roadmap.summary, lang, { class: 'zo-summary' }) : null,
    brief.goal ? el('p', { class: 'zo-goal' }, el('span', { class: 'zo-label' }, say('goal', undefined, ui)), ' ', road('span', brief.goal, lang)) : null,
    el('p', { class: 'zo-checked' }, checkedLine(roadmap, ui)),
    el('ul', { class: 'zo-facts', 'aria-label': say('factsLabel', undefined, ui) }, facts.map((f) => el('li', null, f))),
    el('div', { class: 'zo-slot', 'data-zo-slot': 'continue' }),
  );
}

function profileFigure(roadmap: Roadmap, trek: Trek, ui: UiLang, marks: ProfileMarks): ONode {
  return el(
    'figure',
    { class: 'zo-profile', 'data-zo-profile': '' },
    el('div', { class: 'zo-profile-frame', 'data-zo-profile-svg': '' }, profileTree(trek, marks, { ui })),
    el('figcaption', { class: 'zo-profile-caption', 'data-zo-profile-caption': '' }, profileCaption(roadmap, trek, ui, marks.here)),
  );
}

function toc(roadmap: Roadmap, trek: Trek, ui: UiLang): ONode {
  return el(
    'nav',
    { class: 'zo-toc', 'aria-labelledby': 'zo-toc-title' },
    el('h2', { class: 'zo-toc-title zo-label', id: 'zo-toc-title' }, say('tocTitle', undefined, ui)),
    el(
      'ol',
      { class: 'zo-toc-list' },
      roadmap.stages.map((stage, i) =>
        el(
          'li',
          { class: 'zo-toc-item', 'data-tier': stage.tier },
          el(
            'a',
            { href: `#${anchor.stage(stage.id)}`, class: 'zo-toc-link' },
            el('span', { class: 'zo-toc-n' }, String(i + 1)),
            ' ',
            road('span', stage.title, roadmap.lang, { class: 'zo-toc-name' }),
            ' ',
            el(
              'span',
              { class: 'zo-toc-meta' },
              `${tierName(stage.tier, ui)}${SEP}${formatHours(trek.stages[i]?.minutes ?? 0, { lang: ui })}`,
            ),
          ),
        ),
      ),
    ),
  );
}

/** One source: a real link (http or https only), why it is on the list, what it costs and when it was opened. */
export function sourceItem(resource: Resource, roadmapLang: string, ui: UiLang, kind: string | null): ONode {
  const href = safeUrl(resource.url);
  const kindLine = [
    kind,
    learnSay(`type.${resource.type}` as 'type.docs', undefined, ui),
    resource.lang.split('-')[0] !== roadmapLang.split('-')[0] ? learnSay('inLang', { language: languageName(resource.lang, ui) }, ui) : null,
  ]
    .filter((p): p is string => p !== null)
    .join(SEP);
  const status = resource.check.status;
  const sentence = statusSentence(resource, ui);
  return el(
    'li',
    { class: 'zo-source', 'data-status': status },
    el('p', { class: 'zo-source-kind zo-label' }, kindLine),
    el(
      'p',
      { class: 'zo-source-head' },
      href
        ? el('a', { class: 'zo-source-title', href, rel: 'noopener noreferrer', lang: resource.lang, dir: 'auto' }, resource.title)
        : el('span', { class: 'zo-source-title is-unlinked', lang: resource.lang, dir: 'auto' }, resource.title),
      href ? null : el('span', { class: 'zo-source-nolink' }, ` (${say('noLink', undefined, ui)})`),
      resource.by ? el('span', { class: 'zo-source-by' }, SEP, road('span', resource.by, resource.lang)) : null,
    ),
    road('p', resource.why, roadmapLang, { class: 'zo-why' }),
    status !== 'verified'
      ? el(
          'p',
          { class: 'zo-source-flag' },
          el('span', { class: 'zo-flag-word' }, learnSay(status === 'gated' ? 'statusGated' : 'statusUnverified', undefined, ui)),
          ' ',
          sentence ?? '',
        )
      : null,
    status !== 'verified' && resource.check.note ? road('p', resource.check.note, roadmapLang, { class: 'zo-source-note' }) : null,
    el('p', { class: 'zo-source-line' }, resourceLine(resource, ui)),
  );
}

function sourcesList(roadmap: Roadmap, ids: readonly string[], ui: UiLang, mainFirst: boolean): ONode | null {
  const resources = ids.map((id) => roadmap.resources.find((r) => r.id === id)).filter((r): r is Resource => r !== undefined);
  if (resources.length === 0) return null;
  return el(
    'ul',
    { class: 'zo-sources' },
    resources.map((resource, i) =>
      sourceItem(resource, roadmap.lang, ui, mainFirst ? learnSay(i === 0 ? 'mainSource' : 'otherSource', undefined, ui) : null),
    ),
  );
}

function checksList(checks: readonly Check[] | undefined, lang: string, ui: UiLang): ONode | null {
  if (!checks || checks.length === 0) return null;
  return el(
    'ol',
    { class: 'zo-checks' },
    checks.map((check) =>
      el(
        'li',
        { class: 'zo-check' },
        road('p', check.q, lang, { class: 'zo-q' }),
        check.options && check.options.length > 0
          ? el('ul', { class: 'zo-options', 'aria-label': say('options', undefined, ui) }, check.options.map((o) => road('li', o, lang)))
          : null,
        check.answer.trim() === ''
          ? el('p', { class: 'zo-withheld' }, say('answerWithheld', undefined, ui))
          : el(
              'details',
              { class: 'zo-answer' },
              el('summary', null, say('showAnswer', undefined, ui)),
              road('p', check.answer, lang, { class: 'zo-answer-text' }),
            ),
      ),
    ),
  );
}

function stepItem(roadmap: Roadmap, stage: Stage, waypoint: Waypoint, index: number, ui: UiLang, teacher: boolean): ONode {
  const { lang } = roadmap;
  const id = anchor.step(waypoint.id);
  const sources = sourcesList(roadmap, waypoint.resources, ui, true);
  return el(
    'li',
    { class: 'zo-step', id, 'data-zo-step': waypoint.id, 'data-optional': waypoint.optional === true ? '' : null },
    el(
      'header',
      { class: 'zo-step-head' },
      el(
        'p',
        { class: 'zo-step-kicker zo-label' },
        learnSay('stepOf', { n: index + 1, total: stage.waypoints.length }, ui),
        waypoint.optional ? el('span', { class: 'zo-tag' }, learnSay('sideTrail', undefined, ui)) : null,
      ),
      road('h3', waypoint.title, lang, { class: 'zo-step-title', id: `${id}-t` }),
      el(
        'p',
        { class: 'zo-step-meta' },
        say(
          'stepMeta',
          {
            time: formatHours(waypoint.minutes, { lang: ui }),
            practice: formatHours(Math.min(waypoint.practiceMinutes, waypoint.minutes), { lang: ui, approx: false }),
          },
          ui,
        ),
      ),
      el('div', { class: 'zo-tools', 'data-zo-tools': '' }),
    ),
    el(
      'div',
      { class: 'zo-body', 'data-zo-body': '' },
      road('p', waypoint.note, lang, { class: 'zo-note' }),
      waypoint.predict
        ? el(
            'div',
            { class: 'zo-predict' },
            el('p', { class: 'zo-label' }, learnSay('predictTitle', undefined, ui)),
            road('p', waypoint.predict, lang, { class: 'zo-predict-q' }),
          )
        : null,
      el('h4', { class: 'zo-sub' }, learnSay('sources', undefined, ui)),
      sources,
      waypoint.gap
        ? el('div', { class: 'zo-gap' }, el('p', { class: 'zo-label' }, learnSay('noSource', undefined, ui)), road('p', waypoint.gap, lang))
        : sources
          ? null
          : el('p', { class: 'zo-gap zo-label' }, learnSay('noSource', undefined, ui)),
      el('h4', { class: 'zo-sub' }, learnSay('partDo', undefined, ui)),
      road('p', waypoint.do, lang, { class: 'zo-task' }),
      waypoint.checks && waypoint.checks.length > 0 ? el('h4', { class: 'zo-sub' }, learnSay('checksTitle', undefined, ui)) : null,
      checksList(waypoint.checks, lang, ui),
      waypoint.takeaways && waypoint.takeaways.length > 0
        ? [el('h4', { class: 'zo-sub' }, learnSay('keyPoints', undefined, ui)), el('ul', { class: 'zo-takeaways' }, waypoint.takeaways.map((t) => road('li', t, lang)))]
        : null,
      teacher && waypoint.teacherNote
        ? el('aside', { class: 'zo-teacher' }, el('p', { class: 'zo-label' }, say('teacherNote', undefined, ui)), road('p', waypoint.teacherNote, lang))
        : null,
    ),
  );
}

function signpost(roadmap: Roadmap, stage: Stage, ui: UiLang): ONode {
  const { checkpoint } = stage;
  const { lang } = roadmap;
  const id = anchor.signpost(stage.id);
  const need = Math.max(0, Math.min(checkpoint.show.length, Math.ceil((checkpoint.pass ?? 0.8) * checkpoint.show.length - 1e-9)));
  return el(
    'section',
    { class: 'zo-signpost', id, 'data-zo-signpost': stage.id, 'aria-labelledby': `${id}-t` },
    el(
      'header',
      { class: 'zo-item-head' },
      el('p', { class: 'zo-step-kicker zo-label' }, say('signpostAt', undefined, ui)),
      road('h3', checkpoint.title, lang, { class: 'zo-step-title', id: `${id}-t` }),
      el('p', { class: 'zo-step-meta' }, `${learnSay('signpostIntro', undefined, ui)} ${learnSay('passRule', { count: need, total: checkpoint.show.length }, ui)}`),
      el('div', { class: 'zo-tools', 'data-zo-tools': '' }),
    ),
    el(
      'div',
      { class: 'zo-body', 'data-zo-body': '' },
      el('h4', { class: 'zo-sub' }, learnSay('canShow', undefined, ui)),
      el('ul', { class: 'zo-show' }, checkpoint.show.map((item) => road('li', item, lang))),
      checkpoint.checks && checkpoint.checks.length > 0 ? el('h4', { class: 'zo-sub' }, learnSay('testYourself', undefined, ui)) : null,
      checksList(checkpoint.checks, lang, ui),
    ),
  );
}

function camp(roadmap: Roadmap, stage: Stage, ui: UiLang): ONode | null {
  const project = stage.project;
  if (!project) return null;
  const { lang } = roadmap;
  const id = anchor.camp(stage.id);
  const meta = [project.minutes ? formatHours(project.minutes, { lang: ui }) : null, project.capstone ? learnSay('capstone', undefined, ui) : null]
    .filter((p): p is string => p !== null)
    .join(SEP);
  return el(
    'section',
    { class: 'zo-camp', id, 'data-zo-camp': stage.id, 'aria-labelledby': `${id}-t` },
    el(
      'header',
      { class: 'zo-item-head' },
      el('p', { class: 'zo-step-kicker zo-label' }, say('campAt', undefined, ui)),
      road('h3', project.title, lang, { class: 'zo-step-title', id: `${id}-t` }),
      meta ? el('p', { class: 'zo-step-meta' }, meta) : null,
      el('div', { class: 'zo-tools', 'data-zo-tools': '' }),
    ),
    el(
      'div',
      { class: 'zo-body', 'data-zo-body': '' },
      road('p', project.brief, lang, { class: 'zo-note' }),
      el('h4', { class: 'zo-sub' }, learnSay('rungs', undefined, ui)),
      el('p', { class: 'zo-hint' }, say('rungsIntro', undefined, ui)),
      el(
        'ol',
        { class: 'zo-rungs' },
        project.rungs.map((rung) =>
          el('li', { class: 'zo-rung' }, el('span', { class: 'zo-label' }, learnSay(`rung.${rung.level}` as 'rung.own', undefined, ui)), ' ', road('span', rung.task, lang)),
        ),
      ),
      project.choices && project.choices.length > 0
        ? [el('h4', { class: 'zo-sub' }, learnSay('choices', undefined, ui)), el('ul', { class: 'zo-list' }, project.choices.map((c) => road('li', c, lang)))]
        : null,
      project.criteria && project.criteria.length > 0
        ? [el('h4', { class: 'zo-sub' }, learnSay('criteria', undefined, ui)), el('ul', { class: 'zo-list zo-criteria' }, project.criteria.map((c) => road('li', c, lang)))]
        : null,
      project.resources && project.resources.length > 0
        ? [el('h4', { class: 'zo-sub' }, learnSay('campSources', undefined, ui)), sourcesList(roadmap, project.resources, ui, false)]
        : null,
    ),
  );
}

function stageSection(roadmap: Roadmap, trek: Trek, stage: Stage, i: number, ui: UiLang, teacher: boolean): ONode {
  const t = trek.stages[i];
  const id = anchor.stage(stage.id);
  const entry = entryIndexOf(roadmap);
  const practice = t && t.minutes > 0 ? t.practiceMinutes / t.minutes : 0;
  return el(
    'section',
    { class: 'zo-stage', id, 'data-zo-stage': stage.id, 'data-tier': stage.tier, 'aria-labelledby': `${id}-t` },
    el(
      'header',
      { class: 'zo-stage-head' },
      el(
        'p',
        { class: 'zo-stage-kicker zo-label' },
        learnSay('stageOf', { n: i + 1, total: roadmap.stages.length }, ui),
        i === entry && entry > 0 ? el('span', { class: 'zo-tag zo-tag-entry' }, say('entryStage', undefined, ui)) : null,
        i < entry ? el('span', { class: 'zo-tag' }, say('beforeEntry', undefined, ui)) : null,
      ),
      road('h2', stage.title, roadmap.lang, { class: 'zo-stage-title', id: `${id}-t` }),
      el(
        'p',
        { class: 'zo-stage-meta' },
        el('span', { class: 'zo-tier-dot', 'aria-hidden': 'true' }),
        say(
          'stageMeta',
          {
            tier: tierName(stage.tier, ui),
            time: formatHours(t?.minutes ?? 0, { lang: ui }),
            practice: say('handsOn', { share: percent(practice, ui) }, ui),
          },
          ui,
        ),
      ),
      stage.summary ? road('p', stage.summary, roadmap.lang, { class: 'zo-stage-summary' }) : null,
      el('p', { class: 'zo-stage-progress', 'data-zo-stage-progress': '' }),
    ),
    el('ol', { class: 'zo-steps' }, stage.waypoints.map((w, n) => stepItem(roadmap, stage, w, n, ui, teacher))),
    signpost(roadmap, stage, ui),
    camp(roadmap, stage, ui),
  );
}

function capstone(roadmap: Roadmap, ui: UiLang): ONode | null {
  if (!roadmap.capstone) return null;
  return el(
    'section',
    { class: 'zo-capstone', id: 'capstone', 'aria-labelledby': 'capstone-t' },
    el('p', { class: 'zo-stage-kicker zo-label' }, say('capstoneTitle', undefined, ui)),
    road('h2', roadmap.capstone.title, roadmap.lang, { class: 'zo-stage-title', id: 'capstone-t' }),
    road('p', roadmap.capstone.brief, roadmap.lang, { class: 'zo-note' }),
    el('p', { class: 'zo-hint' }, say('capstoneIntro', undefined, ui)),
  );
}

function stepTitle(roadmap: Roadmap, id: string): string | null {
  for (const stage of roadmap.stages) for (const w of stage.waypoints) if (w.id === id) return w.title;
  return null;
}

function stepLinks(roadmap: Roadmap, ids: readonly string[]): ONode {
  return el(
    'ul',
    { class: 'zo-list' },
    ids.map((id) => {
      const title = stepTitle(roadmap, id);
      return el('li', null, title ? el('a', { href: `#${anchor.step(id)}`, lang: roadmap.lang, dir: 'auto' }, title) : id);
    }),
  );
}

function classPlan(roadmap: Roadmap, ui: UiLang, teacher: boolean): ONode | null {
  const plan = roadmap.class;
  const sessions = plan?.sessions ?? [];
  if (!plan || sessions.length === 0) return null;
  const { lang } = roadmap;
  return el(
    'section',
    { class: 'zo-class', id: 'class-plan', 'aria-labelledby': 'class-plan-t' },
    el('h2', { class: 'zo-stage-title', id: 'class-plan-t' }, say('classTitle', undefined, ui)),
    el(
      'p',
      { class: 'zo-stage-meta' },
      say(
        'classFacts',
        {
          size: plan.size,
          perWeek: String(plan.sessionsPerWeek),
          minutes: formatHours(plan.sessionMinutes, { lang: ui, approx: false }),
        },
        ui,
      ),
    ),
    plan.assessment?.note ? road('p', plan.assessment.note, lang, { class: 'zo-hint' }) : null,
    el(
      'ol',
      { class: 'zo-sessions' },
      sessions.map((s) =>
        el(
          'li',
          { class: 'zo-session', id: `session-${s.n}` },
          el(
            'h3',
            { class: 'zo-session-title' },
            el('span', { class: 'zo-label' }, [say('sessionTitle', { n: s.n }, ui), s.date ? `${SEP}${formatDay(s.date, { lang: ui })}` : ''].join('')),
            ' ',
            road('span', s.title, lang),
          ),
          teacher && s.opener ? el('p', null, el('span', { class: 'zo-label' }, say('opener', undefined, ui)), ' ', road('span', s.opener, lang)) : null,
          s.inClass.length > 0 ? [el('p', { class: 'zo-label' }, say('inClass', undefined, ui)), stepLinks(roadmap, s.inClass)] : null,
          s.homework && s.homework.length > 0 ? [el('p', { class: 'zo-label' }, say('homework', undefined, ui)), stepLinks(roadmap, s.homework)] : null,
          teacher && s.exit ? el('p', null, el('span', { class: 'zo-label' }, say('exit', undefined, ui)), ' ', road('span', s.exit, lang)) : null,
          teacher && s.materials && s.materials.length > 0
            ? [el('p', { class: 'zo-label' }, say('materials', undefined, ui)), el('ul', { class: 'zo-list' }, s.materials.map((m) => road('li', m, lang)))]
            : null,
        ),
      ),
    ),
  );
}

/** The whole outline as a tree. */
export function outlineTree(roadmap: Roadmap, options: OutlineOptions = {}): ONode {
  const ui = options.ui ?? uiLang();
  const teacher = options.teacher === true;
  const trek = deriveTrek(roadmap);
  const marks = options.marks ?? { here: hereAlong(trek, roadmap, emptyProgress(roadmap.id) as Progress) };
  return el(
    'article',
    { class: 'zo-outline', 'data-zo-outline': roadmap.id, 'data-teacher': teacher ? '' : null, lang: ui },
    head(roadmap, trek, ui),
    profileFigure(roadmap, trek, ui, marks),
    toc(roadmap, trek, ui),
    el('div', { class: 'zo-slot', 'data-zo-slot': 'tools' }),
    roadmap.stages.map((stage, i) => stageSection(roadmap, trek, stage, i, ui, teacher)),
    capstone(roadmap, ui),
    classPlan(roadmap, ui, teacher),
    el('div', { class: 'zo-slot', 'data-zo-slot': 'notebook' }),
    el('footer', { class: 'zo-foot' }, el('p', null, say('footer', undefined, ui)), el('p', null, say('estimates', undefined, ui))),
  );
}

/** The outline as HTML text, for the build. Same markup and text as `renderOutline`. */
export function outlineHtml(roadmap: Roadmap, options: OutlineOptions = {}): string {
  return toHtml(outlineTree(roadmap, options));
}

/** The outline as a DOM element. Same markup and text as `outlineHtml`. */
export function renderOutline(roadmap: Roadmap, options: OutlineOptions = {}, doc: Document = document): HTMLElement {
  ensureOutlineStyles(doc);
  return toDom(outlineTree(roadmap, options), doc) as HTMLElement;
}
