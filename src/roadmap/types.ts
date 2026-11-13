/**
 * The shape of a roadmap file, written by hand to match `roadmap.schema.json` field for field.
 * When the schema changes, change this file in the same commit.
 */
import type { SurfaceKind, TierName } from '../scene/palette';

export type { SurfaceKind, TierName };

/** One problem found in a roadmap. `path` is a JSON pointer ("" is the whole file), `message` is plain English. */
export interface Issue {
  readonly path: string;
  readonly message: string;
}

export type Freshness = 'fast' | 'medium' | 'slow';
export type Audience = 'self' | 'student' | 'teacher';
export type StartLevel = 'zero' | 'adjacent' | 'stuck' | 'gaps';
export type LearningStyle = 'build' | 'course' | 'read' | 'watch';
export type ProjectMode = 'capstone' | 'per-stage' | 'drills' | 'own';
export type Gating = 'open' | 'guided' | 'gated';

export type TerrainKind = 'volcano' | 'ridge' | 'massif' | 'twin-peaks' | 'plateau' | 'canyon';
export type TrailKind = 'switchback' | 'ridge-walk' | 'spiral' | 'valley-first' | 'traverse';

/** Every field is optional; `random` lets the seed decide. */
export interface MapOptions {
  readonly terrain?: TerrainKind | 'random';
  readonly trail?: TrailKind | 'random';
  readonly seed?: string;
  /** Ground types from the bottom of the mountain to the top, or `auto`. */
  readonly surfaces?: 'auto' | readonly SurfaceKind[];
  readonly signpost?: string;
  readonly theme?: string;
}

export interface Budget {
  /** 0 is free only, null is no limit. */
  readonly max: number | null;
  /** Three capital letters, for example EUR. */
  readonly currency: string;
}

export interface Brief {
  readonly audience: Audience;
  readonly goal?: string;
  readonly startLevel: StartLevel;
  /** Stage id where the red pin goes in. Default: the first stage. */
  readonly entry?: string;
  readonly targetTier: TierName;
  readonly hoursPerWeek: number;
  readonly startDate?: string;
  readonly deadline?: string;
  readonly style?: LearningStyle;
  readonly budget?: Budget;
  readonly resourceLangs?: readonly string[];
  readonly projects?: ProjectMode;
  readonly gating?: Gating;
  readonly theme?: string;
}

export type CheckKind = 'recall' | 'predict' | 'apply' | 'explain';

export interface Check {
  readonly q: string;
  readonly kind: CheckKind;
  readonly options?: readonly string[];
  /** Index into `options`. */
  readonly correct?: number;
  readonly answer: string;
  /** Waypoint to walk to after a miss. */
  readonly onMiss?: string;
}

export interface Waypoint {
  readonly id: string;
  readonly title: string;
  readonly note: string;
  readonly predict?: string;
  readonly do: string;
  readonly minutes: number;
  readonly practiceMinutes: number;
  /** Waypoint ids. Default: the waypoint before. */
  readonly requires?: readonly string[];
  /** A side trail. */
  readonly optional?: boolean;
  /** Resource ids, the first is the main one. */
  readonly resources: readonly string[];
  /** Written when no source could be verified for this step. */
  readonly gap?: string;
  /** Up to 4 key points (140 characters each) the learner can pin into a field notebook and take away. */
  readonly takeaways?: readonly string[];
  readonly checks?: readonly Check[];
  readonly teacherNote?: string;
}

export interface Checkpoint {
  readonly title: string;
  readonly signpost?: string;
  readonly show: readonly string[];
  readonly checks?: readonly Check[];
  /** Share of `show` items needed to pass, 0 to 1. Default 0.8. */
  readonly pass?: number;
}

export type RungLevel = 'guided' | 'changed' | 'own';

export interface Rung {
  readonly level: RungLevel;
  readonly task: string;
}

export interface Project {
  readonly title: string;
  readonly brief: string;
  readonly minutes?: number;
  readonly capstone?: boolean;
  readonly rungs: readonly Rung[];
  readonly resources?: readonly string[];
  readonly choices?: readonly string[];
  readonly criteria?: readonly string[];
}

export interface Stage {
  readonly id: string;
  readonly title: string;
  readonly tier: TierName;
  readonly summary?: string;
  /** Stage ids. Default: the stage before. */
  readonly requires?: readonly string[];
  readonly waypoints: readonly Waypoint[];
  readonly checkpoint: Checkpoint;
  readonly project?: Project;
}

export type ResourceType =
  | 'docs'
  | 'book'
  | 'course'
  | 'video'
  | 'article'
  | 'interactive'
  | 'exercises'
  | 'tool'
  | 'reference'
  | 'community';

export type ResourceCost = 'free' | 'freemium' | 'paid';
export type CheckStatus = 'verified' | 'gated' | 'unverified';

export interface Price {
  readonly amount: number;
  readonly currency: string;
  readonly per?: 'once' | 'month' | 'year';
  readonly seenOn: string;
}

export interface ResourceCheck {
  readonly status: CheckStatus;
  /** The day the link was opened. */
  readonly on: string;
  readonly http: number | null;
  /** Required unless the status is `verified`. */
  readonly note?: string;
}

export interface Resource {
  readonly id: string;
  readonly title: string;
  readonly by?: string;
  readonly url: string;
  readonly type: ResourceType;
  readonly cost: ResourceCost;
  readonly price?: Price;
  readonly lang: string;
  readonly level: TierName;
  readonly minutes?: number;
  readonly updated?: string;
  readonly why: string;
  readonly check: ResourceCheck;
}

export type Devices = 'each' | 'shared' | 'teacher' | 'none';

export interface Assessment {
  readonly mode: 'none' | 'pass' | 'graded' | 'test';
  readonly note?: string;
}

export interface ClassSession {
  readonly n: number;
  readonly date?: string;
  readonly title: string;
  readonly opener?: string;
  /** Waypoint ids. */
  readonly inClass: readonly string[];
  readonly homework?: readonly string[];
  readonly exit?: string;
  readonly materials?: readonly string[];
}

export interface ClassPlan {
  readonly size: number;
  readonly ages?: string;
  readonly sessionsPerWeek: number;
  readonly sessionMinutes: number;
  readonly weeks?: number;
  readonly devices?: Devices;
  readonly assessment?: Assessment;
  readonly handout?: 'session' | 'stage' | 'none';
  readonly homework?: boolean;
  readonly skipDates?: readonly string[];
  readonly sessions?: readonly ClassSession[];
}

export interface Capstone {
  readonly title: string;
  readonly brief: string;
}

export interface Roadmap {
  readonly schema: 'zero-to/1';
  readonly id: string;
  readonly title: string;
  /** The prompt as typed. */
  readonly topic: string;
  readonly summary?: string;
  readonly lang: string;
  /** Day of the last full link check. */
  readonly checkedOn: string;
  readonly freshness?: Freshness;
  readonly reviewDays?: readonly number[];
  readonly brief: Brief;
  readonly capstone?: Capstone;
  readonly map?: MapOptions;
  readonly stages: readonly Stage[];
  readonly resources: readonly Resource[];
  readonly class?: ClassPlan;
}

export const SCHEMA_VERSION = 'zero-to/1';
export const DEFAULT_REVIEW_DAYS: readonly number[] = [2, 7, 21, 60];
export const DEFAULT_PASS_SHARE = 0.8;

export const TERRAIN_KINDS: readonly TerrainKind[] = ['volcano', 'ridge', 'massif', 'twin-peaks', 'plateau', 'canyon'];
export const TRAIL_KINDS: readonly TrailKind[] = ['switchback', 'ridge-walk', 'spiral', 'valley-first', 'traverse'];
