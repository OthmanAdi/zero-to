import { heightfieldFromData, traceContours, trailPointAt, type ContourLevel, type ContourPolygon, type Heightfield, type Point2, type Trail, type TrailPoint } from '../terrain';
import { PANEL } from './fold';

/**
 * A panel of the map is a stretch of the mountain. The trail between two stops is turned so that its chord
 * runs along the panel and enlarged until the chord fills the panel, the way an old strip map keeps its road
 * straight from sheet to sheet. Nothing here touches three.js or the DOM.
 *
 * Panel coordinates: x runs from 0 at the left crease to the panel width at the right crease, z from the back
 * edge (negative) to the front edge (positive), with 0 in the middle. Uphill is always toward the back.
 */
export const STRIP = {
  /** The stops stand this far inside the creases. */
  margin: 0.32,
  /** Sideways excursions of the trail are compressed into a band this deep. */
  band: 1.4,
  /** Where the middle of that band lies on the panel. */
  routeZ: 1.05,
  /** How much the route's progress across the panel follows the distance walked instead of the chord. */
  even: 0.35,
  /** Points a panel's route is resampled to, and the half width and passes of its smoothing. */
  samples: 121,
  smoothRadius: 5,
  smoothPasses: 2,
  /** A leg that winds takes its sideways scale from this share of its walked length, when that is longer than the chord. */
  windShare: 0.55,
  /** The ground grid of a panel, across and front to back. */
  grid: { cols: 120, rows: 160 },
  phoneGrid: { cols: 80, rows: 106 },
  blurRadius: 2,
  blurPasses: 2,
} as const;

/** The card model of a panel: its window on the panel and its cards. */
export const MODEL = {
  x0: 0.13,
  x1: 4.07,
  z0: -0.67,
  z1: 2.33,
  thickness: 0.035,
  minCards: 6,
  maxCards: 20,
  /** Cards per unit of relief, where 1 is the whole height of the mountain. */
  cardsPerRelief: 40,
  /** The model starts at this share of the window's heights, so a few low spots do not flatten the rest. */
  floor: 0.12,
  /** Grid the window is cut from. */
  resolution: 97,
  phoneResolution: 65,
} as const;

export interface StripFrame {
  /** Index of the stage: the strip runs from stop `index` to stop `index + 1`. */
  readonly index: number;
  /** The two stops on the mountain, in footprint units. */
  readonly from: Point2;
  readonly to: Point2;
  /** Unit vector along the chord and the unit vector across it that points uphill. */
  readonly dir: Point2;
  readonly uphill: Point2;
  /** Length of the chord on the mountain. */
  readonly chord: number;
  /** Panel units per footprint unit, along the chord and across it. */
  readonly scale: number;
  readonly lateral: number;
  /** Panel x of the two stops and panel z of the route's middle line. */
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  /** A point of the mountain in panel coordinates, by the rigid frame: turned and enlarged, nothing else. */
  toPanel(x: number, z: number): Point2;
  /** The inverse of `toPanel`. */
  toMountain(x: number, z: number): Point2;
}

function legOf(trail: Trail, index: number): { from: TrailPoint; to: TrailPoint } {
  const stops = trail.stops;
  const last = Math.max(1, stops.length - 1);
  const i = Math.min(last - 1, Math.max(0, Math.round(index)));
  return { from: stops[i] as TrailPoint, to: stops[i + 1] as TrailPoint };
}

/** The points of the trail between two shares of it, ends included. */
function legPoints(trail: Trail, fromAlong: number, toAlong: number): TrailPoint[] {
  const points: TrailPoint[] = [trailPointAt(trail, fromAlong)];
  for (const point of trail.points) if (point.along > fromAlong + 1e-9 && point.along < toAlong - 1e-9) points.push(point);
  points.push(trailPointAt(trail, toAlong));
  return points;
}

/**
 * The frame of stage `index`: stop `index` goes to the left end of the panel and stop `index + 1` to the right
 * end, each 0.32 inside its crease. The side of the chord on which the summit lies is turned to the back.
 */
export function stripFrame(trail: Trail, index: number): StripFrame {
  const { from, to } = legOf(trail, index);
  const span = PANEL.width - 2 * STRIP.margin;
  let dx = to.x - from.x;
  let dz = to.z - from.z;
  let chord = Math.hypot(dx, dz);
  const points = legPoints(trail, from.along, to.along);
  if (chord < 1e-5) {
    // Two stops on one spot: take the direction of the point of the leg that is farthest from them.
    let far = 0;
    for (const point of points) {
      const d = Math.hypot(point.x - from.x, point.z - from.z);
      if (d > far) {
        far = d;
        dx = point.x - from.x;
        dz = point.z - from.z;
      }
    }
    if (far < 1e-5) {
      dx = 1;
      dz = 0;
    }
    chord = Math.max(far, 1e-5);
  }
  const length = Math.hypot(dx, dz) || 1;
  const dir = { x: dx / length, z: dz / length };

  let walked = 0;
  for (let k = 1; k < points.length; k += 1) {
    walked += Math.hypot((points[k] as TrailPoint).x - (points[k - 1] as TrailPoint).x, (points[k] as TrailPoint).z - (points[k - 1] as TrailPoint).z);
  }
  const scale = span / chord;
  const lateral = span / Math.max(chord, walked * STRIP.windShare);

  // Uphill is the side of the chord the summit lies on. On the last leg the summit is on the chord itself:
  // there the side is the one the leg bulges away from, which is where the mountain is.
  const summit = trail.points[trail.points.length - 1] as TrailPoint;
  let nx = -dir.z;
  let nz = dir.x;
  let side = (summit.x - from.x) * nx + (summit.z - from.z) * nz;
  if (Math.abs(side) < 1e-4) {
    let bulge = 0;
    for (const point of points) bulge += (point.x - from.x) * nx + (point.z - from.z) * nz;
    side = -bulge;
  }
  if (side < 0) {
    nx = -nx;
    nz = -nz;
  }
  const uphill = { x: nx, z: nz };
  const x0 = STRIP.margin;

  return {
    index: Math.max(0, Math.round(index)),
    from: { x: from.x, z: from.z },
    to: { x: to.x, z: to.z },
    dir,
    uphill,
    chord,
    scale,
    lateral,
    x0,
    x1: x0 + span,
    z0: STRIP.routeZ,
    toPanel(x, z) {
      const px = x - from.x;
      const pz = z - from.z;
      return { x: x0 + scale * (px * dir.x + pz * dir.z), z: STRIP.routeZ - lateral * (px * uphill.x + pz * uphill.z) };
    },
    toMountain(x, z) {
      const a = (x - x0) / scale;
      const b = (STRIP.routeZ - z) / lateral;
      return { x: from.x + dir.x * a + uphill.x * b, z: from.z + dir.z * a + uphill.z * b };
    },
  };
}

export interface StripPoint {
  /** Panel coordinates. */
  readonly x: number;
  readonly z: number;
  /** The same point on the mountain, in footprint units. */
  readonly mx: number;
  readonly mz: number;
  /** Ground height on the mountain, 0 to 1. */
  readonly h: number;
  /** Share of the leg walked to reach the point, 0 at the first stop and 1 at the camp. */
  readonly t: number;
  /** Share of the whole trail. */
  readonly along: number;
  /** Length of the drawn route from the first stop to here, in panel units. */
  readonly s: number;
}

export interface StripRoute {
  readonly frame: StripFrame;
  readonly points: readonly StripPoint[];
  /** Length of the drawn route on the panel, from stop to stop. */
  readonly length: number;
}

function smoothSeries(values: number[], radius: number, passes: number): number[] {
  let current = values;
  for (let pass = 0; pass < passes; pass += 1) {
    const next = new Array<number>(current.length);
    for (let i = 0; i < current.length; i += 1) {
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) sum += current[Math.min(current.length - 1, Math.max(0, i + k))] as number;
      next[i] = sum / (2 * radius + 1);
    }
    current = next;
  }
  return current;
}

/**
 * The route of stage `index` on its panel.
 *
 * A trail that zigzags or winds round the mountain would fold back on itself in a straight strip. So the route
 * is laid out in two steps. Across the panel it advances with the chord, but never backwards, and a share of
 * its advance follows the distance walked, so it always moves on. Sideways it keeps its real excursions up to
 * a point and is compressed beyond that, into a band 1.4 deep. Both are smoothed, so hairpins read as bends.
 * The route starts and ends on the middle line of the band, where it meets the routes of the next panels.
 */
export function stripRoute(trail: Trail, index: number, frame: StripFrame = stripFrame(trail, index)): StripRoute {
  const { from, to } = legOf(trail, index);
  const raw = legPoints(trail, from.along, to.along);
  const cumulative = [0];
  for (let k = 1; k < raw.length; k += 1) {
    const a = raw[k - 1] as TrailPoint;
    const b = raw[k] as TrailPoint;
    cumulative.push((cumulative[k - 1] as number) + Math.hypot(b.x - a.x, b.z - a.z));
  }
  const walked = cumulative[cumulative.length - 1] as number;

  // Evenly spaced along the leg.
  const count = STRIP.samples;
  const leg: { x: number; z: number; h: number; along: number; t: number }[] = [];
  let cursor = 0;
  for (let j = 0; j < count; j += 1) {
    const t = j / (count - 1);
    const target = t * walked;
    while (cursor < raw.length - 2 && (cumulative[cursor + 1] as number) < target) cursor += 1;
    const a = raw[cursor] as TrailPoint;
    const b = raw[Math.min(raw.length - 1, cursor + 1)] as TrailPoint;
    const span = (cumulative[Math.min(raw.length - 1, cursor + 1)] as number) - (cumulative[cursor] as number);
    const w = span > 1e-12 ? Math.min(1, Math.max(0, (target - (cumulative[cursor] as number)) / span)) : 0;
    leg.push({ x: a.x + (b.x - a.x) * w, z: a.z + (b.z - a.z) * w, h: a.h + (b.h - a.h) * w, along: a.along + (b.along - a.along) * w, t });
  }

  // Across the panel: the chord, never backwards, with a share of even progress.
  const half = STRIP.band / 2;
  let reached = 0;
  const advance: number[] = [];
  const sideways: number[] = [];
  for (const point of leg) {
    const px = point.x - frame.from.x;
    const pz = point.z - frame.from.z;
    const u = Math.min(1, Math.max(0, (px * frame.dir.x + pz * frame.dir.z) / frame.chord));
    reached = Math.max(reached, u);
    advance.push((1 - STRIP.even) * reached + STRIP.even * point.t);
    const v = frame.lateral * (px * frame.uphill.x + pz * frame.uphill.z);
    sideways.push(half * Math.tanh(v / half));
  }
  const g = smoothSeries(advance, STRIP.smoothRadius, STRIP.smoothPasses);
  const s = smoothSeries(sideways, STRIP.smoothRadius, STRIP.smoothPasses);
  // Pin the ends: smoothing has moved them a little.
  const g0 = g[0] as number;
  const g1 = g[g.length - 1] as number;
  const s0 = s[0] as number;
  const s1 = s[s.length - 1] as number;
  const span = frame.x1 - frame.x0;

  const points: StripPoint[] = [];
  let length = 0;
  for (let j = 0; j < count; j += 1) {
    const point = leg[j] as (typeof leg)[number];
    const across = ((g[j] as number) - g0) / Math.max(1e-9, g1 - g0);
    const offset = Math.min(half, Math.max(-half, (s[j] as number) - (s0 + (s1 - s0) * point.t)));
    const x = frame.x0 + span * across;
    const z = frame.z0 - offset;
    const previous = points[points.length - 1];
    if (previous) length += Math.hypot(x - previous.x, z - previous.z);
    points.push({ x, z, mx: point.x, mz: point.z, h: point.h, t: point.t, along: point.along, s: length });
  }
  return { frame, points, length };
}

/** The point of a panel's route at share `t` of its leg, 0 at the first stop and 1 at the camp. */
export function stripPointAt(route: StripRoute, t: number): StripPoint {
  const points = route.points;
  const last = points.length - 1;
  const at = Math.min(1, Math.max(0, t)) * last;
  const i = Math.min(last - 1, Math.floor(at));
  const w = at - i;
  const a = points[i] as StripPoint;
  const b = points[i + 1] as StripPoint;
  const mix = (p: number, q: number): number => p + (q - p) * w;
  return { x: mix(a.x, b.x), z: mix(a.z, b.z), mx: mix(a.mx, b.mx), mz: mix(a.mz, b.mz), h: mix(a.h, b.h), t: mix(a.t, b.t), along: mix(a.along, b.along), s: mix(a.s, b.s) };
}

/** The route's own point above panel x: where it is on the mountain and where its line runs on the panel. */
function routeAcross(route: StripRoute, x: number): { mx: number; mz: number; z: number } {
  const { frame, points } = route;
  const first = points[0] as StripPoint;
  const final = points[points.length - 1] as StripPoint;
  if (x <= first.x) {
    const back = (x - first.x) / frame.scale;
    return { mx: first.mx + frame.dir.x * back, mz: first.mz + frame.dir.z * back, z: first.z };
  }
  if (x >= final.x) {
    const on = (x - final.x) / frame.scale;
    return { mx: final.mx + frame.dir.x * on, mz: final.mz + frame.dir.z * on, z: final.z };
  }
  let low = 0;
  let high = points.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if ((points[middle] as StripPoint).x <= x) low = middle;
    else high = middle;
  }
  const a = points[low] as StripPoint;
  const b = points[high] as StripPoint;
  const w = b.x > a.x ? (x - a.x) / (b.x - a.x) : 0;
  return { mx: a.mx + (b.mx - a.mx) * w, mz: a.mz + (b.mz - a.mz) * w, z: a.z + (b.z - a.z) * w };
}

/**
 * The point of the mountain that lies under a point of the panel. Under the route it is the trail itself, so
 * the ground a learner walks on is the ground of the mountain. Beside the route the mountain is read off
 * across the chord, at the panel's sideways scale.
 */
export function mountainUnder(route: StripRoute, x: number, z: number): Point2 {
  const on = routeAcross(route, x);
  const off = (on.z - z) / route.frame.lateral;
  return { x: on.mx + route.frame.uphill.x * off, z: on.mz + route.frame.uphill.z * off };
}

export interface StripGround {
  readonly cols: number;
  readonly rows: number;
  /** Heights 0 to 1, row by row from the back edge to the front, each row from the left crease to the right. */
  readonly data: Float32Array;
  readonly min: number;
  readonly max: number;
  /** Height at a point of the panel, bilinear. */
  sample(x: number, z: number): number;
}

function boxBlur(data: Float32Array, cols: number, rows: number, radius: number): void {
  const scratch = new Float32Array(data.length);
  const window = radius * 2 + 1;
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) sum += data[j * cols + Math.min(cols - 1, Math.max(0, i + k))] as number;
      scratch[j * cols + i] = sum / window;
    }
  }
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) sum += scratch[Math.min(rows - 1, Math.max(0, j + k)) * cols + i] as number;
      data[j * cols + i] = sum / window;
    }
  }
}

/** The ground of a whole panel: the mountain under it, resampled to a grid and blurred so cards cut cleanly. */
export function stripGround(field: Pick<Heightfield, 'sample'>, route: StripRoute, phone = false): StripGround {
  const { cols, rows } = phone ? STRIP.phoneGrid : STRIP.grid;
  const data = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j += 1) {
    const z = -PANEL.depth / 2 + (j / (rows - 1)) * PANEL.depth;
    for (let i = 0; i < cols; i += 1) {
      const x = (i / (cols - 1)) * PANEL.width;
      const m = mountainUnder(route, x, z);
      data[j * cols + i] = field.sample(m.x, m.z);
    }
  }
  for (let pass = 0; pass < STRIP.blurPasses; pass += 1) boxBlur(data, cols, rows, STRIP.blurRadius);
  let min = Infinity;
  let max = -Infinity;
  for (const value of data) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const sample = (x: number, z: number): number => {
    const fx = Math.min(1, Math.max(0, x / PANEL.width)) * (cols - 1);
    const fz = Math.min(1, Math.max(0, (z + PANEL.depth / 2) / PANEL.depth)) * (rows - 1);
    const i0 = Math.min(cols - 2, Math.floor(fx));
    const j0 = Math.min(rows - 2, Math.floor(fz));
    const tx = fx - i0;
    const tz = fz - j0;
    const a = data[j0 * cols + i0] as number;
    const b = data[j0 * cols + i0 + 1] as number;
    const c = data[(j0 + 1) * cols + i0] as number;
    const d = data[(j0 + 1) * cols + i0 + 1] as number;
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  };
  return { cols, rows, data, min, max, sample };
}

export interface StripCards {
  /** Number of cards, 6 to 20. */
  readonly count: number;
  /** The paper shapes in panel coordinates, bottom card first. Card 0 is the whole window. */
  readonly levels: readonly ContourLevel[];
  /** The height on the mountain at which each card is cut. Card 0 has the floor. */
  readonly heights: readonly number[];
  /** Height of the floor and of one step, 0 to 1 of the mountain. */
  readonly floor: number;
  readonly step: number;
  /** The card a point of the panel lies on, or -1 outside the model's window. */
  cardAt(x: number, z: number): number;
}

function rectangle(x0: number, z0: number, x1: number, z1: number): ContourPolygon {
  // Counter-clockwise with x to the right and z upward, as every outer ring is.
  const outer = [
    { x: x0, z: z0 },
    { x: x1, z: z0 },
    { x: x1, z: z1 },
    { x: x0, z: z1 },
  ];
  return { outer, holes: [], area: (x1 - x0) * (z1 - z0), bounds: { minX: x0, minZ: z0, maxX: x1, maxZ: z1 } };
}

/**
 * Cuts the card model of a panel out of its ground. The relief inside the model's window decides how many
 * cards there are: 6 on nearly level ground, up to 20 on a steep stretch.
 */
export function stripCards(ground: StripGround, phone = false): StripCards {
  const resolution = phone ? MODEL.phoneResolution : MODEL.resolution;
  const data = new Float32Array(resolution * resolution);
  const sorted: number[] = [];
  for (let j = 0; j < resolution; j += 1) {
    const z = MODEL.z0 + (j / (resolution - 1)) * (MODEL.z1 - MODEL.z0);
    for (let i = 0; i < resolution; i += 1) {
      const x = MODEL.x0 + (i / (resolution - 1)) * (MODEL.x1 - MODEL.x0);
      const h = ground.sample(x, z);
      data[j * resolution + i] = h;
      sorted.push(h);
    }
  }
  sorted.sort((a, b) => a - b);
  const floor = sorted[Math.floor((sorted.length - 1) * MODEL.floor)] as number;
  const top = sorted[sorted.length - 1] as number;
  const relief = Math.max(0, top - floor);
  const count = Math.min(MODEL.maxCards, Math.max(MODEL.minCards, Math.round(MODEL.minCards + relief * MODEL.cardsPerRelief)));
  const step = relief > 1e-6 ? relief / count : 1;
  const heights = Array.from({ length: count }, (_, k) => floor + k * step);

  const field = heightfieldFromData(resolution, data);
  const traced = traceContours(field, heights.slice(1), { smooth: 2, simplify: phone ? 0.006 : 0.004, minArea: 0.0016 });
  const sx = (MODEL.x1 - MODEL.x0) / 2;
  const sz = (MODEL.z1 - MODEL.z0) / 2;
  const place = (p: Point2): Point2 => ({ x: MODEL.x0 + (Math.min(1, Math.max(-1, p.x)) + 1) * sx, z: MODEL.z0 + (Math.min(1, Math.max(-1, p.z)) + 1) * sz });
  const levels: ContourLevel[] = [{ index: 0, height: floor, polygons: [rectangle(MODEL.x0, MODEL.z0, MODEL.x1, MODEL.z1)] }];
  traced.forEach((level, k) => {
    const polygons = level.polygons.map((polygon): ContourPolygon => {
      const outer = polygon.outer.map(place);
      const holes = polygon.holes.map((hole) => hole.map(place));
      let minX = Infinity;
      let minZ = Infinity;
      let maxX = -Infinity;
      let maxZ = -Infinity;
      for (const p of outer) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.z < minZ) minZ = p.z;
        if (p.z > maxZ) maxZ = p.z;
      }
      return { outer, holes, area: polygon.area * sx * sz, bounds: { minX, minZ, maxX, maxZ } };
    });
    levels.push({ index: k + 1, height: level.height, polygons });
  });

  const inRing = (ring: readonly Point2[], x: number, z: number): boolean => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const a = ring[i] as Point2;
      const b = ring[j] as Point2;
      if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
    }
    return inside;
  };
  const inLevel = (level: ContourLevel, x: number, z: number): boolean => {
    for (const polygon of level.polygons) {
      const { bounds } = polygon;
      if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) continue;
      if (!inRing(polygon.outer, x, z)) continue;
      if (polygon.holes.some((hole) => inRing(hole, x, z))) continue;
      return true;
    }
    return false;
  };

  return {
    count,
    levels,
    heights,
    floor,
    step,
    cardAt(x, z) {
      if (x < MODEL.x0 || x > MODEL.x1 || z < MODEL.z0 || z > MODEL.z1) return -1;
      // A card lies only on the card below it, so the search can stop at the first level that misses.
      const guess = Math.min(count - 1, Math.max(0, Math.floor((ground.sample(x, z) - floor) / step)));
      let card = Math.min(count - 1, guess + 2);
      while (card > 0 && !inLevel(levels[card] as ContourLevel, x, z)) card -= 1;
      return card;
    },
  };
}
