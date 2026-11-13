import { THEME } from '../../look/theme';
import { defineProp, type PropArt } from '../art';
import { all, arcPoints, band, blade, box, curve, disc, poly, scaled, strip, sweep, type Pt } from '../shapes';

/** The open country: sand and water. */
const T = THEME;
const S = THEME.surface;

// ---------------------------------------------------------------------------------------------------------
// Sand

const dune = defineProp({
  surface: 'sand',
  name: 'dune',
  width: 160,
  height: 44,
  paper: S.sand,
  layer: 'mid',
  sway: 0.002,
  soft: 0.011,
  weight: 1.6,
  draw(b) {
    const body = (ctx: CanvasRenderingContext2D) => {
      ctx.moveTo(1, -4);
      // The lee side on the left is steep, the windward side runs out long to the right.
      ctx.bezierCurveTo(16, 2, 36, 24, 58, 42);
      ctx.bezierCurveTo(84, 36, 118, 12, 158, -4);
      ctx.closePath();
    };
    b.piece(S.sand, body);
    b.inside(body, () => {
      // The slip face, in shade, with the crest as its sharp upper edge.
      b.tone(S.dirt, 0.42, (ctx) => {
        ctx.moveTo(-6, -6);
        ctx.lineTo(1, -4);
        ctx.bezierCurveTo(16, 2, 36, 24, 58, 42);
        ctx.bezierCurveTo(56, 26, 66, 10, 82, -6);
        ctx.closePath();
      });
      b.line(S.dirt, 0.42, 0.6, all(sweep([[76, 26], [100, 17], [128, 12]]), sweep([[82, 16], [110, 8], [146, 5]]), sweep([[94, 6], [120, 1], [150, -1]])));
      b.tone(T.paperHi, 0.24, (ctx) => {
        ctx.moveTo(58, 42);
        ctx.bezierCurveTo(84, 36, 118, 12, 158, -4);
        ctx.lineTo(150, -4);
        ctx.bezierCurveTo(116, 9, 86, 31, 59, 37);
        ctx.closePath();
      });
    });
  },
});

const mesa = defineProp({
  surface: 'sand',
  name: 'mesa',
  width: 128,
  height: 72,
  paper: S.dirt,
  layer: 'back',
  sway: 0.002,
  soft: 0.011,
  weight: 0.7,
  draw(b) {
    const body = poly([[-6, -4], [8, 9], [19, 15], [25, 43], [30, 62], [40, 67], [86, 68], [96, 61], [100, 41], [108, 18], [121, 10], [134, -4]], 1.6);
    b.piece(S.dirt, body);
    b.inside(body, () => {
      // Hard pale cap rock, two darker beds, and the scree skirt at the foot.
      b.tone(S.sand, 0.8, box(-10, 55, 150, 20));
      b.tone(T.walnut, 0.3, box(-10, 37, 150, 5));
      b.tone(T.walnut, 0.22, box(-10, 24, 150, 3));
      b.tone(S.sand, 0.4, poly([[-10, -6], [8, 9], [19, 15], [40, 10], [84, 12], [108, 18], [121, 10], [140, -6]]));
      b.tone(T.ink, 0.17, poly([[-10, -6], [8, 9], [19, 15], [25, 43], [30, 62], [40, 67], [47, 62], [43, 40], [38, -6]]));
      b.line(T.walnutDeep, 0.26, 0.55, all(strip([[58, 66], [57, 18]]), strip([[72, 67], [73, 30]]), strip([[87, 64], [86, 24]]), strip([[47, 62], [43, 40], [38, -6]])));
    });
  },
});

const cactus = defineProp({
  surface: 'sand',
  name: 'cactus',
  width: 38,
  height: 62,
  paper: S.forest,
  sway: 0.003,
  rim: 0.3,
  weight: 1.4,
  mirror: true,
  draw(b) {
    const trunk = box(14.5, -8, 9.5, 66, 4.7);
    const leftArm = all(box(3, 22, 14, 7, 3.4), box(3, 22, 7, 20, 3.4));
    const rightArm = all(box(21, 32, 14, 7, 3.4), box(28, 32, 7, 18, 3.4));
    b.piece(S.forest, leftArm);
    b.piece(S.forest, rightArm);
    b.piece(S.forest, trunk);
    b.tone(T.ink, 0.17, all(box(14.5, -8, 3.4, 66, 1.6), box(3, 24, 2.6, 18, 1.2), box(28, 34, 2.6, 16, 1.2)));
    b.tone(S.grass, 0.5, all(box(20.4, -6, 2.2, 60, 1), box(7.4, 28, 1.6, 12, 0.8), box(32.4, 36, 1.6, 12, 0.8)));
    b.line(T.paperHi, 0.34, 0.4, all(strip([[19.2, 2], [19.2, 52]]), strip([[6.5, 29], [6.5, 38]]), strip([[31.5, 39], [31.5, 46]])));
    // It flowers once a year, and this is the day.
    b.piece(T.paperHi, disc(19.2, 58.6, 2.8));
    b.tone(T.brass, 1, disc(19.2, 58.6, 1.1));
  },
});

// ---------------------------------------------------------------------------------------------------------
// Water

const TARN: readonly Pt[] = [[8, 30], [6, 58], [30, 74], [62, 76], [98, 72], [116, 50], [113, 22], [92, 4], [58, 0], [26, 6]];

const tarn = defineProp({
  surface: 'water',
  name: 'tarn',
  width: 120,
  height: 76,
  paper: T.paperHi,
  pose: 'tip',
  layer: 'mid',
  sway: 0,
  soft: 0.01,
  rim: 0.3,
  weight: 1.6,
  draw(b) {
    // A lake is glued on: the white backing shows as a shore all round the water.
    const shore = curve(TARN);
    b.piece(T.paperHi, shore);
    const water = scaled(shore, 61, 38, 0.86);
    b.tone(S.water, 1, water);
    b.inside(water, () => {
      b.tone(T.ink, 0.1, scaled(shore, 56, 34, 0.5));
      b.line(T.paperHi, 0.75, 0.9, all(sweep([[30, 50], [36, 53], [42, 50], [48, 53], [54, 50]]), sweep([[66, 26], [72, 29], [78, 26], [84, 29], [90, 26]]), sweep([[74, 54], [79, 56.5], [84, 54]])));
    });
    b.tone(S.rock, 1, poly([[24, 24], [27, 30], [34, 31], [37, 26], [32, 22]], 1));
    b.tone(T.paperHi, 0.3, poly([[27, 30], [34, 31], [37, 26], [31, 27]]));
  },
});

const reeds = defineProp({
  surface: 'water',
  name: 'reeds',
  width: 34,
  height: 58,
  paper: S.forest,
  sway: 0.013,
  soft: 0.0035,
  rim: 0.3,
  weight: 2,
  mirror: true,
  draw(b) {
    const stalks: readonly (readonly [Pt, Pt, Pt, number])[] = [
      [[11, -4], [9, 20], [8.5, 46], 30],
      [[16.5, -4], [16.5, 24], [17.5, 57], 39],
      [[21.5, -4], [24, 18], [26, 41], 25],
    ];
    b.piece(S.forest, blade([13, -4], 4.4, [2, 33], 1.8));
    b.piece(S.grass, blade([19.5, -4], 4.4, [32, 29], -2));
    b.piece(S.forest, blade([15.5, -4], 4, [13, 26], 0.6));
    for (const [from, pull, to] of stalks) b.piece(S.forest, band(arcPoints(from, pull, to, 8), 2, 1.5));
    for (const [from, pull, to, headY] of stalks) {
      // The seed head sits on the stalk at `headY`. Find the stalk there to seat it.
      const t = (headY + 4) / (to[1] + 4);
      const x = (1 - t) * (1 - t) * from[0] + 2 * (1 - t) * t * pull[0] + t * t * to[0];
      const head = box(x - 2.5, headY, 5, 13, 2.5);
      b.piece(T.walnut, head);
      b.tone(T.walnutDeep, 0.45, box(x - 2.5, headY, 1.9, 13, 0.9));
    }
  },
});

const bridge = defineProp({
  surface: 'water',
  name: 'bridge',
  width: 92,
  height: 36,
  paper: S.dirt,
  sway: 0.003,
  soft: 0.005,
  weight: 0.8,
  draw(b) {
    const deckLine = arcPoints([5, 6], [46, 31], [87, 6], 16);
    const railLine = arcPoints([6.5, 17.5], [46, 43], [85.5, 17.5], 16);
    // Posts first, so deck and rail are nailed over them.
    for (const index of [1, 4, 8, 12, 15]) {
      const foot = deckLine[index] as Pt;
      const top = railLine[index] as Pt;
      b.piece(T.walnut, band([[foot[0], foot[1] - 1], [top[0], top[1] + 1.5]], 2.6));
    }
    const stringer = band(arcPoints([5, 2.5], [46, 27], [87, 2.5], 16), 2.6);
    b.piece(T.walnut, stringer);
    const deck = band(deckLine, 5);
    b.piece(S.dirt, deck);
    b.inside(deck, () => {
      for (let i = 1; i < 16; i += 1) {
        const at = deckLine[i] as Pt;
        b.line(T.walnutDeep, 0.34, 0.45, strip([[at[0] - 0.4, at[1] - 3], [at[0] + 0.4, at[1] + 3]]));
      }
    });
    b.piece(S.dirt, band(railLine, 2.6));
    // Stone abutments carry both ends.
    for (const side of [0, 1] as const) {
      const x = (v: number) => (side === 0 ? v : 92 - v);
      const stone = poly([[x(0.5), -4], [x(1.5), 9], [x(13), 10], [x(16), -4]], 1.2);
      b.piece(S.rock, stone);
      b.inside(stone, () => {
        b.tone(side === 0 ? T.ink : T.paperHi, side === 0 ? 0.18 : 0.2, poly([[x(-2), -6], [x(-2), 12], [x(6), 12], [x(7), -6]]));
        b.line(T.ink, 0.28, 0.45, all(strip([[x(0), 3.5], [x(15), 3.5]]), strip([[x(7), 3.5], [x(7), 10]]), strip([[x(3.6), -4], [x(3.6), 3.5]]), strip([[x(11), -4], [x(11), 3.5]])));
      });
    }
  },
});

export const WIDE_PROPS: readonly PropArt[] = [dune, mesa, cactus, tarn, reeds, bridge];
