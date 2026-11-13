import { describe, expect, it } from 'vitest';
import {
  levelHeights,
  levelIndexAt,
  pointInLevel,
  pointInRing,
  ringArea,
  ringSelfIntersects,
  traceContours,
  type ContourLevel,
  type Ring,
} from './contours';
import { TERRAIN_TEMPLATE_IDS, generateHeightfield, heightfieldFromData, type Heightfield } from './heightfield';

function fieldOf(height: (x: number, z: number) => number, resolution = 65): Heightfield {
  const data = new Float32Array(resolution * resolution);
  for (let j = 0; j < resolution; j += 1) {
    for (let i = 0; i < resolution; i += 1) {
      data[j * resolution + i] = height(-1 + (2 * i) / (resolution - 1), -1 + (2 * j) / (resolution - 1));
    }
  }
  return heightfieldFromData(resolution, data);
}

function ringsOf(level: ContourLevel): Ring[] {
  return level.polygons.flatMap((polygon) => [polygon.outer, ...polygon.holes]);
}

function expectInsideFootprint(ring: Ring): void {
  for (const point of ring) {
    expect(Math.abs(point.x)).toBeLessThanOrEqual(1 + 1e-9);
    expect(Math.abs(point.z)).toBeLessThanOrEqual(1 + 1e-9);
  }
}

describe('ring helpers', () => {
  const square: Ring = [
    { x: 0, z: 0 },
    { x: 1, z: 0 },
    { x: 1, z: 1 },
    { x: 0, z: 1 },
  ];

  it('measures signed area: counter-clockwise is positive', () => {
    expect(ringArea(square)).toBeCloseTo(1, 9);
    expect(ringArea([...square].reverse())).toBeCloseTo(-1, 9);
  });

  it('tests points against a ring', () => {
    expect(pointInRing(square, 0.5, 0.5)).toBe(true);
    expect(pointInRing(square, 1.5, 0.5)).toBe(false);
    expect(pointInRing(square, 0.5, -0.1)).toBe(false);
  });

  it('spots a ring that crosses itself', () => {
    expect(ringSelfIntersects(square)).toBe(false);
    const bow: Ring = [
      { x: 0, z: 0 },
      { x: 1, z: 1 },
      { x: 1, z: 0 },
      { x: 0, z: 1 },
    ];
    expect(ringSelfIntersects(bow)).toBe(true);
  });

  it('spaces level heights evenly from the sheet upward', () => {
    expect(levelHeights(4)).toEqual([0, 0.25, 0.5, 0.75]);
  });
});

describe('traceContours', () => {
  it('cuts a single hill into one counter-clockwise ring of the right size', () => {
    const field = fieldOf((x, z) => Math.max(0, 1 - Math.hypot(x, z)));
    const [level] = traceContours(field, [0.5]);
    expect(level?.polygons.length).toBe(1);
    const polygon = level?.polygons[0];
    expect(polygon?.holes.length).toBe(0);
    const area = ringArea(polygon?.outer ?? []);
    expect(area).toBeGreaterThan(0);
    expect(area).toBeCloseTo(Math.PI * 0.25, 1);
    expect(polygon?.area).toBeCloseTo(area, 9);
    for (const point of polygon?.outer ?? []) expect(Math.hypot(point.x, point.z)).toBeCloseTo(0.5, 1);
  });

  it('cuts a crater into an outline with one clockwise hole inside it', () => {
    const field = fieldOf((x, z) => {
      const d = Math.hypot(x, z);
      return Math.max(0, 1 - Math.abs(d - 0.5) * 3);
    });
    const [level] = traceContours(field, [0.5]);
    expect(level?.polygons.length).toBe(1);
    const polygon = level?.polygons[0];
    expect(polygon?.holes.length).toBe(1);
    const hole = polygon?.holes[0] ?? [];
    expect(ringArea(polygon?.outer ?? [])).toBeGreaterThan(0);
    expect(ringArea(hole)).toBeLessThan(0);
    for (const point of hole) expect(pointInRing(polygon?.outer ?? [], point.x, point.z)).toBe(true);
    expect(polygon?.area).toBeCloseTo(Math.PI * ((0.5 + 1 / 6) ** 2 - (0.5 - 1 / 6) ** 2), 1);
    expect(pointInLevel(level as ContourLevel, 0.5, 0)).toBe(true);
    expect(pointInLevel(level as ContourLevel, 0, 0)).toBe(false);
    expect(pointInLevel(level as ContourLevel, 0.95, 0)).toBe(false);
  });

  it('gives an island inside a crater lake its own polygon', () => {
    const field = fieldOf((x, z) => {
      const d = Math.hypot(x, z);
      return Math.max(Math.max(0, 1 - Math.abs(d - 0.6) * 4), Math.max(0, 1 - d * 4));
    }, 97);
    const [level] = traceContours(field, [0.5]);
    expect(level?.polygons.length).toBe(2);
    expect(level?.polygons[0]?.holes.length).toBe(1);
    expect(level?.polygons[1]?.holes.length).toBe(0);
    expect((level?.polygons[0]?.area ?? 0) > (level?.polygons[1]?.area ?? 0)).toBe(true);
  });

  it('closes a contour along the border when the ground is high at the edge', () => {
    // A slope that rises to the right: everything right of x = 0 is above the cut, up to the border.
    const field = fieldOf((x) => (x + 1) / 2);
    const [level] = traceContours(field, [0.5]);
    expect(level?.polygons.length).toBe(1);
    const ring = level?.polygons[0]?.outer ?? [];
    expectInsideFootprint(ring);
    expect(ringSelfIntersects(ring)).toBe(false);
    expect(ringArea(ring)).toBeGreaterThan(0);
    expect(ringArea(ring)).toBeCloseTo(2, 1);
    expect(Math.max(...ring.map((p) => p.x))).toBeCloseTo(1, 9);
    expect(Math.min(...ring.map((p) => p.x))).toBeCloseTo(0, 2);
    expect(Math.max(...ring.map((p) => p.z))).toBeCloseTo(1, 9);
    expect(Math.min(...ring.map((p) => p.z))).toBeCloseTo(-1, 9);
  });

  it('returns the whole sheet for a cut at 0', () => {
    const field = generateHeightfield({ seed: 'sheet', template: 'massif', resolution: 65 });
    const [level] = traceContours(field, [0]);
    expect(level?.polygons.length).toBe(1);
    expect(level?.polygons[0]?.holes.length).toBe(0);
    const ring = level?.polygons[0]?.outer ?? [];
    expectInsideFootprint(ring);
    expect(ringArea(ring)).toBeGreaterThan(3.98);
    expect(ringArea(ring)).toBeLessThanOrEqual(4);
    expect(ring.length).toBeLessThan(40);
  });

  it('handles ground that touches the border in several places', () => {
    const field = fieldOf((x, z) => 0.5 + 0.5 * Math.sin(x * 7) * Math.cos(z * 5), 81);
    const levels = traceContours(field, [0.3, 0.5, 0.7]);
    for (const level of levels) {
      expect(level.polygons.length).toBeGreaterThan(0);
      for (const ring of ringsOf(level)) {
        expectInsideFootprint(ring);
        expect(ring.length).toBeGreaterThanOrEqual(3);
        expect(ringSelfIntersects(ring)).toBe(false);
      }
      for (const polygon of level.polygons) {
        expect(ringArea(polygon.outer)).toBeGreaterThan(0);
        for (const hole of polygon.holes) expect(ringArea(hole)).toBeLessThan(0);
      }
    }
  });

  it('resolves a saddle without crossing rings', () => {
    const field = fieldOf((x, z) => Math.max(1 - Math.hypot(x - 0.35, z - 0.35) * 1.6, 1 - Math.hypot(x + 0.35, z + 0.35) * 1.6), 33);
    for (const height of [0.2, 0.3, 0.4, 0.45, 0.5, 0.6]) {
      const [level] = traceContours(field, [height], { simplify: 0 });
      for (const ring of ringsOf(level as ContourLevel)) expect(ringSelfIntersects(ring)).toBe(false);
    }
  });

  it('keeps every ring of every template closed, oriented, nested and free of crossings', () => {
    for (const template of TERRAIN_TEMPLATE_IDS) {
      for (const seed of ['rust', 11, 'sql']) {
        const field = generateHeightfield({ seed, template });
        const levels = traceContours(field, levelHeights(20));
        expect(levels.length).toBe(20);
        let previousArea = Infinity;
        for (const level of levels) {
          let area = 0;
          for (const polygon of level.polygons) {
            const outer = polygon.outer;
            expect(outer.length).toBeGreaterThanOrEqual(3);
            expect(ringArea(outer)).toBeGreaterThan(0);
            expect(ringSelfIntersects(outer)).toBe(false);
            expectInsideFootprint(outer);
            // Closed without repeating the first point.
            const first = outer[0];
            const last = outer[outer.length - 1];
            expect(first && last && Math.hypot(first.x - last.x, first.z - last.z) > 1e-9).toBe(true);
            for (const hole of polygon.holes) {
              expect(ringArea(hole)).toBeLessThan(0);
              expect(ringSelfIntersects(hole)).toBe(false);
              let inside = 0;
              for (const point of hole) if (pointInRing(outer, point.x, point.z)) inside += 1;
              expect(inside / hole.length).toBeGreaterThan(0.9);
            }
            expect(polygon.area).toBeGreaterThan(0);
            area += polygon.area;
          }
          // Higher cuts never have more paper than lower ones.
          expect(area).toBeLessThanOrEqual(previousArea + 1e-3);
          previousArea = area;
        }
        // The summit is on the top card, and the top card exists.
        const topLevel = levels[levels.length - 1] as ContourLevel;
        expect(topLevel.polygons.length).toBeGreaterThan(0);
        expect(levelIndexAt(levels, field.summit.x, field.summit.z)).toBe(levels.length - 1);
        expect(levelIndexAt(levels, -0.99, -0.99)).toBe(0);
      }
    }
  });

  it('is the same every time', () => {
    const field = generateHeightfield({ seed: 'again', template: 'canyon', resolution: 65 });
    expect(traceContours(field, levelHeights(10))).toEqual(traceContours(field, levelHeights(10)));
  });

  it('drops confetti and can keep it', () => {
    const field = fieldOf((x, z) => (Math.hypot(x - 0.5, z - 0.5) < 0.017 ? 1 : Math.max(0, 0.9 - Math.hypot(x + 0.2, z + 0.2))), 129);
    const [clean] = traceContours(field, [0.5]);
    const [all] = traceContours(field, [0.5], { minArea: 0 });
    expect(clean?.polygons.length).toBe(1);
    expect(all?.polygons.length).toBe(2);
  });
});
