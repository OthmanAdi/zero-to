import { Group, Vector3, type Raycaster } from 'three';
import { THEME } from '../look/theme';
import { clamp01, settleSpring, spring, stepSpringKC, type Spring } from '../paper/motion';
import { buildSheet, type Sheet } from '../paper/sheet';
import type { Draw2D } from '../paper/silhouette';
import type { FrameTime, ScenePart } from '../scene/contract';
import { artSheetSpec, deckleFor } from './art';
import { DESIGN, sheetDrawings, type Drawing, type NamedDrawing } from './brush';
import { propById } from './registry';
import { band, box, disc, poly, type Pt } from './shapes';
import { cairnStones } from './signposts';
import { STAND, createStand, hitSheet } from './stand';

const T = THEME;

// ---------------------------------------------------------------------------------------------------------
// The camp: where a stage's project is built. One flag per rung of the project.

/** The most rungs a project has: guided, changed, own. */
export const MAX_RUNGS = 3;

export const CAMP = {
  /** Where the flagpole stands, measured from the middle of the tent, and how tall it is. */
  pole: { x: 0.54, z: -0.03, height: 0.98 },
  /** Heights on the pole where the flags fly, the first rung highest. */
  slots: [0.86, 0.69, 0.52],
  /** Where a flag waits, rolled up at the foot of the pole. */
  rest: 0.07,
  restStep: 0.045,
  /** Spring of a flag running up the pole. */
  hoist: { k: 150, c: 12 },
} as const;

const POLE = { width: 8, height: 100 } as const;
const poleDrawing: Drawing = (b) => {
  const pole = band([[4, -4], [4, 96]], 2.8, 2.3);
  b.piece(T.walnut, pole);
  b.inside(pole, () => b.tone(T.walnutDeep, 0.5, box(2, -6, 1.4, 104)));
  b.piece(T.brass, disc(4, 97, 2.1));
  b.tone(T.paperHi, 0.4, disc(4.7, 97.7, 0.7));
  b.piece(T.walnut, band([[4, 14], [7.4, 16]], 1.5));
};

const FLAG = { width: 27, height: 15 } as const;
/** A pennant. The number of bars at the hoist tells the rungs apart, so the flags do not rely on colour. */
function flagDrawing(bars: number): Drawing {
  return (b) => {
    const cloth = poly([[0, 0.3], [27, 7.5], [0, 14.7]], 0.7);
    b.piece(T.paperHi, cloth);
    b.inside(cloth, () => {
      b.tone(T.brass, 1, box(-2, -2, 5.4, 19));
      for (let i = 0; i < bars; i += 1) b.tone(T.ink, 1, box(6.2 + i * 3.4, -2, 1.7, 19));
      b.tone(T.ink, 0.08, poly([[0, -2], [27, 7.5], [0, 5]]));
    });
  };
}

/** The drawings of the camp and the cairn, for checks. The tent is in the registry as `camp/tent`. */
export function campPieces(): NamedDrawing[] {
  return [
    { name: 'camp/pole', draw: poleDrawing, ...POLE },
    ...[1, 2, 3].map((bars) => ({ name: `camp/flag-${bars}`, draw: flagDrawing(bars), ...FLAG })),
    { name: 'cairn/pile', draw: cairnDrawing, ...CAIRN },
  ];
}

export interface CampOptions {
  readonly phone?: boolean;
  readonly seed?: number;
  readonly up?: boolean;
  /** Rungs already done. */
  readonly done?: number;
}

export interface CampPart extends ScenePart<Group> {
  /** How many rungs the project has: the number of flags. */
  readonly count: number;
  /** Raises one flag per finished rung and lowers the rest. */
  setRungs(done: number, immediate?: boolean): void;
  readonly rungs: number;
  /** How far flag `index` is up its way, 0 at the foot of the pole to 1 at its place. */
  flagUp(index: number): number;
  setUp(up: boolean, immediate?: boolean): void;
  readonly up: number;
  tap(): void;
  hit(raycaster: Raycaster): number | null;
  /** The ridge of the tent in world space, for the lead line of the camp card. */
  top(target?: Vector3): Vector3;
}

/** A tent with a flagpole. `rungs` is the number of rungs of the stage's project, 1 to 3. */
export function createCamp(rungs: number, options: CampOptions = {}): CampPart {
  const count = Math.min(MAX_RUNGS, Math.max(1, Math.round(Number.isFinite(rungs) ? rungs : 1)));
  const seed = options.seed ?? 0;
  const phone = options.phone ?? false;
  const tentArt = propById('camp/tent');
  if (!tentArt) throw new Error('createCamp: the tent drawing is missing');

  const stand = createStand({ sway: 0.003, phase: (seed % 61) * 0.19, up: options.up });
  const object = new Group();
  object.add(stand.hinge);
  const tent = buildSheet(artSheetSpec(tentArt, { phone, seed }));
  stand.hinge.add(tent.object);

  const pole = buildSheet({
    width: POLE.width / DESIGN,
    height: POLE.height / DESIGN,
    ...sheetDrawings(poleDrawing, POLE.width, POLE.height),
    paper: T.walnut,
    soft: 0.004,
    rim: 0.26,
    seed: seed + 5,
    warp: 0.006,
    deckle: deckleFor(POLE.width / DESIGN, POLE.height / DESIGN),
    resolution: phone ? 300 : 520,
  });
  pole.object.position.set(CAMP.pole.x, 0, CAMP.pole.z);
  stand.hinge.add(pole.object);

  const flags: { sheet: Sheet; group: Group; state: Spring }[] = [];
  for (let i = 0; i < count; i += 1) {
    const sheet = buildSheet({
      width: FLAG.width / DESIGN,
      height: FLAG.height / DESIGN,
      ...sheetDrawings(flagDrawing(i + 1), FLAG.width, FLAG.height),
      paper: T.paperHi,
      soft: 0.004,
      rim: 0.3,
      hinge: 0,
      warp: 0.01,
      seed: seed + 11 + i,
      resolution: phone ? 520 : 900,
    });
    const group = new Group();
    sheet.object.position.set(FLAG.width / DESIGN / 2, -FLAG.height / DESIGN / 2, 0);
    group.add(sheet.object);
    group.position.set(CAMP.pole.x + 0.012, CAMP.rest, CAMP.pole.z + 0.006 + i * 0.002);
    stand.hinge.add(group);
    flags.push({ sheet, group, state: spring(0) });
  }

  let done = 0;
  const pose = (t: number, reduced: boolean) => {
    flags.forEach((flag, index) => {
      const raised = flag.state.x;
      const share = clamp01(raised);
      const rest = CAMP.rest + (count - 1 - index) * CAMP.restStep;
      flag.group.position.y = rest + ((CAMP.slots[index] as number) - rest) * raised;
      // Rolled up and hanging at the foot, open and streaming at the top.
      flag.group.scale.x = 0.34 + 0.66 * share;
      const flutter = reduced ? 0 : Math.sin(t * 2.1 + index * 1.9) * 0.05 * share;
      flag.group.rotation.z = -0.62 * (1 - share) + flutter;
    });
  };
  const setRungs = (next: number, immediate = false) => {
    done = Math.min(count, Math.max(0, Math.round(Number.isFinite(next) ? next : 0)));
    if (immediate) {
      flags.forEach((flag, index) => settleSpring(flag.state, index < done ? 1 : 0));
      pose(0, true);
    }
  };
  setRungs(options.done ?? 0, true);

  return {
    object,
    count,
    setRungs,
    get rungs() {
      return done;
    },
    flagUp(index) {
      return flags[index]?.state.x ?? 0;
    },
    setUp(up, immediate) {
      stand.setUp(up, immediate);
    },
    get up() {
      return stand.up;
    },
    tap() {
      stand.tap();
    },
    hit(raycaster) {
      if (stand.up < 0.2) return null;
      let best: number | null = null;
      for (const sheet of [tent, pole, ...flags.map((flag) => flag.sheet)]) {
        const distance = hitSheet(raycaster, sheet);
        if (distance !== null && (best === null || distance < best)) best = distance;
      }
      return best;
    },
    top(target = new Vector3()) {
      object.updateWorldMatrix(true, true);
      return stand.hinge.localToWorld(target.set(-0.11, tent.height * 0.86, 0));
    },
    update(frame: FrameTime) {
      stand.update(frame);
      flags.forEach((flag, index) => {
        const target = index < done ? 1 : 0;
        if (frame.reduced) settleSpring(flag.state, target);
        else stepSpringKC(flag.state, target, CAMP.hoist.k, CAMP.hoist.c, Math.min(frame.dt, STAND.maxStep));
      });
      pose(frame.t, frame.reduced);
    },
    dispose() {
      tent.dispose();
      pole.dispose();
      for (const flag of flags) flag.sheet.dispose();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// The cairn: a waypoint that comes back for review. When it is due, a ring in the route colour lies round it.

const CAIRN = { width: 36, height: 30 } as const;
const CAIRN_PILE: readonly (readonly ['rock' | 'scree', readonly Pt[]])[] = [
  ['rock', [[0.5, -4], [1, 6], [6.5, 10], [15, 9], [19.5, 5.5], [20, -4]]],
  ['scree', [[17, -4], [18, 8], [24, 10.4], [31, 9], [35.5, 4.5], [35, -4]]],
  ['scree', [[5, 8.6], [6.6, 15], [13, 18.2], [24, 17.4], [29.5, 13], [29, 8.8]]],
  ['rock', [[10, 16], [11.4, 21.6], [18, 24.2], [25, 22], [26, 16.6]]],
  ['scree', [[14, 22.4], [15.4, 27], [19.4, 28.8], [23, 26.6], [22.8, 22.6]]],
];
const cairnDrawing: Drawing = (b) => cairnStones(b, CAIRN_PILE);

export const DUE_RING = {
  /** Radius of the ring and the width of its band, in scene units. */
  radius: 0.27,
  band: 0.034,
  /** The ring breathes once in this many seconds. */
  period: 2.6,
  swell: 0.05,
  spring: { k: 150, c: 12 },
} as const;

export interface CairnOptions {
  readonly phone?: boolean;
  readonly seed?: number;
  readonly up?: boolean;
  readonly due?: boolean;
}

export interface CairnPart extends ScenePart<Group> {
  /** Lays the ring round the cairn: this step is due for review. */
  setDue(due: boolean, immediate?: boolean): void;
  readonly due: boolean;
  /** How far the ring is out, 0 to 1. */
  readonly ring: number;
  setUp(up: boolean, immediate?: boolean): void;
  readonly up: number;
  tap(): void;
  hit(raycaster: Raycaster): number | null;
  top(target?: Vector3): Vector3;
}

export function createCairn(options: CairnOptions = {}): CairnPart {
  const seed = options.seed ?? 0;
  const phone = options.phone ?? false;
  const stand = createStand({ sway: 0.002, phase: (seed % 53) * 0.23, up: options.up });
  const object = new Group();
  object.add(stand.hinge);
  const pile = buildSheet({
    width: CAIRN.width / DESIGN,
    height: CAIRN.height / DESIGN,
    ...sheetDrawings(cairnDrawing, CAIRN.width, CAIRN.height),
    paper: THEME.surface.rock,
    soft: 0.006,
    rim: 0.4,
    seed,
    warp: 0.006,
    resolution: phone ? 520 : 900,
  });
  stand.hinge.add(pile.object);

  // The ring is its own flat piece of paper, cut as a band. It lies on the map and never stands up.
  const extent = (DUE_RING.radius + DUE_RING.band) * 2;
  const ringOutline: Draw2D = (ctx, width, height) => {
    const unit = width / extent;
    ctx.lineWidth = DUE_RING.band * unit;
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, DUE_RING.radius * unit, 0, Math.PI * 2);
    ctx.stroke();
  };
  const ring = buildSheet({
    width: extent,
    height: extent,
    standing: false,
    outline: ringOutline,
    paper: T.signal,
    soft: 0.005,
    rim: 0.2,
    warp: 0.004,
    seed: seed + 3,
    resolution: phone ? 300 : 520,
  });
  ring.mesh.castShadow = false;
  ring.object.position.y = 0.006;
  ring.object.visible = false;
  object.add(ring.object);

  let due = options.due ?? false;
  const state = spring(due ? 1 : 0);
  const pose = (t: number, reduced: boolean) => {
    const out = state.x;
    ring.object.visible = out > 0.01;
    const breath = reduced ? 0 : Math.sin((t / DUE_RING.period) * Math.PI * 2) * DUE_RING.swell * clamp01(out);
    const scale = Math.max(0.001, out * (1 + breath));
    ring.object.scale.set(scale, 1, scale);
  };
  pose(0, true);

  return {
    object,
    setDue(next, immediate = false) {
      due = next;
      if (immediate) {
        settleSpring(state, next ? 1 : 0);
        pose(0, true);
      }
    },
    get due() {
      return due;
    },
    get ring() {
      return state.x;
    },
    setUp(up, immediate) {
      stand.setUp(up, immediate);
    },
    get up() {
      return stand.up;
    },
    tap() {
      stand.tap();
    },
    hit(raycaster) {
      return stand.up > 0.2 ? hitSheet(raycaster, pile) : null;
    },
    top(target = new Vector3()) {
      object.updateWorldMatrix(true, true);
      return stand.hinge.localToWorld(target.set(0, CAIRN.height / DESIGN, 0));
    },
    update(frame: FrameTime) {
      stand.update(frame);
      if (frame.reduced) settleSpring(state, due ? 1 : 0);
      else stepSpringKC(state, due ? 1 : 0, DUE_RING.spring.k, DUE_RING.spring.c, Math.min(frame.dt, STAND.maxStep));
      pose(frame.t, frame.reduced);
    },
    dispose() {
      pile.dispose();
      ring.dispose();
    },
  };
}
