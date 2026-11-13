import type { FrameTime } from '../scene/contract';
import { bounceFloor, clamp01, settleSpring, smooth, spring, stepSpringKC, type Spring } from './motion';

/**
 * A stack of standing sheets that fold down onto the map and stand up again, like the scenes of a pop-up book.
 *
 * Sheets are ranked from the back (rank 0) to the front. Front sheets lift first and fold first. When they lie,
 * each rests a little higher than the one behind it, so the pile has thickness. A sheet folds backwards, away
 * from the viewer, so a front sheet on its way down would sweep through any sheet behind it that still stands:
 * `keepApart` makes the one behind give way.
 */

export const STACK = {
  /** Spring of rank 0. Each rank in front is stiffer by `stiffnessPerRank`. */
  stiffness: 150,
  stiffnessPerRank: 8,
  damping: 12,
  /** Share of its speed a sheet keeps when it hits the map. */
  bounce: 0.2,
  /** How much later each rank starts, as a share of the whole fold. */
  delayPerRank: 0.075,
  /** Height at which a lying sheet rests, per rank. */
  restPerRank: 0.009,
} as const;

const LYING = -Math.PI / 2;

/** What the stack needs to know about one sheet. A `Sheet` from `buildSheet` fits when given a place. */
export interface Leaf {
  /** Height of the sheet: how far back it reaches when it lies. */
  readonly height: number;
  /** Width of the sheet and the x of its middle, for the keep-apart test. */
  readonly width: number;
  readonly x: number;
  /** Depth of its hinge. Larger z is nearer the viewer. */
  readonly z: number;
  /** Sway when standing, in radians. */
  readonly sway?: number;
  /** A number that sets the sheet's own sway rhythm. */
  readonly phase?: number;
  /** Own spring, for props that stand up more softly than the default. */
  readonly stiffness?: number;
  readonly damping?: number;
  /** Receives the pose every frame. */
  apply?(pose: LeafPose): void;
}

export interface LeafPose {
  /** Rotation about the hinge: 0 stands, -PI / 2 lies. */
  readonly angle: number;
  /** Height of the hinge above the map. */
  readonly lift: number;
  /** Sideways sway about the foot. */
  readonly sway: number;
}

export interface LeafState extends LeafPose {
  readonly rank: number;
  /** 0 lying, 1 standing. */
  readonly up: number;
}

export interface SheetStack {
  /** Adds a sheet and returns its index. Ranks follow depth: the sheet with the smallest z is rank 0. */
  add(leaf: Leaf): number;
  /** Where the whole stack should be: 0 all lying, 1 all standing. */
  setFold(fold: number): void;
  readonly fold: number;
  /** Puts every sheet on its target at once, with no motion. */
  settle(): void;
  update(frame: FrameTime): void;
  /** The pose of sheet `index` after the last update. */
  state(index: number): LeafState;
  readonly count: number;
  /** True when no sheet is moving any more. */
  readonly atRest: boolean;
}

interface Entry {
  leaf: Leaf;
  rank: number;
  spring: Spring;
  target: number;
  sway: number;
}

/**
 * The share of its way up a sheet of `rank` should have covered when the stack is at `fold`. `rising` says
 * which way the fold is moving: front sheets lead in both directions.
 */
export function leafProgress(fold: number, rank: number, count: number, rising: boolean): number {
  const last = Math.max(0, count - 1);
  const span = 1 + STACK.delayPerRank * last;
  const delay = rising ? STACK.delayPerRank * (last - rank) : STACK.delayPerRank * rank;
  return smooth(clamp01(clamp01(fold) * span - delay));
}

/**
 * Makes sheets behind a folding sheet give way. `angles[i]` is the fold of sheet i (0 standing, -PI / 2 lying).
 * For every pair, when the front sheet leans far enough back to reach the hinge of the one behind and the two
 * overlap sideways, the one behind is pushed down to at least the same angle. Returns the indices it moved.
 */
export function keepApart(leaves: readonly Leaf[], angles: number[]): number[] {
  const moved: number[] = [];
  const order = leaves.map((_, index) => index).sort((a, b) => (leaves[b] as Leaf).z - (leaves[a] as Leaf).z);
  for (let i = 0; i < order.length; i += 1) {
    const front = order[i] as number;
    const frontLeaf = leaves[front] as Leaf;
    const frontAngle = angles[front] as number;
    const reach = frontLeaf.height * Math.sin(-frontAngle);
    if (reach <= 0) continue;
    for (let j = i + 1; j < order.length; j += 1) {
      const behind = order[j] as number;
      const behindLeaf = leaves[behind] as Leaf;
      const gap = frontLeaf.z - behindLeaf.z;
      if (gap <= 0 || gap >= reach) continue;
      const overlap = Math.abs(frontLeaf.x - behindLeaf.x) < (frontLeaf.width + behindLeaf.width) / 2;
      if (overlap && (angles[behind] as number) > frontAngle) {
        angles[behind] = frontAngle;
        moved.push(behind);
      }
    }
  }
  return moved;
}

export function createSheetStack(): SheetStack {
  const entries: Entry[] = [];
  let fold = 0;
  let rising = true;
  let atRest = true;

  const rerank = () => {
    const order = entries.map((_, index) => index).sort((a, b) => (entries[a] as Entry).leaf.z - (entries[b] as Entry).leaf.z);
    order.forEach((index, rank) => ((entries[index] as Entry).rank = rank));
  };

  const retarget = () => {
    for (const entry of entries) {
      entry.target = LYING * (1 - leafProgress(fold, entry.rank, entries.length, rising));
    }
  };

  const poseOf = (entry: Entry): LeafState => {
    const up = clamp01(1 - entry.spring.x / LYING);
    return {
      rank: entry.rank,
      angle: entry.spring.x,
      lift: STACK.restPerRank * (entry.rank + 1) * (1 - up),
      sway: entry.sway,
      up,
    };
  };

  const push = () => {
    for (const entry of entries) entry.leaf.apply?.(poseOf(entry));
  };

  return {
    add(leaf) {
      entries.push({ leaf, rank: 0, spring: spring(LYING), target: LYING, sway: 0 });
      rerank();
      retarget();
      for (const entry of entries) if (entry.leaf === leaf) settleSpring(entry.spring, entry.target);
      push();
      return entries.length - 1;
    },
    setFold(next) {
      const value = clamp01(next);
      if (value === fold) return;
      rising = value > fold;
      fold = value;
      retarget();
      atRest = false;
    },
    get fold() {
      return fold;
    },
    settle() {
      for (const entry of entries) {
        settleSpring(entry.spring, entry.target);
        entry.sway = 0;
      }
      atRest = true;
      push();
    },
    update(frame) {
      if (frame.reduced) {
        for (const entry of entries) {
          settleSpring(entry.spring, entry.target);
          entry.sway = 0;
        }
        atRest = true;
        push();
        return;
      }
      // Springs are stepped with at most 34 ms, so a slow frame cannot throw a sheet through the map.
      const dt = Math.min(frame.dt, 0.034);
      let moving = false;
      for (const entry of entries) {
        const k = entry.leaf.stiffness ?? STACK.stiffness + STACK.stiffnessPerRank * entry.rank;
        const c = entry.leaf.damping ?? STACK.damping;
        stepSpringKC(entry.spring, entry.target, k, c, dt);
        bounceFloor(entry.spring, LYING, STACK.bounce);
        if (Math.abs(entry.spring.x - entry.target) > 1e-4 || Math.abs(entry.spring.v) > 1e-3) moving = true;
      }
      const angles = entries.map((entry) => entry.spring.x);
      for (const index of keepApart(entries.map((entry) => entry.leaf), angles)) {
        const entry = entries[index] as Entry;
        entry.spring.x = angles[index] as number;
        if (entry.spring.v > 0) entry.spring.v = 0;
      }
      for (const entry of entries) {
        const phase = entry.leaf.phase ?? entry.rank * 1.7;
        const up = clamp01(1 - entry.spring.x / LYING);
        entry.sway = Math.sin(frame.t * (0.26 + 0.045 * phase) + phase) * (entry.leaf.sway ?? 0) * up;
      }
      atRest = !moving;
      push();
    },
    state(index) {
      const entry = entries[index];
      if (!entry) throw new Error(`SheetStack: no sheet ${index}`);
      return poseOf(entry);
    },
    get count() {
      return entries.length;
    },
    get atRest() {
      return atRest;
    },
  };
}
