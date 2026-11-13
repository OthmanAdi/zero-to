import type { Heightfield } from './heightfield';

export interface Point2 {
  readonly x: number;
  readonly z: number;
}

/**
 * A closed loop of points. The last point joins the first; it is not repeated.
 *
 * Orientation is measured with x to the right and z upward on the page: an outer ring runs counter-clockwise
 * (positive `ringArea`), a hole runs clockwise (negative).
 */
export type Ring = Point2[];

/** One piece of paper: an outline and the holes cut out of it. */
export interface ContourPolygon {
  readonly outer: Ring;
  readonly holes: Ring[];
  /** Paper area: the outline minus its holes. */
  readonly area: number;
  readonly bounds: { readonly minX: number; readonly minZ: number; readonly maxX: number; readonly maxZ: number };
}

/** Everything at or above one height. */
export interface ContourLevel {
  /** Position in the list of levels that was traced. */
  readonly index: number;
  /** The height of the cut, 0..1. */
  readonly height: number;
  /** Largest piece first. */
  readonly polygons: ContourPolygon[];
}

export interface ContourOptions {
  /** Chaikin corner-cutting passes. Default 2. */
  readonly smooth?: number;
  /** Largest distance a simplified ring may stray from the smoothed one. Default 0.003. */
  readonly simplify?: number;
  /** Rings with less area than this are dropped as confetti. Default 0.0012. */
  readonly minArea?: number;
}

/** Signed area of a ring: positive for counter-clockwise (x right, z up). */
export function ringArea(ring: readonly Point2[]): number {
  let twice = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i] as Point2;
    const b = ring[(i + 1) % ring.length] as Point2;
    twice += a.x * b.z - b.x * a.z;
  }
  return twice / 2;
}

/** Even-odd test. Points exactly on the outline may fall either way. */
export function pointInRing(ring: readonly Point2[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i] as Point2;
    const b = ring[j] as Point2;
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(polygon: ContourPolygon, x: number, z: number): boolean {
  const { bounds } = polygon;
  if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) return false;
  if (!pointInRing(polygon.outer, x, z)) return false;
  for (const hole of polygon.holes) if (pointInRing(hole, x, z)) return false;
  return true;
}

export function pointInLevel(level: ContourLevel, x: number, z: number): boolean {
  for (const polygon of level.polygons) if (pointInPolygon(polygon, x, z)) return true;
  return false;
}

/** The highest level whose paper covers the point, or -1 when none does. Levels must be sorted from low to high. */
export function levelIndexAt(levels: readonly ContourLevel[], x: number, z: number): number {
  for (let index = levels.length - 1; index >= 0; index -= 1) {
    if (pointInLevel(levels[index] as ContourLevel, x, z)) return index;
  }
  return -1;
}

function segmentsCross(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const side = (p: Point2, q: Point2, r: Point2): number => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  const d1 = side(c, d, a);
  const d2 = side(c, d, b);
  const d3 = side(a, b, c);
  const d4 = side(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** True when two edges of the ring that are not neighbours cross each other. */
export function ringSelfIntersects(ring: readonly Point2[]): boolean {
  const count = ring.length;
  if (count < 4) return false;
  for (let i = 0; i < count; i += 1) {
    const a = ring[i] as Point2;
    const b = ring[(i + 1) % count] as Point2;
    for (let j = i + 2; j < count; j += 1) {
      if (i === 0 && j === count - 1) continue;
      if (segmentsCross(a, b, ring[j] as Point2, ring[(j + 1) % count] as Point2)) return true;
    }
  }
  return false;
}

/** One Chaikin pass on a closed ring: every corner is cut at a quarter and three quarters of its edges. */
function chaikin(ring: readonly Point2[]): Ring {
  const out: Ring = [];
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i] as Point2;
    const b = ring[(i + 1) % ring.length] as Point2;
    out.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 });
    out.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
  }
  return out;
}

function distanceToSegment(p: Point2, a: Point2, b: Point2): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length2 = dx * dx + dz * dz;
  const t = length2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.z - a.z) * dz) / length2)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}

/** Douglas-Peucker on an open run of points. Marks the points to keep. */
function markKept(points: readonly Point2[], first: number, last: number, tolerance: number, keep: Uint8Array): void {
  const stack: number[] = [first, last];
  while (stack.length > 0) {
    const end = stack.pop() as number;
    const start = stack.pop() as number;
    let worst = 0;
    let worstIndex = -1;
    const a = points[start] as Point2;
    const b = points[end] as Point2;
    for (let i = start + 1; i < end; i += 1) {
      const d = distanceToSegment(points[i] as Point2, a, b);
      if (d > worst) {
        worst = d;
        worstIndex = i;
      }
    }
    if (worstIndex >= 0 && worst > tolerance) {
      keep[worstIndex] = 1;
      stack.push(start, worstIndex, worstIndex, end);
    }
  }
}

/** Simplifies a closed ring. The ring is split at two far-apart anchors, and each half is simplified as a line. */
function simplifyRing(ring: readonly Point2[], tolerance: number): Ring {
  if (tolerance <= 0 || ring.length <= 8) return ring.slice();
  const first = ring[0] as Point2;
  let far = 0;
  let farDistance = -1;
  for (let i = 1; i < ring.length; i += 1) {
    const p = ring[i] as Point2;
    const d = (p.x - first.x) ** 2 + (p.z - first.z) ** 2;
    if (d > farDistance) {
      farDistance = d;
      far = i;
    }
  }
  const open = [...ring, first];
  const keep = new Uint8Array(open.length);
  keep[0] = 1;
  keep[far] = 1;
  keep[open.length - 1] = 1;
  markKept(open, 0, far, tolerance, keep);
  markKept(open, far, open.length - 1, tolerance, keep);
  const out: Ring = [];
  for (let i = 0; i < ring.length; i += 1) if (keep[i] === 1) out.push(ring[i] as Point2);
  return out;
}

function withoutRepeats(ring: readonly Point2[]): Ring {
  const out: Ring = [];
  for (const point of ring) {
    const previous = out[out.length - 1];
    if (previous && Math.abs(previous.x - point.x) < 1e-9 && Math.abs(previous.z - point.z) < 1e-9) continue;
    out.push(point);
  }
  while (out.length > 1) {
    const a = out[0] as Point2;
    const b = out[out.length - 1] as Point2;
    if (Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.z - b.z) < 1e-9) out.pop();
    else break;
  }
  return out;
}

/**
 * Raw rings of one level from marching squares.
 *
 * The grid is padded by one ring of nodes that lie below every level, so each contour closes along the border of
 * the footprint instead of ending there. A crossing on an edge that leads into the padding is placed on the border
 * node itself. Walking a ring keeps the high ground on the left, which makes outer rings counter-clockwise and
 * holes clockwise without any further work.
 */
function marchLevel(field: Heightfield, height: number): Ring[] {
  const n = field.resolution;
  const width = n + 2;
  const data = field.data;
  const inside = new Uint8Array(width * width);
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      if ((data[j * n + i] as number) >= height) inside[(j + 1) * width + i + 1] = 1;
    }
  }

  // next[k] is the edge a contour reaches after leaving edge k. Even keys are edges along x, odd keys along z.
  const next = new Int32Array(2 * width * width).fill(-1);
  for (let pj = 0; pj < width - 1; pj += 1) {
    for (let pi = 0; pi < width - 1; pi += 1) {
      const node = pj * width + pi;
      const a = inside[node] as number;
      const b = inside[node + 1] as number;
      const c = inside[node + width + 1] as number;
      const d = inside[node + width] as number;
      const code = a | (b << 1) | (c << 2) | (d << 3);
      if (code === 0 || code === 15) continue;
      const bottom = 2 * node;
      const top = 2 * (node + width);
      const left = 2 * node + 1;
      const right = 2 * (node + 1) + 1;
      switch (code) {
        case 1:
          next[bottom] = left;
          break;
        case 2:
          next[right] = bottom;
          break;
        case 3:
          next[right] = left;
          break;
        case 4:
          next[top] = right;
          break;
        case 6:
          next[top] = bottom;
          break;
        case 7:
          next[top] = left;
          break;
        case 8:
          next[left] = top;
          break;
        case 9:
          next[bottom] = top;
          break;
        case 11:
          next[right] = top;
          break;
        case 12:
          next[left] = right;
          break;
        case 13:
          next[bottom] = right;
          break;
        case 14:
          next[left] = bottom;
          break;
        default: {
          // A saddle: two opposite corners are high. The mean of the cell decides whether they are joined.
          const real = pi >= 1 && pj >= 1 && pi < n && pj < n;
          const mean = real
            ? ((data[(pj - 1) * n + pi - 1] as number) +
                (data[(pj - 1) * n + pi] as number) +
                (data[pj * n + pi - 1] as number) +
                (data[pj * n + pi] as number)) /
              4
            : -Infinity;
          const joined = mean >= height;
          if (code === 5) {
            if (joined) {
              next[bottom] = right;
              next[top] = left;
            } else {
              next[bottom] = left;
              next[top] = right;
            }
          } else if (joined) {
            next[left] = bottom;
            next[right] = top;
          } else {
            next[right] = bottom;
            next[left] = top;
          }
        }
      }
    }
  }

  const last = n - 1;
  const value = (pi: number, pj: number): number =>
    pi < 1 || pj < 1 || pi > n || pj > n ? -Infinity : (data[(pj - 1) * n + pi - 1] as number);
  const pointOf = (key: number): Point2 => {
    const node = key >> 1;
    const pi = node % width;
    const pj = (node - pi) / width;
    const alongZ = (key & 1) === 1;
    const v0 = value(pi, pj);
    const v1 = alongZ ? value(pi, pj + 1) : value(pi + 1, pj);
    let t: number;
    if (v0 === -Infinity) t = 1;
    else if (v1 === -Infinity) t = 0;
    else t = Math.min(1 - 1e-4, Math.max(1e-4, (height - v0) / (v1 - v0)));
    const gi = pi - 1 + (alongZ ? 0 : t);
    const gj = pj - 1 + (alongZ ? t : 0);
    return { x: -1 + (2 * gi) / last, z: -1 + (2 * gj) / last };
  };

  const rings: Ring[] = [];
  for (let start = 0; start < next.length; start += 1) {
    if ((next[start] as number) < 0) continue;
    const ring: Ring = [];
    let key = start;
    let guard = next.length;
    while (key >= 0 && (next[key] as number) >= 0 && guard > 0) {
      ring.push(pointOf(key));
      const following = next[key] as number;
      next[key] = -1;
      key = following;
      guard -= 1;
    }
    rings.push(ring);
  }
  return rings;
}

function boundsOf(ring: readonly Point2[]): ContourPolygon['bounds'] {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const p of ring) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { minX, minZ, maxX, maxZ };
}

/**
 * Cuts the heightfield at each level and returns the paper shapes: closed, smoothed and simplified rings, with every
 * hole attached to the outline it lies in.
 */
export function traceContours(field: Heightfield, levels: readonly number[], options: ContourOptions = {}): ContourLevel[] {
  const passes = Math.max(0, Math.round(options.smooth ?? 2));
  const tolerance = Math.max(0, options.simplify ?? 0.003);
  const minArea = Math.max(0, options.minArea ?? 0.0012);

  return levels.map((height, index) => {
    const outers: Ring[] = [];
    const holes: Ring[] = [];
    for (const raw of marchLevel(field, height)) {
      let smooth = withoutRepeats(raw);
      if (smooth.length < 3) continue;
      for (let pass = 0; pass < passes; pass += 1) smooth = chaikin(smooth);
      // Simplifying can, in a narrow neck, pull two edges across each other. Back off until it does not.
      let ring = simplifyRing(smooth, tolerance);
      for (let attempt = 1; attempt <= 3 && ringSelfIntersects(ring); attempt += 1) {
        ring = attempt === 3 ? smooth : simplifyRing(smooth, tolerance / 4 ** attempt);
      }
      if (ring.length < 3) continue;
      const area = ringArea(ring);
      if (Math.abs(area) < minArea) continue;
      if (area > 0) outers.push(ring);
      else holes.push(ring);
    }

    const pieces = outers
      .map((outer) => ({ outer, holes: [] as Ring[], outerArea: ringArea(outer) }))
      .sort((a, b) => a.outerArea - b.outerArea);
    for (const hole of holes) {
      const probe = hole[0] as Point2;
      // Smallest outline first, so a hole inside an island inside a lake goes to the island.
      const owner = pieces.find((piece) => piece.outerArea > -ringArea(hole) && pointInRing(piece.outer, probe.x, probe.z));
      if (owner) owner.holes.push(hole);
    }

    const polygons: ContourPolygon[] = pieces
      .map((piece) => ({
        outer: piece.outer,
        holes: piece.holes,
        area: piece.outerArea + piece.holes.reduce((sum, hole) => sum + ringArea(hole), 0),
        bounds: boundsOf(piece.outer),
      }))
      .sort((a, b) => b.area - a.area);

    return { index, height, polygons };
  });
}

/** Evenly spaced cut heights for a stack of `count` cards: 0, 1/count, 2/count and so on. The first is the sheet itself. */
export function levelHeights(count: number): number[] {
  const cards = Math.max(1, Math.round(count));
  return Array.from({ length: cards }, (_, index) => index / cards);
}
