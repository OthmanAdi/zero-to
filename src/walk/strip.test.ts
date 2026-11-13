import { describe, expect, it } from 'vitest';
import { TERRAIN_TEMPLATE_IDS, TRAIL_TEMPLATE_IDS, generateHeightfield, planTrail, type Heightfield, type Trail } from '../terrain';
import { PANEL } from './fold';
import { MODEL, STRIP, mountainUnder, stripCards, stripFrame, stripGround, stripPointAt, stripRoute } from './strip';

function mountain(terrain: (typeof TERRAIN_TEMPLATE_IDS)[number], trail: (typeof TRAIL_TEMPLATE_IDS)[number], stages: number, seed = 'strip-test'): { field: Heightfield; trail: Trail } {
  const field = generateHeightfield({ seed, template: terrain, resolution: 65 });
  const heights = Array.from({ length: stages + 1 }, (_, index) => 0.08 + (0.92 * index) / stages);
  return { field, trail: planTrail(field, { seed, template: trail, stops: stages + 1, stopHeights: heights }) };
}

describe('stripFrame', () => {
  it('maps stop i and stop i + 1 to the two ends of the panel', () => {
    for (const template of TRAIL_TEMPLATE_IDS) {
      const { trail } = mountain('massif', template, 5);
      for (let index = 0; index < 5; index += 1) {
        const frame = stripFrame(trail, index);
        const from = trail.stops[index] as { x: number; z: number };
        const to = trail.stops[index + 1] as { x: number; z: number };
        const a = frame.toPanel(from.x, from.z);
        const b = frame.toPanel(to.x, to.z);
        expect(a.x).toBeCloseTo(STRIP.margin, 9);
        expect(a.z).toBeCloseTo(STRIP.routeZ, 9);
        expect(b.x).toBeCloseTo(PANEL.width - STRIP.margin, 9);
        expect(b.z).toBeCloseTo(STRIP.routeZ, 9);
        // The frame only turns and enlarges: it comes back to where it started.
        const back = frame.toMountain(b.x, b.z);
        expect(back.x).toBeCloseTo(to.x, 9);
        expect(back.z).toBeCloseTo(to.z, 9);
        expect(Math.hypot(frame.dir.x, frame.dir.z)).toBeCloseTo(1, 9);
        expect(frame.dir.x * frame.uphill.x + frame.dir.z * frame.uphill.z).toBeCloseTo(0, 9);
      }
    }
  });

  it('turns the side of the summit to the back of the panel', () => {
    const { trail } = mountain('volcano', 'spiral', 5);
    const summit = trail.points[trail.points.length - 1] as { x: number; z: number };
    for (let index = 0; index < 4; index += 1) {
      const frame = stripFrame(trail, index);
      expect(frame.toPanel(summit.x, summit.z).z).toBeLessThanOrEqual(STRIP.routeZ + 1e-6);
    }
  });
});

describe('stripRoute', () => {
  it('stays inside its panel and runs from left to right, for every terrain and trail with 2, 5 and 8 stages', () => {
    const half = STRIP.band / 2;
    for (const terrain of TERRAIN_TEMPLATE_IDS) {
      for (const template of TRAIL_TEMPLATE_IDS) {
        for (const stages of [2, 5, 8]) {
          const { trail } = mountain(terrain, template, stages, `${terrain}-${template}`);
          expect(trail.stops).toHaveLength(stages + 1);
          for (let index = 0; index < stages; index += 1) {
            const route = stripRoute(trail, index);
            const label = `${terrain}/${template}/${stages} stage ${index}`;
            const points = route.points;
            expect(points, label).toHaveLength(STRIP.samples);
            expect((points[0] as { x: number }).x, label).toBeCloseTo(STRIP.margin, 9);
            expect((points[0] as { z: number }).z, label).toBeCloseTo(STRIP.routeZ, 9);
            expect((points[points.length - 1] as { x: number }).x, label).toBeCloseTo(PANEL.width - STRIP.margin, 9);
            expect((points[points.length - 1] as { z: number }).z, label).toBeCloseTo(STRIP.routeZ, 9);
            let steepest = 0;
            const problems: string[] = [];
            for (let k = 0; k < points.length; k += 1) {
              const point = points[k] as { x: number; z: number; s: number };
              if (!Number.isFinite(point.x) || !Number.isFinite(point.z)) problems.push(`${k}: not a number`);
              if (point.x < STRIP.margin - 1e-9 || point.x > PANEL.width - STRIP.margin + 1e-9) problems.push(`${k}: x ${point.x} outside the panel`);
              if (Math.abs(point.z - STRIP.routeZ) > half + 1e-9) problems.push(`${k}: z ${point.z} outside the band`);
              if (point.z <= MODEL.z0 || point.z >= MODEL.z1) problems.push(`${k}: z ${point.z} outside the model`);
              if (k > 0) {
                const before = points[k - 1] as { x: number; z: number; s: number };
                // Monotonic after smoothing: every step moves to the right.
                if (!(point.x > before.x)) problems.push(`${k}: x does not advance`);
                if (!(point.s > before.s)) problems.push(`${k}: length does not grow`);
                steepest = Math.max(steepest, Math.abs(point.z - before.z) / (point.x - before.x));
              }
            }
            expect(problems, label).toEqual([]);
            // No hairpin survives as a vertical stroke: the route reads as a line across the panel.
            expect(steepest, label).toBeLessThan(12);
            expect(route.length, label).toBeGreaterThanOrEqual(PANEL.width - 2 * STRIP.margin - 1e-6);
            expect(route.length, label).toBeLessThan(3 * PANEL.width);
          }
        }
      }
    }
  }, 120_000);

  it('keeps the true trail under the route: every point knows its place on the mountain', () => {
    const { field, trail } = mountain('ridge', 'switchback', 5);
    for (let index = 0; index < 5; index += 1) {
      const route = stripRoute(trail, index);
      const from = trail.stops[index] as { x: number; z: number; along: number };
      const to = trail.stops[index + 1] as { x: number; z: number; along: number };
      expect((route.points[0] as { mx: number }).mx).toBeCloseTo(from.x, 9);
      expect((route.points[route.points.length - 1] as { mz: number }).mz).toBeCloseTo(to.z, 9);
      for (const point of route.points) {
        expect(point.along).toBeGreaterThanOrEqual(from.along - 1e-9);
        expect(point.along).toBeLessThanOrEqual(to.along + 1e-9);
        const under = mountainUnder(route, point.x, point.z);
        expect(under.x).toBeCloseTo(point.mx, 6);
        expect(under.z).toBeCloseTo(point.mz, 6);
        expect(Math.abs(field.sample(under.x, under.z) - field.sample(point.mx, point.mz))).toBeLessThan(1e-6);
      }
      const middle = stripPointAt(route, 0.5);
      expect(middle.x).toBeGreaterThan(STRIP.margin);
      expect(middle.x).toBeLessThan(PANEL.width - STRIP.margin);
    }
  });

  it('is the same for the same mountain', () => {
    const a = mountain('canyon', 'valley-first', 5);
    const b = mountain('canyon', 'valley-first', 5);
    expect(stripRoute(a.trail, 2).points).toEqual(stripRoute(b.trail, 2).points);
  });
});

describe('stripGround and stripCards', () => {
  it('cuts 6 to 20 cards per panel, nested from the whole window upward, with the route on top of them', () => {
    for (const [terrain, template] of [['volcano', 'spiral'], ['plateau', 'traverse'], ['twin-peaks', 'switchback']] as const) {
      const { field, trail } = mountain(terrain, template, 5);
      for (let index = 0; index < 5; index += 1) {
        const route = stripRoute(trail, index);
        const ground = stripGround(field, route, true);
        expect(ground.data).toHaveLength(STRIP.phoneGrid.cols * STRIP.phoneGrid.rows);
        expect(ground.min).toBeGreaterThanOrEqual(0);
        expect(ground.max).toBeLessThanOrEqual(1 + 1e-6);
        const cards = stripCards(ground, true);
        expect(cards.count).toBeGreaterThanOrEqual(MODEL.minCards);
        expect(cards.count).toBeLessThanOrEqual(MODEL.maxCards);
        expect(cards.levels).toHaveLength(cards.count);
        expect(cards.levels[0]?.polygons[0]?.area).toBeCloseTo((MODEL.x1 - MODEL.x0) * (MODEL.z1 - MODEL.z0), 9);
        for (const level of cards.levels) {
          for (const polygon of level.polygons) {
            for (const point of polygon.outer) {
              expect(point.x).toBeGreaterThanOrEqual(MODEL.x0 - 1e-9);
              expect(point.x).toBeLessThanOrEqual(MODEL.x1 + 1e-9);
              expect(point.z).toBeGreaterThanOrEqual(MODEL.z0 - 1e-9);
              expect(point.z).toBeLessThanOrEqual(MODEL.z1 + 1e-9);
            }
          }
        }
        // Paper gets smaller toward the top.
        const areas = cards.levels.map((level) => level.polygons.reduce((sum, polygon) => sum + polygon.area, 0));
        for (let k = 1; k < areas.length; k += 1) expect(areas[k] as number).toBeLessThanOrEqual((areas[k - 1] as number) + 0.05);
        for (const point of route.points) {
          const card = cards.cardAt(point.x, point.z);
          expect(card).toBeGreaterThanOrEqual(0);
          expect(card).toBeLessThan(cards.count);
        }
        expect(cards.cardAt(0.01, 0)).toBe(-1);
        expect(cards.cardAt(2, -2.5)).toBe(-1);
      }
    }
  }, 120_000);
});
