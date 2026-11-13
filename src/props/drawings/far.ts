import { THEME } from '../../look/theme';
import { defineProp, type PropArt } from '../art';
import { all, band, box, disc, poly, strip, sweep, type Pt } from '../shapes';

/** What hangs over every surface, and what stands at a camp. */
const T = THEME;
const S = THEME.surface;

// ---------------------------------------------------------------------------------------------------------
// Sky

const cumulus = defineProp({
  surface: 'sky',
  name: 'cumulus',
  width: 76,
  height: 40,
  paper: T.paperHi,
  pose: 'hang',
  layer: 'back',
  sway: 0.006,
  soft: 0.008,
  rim: 0.3,
  weight: 2,
  mirror: true,
  draw(b) {
    const body = all(box(5, 3, 66, 15, 7.5), disc(21, 17, 12.5), disc(40, 23, 16), disc(58, 16, 11.5));
    b.piece(T.paperHi, body);
    b.inside(body, () => {
      b.tone(T.steel, 0.3, box(0, 0, 76, 8));
      b.line(T.steel, 0.55, 0.55, all(sweep([[30, 27], [36, 33], [44, 31]]), sweep([[14, 20], [18, 24], [23, 22]]), sweep([[52, 19], [57, 22], [62, 19]])));
    });
  },
});

const stratus = defineProp({
  surface: 'sky',
  name: 'stratus',
  width: 108,
  height: 26,
  paper: T.paperHi,
  pose: 'hang',
  layer: 'back',
  sway: 0.005,
  soft: 0.007,
  rim: 0.3,
  weight: 1.4,
  mirror: true,
  draw(b) {
    const body = all(box(3, 2, 84, 10, 5), box(26, 9, 78, 10, 5), box(14, 16, 44, 8, 4));
    b.piece(T.paperHi, body);
    b.inside(body, () => {
      b.tone(T.steel, 0.28, all(box(3, 2, 84, 3.6, 1.8), box(88, 9, 16, 3.4, 1.7), box(14, 16, 10, 2.8, 1.4)));
      b.line(T.steel, 0.5, 0.5, all(strip([[30, 12], [84, 12]]), strip([[60, 19], [100, 19]])));
    });
  },
});

const moon = defineProp({
  surface: 'sky',
  name: 'moon',
  width: 28,
  height: 30,
  paper: T.paperHi,
  pose: 'hang',
  layer: 'back',
  sway: 0.004,
  soft: 0.006,
  rim: 0.3,
  weight: 0.5,
  draw(b) {
    const rad = Math.PI / 180;
    // A waning crescent: the outer edge is a circle, the inner edge a second circle set off to the right.
    const crescent = (ctx: CanvasRenderingContext2D) => {
      ctx.moveTo(14 + 13 * Math.cos(70 * rad), 15 + 13 * Math.sin(70 * rad));
      ctx.arc(14, 15, 13, 70 * rad, 290 * rad, false);
      ctx.arc(22, 15, 12.72, 253.8 * rad, 106.2 * rad, true);
      ctx.closePath();
    };
    b.piece(T.paperHi, crescent);
    b.inside(crescent, () => {
      b.tone(T.lamp, 0.5, box(0, 0, 28, 30));
      b.tone(T.brass, 0.3, all(disc(5.5, 17, 1.9), disc(7.5, 9.5, 1.3), disc(8.5, 23, 1.1)));
    });
  },
});

// ---------------------------------------------------------------------------------------------------------
// Camp

const tent = defineProp({
  surface: 'camp',
  name: 'tent',
  width: 84,
  height: 54,
  paper: S.sand,
  layer: 'mid',
  sway: 0.004,
  soft: 0.007,
  weight: 3,
  draw(b) {
    // A ridge tent seen from its door end: the gable to the left, the long side running back to the right.
    const side = poly([[31, 46], [73, 40], [84, -4], [50, -4]], 1);
    const gable = poly([[6, -4], [31, 46], [56, -4]], 1.2);
    b.piece(T.walnut, band([[30, 44], [31.5, 53]], 2.4));
    b.piece(T.walnut, band([[72.5, 38], [74, 46]], 2.2));
    b.piece(S.sand, side);
    b.inside(side, () => {
      b.tone(T.paperHi, 0.26, poly([[31, 46], [73, 40], [84, -6], [70, -6]]));
      b.line(S.dirt, 0.6, 0.55, all(strip([[45, 44], [62, -4]]), strip([[59, 42], [73, -4]])));
      b.tone(S.dirt, 0.55, poly([[50, -6], [50, 3], [84, 3], [84, -6]]));
    });
    b.piece(S.sand, gable);
    b.inside(gable, () => {
      b.tone(T.ink, 0.12, poly([[6, -6], [31, 46], [31, -6]]));
      // The door stands open on the dark inside. One flap is tied back.
      b.tone(T.ink, 0.86, poly([[31, 37], [22, -6], [41, -6]]));
      b.tone(S.sand, 1, poly([[31, 37], [41, -6], [45, -6], [36, 14]]));
      b.tone(T.paperHi, 0.3, poly([[31, 37], [41, -6], [45, -6], [36, 14]]));
      b.tone(S.dirt, 0.55, poly([[6, -6], [6, 3], [22.5, 3], [22, -6]]));
      b.line(S.dirt, 0.6, 0.5, strip([[31, 46], [31, 37]]));
    });
  },
});

const fire = defineProp({
  surface: 'camp',
  name: 'fire',
  width: 36,
  height: 32,
  paper: T.walnut,
  sway: 0.012,
  soft: 0.005,
  rim: 0.26,
  weight: 1.6,
  mirror: true,
  draw(b) {
    const flame = (ctx: CanvasRenderingContext2D) => {
      ctx.moveTo(19, 31);
      ctx.bezierCurveTo(21, 24, 28, 18, 26, 10);
      ctx.bezierCurveTo(25, 5, 21, 3.5, 18, 3.5);
      ctx.bezierCurveTo(13, 3.5, 9.5, 7, 10, 12);
      ctx.bezierCurveTo(10.3, 15.5, 13, 16.5, 13.5, 20);
      ctx.bezierCurveTo(15.5, 18.5, 15.5, 15, 15, 13);
      ctx.bezierCurveTo(19, 17, 20, 24, 19, 31);
      ctx.closePath();
    };
    b.piece(T.lamp, flame);
    b.inside(flame, () => {
      b.tone(T.brass, 0.85, (ctx) => {
        ctx.moveTo(19.5, 19);
        ctx.bezierCurveTo(22.5, 14, 23.5, 9, 21.5, 6);
        ctx.bezierCurveTo(19, 3, 14, 4, 13.5, 8.5);
        ctx.bezierCurveTo(13.3, 11, 16, 11, 17, 13);
        ctx.bezierCurveTo(18.5, 15, 19.3, 16.5, 19.5, 19);
        ctx.closePath();
      });
      b.tone(T.paperHi, 0.75, disc(18.2, 6.4, 2.5));
    });
    const logs: readonly (readonly [Pt, Pt])[] = [[[5, 1], [30, 8.5]], [[31, 1], [6, 8.5]]];
    logs.forEach(([from, to], index) => {
      const log = band([from, to], 4.6);
      b.piece(T.walnut, log);
      b.inside(log, () => b.tone(T.walnutDeep, 0.5, band([[from[0], from[1] - 1.5], [to[0], to[1] - 1.5]], 1.8)));
      const end = index === 0 ? to : to;
      b.tone(S.sand, 0.9, disc(end[0], end[1], 1.5));
    });
    for (const [x, w] of [[1, 7], [9, 7.5], [20, 7.5], [28.5, 7]] as const) {
      const stone = poly([[x, -4], [x + 0.6, 2.4], [x + w * 0.5, 3.6], [x + w - 0.4, 2.2], [x + w, -4]], 1);
      b.piece(S.rock, stone);
      b.inside(stone, () => b.tone(T.ink, 0.18, box(x - 1, -6, 2.6, 12)));
    }
  },
});

const hut = defineProp({
  surface: 'camp',
  name: 'hut',
  width: 86,
  height: 68,
  paper: S.dirt,
  layer: 'mid',
  sway: 0.002,
  soft: 0.007,
  weight: 1.1,
  draw(b) {
    const chimney = box(56, 40, 9, 24, 0.8);
    b.piece(S.rock, chimney);
    b.inside(chimney, () => {
      b.tone(T.ink, 0.18, box(56, 40, 3, 24));
      b.line(T.ink, 0.26, 0.45, all(strip([[56, 57], [65, 57]]), strip([[60.5, 57], [60.5, 64]])));
    });
    const wall = poly([[12, -4], [12, 30], [43, 56], [74, 30], [74, -4]], 0.6);
    b.piece(S.dirt, wall);
    b.inside(wall, () => {
      for (let x = 18; x < 74; x += 6.2) b.line(T.walnut, 0.4, 0.45, strip([[x, -6], [x, 56]]));
      b.tone(T.walnut, 0.34, poly([[10, 28], [43, 55], [76, 28], [76, 22], [43, 49], [10, 22]]));
      b.tone(T.ink, 0.12, box(10, -6, 9, 50));
    });
    const roof = all(band([[4, 26.5], [43.6, 60]], 6.4), band([[82, 26.5], [42.4, 60]], 6.4));
    b.piece(T.walnut, roof);
    b.inside(roof, () => b.tone(T.walnutDeep, 0.45, band([[4, 24.5], [43, 57.5]], 3.4)));
    // The door, and two windows with the lamp lit inside.
    b.tone(T.walnutDeep, 1, box(36.5, -6, 13, 30, 0.8));
    b.tone(T.walnut, 0.5, box(38.5, -6, 9, 26, 0.5));
    b.tone(T.brass, 1, disc(46.4, 9, 0.9));
    for (const x of [18.5, 56.5]) {
      b.tone(T.walnutDeep, 1, box(x - 1.2, 8.8, 12.4, 12.4, 0.6));
      b.tone(T.lamp, 1, box(x, 10, 10, 10, 0.4));
      b.line(T.walnutDeep, 1, 0.9, all(strip([[x + 5, 10], [x + 5, 20]]), strip([[x, 15], [x + 10, 15]])));
    }
    b.piece(S.rock, poly([[31, -4], [32, 1.6], [54, 1.6], [55, -4]], 0.8));
  },
});

export const FAR_PROPS: readonly PropArt[] = [cumulus, stratus, moon, tent, fire, hut];
