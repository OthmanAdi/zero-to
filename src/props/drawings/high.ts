import { THEME } from '../../look/theme';
import { defineProp, type PropArt } from '../art';
import { all, blade, poly, strip, sweep, type Pt } from '../shapes';

/** The high country: rock, scree and snow. Faces are cut flat, the lit side is to the right. */
const T = THEME;
const S = THEME.surface;

// ---------------------------------------------------------------------------------------------------------
// Rock

const boulder = defineProp({
  surface: 'rock',
  name: 'boulder',
  width: 56,
  height: 40,
  paper: S.rock,
  sway: 0.002,
  weight: 2.6,
  mirror: false,
  draw(b) {
    const body = poly([[1, -4], [0.5, 9], [6, 24], [17, 35], [33, 39], [46, 32], [54, 16], [55, -4]], 1.6);
    b.piece(S.rock, body);
    b.inside(body, () => {
      b.tone(T.ink, 0.22, poly([[-2, -6], [-2, 12], [6, 24], [17, 35], [22, 21], [17, 6], [20, -6]]));
      b.tone(T.paperHi, 0.26, poly([[17, 35], [33, 39], [46, 32], [39, 24], [22, 21]]));
      b.line(T.ink, 0.3, 0.5, all(strip([[22, 21], [39, 24], [44, 9], [42, -4]]), strip([[22, 21], [17, 6]]), strip([[39, 24], [46, 32]])));
    });
    // Lichen on the lit shoulder.
    b.tone(S.grass, 0.55, all(poly([[40, 18], [44, 20], [45, 16], [41, 14]], 1), poly([[46, 10], [49, 11], [49, 7.5]], 0.8)));
  },
});

const CRAG: readonly Pt[] = [
  [1, -4], [5, 24], [12, 44], [24, 40], [38, 68], [50, 61], [64, 94], [76, 86], [92, 121], [103, 106], [113, 112], [127, 79], [139, 85], [155, 57], [168, 63], [185, 39], [203, 45], [213, 27], [219, -4],
];

const crag = defineProp({
  surface: 'rock',
  name: 'crag',
  width: 220,
  height: 124,
  paper: S.rock,
  layer: 'back',
  sway: 0.003,
  soft: 0.013,
  weight: 0.55,
  draw(b) {
    const body = poly(CRAG, 1.2);
    b.piece(S.rock, body);
    b.inside(body, () => {
      // Each summit throws its left flank into shade and shows a pale face to the lamp.
      b.tone(T.ink, 0.26, poly([[92, 121], [76, 86], [64, 94], [50, 61], [38, 68], [24, 40], [12, 44], [-6, 28], [-6, -6], [60, -6], [70, 40], [84, 72]]));
      b.tone(T.ink, 0.12, poly([[127, 79], [113, 112], [103, 106], [108, 70], [118, 40], [130, 44]]));
      b.tone(T.paperHi, 0.26, poly([[92, 121], [103, 106], [108, 70], [98, 44], [84, 72]]));
      // Scree has gathered along the foot.
      b.tone(S.scree, 0.8, poly([[-6, -6], [-6, 6], [30, 12], [62, 8], [96, 15], [130, 9], [170, 13], [226, 5], [226, -6]], 3));
      b.tone(T.paperHi, 0.16, poly([[155, 57], [168, 63], [185, 39], [176, 20], [160, 28]]));
      b.tone(T.paperHi, 0.14, poly([[38, 68], [50, 61], [54, 40], [44, 30]]));
      b.line(T.ink, 0.22, 0.7, all(
        strip([[92, 121], [84, 72], [70, 40], [60, -6]]),
        strip([[103, 106], [108, 70], [118, 40], [122, -6]]),
        strip([[155, 57], [160, 28], [154, -6]]),
        strip([[38, 68], [44, 30], [40, -6]]),
        strip([[185, 39], [176, 20], [180, -6]]),
      ));
      // Bedding: the strata dip to the left.
      b.line(T.ink, 0.13, 0.6, all(strip([[112, 62], [150, 50]]), strip([[116, 46], [164, 30]]), strip([[124, 28], [190, 12]]), strip([[12, 22], [42, 14]]), strip([[0, 12], [30, 4]])));
    });
  },
});

const pinnacle = defineProp({
  surface: 'rock',
  name: 'pinnacle',
  width: 40,
  height: 82,
  paper: S.rock,
  layer: 'mid',
  sway: 0.002,
  weight: 1.2,
  draw(b) {
    const body = poly([[3, -4], [5, 16], [10, 38], [14, 60], [19.5, 81], [25, 67], [27.5, 49], [34, 31], [32.5, 15], [38, -4]], 1.1);
    b.piece(S.rock, body);
    b.inside(body, () => {
      b.tone(T.ink, 0.2, poly([[0, -6], [5, 16], [10, 38], [14, 60], [19.5, 81], [19, 52], [22, 30], [19, -6]]));
      b.tone(T.paperHi, 0.22, poly([[19.5, 81], [25, 67], [27.5, 49], [22, 30], [19, 52]]));
      b.line(T.ink, 0.26, 0.5, all(strip([[19.5, 81], [19, 52], [22, 30], [19, -6]]), strip([[27.5, 49], [22, 30]]), strip([[22, 30], [34, 31]]), strip([[10, 38], [19, 44]])));
    });
  },
});

// ---------------------------------------------------------------------------------------------------------
// Scree

const RUBBLE: readonly (readonly [color: 'scree' | 'rock', points: readonly Pt[], lit: readonly Pt[]])[] = [
  ['rock', [[13, -4], [15, 10], [25, 17.5], [36, 12], [38, -4]], [[25, 17.5], [36, 12], [31, 6], [24, 9]]],
  ['scree', [[-1, -4], [1.5, 7], [9.5, 11.5], [17, 6], [18, -4]], [[9.5, 11.5], [17, 6], [12, 3.5]]],
  ['scree', [[33, -4], [34.5, 8], [44, 13.5], [52.5, 7], [53.5, -4]], [[44, 13.5], [52.5, 7], [46, 4.5], [41, 7]]],
  ['rock', [[50, -4], [51, 5], [58, 8.5], [65, 3.5], [65, -4]], [[58, 8.5], [65, 3.5], [59, 2]]],
  ['scree', [[25.5, 13], [29, 20.5], [38, 22], [42.5, 16], [39, 11]], [[38, 22], [42.5, 16], [36, 15.5]]],
];

const rubble = defineProp({
  surface: 'scree',
  name: 'rubble',
  width: 66,
  height: 24,
  paper: S.scree,
  sway: 0.002,
  soft: 0.006,
  weight: 3,
  mirror: true,
  draw(b) {
    for (const [color, points, lit] of RUBBLE) {
      const stone = poly(points, 0.9);
      b.piece(S[color], stone);
      b.inside(stone, () => {
        b.tone(T.paperHi, 0.3, poly(lit));
        const left = points[0] as Pt;
        b.tone(T.ink, 0.16, poly([[left[0] - 2, -6], [left[0] - 2, 30], [left[0] + 4.5, 30], [left[0] + 6, -6]]));
      });
    }
  },
});

const FAN_STONES: readonly (readonly [number, number, number])[] = [
  [34, 8, 2.6], [52, 20, 2.2], [66, 12, 3], [70, 34, 2], [84, 22, 2.8], [92, 38, 2.1], [102, 14, 3.2], [116, 20, 2.3], [124, 6, 2.8], [140, 5, 2.2], [48, 5, 2.4], [86, 6, 2.5],
];

const fan = defineProp({
  surface: 'scree',
  name: 'fan',
  width: 160,
  height: 58,
  paper: S.scree,
  layer: 'mid',
  sway: 0.002,
  soft: 0.011,
  weight: 0.8,
  draw(b) {
    const body = poly([[-6, -4], [28, 13], [56, 37], [73, 55], [87, 51], [104, 31], [131, 13], [166, -4]], 2.2);
    b.piece(S.scree, body);
    b.inside(body, () => {
      b.tone(T.ink, 0.14, poly([[-6, -6], [28, 13], [56, 37], [73, 55], [70, 24], [58, -6]]));
      // The debris ran out from the notch at the top in streaks.
      b.line(T.ink, 0.15, 0.6, all(
        sweep([[76, 52], [62, 30], [36, -4]]),
        sweep([[78, 52], [74, 28], [70, -4]]),
        sweep([[81, 51], [92, 28], [104, -4]]),
        sweep([[84, 50], [112, 24], [142, -4]]),
      ));
      for (const [x, y, r] of FAN_STONES) {
        b.tone(S.rock, 1, poly([[x - r, y - r * 0.6], [x - r * 0.5, y + r * 0.7], [x + r * 0.8, y + r * 0.6], [x + r * 1.1, y - r * 0.6]], r * 0.3));
        b.tone(T.ink, 0.2, poly([[x - r, y - r * 0.6], [x - r * 0.5, y + r * 0.7], [x - r * 0.1, y - r * 0.6]]));
      }
    });
  },
});

// ---------------------------------------------------------------------------------------------------------
// Snow

const PEAK: readonly Pt[] = [[-6, -4], [18, 20], [46, 58], [69, 93], [85, 121], [99, 149], [111, 129], [124, 113], [141, 84], [161, 50], [187, 22], [216, -4]];
const SNOW_CAP: readonly Pt[] = [
  [99, 152], [84, 122], [68, 94], [60, 82], [69, 80], [75, 90], [84, 77], [91, 96], [100, 73], [108, 98], [117, 83], [124, 100], [133, 89], [143, 83], [125, 114], [112, 131],
];

const peak = defineProp({
  surface: 'snow',
  name: 'peak',
  width: 210,
  height: 152,
  paper: S.rock,
  layer: 'back',
  sway: 0.003,
  soft: 0.013,
  weight: 0.55,
  draw(b) {
    const body = poly(PEAK, 1.4);
    b.piece(S.rock, body);
    b.inside(body, () => {
      b.tone(T.ink, 0.2, poly([[99, 149], [85, 121], [69, 93], [46, 58], [18, 20], [-6, -6], [84, -6], [90, 60]]));
      b.tone(T.paperHi, 0.12, poly([[99, 149], [111, 129], [124, 113], [118, 60], [104, 20], [90, 60]]));
      // Two gullies hold snow far below the cap.
      b.tone(S.snow, 1, poly([[78, 76], [74, 50], [70, 30], [76, 52]], 0.6));
      b.tone(S.snow, 1, poly([[128, 86], [136, 60], [146, 40], [140, 64]], 0.6));
      b.tone(S.snow, 1, poly([[104, 70], [106, 44], [103, 26], [100, 46]], 0.6));
      const cap = poly(SNOW_CAP, 0.9);
      b.tone(S.snow, 1, cap);
      b.inside(cap, () => b.tone(S.water, 0.3, poly([[99, 152], [84, 122], [68, 94], [56, 80], [88, 70], [94, 110]])));
      b.line(T.ink, 0.2, 0.7, all(strip([[99, 149], [94, 110], [90, 60], [84, -6]]), strip([[124, 113], [118, 60], [124, -6]]), strip([[46, 58], [52, 24], [46, -6]]), strip([[161, 50], [156, 18], [162, -6]])));
    });
  },
});

const drift = defineProp({
  surface: 'snow',
  name: 'drift',
  width: 80,
  height: 26,
  paper: S.snow,
  sway: 0.002,
  soft: 0.005,
  rim: 0.6,
  weight: 2.4,
  mirror: true,
  draw(b) {
    // Last year's grass still stands through the snow.
    b.piece(S.dirt, blade([55, 6], 2.6, [50.5, 23.5], 0.9));
    b.piece(S.dirt, blade([57.5, 6], 2.6, [58.5, 25], -0.2));
    b.piece(S.sand, blade([60, 5], 2.6, [66, 21.5], -1));
    const body = (ctx: CanvasRenderingContext2D) => {
      ctx.moveTo(-4, -4);
      ctx.lineTo(-4, 0.5);
      // The wind packed it steep on the left and let it run out to the right.
      ctx.bezierCurveTo(8, 2, 16, 17, 32, 19);
      ctx.bezierCurveTo(46, 20.5, 54, 11.5, 64, 8.5);
      ctx.bezierCurveTo(72, 6, 79, 3, 84, -4);
      ctx.closePath();
    };
    b.piece(S.snow, body);
    b.inside(body, () => {
      b.tone(S.water, 0.3, (ctx) => {
        ctx.moveTo(-4, -6);
        ctx.lineTo(-4, 0.5);
        ctx.bezierCurveTo(8, 2, 16, 17, 32, 19);
        ctx.bezierCurveTo(23, 12, 25, 3, 30, -6);
        ctx.closePath();
      });
      b.line(S.water, 0.55, 0.55, all(sweep([[38, 12], [46, 9.5], [55, 7.5]]), sweep([[40, 5.5], [52, 3], [66, 2.5]])));
    });
  },
});

const serac = defineProp({
  surface: 'snow',
  name: 'serac',
  width: 48,
  height: 60,
  paper: S.snow,
  layer: 'mid',
  sway: 0.002,
  rim: 0.6,
  weight: 1.2,
  draw(b) {
    const blocks: readonly (readonly [readonly Pt[], readonly Pt[], readonly Pt[]])[] = [
      // [the block, its shaded face, its lit top]
      [[[29, -4], [30, 27], [37, 35.5], [45, 23], [46.5, -4]], [[29, -6], [30, 27], [37, 35.5], [36, 14], [35, -6]], [[37, 35.5], [45, 23], [36, 14]]],
      [[[1, -4], [3, 27], [9.5, 41], [18, 35], [19.5, -4]], [[0, -6], [3, 27], [9.5, 41], [9, 18], [8, -6]], [[9.5, 41], [18, 35], [9, 18]]],
      [[[15, -4], [16.5, 41], [24, 59], [31.5, 47], [33, -4]], [[14, -6], [16.5, 41], [24, 59], [23, 30], [22, -6]], [[24, 59], [31.5, 47], [23, 30]]],
    ];
    for (const [points, shade, lit] of blocks) {
      const block = poly(points, 0.9);
      b.piece(S.snow, block);
      b.inside(block, () => {
        b.tone(S.water, 0.42, poly(shade));
        b.tone(T.glass, 0.7, poly(lit));
        b.line(S.water, 0.7, 0.45, strip([lit[0] as Pt, lit[2] as Pt, [(lit[2] as Pt)[0] - 1, -6]]));
      });
    }
  },
});

export const HIGH_PROPS: readonly PropArt[] = [boulder, crag, pinnacle, rubble, fan, peak, drift, serac];
