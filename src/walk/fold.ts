import { clamp01, easeInOutCubic, seg, smooth } from '../paper/motion';

/**
 * The folded map as numbers: how many panels, how they are stacked, and how every crease turns as the map opens.
 *
 * The map is a concertina. Panel 0 lies on the table. Every further panel hangs on the right edge of the one
 * before it, and the creases turn in alternate directions, so the shut map is a zig-zag stack and not a roll.
 * The cover hinges on the left edge of panel 0 and swings over to the left, where it lands as the legend.
 *
 * Nothing here touches three.js. Angles are rotations about the crease, which runs from the back of a panel to
 * its front (the z axis). A positive angle lifts the far edge of a panel up and over toward the left.
 */
export const PANEL = {
  /** One panel, across and front to back. */
  width: 4.2,
  depth: 5.6,
  /** Distance between two panels in the shut stack. */
  gap: 0.008,
  /** The fold every open panel keeps, in radians, so the creases still read. */
  zig: 0.045,
  /** How far the cover lies above the top panel when the map is shut. */
  coverRise: 0.007,
  /** The second crease of a pair swings out by this much in the middle of its turn. */
  flap: 0.2,
  /** A hinge counts as open above this. Scenes stand only on panels whose hinges are open. */
  landed: 0.985,
  /** How far the shut cover lifts to say "this opens", in radians. */
  peek: 0.16,
} as const;

/** The opening, as shares of the fold amount: the cover first, then the creases in pairs, then the settle. */
export const FOLD = {
  cover: { from: 0, to: 0.24 },
  start: 0.22,
  span: 0.73,
  /** How far a group starts before the one in front of it has finished, and how far it runs on. */
  lead: 0.005,
  tail: 0.015,
  end: 0.95,
  settle: { from: 0.9, to: 1 },
  min: 2,
  max: 8,
} as const;

export interface FoldWindow {
  readonly from: number;
  readonly to: number;
}

export interface CreaseSchedule {
  /** 1 is the crease between panel 0 and panel 1. */
  readonly index: number;
  readonly group: number;
  /** True for the crease that swings its panel over; false for the one that keeps the rest of the stack level. */
  readonly first: boolean;
  readonly from: number;
  readonly to: number;
  /** Which way the crease folds shut: 1 folds the panel over the top, -1 folds it back underneath. */
  readonly sign: 1 | -1;
}

export interface FoldSchedule {
  readonly panels: number;
  readonly cover: FoldWindow;
  readonly groups: readonly FoldWindow[];
  /** One entry per crease, `creases[0]` is crease 1. */
  readonly creases: readonly CreaseSchedule[];
  readonly settle: FoldWindow;
}

/** The number of panels a map may have. */
export function clampPanels(count: number): number {
  return Math.min(FOLD.max, Math.max(FOLD.min, Math.round(Number.isFinite(count) ? count : FOLD.min)));
}

/**
 * When each part of a map with `count` panels opens. Creases open two at a time: the first of a pair swings
 * its panel over, the second turns the other way by the same amount, so everything still folded rides along
 * level, like a gondola. With five panels the two pairs open over 0.22 to 0.60 and 0.58 to 0.95.
 */
export function foldSchedule(count: number): FoldSchedule {
  const panels = clampPanels(count);
  const creaseCount = panels - 1;
  const groupCount = Math.ceil(creaseCount / 2);
  const share = FOLD.span / groupCount;
  const groups: FoldWindow[] = [];
  for (let g = 0; g < groupCount; g += 1) {
    groups.push({
      from: g === 0 ? FOLD.start : FOLD.start + g * share - FOLD.lead,
      to: g === groupCount - 1 ? FOLD.end : FOLD.start + (g + 1) * share + FOLD.tail,
    });
  }
  const creases: CreaseSchedule[] = [];
  for (let k = 1; k <= creaseCount; k += 1) {
    const group = Math.floor((k - 1) / 2);
    const window = groups[group] as FoldWindow;
    creases.push({ index: k, group, first: k % 2 === 1, from: window.from, to: window.to, sign: k % 2 === 1 ? 1 : -1 });
  }
  return { panels, cover: { ...FOLD.cover }, groups, creases, settle: { ...FOLD.settle } };
}

/** How far the cover has opened at fold amount `fold`, 0 shut to 1 lying as the legend. */
export function coverOpen(schedule: FoldSchedule, fold: number): number {
  return easeInOutCubic(seg(fold, schedule.cover.from, schedule.cover.to));
}

/** How far crease `index` (1-based) has opened, 0 folded to 1 open. */
export function creaseOpen(schedule: FoldSchedule, index: number, fold: number): number {
  const crease = schedule.creases[index - 1];
  if (!crease) return 1;
  return easeInOutCubic(seg(fold, crease.from, crease.to));
}

/** How far the map has settled into its resting zig-zag, 0 to 1. */
export function settleAt(schedule: FoldSchedule, fold: number): number {
  return smooth(seg(fold, schedule.settle.from, schedule.settle.to));
}

/** The fold crease `index` keeps when the map lies open. Panel 0 lies flat, the others lean alternately. */
export function restAngle(index: number): number {
  if (index === 1) return PANEL.zig;
  return index % 2 === 1 ? 2 * PANEL.zig : -2 * PANEL.zig;
}

/** The turn of the cover about the left edge of panel 0. 0 lies shut on the stack. */
export function coverAngle(schedule: FoldSchedule, fold: number, peek = 0): number {
  return (Math.PI - PANEL.zig) * coverOpen(schedule, fold) + PANEL.peek * clamp01(peek) * (1 - coverOpen(schedule, fold));
}

/** The turn of crease `index` (1-based) at fold amount `fold`. Plus or minus PI is folded shut. */
export function creaseAngle(schedule: FoldSchedule, index: number, fold: number): number {
  const crease = schedule.creases[index - 1];
  if (!crease) return 0;
  const u = creaseOpen(schedule, index, fold);
  const shut = Math.PI * (1 - u);
  const rest = restAngle(index) * settleAt(schedule, fold);
  if (crease.first) return shut + rest;
  return -shut + PANEL.flap * Math.sin(Math.PI * u) + rest;
}

/** How far a panel's frame is pushed off its crease so that the shut stack has thickness. */
export function stackOffset(schedule: FoldSchedule, index: number, fold: number): number {
  const crease = schedule.creases[index - 1];
  if (!crease) return 0;
  return -crease.sign * PANEL.gap * (1 - creaseOpen(schedule, index, fold));
}

/** Height of the cover's hinge above panel 0. */
export function coverHeight(panels: number): number {
  return (clampPanels(panels) - 1) * PANEL.gap + PANEL.coverRise;
}

/** True when panel `panel` (0-based) lies open: the hinges on both of its sides are open. */
export function panelLanded(schedule: FoldSchedule, panel: number, fold: number): boolean {
  const left = panel === 0 ? coverOpen(schedule, fold) : creaseOpen(schedule, panel, fold);
  const right = panel >= schedule.panels - 1 ? 1 : creaseOpen(schedule, panel + 1, fold);
  return left > PANEL.landed && right > PANEL.landed;
}

/** The rotation of every panel in the map's own frame, panel 0 first: the sum of the creases before it. */
export function panelAngles(schedule: FoldSchedule, fold: number): number[] {
  const angles = [0];
  for (let k = 1; k < schedule.panels; k += 1) angles.push((angles[k - 1] as number) + creaseAngle(schedule, k, fold));
  return angles;
}
