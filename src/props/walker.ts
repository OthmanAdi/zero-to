import { Group, Vector3, type Raycaster } from 'three';
import { THEME } from '../look/theme';
import { settleSpring, spring, stepSpringKC } from '../paper/motion';
import { buildSheet, type Sheet } from '../paper/sheet';
import type { FrameTime, ScenePart } from '../scene/contract';
import { deckleFor } from './art';
import { sheetDrawings, type Drawing, type NamedDrawing } from './brush';
import { all, band, box, disc, poly, strip, type Pt } from './shapes';
import { STAND, createStand, hitSheet } from './stand';

/**
 * The walker: a small paper hiker with a pack and a stick. He is the reading cursor of the walk.
 *
 * He is a jointed puppet, the kind held together with split pins: a body, two legs that swing from the hip, an
 * arm that swings from the shoulder and a stick that stays planted while he steps past it. Nothing bends. All
 * the life comes from the pins.
 */
const T = THEME;
const S = THEME.surface;

export const WALKER = {
  /** Height in scene units. */
  height: 0.29,
  /** How high he rises in a step and how far he rocks, at full walking pace. */
  bob: 0.032,
  lean: 0.07,
  /** He stands turned a little towards the viewer. */
  yaw: -0.14,
  /** Steps per scene unit walked, and the slow idle that keeps him breathing when he stands. */
  phasePerUnit: 12.9,
  idle: 0.4,
  /** How fast the walk blends in and out, per second, and the speed at which it is a full walk. */
  blend: 8,
  fullSpeed: 0.65,
  /** Swing of the legs and of the free arm, in radians. */
  stride: 0.5,
  arm: 0.34,
  /** The tap wobble: wider and quicker than a prop's. */
  wobble: { amplitude: 0.14, rate: 9 },
  /** He springs up softly when he lands on the map. */
  springs: { rise: { k: 60, c: 7.2 }, fall: { k: 60, c: 7.2 } },
  /** Turning round to walk back. */
  turn: { k: 90, c: 14 },
} as const;

/** One walker unit: the figure is 100 of them tall. */
const WU = WALKER.height / 100;

export interface WalkPose {
  /** Lift of the whole figure, in scene units. */
  readonly bob: number;
  /** Rock about the feet, in radians. */
  readonly lean: number;
  /** Swing of each leg from the hip. Positive is forward. */
  readonly nearLeg: number;
  readonly farLeg: number;
  /** Swing of the free arm and of the arm that holds the stick, from the shoulder. */
  readonly farArm: number;
  readonly stickArm: number;
  /** Where the tip of the stick is, in walker units from the middle of the feet: forward and up. */
  readonly stickTip: { readonly x: number; readonly y: number };
  /** Rise and fall of the chest when he stands, as a scale. */
  readonly breath: number;
}

/**
 * The puppet's pose for a moment of the walk. `phase` counts steps: one unit is one step. `walk` is 0 when he
 * stands and 1 at full pace. The body is highest as the legs pass each other, as in a real step.
 */
export function walkCycle(phase: number, walk: number): WalkPose {
  const w = Math.min(1, Math.max(0, walk));
  const swing = Math.cos(Math.PI * phase);
  const rise = Math.sin(Math.PI * phase);
  const rest = 1 - w;
  return {
    bob: Math.abs(rise) * WALKER.bob * w,
    lean: rise * WALKER.lean * w,
    nearLeg: swing * WALKER.stride * w + 0.05 * rest,
    farLeg: -swing * WALKER.stride * w - 0.05 * rest,
    farArm: swing * WALKER.arm * w,
    stickArm: -swing * 0.2 * w,
    // The stick is planted ahead, he walks past it, then it swings forward clear of the ground.
    stickTip: { x: 15 + Math.cos(Math.PI * phase + 0.5) * 9 * w, y: Math.max(0, Math.sin(Math.PI * phase + 0.5)) * 4 * w },
    breath: 1 + Math.sin(Math.PI * 2 * phase) * 0.012 * rest,
  };
}

// The pieces, in walker units. Each is drawn in its own box with y up.

const BODY = { width: 46, height: 62, pivot: [22, 3] as Pt };
const bodyDrawing: Drawing = (b) => {
  // The pack rides high on his back, with the bedroll strapped across the top.
  const pack = box(3.5, 12, 15.5, 27, 4);
  b.piece(S.dirt, pack);
  b.inside(pack, () => {
    b.tone(T.walnut, 0.4, box(2, 10, 5.4, 32));
    b.tone(T.walnut, 0.32, box(2, 28.4, 20, 2));
    b.tone(T.walnutDeep, 0.5, box(7.4, 14.5, 7.4, 8.6, 1.4));
    b.tone(T.brass, 1, disc(11.1, 23.2, 0.9));
  });
  const roll = box(2.4, 37.6, 17.4, 7.2, 3.6);
  b.piece(S.sand, roll);
  b.inside(roll, () => {
    b.tone(S.dirt, 0.5, box(2, 37, 20, 2.4));
    b.tone(T.walnutDeep, 0.8, all(box(6.4, 37, 1.5, 9), box(14.4, 37, 1.5, 9)));
  });
  // The jacket, leaning into the walk.
  const jacket = poly([[15, 0], [30, 0], [31.6, 17], [31, 33], [27, 38.4], [20, 38.4], [16.4, 33], [14.6, 16]], 2);
  b.piece(T.ink, jacket);
  b.inside(jacket, () => {
    b.tone(T.paperHi, 0.13, poly([[26.5, 40], [33, 40], [33, -2], [27.5, -2], [28.5, 18]]));
    b.tone(T.brass, 1, box(13, 4.6, 20, 1.5));
    b.tone(S.dirt, 1, poly([[17.4, 38.6], [20.2, 38.6], [22.6, 7], [19.8, 7]]));
  });
  // Neck, head, nose, and the eye that makes him somebody.
  b.piece(S.sand, box(22, 36, 5.4, 6));
  b.piece(S.sand, disc(25.2, 46.2, 6.6));
  b.piece(S.sand, poly([[30.8, 47.4], [33.6, 45.6], [30.8, 43.8]], 0.5));
  b.tone(S.dirt, 0.4, poly([[18, 40], [23.2, 40], [22, 47], [19, 52], [18, 52]]));
  b.tone(T.ink, 1, disc(28.5, 47.4, 0.75));
  // A hat with a brim against the sun.
  const crown = poly([[19.2, 50.6], [20.6, 59], [29.6, 59.6], [31.6, 50]], 2.2);
  b.piece(T.walnut, band([[14.6, 51.2], [36.6, 49.2]], 2.6, 2.2));
  b.piece(T.walnut, crown);
  b.inside(crown, () => {
    b.tone(T.brass, 1, band([[18, 52.6], [33, 51.6]], 1.7));
    b.tone(T.walnutDeep, 0.4, box(18, 49, 4.4, 12));
  });
};

const LEG = { width: 28, height: 52, pivot: [11.5, 46.5] as Pt };
function legDrawing(far: boolean): Drawing {
  return (b) => {
    const leg = band([[11.5, 49.6], [11, 27], [11.5, 7]], 10, 7.6);
    b.piece(T.inkSoft, leg);
    b.inside(leg, () => {
      if (far) b.tone(T.ink, 0.5, box(0, 0, 28, 54));
      else b.tone(T.ink, 0.2, box(0, 0, 9.6, 54));
    });
    const boot = poly([[6.4, -1.4], [6.4, 9.4], [15.4, 9.4], [23.4, 3.8], [24, -1.4]], 1.8);
    b.piece(T.walnutDeep, boot);
    b.inside(boot, () => {
      b.tone(S.sand, 0.8, box(5, 7.6, 12, 2.4));
      b.tone(T.ink, 0.6, box(5, -2.4, 20, 2.2));
    });
  };
}

const STICK_ARM = { width: 26, height: 30, pivot: [6, 25.5] as Pt, hand: [13, -20.5] as Pt };
const stickArmDrawing: Drawing = (b) => {
  const sleeve = band([[6, 25.5], [8.4, 12.6], [18.4, 5.6]], 6.8, 5.6);
  b.piece(T.ink, sleeve);
  b.inside(sleeve, () => b.tone(T.paperHi, 0.14, band([[8, 26], [10.6, 13.6], [19, 7.6]], 2.2)));
  b.piece(S.sand, disc(19.4, 4.8, 3));
  b.line(S.dirt, 0.6, 0.5, all(strip([[18, 3], [20.6, 3.2]]), strip([[17.6, 4.8], [20.8, 5]])));
};

const FAR_ARM = { width: 16, height: 30, pivot: [7, 25.5] as Pt };
const farArmDrawing: Drawing = (b) => {
  const sleeve = band([[7, 25.5], [7.6, 13], [9.4, 4.6]], 6.2, 5);
  b.piece(T.ink, sleeve);
  b.inside(sleeve, () => b.tone(T.inkSoft, 0.3, box(0, 0, 16, 32)));
  b.piece(S.sand, disc(9.8, 2.8, 2.7));
  b.tone(S.dirt, 0.4, disc(9.8, 2.8, 2.7));
};

const STICK = { width: 6, height: 66, pivot: [3, 0] as Pt };
const stickDrawing: Drawing = (b) => {
  const shaft = band([[3, 0], [3.2, 30], [3, 62]], 2, 2.5);
  b.piece(T.walnut, shaft);
  b.inside(shaft, () => b.tone(T.walnutDeep, 0.5, box(1.4, -1, 1.1, 66)));
  b.piece(T.walnut, disc(3, 63.2, 2.5));
  b.tone(T.steel, 1, box(1.6, -0.6, 2.8, 2.6));
};

interface Piece {
  readonly sheet: Sheet;
  readonly joint: Group;
}

function piece(drawing: Drawing, size: { width: number; height: number; pivot: Pt }, paper: string, depth: number, seed: number, phone: boolean): Piece {
  const sheet = buildSheet({
    width: size.width * WU,
    height: size.height * WU,
    ...sheetDrawings(drawing, size.width, size.height),
    paper,
    soft: 0.0016,
    // A light edge reads as a pale fringe on a dark figure seen close up, so the core of the cut is thin.
    rim: 0.18,
    hinge: 0,
    warp: 0.003,
    deckle: deckleFor(size.width * WU, size.height * WU),
    seed,
    resolution: phone ? 800 : 1400,
    maxCanvas: 1400,
  });
  const joint = new Group();
  // The sheet hangs from its pin: the joint is where the pin goes through.
  sheet.object.position.set((size.width / 2 - size.pivot[0]) * WU, -size.pivot[1] * WU, depth);
  joint.add(sheet.object);
  return { sheet, joint };
}

/** The pieces of the puppet as drawings, in walker units, for checks. */
export function walkerPieces(): NamedDrawing[] {
  return [
    { name: 'walker/body', draw: bodyDrawing, width: BODY.width, height: BODY.height },
    { name: 'walker/near-leg', draw: legDrawing(false), width: LEG.width, height: LEG.height },
    { name: 'walker/far-leg', draw: legDrawing(true), width: LEG.width, height: LEG.height },
    { name: 'walker/stick-arm', draw: stickArmDrawing, width: STICK_ARM.width, height: STICK_ARM.height },
    { name: 'walker/far-arm', draw: farArmDrawing, width: FAR_ARM.width, height: FAR_ARM.height },
    { name: 'walker/stick', draw: stickDrawing, width: STICK.width, height: STICK.height },
  ];
}

export interface WalkerOptions {
  readonly phone?: boolean;
  readonly seed?: number;
  /** Starts lying on the map. By default the walker stands. */
  readonly up?: boolean;
}

export interface WalkerPart extends ScenePart<Group> {
  /**
   * Tells the walker how far he was moved along the route since the last frame, in scene units. Negative when
   * he was moved back. Whoever places `object` on the route calls this before `update`.
   */
  advance(distance: number): void;
  /** Turns him to walk to the right (1) or to the left (-1). `advance` does this by itself. */
  setFacing(direction: 1 | -1, immediate?: boolean): void;
  readonly facing: 1 | -1;
  /** 0 standing still, 1 walking at full pace, as it is now. */
  readonly walk: number;
  /** Steps taken so far. */
  readonly phase: number;
  /** The pose of the puppet in the last frame. */
  readonly pose: WalkPose;
  setUp(up: boolean, immediate?: boolean): void;
  readonly up: number;
  /** The tap swing at this moment, in radians. */
  readonly swing: number;
  tap(): void;
  hit(raycaster: Raycaster): number | null;
  /** A point just above his hat in world space. */
  top(target?: Vector3): Vector3;
}

/** Hip and shoulders, in walker units from the middle of the feet. */
const HIP: Pt = [0, 46];
const SHOULDER: Pt = [3.4, 80];
const FAR_SHOULDER: Pt = [0.6, 80];

export function createWalker(options: WalkerOptions = {}): WalkerPart {
  const seed = options.seed ?? 0;
  const phone = options.phone ?? false;
  const stand = createStand({ wobble: WALKER.wobble, up: options.up ?? true, springs: WALKER.springs });
  const object = new Group();
  object.add(stand.hinge);
  const turn = new Group();
  stand.hinge.add(turn);
  const rock = new Group();
  turn.add(rock);
  const lift = new Group();
  rock.add(lift);

  // From the back of the stack to the front: far arm, far leg, near leg, body, stick, the arm that holds it.
  const farArm = piece(farArmDrawing, FAR_ARM, T.ink, -0.008, seed + 1, phone);
  const farLeg = piece(legDrawing(true), LEG, T.inkSoft, -0.006, seed + 2, phone);
  const nearLeg = piece(legDrawing(false), LEG, T.inkSoft, -0.003, seed + 3, phone);
  const body = piece(bodyDrawing, BODY, T.ink, 0, seed + 4, phone);
  const stick = piece(stickDrawing, STICK, T.walnut, 0.003, seed + 5, phone);
  const stickArm = piece(stickArmDrawing, STICK_ARM, T.ink, 0.006, seed + 6, phone);

  farLeg.joint.position.set((HIP[0] - 1.2) * WU, HIP[1] * WU, 0);
  nearLeg.joint.position.set((HIP[0] + 1.2) * WU, HIP[1] * WU, 0);
  body.joint.position.set(HIP[0] * WU, HIP[1] * WU, 0);
  farArm.joint.position.set(FAR_SHOULDER[0] * WU, FAR_SHOULDER[1] * WU, 0);
  stickArm.joint.position.set(SHOULDER[0] * WU, SHOULDER[1] * WU, 0);
  lift.add(farArm.joint, farLeg.joint, nearLeg.joint, body.joint, stickArm.joint);
  // The stick stands on the map: it does not rise and fall with him.
  rock.add(stick.joint);
  const pieces = [farArm, farLeg, nearLeg, body, stick, stickArm];

  let moved = 0;
  let walk = 0;
  let phase = 0;
  let facing: 1 | -1 = 1;
  const yaw = spring(WALKER.yaw);
  let pose = walkCycle(0, 0);

  const facingYaw = () => (facing === 1 ? WALKER.yaw : Math.PI - WALKER.yaw);

  const apply = () => {
    lift.position.y = pose.bob;
    rock.rotation.z = -pose.lean;
    nearLeg.joint.rotation.z = pose.nearLeg;
    farLeg.joint.rotation.z = pose.farLeg;
    farArm.joint.rotation.z = pose.farArm;
    stickArm.joint.rotation.z = pose.stickArm;
    body.joint.scale.y = pose.breath;
    // The stick runs from its tip on the map up through his hand.
    const cos = Math.cos(pose.stickArm);
    const sin = Math.sin(pose.stickArm);
    const [hx, hy] = STICK_ARM.hand;
    const handX = SHOULDER[0] + hx * cos - hy * sin;
    const handY = SHOULDER[1] + hx * sin + hy * cos + pose.bob / WU;
    stick.joint.position.set(pose.stickTip.x * WU, pose.stickTip.y * WU, 0);
    stick.joint.rotation.z = -Math.atan2(handX - pose.stickTip.x, handY - pose.stickTip.y);
    turn.rotation.y = yaw.x;
  };
  apply();

  return {
    object,
    advance(distance) {
      if (Number.isFinite(distance)) moved += distance;
    },
    setFacing(direction, immediate = false) {
      facing = direction;
      if (immediate) {
        settleSpring(yaw, facingYaw());
        apply();
      }
    },
    get facing() {
      return facing;
    },
    get walk() {
      return walk;
    },
    get phase() {
      return phase;
    },
    get pose() {
      return pose;
    },
    setUp(up, immediate) {
      stand.setUp(up, immediate);
    },
    get up() {
      return stand.up;
    },
    get swing() {
      return stand.swing;
    },
    tap() {
      stand.tap();
    },
    hit(raycaster) {
      if (stand.up < 0.2) return null;
      let best: number | null = null;
      for (const part of pieces) {
        const distance = hitSheet(raycaster, part.sheet);
        if (distance !== null && (best === null || distance < best)) best = distance;
      }
      return best;
    },
    top(target = new Vector3()) {
      object.updateWorldMatrix(true, true);
      return stand.hinge.localToWorld(target.set(0, WALKER.height + 0.02, 0));
    },
    update(frame: FrameTime) {
      stand.update(frame);
      const step = moved;
      moved = 0;
      if (step > 1e-5) facing = 1;
      else if (step < -1e-5) facing = -1;
      if (frame.reduced) {
        // He is moved, he does not walk: no bob, no rock, no breath.
        walk = 0;
        pose = walkCycle(0, 0);
        settleSpring(yaw, facingYaw());
        apply();
        body.joint.scale.y = 1;
        return;
      }
      const dt = Math.min(frame.dt, STAND.maxStep);
      const distance = Math.abs(step);
      if (frame.dt > 0) {
        const pace = Math.min(1, distance / frame.dt / WALKER.fullSpeed);
        walk += (pace - walk) * (1 - Math.exp(-WALKER.blend * frame.dt));
      }
      phase += distance * WALKER.phasePerUnit + frame.dt * WALKER.idle;
      stepSpringKC(yaw, facingYaw(), WALKER.turn.k, WALKER.turn.c, dt);
      pose = walkCycle(phase, walk);
      apply();
    },
    dispose() {
      for (const part of pieces) part.sheet.dispose();
    },
  };
}
