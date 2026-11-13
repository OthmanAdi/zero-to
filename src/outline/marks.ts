/**
 * Where the marks of the profile go, worked out from a learner's progress. Pure, so the outline, the trail card
 * and the 3D view's strip can agree on the same numbers.
 */
import { daysBetween } from '../roadmap/dates';
import { reviewDue, type Trek } from '../roadmap/derive';
import { checkpointPassed, youAreHere, type Progress } from '../roadmap/progress';
import type { Roadmap } from '../roadmap/types';
import type { ProfileMarks } from './profile';

/** The start of a step along the route, 0 to 1: the walked line ends there while the step is open. */
export function stepStart(trek: Trek, roadmap: Roadmap, waypointId: string): number {
  const w = trek.waypoints.find((p) => p.id === waypointId);
  if (!w || trek.totalMinutes === 0) return 0;
  const node = roadmap.stages.flatMap((s) => s.waypoints).find((p) => p.id === waypointId);
  const half = (node?.minutes ?? 0) / 2 / trek.totalMinutes;
  return Math.max(0, w.along - half);
}

/** The end of a step along the route, 0 to 1. */
export function stepEnd(trek: Trek, roadmap: Roadmap, waypointId: string): number {
  const w = trek.waypoints.find((p) => p.id === waypointId);
  if (!w || trek.totalMinutes === 0) return 0;
  const node = roadmap.stages.flatMap((s) => s.waypoints).find((p) => p.id === waypointId);
  return Math.min(1, w.along + (node?.minutes ?? 0) / 2 / trek.totalMinutes);
}

/** You are here as a share of the route: the start of the open step, 1 when the route is walked. */
export function hereAlong(trek: Trek, roadmap: Roadmap, progress: Progress): number {
  const here = youAreHere(roadmap, progress);
  return here ? stepStart(trek, roadmap, here.waypointId) : 1;
}

/** Where the class is today: after the in-class steps of the latest session dated today or earlier. */
export function classAlong(trek: Trek, roadmap: Roadmap, today: string): number | null {
  const sessions = (roadmap.class?.sessions ?? []).filter((s) => s.date !== undefined && daysBetween(s.date, today) >= 0);
  if (sessions.length === 0) return null;
  const latest = sessions.reduce((a, b) => (daysBetween(a.date as string, b.date as string) >= 0 ? b : a));
  const ends = latest.inClass.map((id) => stepEnd(trek, roadmap, id)).filter((n) => n > 0);
  return ends.length > 0 ? Math.max(...ends) : null;
}

export interface MarksOptions {
  /** The day the marks are for, YYYY-MM-DD. */
  readonly today: string;
  /** Where the plan puts the learner today, 0 to 1, or null to leave the pace marker out. */
  readonly pace?: number | null;
}

/** Every mark of the profile for one learner on one day. */
export function marksFor(roadmap: Roadmap, trek: Trek, progress: Progress, options: MarksOptions): ProfileMarks {
  const done = Object.entries(progress.waypoints)
    .filter(([, w]) => w.done)
    .map(([id]) => id);
  return {
    here: hereAlong(trek, roadmap, progress),
    pace: options.pace ?? null,
    classAt: classAlong(trek, roadmap, options.today),
    done,
    due: reviewDue(progress, roadmap, options.today).map((item) => item.waypointId),
    passed: roadmap.stages.filter((s) => checkpointPassed(roadmap, progress, s.id)).map((s) => s.id),
  };
}
