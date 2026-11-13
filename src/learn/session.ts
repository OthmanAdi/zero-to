/**
 * One learner on one roadmap: the roadmap, its trek, the learner's progress, plan and notebook, and the clock.
 *
 * The session is the only writer of progress. Every action goes through the roadmap package's update functions,
 * is saved at once and is announced to subscribers, so the map, the list view and every card show the same state.
 */
import { addDays } from '../roadmap/dates';
import { deriveTrek, reviewDue, reviewGaps, type ReviewItem, type Trek } from '../roadmap/derive';
import { allWaypoints, type WaypointNode } from '../roadmap/graph';
import {
  checkpointPassed,
  loadProgressOrEmpty,
  markDone,
  markNotDone,
  parseProgress,
  recordAnswer,
  recordReview,
  serialiseProgress,
  setEntry,
  setNote,
  setRating,
  setRung,
  setShow,
  youAreHere,
  type CheckAnswer,
  type Position,
  type Progress,
  type Rating,
} from '../roadmap/progress';
import type { Roadmap, Stage } from '../roadmap/types';
import { createNotebook, type Notebook, type NotebookDraft, type NotebookEntry } from './notebook';
import { applyPlan, paceChoices, paceWith, parsePlan, type PaceChoice, type Plan, type PlanChange, type SessionPace } from './pace';
import { safeStore, type SafeStore, type StorageLike, type StorageState } from './storage';

export const progressKey = (roadmapId: string): string => `zero-to:progress:${roadmapId}`;
export const planKey = (roadmapId: string): string => `zero-to:plan:${roadmapId}`;

/** Private notes are capped at this many characters. */
export const NOTE_MAX = 2000;

export type SessionChange =
  | { readonly type: 'progress'; readonly action: SessionAction; readonly id: string }
  | { readonly type: 'notebook' }
  | { readonly type: 'plan' }
  | { readonly type: 'storage'; readonly state: StorageState };

export type SessionAction = 'done' | 'rate' | 'answer' | 'show' | 'rung' | 'review' | 'note' | 'start';

export interface StartOptions {
  /** The start day the learner chose, YYYY-MM-DD. Default: today. */
  readonly on?: string;
  readonly hoursPerWeek?: number;
  /** Stage id for the red pin; null goes back to the roadmap's own entry. */
  readonly entry?: string | null;
}

export interface Session {
  readonly roadmap: Roadmap;
  readonly trek: Trek;
  readonly progress: Progress;
  readonly plan: Plan;
  readonly notebook: Notebook;
  /** Where progress is kept. `memory` means it lasts for this visit only, and the cards say so. */
  readonly storage: StorageState;
  /** The current time, ISO. */
  now(): string;
  /** The current day, YYYY-MM-DD. */
  today(): string;
  subscribe(listener: (change: SessionChange) => void): () => void;

  here(): Position | null;
  pace(today?: string): SessionPace;
  /** The ways to make the plan fit its date, for `paceChoices`. */
  choices(today?: string): PaceChoice[];
  due(today?: string): ReviewItem[];
  passed(stageId: string): boolean;

  done(waypointId: string, value?: boolean): void;
  rate(waypointId: string, rating: Rating | null): void;
  answer(key: string, answer: Omit<CheckAnswer, 'at'>): void;
  show(stageId: string, index: number, value: boolean): void;
  rung(stageId: string, rungsDone: number): void;
  review(waypointId: string, ok: boolean): void;
  note(id: string, text: string): void;
  pin(draft: NotebookDraft): NotebookEntry | null;
  unpin(entryId: string): void;
  start(options?: StartOptions): void;
  /** Changes the learner's plan for this browser; null goes back to the roadmap's plan. */
  replan(change: PlanChange | null): void;

  /** Stops listening to the page. Subscribers are dropped. */
  destroy(): void;
}

export interface SessionOptions {
  /** The clock. Default: the real time. A day string means noon of that day. */
  readonly clock?: () => Date | string;
  /** Write once more on `pagehide`. Default: true when there is a window. */
  readonly saveOnPageHide?: boolean;
}

function isoFrom(value: Date | string): string {
  if (typeof value !== 'string') return value.toISOString();
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00.000Z` : new Date(value).toISOString();
}

/** The waypoint and where it sits, or undefined. */
export function findWaypoint(roadmap: Roadmap, waypointId: string): WaypointNode | undefined {
  return allWaypoints(roadmap).find((node) => node.waypoint.id === waypointId);
}

export function findStage(roadmap: Roadmap, stageId: string): { readonly stage: Stage; readonly index: number } | undefined {
  const index = roadmap.stages.findIndex((s) => s.id === stageId);
  const stage = roadmap.stages[index];
  return stage ? { stage, index } : undefined;
}

/**
 * Opens a session. `storage` is where progress, plan and notebook are kept: `undefined` uses `localStorage`,
 * `null` keeps everything in memory. A storage that is missing or throws falls back to memory, and `storage` on
 * the session says so.
 */
export function createSession(roadmap: Roadmap, storage?: StorageLike | SafeStore | null, options: SessionOptions = {}): Session {
  const store = safeStore(storage);
  const clock = options.clock ?? (() => new Date());
  const now = (): string => isoFrom(clock());
  const today = (): string => now().slice(0, 10);
  const trek = deriveTrek(roadmap);
  const listeners = new Set<(change: SessionChange) => void>();

  const pKey = progressKey(roadmap.id);
  const stored = store.read(pKey);
  let progress = loadProgressOrEmpty(stored, roadmap.id, roadmap.checkedOn);
  if (stored && !parseProgress(stored, roadmap.id).ok) {
    // Unreadable progress is set aside once instead of being overwritten by the first new tick.
    store.write(`${pKey}:unreadable`, stored);
  }
  let plan = parsePlan(store.read(planKey(roadmap.id)));
  const notebook = createNotebook(store, roadmap.id, { now });

  const emit = (change: SessionChange): void => {
    for (const listener of [...listeners]) listener(change);
  };
  const saveProgress = (): void => {
    store.write(pKey, serialiseProgress(progress));
  };
  const commit = (next: Progress, action: SessionAction, id: string): void => {
    if (next === progress) return;
    progress = next;
    saveProgress();
    emit({ type: 'progress', action, id });
  };

  const unFallback = store.onFallback((state) => emit({ type: 'storage', state }));
  const unNotebook = notebook.subscribe(() => emit({ type: 'notebook' }));
  const pageHide = (): void => saveProgress();
  const listen = options.saveOnPageHide ?? typeof window !== 'undefined';
  if (listen && typeof window !== 'undefined') window.addEventListener('pagehide', pageHide);

  const isWaypoint = (id: string): boolean => findWaypoint(roadmap, id) !== undefined;

  const session: Session = {
    roadmap,
    trek,
    get progress() {
      return progress;
    },
    get plan() {
      return plan;
    },
    notebook,
    get storage() {
      return store.state;
    },
    now,
    today,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    here: () => youAreHere(roadmap, progress),
    pace: (day) => paceWith(roadmap, progress, plan, day ?? today()),
    choices: (day) => paceChoices(roadmap, progress, plan, day ?? today()),
    due: (day) => reviewDue(progress, roadmap, day ?? today()),
    passed: (stageId) => checkpointPassed(roadmap, progress, stageId),

    done(waypointId, value = true) {
      if (!isWaypoint(waypointId)) return;
      commit(value ? markDone(progress, roadmap, waypointId, now()) : markNotDone(progress, waypointId, now()), 'done', waypointId);
    },
    rate(waypointId, rating) {
      if (!isWaypoint(waypointId)) return;
      let next = setRating(progress, waypointId, rating, now());
      // A rating given after "Done" still shapes the first review: a shaky step comes back sooner.
      const wp = next.waypoints[waypointId];
      const node = findWaypoint(roadmap, waypointId);
      if (wp?.done && wp.doneOn && wp.reviews.length === 0 && (node?.waypoint.checks?.length ?? 0) > 0) {
        const due = addDays(wp.doneOn, reviewGaps(roadmap.reviewDays, wp.rating)[0] as number);
        if (due !== wp.due) next = { ...next, waypoints: { ...next.waypoints, [waypointId]: { ...wp, due } } };
      }
      commit(next, 'rate', waypointId);
    },
    answer(key, answer) {
      if (key === '') return;
      commit(recordAnswer(progress, key, answer, now()), 'answer', key);
    },
    show(stageId, index, value) {
      const found = findStage(roadmap, stageId);
      if (!found || index < 0 || index >= found.stage.checkpoint.show.length) return;
      commit(setShow(progress, stageId, index, value, now()), 'show', stageId);
    },
    rung(stageId, rungsDone) {
      const found = findStage(roadmap, stageId);
      const max = found?.stage.project?.rungs.length ?? 0;
      if (!found || max === 0) return;
      commit(setRung(progress, stageId, Math.max(0, Math.min(max, Math.round(rungsDone))), now()), 'rung', stageId);
    },
    review(waypointId, ok) {
      commit(recordReview(progress, roadmap, waypointId, ok, now()), 'review', waypointId);
    },
    note(id, text) {
      const clipped = Array.from(text).slice(0, NOTE_MAX).join('');
      if ((progress.notes[id] ?? '') === (clipped.trim() === '' ? '' : clipped)) return;
      commit(setNote(progress, id, clipped, now()), 'note', id);
    },
    pin: (draft) => notebook.add(draft),
    unpin(entryId) {
      notebook.remove(entryId);
    },
    start(startOptions = {}) {
      const at = now();
      const day = startOptions.on ?? at.slice(0, 10);
      let next: Progress = { ...progress, startedAt: `${day}T00:00:00.000Z`, updatedAt: at };
      if (startOptions.entry !== undefined) next = setEntry(next, startOptions.entry, at);
      commit(next, 'start', roadmap.id);
      const change: PlanChange = { startDay: day, ...(startOptions.hoursPerWeek ? { hoursPerWeek: startOptions.hoursPerWeek } : {}) };
      plan = applyPlan(plan, change);
      store.write(planKey(roadmap.id), JSON.stringify(plan));
      emit({ type: 'plan' });
    },
    replan(change) {
      const keepStart = plan.startDay;
      plan = applyPlan(plan, change);
      if (change === null && keepStart) plan = { startDay: keepStart };
      store.write(planKey(roadmap.id), JSON.stringify(plan));
      emit({ type: 'plan' });
    },

    destroy() {
      listeners.clear();
      unFallback();
      unNotebook();
      if (typeof window !== 'undefined') window.removeEventListener('pagehide', pageHide);
    },
  };
  return session;
}
