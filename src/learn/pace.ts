/**
 * Pace for one learner: the roadmap's plan, the learner's own changes to it, and what is already done. Pure
 * functions; the session calls them with its current state.
 */
import { addDays, daysBetween, toDay } from '../roadmap/dates';
import { OVERSHOOT_OFFER, paceFor, type Pace } from '../roadmap/derive';
import { allWaypoints } from '../roadmap/graph';
import { entryIndex, summarise, type Progress } from '../roadmap/progress';
import { TIER_NAMES } from '../scene/palette';
import type { Roadmap, TierName } from '../roadmap/types';

/** The learner's own changes to the plan, kept in this browser. Every field is optional. */
export interface Plan {
  /** The day the learner punched as their start. */
  readonly startDay?: string;
  readonly hoursPerWeek?: number;
  readonly deadline?: string;
  /** Stop at this tier: stages above it leave the plan. */
  readonly summit?: TierName;
  /** False leaves the side trails out of the plan. */
  readonly sideTrails?: boolean;
}

export type PlanChange = Plan;

/** After this many finished steps, and a week, the arrival is worked out from the learner's real pace. */
export const REAL_PACE_AFTER = 5;
const REAL_PACE_MIN_DAYS = 7;

export interface SessionPace {
  readonly today: string;
  readonly startDate: string;
  readonly deadline: string | null;
  readonly hoursPerWeek: number;
  /** The highest tier the plan reaches. */
  readonly summit: TierName;
  readonly sideTrails: boolean;
  /** Minutes of the steps inside the plan (after summit and side trails). */
  readonly totalMinutes: number;
  readonly doneMinutes: number;
  readonly remainingMinutes: number;
  /** Minutes of side trails still open inside the plan. */
  readonly sideTrailMinutes: number;
  /** Where the plan puts a learner today, 0 to 1 along the whole route. */
  readonly expectedAlong: number;
  /** Finished minutes as a share of the whole route. */
  readonly doneAlong: number;
  /** The day the remaining steps are finished. */
  readonly arrival: string;
  /** True when the arrival comes from the learner's real pace, not from `hoursPerWeek`. */
  readonly byRealPace: boolean;
  readonly daysPastDeadline: number | null;
  /** daysPastDeadline as a share of the planned days. */
  readonly overshoot: number | null;
  /** True when the arrival runs past the date by more than `OVERSHOOT_OFFER`: show the four choices. */
  readonly offer: boolean;
  readonly status: Pace['status'];
  /** True when the learner changed the plan. */
  readonly changed: boolean;
}

const tierIndex = (tier: TierName): number => TIER_NAMES.indexOf(tier);

/** The highest tier any stage reaches. */
export function topTier(roadmap: Roadmap): TierName {
  let top = 0;
  for (const stage of roadmap.stages) top = Math.max(top, tierIndex(stage.tier));
  return TIER_NAMES[top] as TierName;
}

export function parsePlan(text: string | null): Plan {
  if (!text) return {};
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    const plan: { -readonly [K in keyof Plan]: Plan[K] } = {};
    if (typeof raw.startDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.startDay)) plan.startDay = raw.startDay;
    if (typeof raw.hoursPerWeek === 'number' && raw.hoursPerWeek > 0 && raw.hoursPerWeek <= 168) plan.hoursPerWeek = raw.hoursPerWeek;
    if (typeof raw.deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.deadline)) plan.deadline = raw.deadline;
    if (typeof raw.summit === 'string' && (TIER_NAMES as readonly string[]).includes(raw.summit)) plan.summit = raw.summit as TierName;
    if (typeof raw.sideTrails === 'boolean') plan.sideTrails = raw.sideTrails;
    return plan;
  } catch {
    return {};
  }
}

/** Applies a change: a field set to undefined is removed, so the roadmap's own value is used again. */
export function applyPlan(plan: Plan, change: PlanChange | null): Plan {
  if (change === null) return {};
  const next: Record<string, unknown> = { ...plan };
  for (const [key, value] of Object.entries(change)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return next as Plan;
}

/**
 * Pace from the roadmap, the learner's plan and progress. Stages before the learner's entry pin count as known,
 * like `youAreHere` treats them.
 */
export function paceWith(roadmap: Roadmap, progress: Progress, plan: Plan, today: string | Date): SessionPace {
  const day = toDay(today);
  const startedOn = progress.startedAt ? progress.startedAt.slice(0, 10) : null;
  const startDate = plan.startDay ?? roadmap.brief.startDate ?? startedOn ?? day;
  const deadline = plan.deadline ?? roadmap.brief.deadline ?? null;
  const hoursPerWeek = plan.hoursPerWeek ?? roadmap.brief.hoursPerWeek;
  const summit = plan.summit ?? topTier(roadmap);
  const sideTrails = plan.sideTrails !== false;
  const pin = entryIndex(roadmap, progress);

  let totalMinutes = 0;
  let doneMinutes = 0;
  let sideTrailMinutes = 0;
  let doneSteps = 0;
  for (const node of allWaypoints(roadmap)) {
    if (tierIndex(node.stage.tier) > tierIndex(summit)) continue;
    const optional = node.waypoint.optional === true;
    if (optional && !sideTrails) continue;
    const minutes = node.waypoint.minutes;
    totalMinutes += minutes;
    const done = node.stageIndex < pin || progress.waypoints[node.waypoint.id]?.done === true;
    if (done) {
      doneMinutes += minutes;
      if (progress.waypoints[node.waypoint.id]?.done === true) doneSteps += 1;
    } else if (optional) {
      sideTrailMinutes += minutes;
    }
  }
  const remainingMinutes = Math.max(0, totalMinutes - doneMinutes);

  // The plan as the roadmap package sees it, with the learner's hours, start and date.
  const planned = paceFor(
    {
      ...roadmap,
      brief: {
        ...roadmap.brief,
        hoursPerWeek,
        startDate,
        ...(deadline ? { deadline } : {}),
      },
    },
    day,
  );

  const plannedRate = (hoursPerWeek * 60) / 7;
  const elapsed = daysBetween(startDate, day);
  const real = summarise(roadmap, progress).doneMinutes;
  // Hours the learner set themselves win over the measured pace: that is the point of setting them.
  const byRealPace = plan.hoursPerWeek === undefined && doneSteps >= REAL_PACE_AFTER && elapsed >= REAL_PACE_MIN_DAYS && real > 0;
  const rate = byRealPace ? real / elapsed : plannedRate;
  const from = daysBetween(startDate, day) > 0 ? day : startDate;
  const arrival = remainingMinutes === 0 ? day : addDays(from, Math.ceil(remainingMinutes / rate));

  const plannedDays = deadline ? daysBetween(startDate, deadline) : null;
  const daysPastDeadline = deadline ? daysBetween(deadline, arrival) : null;
  const overshoot = daysPastDeadline !== null && plannedDays !== null && plannedDays > 0 ? daysPastDeadline / plannedDays : null;

  return {
    today: day,
    startDate,
    deadline,
    hoursPerWeek,
    summit,
    sideTrails,
    totalMinutes,
    doneMinutes,
    remainingMinutes,
    sideTrailMinutes,
    expectedAlong: planned.expectedAlong,
    doneAlong: summarise(roadmap, progress).share,
    arrival,
    byRealPace,
    daysPastDeadline,
    overshoot,
    offer: remainingMinutes > 0 && overshoot !== null && overshoot > OVERSHOOT_OFFER,
    status: planned.status,
    changed: Object.keys(plan).some((key) => key !== 'startDay'),
  };
}

export type PaceChoiceKind = 'hours' | 'date' | 'summit' | 'side-trails';

export interface PaceChoice {
  readonly kind: PaceChoiceKind;
  /** What the session's `replan` is called with. */
  readonly change: PlanChange;
  /** The arrival with this choice. */
  readonly arrival: string;
  readonly hoursPerWeek?: number;
  readonly deadline?: string;
  readonly summit?: TierName;
  /** Minutes the choice takes off the plan. */
  readonly savedMinutes?: number;
}

/**
 * The ways to make a plan fit its date: more hours, a later date, a lower summit, no side trails. Only the
 * choices that change something are listed, in that order.
 */
export function paceChoices(roadmap: Roadmap, progress: Progress, plan: Plan, today: string | Date): PaceChoice[] {
  const now = paceWith(roadmap, progress, plan, today);
  const choices: PaceChoice[] = [];
  if (!now.deadline || now.remainingMinutes === 0) return choices;

  const from = daysBetween(now.startDate, now.today) > 0 ? now.today : now.startDate;
  const daysLeft = daysBetween(from, now.deadline);
  if (daysLeft > 0) {
    // Half hours, rounded up, so the arrival lands on or before the date.
    const needed = Math.ceil(((now.remainingMinutes / daysLeft) * 7) / 60 / 0.5) * 0.5;
    if (needed > now.hoursPerWeek) {
      const change = { hoursPerWeek: needed };
      choices.push({ kind: 'hours', change, hoursPerWeek: needed, arrival: paceWith(roadmap, progress, applyPlan(plan, change), today).arrival });
    }
  }

  choices.push({ kind: 'date', change: { deadline: now.arrival }, deadline: now.arrival, arrival: now.arrival });

  const lower = TIER_NAMES.slice(0, tierIndex(now.summit))
    .reverse()
    .find((tier) => roadmap.stages.some((s) => s.tier === tier));
  if (lower) {
    const change = { summit: lower };
    const next = paceWith(roadmap, progress, applyPlan(plan, change), today);
    choices.push({
      kind: 'summit',
      change,
      summit: lower,
      arrival: next.arrival,
      savedMinutes: now.remainingMinutes - next.remainingMinutes,
    });
  }

  if (now.sideTrails && now.sideTrailMinutes > 0) {
    const change = { sideTrails: false };
    choices.push({
      kind: 'side-trails',
      change,
      arrival: paceWith(roadmap, progress, applyPlan(plan, change), today).arrival,
      savedMinutes: now.sideTrailMinutes,
    });
  }
  return choices;
}
