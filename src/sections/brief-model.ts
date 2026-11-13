import { daysBetween } from '../roadmap/dates';
import { deriveTrek, mapSpec, paceFor, type MapSpec, type Trek } from '../roadmap/derive';
import { resolveTheme, signpostFor, surfacesFor } from '../roadmap/themes';
import { DEFAULT_REVIEW_DAYS, type Assessment, type Budget, type CheckStatus, type Devices, type Resource, type ResourceCost, type ResourceType, type Roadmap, type SurfaceKind, type TierName } from '../roadmap/types';
import { TIER_NAMES } from '../scene/palette';
import { linkAge, type LinkAge } from './model';

/**
 * The trip brief of one roadmap as plain numbers: what the landing stops say when a person's own roadmap lies
 * on the table. Nothing here touches the DOM and nothing is stored: every figure is read from the roadmap file,
 * so the page can never claim more than the file holds.
 */

/** The link-check counts a built file carries next to its roadmap: "38 opened, 31 kept". */
export interface SourceReceipt {
  readonly opened: number;
  readonly kept: number;
  readonly dead?: number;
  readonly flagged?: number;
  readonly checkedOn?: string;
}

// ---------------------------------------------------------------------------------------------------------
// Stop 01: the stages by altitude.

export interface BriefStage {
  /** 1 for the first stage. */
  readonly n: number;
  readonly title: string;
  readonly tier: TierName;
  readonly minutes: number;
  readonly steps: number;
}

export interface BriefTier {
  readonly tier: TierName;
  readonly minutes: number;
  /** The stages at this altitude, in route order. Empty for an altitude the route never reaches. */
  readonly stages: readonly BriefStage[];
}

/** All four altitudes, bronze first, each with this roadmap's stages on it. */
export function tiersOf(roadmap: Roadmap, trek: Trek = deriveTrek(roadmap)): BriefTier[] {
  return TIER_NAMES.map((tier) => {
    const stages: BriefStage[] = [];
    roadmap.stages.forEach((stage, index) => {
      if (stage.tier !== tier) return;
      stages.push({ n: index + 1, title: stage.title, tier, minutes: trek.stages[index]?.minutes ?? 0, steps: stage.waypoints.length });
    });
    return { tier, minutes: stages.reduce((sum, stage) => sum + stage.minutes, 0), stages };
  });
}

/** The highest altitude a stage of the roadmap reaches. */
export function summitOf(roadmap: Roadmap): TierName {
  let top = 0;
  for (const stage of roadmap.stages) top = Math.max(top, TIER_NAMES.indexOf(stage.tier));
  return TIER_NAMES[top] as TierName;
}

// ---------------------------------------------------------------------------------------------------------
// Stop 03: counts.

export interface BriefCounts {
  readonly stages: number;
  readonly steps: number;
  /** Optional steps. */
  readonly sideTrails: number;
  /** One signpost per stage. */
  readonly signposts: number;
  /** What the signposts ask a learner to show, all stages together. */
  readonly shows: number;
  /** Check questions on steps and signposts. */
  readonly checks: number;
  /** Stages with a project. */
  readonly camps: number;
  readonly capstone: string | null;
  readonly sources: number;
  readonly minutes: number;
  /** Hands-on minutes as a share of all minutes, 0 to 1. */
  readonly practice: number;
  /** Key points a learner can pin into the notebook. */
  readonly takeaways: number;
  /** Steps with checks: the ones that come back for review. */
  readonly reviewSteps: number;
  readonly reviewDays: readonly number[];
  readonly teacherNotes: number;
  readonly gaps: number;
}

export function countsOf(roadmap: Roadmap, trek: Trek = deriveTrek(roadmap)): BriefCounts {
  const steps = roadmap.stages.flatMap((stage) => stage.waypoints);
  const count = (test: (step: (typeof steps)[number]) => boolean): number => steps.filter(test).length;
  const capstone = roadmap.capstone?.title ?? roadmap.stages.map((stage) => stage.project).find((project) => project?.capstone)?.title ?? null;
  return {
    stages: roadmap.stages.length,
    steps: steps.length,
    sideTrails: count((step) => step.optional === true),
    signposts: roadmap.stages.length,
    shows: roadmap.stages.reduce((sum, stage) => sum + stage.checkpoint.show.length, 0),
    checks: steps.reduce((sum, step) => sum + (step.checks?.length ?? 0), 0) + roadmap.stages.reduce((sum, stage) => sum + (stage.checkpoint.checks?.length ?? 0), 0),
    camps: roadmap.stages.filter((stage) => stage.project).length,
    capstone,
    sources: roadmap.resources.length,
    minutes: trek.totalMinutes,
    practice: trek.totalMinutes > 0 ? trek.practiceMinutes / trek.totalMinutes : 0,
    takeaways: steps.reduce((sum, step) => sum + (step.takeaways?.length ?? 0), 0),
    reviewSteps: count((step) => (step.checks?.length ?? 0) > 0),
    reviewDays: roadmap.reviewDays && roadmap.reviewDays.length > 0 ? roadmap.reviewDays : DEFAULT_REVIEW_DAYS,
    teacherNotes: count((step) => Boolean(step.teacherNote)),
    gaps: count((step) => Boolean(step.gap)),
  };
}

// ---------------------------------------------------------------------------------------------------------
// Stop 02: sources.

export interface SourceTally {
  readonly total: number;
  readonly status: Readonly<Record<CheckStatus, number>>;
  readonly cost: Readonly<Record<ResourceCost, number>>;
  /** Kinds of source with how many there are of each, most first. */
  readonly kinds: readonly (readonly [ResourceType, number])[];
  /** Languages of the sources, most used first. */
  readonly langs: readonly string[];
  /** Every source whose status is not verified, in the order of the file. */
  readonly flagged: readonly Resource[];
  /** Links opened and kept in the run that wrote the file. Null when the page was given no receipt. */
  readonly opened: number | null;
  readonly kept: number | null;
  readonly dead: number;
  readonly checkedOn: string;
  /** How old the link check is. Null when the day cannot be read. */
  readonly age: LinkAge | null;
  /** Days after which a recheck is suggested: 30 for a fast topic, 90 for any other. */
  readonly recheckAfter: number;
  readonly budget: Budget | null;
}

const tally = <K extends string>(keys: readonly K[], values: readonly K[]): Record<K, number> => {
  const out = Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
  for (const value of values) if (value in out) out[value] += 1;
  return out;
};

const byCount = <K extends string>(values: readonly K[]): [K, number][] => {
  const seen = new Map<K, number>();
  for (const value of values) seen.set(value, (seen.get(value) ?? 0) + 1);
  // A stable sort: kinds with the same count keep the order of the file.
  return [...seen.entries()].sort((a, b) => b[1] - a[1]);
};

/**
 * The sources of a roadmap, counted. A receipt is believed only when it fits the file: its `kept` has to be the
 * number of sources the file lists, or the page would print a count that the list beside it contradicts.
 */
export function tallySources(roadmap: Roadmap, receipt: SourceReceipt | null | undefined, today: Date): SourceTally {
  const resources = roadmap.resources;
  const fits = Boolean(receipt && receipt.kept === resources.length && receipt.opened >= receipt.kept);
  return {
    total: resources.length,
    status: tally(['verified', 'gated', 'unverified'], resources.map((resource) => resource.check.status)),
    cost: tally(['free', 'freemium', 'paid'], resources.map((resource) => resource.cost)),
    kinds: byCount(resources.map((resource) => resource.type)),
    langs: byCount(resources.map((resource) => (resource.lang.split('-')[0] ?? resource.lang).toLowerCase())).map(([lang]) => lang),
    flagged: resources.filter((resource) => resource.check.status !== 'verified'),
    opened: fits && receipt ? receipt.opened : null,
    kept: fits && receipt ? receipt.kept : null,
    dead: fits && receipt ? Math.max(0, receipt.dead ?? 0) : 0,
    checkedOn: roadmap.checkedOn,
    age: linkAge(roadmap.checkedOn, today, roadmap.freshness),
    recheckAfter: roadmap.freshness === 'fast' ? 30 : 90,
    budget: roadmap.brief.budget ?? null,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Stop 04: pace.

/**
 * The learner's own plan: what a person changed against the plan of the file, kept in their browser. The shape
 * is the one a learning session keeps, so a page can hand its session's plan over as it is.
 */
export interface OwnPlan {
  /** The day the learner punched as their start, `YYYY-MM-DD`. */
  readonly startDay?: string;
  readonly hoursPerWeek?: number;
  readonly deadline?: string;
}

/** The roadmap with the learner's own plan laid over the plan of the file. Pace is worked out from this one. */
export function withPlan(roadmap: Roadmap, plan: OwnPlan | null | undefined): Roadmap {
  if (!plan) return roadmap;
  const brief = { ...roadmap.brief };
  if (plan.startDay && safeDays(plan.startDay, plan.startDay) !== null) brief.startDate = plan.startDay;
  if (plan.hoursPerWeek !== undefined && Number.isFinite(plan.hoursPerWeek) && plan.hoursPerWeek > 0) brief.hoursPerWeek = plan.hoursPerWeek;
  if (plan.deadline && safeDays(plan.deadline, plan.deadline) !== null) brief.deadline = plan.deadline;
  return { ...roadmap, brief };
}

/** The hours a week the pace control and the start permit accept. */
export const HOURS_RANGE = { min: 1, max: 40, step: 0.5 } as const;

/** The widest ruler the pace stop draws, in weeks. A plan that runs longer is cut off there and says so. */
export const RULER_MAX = 104;

export interface PlanStrip {
  readonly n: number;
  readonly title: string;
  readonly tier: TierName;
  /** Where the stage starts and ends, in weeks from the start day. */
  readonly from: number;
  readonly to: number;
}

export interface PacePlan {
  readonly hoursPerWeek: number;
  readonly startDate: string;
  readonly deadline: string | null;
  /** The day the last step is done at this pace. */
  readonly arrival: string;
  /** Weeks the route takes at this pace. Not rounded. */
  readonly neededWeeks: number;
  /** Whole weeks the ruler shows: enough for the route and for the deadline, at most `RULER_MAX`. */
  readonly weeks: number;
  /** True when the route or the deadline runs past the end of the ruler. */
  readonly cut: boolean;
  readonly strips: readonly PlanStrip[];
  /** Where today falls on the ruler, in weeks from the start. Null before the start and past the ruler. */
  readonly todayAt: number | null;
  /** Where the deadline falls. Null without one, and when it lies outside the ruler. */
  readonly deadlineAt: number | null;
  /** Arrival minus deadline in days: positive is late. Null without a deadline. */
  readonly daysPastDeadline: number | null;
}

export function clampHours(hours: number): number {
  if (!Number.isFinite(hours)) return HOURS_RANGE.min;
  const stepped = Math.round(hours / HOURS_RANGE.step) * HOURS_RANGE.step;
  return Math.min(HOURS_RANGE.max, Math.max(HOURS_RANGE.min, stepped));
}

/**
 * The plan at a number of hours a week, from a start day. The arrival is `paceFor`'s, the same arithmetic the
 * profile strip and the walk use, so the stop and the map never print two different days.
 */
export function planPace(roadmap: Roadmap, hoursPerWeek: number, startDate: string, today: string, trek: Trek = deriveTrek(roadmap)): PacePlan {
  const hours = clampHours(hoursPerWeek);
  const pace = paceFor({ ...roadmap, brief: { ...roadmap.brief, hoursPerWeek: hours, startDate } }, today);
  const perWeek = hours * 60;
  const neededWeeks = trek.totalMinutes / perWeek;
  const deadlineWeeks = pace.deadline !== null ? daysBetween(startDate, pace.deadline) / 7 : null;
  const wanted = Math.max(1, Math.ceil(Math.max(neededWeeks, deadlineWeeks ?? 0) - 1e-9));
  const weeks = Math.min(RULER_MAX, wanted);
  const todayWeeks = daysBetween(startDate, today) / 7;
  return {
    hoursPerWeek: hours,
    startDate,
    deadline: pace.deadline,
    arrival: pace.projectedArrival,
    neededWeeks,
    weeks,
    cut: wanted > weeks,
    strips: trek.stages.map((stage, index) => ({ n: index + 1, title: stage.title, tier: stage.tier, from: stage.startMinute / perWeek, to: stage.endMinute / perWeek })),
    todayAt: todayWeeks >= 0 && todayWeeks <= weeks ? todayWeeks : null,
    deadlineAt: deadlineWeeks !== null && deadlineWeeks > 0 && deadlineWeeks <= weeks ? deadlineWeeks : null,
    daysPastDeadline: pace.daysPastDeadline,
  };
}

/** The weeks a ruler labels: every one while they fit, then every second, fifth and so on. At most `most` labels. */
export function weekTicks(weeks: number, most = 8): number[] {
  const count = Math.max(1, Math.round(weeks));
  const step = [1, 2, 4, 5, 10, 13, 26, 52].find((size) => Math.ceil(count / size) <= most) ?? 52;
  const out: number[] = [];
  for (let week = 1; week <= count; week += step) out.push(week);
  return out;
}

/** The day a start permit proposes: the roadmap's own start day while that is still ahead, today otherwise. */
export function proposedStart(roadmap: Roadmap, today: string): string {
  const planned = roadmap.brief.startDate;
  return planned && daysBetween(today, planned) > 0 ? planned : today;
}

/**
 * The route's profile as `count` heights from 0 to 1: the altitude at even steps of the walking time, with the
 * summit of this roadmap at 1. It is the barcode of the start permit.
 */
export function profileOf(trek: Trek, count: number): number[] {
  const out: number[] = [];
  const top = trek.summitAltitude > 0 ? trek.summitAltitude : 1;
  for (let index = 0; index < count; index += 1) {
    const minute = (trek.totalMinutes * index) / Math.max(1, count - 1);
    const stage = trek.stages.find((entry) => minute <= entry.endMinute) ?? trek.stages[trek.stages.length - 1];
    if (!stage) {
      out.push(0);
      continue;
    }
    const within = stage.minutes > 0 ? Math.min(1, Math.max(0, (minute - stage.startMinute) / stage.minutes)) : 1;
    out.push((stage.startAltitude + (stage.campAltitude - stage.startAltitude) * within) / top);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Stop 04, for a class.

export interface ClassSessionMark {
  readonly n: number;
  readonly title: string;
  readonly date: string | null;
  /** Where the session falls, in weeks from the start day. */
  readonly at: number;
}

export interface ClassBrief {
  readonly size: number;
  readonly ages: string | null;
  readonly sessionsPerWeek: number;
  readonly sessionMinutes: number;
  readonly weeks: number | null;
  readonly devices: Devices | null;
  readonly assessment: Assessment | null;
  readonly handout: 'session' | 'stage' | 'none' | null;
  readonly homework: boolean | null;
  /** Steps that carry a teacher note. */
  readonly teacherNotes: number;
  readonly sessions: readonly ClassSessionMark[];
  /** The number of the latest session dated today or earlier, where the class flag stands. Null when none is. */
  readonly current: number | null;
}

/** The class block of a roadmap, or null when it has none. `startDate` places sessions that carry no date. */
export function classBrief(roadmap: Roadmap, startDate: string, today: string): ClassBrief | null {
  const plan = roadmap.class;
  if (!plan) return null;
  const perWeek = Math.max(1, plan.sessionsPerWeek);
  let current: number | null = null;
  const sessions = (plan.sessions ?? []).map((session, index) => {
    const date = session.date ?? null;
    const dated = date !== null ? safeDays(startDate, date) : null;
    if (date !== null && safeDays(date, today) !== null && (safeDays(date, today) as number) >= 0) current = session.n;
    // A session without a date stands in the middle of its share of the week.
    return { n: session.n, title: session.title, date, at: dated !== null ? dated / 7 : (index + 0.5) / perWeek };
  });
  return {
    size: plan.size,
    ages: plan.ages ?? null,
    sessionsPerWeek: plan.sessionsPerWeek,
    sessionMinutes: plan.sessionMinutes,
    weeks: plan.weeks ?? null,
    devices: plan.devices ?? null,
    assessment: plan.assessment ?? null,
    handout: plan.handout ?? null,
    homework: plan.homework ?? null,
    teacherNotes: roadmap.stages.flatMap((stage) => stage.waypoints).filter((step) => Boolean(step.teacherNote)).length,
    sessions,
    current,
  };
}

function safeDays(from: string, to: string): number | null {
  try {
    return daysBetween(from, to);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------
// Stop 05: the map.

export interface MapBrief {
  readonly spec: MapSpec;
  /** The theme that applies: the roadmap's own, or the default one. */
  readonly theme: string;
  /** True when the roadmap names a theme. */
  readonly themeSet: boolean;
  /** Ground bands from the foot to the summit. */
  readonly surfaces: readonly SurfaceKind[];
  readonly signpost: string;
}

export function mapBrief(roadmap: Roadmap): MapBrief {
  const spec = mapSpec(roadmap);
  const theme = resolveTheme(spec.theme ?? undefined);
  return {
    spec,
    theme: theme.id,
    themeSet: spec.theme !== null && theme.id === spec.theme,
    surfaces: surfacesFor(spec.surfaces === 'auto' ? undefined : spec.surfaces, theme.id),
    signpost: signpostFor(undefined, roadmap.map?.signpost, theme.id),
  };
}

// ---------------------------------------------------------------------------------------------------------
// Stop 07: gaps.

export interface GapLine {
  /** 1 for the first stage. */
  readonly stage: number;
  readonly stageTitle: string;
  readonly title: string;
  readonly gap: string;
}

/** Every step the agent could verify no source for, with the line it wrote instead. */
export function gapLines(roadmap: Roadmap): GapLine[] {
  const out: GapLine[] = [];
  roadmap.stages.forEach((stage, index) => {
    for (const step of stage.waypoints) if (step.gap) out.push({ stage: index + 1, stageTitle: stage.title, title: step.title, gap: step.gap });
  });
  return out;
}
