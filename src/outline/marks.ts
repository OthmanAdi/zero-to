/**
 * Where the marks of the profile go, worked out from a learner's progress. Pure, so the outline, the trail card
 * and the 3D view's strip can agree on the same numbers. The class flag comes from `classPlace`, the one
 * definition the strip and the walk use too.
 */
import { classPlace } from '../learn/class-flag';
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

/** You are here as a share of the route: the start of the open step, 1 when the route is walked. */
export function hereAlong(trek: Trek, roadmap: Roadmap, progress: Progress): number {
  const here = youAreHere(roadmap, progress);
  return here ? stepStart(trek, roadmap, here.waypointId) : 1;
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
    classAt: classPlace(roadmap, trek, options.today)?.along ?? null,
    done,
    due: reviewDue(progress, roadmap, options.today).map((item) => item.waypointId),
    passed: roadmap.stages.filter((s) => checkpointPassed(roadmap, progress, s.id)).map((s) => s.id),
  };
}
