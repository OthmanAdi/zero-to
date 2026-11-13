import { Group, Vector3 } from 'three';
import { createCompass, type CompassPart } from '../compass';
import { createRandom } from '../core/random';
import { THEME, withAlpha } from '../look/theme';
import { clamp01, settleSpring, spring, stepSpringKC, type Spring } from '../paper/motion';
import { buildSheet, type Sheet } from '../paper/sheet';
import type { Draw2D } from '../paper/silhouette';
import type { FrameTime, SceneEnvironment, ScenePart } from '../scene/contract';
import { TIER_NAMES, type TierName } from '../scene/palette';
import { resolutionFor } from './art';
import { DESIGN, sheetDrawings, type Brush, type Drawing, type NamedDrawing } from './brush';
import { all, band, box, disc, poly, strip, sweep, type Pt } from './shapes';
import { STAND, createStand } from './stand';

/**
 * Paper stations: the small stages of the landing page. Stop 01 shows the four altitudes as four peaks that
 * stand up one after another. Stop 02 shows what a roadmap carries as five cards that turn round a compass.
 */
const T = THEME;
const S = THEME.surface;

export type StationKind = 'altitudes' | 'carries';

export const STATION = {
  /** Width and depth of the sheet, by kind. */
  sheet: { altitudes: [7.9, 3.85], carries: [5.48, 3.85] },
  thickness: 0.0175,
  /** A cut-out starts to stand when the station has formed this far: `start + spread * k / n`. */
  start: 0.05,
  spread: 0.8,
  /** How far above a cut-out its card is anchored. */
  anchorLift: 0.12,
  /** The ring of cards: its radius, the angle between cards and the size of the card in front. */
  orbit: { radius: 1.4, step: (72 * Math.PI) / 180, front: 1.32, height: 0.62, spring: { k: 15, c: 7.4 } },
  /** The peaks are drawn at prop size and stood up larger: a station is seen from further away than a panel. */
  peakScale: 1.35,
  /** How much of its place on the ring a card turns with. The rest it keeps facing the viewer. */
  cardTurn: 0.38,
  /** A peak that is not in focus leans back this far and dims to this. */
  lean: 0.42,
  dim: 0.62,
  focus: { k: 60, c: 16 },
} as const;

/** The five things a roadmap carries, in the order of their cards. */
export const CARRIES = ['stages', 'checkpoints', 'projects', 'sources', 'pace'] as const;
export type CarryKind = (typeof CARRIES)[number];

// ---------------------------------------------------------------------------------------------------------
// The sheet every station stands on: map paper with a few contours, the dashed route and its start dot.

export function stationPrint(kind: StationKind, seed: number): Draw2D {
  return (ctx, w, h) => {
    const random = createRandom(`station/${kind}/${seed}`);
    ctx.strokeStyle = withAlpha(T.ink, 0.13);
    ctx.lineWidth = Math.max(1, w * 0.0012);
    for (let hill = 0; hill < 3; hill += 1) {
      const cx = (0.18 + 0.32 * hill + random() * 0.08) * w;
      const cy = (0.2 + random() * 0.25) * h;
      for (let ring = 1; ring <= 5; ring += 1) {
        ctx.beginPath();
        ctx.ellipse(cx, cy, ring * w * 0.034 * (1 + random() * 0.12), ring * h * 0.05, random() * 0.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // The route crosses the front of the sheet, where the cut-outs leave it clear.
    const y = h * 0.8;
    ctx.strokeStyle = T.signal;
    ctx.lineWidth = Math.max(2, w * 0.0042);
    ctx.setLineDash([w * 0.014, w * 0.0095]);
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(w * 0.06, y);
    ctx.bezierCurveTo(w * 0.28, y - h * 0.1, w * 0.4, y + h * 0.1, w * 0.56, y - h * 0.02);
    ctx.bezierCurveTo(w * 0.72, y - h * 0.14, w * 0.84, y + h * 0.06, w * 0.95, y - h * 0.06);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = T.signal;
    ctx.beginPath();
    ctx.arc(w * 0.06, y, w * 0.0075, 0, Math.PI * 2);
    ctx.fill();
  };
}

// ---------------------------------------------------------------------------------------------------------
// Stop 01: four peaks, one per tier, each higher and barer than the last.

interface PeakSpec {
  readonly width: number;
  readonly height: number;
  readonly paper: string;
  readonly draw: Drawing;
}

/** A waymark on a short stake at the right foot of a peak: white paint with the tier's colour across it. */
function waymark(b: Brush, x: number, tier: TierName): void {
  b.piece(T.walnut, band([[x, -4], [x, 21]], 2.4));
  const plate = box(x - 5.4, 12, 10.8, 10.4, 1);
  b.piece(T.paperHi, plate);
  b.tone(T.tier[tier], 1, box(x - 5.4, 15, 10.8, 4.4));
}

const zigzag = (from: number, to: number, y: number, depth: number, teeth: number): Pt[] => {
  const points: Pt[] = [];
  for (let i = 0; i <= teeth * 2; i += 1) points.push([from + ((to - from) * i) / (teeth * 2), y + (i % 2 === 0 ? 0 : depth)]);
  return points;
};

const PEAKS: Readonly<Record<TierName, PeakSpec>> = {
  bronze: {
    width: 128,
    height: 72,
    paper: S.grass,
    draw(b) {
      const hill = (ctx: CanvasRenderingContext2D) => {
        ctx.moveTo(1, -4);
        ctx.bezierCurveTo(14, 8, 30, 60, 56, 67);
        ctx.bezierCurveTo(80, 72, 94, 30, 108, 6);
        ctx.lineTo(112, -4);
        ctx.closePath();
      };
      b.piece(S.grass, hill);
      b.inside(hill, () => {
        b.tone(S.forest, 0.42, (ctx) => {
          ctx.moveTo(-6, -6);
          ctx.lineTo(1, -4);
          ctx.bezierCurveTo(14, 8, 30, 60, 56, 67);
          ctx.bezierCurveTo(46, 44, 50, 18, 58, -6);
          ctx.closePath();
        });
        // A copse on the shoulder and the path up through the meadow.
        for (const [x, y] of [[70, 40], [78, 34], [64, 32], [84, 26]] as const) b.tone(S.forest, 1, poly([[x, y + 11], [x - 4.4, y], [x + 4.4, y]], 0.6));
        b.line(T.paperHi, 0.7, 1.1, sweep([[92, -4], [80, 12], [62, 16], [58, 34], [56, 64]]));
      });
      waymark(b, 118, 'bronze');
    },
  },
  silver: {
    width: 136,
    height: 106,
    paper: S.forest,
    draw(b) {
      const body = poly([[-6, -4], [14, 18], [34, 46], [52, 78], [64, 102], [74, 87], [86, 71], [102, 40], [116, 14], [122, -4]], 1.6);
      b.piece(S.forest, body);
      b.inside(body, () => {
        // Above the tree line the mountain is bare scree.
        b.tone(S.scree, 1, poly([[64, 106], [30, 50], ...zigzag(30, 100, 48, -7, 5), [100, 46], [80, 106]]));
        b.tone(T.ink, 0.18, poly([[64, 102], [52, 78], [34, 46], [14, 18], [-6, -6], [54, -6], [58, 50]]));
        b.tone(T.paperHi, 0.16, poly([[64, 102], [74, 87], [86, 71], [80, 40], [58, 50]]));
        b.line(T.ink, 0.2, 0.7, strip([[64, 102], [58, 50], [54, -6]]));
      });
      waymark(b, 128, 'silver');
    },
  },
  gold: {
    width: 146,
    height: 140,
    paper: S.rock,
    draw(b) {
      const body = poly([[-6, -4], [16, 24], [38, 62], [56, 100], [68, 137], [80, 113], [92, 97], [110, 60], [126, 24], [132, -4]], 1.6);
      b.piece(S.rock, body);
      b.inside(body, () => {
        b.tone(S.forest, 1, poly([[-10, -6], [-10, 26], ...zigzag(-6, 136, 24, -8, 8), [140, -6]]));
        b.tone(T.ink, 0.2, poly([[68, 137], [56, 100], [38, 62], [16, 24], [-6, -6], [58, -6], [62, 70]]));
        b.tone(T.paperHi, 0.14, poly([[68, 137], [80, 113], [92, 97], [86, 50], [62, 70]]));
        // The first snow lies in the gullies under the summit.
        b.tone(S.snow, 1, poly([[68, 138], [60, 112], [66, 104], [70, 116], [76, 102], [82, 110], [78, 120]], 0.8));
        b.tone(S.snow, 1, poly([[52, 86], [48, 62], [54, 72]], 0.5));
        b.tone(S.snow, 1, poly([[90, 92], [96, 66], [100, 76]], 0.5));
        b.line(T.ink, 0.2, 0.7, strip([[68, 137], [62, 70], [58, -6]]));
      });
      waymark(b, 138, 'gold');
    },
  },
  diamond: {
    width: 156,
    height: 178,
    paper: S.snow,
    draw(b) {
      const body = poly([[-6, -4], [18, 30], [40, 76], [58, 122], [72, 175], [84, 145], [94, 127], [112, 80], [130, 34], [140, -4]], 1.6);
      b.piece(S.snow, body);
      b.inside(body, () => {
        // Rock shows through below, and in two ribs that run up towards the summit.
        b.tone(S.rock, 1, poly([[-10, -6], [-10, 40], ...zigzag(-6, 146, 40, -12, 7), [146, -6]]));
        b.tone(S.rock, 1, poly([[54, 60], [60, 104], [66, 84], [70, 40], [58, 30]], 0.8));
        b.tone(S.rock, 1, poly([[92, 50], [94, 96], [102, 70], [106, 40]], 0.8));
        b.tone(S.water, 0.34, poly([[72, 175], [58, 122], [40, 76], [18, 30], [-6, -6], [60, -6], [66, 90]]));
        b.tone(T.glass, 0.8, poly([[72, 175], [84, 145], [94, 127], [86, 100], [66, 90]]));
        b.line(S.water, 0.8, 0.7, strip([[72, 175], [66, 90], [60, -6]]));
      });
      waymark(b, 148, 'diamond');
    },
  },
};

// ---------------------------------------------------------------------------------------------------------
// Stop 02: five cards, each with one small drawing of what a roadmap carries.

const CARD = { width: 62, height: 80 } as const;

const CARD_ICONS: Readonly<Record<CarryKind, (b: Brush) => void>> = {
  stages(b) {
    // A folded map of three panels with the route across it.
    b.tone(S.sand, 1, poly([[9, 23], [24, 28], [24, 62], [9, 57]]));
    b.tone(T.paperShade, 1, poly([[24, 28], [38, 23], [38, 57], [24, 62]]));
    b.tone(S.sand, 1, poly([[38, 23], [53, 28], [53, 62], [38, 57]]));
    b.line(T.inkSoft, 0.3, 0.5, all(sweep([[11, 46], [17, 50], [23, 48]]), sweep([[26, 38], [31, 35], [37, 38]]), sweep([[40, 50], [46, 53], [52, 49]])));
    const route: Pt[] = [[12.5, 33], [18, 39], [24, 43], [30, 41], [36, 46], [42, 49], [48, 45]];
    for (let i = 0; i < route.length - 1; i += 1) {
      const from = route[i] as Pt;
      const to = route[i + 1] as Pt;
      b.line(T.signal, 1, 1.6, strip([from, [from[0] + (to[0] - from[0]) * 0.62, from[1] + (to[1] - from[1]) * 0.62]]));
    }
    b.tone(T.signal, 1, disc(48.6, 44.6, 2.2));
  },
  checkpoints(b) {
    // A fingerpost: one arm still points back, one has swung round and carries its tick.
    b.tone(S.dirt, 1, poly([[28.6, 14], [28.9, 62], [31, 66], [33.1, 62], [33.4, 14]]));
    b.tone(T.walnut, 0.5, box(28.6, 14, 1.8, 50));
    b.tone(S.sand, 1, poly([[30, 47], [47, 47], [52, 52], [47, 57], [30, 57]]));
    b.tone(S.sand, 1, poly([[32, 33], [15, 33], [10, 38], [15, 43], [32, 43]]));
    b.tone(S.dirt, 0.5, all(box(30, 47, 18, 1.5), box(14, 33, 18, 1.5)));
    b.tone(T.paperHi, 1, disc(36, 52, 3.1));
    b.line(T.ink, 1, 0.95, strip([[34.4, 52], [35.6, 50.6], [37.8, 53.6]]));
    b.line(T.ink, 0.45, 0.5, disc(26.4, 38, 2.6));
    b.tone(S.grass, 1, all(poly([[24, 14], [22, 21], [27, 14]]), poly([[35, 14], [38, 20], [38.6, 14]])));
  },
  projects(b) {
    // A tent, and the flag of a finished rung.
    b.tone(T.walnut, 1, band([[46.5, 16], [46.5, 64]], 1.8));
    b.tone(T.brass, 1, poly([[47.4, 63.4], [58, 58.6], [47.4, 53.8]]));
    b.tone(S.sand, 1, poly([[8, 16], [25, 47], [42, 16]]));
    b.tone(T.ink, 0.14, poly([[8, 16], [25, 47], [25, 16]]));
    b.tone(T.ink, 0.86, poly([[25, 40], [19, 16], [31, 16]]));
    b.tone(S.dirt, 0.55, all(box(8, 16, 11.2, 2.4), box(30.8, 16, 11.2, 2.4)));
  },
  sources(b) {
    // Three volumes on a shelf, each with its label.
    b.tone(T.walnut, 1, box(9, 15, 44, 3));
    b.tone(S.water, 1, box(13, 18, 9.6, 39, 0.8));
    b.tone(S.forest, 1, box(23.6, 18, 11.4, 45, 0.8));
    b.tone(S.dirt, 1, poly([[36.6, 18], [45.2, 18], [50.4, 52], [41.8, 53.4]], 0.8));
    b.tone(T.paperHi, 0.9, all(box(14.4, 42, 6.8, 8), box(25.4, 46, 7.8, 9)));
    b.tone(T.paperHi, 0.9, poly([[41, 39.6], [47.4, 38.6], [48.4, 45.2], [42, 46.2]]));
    b.tone(T.ink, 0.16, all(box(13, 18, 2.2, 39), box(23.6, 18, 2.4, 45)));
    b.line(T.ink, 0.3, 0.5, all(strip([[14.4, 24], [21.2, 24]]), strip([[25.4, 25], [33.2, 25]])));
  },
  pace(b) {
    // A weeks ruler, and the brass marker that says where the plan would be today.
    b.tone(S.sand, 1, box(8, 28, 46, 13, 1));
    b.tone(S.dirt, 0.5, box(8, 28, 46, 1.6));
    for (let i = 0; i <= 7; i += 1) b.line(T.ink, 0.7, 0.6, strip([[11 + i * 5.7, 41], [11 + i * 5.7, i % 2 === 0 ? 34.4 : 37]]));
    b.tone(T.brass, 1, poly([[36.6, 43], [32.2, 53], [41, 53]], 0.6));
    b.tone(T.brassDeep, 1, box(35.6, 53, 2, 9));
    b.line(T.signal, 1, 1.2, strip([[11, 22], [16, 22]]));
    b.line(T.signal, 1, 1.2, strip([[19, 22], [24, 22]]));
    b.line(T.signal, 1, 1.2, strip([[27, 22], [32, 22]]));
    b.tone(T.signal, 1, disc(36.6, 22, 1.9));
  },
};

function cardDrawing(kind: CarryKind): Drawing {
  return (b) => {
    const card = box(0.5, 0.5, 61, 79, 3);
    b.piece(T.paperHi, card);
    b.inside(card, () => {
      b.tone(T.paperShade, 0.5, box(0, 0, 62, 9));
      CARD_ICONS[kind](b);
    });
  };
}

// ---------------------------------------------------------------------------------------------------------

/** The cut-outs of both stations as drawings, for checks. */
export function stationPieces(): NamedDrawing[] {
  return [
    ...TIER_NAMES.map((tier) => ({ name: `station/peak-${tier}`, draw: PEAKS[tier].draw, width: PEAKS[tier].width, height: PEAKS[tier].height })),
    ...CARRIES.map((carry) => ({ name: `station/card-${carry}`, draw: cardDrawing(carry), ...CARD })),
  ];
}

export interface StationOptions {
  readonly environment?: SceneEnvironment;
  readonly seed?: number;
  /** How far the station has formed at the start, 0 to 1. */
  readonly form?: number;
}

export interface StationPart extends ScenePart<Group> {
  readonly kind: StationKind;
  /** Number of cut-outs: four peaks or five cards. */
  readonly count: number;
  /** What each cut-out stands for: tier names for the altitudes, `CARRIES` for the cards. */
  readonly names: readonly string[];
  /** Width and depth of the sheet. */
  readonly size: { readonly width: number; readonly depth: number };
  /** How far the station has formed, 0 to 1. Cut-outs stand up one after another as it grows. */
  setForm(form: number, immediate?: boolean): void;
  readonly form: number;
  /** Brings one cut-out to the front, or none with -1. */
  setFocus(index: number, immediate?: boolean): void;
  readonly focus: number;
  /** How far cut-out `index` is up, 0 to 1. */
  upOf(index: number): number;
  /** The point above each cut-out where its floating card is anchored, in world space. */
  anchors(): Vector3[];
  /** The compass of stop 02. Null on stop 01. */
  readonly compass: CompassPart | null;
}

const DESKTOP: SceneEnvironment = { envMap: null, maxTexture: 2048, phone: false };

/** A paper station of the landing page: `altitudes` for stop 01, `carries` for stop 02. */
export function createStation(kind: StationKind, options: StationOptions = {}): StationPart {
  const environment = options.environment ?? DESKTOP;
  const phone = environment.phone;
  const seed = options.seed ?? 0;
  const [width, depth] = STATION.sheet[kind];
  const object = new Group();

  const ground = buildSheet({
    width,
    height: depth,
    standing: false,
    print: stationPrint(kind, seed),
    paper: T.paper,
    seed: seed + 1,
    warp: 0.01,
    resolution: Math.min(phone ? 130 : 177, environment.maxTexture / width),
    maxCanvas: Math.min(1400, environment.maxTexture),
  });
  ground.mesh.castShadow = false;
  ground.object.position.y = STATION.thickness;
  object.add(ground.object);

  let form = clamp01(options.form ?? 0);
  let focus = -1;
  const sheets: Sheet[] = [ground];
  const scratch = new Vector3();

  if (kind === 'altitudes') {
    const peaks = TIER_NAMES.map((tier, index) => {
      const spec = PEAKS[tier];
      const sheet = buildSheet({
        width: (spec.width / DESIGN) * STATION.peakScale,
        height: (spec.height / DESIGN) * STATION.peakScale,
        ...sheetDrawings(spec.draw, spec.width, spec.height),
        paper: spec.paper,
        soft: 0.014,
        rim: 0.42,
        sway: 0.003,
        seed: seed + 10 + index,
        resolution: resolutionFor((spec.height / DESIGN) * STATION.peakScale, phone),
      });
      const stand = createStand({ sway: 0.003, phase: index * 1.7 });
      const lean = new Group();
      stand.hinge.add(lean);
      lean.add(sheet.object);
      const holder = new Group();
      holder.position.set(-2.86 + index * 1.9, STATION.thickness, -0.62);
      holder.add(stand.hinge);
      object.add(holder);
      sheets.push(sheet);
      return { sheet, stand, lean, holder, spec, state: spring(0) };
    });

    const targetOf = (index: number) => (focus < 0 ? 0 : index === focus ? -1 : 1);
    const place = () => {
      peaks.forEach((peak, index) => {
        const up = form > STATION.start + (STATION.spread * index) / peaks.length;
        if (peak.stand.standing !== up) peak.stand.setUp(up);
        // state: -1 in focus, 0 neutral, 1 set back.
        const back = Math.max(0, peak.state.x);
        const fore = Math.max(0, -peak.state.x);
        peak.lean.rotation.x = -STATION.lean * back;
        peak.holder.position.z = -0.62 + 0.32 * fore;
        peak.sheet.material.color.setScalar(1 - (1 - STATION.dim) * back);
      });
    };
    place();

    return {
      object,
      kind,
      count: peaks.length,
      names: TIER_NAMES,
      size: { width, depth },
      setForm(next, immediate = false) {
        form = clamp01(next);
        place();
        if (immediate) for (const peak of peaks) peak.stand.setUp(peak.stand.standing, true);
      },
      get form() {
        return form;
      },
      setFocus(index, immediate = false) {
        focus = index >= 0 && index < peaks.length ? Math.round(index) : -1;
        if (immediate) {
          peaks.forEach((peak, at) => settleSpring(peak.state, targetOf(at)));
          place();
        }
      },
      get focus() {
        return focus;
      },
      upOf(index) {
        return peaks[index]?.stand.up ?? 0;
      },
      anchors() {
        object.updateWorldMatrix(true, true);
        return peaks.map((peak) => peak.lean.localToWorld(scratch.set(-0.1, (peak.spec.height / DESIGN) * STATION.peakScale + STATION.anchorLift, 0)).clone());
      },
      compass: null,
      update(frame: FrameTime) {
        peaks.forEach((peak, index) => {
          if (frame.reduced) settleSpring(peak.state, targetOf(index));
          else stepSpringKC(peak.state, targetOf(index), STATION.focus.k, STATION.focus.c, Math.min(frame.dt, STAND.maxStep));
          peak.stand.update(frame);
        });
        place();
      },
      dispose() {
        for (const sheet of sheets) sheet.dispose();
      },
    };
  }

  // Stop 02.
  const compass = createCompass({ environment, seed: `station/${seed}` });
  compass.object.position.y = STATION.thickness;
  object.add(compass.object);
  const ring = new Group();
  ring.position.y = STATION.thickness + STATION.orbit.height;
  object.add(ring);
  const cards = CARRIES.map((carry, index) => {
    const sheet = buildSheet({
      width: CARD.width / DESIGN,
      height: CARD.height / DESIGN,
      ...sheetDrawings(cardDrawing(carry), CARD.width, CARD.height),
      paper: T.paperHi,
      soft: 0.008,
      rim: 0.3,
      hinge: 0,
      warp: 0.012,
      seed: seed + 20 + index,
      resolution: phone ? 300 : 520,
    });
    // The card turns about its own middle.
    sheet.object.position.y = -CARD.height / DESIGN / 2;
    const holder = new Group();
    holder.add(sheet.object);
    ring.add(holder);
    sheets.push(sheet);
    return { sheet, holder, grown: spring(0) };
  });
  const turn: Spring = spring(0);
  let turnTarget = 0;

  const place = (t: number, reduced: boolean) => {
    cards.forEach((card, index) => {
      const angle = turn.x + index * STATION.orbit.step;
      const facing = Math.max(0, Math.cos(angle));
      const grown = clamp01(card.grown.x);
      const bob = reduced ? 0 : Math.sin(t * 0.8 + index * 1.3) * 0.018;
      card.holder.position.set(Math.sin(angle) * STATION.orbit.radius, bob, Math.cos(angle) * STATION.orbit.radius);
      // A card keeps most of its face to the viewer wherever it is on the ring, so all five can be read.
      card.holder.rotation.y = Math.sin(angle) * STATION.cardTurn;
      card.holder.scale.setScalar(Math.max(0.001, card.grown.x) * (1 + (STATION.orbit.front - 1) * facing ** 6));
      card.holder.visible = grown > 0.01;
    });
  };
  const grownTarget = (index: number) => (form > STATION.start + (STATION.spread * index) / cards.length ? 1 : 0);
  place(0, true);

  return {
    object,
    kind,
    count: cards.length,
    names: CARRIES,
    size: { width, depth },
    setForm(next, immediate = false) {
      form = clamp01(next);
      if (immediate) {
        cards.forEach((card, index) => settleSpring(card.grown, grownTarget(index)));
        place(0, true);
      }
    },
    get form() {
      return form;
    },
    setFocus(index, immediate = false) {
      focus = index >= 0 && index < cards.length ? Math.round(index) : -1;
      if (focus >= 0) {
        // Turn the ring so the card faces the viewer, by the shorter way round.
        const wanted = -focus * STATION.orbit.step;
        const full = Math.PI * 2;
        turnTarget = wanted + Math.round((turn.x - wanted) / full) * full;
      }
      if (immediate) {
        settleSpring(turn, turnTarget);
        place(0, true);
      }
    },
    get focus() {
      return focus;
    },
    upOf(index) {
      return cards[index]?.grown.x ?? 0;
    },
    anchors() {
      object.updateWorldMatrix(true, true);
      return cards.map((card) => card.holder.localToWorld(scratch.set(0, CARD.height / DESIGN / 2 + STATION.anchorLift, 0)).clone());
    },
    compass,
    update(frame: FrameTime) {
      const dt = Math.min(frame.dt, STAND.maxStep);
      cards.forEach((card, index) => {
        if (frame.reduced) settleSpring(card.grown, grownTarget(index));
        else stepSpringKC(card.grown, grownTarget(index), STAND.rise.k, STAND.rise.c, dt);
      });
      if (frame.reduced) settleSpring(turn, turnTarget);
      else stepSpringKC(turn, turnTarget, STATION.orbit.spring.k, STATION.orbit.spring.c, dt);
      compass.update(frame);
      place(frame.t, frame.reduced);
    },
    dispose() {
      for (const sheet of sheets) sheet.dispose();
      compass.dispose();
    },
  };
}

