import { THEME } from '../../look/theme';
import { defineProp, type PropArt } from '../art';
import { all, arcPoints, band, blade, box, curve, disc, lumps, oval, poly, shift, strip, sweep, type Pt } from '../shapes';

/**
 * The low country: meadow, woodland and bare earth.
 *
 * One hand draws everything in this folder. A drawing is a few flat pieces of paper, the light comes from the
 * upper right, a shaded side is one darker tone and never a gradient, and a handful of ink strokes say what
 * the surface is made of. Nothing is outlined.
 */
const T = THEME;
const S = THEME.surface;

// ---------------------------------------------------------------------------------------------------------
// Grass

const TUSSOCK: readonly (readonly [root: Pt, width: number, tip: Pt, bend: number])[] = [
  [[11, -4], 5, [1.5, 11], 1.4],
  [[13.5, -4], 6, [7, 19], 1.2],
  [[16.5, -4], 6.5, [14, 23.5], 0.6],
  [[19, -4], 6.5, [21.5, 21], -0.5],
  [[21.5, -4], 6, [28.5, 22.5], -1.1],
  [[23.5, -4], 5.5, [33, 15], -1.5],
  [[25.5, -4], 5, [35, 8], -1.2],
];

const tussock = defineProp({
  surface: 'grass',
  name: 'tussock',
  width: 36,
  height: 24,
  paper: S.grass,
  sway: 0.014,
  soft: 0.005,
  weight: 3,
  mirror: true,
  draw(b) {
    b.piece(S.grass, oval(18, -2, 13, 6));
    TUSSOCK.forEach(([root, width, tip, bend], index) => {
      b.piece(S.grass, blade(root, width, tip, bend));
      // Every second blade stands in the shade of its neighbour.
      if (index % 2 === 0) b.tone(S.forest, 0.55, blade(root, width, tip, bend));
    });
    b.tone(S.forest, 0.3, oval(15, -2, 9, 4));
  },
});

const flowers = defineProp({
  surface: 'grass',
  name: 'flowers',
  width: 32,
  height: 38,
  paper: S.grass,
  sway: 0.014,
  soft: 0.004,
  mirror: true,
  draw(b) {
    const stems: readonly (readonly [Pt, Pt, Pt, number])[] = [
      [[11, -4], [8, 10], [7, 20], 4.8],
      [[16, -4], [15.5, 14], [17, 28], 5.4],
      [[21, -4], [24, 8], [26, 17], 4.4],
    ];
    b.piece(S.forest, blade([13, -4], 5, [3, 9], 1.2));
    b.piece(S.forest, blade([19, -4], 5, [30, 7], -1.2));
    b.piece(S.grass, blade([16, -4], 5, [12.5, 13], 0.8));
    for (const [from, pull, to] of stems) b.piece(S.forest, band(arcPoints(from, pull, to, 8), 2.2, 1.8));
    for (const [, , to, r] of stems) {
      b.piece(T.paperHi, disc(to[0], to[1] + r * 0.5, r));
      // Petals are cuts into the head, the middle is a brass dot.
      for (let i = 0; i < 6; i += 1) {
        const angle = (i / 6) * Math.PI * 2 + 0.3;
        const cx = to[0];
        const cy = to[1] + r * 0.5;
        b.line(T.inkSoft, 0.34, 0.5, strip([[cx + Math.cos(angle) * r * 0.5, cy + Math.sin(angle) * r * 0.5], [cx + Math.cos(angle) * r * 0.95, cy + Math.sin(angle) * r * 0.95]]));
      }
      b.tone(T.brass, 1, disc(to[0], to[1] + r * 0.5, r * 0.36));
    }
  },
});

const stile = defineProp({
  surface: 'grass',
  name: 'stile',
  width: 54,
  height: 32,
  paper: S.dirt,
  sway: 0.004,
  soft: 0.006,
  weight: 0.7,
  draw(b) {
    const leftPost = poly([[6, -4], [6.4, 27], [9, 29.5], [11.6, 27], [12, -4]], 0.6);
    const rightPost = poly([[41, -4], [41.4, 25], [44, 27.5], [46.6, 25], [47, -4]], 0.6);
    const upper = band([[1, 19.5], [53, 21.5]], 4.6);
    const lower = band([[1, 9], [53, 10.5]], 4.6);
    const brace = band([[12, 4], [41, 17]], 3.2);
    b.piece(S.dirt, brace);
    b.tone(T.walnut, 0.45, brace);
    b.piece(S.dirt, lower);
    b.piece(S.dirt, upper);
    b.piece(S.dirt, leftPost);
    b.piece(S.dirt, rightPost);
    // Shade on the left of the posts and under the rails.
    b.inside(leftPost, () => b.tone(T.walnut, 0.5, box(4, -6, 4.4, 40)));
    b.inside(rightPost, () => b.tone(T.walnut, 0.5, box(39, -6, 4.4, 40)));
    b.inside(upper, () => b.tone(T.walnut, 0.36, band([[1, 18], [53, 20]], 1.6)));
    b.inside(lower, () => b.tone(T.walnut, 0.36, band([[1, 7.5], [53, 9]], 1.6)));
    b.line(T.walnutDeep, 0.3, 0.45, all(strip([[16, 21.2], [36, 22]]), strip([[18, 10.6], [34, 11.2]])));
    for (const [x, y] of [[9, 20], [9, 9.4], [44, 21.2], [44, 10.4]] as const) b.tone(T.walnutDeep, 0.75, disc(x, y, 0.8));
    // A tuft has grown up round the left post.
    b.piece(S.grass, blade([4, -4], 4, [2.4, 8], 0.5));
    b.piece(S.grass, blade([14, -4], 4.5, [18, 9], -0.8));
    b.piece(S.grass, blade([5, -4], 4, [4.5, 11], 0.2));
    b.tone(S.forest, 0.5, blade([5, -4], 4, [4.5, 11], 0.2));
  },
});

const knoll = defineProp({
  surface: 'grass',
  name: 'knoll',
  width: 150,
  height: 48,
  paper: S.grass,
  layer: 'mid',
  sway: 0.003,
  soft: 0.007,
  weight: 0.9,
  draw(b) {
    // Long grass stands along the crest.
    for (const [x, y, lean] of [[58, 32, -1.4], [64, 34, 0.6], [71, 35, -0.4], [79, 35, 1], [88, 34, -0.8], [95, 32, 1.6]] as const) {
      b.piece(S.grass, blade([x, y], 3.4, [x + lean * 2.4, y + 11], lean * 0.5));
    }
    const rise = (ctx: CanvasRenderingContext2D) => {
      ctx.moveTo(1, -4);
      ctx.bezierCurveTo(22, 4, 44, 35, 78, 38.5);
      ctx.bezierCurveTo(108, 41, 132, 14, 149, -4);
      ctx.closePath();
    };
    b.piece(S.grass, rise);
    b.inside(rise, () => {
      b.tone(S.forest, 0.4, (ctx) => {
        ctx.moveTo(-6, -6);
        ctx.lineTo(1, -4);
        ctx.bezierCurveTo(22, 4, 44, 35, 78, 38.5);
        ctx.bezierCurveTo(62, 26, 60, 10, 66, -6);
        ctx.closePath();
      });
      b.tone(T.paperHi, 0.16, (ctx) => {
        ctx.moveTo(78, 38.5);
        ctx.bezierCurveTo(108, 41, 132, 14, 149, -4);
        ctx.lineTo(140, -4);
        ctx.bezierCurveTo(126, 12, 106, 33, 80, 33.5);
        ctx.closePath();
      });
      // A sheep track, and the flowers that mark a meadow nobody mows.
      b.line(T.paperHi, 0.5, 0.9, sweep([[122, -4], [108, 8], [92, 10], [86, 22], [80, 36]]));
      for (const [x, y] of [[98, 22], [108, 15], [116, 20], [90, 28], [126, 6], [74, 20], [104, 4]] as const) {
        b.tone(T.paperHi, 1, disc(x, y, 1.7));
        b.tone(T.brass, 1, disc(x, y, 0.65));
      }
      b.line(S.forest, 0.5, 0.5, all(strip([[30, 4], [31.5, 8]]), strip([[33, 4], [33.4, 9]]), strip([[44, 14], [45.5, 18]]), strip([[47, 14], [47.4, 19]]), strip([[112, 2], [113.5, 6]]), strip([[115, 2], [115.4, 7]])));
    });
  },
});

// ---------------------------------------------------------------------------------------------------------
// Forest

const SPRUCE_TIERS: readonly (readonly Pt[])[] = [
  [[21, 53], [2, 14], [8, 17], [12, 12], [17, 16], [21, 11.5], [26, 16], [30, 12], [35, 17], [40, 14]],
  [[21, 71], [6, 34], [11, 37], [15, 32.5], [21, 36], [27, 32.5], [31, 37], [36, 34]],
  [[21, 87], [10.5, 54], [15, 56.5], [21, 52.5], [27, 56.5], [31.5, 54]],
];

const spruce = defineProp({
  surface: 'forest',
  name: 'spruce',
  width: 42,
  height: 88,
  paper: S.forest,
  sway: 0.008,
  rim: 0.3,
  weight: 3,
  draw(b) {
    b.piece(T.walnut, box(18.2, -4, 5.6, 22));
    b.tone(T.walnutDeep, 0.45, box(18.2, -4, 2.2, 22));
    SPRUCE_TIERS.forEach((tier, index) => {
      const shape = poly(tier, 0.8);
      b.piece(S.forest, shape);
      b.inside(shape, () => {
        // The left half lies in shade, and each tier shades the one below it.
        const apex = tier[0] as Pt;
        b.tone(T.ink, 0.17, poly([[apex[0] - 1, apex[1] + 2], [apex[0] - 5, 0], [-4, 0], [-4, apex[1] + 2]]));
        const above = SPRUCE_TIERS[index + 1];
        if (above) b.tone(T.ink, 0.2, shift(poly(above), 0, -4.5));
        b.tone(T.paperHi, 0.13, poly([[apex[0] + 1.5, apex[1] - 4], [apex[0] + 12, apex[1] - 26], [apex[0] + 6, apex[1] - 27]]));
      });
    });
  },
});

const broadleaf = defineProp({
  surface: 'forest',
  name: 'broadleaf',
  width: 62,
  height: 76,
  paper: S.forest,
  sway: 0.007,
  rim: 0.34,
  weight: 2.4,
  mirror: true,
  draw(b) {
    const trunk = poly([[26.5, -4], [35.5, -4], [34, 20], [40, 33], [36.5, 34.5], [31.5, 26], [27, 35], [23.5, 33.5], [28.5, 20]], 0.8);
    b.piece(T.walnut, trunk);
    b.inside(trunk, () => b.tone(T.walnutDeep, 0.5, poly([[24, -6], [29.5, -6], [31, 20], [27, 36], [22, 34]])));
    const crown = all(curve(lumps(31, 56, 23.5, 17.5, 7, 0.16, 0.35)), curve(lumps(16.5, 46, 12, 9.5, 5, 0.15, 1.1)), curve(lumps(46, 46.5, 11.5, 9.5, 5, 0.15, 0.4)));
    b.piece(S.forest, crown);
    b.inside(crown, () => {
      // The lit side of the crown is a second, lighter cut.
      b.tone(S.grass, 0.72, all(curve(lumps(37, 60, 16.5, 11.5, 6, 0.18, 0.9)), curve(lumps(48.5, 48.5, 7, 5.6, 5, 0.16, 0.2))));
      b.tone(T.ink, 0.16, all(curve(lumps(14, 43.5, 8.4, 6, 5, 0.18, 0.2)), curve(lumps(30, 41.5, 13, 4.6, 5, 0.18, 0.6))));
      b.line(T.ink, 0.2, 0.55, all(sweep([[20, 60], [24, 64], [29, 62]]), sweep([[33, 54], [38, 57], [42, 54]]), sweep([[13, 49], [17, 52], [21, 49]]), sweep([[38, 66], [42, 68], [46, 65]])));
    });
  },
});

const TREELINE_TOP: readonly Pt[] = (() => {
  const points: Pt[] = [];
  const count = 15;
  for (let i = 0; i <= count; i += 1) {
    const x = 12 + (i / count) * 176;
    const y = 40 + 7 * Math.sin(i * 1.9 + 0.4) + 4 * Math.sin(i * 0.73 + 1.1) + (i % 2 === 0 ? 5 : -4);
    points.push([x, y]);
  }
  return points;
})();

const treeline = defineProp({
  surface: 'forest',
  name: 'treeline',
  width: 200,
  height: 64,
  paper: S.forest,
  layer: 'back',
  sway: 0.004,
  rim: 0.3,
  soft: 0.012,
  weight: 0.6,
  draw(b) {
    // The wood ends in a round crown at either side, it is not cut off.
    const back = (ctx: CanvasRenderingContext2D) => {
      ctx.moveTo(3, -6);
      ctx.quadraticCurveTo(-2, 30, 12, (TREELINE_TOP[0] as Pt)[1]);
      sweepTo(ctx, TREELINE_TOP);
      ctx.quadraticCurveTo(202, 30, 197, -6);
      ctx.closePath();
    };
    // Three spruces stand above the crowns, behind them.
    const spruces = ([[40, 63], [112, 60], [166, 63]] as const).map(([x, top]) =>
      poly([[x, top], [x - 7, top - 17], [x - 3.6, top - 16.4], [x - 11, top - 34], [x + 11, top - 34], [x + 3.6, top - 16.4], [x + 7, top - 17]], 0.8),
    );
    for (const tip of spruces) b.piece(S.forest, tip);
    for (const tip of spruces) b.tone(T.ink, 0.22, tip);
    b.piece(S.forest, back);
    b.inside(back, () => {
      // A nearer row of crowns, one tone darker, and the trunks under them.
      const near: Pt[] = [];
      for (let i = 0; i <= 13; i += 1) near.push([-6 + (i / 13) * 212, 22 + 4 * Math.sin(i * 2.3 + 2) + (i % 2 === 0 ? 4.5 : -3.5)]);
      b.tone(T.ink, 0.2, (ctx) => {
        ctx.moveTo(-6, -6);
        ctx.lineTo(-6, 18);
        sweepTo(ctx, near);
        ctx.lineTo(206, -6);
        ctx.closePath();
      });
      for (let i = 0; i < 15; i += 1) {
        const x = 11 + i * 12.6 + 3 * Math.sin(i * 4.1);
        b.line(T.walnutDeep, 0.5, 1.1, strip([[x, -4], [x + Math.sin(i) * 0.8, 8 + 3 * Math.sin(i * 1.7)]]));
      }
      // Where the lamp catches the tops of the crowns.
      b.line(S.grass, 0.55, 2.6, (ctx) => {
        const rim = TREELINE_TOP.map(([x, y]): Pt => [x + 1.5, y - 4.2]);
        ctx.moveTo((rim[0] as Pt)[0], (rim[0] as Pt)[1]);
        sweepTo(ctx, rim);
      });
    });
  },
});

function sweepTo(ctx: CanvasRenderingContext2D, points: readonly Pt[]): void {
  const first = points[0] as Pt;
  ctx.lineTo(first[0], first[1]);
  for (let i = 1; i < points.length - 1; i += 1) {
    const here = points[i] as Pt;
    const after = points[i + 1] as Pt;
    const end: Pt = i === points.length - 2 ? after : [(here[0] + after[0]) / 2, (here[1] + after[1]) / 2];
    ctx.quadraticCurveTo(here[0], here[1], end[0], end[1]);
  }
}

// ---------------------------------------------------------------------------------------------------------
// Dirt

const stump = defineProp({
  surface: 'dirt',
  name: 'stump',
  width: 38,
  height: 30,
  paper: S.dirt,
  sway: 0.003,
  soft: 0.006,
  weight: 1.4,
  mirror: true,
  draw(b) {
    const body = poly([[0, -4], [4, 2], [7, 10], [8.5, 18.5], [28.5, 18.5], [30, 10], [33, 2], [38, -4]], 1.2);
    b.piece(S.dirt, body);
    b.inside(body, () => {
      b.tone(T.walnut, 0.5, poly([[-2, -6], [16, -6], [14, 20], [6, 20]]));
      b.line(T.walnutDeep, 0.34, 0.5, all(strip([[13, 16], [12, 4], [9, -2]]), strip([[20, 16], [20.5, 3]]), strip([[26, 16], [27.5, 6], [31, 0]])));
    });
    const face = oval(18.5, 18.5, 10, 3.8);
    b.piece(T.paperShade, face);
    b.line(T.walnut, 0.55, 0.45, all(oval(18.5, 18.5, 6.4, 2.3), oval(18.8, 18.6, 3, 1)));
    b.line(T.walnut, 0.5, 0.45, strip([[18.8, 18.6], [26.5, 20]]));
    // One green shoot: the stump is not dead.
    b.piece(S.grass, band(arcPoints([28, 18], [31, 22], [31, 26], 5), 1.6, 1.3));
    b.piece(S.grass, oval(33.4, 25.4, 3, 1.6, -0.4));
    b.piece(S.grass, oval(29, 26.4, 2.6, 1.4, 0.7));
  },
});

const SHRUB_BRANCHES: readonly (readonly [Pt, Pt, Pt, number, number])[] = [
  [[22, -4], [19, 10], [11, 24], 3.6, 1.9],
  [[23, -4], [24.5, 14], [22.5, 34], 3.8, 1.9],
  [[24.5, -4], [31, 10], [39, 22], 3.6, 1.9],
  [[15.5, 17.5], [10, 19], [5, 22], 1.9, 1.5],
  [[13, 21.5], [12, 28], [14, 32], 1.8, 1.5],
  [[23.3, 23], [19, 29], [15.5, 36.5], 1.9, 1.5],
  [[23, 26], [27, 31], [30.5, 37.5], 1.9, 1.5],
  [[33, 15.5], [39, 14], [44, 16], 1.9, 1.5],
  [[36, 19], [39, 25], [42.5, 31], 1.8, 1.5],
];

const shrub = defineProp({
  surface: 'dirt',
  name: 'shrub',
  width: 50,
  height: 44,
  paper: T.walnut,
  sway: 0.011,
  soft: 0.0035,
  rim: 0.24,
  weight: 1.6,
  mirror: true,
  draw(b) {
    for (const [from, pull, to, start, end] of SHRUB_BRANCHES) b.piece(T.walnut, band(arcPoints(from, pull, to, 7), start, end));
    // The last dry leaves.
    const leaves: readonly (readonly [number, number, number, boolean])[] = [
      [4, 23.5, 0.5, true],
      [14.5, 34, 1.3, false],
      [15, 38.5, 2.2, true],
      [22.3, 36.5, 1.5, false],
      [31.5, 39.5, 0.9, true],
      [45.5, 16.5, -0.2, false],
      [43.5, 33, 0.9, true],
      [10, 27, 2.3, false],
    ];
    for (const [x, y, turn, pale] of leaves) b.piece(pale ? S.sand : S.dirt, oval(x, y, 3, 1.7, turn));
  },
});

const bank = defineProp({
  surface: 'dirt',
  name: 'bank',
  width: 136,
  height: 46,
  paper: S.dirt,
  layer: 'mid',
  sway: 0.002,
  soft: 0.008,
  weight: 0.9,
  draw(b) {
    const cut = poly([[1, -4], [7, 17], [19, 30], [45, 37], [83, 39], [111, 34], [127, 21], [135, -4]], 3.4);
    b.piece(S.dirt, cut);
    b.inside(cut, () => {
      // Turf hangs over the top of the cutting. Under it the earth lies in beds.
      b.tone(T.walnut, 0.3, box(-4, 15, 144, 4.5));
      b.tone(T.walnut, 0.2, box(-4, 4, 144, 3));
      b.tone(T.ink, 0.16, poly([[-4, -6], [7, 17], [19, 30], [45, 37], [40, 16], [34, -6]]));
      for (const [x, y, w] of [[52, 9, 6], [70, 24, 5], [92, 11, 7], [106, 23, 4.4], [24, 9, 4.6], [116, 5, 5]] as const) {
        b.tone(S.rock, 1, poly([[x - w / 2, y - w * 0.3], [x - w * 0.3, y + w * 0.3], [x + w * 0.4, y + w * 0.34], [x + w / 2, y - w * 0.3]], w * 0.16));
        b.tone(T.ink, 0.22, poly([[x - w / 2, y - w * 0.3], [x - w * 0.3, y + w * 0.3], [x - w * 0.05, y - w * 0.3]]));
      }
      b.line(T.walnutDeep, 0.55, 0.6, all(sweep([[58, 34], [57, 26], [61, 20], [59, 15]]), sweep([[61, 20], [65, 17]]), sweep([[88, 35], [90, 27], [87, 22]]), sweep([[34, 30], [36, 24], [33, 19]])));
      b.tone(S.grass, 1, (ctx) => {
        ctx.moveTo(-4, 50);
        ctx.lineTo(-4, 12);
        ctx.bezierCurveTo(8, 20, 14, 26, 22, 27);
        ctx.bezierCurveTo(30, 28, 32, 31.5, 44, 32.5);
        ctx.bezierCurveTo(56, 33.5, 60, 31, 72, 34);
        ctx.bezierCurveTo(84, 36.5, 92, 31, 104, 30.5);
        ctx.bezierCurveTo(114, 30, 118, 22, 126, 18);
        ctx.bezierCurveTo(132, 15, 136, 8, 140, 4);
        ctx.lineTo(140, 50);
        ctx.closePath();
      });
      b.tone(S.forest, 0.34, poly([[-4, 50], [-4, 12], [14, 26], [22, 27], [44, 32.5], [44, 50]]));
    });
    for (const [x, y, lean] of [[30, 33, -1], [36, 35, 0.4], [96, 36.5, 1], [102, 35, -0.3]] as const) b.piece(S.grass, blade([x, y], 3, [x + lean * 2, y + 8.5], lean * 0.4));
  },
});

export const LOW_PROPS: readonly PropArt[] = [tussock, flowers, stile, knoll, spruce, broadleaf, treeline, stump, shrub, bank];
