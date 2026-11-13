/**
 * What one learner did on one roadmap, kept in one browser. The roadmap file is never changed by it, so a teacher
 * can share one roadmap with a whole class and every learner still has a private progress.
 *
 * This module holds the model and pure update functions only. Every update takes the current time as an ISO
 * timestamp (`now`) so the functions stay predictable; a later module stores the result.
 */
import { addDays, isRealDay, toDay } from './dates';
import { reviewGaps } from './derive';
import { allWaypoints, stageRequires, waypointRequires } from './graph';
import { DEFAULT_PASS_SHARE, type Roadmap } from './types';

export const PROGRESS_VERSION = 1;

/** Self-rating, the four steps that carry the tier names: saw it, did it with the guide, alone, could explain it. */
export type Rating = 1 | 2 | 3 | 4;
export const RATING_NAMES: readonly string[] = ['saw it', 'did it with the guide', 'did it alone', 'could explain it'];

export interface ReviewEntry {
  /** The day of the review, YYYY-MM-DD. */
  readonly on: string;
  /** True when the learner got the checks right. */
  readonly ok: boolean;
}

export interface WaypointProgress {
  readonly done: boolean;
  /** The day it was finished. */
  readonly doneOn?: string;
  readonly rating?: Rating;
  readonly reviews: readonly ReviewEntry[];
  /** The next review day; null when the review series is finished. Absent when there is nothing to review. */
  readonly due?: string | null;
}

export interface CheckAnswer {
  /** When it was answered, ISO timestamp. */
  readonly at: string;
  /** Index of the chosen option, for multiple-choice checks. */
  readonly choice?: number;
  /** Free text, for checks answered in words. */
  readonly text?: string;
  readonly correct?: boolean;
}

export interface Progress {
  readonly version: typeof PROGRESS_VERSION;
  /** The id of the roadmap this belongs to. */
  readonly roadmap: string;
  /** The roadmap's `checkedOn` when this progress began, to notice a refreshed roadmap. */
  readonly checkedOn: string | null;
  /** Stage id where the learner put the red pin; null means the roadmap's own entry. */
  readonly entry: string | null;
  readonly startedAt: string | null;
  readonly updatedAt: string | null;
  readonly waypoints: Readonly<Record<string, WaypointProgress>>;
  /** Per stage: which `show` items of the checkpoint are ticked. */
  readonly shows: Readonly<Record<string, readonly boolean[]>>;
  /** Per stage: how many project rungs are done. */
  readonly rungs: Readonly<Record<string, number>>;
  /** Free notes per waypoint or stage id. */
  readonly notes: Readonly<Record<string, string>>;
  /** Answers to checks, keyed by `checkKey`. */
  readonly answers: Readonly<Record<string, CheckAnswer>>;
}

export function emptyProgress(roadmapId: string, checkedOn: string | null = null): Progress {
  return {
    version: PROGRESS_VERSION,
    roadmap: roadmapId,
    checkedOn,
    entry: null,
    startedAt: null,
    updatedAt: null,
    waypoints: {},
    shows: {},
    rungs: {},
    notes: {},
    answers: {},
  };
}

/** Key for a check's answer: `w:<waypoint>:<n>` for a waypoint check, `s:<stage>:<n>` for a checkpoint check. */
export function checkKey(owner: 'waypoint' | 'checkpoint', id: string, index: number): string {
  return `${owner === 'waypoint' ? 'w' : 's'}:${id}:${index}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Updates. Each returns a new object; an unknown id leaves the progress as it was.

const dayOf = (now: string): string => toDay(now.slice(0, 10));

function stamp(progress: Progress, now: string): Progress {
  return { ...progress, startedAt: progress.startedAt ?? now, updatedAt: now };
}

function withWaypoint(progress: Progress, id: string, change: (old: WaypointProgress) => WaypointProgress, now: string): Progress {
  const old = progress.waypoints[id] ?? { done: false, reviews: [] };
  return stamp({ ...progress, waypoints: { ...progress.waypoints, [id]: change(old) } }, now);
}

function findWaypoint(roadmap: Roadmap, id: string) {
  return allWaypoints(roadmap).find((n) => n.waypoint.id === id);
}

/** Marks a waypoint finished. When it has checks, the first review is scheduled. Already done: no change. */
export function markDone(progress: Progress, roadmap: Roadmap, waypointId: string, now: string): Progress {
  const node = findWaypoint(roadmap, waypointId);
  if (!node || progress.waypoints[waypointId]?.done) return progress;
  const day = dayOf(now);
  return withWaypoint(
    progress,
    waypointId,
    (old) => {
      const gaps = reviewGaps(roadmap.reviewDays, old.rating);
      const hasChecks = (node.waypoint.checks?.length ?? 0) > 0;
      return { ...old, done: true, doneOn: day, due: hasChecks ? addDays(day, gaps[0] as number) : null };
    },
    now,
  );
}

/** Takes a waypoint back to "not done". Rating, note and review history stay. */
export function markNotDone(progress: Progress, waypointId: string, now: string): Progress {
  const old = progress.waypoints[waypointId];
  if (!old?.done) return progress;
  return withWaypoint(
    progress,
    waypointId,
    ({ doneOn: _doneOn, due: _due, ...rest }) => ({ ...rest, done: false }),
    now,
  );
}

export function setRating(progress: Progress, waypointId: string, rating: Rating | null, now: string): Progress {
  return withWaypoint(
    progress,
    waypointId,
    ({ rating: _rating, ...rest }) => (rating === null ? rest : { ...rest, rating }),
    now,
  );
}

/** An empty or blank note removes the note. */
export function setNote(progress: Progress, id: string, text: string, now: string): Progress {
  const { [id]: _removed, ...others } = progress.notes;
  return stamp({ ...progress, notes: text.trim() === '' ? others : { ...others, [id]: text } }, now);
}

export function recordAnswer(progress: Progress, key: string, answer: Omit<CheckAnswer, 'at'>, now: string): Progress {
  return stamp({ ...progress, answers: { ...progress.answers, [key]: { ...answer, at: now } } }, now);
}

/** Ticks or unticks one `show` item of a stage's checkpoint. */
export function setShow(progress: Progress, stageId: string, index: number, value: boolean, now: string): Progress {
  if (!Number.isInteger(index) || index < 0 || index > 20) return progress;
  const row = [...(progress.shows[stageId] ?? [])];
  while (row.length <= index) row.push(false);
  row[index] = value;
  return stamp({ ...progress, shows: { ...progress.shows, [stageId]: row } }, now);
}

/** Sets how many project rungs of a stage are done. */
export function setRung(progress: Progress, stageId: string, rungsDone: number, now: string): Progress {
  if (!Number.isInteger(rungsDone) || rungsDone < 0 || rungsDone > 3) return progress;
  return stamp({ ...progress, rungs: { ...progress.rungs, [stageId]: rungsDone } }, now);
}

/** Moves the red pin to another stage; null goes back to the roadmap's own entry. */
export function setEntry(progress: Progress, stageId: string | null, now: string): Progress {
  return stamp({ ...progress, entry: stageId }, now);
}

/**
 * Records a review sitting. A hit moves to the next gap of the series; a miss restarts the series from the first
 * gap. When the last gap is passed, `due` becomes null.
 */
export function recordReview(progress: Progress, roadmap: Roadmap, waypointId: string, ok: boolean, now: string): Progress {
  const old = progress.waypoints[waypointId];
  if (!old?.done || !findWaypoint(roadmap, waypointId)) return progress;
  const day = dayOf(now);
  const gaps = reviewGaps(roadmap.reviewDays, old.rating);
  let streak = 0;
  for (let i = old.reviews.length - 1; i >= 0 && old.reviews[i]?.ok; i -= 1) streak += 1;
  const step = ok ? streak + 1 : 0;
  const gap = gaps[step];
  return withWaypoint(
    progress,
    waypointId,
    (w) => ({ ...w, reviews: [...w.reviews, { on: day, ok }], due: gap === undefined ? null : addDays(day, gap) }),
    now,
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Reading the progress

/** The stage index where the pin is: the learner's own, else the roadmap's, else the first stage. */
export function entryIndex(roadmap: Roadmap, progress: Progress): number {
  const id = progress.entry ?? roadmap.brief.entry;
  const index = id === undefined ? 0 : roadmap.stages.findIndex((s) => s.id === id);
  return index < 0 ? 0 : index;
}

export interface Position {
  readonly stageId: string;
  readonly waypointId: string;
}

/**
 * The first waypoint on the route that is not done and whose requirements are done. Side trails (optional
 * waypoints) are never "here". Stages before the entry pin count as already known. Null when the route is finished.
 */
export function youAreHere(roadmap: Roadmap, progress: Progress): Position | null {
  const pin = entryIndex(roadmap, progress);
  const known = new Set<string>();
  roadmap.stages.forEach((stage, i) => {
    if (i < pin) {
      known.add(stage.id);
      stage.waypoints.forEach((w) => known.add(w.id));
    }
  });
  const isDone = (waypointId: string): boolean => known.has(waypointId) || progress.waypoints[waypointId]?.done === true;
  const stageDone = (stageId: string): boolean => {
    const stage = roadmap.stages.find((s) => s.id === stageId);
    return !stage || known.has(stage.id) || stage.waypoints.every((w) => w.optional === true || isDone(w.id));
  };

  for (const node of allWaypoints(roadmap)) {
    if (node.stageIndex < pin || node.waypoint.optional || isDone(node.waypoint.id)) continue;
    const ready =
      waypointRequires(node.stage, node.waypointIndex).every(isDone) && stageRequires(roadmap, node.stageIndex).every(stageDone);
    if (ready) return { stageId: node.stage.id, waypointId: node.waypoint.id };
  }
  return null;
}

/** True when enough `show` items of a stage's checkpoint are ticked (the checkpoint's `pass`, default 0.8). */
export function checkpointPassed(roadmap: Roadmap, progress: Progress, stageId: string): boolean {
  const stage = roadmap.stages.find((s) => s.id === stageId);
  if (!stage) return false;
  const total = stage.checkpoint.show.length;
  const ticked = stage.checkpoint.show.filter((_, i) => progress.shows[stageId]?.[i] === true).length;
  return ticked >= Math.ceil((stage.checkpoint.pass ?? DEFAULT_PASS_SHARE) * total - 1e-9);
}

export interface ProgressSummary {
  readonly doneWaypoints: number;
  readonly totalWaypoints: number;
  readonly doneMinutes: number;
  readonly totalMinutes: number;
  /** Finished minutes as a share of all minutes, 0 to 1. */
  readonly share: number;
  readonly stagesComplete: readonly string[];
}

export function summarise(roadmap: Roadmap, progress: Progress): ProgressSummary {
  let doneWaypoints = 0;
  let doneMinutes = 0;
  let totalMinutes = 0;
  const nodes = allWaypoints(roadmap);
  for (const node of nodes) {
    totalMinutes += node.waypoint.minutes;
    if (progress.waypoints[node.waypoint.id]?.done) {
      doneWaypoints += 1;
      doneMinutes += node.waypoint.minutes;
    }
  }
  return {
    doneWaypoints,
    totalWaypoints: nodes.length,
    doneMinutes,
    totalMinutes,
    share: totalMinutes === 0 ? 0 : doneMinutes / totalMinutes,
    stagesComplete: roadmap.stages
      .filter((s) => s.waypoints.every((w) => w.optional === true || progress.waypoints[w.id]?.done === true))
      .map((s) => s.id),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Saving and loading

export function serialiseProgress(progress: Progress): string {
  return JSON.stringify(progress);
}

export type ParseProgressResult =
  | { readonly ok: true; readonly progress: Progress; readonly dropped: number }
  | { readonly ok: false; readonly reason: string };

type Bag = Record<string, unknown>;
const isBag = (value: unknown): value is Bag => typeof value === 'object' && value !== null && !Array.isArray(value);
const isDay = (value: unknown): value is string => typeof value === 'string' && isRealDay(value);
const isText = (value: unknown): value is string => typeof value === 'string';

/**
 * Reads progress text (from storage or a file the learner imported). Never throws. Wrong JSON, a different
 * roadmap or a newer format are refused with a reason; single damaged entries are dropped and counted in `dropped`.
 */
export function parseProgress(text: string, expectedRoadmapId?: string): ParseProgressResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'This is not a progress file: it could not be read as JSON.' };
  }
  if (!isBag(raw)) return { ok: false, reason: 'This is not a progress file: the top level is not an object.' };
  if (typeof raw.version !== 'number') return { ok: false, reason: 'This is not a progress file: it has no version number.' };
  if (raw.version > PROGRESS_VERSION) {
    return { ok: false, reason: 'This progress file was written by a newer version of zero-to. Update the site to read it.' };
  }
  if (raw.version !== PROGRESS_VERSION) return { ok: false, reason: `Progress version ${raw.version} is not supported.` };
  if (!isText(raw.roadmap) || raw.roadmap === '') return { ok: false, reason: 'This progress file does not say which roadmap it belongs to.' };
  if (expectedRoadmapId !== undefined && raw.roadmap !== expectedRoadmapId) {
    return { ok: false, reason: `This progress belongs to the roadmap "${raw.roadmap}", not "${expectedRoadmapId}".` };
  }

  let dropped = 0;
  const bad = (): void => {
    dropped += 1;
  };
  const safeEntries = (value: unknown): [string, unknown][] => {
    if (value === undefined) return [];
    if (!isBag(value)) {
      bad();
      return [];
    }
    return Object.entries(value).filter(([key]) => key !== '__proto__');
  };

  const waypoints: Record<string, WaypointProgress> = {};
  for (const [id, value] of safeEntries(raw.waypoints)) {
    if (!isBag(value)) {
      bad();
      continue;
    }
    const reviews: ReviewEntry[] = [];
    if (Array.isArray(value.reviews)) {
      for (const r of value.reviews) {
        if (isBag(r) && isDay(r.on) && typeof r.ok === 'boolean') reviews.push({ on: r.on, ok: r.ok });
        else bad();
      }
    }
    const item: {
      done: boolean;
      reviews: ReviewEntry[];
      doneOn?: string;
      rating?: Rating;
      due?: string | null;
    } = { done: value.done === true, reviews };
    if (isDay(value.doneOn)) item.doneOn = value.doneOn;
    else if (value.doneOn !== undefined) bad();
    if (value.rating === 1 || value.rating === 2 || value.rating === 3 || value.rating === 4) item.rating = value.rating;
    else if (value.rating !== undefined) bad();
    if (isDay(value.due) || value.due === null) item.due = value.due;
    else if (value.due !== undefined) bad();
    waypoints[id] = item;
  }

  const shows: Record<string, boolean[]> = {};
  for (const [id, value] of safeEntries(raw.shows)) {
    if (Array.isArray(value) && value.length <= 20 && value.every((v) => typeof v === 'boolean')) shows[id] = value as boolean[];
    else bad();
  }

  const rungs: Record<string, number> = {};
  for (const [id, value] of safeEntries(raw.rungs)) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 3) rungs[id] = value;
    else bad();
  }

  const notes: Record<string, string> = {};
  for (const [id, value] of safeEntries(raw.notes)) {
    if (isText(value)) notes[id] = value;
    else bad();
  }

  const answers: Record<string, CheckAnswer> = {};
  for (const [key, value] of safeEntries(raw.answers)) {
    if (!isBag(value) || !isText(value.at)) {
      bad();
      continue;
    }
    const answer: { at: string; choice?: number; text?: string; correct?: boolean } = { at: value.at };
    if (typeof value.choice === 'number' && Number.isInteger(value.choice) && value.choice >= 0) answer.choice = value.choice;
    if (isText(value.text)) answer.text = value.text;
    if (typeof value.correct === 'boolean') answer.correct = value.correct;
    answers[key] = answer;
  }

  const progress: Progress = {
    version: PROGRESS_VERSION,
    roadmap: raw.roadmap,
    checkedOn: isDay(raw.checkedOn) ? raw.checkedOn : null,
    entry: isText(raw.entry) && raw.entry !== '' ? raw.entry : null,
    startedAt: isText(raw.startedAt) ? raw.startedAt : null,
    updatedAt: isText(raw.updatedAt) ? raw.updatedAt : null,
    waypoints,
    shows,
    rungs,
    notes,
    answers,
  };
  return { ok: true, progress, dropped };
}

/** Like `parseProgress`, but a missing or unreadable file gives a fresh progress. Corrupt data never throws. */
export function loadProgressOrEmpty(text: string | null | undefined, roadmapId: string, checkedOn: string | null = null): Progress {
  if (text === null || text === undefined || text === '') return emptyProgress(roadmapId, checkedOn);
  const result = parseProgress(text, roadmapId);
  return result.ok ? result.progress : emptyProgress(roadmapId, checkedOn);
}
