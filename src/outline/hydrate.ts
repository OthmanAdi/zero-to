/**
 * Brings a rendered or prerendered outline to life on a learner's session, so every learning action of the map
 * works in the list view too, with the keyboard alone and without WebGL.
 *
 * - Each step gets a "Done" checkbox and a button that swaps the reading text for the step's working card
 *   (predict, sources, check yourself, rating, take with you). Signposts and camps get the same button.
 * - The profile's pin, walked line, due rings and camp flags follow the session.
 * - "Continue", due reviews and the pace sit above the stages; the notebook and the exports below them.
 *
 * It uses the same Session as the 3D view and the same cards (WP5), so the two views never disagree. Nothing
 * here writes roadmap text as markup: every string goes in as text.
 */
import { uiLang, type UiLang } from '../i18n';
import { campCard } from '../learn/camp-card';
import { GO_EVENT, type GoDetail, type MountedCard } from '../learn/dom';
import { day as formatDay } from '../learn/format';
import { notebookPanel } from '../learn/notebook-panel';
import { paceChoices } from '../learn/pace-choices';
import { ratingName } from '../learn/rating';
import { reviewCard } from '../learn/review-card';
import type { Session } from '../learn/session';
import { signpostCard } from '../learn/signpost-card';
import { say as learnSay } from '../learn/strings';
import { waypointCard } from '../learn/waypoint-card';
import { serialiseProgress } from '../roadmap/progress';
import { calendarIcs } from './ics';
import { hasTeacherParts, studentCopy } from './student';
import { marksFor } from './marks';
import { roadmapToMarkdown } from './markdown';
import { anchor, profileCaption } from './outline';
import { printView, type PrintKind } from './print';
import { profileTree } from './profile';
import { say } from './strings';
import { ensureOutlineStyles } from './styles';
import { el, toDom } from './tree';

export interface HydrateOptions {
  readonly ui?: UiLang;
  /** Teacher tools: session pages and the student file. Default: on when the roadmap has teacher parts. */
  readonly teacher?: boolean;
  /**
   * Called when a card asks to go to a step or a stage. Without it the outline scrolls there itself and opens
   * that step's card.
   */
  readonly onGo?: (detail: GoDetail) => void;
  /** Replaces printing, for example in tests or to print through the director. */
  readonly print?: (kind: PrintKind) => void;
  /** Replaces the file download, for tests. */
  readonly download?: (name: string, text: string, type: string) => void;
}

export interface HydratedOutline {
  readonly root: HTMLElement;
  /** Refreshes every control from the session. Called on every session change by itself. */
  update(): void;
  /** Opens the working card of a step, signpost (stage id) or camp (stage id). */
  open(kind: 'step' | 'signpost' | 'camp', id: string): void;
  close(kind: 'step' | 'signpost' | 'camp', id: string): void;
  destroy(): void;
}

type ItemKind = 'step' | 'signpost' | 'camp';

interface Item {
  readonly kind: ItemKind;
  readonly id: string;
  readonly host: HTMLElement;
  readonly body: HTMLElement | null;
  readonly slot: HTMLElement;
  readonly toggle: HTMLButtonElement;
  readonly done: HTMLInputElement | null;
  readonly status: HTMLElement;
  readonly here: HTMLElement | null;
  card: MountedCard | null;
}

function saveFile(name: string, text: string, type: string): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function button(text: string, cls = 'zo-btn'): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = text;
  return b;
}

/** Finds the outline element: `root` itself or the first outline inside it. */
export function findOutline(root: ParentNode & Node): HTMLElement | null {
  if (root instanceof HTMLElement && root.hasAttribute('data-zo-outline')) return root;
  return root.querySelector<HTMLElement>('[data-zo-outline]');
}

export function hydrateOutline(root: HTMLElement, session: Session, options: HydrateOptions = {}): HydratedOutline {
  const outline = findOutline(root);
  if (!outline) throw new Error('hydrateOutline: no outline (data-zo-outline) in this element');
  const { roadmap } = session;
  if (outline.dataset.zoOutline !== roadmap.id) {
    throw new Error(`hydrateOutline: the outline shows "${outline.dataset.zoOutline}", the session holds "${roadmap.id}"`);
  }
  if (outline.dataset.zoHydrated !== undefined) throw new Error('hydrateOutline: this outline is already hydrated');
  outline.dataset.zoHydrated = '';
  ensureOutlineStyles(outline.ownerDocument);

  const ui = options.ui ?? uiLang();
  const teacher = options.teacher ?? hasTeacherParts(roadmap);
  const print = options.print ?? ((kind: PrintKind) => printView(kind, session, { ui }));
  const download = options.download ?? saveFile;
  const cleanups: (() => void)[] = [];
  const items: Item[] = [];
  const mounted: MountedCard[] = [];

  // ---- Working cards for steps, signposts and camps.
  const setup = (kind: ItemKind, host: HTMLElement, id: string): void => {
    const tools = host.querySelector<HTMLElement>(':scope > header [data-zo-tools]');
    const body = host.querySelector<HTMLElement>(':scope > [data-zo-body]');
    if (!tools) return;
    const titleId = host.querySelector(':scope > header :is(h2, h3)')?.id ?? '';
    const slot = document.createElement('div');
    slot.className = 'zo-card';
    slot.id = `${host.id || id}-card`;
    slot.hidden = true;
    host.append(slot);

    let done: HTMLInputElement | null = null;
    let here: HTMLElement | null = null;
    const row = document.createElement('div');
    row.className = 'zo-tools-row';
    if (kind === 'step') {
      here = document.createElement('span');
      here.className = 'zo-here';
      here.textContent = say('youAreHere', undefined, ui);
      here.hidden = true;
      done = document.createElement('input');
      done.type = 'checkbox';
      done.className = 'zo-done-box';
      done.dataset.zoDone = id;
      if (titleId) done.setAttribute('aria-describedby', titleId);
      const label = document.createElement('label');
      label.className = 'zo-done';
      const word = document.createElement('span');
      word.textContent = learnSay('done', undefined, ui);
      label.append(done, word);
      const box = done;
      box.addEventListener('change', () => session.done(id, box.checked));
      row.append(label);
    }
    const status = document.createElement('span');
    status.className = 'zo-status';
    status.setAttribute('aria-live', 'polite');
    const toggle = button(say(kind === 'step' ? 'workStep' : kind === 'signpost' ? 'workSignpost' : 'workCamp', undefined, ui), 'zo-btn zo-work');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', slot.id);
    if (titleId) toggle.setAttribute('aria-describedby', titleId);
    row.append(status, toggle);
    if (here) tools.append(here);
    tools.append(row);

    const item: Item = { kind, id, host, body, slot, toggle, done, status, here, card: null };
    toggle.addEventListener('click', () => (slot.hidden ? openItem(item) : closeItem(item, true)));
    slot.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      closeItem(item, true);
    });
    items.push(item);
  };

  const openItem = (item: Item): void => {
    if (!item.card) {
      item.card =
        item.kind === 'step'
          ? waypointCard(session, item.id, { headingLevel: 3 })
          : item.kind === 'signpost'
            ? signpostCard(session, item.id, { headingLevel: 3 })
            : campCard(session, item.id, { headingLevel: 3 });
      item.slot.append(item.card.root);
    }
    item.slot.hidden = false;
    if (item.body) item.body.hidden = true;
    item.host.toggleAttribute('data-open', true);
    item.toggle.setAttribute('aria-expanded', 'true');
    item.toggle.textContent = say('backToOutline', undefined, ui);
  };

  const closeItem = (item: Item, focus: boolean): void => {
    item.slot.hidden = true;
    if (item.body) item.body.hidden = false;
    item.host.toggleAttribute('data-open', false);
    item.toggle.setAttribute('aria-expanded', 'false');
    item.toggle.textContent = say(item.kind === 'step' ? 'workStep' : item.kind === 'signpost' ? 'workSignpost' : 'workCamp', undefined, ui);
    if (focus) item.toggle.focus({ preventScroll: true });
  };

  outline.querySelectorAll<HTMLElement>('[data-zo-step]').forEach((host) => setup('step', host, host.dataset.zoStep ?? ''));
  outline.querySelectorAll<HTMLElement>('[data-zo-signpost]').forEach((host) => setup('signpost', host, host.dataset.zoSignpost ?? ''));
  outline.querySelectorAll<HTMLElement>('[data-zo-camp]').forEach((host) => setup('camp', host, host.dataset.zoCamp ?? ''));

  const find = (kind: ItemKind, id: string): Item | undefined => items.find((i) => i.kind === kind && i.id === id);

  // ---- Going somewhere a card asked for.
  const go = (detail: GoDetail): void => {
    const target = detail.waypointId ? find('step', detail.waypointId) : undefined;
    if (target) {
      openItem(target);
      target.host.scrollIntoView?.({ block: 'start' });
      target.toggle.focus({ preventScroll: true });
      return;
    }
    if (detail.stageId) outline.ownerDocument.getElementById(anchor.stage(detail.stageId))?.scrollIntoView?.({ block: 'start' });
  };
  const onGoEvent = (event: Event): void => {
    const detail = (event as CustomEvent<GoDetail>).detail;
    if (!detail) return;
    if (options.onGo) options.onGo(detail);
    else go(detail);
  };
  outline.addEventListener(GO_EVENT, onGoEvent);
  cleanups.push(() => outline.removeEventListener(GO_EVENT, onGoEvent));

  // ---- Continue.
  const continueSlot = outline.querySelector<HTMLElement>('[data-zo-slot="continue"]');
  const continueBox = document.createElement('p');
  continueBox.className = 'zo-continue';
  continueSlot?.append(continueBox);
  let continueShows = '';
  const updateContinue = (): void => {
    const here = session.here();
    const signature = here ? here.waypointId : 'end';
    if (signature === continueShows) return;
    continueShows = signature;
    continueBox.replaceChildren();
    if (!here) {
      continueBox.textContent = learnSay('routeDone', undefined, ui);
      return;
    }
    const node = roadmap.stages.flatMap((s) => s.waypoints).find((w) => w.id === here.waypointId);
    if (!node) return;
    const link = document.createElement('a');
    link.className = 'zo-continue-link';
    link.href = `#${anchor.step(here.waypointId)}`;
    const word = document.createElement('span');
    word.className = 'zo-continue-word';
    word.textContent = say('continue', undefined, ui);
    const title = document.createElement('span');
    title.className = 'zo-continue-title';
    title.lang = roadmap.lang;
    title.dir = 'auto';
    title.textContent = node.title;
    link.append(word, ' ', title);
    link.addEventListener('click', (event) => {
      event.preventDefault();
      go({ waypointId: here.waypointId, stageId: here.stageId });
    });
    continueBox.append(link);
  };

  // ---- Reviews and pace above the stages; notebook and exports below them. The cards carry their own h2.
  const panel = (cls: string): HTMLElement => {
    const box = document.createElement('div');
    box.className = `zo-panel ${cls}`;
    return box;
  };
  const topSlot = outline.querySelector<HTMLElement>('[data-zo-slot="tools"]');
  const bottomSlot = outline.querySelector<HTMLElement>('[data-zo-slot="notebook"]');

  const reviewBox = panel('review');
  reviewBox.hidden = true;
  let review: MountedCard | null = null;
  const paceBox = panel('pace');
  const pace = paceChoices(session, { headingLevel: 2 });
  mounted.push(pace);
  paceBox.append(pace.root);
  topSlot?.append(reviewBox, paceBox);

  const notebookBox = panel('notebook');
  const notebook = notebookPanel(session, { headingLevel: 2, onPrint: () => print('notebook') });
  mounted.push(notebook);
  notebookBox.append(notebook.root);

  const toolsBox = toDom(
    el('section', { class: 'zo-panel tools', 'aria-labelledby': 'zo-tools-t' }, el('h2', { class: 'zo-panel-title', id: 'zo-tools-t' }, say('toolsTitle', undefined, ui))),
  ) as HTMLElement;
  const intro = document.createElement('p');
  intro.className = 'zo-hint';
  intro.textContent = say('toolsIntro', undefined, ui);
  const list = document.createElement('ul');
  list.className = 'zo-actions';
  const action = (text: string, run: () => void): HTMLButtonElement => {
    const b = button(text);
    b.addEventListener('click', run);
    const li = document.createElement('li');
    li.append(b);
    list.append(li);
    return b;
  };
  action(say('printTrailCard', undefined, ui), () => print('trail-card'));
  action(say('printOutline', undefined, ui), () => print('outline'));
  action(say('downloadMarkdown', undefined, ui), () =>
    download(`${roadmap.id}.md`, roadmapToMarkdown(roadmap, { ui, teacher: false }), 'text/markdown;charset=utf-8'),
  );
  action(say('downloadCalendar', undefined, ui), () => download(`${roadmap.id}.ics`, calendarIcs(session, { ui }), 'text/calendar;charset=utf-8'));
  action(say('downloadRoadmap', undefined, ui), () => download(`${roadmap.id}.json`, `${JSON.stringify(roadmap, null, 2)}\n`, 'application/json'));
  action(say('downloadProgress', undefined, ui), () =>
    download(`${roadmap.id}-progress.json`, `${serialiseProgress(session.progress)}\n`, 'application/json'),
  );
  if (teacher && (roadmap.class?.sessions?.length ?? 0) > 0) action(say('printSessions', undefined, ui), () => print('teacher'));
  if (teacher && hasTeacherParts(roadmap)) {
    action(say('downloadStudent', undefined, ui), () =>
      download(`${roadmap.id}-student.json`, `${JSON.stringify(studentCopy(roadmap).roadmap, null, 2)}\n`, 'application/json'),
    );
    const hint = document.createElement('p');
    hint.className = 'zo-hint';
    hint.textContent = say('studentHint', undefined, ui);
    toolsBox.append(intro, list, hint);
  } else {
    toolsBox.append(intro, list);
  }
  bottomSlot?.append(notebookBox, toolsBox);

  // ---- Profile and states.
  const profileHost = outline.querySelector<HTMLElement>('[data-zo-profile-svg]');
  const caption = outline.querySelector<HTMLElement>('[data-zo-profile-caption]');
  let profileShows = '';

  const update = (): void => {
    const today = session.today();
    const progress = session.progress;
    const sessionPace = session.pace(today);
    const started = progress.startedAt !== null || session.plan.startDay !== undefined;
    const marks = marksFor(roadmap, session.trek, progress, {
      today,
      pace: started && sessionPace.status === 'under-way' && sessionPace.expectedAlong > 0 ? sessionPace.expectedAlong : null,
    });
    const signature = JSON.stringify(marks);
    if (profileHost && signature !== profileShows) {
      profileShows = signature;
      profileHost.replaceChildren(toDom(profileTree(session.trek, marks, { ui })));
      if (caption) caption.textContent = profileCaption(roadmap, session.trek, ui, marks.here);
    }

    const here = session.here();
    const due = new Set(marks.due ?? []);
    for (const item of items) {
      if (item.kind === 'step') {
        const wp = progress.waypoints[item.id];
        const isDone = wp?.done === true;
        if (item.done && item.done.checked !== isDone) item.done.checked = isDone;
        const words: string[] = [];
        if (isDone && wp?.doneOn) words.push(learnSay('doneOn', { day: formatDay(wp.doneOn, { lang: ui }) }, ui));
        if (wp?.rating) words.push(ratingName(wp.rating));
        if (due.has(item.id)) words.push(learnSay('dueToday', undefined, ui));
        const text = words.join(' · ');
        if (item.status.textContent !== text) item.status.textContent = text;
        item.host.toggleAttribute('data-done', isDone);
        item.host.toggleAttribute('data-due', due.has(item.id));
        const isHere = here?.waypointId === item.id;
        item.host.toggleAttribute('data-here', isHere);
        if (item.here) item.here.hidden = !isHere;
      } else if (item.kind === 'signpost') {
        const stage = roadmap.stages.find((s) => s.id === item.id);
        const total = stage?.checkpoint.show.length ?? 0;
        const ticked = (progress.shows[item.id] ?? []).filter(Boolean).length;
        const passed = session.passed(item.id);
        const text = passed ? say('passed', undefined, ui) : learnSay('ticked', { count: Math.min(ticked, total), total }, ui);
        if (item.status.textContent !== text) item.status.textContent = text;
        item.host.toggleAttribute('data-passed', passed);
      } else {
        const stage = roadmap.stages.find((s) => s.id === item.id);
        const total = stage?.project?.rungs.length ?? 0;
        const text = learnSay('rungsDone', { count: progress.rungs[item.id] ?? 0, total }, ui);
        if (item.status.textContent !== text) item.status.textContent = text;
      }
    }

    outline.querySelectorAll<HTMLElement>('[data-zo-stage]').forEach((stageEl) => {
      const stage = roadmap.stages.find((s) => s.id === stageEl.dataset.zoStage);
      const line = stageEl.querySelector<HTMLElement>('[data-zo-stage-progress]');
      if (!stage || !line) return;
      const total = stage.waypoints.length;
      const doneCount = stage.waypoints.filter((w) => progress.waypoints[w.id]?.done === true).length;
      const passed = session.passed(stage.id);
      const text = doneCount === 0 && !passed ? '' : [say('stepsDone', { done: doneCount, total }, ui), passed ? say('passed', undefined, ui) : null].filter(Boolean).join(' · ');
      if (line.textContent !== text) line.textContent = text;
      stageEl.toggleAttribute('data-passed', passed);
    });

    updateContinue();
    const dueNow = session.due(today).length > 0;
    if (dueNow && !review) {
      review = reviewCard(session, null, { headingLevel: 2 });
      mounted.push(review);
      reviewBox.append(review.root);
    }
    reviewBox.hidden = !review;
  };

  const off = session.subscribe(() => update());
  cleanups.push(off);
  update();
  outline.classList.add('is-hydrated');

  return {
    root: outline,
    update,
    open(kind, id) {
      const item = find(kind, id);
      if (item) openItem(item);
    },
    close(kind, id) {
      const item = find(kind, id);
      if (item) closeItem(item, false);
    },
    destroy() {
      for (const fn of cleanups) fn();
      for (const item of items) item.card?.destroy();
      for (const card of mounted) card.destroy();
      outline.classList.remove('is-hydrated');
    },
  };
}
