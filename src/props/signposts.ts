import { THEME } from '../look/theme';
import type { Draw2D } from '../paper/silhouette';
import type { SurfaceKind } from '../scene/palette';
import { DESIGN, sheetDrawings, type Drawing } from './brush';
import { all, arcPoints, band, blade, box, curve, disc, oval, poly, strip, sweep, type Pt } from './shapes';
import { PROPS_STRINGS } from './strings';

/**
 * The checkpoint signposts a roadmap can choose.
 *
 * A signpost is the asset of a checkpoint: it carries one arm per thing the learner can show, test or explain.
 * Every style is a post of its own kind with a mast that the arms are pinned to. An arm that is not ticked yet
 * points back down the trail. A ticked arm has swung round to point up the route.
 */
const T = THEME;
const S = THEME.surface;

export const SIGNPOST_KEYS = ['timber', 'cairn', 'trig-pillar', 'blaze-post', 'snow-pole', 'buoy', 'summit-flag'] as const;
export type SignpostKey = (typeof SIGNPOST_KEYS)[number];
export const DEFAULT_SIGNPOST: SignpostKey = 'timber';

/** The most arms a signpost carries. A checkpoint has one to five `show` items. */
export const MAX_ARMS = 5;

export type ArmShape = 'finger' | 'plate' | 'pennant';

/** How the arms of a style look. Lengths are scene units. */
export interface ArmLook {
  readonly shape: ArmShape;
  /** The board, its darker edge and the colour of the words. */
  readonly board: string;
  readonly edge: string;
  readonly ink: string;
  /** Height of an arm when there is room for it, and the longest an arm may be. */
  readonly height: number;
  readonly reach: number;
}

/** Where one arm is pinned to the mast, measured from the middle of the post's foot. */
export interface ArmAnchor {
  readonly x: number;
  readonly y: number;
  /** Height of the arm, and the longest it may be. */
  readonly height: number;
  readonly reach: number;
}

export interface SignpostStyle {
  readonly key: SignpostKey;
  /** Size of the post drawing in scene units. Arms reach out past it to both sides. */
  readonly size: { readonly width: number; readonly height: number };
  /** The post, drawn with a brush in hundredths of a scene unit. */
  readonly draw: Drawing;
  readonly outline: Draw2D;
  readonly print: Draw2D;
  /** Anchors for `n` arms, the first at the top. `n` is held to 1 to 5. No two arms overlap. */
  arms(n: number): ArmAnchor[];
  readonly arm: ArmLook;
  /** The tone under the print, the softness of the cut and the sway of the post. */
  readonly paper: string;
  readonly soft: number;
  readonly sway: number;
  /** How far the cut strays, as a share of the post's height. Small, because every post has a thin mast. */
  readonly deckle: number;
  /** Where the top of the post is, for the pennant that marks a passed checkpoint. */
  readonly top: { readonly x: number; readonly y: number };
}

interface StyleInput {
  readonly key: SignpostKey;
  readonly width: number;
  readonly height: number;
  /** x of the mast in the drawing, and the y of the highest and the lowest arm. */
  readonly mast: number;
  readonly zone: readonly [top: number, bottom: number];
  readonly arm: { readonly shape: ArmShape; readonly board: string; readonly edge: string; readonly ink?: string; readonly height: number; readonly reach: number };
  readonly paper: string;
  readonly soft?: number;
  readonly sway?: number;
  /** Width of the thinnest part of the post, in drawing units. The cut is kept finer than that. */
  readonly thin: number;
  readonly top: readonly [x: number, y: number];
  readonly draw: Drawing;
}

/** Clear paper between two arms, in drawing units. */
const ARM_GAP = 2.4;

function defineStyle(input: StyleInput): SignpostStyle {
  const { outline, print } = sheetDrawings(input.draw, input.width, input.height);
  const [zoneTop, zoneBottom] = input.zone;
  return {
    key: input.key,
    size: { width: input.width / DESIGN, height: input.height / DESIGN },
    draw: input.draw,
    outline,
    print,
    arm: {
      shape: input.arm.shape,
      board: input.arm.board,
      edge: input.arm.edge,
      ink: input.arm.ink ?? T.ink,
      height: input.arm.height / DESIGN,
      reach: input.arm.reach / DESIGN,
    },
    arms(n) {
      const count = Math.min(MAX_ARMS, Math.max(1, Math.round(Number.isFinite(n) ? n : 1)));
      const widest = input.arm.height + ARM_GAP;
      const pitch = count === 1 ? widest : Math.min(widest, (zoneTop - zoneBottom) / (count - 1));
      const height = Math.min(input.arm.height, pitch - ARM_GAP);
      const anchors: ArmAnchor[] = [];
      for (let i = 0; i < count; i += 1) {
        anchors.push({
          x: (input.mast - input.width / 2) / DESIGN,
          y: (zoneTop - i * pitch) / DESIGN,
          height: height / DESIGN,
          reach: input.arm.reach / DESIGN,
        });
      }
      return anchors;
    },
    paper: input.paper,
    soft: input.soft ?? 0.007,
    sway: input.sway ?? 0.004,
    deckle: Math.min(0.0042, Math.max(0.0008, (0.03 * input.thin) / input.height)),
    top: { x: (input.top[0] - input.width / 2) / DESIGN, y: input.top[1] / DESIGN },
  };
}

/** A few stones and a tuft at the foot, so a post stands in the ground and not on it. */
function footStones(b: Parameters<Drawing>[0], x: number, spread: number): void {
  const left = poly([[x - spread, -4], [x - spread + 1, 5], [x - spread * 0.42, 7.5], [x - 2, 3], [x - 2, -4]], 1);
  const right = poly([[x + 2, -4], [x + 2.5, 4], [x + spread * 0.55, 6.5], [x + spread, 2.5], [x + spread, -4]], 1);
  b.piece(S.rock, left);
  b.piece(S.scree, right);
  b.inside(left, () => b.tone(T.ink, 0.2, box(x - spread - 1, -6, spread * 0.42, 16)));
  b.inside(right, () => b.tone(T.paperHi, 0.26, poly([[x + spread * 0.55, 6.5], [x + spread, 2.5], [x + spread * 0.6, 1]])));
}

// ---------------------------------------------------------------------------------------------------------

const timber = defineStyle({
  key: 'timber',
  width: 30,
  height: 106,
  mast: 15,
  zone: [84, 14],
  arm: { shape: 'finger', board: S.sand, edge: S.dirt, height: 15, reach: 78 },
  paper: S.dirt,
  thin: 9,
  top: [15, 100],
  draw(b) {
    footStones(b, 15, 13);
    const post = poly([[10.2, -4], [10.8, 94], [15, 101.5], [19.2, 94], [19.8, -4]], 0.9);
    b.piece(S.dirt, post);
    b.inside(post, () => {
      b.tone(T.walnut, 0.5, box(8, -6, 5.2, 112));
      b.tone(T.paperHi, 0.18, box(17.2, -6, 3, 112));
      b.line(T.walnutDeep, 0.3, 0.45, all(strip([[14.2, 2], [14.6, 34]]), strip([[16.6, 46], [16.4, 88]]), strip([[14, 56], [14.3, 80]]), oval(15.6, 40, 1.2, 2.1)));
      b.line(T.walnutDeep, 0.4, 0.6, strip([[10, 91], [20, 91]]));
    });
    b.piece(S.grass, blade([8, -4], 4, [5, 9], 0.8));
    b.piece(S.grass, blade([22.5, -4], 4, [26, 8], -0.8));
  },
});

const CAIRN_STONES: readonly (readonly [color: 'rock' | 'scree', points: readonly Pt[]])[] = [
  ['rock', [[0.5, -4], [1.5, 7], [8, 12.5], [24, 11.5], [30.5, 6], [31, -4]]],
  ['scree', [[28, -4], [29, 9.5], [37, 12.8], [52, 11], [59, 5], [58.5, -4]]],
  ['scree', [[6, 11], [8, 19], [17, 22.6], [34, 22], [47, 18.5], [49.5, 12.4], [40, 10.4]]],
  ['rock', [[13.5, 21], [14.5, 28.5], [24, 32], [39, 30.5], [44.5, 25], [43, 21]]],
  ['scree', [[18.5, 30], [20, 37], [29, 39.6], [38.5, 36], [39, 30.6]]],
  ['rock', [[23.5, 37.6], [25, 43], [31, 44.6], [36, 41.5], [35, 38]]],
];

/** A pile of flat stones, each with a shaded side and a pale top edge. */
export function cairnStones(b: Parameters<Drawing>[0], stones: readonly (readonly [color: 'rock' | 'scree', points: readonly Pt[]])[], dx = 0, scale = 1): void {
  for (const [color, raw] of stones) {
    const points = raw.map(([x, y]): Pt => [dx + x * scale, y < 0 ? y : y * scale]);
    const stone = poly(points, 2.8 * scale);
    b.piece(S[color], stone);
    b.inside(stone, () => {
      const xs = points.map((point) => point[0]);
      const ys = points.map((point) => point[1]);
      const left = Math.min(...xs);
      const right = Math.max(...xs);
      const top = Math.max(...ys);
      const bottom = Math.max(-8, Math.min(...ys));
      const wide = right - left;
      // Shade on the left flank, cut on the slant, and a pale shoulder towards the lamp.
      b.tone(T.ink, 0.2, poly([[left - 2, bottom - 2], [left - 2, top + 2], [left + wide * 0.18, top + 2], [left + wide * 0.34, bottom - 2]]));
      b.tone(T.paperHi, 0.28, poly([[left + wide * 0.52, top + 2], [right + 2, top + 2], [right + 2, top - 5 * scale], [left + wide * 0.62, top - 2.6 * scale]]));
    });
  }
}

const cairn = defineStyle({
  key: 'cairn',
  width: 60,
  height: 126,
  mast: 30,
  zone: [112, 58],
  arm: { shape: 'finger', board: S.sand, edge: S.dirt, height: 13, reach: 70 },
  paper: S.rock,
  thin: 3,
  soft: 0.005,
  top: [30.5, 122],
  draw(b) {
    // The stick goes in first: the stones were piled round it.
    const stick = band(arcPoints([28.5, 30], [31.5, 80], [30.5, 124], 10), 3.8, 2.6);
    b.piece(T.walnut, stick);
    b.inside(stick, () => b.tone(T.walnutDeep, 0.45, band(arcPoints([27.4, 30], [30.4, 80], [29.6, 124], 10), 1.6, 1.1)));
    b.piece(T.walnut, band([[30.6, 96], [35.5, 102]], 1.9, 1.3));
    cairnStones(b, CAIRN_STONES);
  },
});

const trigPillar = defineStyle({
  key: 'trig-pillar',
  width: 46,
  height: 124,
  mast: 23,
  zone: [108, 58],
  arm: { shape: 'plate', board: T.paperHi, edge: T.steel, height: 12.5, reach: 70 },
  paper: T.paperShade,
  thin: 2.8,
  soft: 0.005,
  top: [23, 120],
  draw(b) {
    const rod = band([[23, 40], [23, 118]], 2.8);
    b.piece(T.steel, rod);
    b.inside(rod, () => b.tone(T.ink, 0.22, box(21.6, 38, 1.1, 84)));
    b.piece(T.brass, disc(23, 120, 3.2));
    b.tone(T.paperHi, 0.4, disc(24, 121, 1.1));
    const pillar = poly([[5, -4], [10.5, 43], [35.5, 43], [41, -4]], 1.2);
    b.piece(T.paperShade, pillar);
    b.inside(pillar, () => {
      b.tone(T.ink, 0.15, poly([[2, -6], [10.5, 43], [17.5, 43], [14, -6]]));
      b.tone(T.paperHi, 0.34, poly([[30.5, 43], [35.5, 43], [41, -6], [35, -6]]));
      // The cast marks of the shuttering.
      b.line(T.inkSoft, 0.3, 0.45, all(strip([[7.5, 14], [38.5, 14]]), strip([[9.4, 30], [36.6, 30]])));
      // The flush bracket, and the surveyor's arrow under it.
      b.tone(T.brass, 1, box(18.6, 18.5, 8.8, 9, 0.8));
      b.tone(T.brassDeep, 1, all(disc(20.4, 25.6, 0.6), disc(25.6, 25.6, 0.6), disc(20.4, 20.4, 0.6), disc(25.6, 20.4, 0.6)));
      b.line(T.inkSoft, 0.7, 0.7, all(strip([[23, 3.4], [23, 11]]), strip([[19.6, 7], [23, 11], [26.4, 7]]), strip([[19, 11.6], [27, 11.6]])));
    });
    const cap = box(8.6, 42, 28.8, 4, 1);
    b.piece(T.steel, cap);
    b.inside(cap, () => b.tone(T.ink, 0.2, box(8, 42, 30, 1.5)));
  },
});

const blazePost = defineStyle({
  key: 'blaze-post',
  width: 32,
  height: 118,
  mast: 16,
  zone: [82, 18],
  arm: { shape: 'finger', board: T.card, edge: S.scree, height: 14, reach: 76 },
  paper: S.scree,
  thin: 9,
  top: [16, 113],
  draw(b) {
    const post = poly([[10, -4], [10, 109], [12.5, 114], [22, 111.5], [22, -4]], 0.9);
    b.piece(S.scree, post);
    b.inside(post, () => {
      b.tone(T.ink, 0.2, box(8, -6, 5.4, 124));
      b.tone(T.paperHi, 0.2, box(19.4, -6, 3.4, 124));
      b.line(T.ink, 0.22, 0.45, all(strip([[15, 4], [15.4, 40]]), strip([[18, 30], [17.6, 80]]), strip([[14.4, 52], [14.8, 86]])));
      // The waymark: white, the route colour, white. It is paint, so it follows the grain of the post.
      b.tone(T.paperHi, 1, box(10, 90.5, 12, 15.5));
      b.tone(T.signal, 1, box(10, 95.6, 12, 5.2));
      b.tone(T.ink, 0.12, box(8, 90.5, 5.4, 15.5));
    });
    b.piece(S.grass, blade([8.5, -4], 4.4, [4, 11], 1));
    b.piece(S.forest, blade([10.5, -4], 4, [8.5, 14], 0.3));
    b.piece(S.grass, blade([23, -4], 4.4, [28.5, 10], -1));
    b.piece(S.forest, blade([21.5, -4], 4, [24, 13], -0.3));
  },
});

const snowPole = defineStyle({
  key: 'snow-pole',
  width: 48,
  height: 136,
  mast: 24,
  zone: [110, 36],
  arm: { shape: 'plate', board: T.paperHi, edge: T.inkSoft, height: 13.5, reach: 72 },
  paper: T.paperHi,
  thin: 5,
  soft: 0.006,
  top: [24, 132],
  draw(b) {
    const pole = box(21.4, -4, 5.2, 137, 2.4);
    b.piece(T.paperHi, pole);
    b.inside(pole, () => {
      for (let y = 6; y < 110; y += 34) b.tone(T.ink, 1, box(20, y, 8, 17));
      // The top band is in the route colour, so the pole shows the way when all else is white.
      b.tone(T.signal, 1, box(20, 118, 8, 20));
      b.tone(T.ink, 0.22, box(20, -6, 2.2, 144));
      b.tone(T.paperHi, 0.3, box(25, -6, 1, 144));
    });
    const mound = curve([[-6, -6], [-2, 6], [10, 12.5], [25, 14], [38, 11], [50, 5], [54, -6]]);
    b.piece(S.snow, mound);
    b.inside(mound, () => {
      b.tone(S.water, 0.3, curve([[-8, -8], [-4, 6], [8, 12], [15, 4], [18, -8]]));
      b.line(S.water, 0.5, 0.5, sweep([[26, 5], [34, 4], [43, 1]]));
    });
  },
});

const buoy = defineStyle({
  key: 'buoy',
  width: 62,
  height: 134,
  mast: 31,
  zone: [98, 48],
  arm: { shape: 'pennant', board: T.paperHi, edge: T.brass, height: 13, reach: 68 },
  paper: T.brass,
  thin: 2,
  soft: 0.0045,
  sway: 0.008,
  top: [31, 131],
  draw(b) {
    // Mast first: two legs that meet under the lamp, with cross braces.
    const legs = all(band([[23, 36], [29.4, 104]], 2.4, 2), band([[39, 36], [32.6, 104]], 2.4, 2));
    b.piece(T.steel, legs);
    b.piece(T.steel, all(band([[24.4, 50], [36.4, 64]], 1.5), band([[37.6, 50], [25.6, 64]], 1.5), band([[26.6, 72], [34.6, 84]], 1.4), band([[35.4, 72], [27.4, 84]], 1.4)));
    b.piece(T.steel, box(26, 103, 10, 3, 1));
    b.piece(T.lamp, disc(31, 110.5, 5));
    b.tone(T.paperHi, 0.6, disc(32.4, 112, 1.8));
    b.line(T.steel, 1, 0.8, all(strip([[31, 105.5], [31, 115.5]]), strip([[26.2, 110.5], [35.8, 110.5]])));
    // The topmark: two cones, points up.
    b.piece(T.ink, all(poly([[31, 133], [26, 125], [36, 125]], 0.5), poly([[31, 124], [26, 116.5], [36, 116.5]], 0.5)));
    const float = poly([[13.5, 2], [10, 22], [15.5, 38], [46.5, 38], [52, 22], [48.5, 2]], 3);
    b.piece(T.brass, float);
    b.inside(float, () => {
      b.tone(T.ink, 1, box(6, 17, 50, 8));
      b.tone(T.brassDeep, 0.6, poly([[8, 0], [10, 22], [15.5, 40], [22, 40], [18, 22], [19, 0]]));
      b.tone(T.paperHi, 0.34, poly([[41, 40], [46.5, 40], [52, 22], [48.5, 0], [44, 0], [46.5, 22]]));
      b.line(T.brassDeep, 0.8, 0.6, all(strip([[12, 30.5], [50, 30.5]]), strip([[11, 11], [51, 11]])));
    });
    const sea = (ctx: CanvasRenderingContext2D) => {
      ctx.moveTo(-6, -6);
      ctx.lineTo(-6, 4);
      for (let i = 0; i < 6; i += 1) {
        const x = -6 + i * 12.4;
        ctx.quadraticCurveTo(x + 3.1, 9, x + 6.2, 5);
        ctx.quadraticCurveTo(x + 9.3, 1.4, x + 12.4, 4);
      }
      ctx.lineTo(68.4, -6);
      ctx.closePath();
    };
    b.piece(S.water, sea);
    b.inside(sea, () => {
      b.tone(T.ink, 0.12, box(-8, -8, 80, 7));
      b.line(T.paperHi, 0.7, 0.6, all(sweep([[4, 1], [8, 3], [12, 1]]), sweep([[40, 0.5], [44, 2.5], [48, 0.5]]), sweep([[22, -1.5], [26, 0.5], [30, -1.5]])));
    });
  },
});

const SUMMIT_STONES: readonly (readonly ['rock' | 'scree', readonly Pt[]])[] = [
  ['rock', [[3, -4], [3.5, 8], [11, 13], [24, 12], [27, -4]]],
  ['scree', [[24, -4], [25, 11], [40, 12.5], [49, 6], [48.5, -4]]],
  ['scree', [[12, 11.5], [14, 20], [27, 23], [37, 19], [36, 11.5]]],
];

const summitFlag = defineStyle({
  key: 'summit-flag',
  width: 66,
  height: 142,
  mast: 26,
  zone: [100, 42],
  arm: { shape: 'pennant', board: T.card, edge: S.dirt, height: 14, reach: 70 },
  paper: T.walnut,
  thin: 3.2,
  soft: 0.005,
  sway: 0.007,
  top: [26, 139],
  draw(b) {
    const pole = band([[26, -4], [26, 137]], 3.4, 3);
    b.piece(T.walnut, pole);
    b.inside(pole, () => b.tone(T.walnutDeep, 0.5, box(24, -6, 1.5, 146)));
    b.piece(T.brass, disc(26, 138.6, 2.6));
    // The pennant streams to the right, with one fold in it.
    const flag = (ctx: CanvasRenderingContext2D) => {
      ctx.moveTo(27.4, 134.5);
      ctx.bezierCurveTo(38, 137, 46, 128, 64, 126.5);
      ctx.bezierCurveTo(50, 123, 40, 117, 27.4, 114.5);
      ctx.closePath();
    };
    b.piece(T.brass, flag);
    b.inside(flag, () => {
      b.tone(T.paperHi, 0.85, (ctx) => {
        ctx.moveTo(27, 127.6);
        ctx.bezierCurveTo(38, 129.6, 46, 126.6, 64, 126.9);
        ctx.lineTo(64, 125);
        ctx.bezierCurveTo(48, 123.4, 38, 123, 27, 121.6);
        ctx.closePath();
      });
      b.tone(T.brassDeep, 0.5, poly([[40, 140], [45, 140], [41, 112], [37, 112]]));
    });
    cairnStones(b, SUMMIT_STONES);
    // Snow has settled on the stones.
    const snow = curve([[10, 20.5], [14, 25], [26, 26.5], [37, 23], [38, 19.5], [26, 21.5]]);
    b.piece(S.snow, snow);
    b.inside(snow, () => b.tone(S.water, 0.28, curve([[10, 20], [14, 22.5], [22, 23], [20, 19]])));
  },
});

/** Every signpost style by its key. */
export const SIGNPOSTS: Readonly<Record<SignpostKey, SignpostStyle>> = Object.freeze({
  timber,
  cairn,
  'trig-pillar': trigPillar,
  'blaze-post': blazePost,
  'snow-pole': snowPole,
  buoy,
  'summit-flag': summitFlag,
});

export function isSignpostKey(value: unknown): value is SignpostKey {
  return typeof value === 'string' && (SIGNPOST_KEYS as readonly string[]).includes(value);
}

/** The style for a key from a roadmap. Anything unknown is the timber fingerpost. */
export function signpostStyle(key: string | null | undefined): SignpostStyle {
  return SIGNPOSTS[isSignpostKey(key) ? key : DEFAULT_SIGNPOST];
}

/** The signpost each map theme brings when the roadmap names none. */
export const THEME_SIGNPOSTS: Readonly<Record<string, SignpostKey>> = Object.freeze({
  'classic-topo': 'timber',
  'alpine-winter': 'snow-pole',
  'desert-expedition': 'cairn',
  'coastal-survey': 'buoy',
});

/**
 * Which signpost a checkpoint gets. The checkpoint's own choice wins, then the map's, then the theme's, then
 * timber. A key that is not a signpost is skipped, so a typing slip in a roadmap never breaks the scene.
 */
export function resolveSignpost(checkpoint?: string | null, map?: string | null, theme?: string | null): SignpostKey {
  if (isSignpostKey(checkpoint)) return checkpoint;
  if (isSignpostKey(map)) return map;
  const themed = theme ? THEME_SIGNPOSTS[theme] : undefined;
  return themed ?? DEFAULT_SIGNPOST;
}

export interface SignpostCatalogueEntry {
  readonly key: SignpostKey;
  /** True for the style a roadmap gets when it names none. */
  readonly default: boolean;
  readonly name: { readonly en: string; readonly de: string };
  /** One or two plain sentences: what it looks like and which roadmaps it suits. */
  readonly description: { readonly en: string; readonly de: string };
  /** The ground it looks most at home on. A hint, not a rule. */
  readonly surfaces: readonly SurfaceKind[];
}

const CATALOGUE_KEYS: Readonly<Record<SignpostKey, readonly [name: keyof typeof PROPS_STRINGS.en, text: keyof typeof PROPS_STRINGS.en, surfaces: readonly SurfaceKind[]]>> = {
  timber: ['signTimberName', 'signTimber', ['grass', 'forest', 'dirt']],
  cairn: ['signCairnName', 'signCairn', ['rock', 'scree', 'sand']],
  'trig-pillar': ['signTrigPillarName', 'signTrigPillar', ['grass', 'rock']],
  'blaze-post': ['signBlazePostName', 'signBlazePost', ['forest', 'grass']],
  'snow-pole': ['signSnowPoleName', 'signSnowPole', ['snow', 'scree']],
  buoy: ['signBuoyName', 'signBuoy', ['water', 'sand']],
  'summit-flag': ['signSummitFlagName', 'signSummitFlag', ['snow', 'rock']],
};

/**
 * The signposts in plain words, in both interface languages. The agent skill reads this list when it offers a
 * learner the choice, and writes the chosen key into `map.signpost` or `checkpoint.signpost`.
 */
export const SIGNPOST_CATALOGUE: readonly SignpostCatalogueEntry[] = Object.freeze(
  SIGNPOST_KEYS.map((key) => {
    const [name, text, surfaces] = CATALOGUE_KEYS[key];
    return Object.freeze({
      key,
      default: key === DEFAULT_SIGNPOST,
      name: { en: PROPS_STRINGS.en[name] as string, de: PROPS_STRINGS.de[name] as string },
      description: { en: PROPS_STRINGS.en[text] as string, de: PROPS_STRINGS.de[text] as string },
      surfaces,
    });
  }),
);
