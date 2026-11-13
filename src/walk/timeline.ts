import { clamp, clamp01, easeInOutCubic, seg, smooth } from '../paper/motion';
import type { Roadmap, Stage } from '../roadmap/types';
import { clampPanels } from './fold';

/**
 * The walk as a function of one number. Walk progress `p` runs from 0 to 1 over the walk's stretch of the
 * page, and everything follows from it: how far the map is open, where the camera is on its rail, which stage
 * the walker is in, how far through it he is and what he stands on.
 */
export const WALK = {
  /** The map opens here when the walk is reached without the dive, and shuts again at the end. */
  open: { from: 0.014, to: 0.085 },
  shut: { from: 0.955, to: 0.988 },
  /** Where the dive hands over to the walk. */
  handover: 0.086,
  /** The rail leaves the shut map. */
  railIn: { from: 0.012, to: 0.092 },
  /** The stages share this window in proportion to their weights. */
  stages: { from: 0.09, to: 0.82 },
  /** The camera holds on a panel for this share of its stage and crosses to the next in the rest. */
  hold: 0.9,
  /** The wide shot of the whole map. */
  wide: { from: 0.82, to: 0.875 },
  /** Every scene stands up at the finale, one panel after the other. */
  ripple: { from: 0.848, step: 0.011, spread: 5, rise: 0.02 },
  /** Everything folds down before the map shuts. */
  down: { from: 0.934, to: 0.949 },
  /** The camera returns to the shut map. */
  back: { from: 0.943, to: 0.99 },
  /** The walker is on the map between these. */
  walker: { from: 0.084, to: 0.952 },
  /** A scene starts to rise when the rail is this far from its panel, and stands when it is this near. */
  approach: { from: 0.66, to: 0.4 },
} as const;

/** How a stage's stretch is shared: the waypoints, the signpost and the camp. */
export const SHARE = { waypoints: 0.88, signpost: 0.07, camp: 0.05 } as const;

/** Where things stand along a panel's strip, 0 at its first stop and 1 at its camp. */
export const PLACE = {
  /** The waypoints share the strip up to here, by their minutes. */
  waypoints: 0.8,
  /** The walker stops at the signpost here. The post itself stands a little before, clear of the camp. */
  signpost: 0.87,
  camp: 1,
  /** The stage board stands shortly after the start. */
  board: 0.05,
} as const;

/** The length of the walk's stretch of the page, in viewports. */
export const STRETCH = { perStage: 0.8, perStep: 0.45, min: 8, max: 30 } as const;

export interface StageWindow {
  readonly index: number;
  readonly id: string;
  /** Walk progress at which the stage starts and ends. */
  readonly from: number;
  readonly to: number;
  readonly weight: number;
}

export interface StageWindows {
  /** Length of the walk's stretch of the page in viewports, clamped to 8 and 30. */
  readonly viewports: number;
  /** The same before clamping: the sum of the stage weights. */
  readonly weight: number;
  readonly stages: readonly StageWindow[];
}

/** The weight of a stage: 0.8 plus 0.45 for every waypoint and one more for the checkpoint. */
export function stageWeight(stage: Pick<Stage, 'waypoints'>): number {
  return STRETCH.perStage + STRETCH.perStep * (stage.waypoints.length + 1);
}

/** The window of every stage in walk progress, and how long the walk's stretch of the page is. */
export function stageWindows(roadmap: Pick<Roadmap, 'stages'>): StageWindows {
  const weights = roadmap.stages.map(stageWeight);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const span = WALK.stages.to - WALK.stages.from;
  let at: number = WALK.stages.from;
  const stages = roadmap.stages.map((stage, index): StageWindow => {
    const weight = weights[index] as number;
    const from = at;
    at = index === roadmap.stages.length - 1 ? WALK.stages.to : at + (span * weight) / total;
    return { index, id: stage.id, from, to: at, weight };
  });
  return { viewports: clamp(total, STRETCH.min, STRETCH.max), weight: total, stages };
}

/** Equal windows for `count` stages, for when only the number of stages is known. */
export function evenWindows(count: number): StageWindows {
  const stages = Array.from({ length: clampPanels(count) }, (_, index) => ({ id: `stage-${index + 1}`, waypoints: [0, 0, 0] }));
  return stageWindows({ stages } as unknown as Pick<Roadmap, 'stages'>);
}

export interface StagePlace {
  /** Index of the stage. */
  readonly stage: number;
  /** How far through the stage's window, 0 to 1. */
  readonly f: number;
}

/** The stage walk progress `p` falls in. Before the first stage it is the start of the first, after the last its end. */
export function stageAt(p: number, windows: StageWindows): StagePlace {
  const stages = windows.stages;
  const last = stages.length - 1;
  if (last < 0) return { stage: 0, f: 0 };
  if (p <= (stages[0] as StageWindow).from) return { stage: 0, f: 0 };
  for (let index = 0; index <= last; index += 1) {
    const window = stages[index] as StageWindow;
    if (p < window.to || index === last) return { stage: index, f: clamp01((p - window.from) / Math.max(1e-9, window.to - window.from)) };
  }
  return { stage: last, f: 1 };
}

/** Walk progress for a place in a stage: the inverse of `stageAt`. */
export function progressAt(place: StagePlace, windows: StageWindows): number {
  const window = windows.stages[clamp(Math.round(place.stage), 0, windows.stages.length - 1)];
  if (!window) return WALK.stages.from;
  return window.from + (window.to - window.from) * clamp01(place.f);
}

/**
 * Where the camera is on its rail. Pose 0 is the shut map, poses 1 to n are the panels, n + 1 is the whole map
 * and n + 2 is the shut map again. The camera holds on a panel for nine tenths of its stage and crosses to the
 * next panel in the last tenth.
 */
export function railAt(p: number, count: number, windows: StageWindows = evenWindows(count)): number {
  const n = windows.stages.length;
  if (p <= WALK.railIn.from) return 0;
  const first = windows.stages[0] as StageWindow;
  if (p < first.from) return Math.min(1, easeInOutCubic(seg(p, WALK.railIn.from, WALK.railIn.to)));
  if (p >= WALK.back.from) return n + 1 + easeInOutCubic(seg(p, WALK.back.from, WALK.back.to));
  if (p >= WALK.wide.from) return n + easeInOutCubic(seg(p, WALK.wide.from, WALK.wide.to));
  const { stage, f } = stageAt(p, windows);
  if (stage >= n - 1) return n;
  return 1 + stage + easeInOutCubic(seg(f, WALK.hold, 1));
}

/** How far the map is open at walk progress `p`: 0 shut, 1 lying open. */
export function mapOpenAt(p: number): number {
  if (p < WALK.shut.from) return clamp01((p - WALK.open.from) / (WALK.open.to - WALK.open.from));
  return 1 - clamp01((p - WALK.shut.from) / (WALK.shut.to - WALK.shut.from));
}

/**
 * How far the scene of a panel has unfolded, 0 lying to 1 standing. A scene rises as the rail approaches its
 * panel and stays up once the walker has been there. At the finale every scene rises, rippling from the first
 * panel to the last, and all of them fold down before the map shuts.
 */
export function sceneAt(p: number, panel: number, windows: StageWindows): number {
  const n = windows.stages.length;
  const rail = railAt(p, n, windows);
  const pose = panel + 1;
  let up = panel === 0 ? smooth(seg(p, WALK.handover, WALK.stages.from + 0.004)) : smooth(seg(rail, pose - WALK.approach.from, pose - WALK.approach.to));
  const ripple = WALK.ripple.from + (WALK.ripple.step * WALK.ripple.spread * panel) / n;
  up = Math.max(up, smooth(seg(p, ripple, ripple + WALK.ripple.rise)));
  return up * (1 - smooth(seg(p, WALK.down.from, WALK.down.to)));
}

// ---------------------------------------------------------------------------------------------------------
// What the walker stands on.

export type WalkItem =
  | { readonly kind: 'waypoint'; readonly stageId: string; readonly waypointId: string; readonly index: number }
  | { readonly kind: 'signpost'; readonly stageId: string }
  | { readonly kind: 'camp'; readonly stageId: string };

export interface ItemSpan {
  readonly item: WalkItem;
  /** The share of the stage's window this item owns. */
  readonly from: number;
  readonly to: number;
  /** Where the item stands along the panel's strip, 0 at the first stop and 1 at the camp. */
  readonly at: number;
}

export interface ItemHit extends ItemSpan {
  /** How far through the item's own share, 0 to 1. */
  readonly local: number;
}

type StageLike = Pick<Stage, 'id' | 'waypoints' | 'project'>;

/**
 * The items of a stage in walking order with the share of the stage each one owns: every waypoint, then the
 * signpost, then the camp when the stage has a project. A waypoint's share is half equal and half by its
 * minutes, so a five minute step is still readable next to a long one. The shares join without a gap.
 */
export function stageItems(stage: StageLike): ItemSpan[] {
  const waypoints = stage.waypoints;
  const minutes = waypoints.map((waypoint) => Math.max(0, waypoint.minutes));
  const total = minutes.reduce((sum, value) => sum + value, 0);
  const count = waypoints.length;
  const hasCamp = Boolean(stage.project);
  const walkShare = count > 0 ? SHARE.waypoints : 0;
  const spans: ItemSpan[] = [];
  let at = 0;
  let before = 0;
  waypoints.forEach((waypoint, index) => {
    const byMinutes = total > 0 ? (minutes[index] as number) / total : 1 / count;
    const share = walkShare * (0.5 / count + 0.5 * byMinutes);
    const to = index === count - 1 ? walkShare : at + share;
    const middle = total > 0 ? (before + (minutes[index] as number) / 2) / total : (index + 0.5) / count;
    spans.push({ item: { kind: 'waypoint', stageId: stage.id, waypointId: waypoint.id, index }, from: at, to, at: PLACE.waypoints * middle });
    at = to;
    before += minutes[index] as number;
  });
  const signTo = hasCamp ? 1 - SHARE.camp : 1;
  spans.push({ item: { kind: 'signpost', stageId: stage.id }, from: at, to: signTo, at: PLACE.signpost });
  if (hasCamp) spans.push({ item: { kind: 'camp', stageId: stage.id }, from: signTo, to: 1, at: PLACE.camp });
  return spans;
}

/** The item at share `f` of a stage's window. Every `f` from 0 to 1 has one. */
export function itemAt(stage: StageLike, f: number): ItemHit {
  const spans = stageItems(stage);
  const value = clamp01(f);
  let found = spans[spans.length - 1] as ItemSpan;
  for (const span of spans) {
    if (value < span.to) {
      found = span;
      break;
    }
  }
  return { ...found, local: clamp01((value - found.from) / Math.max(1e-9, found.to - found.from)) };
}

/** The share of a stage's window at which the walker stands on an item: the middle of its share. */
export function itemMiddle(stage: StageLike, match: (item: WalkItem) => boolean): number | null {
  const span = stageItems(stage).find((entry) => match(entry.item));
  return span ? (span.from + span.to) / 2 : null;
}

/**
 * How long a crease crossing is next to the strip between two stops: the stops stand 0.32 inside the creases
 * of a panel 4.2 wide. The walker's pace is judged with this, so he does not crawl over a crease and then run.
 */
const CROSSING = 0.09;

/** A place on the path as a distance in strip lengths, so that equal steps are about equal walks. */
const toWalk = (path: number): number => (path < 0 ? path * CROSSING : path <= 1 ? path : 1 + (path - 1) * CROSSING);
const fromWalk = (walk: number): number => (walk < 0 ? walk / CROSSING : walk <= 1 ? walk : 1 + (walk - 1) / CROSSING);

/**
 * Where the walker is on the path of a panel at share `f` of its stage. The path runs from -1 (the crease he
 * comes in over) through 0 (the panel's first stop) and 1 (its camp) to 2 (the crease he leaves over). On the
 * first panel he starts at the gate, on the last he ends at the summit camp. He is on each waypoint and on the
 * signpost in the middle of its share, reaches the end of the stage in the middle of the camp's share, whether
 * or not a camp stands there, and walks evenly between them.
 */
export function pathAt(stage: StageLike, f: number, first: boolean, last: boolean): number {
  const knots: [number, number][] = [[0, toWalk(first ? 0 : -1)]];
  for (const span of stageItems(stage)) {
    if (span.item.kind === 'waypoint') knots.push([(span.from + span.to) / 2, span.at]);
  }
  knots.push([SHARE.waypoints + SHARE.signpost / 2, PLACE.signpost]);
  knots.push([1 - SHARE.camp / 2, PLACE.camp]);
  knots.push([1, toWalk(last ? 1 : 2)]);
  const value = clamp01(f);
  for (let index = 1; index < knots.length; index += 1) {
    const a = knots[index - 1] as [number, number];
    const b = knots[index] as [number, number];
    if (value <= b[0] || index === knots.length - 1) {
      const t = b[0] > a[0] ? clamp01((value - a[0]) / (b[0] - a[0])) : 1;
      return clamp(fromWalk(a[1] + (b[1] - a[1]) * t), first ? 0 : -1, last ? 1 : 2);
    }
  }
  return last ? 1 : 2;
}

/** The share of a stage's minutes the walker has behind him at a place on the panel's path. */
export function minutesShareAt(path: number): number {
  return clamp01(path / PLACE.waypoints);
}

/** The place on a panel's path for a share of the stage's minutes. */
export function pathForMinutes(share: number): number {
  return clamp01(share) * PLACE.waypoints;
}

/** The share of a stage's window at which the walker has `share` of its minutes behind him. */
export function fForMinutes(stage: StageLike, share: number, first: boolean, last: boolean): number {
  const target = pathForMinutes(share);
  let low = 0;
  let high = 1;
  for (let round = 0; round < 30; round += 1) {
    const middle = (low + high) / 2;
    if (pathAt(stage, middle, first, last) < target) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}
