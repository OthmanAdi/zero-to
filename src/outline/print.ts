/**
 * Paper: a one-page trail card, the field notebook as a handout and one page per class session for the teacher.
 * Each is built as a tree (so the build and tests can write it as text) and printed through a print root that
 * the print styles show alone. The outline itself prints with its own styles, links followed by their address.
 */
import { uiLang, type UiLang } from '../i18n';
import { day as formatDay, hours as formatHours } from '../learn/format';
import { safeUrl } from '../learn/notebook';
import type { NotebookEntry } from '../learn/notebook';
import type { SessionPace } from '../learn/pace';
import type { Session } from '../learn/session';
import { say as learnSay } from '../learn/strings';
import { reviewDue, type Trek } from '../roadmap/derive';
import { checkpointPassed, youAreHere, type Progress } from '../roadmap/progress';
import type { Resource, Roadmap } from '../roadmap/types';
import { marksFor } from './marks';
import { factsLine, tierName } from './outline';
import { profileTree } from './profile';
import { say } from './strings';
import { ensureOutlineStyles } from './styles';
import { el, road, toDom, toHtml, type ONode } from './tree';

export type PrintKind = 'trail-card' | 'outline' | 'notebook' | 'teacher';
export const PRINT_KINDS: readonly PrintKind[] = ['trail-card', 'outline', 'notebook', 'teacher'];

const SEP = ' · ';

export interface TrailCardInput {
  readonly roadmap: Roadmap;
  readonly trek: Trek;
  readonly progress: Progress;
  readonly today: string;
  readonly pace?: SessionPace | null;
  readonly ui?: UiLang;
}

function lines(count: number): ONode {
  return el('div', { class: 'zo-lines', 'aria-hidden': 'true' }, Array.from({ length: count }, () => el('span', { class: 'zo-line' })));
}

/** The trail card: one A4 page with where the learner is, every stage, the next step, due reviews and notes. */
export function trailCardTree(input: TrailCardInput): ONode {
  const { roadmap, trek, progress, today } = input;
  const ui = input.ui ?? uiLang();
  const lang = roadmap.lang;
  const pace = input.pace ?? null;
  const started = progress.startedAt ? progress.startedAt.slice(0, 10) : null;
  const marks = marksFor(roadmap, trek, progress, {
    today,
    pace: pace && started && pace.status === 'under-way' && pace.expectedAlong > 0 ? pace.expectedAlong : null,
  });
  const here = youAreHere(roadmap, progress);
  const node = here ? roadmap.stages.flatMap((s) => s.waypoints).find((w) => w.id === here.waypointId) : undefined;
  const main: Resource | undefined = node ? roadmap.resources.find((r) => r.id === node.resources[0]) : undefined;
  const mainUrl = main ? safeUrl(main.url) : null;
  const due = reviewDue(progress, roadmap, today).slice(0, 5);
  const doneMinutes = roadmap.stages.flatMap((s) => s.waypoints).reduce((sum, w) => sum + (progress.waypoints[w.id]?.done ? w.minutes : 0), 0);

  return el(
    'section',
    { class: 'zo-print-page zo-trail-card', lang: ui },
    el(
      'header',
      { class: 'zo-tc-head' },
      el('p', { class: 'zo-tc-brand' }, el('span', { class: 'zo-tc-word' }, 'zero-to'), SEP, say('trailCard', undefined, ui)),
      el('p', { class: 'zo-tc-date' }, say('printedOn', { day: formatDay(today, { lang: ui }) }, ui)),
    ),
    road('h2', roadmap.title, lang, { class: 'zo-tc-title' }),
    el('p', { class: 'zo-tc-facts' }, factsLine(roadmap, trek, ui)),
    el(
      'div',
      { class: 'zo-tc-who' },
      el('span', { class: 'zo-label' }, say('learner', undefined, ui)),
      el('span', { class: 'zo-tc-blank', 'aria-hidden': 'true' }),
      el('span', { class: 'zo-tc-started' }, started ? say('startedOn', { day: formatDay(started, { lang: ui }) }, ui) : say('notStarted', undefined, ui)),
    ),
    el(
      'figure',
      { class: 'zo-tc-profile' },
      profileTree(trek, marks, { ui, height: 230 }),
      el(
        'figcaption',
        { class: 'zo-tc-caption' },
        [
          say('walked', { done: formatHours(doneMinutes, { lang: ui, approx: false }), total: formatHours(trek.totalMinutes, { lang: ui }) }, ui),
          pace && pace.remainingMinutes > 0 ? say('arrival', { day: formatDay(pace.arrival, { lang: ui }) }, ui) : null,
        ]
          .filter((p): p is string => p !== null)
          .join(SEP),
      ),
    ),
    el(
      'table',
      { class: 'zo-tc-table' },
      el(
        'thead',
        null,
        el(
          'tr',
          null,
          el('th', { scope: 'col', class: 'zo-tc-n' }, '#'),
          el('th', { scope: 'col' }, say('stageCol', undefined, ui)),
          el('th', { scope: 'col' }, say('tierCol', undefined, ui)),
          el('th', { scope: 'col', class: 'zo-tc-num' }, say('timeCol', undefined, ui)),
          el('th', { scope: 'col', class: 'zo-tc-num' }, say('stepsCol', undefined, ui)),
          el('th', { scope: 'col' }, say('signpostCol', undefined, ui)),
        ),
      ),
      el(
        'tbody',
        null,
        roadmap.stages.map((stage, i) => {
          const doneCount = stage.waypoints.filter((w) => progress.waypoints[w.id]?.done).length;
          const passed = checkpointPassed(roadmap, progress, stage.id);
          const ticked = (progress.shows[stage.id] ?? []).filter(Boolean).length;
          return el(
            'tr',
            { 'data-tier': stage.tier, 'data-here': here?.stageId === stage.id ? '' : null },
            el('td', { class: 'zo-tc-n' }, String(i + 1)),
            road('td', stage.title, lang),
            el('td', null, el('span', { class: 'zo-tier-dot', 'aria-hidden': 'true' }), tierName(stage.tier, ui)),
            el('td', { class: 'zo-tc-num' }, formatHours(trek.stages[i]?.minutes ?? 0, { lang: ui, approx: false })),
            el('td', { class: 'zo-tc-num' }, `${doneCount}/${stage.waypoints.length}`),
            el(
              'td',
              null,
              passed ? say('passed', undefined, ui) : learnSay('ticked', { count: Math.min(ticked, stage.checkpoint.show.length), total: stage.checkpoint.show.length }, ui),
            ),
          );
        }),
      ),
    ),
    el(
      'div',
      { class: 'zo-tc-cols' },
      el(
        'section',
        { class: 'zo-tc-next' },
        el('h3', { class: 'zo-label' }, say('nextStep', undefined, ui)),
        node
          ? [
              road('p', node.title, lang, { class: 'zo-tc-step' }),
              road('p', node.do, lang, { class: 'zo-tc-task' }),
              main
                ? el(
                    'p',
                    { class: 'zo-tc-source' },
                    mainUrl ? el('a', { href: mainUrl, rel: 'noopener noreferrer', lang: main.lang, dir: 'auto' }, main.title) : road('span', main.title, main.lang),
                  )
                : null,
            ]
          : el('p', null, learnSay('routeDone', undefined, ui)),
      ),
      el(
        'section',
        { class: 'zo-tc-due' },
        el('h3', { class: 'zo-label' }, say('reviewsDue', undefined, ui)),
        due.length > 0
          ? el(
              'ul',
              { class: 'zo-list' },
              due.map((d) => el('li', null, road('span', d.title, lang), ` (${formatDay(d.due, { lang: ui })})`)),
            )
          : el('p', null, say('nothingDue', undefined, ui)),
      ),
    ),
    el('section', { class: 'zo-tc-notes' }, el('h3', { class: 'zo-label' }, say('notes', undefined, ui)), lines(4)),
    el('footer', { class: 'zo-tc-foot' }, say('cardFoot', undefined, ui)),
  );
}

export function trailCardHtml(input: TrailCardInput): string {
  return toHtml(trailCardTree(input));
}

/** The trail card of a session, as DOM. */
export function renderTrailCard(session: Session, options: { readonly ui?: UiLang } = {}): HTMLElement {
  const today = session.today();
  return toDom(
    trailCardTree({ roadmap: session.roadmap, trek: session.trek, progress: session.progress, today, pace: session.pace(today), ...(options.ui ? { ui: options.ui } : {}) }),
  ) as HTMLElement;
}

/** One printed page per class session: opener, the steps in class with tasks, teacher notes and answers, homework, exit. */
export function sessionPagesTree(roadmap: Roadmap, options: { readonly ui?: UiLang } = {}): ONode {
  const ui = options.ui ?? uiLang();
  const lang = roadmap.lang;
  const sessions = roadmap.class?.sessions ?? [];
  const steps = new Map(roadmap.stages.flatMap((s) => s.waypoints).map((w) => [w.id, w]));
  if (sessions.length === 0) return el('div', { class: 'zo-sessions-print', lang: ui }, el('p', null, say('noSessions', undefined, ui)));
  return el(
    'div',
    { class: 'zo-sessions-print', lang: ui },
    sessions.map((s) => {
      const inClass = s.inClass.map((id) => steps.get(id)).filter((w) => w !== undefined);
      return el(
        'section',
        { class: 'zo-print-page zo-session-page' },
        el('p', { class: 'zo-tc-brand' }, el('span', { class: 'zo-tc-word' }, 'zero-to'), SEP, road('span', roadmap.title, lang)),
        el(
          'h2',
          { class: 'zo-session-h' },
          el('span', { class: 'zo-label' }, [say('sessionOf', { n: s.n, total: sessions.length }, ui), s.date ? `${SEP}${formatDay(s.date, { lang: ui })}` : ''].join('')),
          ' ',
          road('span', s.title, lang),
        ),
        roadmap.class ? el('p', { class: 'zo-step-meta' }, say('minutesInClass', { time: formatHours(roadmap.class.sessionMinutes, { lang: ui, approx: false }) }, ui)) : null,
        s.opener ? [el('h3', { class: 'zo-label' }, say('opener', undefined, ui)), road('p', s.opener, lang)] : null,
        inClass.length > 0
          ? [
              el('h3', { class: 'zo-label' }, say('inClass', undefined, ui)),
              inClass.map((w) =>
                el(
                  'div',
                  { class: 'zo-session-step' },
                  el('h4', null, road('span', w.title, lang), el('span', { class: 'zo-step-meta' }, ` (${formatHours(w.minutes, { lang: ui })})`)),
                  road('p', w.do, lang, { class: 'zo-task' }),
                  w.teacherNote ? el('p', { class: 'zo-teacher' }, el('span', { class: 'zo-label' }, say('teacherNote', undefined, ui)), ' ', road('span', w.teacherNote, lang)) : null,
                  w.checks && w.checks.length > 0
                    ? el(
                        'ol',
                        { class: 'zo-checks' },
                        w.checks.map((c) => el('li', null, road('span', c.q, lang), c.answer ? [' ', el('span', { class: 'zo-label' }, learnSay('modelAnswer', undefined, ui)), ' ', road('span', c.answer, lang)] : null)),
                      )
                    : null,
                ),
              ),
            ]
          : null,
        s.homework && s.homework.length > 0
          ? [
              el('h3', { class: 'zo-label' }, say('homework', undefined, ui)),
              el(
                'ul',
                { class: 'zo-list' },
                s.homework.map((id) => {
                  const w = steps.get(id);
                  return w ? el('li', null, road('strong', w.title, lang), ': ', road('span', w.do, lang)) : el('li', null, id);
                }),
              ),
            ]
          : null,
        s.exit ? [el('h3', { class: 'zo-label' }, say('exit', undefined, ui)), road('p', s.exit, lang)] : null,
        s.materials && s.materials.length > 0
          ? [el('h3', { class: 'zo-label' }, say('materials', undefined, ui)), el('ul', { class: 'zo-list' }, s.materials.map((m) => road('li', m, lang)))]
          : null,
        el('h3', { class: 'zo-label' }, say('notes', undefined, ui)),
        lines(5),
      );
    }),
  );
}

/** The field notebook as a handout: the learner's entries in their order, grouped by stage and step. */
export function notebookHandoutTree(entries: readonly NotebookEntry[], roadmap: Roadmap, options: { readonly ui?: UiLang; readonly today: string }): ONode {
  const ui = options.ui ?? uiLang();
  const lang = roadmap.lang;
  const groups: { key: string; stage: string; step: string | null; items: NotebookEntry[] }[] = [];
  for (const entry of entries) {
    const index = roadmap.stages.findIndex((s) => s.id === entry.stageId);
    const stage = roadmap.stages[index];
    const step = entry.waypointId ? stage?.waypoints.find((w) => w.id === entry.waypointId) : undefined;
    const key = `${entry.stageId}:${entry.waypointId ?? ''}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(entry);
    else {
      groups.push({
        key,
        stage: stage ? `${learnSay('stageOf', { n: index + 1, total: roadmap.stages.length }, ui)}: ${stage.title}` : learnSay('otherPlace', undefined, ui),
        step: step ? step.title : stage?.project ? stage.project.title : null,
        items: [entry],
      });
    }
  }
  let lastStage = '';
  return el(
    'section',
    { class: 'zo-print-page zo-handout', lang: ui },
    el('p', { class: 'zo-tc-brand' }, el('span', { class: 'zo-tc-word' }, 'zero-to'), SEP, learnSay('notebookTitle', undefined, ui)),
    road('h2', roadmap.title, lang, { class: 'zo-tc-title' }),
    el('p', { class: 'zo-step-meta' }, say('handoutFor', { count: entries.length, day: formatDay(options.today, { lang: ui }) }, ui)),
    groups.map((g) => {
      const showStage = g.stage !== lastStage;
      lastStage = g.stage;
      return [
        showStage ? road('h3', g.stage, lang, { class: 'zo-handout-stage' }) : null,
        g.step ? road('h4', g.step, lang, { class: 'zo-handout-step' }) : null,
        el(
          'ul',
          { class: 'zo-handout-list' },
          g.items.map((entry) => {
            const url = entry.kind === 'link' ? safeUrl(entry.url) : null;
            return el(
              'li',
              { 'data-kind': entry.kind },
              el('span', { class: 'zo-label' }, learnSay(`kind.${entry.kind}` as 'kind.own', undefined, ui)),
              ' ',
              url
                ? el('a', { href: url, rel: 'noopener noreferrer', lang, dir: 'auto' }, entry.text)
                : entry.kind === 'own'
                  ? el('span', { dir: 'auto' }, entry.text)
                  : road('span', entry.text, lang),
            );
          }),
        ),
      ];
    }),
    lines(6),
  );
}

const PRINT_ROOT = 'zo-print-root';

/**
 * Puts what `kind` prints into the print root and marks the page, so the print styles show only that. Returns
 * the function that undoes it. Printing itself is left to the caller (`printView` calls the browser's dialog).
 */
export function preparePrint(kind: PrintKind, session: Session, options: { readonly ui?: UiLang } = {}): () => void {
  const doc = document;
  ensureOutlineStyles(doc);
  let root = doc.getElementById(PRINT_ROOT);
  if (!root) {
    root = doc.createElement('div');
    root.id = PRINT_ROOT;
    doc.body.append(root);
  }
  const ui = options.ui ?? uiLang();
  const today = session.today();
  if (kind === 'trail-card') root.replaceChildren(renderTrailCard(session, { ui }));
  else if (kind === 'teacher') root.replaceChildren(toDom(sessionPagesTree(session.roadmap, { ui })));
  else if (kind === 'notebook') root.replaceChildren(toDom(notebookHandoutTree(session.notebook.entries, session.roadmap, { ui, today })));
  else root.replaceChildren();
  doc.documentElement.dataset.print = kind;
  const target = root;
  return () => {
    if (doc.documentElement.dataset.print === kind) delete doc.documentElement.dataset.print;
    target.replaceChildren();
  };
}

/** Prints one of the four kinds through the browser's dialog and tidies up afterwards. */
export function printView(kind: PrintKind, session: Session, options: { readonly ui?: UiLang } = {}): void {
  const undo = preparePrint(kind, session, options);
  const after = (): void => {
    window.removeEventListener('afterprint', after);
    undo();
  };
  window.addEventListener('afterprint', after);
  window.print();
}
