import { Group, Vector3, type Raycaster } from 'three';
import { THEME } from '../look/theme';
import { buildSheet } from '../paper/sheet';
import type { FrameTime, ScenePart } from '../scene/contract';
import { deckleFor } from './art';
import { DESIGN, sheetDrawings, type Drawing, type NamedDrawing } from './brush';
import { band, box, disc, poly } from './shapes';
import { createStand, hitSheet } from './stand';

const T = THEME;

/**
 * The class flag: where a class is today. It stands on the route at the end of the last step the class did
 * together, and moves on with the date.
 *
 * It is told apart from the other flags by its shape and not by its colour. The pennants of a camp are pale
 * and pointed, one per rung of a project. This one is ink, cut with a swallow tail, and carries three heads in
 * a row: a group of people. The route colour is kept for the route and for "you are here".
 */
export const CLASS_FLAG = {
  /** Height of the pole and where on it the cloth hangs, in scene units. */
  pole: 0.62,
  hoist: 0.6,
  /** The cloth flutters by this many radians about its hoist. */
  flutter: 0.06,
} as const;

const POLE = { width: 8, height: 66 } as const;
const poleDrawing: Drawing = (b) => {
  const pole = band([[4, -4], [4, 62]], 2.3, 1.9);
  b.piece(T.paperHi, pole);
  b.inside(pole, () => b.tone(T.ink, 0.24, box(1.6, -6, 1.5, 72)));
  b.piece(T.ink, disc(4, 63, 1.9));
  b.tone(T.paperHi, 0.35, disc(4.6, 63.6, 0.6));
};

const CLOTH = { width: 34, height: 20 } as const;
const clothDrawing: Drawing = (b) => {
  const cloth = poly([[0, 0.4], [33.6, 2.4], [25.4, 10], [33.6, 17.6], [0, 19.6]], 0.8);
  b.piece(T.ink, cloth);
  b.inside(cloth, () => {
    b.tone(T.paperHi, 1, box(-2, -2, 4.4, 24));
    // Three heads over three pairs of shoulders.
    for (let i = 0; i < 3; i += 1) {
      const x = 9.2 + i * 6.1;
      b.tone(T.paperHi, 1, disc(x, 12.4, 1.75));
      b.tone(T.paperHi, 1, poly([[x - 2.6, 4.6], [x - 2.1, 8.6], [x, 9.7], [x + 2.1, 8.6], [x + 2.6, 4.6]], 0.9));
    }
    b.tone(T.paperHi, 0.07, poly([[0, 10], [34, 10], [34, 22], [0, 22]]));
  });
};

/** The drawings of the class flag, for checks. */
export function classFlagPieces(): NamedDrawing[] {
  return [
    { name: 'class/pole', draw: poleDrawing, ...POLE },
    { name: 'class/cloth', draw: clothDrawing, ...CLOTH },
  ];
}

export interface ClassFlagOptions {
  readonly phone?: boolean;
  readonly seed?: number;
  readonly up?: boolean;
}

export interface ClassFlagPart extends ScenePart<Group> {
  setUp(up: boolean, immediate?: boolean): void;
  readonly up: number;
  tap(): void;
  hit(raycaster: Raycaster): number | null;
  /** The top of the pole in world space. */
  top(target?: Vector3): Vector3;
}

/** A pole with the class's cloth on it. It starts lying on the map and stands up with `setUp(true)`. */
export function createClassFlag(options: ClassFlagOptions = {}): ClassFlagPart {
  const seed = options.seed ?? 0;
  const phone = options.phone ?? false;
  const stand = createStand({ sway: 0.004, phase: (seed % 47) * 0.21, up: options.up });
  const object = new Group();
  object.add(stand.hinge);

  const pole = buildSheet({
    width: POLE.width / DESIGN,
    height: POLE.height / DESIGN,
    ...sheetDrawings(poleDrawing, POLE.width, POLE.height),
    paper: T.paperHi,
    soft: 0.004,
    rim: 0.2,
    seed: seed + 2,
    warp: 0.005,
    deckle: deckleFor(POLE.width / DESIGN, POLE.height / DESIGN),
    resolution: phone ? 300 : 520,
  });
  stand.hinge.add(pole.object);

  const cloth = buildSheet({
    width: CLOTH.width / DESIGN,
    height: CLOTH.height / DESIGN,
    ...sheetDrawings(clothDrawing, CLOTH.width, CLOTH.height),
    paper: T.ink,
    soft: 0.004,
    rim: 0.16,
    hinge: 0,
    warp: 0.012,
    seed: seed + 9,
    resolution: phone ? 520 : 900,
  });
  // The cloth hangs from its upper corner at the pole and streams to the right.
  const hoist = new Group();
  cloth.object.position.set(CLOTH.width / DESIGN / 2, -CLOTH.height / DESIGN, 0);
  hoist.add(cloth.object);
  hoist.position.set(0.012, CLASS_FLAG.hoist, 0.006);
  stand.hinge.add(hoist);

  return {
    object,
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
      for (const sheet of [pole, cloth]) {
        const distance = hitSheet(raycaster, sheet);
        if (distance !== null && (best === null || distance < best)) best = distance;
      }
      return best;
    },
    top(target = new Vector3()) {
      object.updateWorldMatrix(true, true);
      return stand.hinge.localToWorld(target.set(0, CLASS_FLAG.pole, 0));
    },
    update(frame: FrameTime) {
      stand.update(frame);
      hoist.rotation.z = frame.reduced ? 0 : Math.sin(frame.t * 1.9 + seed * 0.7) * CLASS_FLAG.flutter * Math.min(1, Math.max(0, stand.up));
    },
    dispose() {
      pole.dispose();
      cloth.dispose();
    },
  };
}
