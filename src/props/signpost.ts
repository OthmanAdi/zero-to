import { Group, Vector3, type Raycaster } from 'three';
import { dirOf } from '../i18n';
import { THEME } from '../look/theme';
import { canvasFont, drawText, measureTextWidth } from '../look/type';
import { settleSpring, spring, stepSpringKC, type Spring } from '../paper/motion';
import { buildSheet, type Sheet } from '../paper/sheet';
import type { FrameTime, ScenePart } from '../scene/contract';
import { deckleFor, resolutionFor } from './art';
import { ARM_TEXT, layoutArmText, type ArmText, type Measure } from './arm-text';
import { DESIGN, sheetDrawings, type Drawing, type NamedDrawing } from './brush';
import { arcPoints, band, box, disc, poly, strip } from './shapes';
import { SIGNPOSTS, SIGNPOST_KEYS, signpostStyle, type ArmLook, type SignpostKey, type SignpostStyle } from './signposts';
import { STAND, createStand, hitSheet } from './stand';

const T = THEME;

/** How an arm moves and where things sit on it. Shares are of the arm's height. */
export const ARM = {
  /** Spring of an arm swinging round the mast. */
  swing: { k: 120, c: 9 },
  /** Swing of an arm that is not ticked: it points back down the trail. Ticked is 0: up the route. */
  back: Math.PI,
  /**
   * The pin has a stop at either end. An arm that arrives with speed springs past the stop by this share of
   * what a free arm would, and comes back.
   */
  give: 0.36,
  /** An arm that is not ticked hangs a little. A ticked one is raised a little above level. */
  hang: -0.1,
  raise: 0.045,
  /** The pin through the arm, the tick roundel and where the words start. */
  pin: 0.3,
  roundel: 0.86,
  roundelRadius: 0.27,
  textFrom: 1.32,
  /** Clear board at the tip, by shape. */
  tip: { finger: 0.7, plate: 0.42, pennant: 0.78 },
  /** The shortest arm, so a one-word item is still a board. */
  shortest: 3.4,
  /** Share of the height that the words may fill. */
  textHeight: 0.84,
  /** Weight of the words. */
  weight: 600,
} as const;

/**
 * The swing of an arm, in radians, for how far its spring has turned it: 0 is back down the trail (a swing of
 * PI), 1 is up the route (a swing of 0). Past either end the stop takes most of the overshoot.
 */
export function armSwingAt(turned: number): number {
  if (turned > 1) return -(turned - 1) * ARM.back * ARM.give;
  if (turned < 0) return ARM.back - turned * ARM.back * ARM.give;
  return ARM.back * (1 - turned);
}

/** The length of an arm for words of this width at the one-line size. All values are in the same unit. */
export function armLength(textWidth: number, height: number, look: Pick<ArmLook, 'shape'>, reach: number): number {
  const wanted = height * ARM.textFrom + Math.max(0, textWidth) + height * ARM.tip[look.shape] + height * 0.1;
  return Math.min(Math.max(reach, height * ARM.shortest), Math.max(height * ARM.shortest, wanted));
}

interface ArmPaint {
  readonly look: ArmLook;
  /** Drawing units. */
  readonly length: number;
  readonly height: number;
  readonly text: ArmText;
  readonly lang: string | undefined;
}

/**
 * One arm as a drawing. `back` prints it for the side that shows while the arm points back down the trail:
 * the words and the tick are printed mirrored there, so they read the right way round from the front.
 */
function armDrawing(paint: ArmPaint, ticked: boolean, back: boolean): Drawing {
  const { look, length: L, height: h, text, lang } = paint;
  const tip = h * ARM.tip[look.shape];
  const textLeft = h * ARM.textFrom;
  const textRight = L - tip;
  return (b) => {
    const shape =
      look.shape === 'finger'
        ? poly([[0, 0.5], [L - h * 0.6, 0], [L, h / 2], [L - h * 0.6, h], [0, h - 0.5]], 0.9)
        : look.shape === 'plate'
          ? box(0, 0, L, h, h * 0.2)
          : poly([[0, 0.3], [L, h * 0.13], [L - h * 0.56, h / 2], [L, h * 0.87], [0, h - 0.3]], 0.7);
    b.piece(look.board, shape);
    b.inside(shape, () => {
      if (look.shape === 'finger') {
        b.tone(look.edge, 0.5, box(-2, -2, L + 4, 2 + h * 0.14));
        b.line(look.edge, 0.5, 0.4, strip([[h * 1.6, h * 0.8], [L - h * 1.3, h * 0.83]]));
        b.tone(T.paperHi, 0.3, poly([[L - h * 0.6, h + 1], [L + 1, h / 2], [L - h * 0.2, h / 2 + 0.4], [L - h * 0.72, h * 0.9]]));
      } else if (look.shape === 'plate') {
        b.line(look.edge, 0.9, 0.55, box(h * 0.09, h * 0.09, L - h * 0.18, h * 0.82, h * 0.14));
        b.tone(look.edge, 1, disc(L - h * 0.24, h / 2, h * 0.05));
      } else {
        b.tone(look.edge, 1, box(-2, -2, 2 + h * 0.2, h + 4));
        b.tone(T.ink, 0.1, poly([[h * 0.2, -2], [L, h * 0.13], [L - h * 0.56, h / 2], [h * 0.2, h * 0.34]]));
      }
    });
    // The split pin the arm turns on.
    b.tone(T.brass, 1, disc(h * ARM.pin, h / 2, h * 0.1));
    b.tone(T.brassDeep, 1, disc(h * ARM.pin, h / 2, h * 0.04));

    // The roundel: an empty ring until the item is ticked, then a white disc with the tick.
    const cx = h * ARM.roundel;
    const cy = h / 2;
    const r = h * ARM.roundelRadius;
    const flip = back ? -1 : 1;
    if (ticked) {
      b.tone(T.paperHi, 1, disc(cx, cy, r));
      b.line(look.ink, 1, h * 0.085, strip([[cx - flip * r * 0.5, cy - r * 0.02], [cx - flip * r * 0.12, cy - r * 0.42], [cx + flip * r * 0.52, cy + r * 0.44]]));
    } else {
      b.line(look.ink, 0.42, h * 0.045, disc(cx, cy, r * 0.86));
    }

    b.upright((ctx) => {
      if (text.lines.length === 0) return;
      ctx.save();
      if (back) {
        ctx.translate(textLeft + textRight, 0);
        ctx.scale(-1, 1);
      }
      ctx.font = canvasFont('text', text.size, ARM.weight);
      ctx.fillStyle = look.ink;
      ctx.textBaseline = 'middle';
      const pitch = text.size * ARM_TEXT.leading;
      const first = h / 2 - ((text.lines.length - 1) * pitch) / 2 + text.size * 0.04;
      text.lines.forEach((line, index) => {
        const rtl = dirOf(line) === 'rtl';
        drawText(ctx, line, rtl ? textRight : textLeft, first + index * pitch, { lang, align: rtl ? 'right' : 'left' });
      });
      ctx.restore();
    });
  };
}

/** The small pennant that stands on a passed signpost. */
const PENNANT = { width: 17, height: 31 } as const;
const pennantDrawing: Drawing = (b) => {
  b.piece(T.steel, band([[1.6, -3], [1.6, 30]], 1.6));
  const cloth = poly([[2.4, 29.5], [16.6, 24.8], [2.4, 19.5]], 0.6);
  b.piece(T.paperHi, cloth);
  b.inside(cloth, () => b.tone(T.brass, 1, box(0, 18, 5.2, 14)));
  b.line(T.ink, 1, 1.05, strip([[6.6, 24.8], [8.2, 23.1], [11.2, 26.4]]));
};

/** The padlock of a checkpoint that is still gated. */
const LOCK = { width: 12, height: 17 } as const;
const lockDrawing: Drawing = (b) => {
  const shackle = band(arcPoints([2.8, 8], [6, 21.5], [9.2, 8], 10), 1.9);
  b.piece(T.steel, shackle);
  const body = box(0.6, 0.4, 10.8, 9.6, 1.6);
  b.piece(T.ink, body);
  b.inside(body, () => b.tone(T.paperHi, 0.14, box(6.4, 0, 6, 11)));
  b.tone(T.paperHi, 1, disc(6, 6, 1.5));
  b.tone(T.paperHi, 1, box(5.3, 2.2, 1.4, 3.6, 0.5));
};

/** Every drawing a signpost is made of besides its post: each kind of arm in each state, the pennant, the lock. */
export function signpostPieces(): NamedDrawing[] {
  const pieces: NamedDrawing[] = [
    { name: 'signpost/pennant', draw: pennantDrawing, ...PENNANT },
    { name: 'signpost/lock', draw: lockDrawing, ...LOCK },
  ];
  for (const key of SIGNPOST_KEYS) {
    const look = SIGNPOSTS[key].arm;
    const height = look.height * DESIGN;
    const length = height * 5;
    const text: ArmText = { lines: ['Two lines', 'of words'], size: height * 0.3, truncated: false };
    for (const [state, ticked, back] of [['open', false, true], ['ticked', true, false], ['turning', true, true]] as const) {
      pieces.push({ name: `signpost/${key}/arm-${state}`, draw: armDrawing({ look, length, height, text, lang: 'en' }, ticked, back), width: length, height });
    }
  }
  return pieces;
}

export interface SignpostOptions {
  /** Language of the arm text, from the roadmap. It picks letter shapes and where lines may break. */
  readonly lang?: string;
  readonly phone?: boolean;
  readonly seed?: number;
  /** Starts standing. By default a signpost lies on the map until it is raised. */
  readonly up?: boolean;
  /** Arms that start ticked. */
  readonly ticked?: readonly boolean[];
  readonly passed?: boolean;
  readonly locked?: boolean;
}

export interface SignpostPart extends ScenePart<Group> {
  readonly key: SignpostKey;
  readonly style: SignpostStyle;
  /** Number of arms. */
  readonly count: number;
  /** Width and height of the whole signpost with its arms, in scene units, centred on the foot. */
  readonly size: { readonly width: number; readonly height: number };
  setTicked(index: number, ticked: boolean, immediate?: boolean): void;
  isTicked(index: number): boolean;
  /** Raises the small pennant on top: the checkpoint is passed. */
  setPassed(passed: boolean, immediate?: boolean): void;
  readonly passed: boolean;
  /** Hangs a padlock on the post: the checkpoint is gated. */
  setLocked(locked: boolean, immediate?: boolean): void;
  setUp(up: boolean, immediate?: boolean): void;
  readonly up: number;
  /** Swing of an arm in radians as it is now: 0 points up the route, PI points back down the trail. */
  armSwing(index: number): number;
  /** The words printed on an arm, after fitting. */
  armText(index: number): ArmText;
  /** Where an arm is pinned and where its tip is, in world space as it is now. */
  armEnds(index: number): { pivot: Vector3; tip: Vector3 } | null;
  /** How far the pennant is up, 0 to 1. */
  readonly pennant: number;
  tap(): void;
  hit(raycaster: Raycaster): number | null;
  /** The top of the post in world space, for the lead line of a note. */
  top(target?: Vector3): Vector3;
  readonly atRest: boolean;
}

interface Arm {
  readonly sheet: Sheet;
  readonly swingGroup: Group;
  readonly hangGroup: Group;
  readonly paint: ArmPaint;
  readonly spring: Spring;
  ticked: boolean;
  /** Which side was printed last. */
  printedBack: boolean;
}

let scratch: CanvasRenderingContext2D | null = null;
function measurer(): Measure {
  scratch ??= document.createElement('canvas').getContext('2d');
  const ctx = scratch;
  if (!ctx) throw new Error('createSignpost: no 2D canvas');
  return (text, size) => {
    ctx.font = canvasFont('text', size, ARM.weight);
    return measureTextWidth(ctx, text);
  };
}

/**
 * A checkpoint signpost with one arm per thing to show. `arms` are the checkpoint's `show` items as written.
 * An unknown key builds the timber fingerpost.
 */
export function createSignpost(key: string | null | undefined, arms: readonly string[], options: SignpostOptions = {}): SignpostPart {
  const style = signpostStyle(key);
  const seed = options.seed ?? 0;
  const phone = options.phone ?? false;
  const measure = measurer();

  const stand = createStand({ sway: style.sway, phase: (seed % 89) * 0.11, up: options.up });
  const object = new Group();
  object.add(stand.hinge);

  const post = buildSheet({
    width: style.size.width,
    height: style.size.height,
    outline: style.outline,
    print: style.print,
    paper: style.paper,
    soft: style.soft,
    rim: 0.4,
    seed,
    warp: 0.012,
    deckle: style.deckle,
    resolution: resolutionFor(style.size.height, phone),
  });
  stand.hinge.add(post.object);

  const anchors = arms.length === 0 ? [] : style.arms(arms.length);
  const built: Arm[] = anchors.map((anchor, index) => {
    const h = anchor.height * DESIGN;
    const words = (arms[index] ?? '').replace(/\s+/gu, ' ').trim();
    const L = armLength(measure(words, h * ARM.textHeight * ARM_TEXT.oneLine), h, style.arm, anchor.reach * DESIGN);
    const text = layoutArmText(words, { width: L - h * ARM.textFrom - h * ARM.tip[style.arm.shape], height: h * ARM.textHeight }, measure, options.lang);
    const paint: ArmPaint = { look: style.arm, length: L, height: h, text, lang: options.lang };
    const ticked = options.ticked?.[index] ?? false;
    const sheet = buildSheet({
      width: L / DESIGN,
      height: h / DESIGN,
      ...sheetDrawings(armDrawing(paint, ticked, !ticked), L, h),
      paper: style.arm.board,
      soft: 0.0045,
      rim: 0.4,
      hinge: 0,
      warp: 0.006,
      deckle: deckleFor(L / DESIGN, h / DESIGN),
      seed: seed + index * 7 + 3,
      resolution: Math.min(phone ? 420 : 760, (phone ? 700 : 1300) / (L / DESIGN)),
    });
    const swingGroup = new Group();
    const hangGroup = new Group();
    // Arms lie a hair in front of the post, each a little further out than the one above.
    swingGroup.position.set(anchor.x, anchor.y, 0.012 + index * 0.002);
    sheet.object.position.set(L / DESIGN / 2 - (h * ARM.pin) / DESIGN, -anchor.height / 2, 0);
    hangGroup.add(sheet.object);
    swingGroup.add(hangGroup);
    stand.hinge.add(swingGroup);
    return { sheet, swingGroup, hangGroup, paint, spring: spring(ticked ? 1 : 0), ticked, printedBack: !ticked };
  });

  const small = (drawing: Drawing, size: { width: number; height: number }, paper: string, at: number) => {
    const sheet = buildSheet({
      width: size.width / DESIGN,
      height: size.height / DESIGN,
      ...sheetDrawings(drawing, size.width, size.height),
      paper,
      soft: 0.0035,
      rim: 0.3,
      hinge: 0,
      warp: 0.004,
      seed: seed + at,
      resolution: phone ? 600 : 1000,
    });
    const group = new Group();
    group.add(sheet.object);
    group.visible = false;
    stand.hinge.add(group);
    return { sheet, group };
  };
  const pennant = small(pennantDrawing, PENNANT, T.paperHi, 41);
  pennant.sheet.object.position.x = PENNANT.width / DESIGN / 2 - 0.016;
  pennant.group.position.set(style.top.x, style.top.y - 0.03, -0.006);
  const lock = small(lockDrawing, LOCK, T.ink, 43);
  lock.sheet.object.position.y = -LOCK.height / DESIGN;
  lock.group.position.set(style.top.x, style.top.y + 0.02, 0.03);

  let passed = options.passed ?? false;
  let locked = options.locked ?? false;
  const pennantSpring = spring(passed ? 1 : 0);
  const lockSpring = spring(locked ? 1 : 0);
  let atRest = false;

  const reach = built.reduce((widest, arm) => Math.max(widest, arm.paint.length / DESIGN), 0);
  const size = { width: Math.max(style.size.width, reach * 2 + 0.1), height: style.size.height + 0.2 };

  const repaint = (arm: Arm, back: boolean) => {
    arm.printedBack = back;
    arm.sheet.reprint(sheetDrawings(armDrawing(arm.paint, arm.ticked, back), arm.paint.length, arm.paint.height).print);
  };

  const pose = () => {
    for (const arm of built) {
      const swing = armSwingAt(arm.spring.x);
      // The arm passes in front of the post on its way round.
      arm.swingGroup.rotation.y = -swing;
      const share = Math.min(1, Math.max(0, swing / ARM.back));
      arm.hangGroup.rotation.z = ARM.raise + (ARM.hang - ARM.raise) * share;
      // Past a quarter turn the other side of the board faces the viewer: print that side.
      const back = swing > Math.PI / 2;
      if (back !== arm.printedBack) repaint(arm, back);
    }
    const p = pennantSpring.x;
    pennant.group.visible = p > 0.01;
    pennant.group.scale.setScalar(Math.max(0.001, Math.min(1.2, p)));
    pennant.group.rotation.z = (1 - p) * -1.3;
    const l = lockSpring.x;
    lock.group.visible = l > 0.01;
    lock.group.scale.setScalar(Math.max(0.001, Math.min(1.2, l)));
    lock.group.rotation.z = (1 - l) * 0.9;
  };
  pose();

  const sheets = () => [post, ...built.map((arm) => arm.sheet)];

  return {
    object,
    key: style.key,
    style,
    count: built.length,
    size,
    setTicked(index, ticked, immediate = false) {
      const arm = built[index];
      if (!arm || arm.ticked === ticked) return;
      arm.ticked = ticked;
      repaint(arm, arm.printedBack);
      atRest = false;
      if (immediate) {
        settleSpring(arm.spring, ticked ? 1 : 0);
        pose();
      }
    },
    isTicked(index) {
      return built[index]?.ticked ?? false;
    },
    setPassed(next, immediate = false) {
      passed = next;
      atRest = false;
      if (immediate) {
        settleSpring(pennantSpring, next ? 1 : 0);
        pose();
      }
    },
    get passed() {
      return passed;
    },
    setLocked(next, immediate = false) {
      locked = next;
      atRest = false;
      if (immediate) {
        settleSpring(lockSpring, next ? 1 : 0);
        pose();
      }
    },
    setUp(up, immediate) {
      stand.setUp(up, immediate);
    },
    get up() {
      return stand.up;
    },
    armSwing(index) {
      const arm = built[index];
      return arm ? armSwingAt(arm.spring.x) : 0;
    },
    armText(index) {
      return built[index]?.paint.text ?? { lines: [], size: 0, truncated: false };
    },
    armEnds(index) {
      const arm = built[index];
      if (!arm) return null;
      object.updateWorldMatrix(true, true);
      const reach = (arm.paint.length - arm.paint.height * ARM.pin) / DESIGN;
      return { pivot: arm.hangGroup.localToWorld(new Vector3(0, 0, 0)), tip: arm.hangGroup.localToWorld(new Vector3(reach, 0, 0)) };
    },
    get pennant() {
      return pennantSpring.x;
    },
    tap() {
      stand.tap();
    },
    hit(raycaster) {
      if (stand.up < 0.2) return null;
      let best: number | null = null;
      for (const sheet of sheets()) {
        const distance = hitSheet(raycaster, sheet);
        if (distance !== null && (best === null || distance < best)) best = distance;
      }
      return best;
    },
    top(target = new Vector3()) {
      object.updateWorldMatrix(true, true);
      return stand.hinge.localToWorld(target.set(style.top.x, style.top.y, 0));
    },
    get atRest() {
      return atRest && stand.atRest;
    },
    update(frame: FrameTime) {
      stand.update(frame);
      let moving = false;
      const step = (state: Spring, target: number, k: number, c: number) => {
        if (frame.reduced) settleSpring(state, target);
        else stepSpringKC(state, target, k, c, Math.min(frame.dt, STAND.maxStep));
        if (Math.abs(state.x - target) > 1e-4 || Math.abs(state.v) > 1e-3) moving = true;
      };
      for (const arm of built) step(arm.spring, arm.ticked ? 1 : 0, ARM.swing.k, ARM.swing.c);
      step(pennantSpring, passed ? 1 : 0, 150, 12);
      step(lockSpring, locked ? 1 : 0, 150, 12);
      atRest = !moving;
      pose();
    },
    dispose() {
      for (const sheet of [...sheets(), pennant.sheet, lock.sheet]) sheet.dispose();
    },
  };
}
