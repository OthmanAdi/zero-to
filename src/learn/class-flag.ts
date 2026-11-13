/**
 * Where a class is today. A roadmap for a class lists its sessions, and a session can carry its date. The class
 * flag stands after the steps of the latest session that is dated today or earlier: what the class has done
 * together so far. Before the first dated session there is no flag, and a plan without dates has none either.
 *
 * Pure, so the map, the profile strip and a test agree on the same place.
 */
import { daysBetween, isRealDay } from '../roadmap/dates';
import type { Trek } from '../roadmap/derive';
import type { ClassSession, Roadmap } from '../roadmap/types';

export interface ClassPlace {
  /** 0 to 1 along the route: the end of the last step the class did in that session. */
  readonly along: number;
  readonly session: ClassSession;
  /** The step that ends there. */
  readonly waypointId: string;
}

/** The latest session dated `today` or earlier. Of two sessions on one day the later one in the list counts. */
export function latestSession(roadmap: Roadmap, today: string): ClassSession | null {
  if (!isRealDay(today)) return null;
  let latest: ClassSession | null = null;
  for (const session of roadmap.class?.sessions ?? []) {
    if (session.date === undefined || !isRealDay(session.date) || daysBetween(session.date, today) < 0) continue;
    if (latest === null || daysBetween(latest.date as string, session.date) >= 0) latest = session;
  }
  return latest;
}

/** Where the class flag stands on `today` (YYYY-MM-DD), or null when no dated session has taken place yet. */
export function classPlace(roadmap: Roadmap, trek: Trek, today: string): ClassPlace | null {
  const session = latestSession(roadmap, today);
  if (!session || trek.totalMinutes <= 0) return null;
  const minutes = new Map<string, number>();
  for (const stage of roadmap.stages) for (const waypoint of stage.waypoints) minutes.set(waypoint.id, waypoint.minutes);
  let place: ClassPlace | null = null;
  for (const id of session.inClass) {
    const step = trek.waypoints.find((waypoint) => waypoint.id === id);
    if (!step) continue;
    // A step's place on the route is its middle. The class has finished it, so the flag stands at its end.
    const along = Math.min(1, step.along + Math.max(0, minutes.get(id) ?? 0) / 2 / trek.totalMinutes);
    if (place === null || along > place.along) place = { along, session, waypointId: id };
  }
  return place !== null && place.along > 0 ? place : null;
}
