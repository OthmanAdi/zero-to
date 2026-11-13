/**
 * Everything the website works out from a roadmap without storing it: altitudes, positions on the route, pace,
 * due reviews, shelf contents and the resolved map options. All functions are pure.
 */
import { fork, pick } from '../core/random';
import { TIER_NAMES } from '../scene/palette';
import { addDays, daysBetween, toDay } from './dates';
import { allWaypoints } from './graph';
import {
  DEFAULT_REVIEW_DAYS,
  TERRAIN_KINDS,
  TRAIL_KINDS,
  type Resource,
  type Roadmap,
  type SurfaceKind,
  type TerrainKind,
  type TierName,
  type TrailKind,
} from './types';
import type { Progress } from './progress';

/** Each tier owns this share of the mountain's height. */
export const TIER_BAND = 1 / TIER_NAMES.length;

export interface TrekStage {
  readonly id: string;
  readonly title: string;
  readonly tier: TierName;
  readonly minutes: number;
  readonly practiceMinutes: number;
  /** 0 to 1, the height where the panel starts (the previous camp). */
  readonly startAltitude: number;
  /** 0 to 1, the height of the camp at the end of the panel. */
  readonly campAltitude: number;
  /** Cumulative minutes at the start and the end of the panel. */
  readonly startMinute: number;
  readonly endMinute: number;
}

export interface TrekWaypoint {
  readonly stageId: string;
  readonly id: string;
  /** 0 to 1 along the route, by cumulative minutes, at the middle of the step. */
  readonly along: number;
  /** 0 to 1, interpolated between the stage's start and camp. */
  readonly altitude: number;
  readonly optional: boolean;
}

export interface Trek {
  readonly stages: readonly TrekStage[];
  readonly waypoints: readonly TrekWaypoint[];
  readonly totalMinutes: number;
  readonly totalHours: number;
  readonly practiceMinutes: number;
  /** Altitude of the last camp. Lower than 1 when the roadmap ends below diamond. */
  readonly summitAltitude: number;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

export function deriveTrek(roadmap: Roadmap): Trek {
  const stageMinutes = roadmap.stages.map((s) => s.waypoints.reduce((sum, w) => sum + w.minutes, 0));
  const totalMinutes = stageMinutes.reduce((a, b) => a + b, 0);

  // Minutes of every tier, so that stages in the same tier share its quarter of the height by their minutes.
  const tierTotal = new Map<TierName, number>();
  roadmap.stages.forEach((stage, i) => tierTotal.set(stage.tier, (tierTotal.get(stage.tier) ?? 0) + (stageMinutes[i] as number)));
  const tierSoFar = new Map<TierName, number>();

  const stages: TrekStage[] = [];
  let minute = 0;
  let previousCamp = 0;
  roadmap.stages.forEach((stage, i) => {
    const minutes = stageMinutes[i] as number;
    const tierIndex = TIER_NAMES.indexOf(stage.tier);
    const sofar = (tierSoFar.get(stage.tier) ?? 0) + minutes;
    tierSoFar.set(stage.tier, sofar);
    const share = sofar / (tierTotal.get(stage.tier) as number);
    // A route never goes downhill, even when the stages are listed out of tier order.
    const camp = Math.max(previousCamp, clamp01((tierIndex + share) * TIER_BAND));
    stages.push({
      id: stage.id,
      title: stage.title,
      tier: stage.tier,
      minutes,
      practiceMinutes: stage.waypoints.reduce((sum, w) => sum + Math.min(w.practiceMinutes, w.minutes), 0),
      startAltitude: previousCamp,
      campAltitude: camp,
      startMinute: minute,
      endMinute: minute + minutes,
    });
    minute += minutes;
    previousCamp = camp;
  });

  const waypoints: TrekWaypoint[] = [];
  const nodes = allWaypoints(roadmap);
  for (const node of nodes) {
    const trekStage = stages[node.stageIndex] as TrekStage;
    const before = node.stage.waypoints.slice(0, node.waypointIndex).reduce((sum, w) => sum + w.minutes, 0);
    const middle = trekStage.startMinute + before + node.waypoint.minutes / 2;
    const within = trekStage.minutes === 0 ? 0 : (before + node.waypoint.minutes / 2) / trekStage.minutes;
    waypoints.push({
      stageId: node.stage.id,
      id: node.waypoint.id,
      along: totalMinutes === 0 ? 0 : clamp01(middle / totalMinutes),
      altitude: clamp01(trekStage.startAltitude + (trekStage.campAltitude - trekStage.startAltitude) * within),
      optional: node.waypoint.optional === true,
    });
  }

  return {
    stages,
    waypoints,
    totalMinutes,
    totalHours: totalMinutes / 60,
    practiceMinutes: stages.reduce((sum, s) => sum + s.practiceMinutes, 0),
    summitAltitude: previousCamp,
  };
}

/** Where a stage's camp sits along the route, 0 to 1. */
export function campAlong(trek: Trek, stageId: string): number {
  const stage = trek.stages.find((s) => s.id === stageId);
  return stage && trek.totalMinutes > 0 ? stage.endMinute / trek.totalMinutes : 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Pace

export interface Pace {
  /** The day used as "today", as YYYY-MM-DD. */
  readonly today: string;
  /** The brief's start date, or today when the brief has none. */
  readonly startDate: string;
  readonly deadline: string | null;
  readonly totalMinutes: number;
  /** Minutes of work per calendar day at `hoursPerWeek`. */
  readonly minutesPerDay: number;
  /** Where a learner who follows the plan should be today, 0 to 1. With a deadline: an even climb to it. */
  readonly expectedAlong: number;
  readonly expectedMinute: number;
  /** The day the learner arrives at the summit when working `hoursPerWeek` from the start date. */
  readonly projectedArrival: string;
  /** Whole days between start and projected arrival. */
  readonly daysNeeded: number;
  /** Projected arrival minus the deadline in days (positive: after it); null without a deadline. */
  readonly daysPastDeadline: number | null;
  /** daysPastDeadline as a share of the planned time; the site offers new choices above about 0.15. */
  readonly overshoot: number | null;
  readonly status: 'before-start' | 'under-way' | 'after-plan';
}

/** The share of overshoot at which the site offers more hours, a later date, a lower summit or no side trails. */
export const OVERSHOOT_OFFER = 0.15;

export function paceFor(roadmap: Roadmap, today: string | Date): Pace {
  const day = toDay(today);
  const trek = deriveTrek(roadmap);
  const startDate = roadmap.brief.startDate ?? day;
  const deadline = roadmap.brief.deadline ?? null;
  const minutesPerDay = (roadmap.brief.hoursPerWeek * 60) / 7;
  const daysNeeded = trek.totalMinutes === 0 ? 0 : Math.ceil(trek.totalMinutes / minutesPerDay);
  const projectedArrival = addDays(startDate, daysNeeded);
  const elapsed = daysBetween(startDate, day);

  const plannedDays = deadline !== null ? daysBetween(startDate, deadline) : null;
  let expectedAlong: number;
  if (elapsed <= 0) expectedAlong = 0;
  else if (plannedDays !== null && plannedDays > 0) expectedAlong = clamp01(elapsed / plannedDays);
  else expectedAlong = trek.totalMinutes === 0 ? 0 : clamp01((elapsed * minutesPerDay) / trek.totalMinutes);

  const daysPastDeadline = deadline !== null ? daysBetween(deadline, projectedArrival) : null;
  const overshoot = daysPastDeadline !== null && plannedDays !== null && plannedDays > 0 ? daysPastDeadline / plannedDays : null;
  const endOfPlan = deadline ?? projectedArrival;

  return {
    today: day,
    startDate,
    deadline,
    totalMinutes: trek.totalMinutes,
    minutesPerDay,
    expectedAlong,
    expectedMinute: expectedAlong * trek.totalMinutes,
    projectedArrival,
    daysNeeded,
    daysPastDeadline,
    overshoot,
    status: elapsed < 0 ? 'before-start' : daysBetween(day, endOfPlan) < 0 ? 'after-plan' : 'under-way',
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Spaced review

/**
 * The gaps, in days, between reviews of one waypoint. A low rating (1 or 2: saw it, or did it with the guide)
 * halves the first two gaps, so shaky steps come back sooner.
 */
export function reviewGaps(reviewDays: readonly number[] | undefined, rating?: number): number[] {
  const days = reviewDays && reviewDays.length > 0 ? reviewDays : DEFAULT_REVIEW_DAYS;
  return days.map((d, i) => (rating !== undefined && rating <= 2 && i < 2 ? Math.max(1, Math.ceil(d / 2)) : d));
}

export interface ReviewItem {
  readonly waypointId: string;
  readonly stageId: string;
  readonly title: string;
  /** The day the review fell due. */
  readonly due: string;
  /** 0 on the day itself. */
  readonly daysOverdue: number;
}

/** Finished waypoints that have checks and whose review day has come, most overdue first. */
export function reviewDue(progress: Progress, roadmap: Roadmap, today: string | Date): ReviewItem[] {
  const day = toDay(today);
  const items: ReviewItem[] = [];
  for (const node of allWaypoints(roadmap)) {
    const wp = progress.waypoints[node.waypoint.id];
    if (!wp?.done || !node.waypoint.checks || node.waypoint.checks.length === 0) continue;
    let due = wp.due;
    if (due === undefined) {
      // Older or hand-edited progress with no due day: start the series from the day it was finished.
      if (!wp.doneOn) continue;
      due = addDays(wp.doneOn, reviewGaps(roadmap.reviewDays, wp.rating)[0] as number);
    }
    if (due === null) continue; // the whole series is finished
    const overdue = daysBetween(due, day);
    if (overdue >= 0) {
      items.push({ waypointId: node.waypoint.id, stageId: node.stage.id, title: node.waypoint.title, due, daysOverdue: overdue });
    }
  }
  return items.sort((a, b) => b.daysOverdue - a.daysOverdue);
}

// ---------------------------------------------------------------------------------------------------------------
// The shelf

export interface ShelfEntry {
  readonly resource: Resource;
  /** The first resource of a waypoint is its main one. */
  readonly main: boolean;
  /** The waypoint it belongs to, or "project" for a camp's project shelf. */
  readonly for: string;
}

/**
 * The volumes for a waypoint (its resources in the listed order, main one first) or for a whole stage (each
 * waypoint's list in route order, then the project's, without repeats). An unknown id gives an empty shelf.
 */
export function resourcesFor(roadmap: Roadmap, id: string): ShelfEntry[] {
  const byId = new Map(roadmap.resources.map((r) => [r.id, r]));
  const entries: ShelfEntry[] = [];
  const seen = new Set<string>();
  const add = (ids: readonly string[], owner: string, mainFirst: boolean): void => {
    ids.forEach((rid, i) => {
      const resource = byId.get(rid);
      if (!resource || seen.has(rid)) return;
      seen.add(rid);
      entries.push({ resource, main: mainFirst && i === 0, for: owner });
    });
  };

  for (const stage of roadmap.stages) {
    for (const waypoint of stage.waypoints) {
      if (waypoint.id === id) {
        add(waypoint.resources, waypoint.id, true);
        return entries;
      }
    }
  }
  const stage = roadmap.stages.find((s) => s.id === id);
  if (stage) {
    for (const waypoint of stage.waypoints) add(waypoint.resources, waypoint.id, true);
    add(stage.project?.resources ?? [], 'project', false);
  }
  return entries;
}

// ---------------------------------------------------------------------------------------------------------------
// Map

export interface MapSpec {
  readonly terrain: TerrainKind;
  readonly trail: TrailKind;
  /** True when the roadmap said `random` (or nothing) and the seed chose. */
  readonly terrainWasRandom: boolean;
  readonly trailWasRandom: boolean;
  readonly seed: string;
  /** `auto` is left for the terrain to resolve, because it depends on the shape of the mountain. */
  readonly surfaces: 'auto' | readonly SurfaceKind[];
  readonly signpost: string;
  readonly theme: string | null;
}

export const DEFAULT_SIGNPOST = 'timber';

/** The roadmap's `map` options with every default filled in. The same roadmap always gives the same result. */
export function mapSpec(roadmap: Roadmap): MapSpec {
  const map = roadmap.map ?? {};
  const seed = map.seed ?? roadmap.id;
  const wantTerrain = map.terrain ?? 'random';
  const wantTrail = map.trail ?? 'random';
  return {
    terrain: wantTerrain === 'random' ? pick(fork(seed, 'terrain'), TERRAIN_KINDS) : wantTerrain,
    trail: wantTrail === 'random' ? pick(fork(seed, 'trail'), TRAIL_KINDS) : wantTrail,
    terrainWasRandom: wantTerrain === 'random',
    trailWasRandom: wantTrail === 'random',
    seed,
    surfaces: map.surfaces ?? 'auto',
    signpost: map.signpost ?? DEFAULT_SIGNPOST,
    theme: map.theme ?? roadmap.brief.theme ?? null,
  };
}
