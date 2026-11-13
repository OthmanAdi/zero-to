import { spring, stepSpringKC, type Spring } from '../paper/motion';

/**
 * The turntable as numbers: one angle on a spring, the selected sheet, and the rule for when a mountain may
 * stand. Nothing here touches three.js, so the whole switch can be tested and replayed frame by frame.
 *
 * Angles are degrees. `phi` is the turn of the table. Sheet `i` lies at `phi - i * step` away from the lamp,
 * where 0 is the lit slot in front of the viewer and a positive angle is to the viewer's right.
 */
export const TURN = {
  /** A person's pick: heavy and calm, close to critical damping. */
  pick: { k: 15, c: 7.4 },
  /** The table turning by itself: slower and heavier. */
  auto: { k: 4.2, c: 3.9 },
  /** A mountain may stand once the table is this close to its target, in degrees ... */
  standWithin: 3,
  /** ... and slower than this, in degrees per second. */
  standSlower: 25,
  /** Where the table starts when it turns in during the intro. */
  introFrom: -160,
  /** Distance of the sheet centres from the table centre. */
  radius: 5.8,
  /** The fewest and the most sheets the table holds. */
  minSheets: 3,
  maxSheets: 7,
} as const;

export type PickBy = 'person' | 'auto' | 'scroll';

export interface Turntable {
  readonly count: number;
  /** Degrees between two sheets. */
  readonly step: number;
  /** The table angle right now. */
  readonly phi: number;
  /** Degrees per second. */
  readonly velocity: number;
  /** The angle the table is turning to. Not wrapped, so a spring can run on it. */
  readonly target: number;
  readonly selected: number;
  /** The sheet whose mountain may stand, or -1 while the table still moves. */
  readonly up: number;
  /** Who made the last pick. */
  readonly by: PickBy;
  /**
   * Selects a sheet. The selection changes at once; the table follows by the shorter way round. A pick during a
   * turn carries on from where the table is. Returns false when the index is not on the table or already selected.
   */
  select(index: number, by?: PickBy): boolean;
  /** Advances the spring by `dt` seconds. */
  advance(dt: number): void;
  /** Puts the table on its target at once. Reduced motion uses this. */
  settle(): void;
  /** Moves the table away from its target by an angle, for the turn-in of the intro. */
  displace(degrees: number): void;
  /** The signed angle of a sheet from the lit slot, in (-180, 180]. */
  angleOf(index: number): number;
}

/** How many sheets a table with this many roadmaps shows. */
export function clampSheetCount(count: number): number {
  const n = Number.isFinite(count) ? Math.round(count) : TURN.minSheets;
  return Math.min(TURN.maxSheets, Math.max(1, n));
}

/** Wraps degrees into (-180, 180]. */
export function wrapDegrees(angle: number): number {
  const wrapped = ((angle % 360) + 360) % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

/**
 * Whole steps from one sheet to another by the shorter way round. With an even number of sheets the sheet
 * straight across is reached forwards.
 */
export function shortestSteps(from: number, to: number, count: number): number {
  if (count <= 0) return 0;
  const forward = (((to - from) % count) + count) % count;
  return forward > count / 2 ? forward - count : forward;
}

export function createTurntable(count: number): Turntable {
  const sheets = Math.max(1, Math.round(count));
  const step = 360 / sheets;
  const state: Spring = spring(0, 0);
  let target = 0;
  let selected = 0;
  let by: PickBy = 'person';
  let up = 0;

  const refreshUp = (): void => {
    if (up === selected) return;
    if (Math.abs(target - state.x) <= TURN.standWithin && Math.abs(state.v) < TURN.standSlower) up = selected;
  };

  return {
    count: sheets,
    step,
    get phi() {
      return state.x;
    },
    get velocity() {
      return state.v;
    },
    get target() {
      return target;
    },
    get selected() {
      return selected;
    },
    get up() {
      return up;
    },
    get by() {
      return by;
    },
    select(index, who = 'person') {
      if (!Number.isInteger(index) || index < 0 || index >= sheets || index === selected) return false;
      target += shortestSteps(selected, index, sheets) * step;
      selected = index;
      by = who;
      // The old mountain loses its right to stand the moment another sheet is picked.
      up = -1;
      return true;
    },
    advance(dt) {
      if (!(dt > 0)) return;
      const { k, c } = by === 'auto' ? TURN.auto : TURN.pick;
      stepSpringKC(state, target, k, c, dt);
      refreshUp();
    },
    settle() {
      state.x = target;
      state.v = 0;
      up = selected;
    },
    displace(degrees) {
      state.x = target + degrees;
      state.v = 0;
      up = -1;
    },
    angleOf(index) {
      return wrapDegrees(state.x - index * step);
    },
  };
}

export interface SlotPose {
  /** Signed degrees from the lit slot. */
  readonly angle: number;
  /** Centre of the sheet on the table top. */
  readonly x: number;
  readonly z: number;
  /** The sheet's `rotation.y`: its lower edge faces the rim. */
  readonly yaw: number;
  /** How much of its light a sheet keeps: 1 in the lit slot, 0.3 from 70 degrees away. */
  readonly dim: number;
}

/** How far from the lamp a sheet has faded to its darkest. */
export const DIM_OVER = 70;
export const DIM_FLOOR = 0.3;

/** Where sheet `i` of `count` lies when the table is turned by `phi` degrees. */
export function slotPose(index: number, phi: number, count: number): SlotPose {
  const sheets = Math.max(1, Math.round(count));
  const angle = wrapDegrees(phi - (index * 360) / sheets);
  const radians = (angle * Math.PI) / 180;
  const away = Math.min(1, Math.abs(angle) / DIM_OVER);
  return {
    angle,
    x: Math.sin(radians) * TURN.radius,
    z: Math.cos(radians) * TURN.radius,
    yaw: radians,
    dim: 1 - (1 - DIM_FLOOR) * away,
  };
}

/**
 * Sheets are 4.2 wide and their inner corners meet when more than five lie on the circle. From six sheets on
 * every sheet is drawn a little smaller, so that neighbours keep a gap.
 */
export function sheetScale(count: number): number {
  const sheets = Math.max(1, Math.round(count));
  if (sheets <= 5) return 1;
  const halfAngle = Math.PI / sheets - 0.018;
  const t = Math.tan(halfAngle);
  // Half width 2.1 k at the inner edge radius 5.8 - 2.8 k must stay inside the half angle.
  return Math.min(1, (TURN.radius * t) / (2.1 + 2.8 * t));
}
