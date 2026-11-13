import { describe, expect, it } from 'vitest';
import { levelHeights, levelIndexAt, traceContours } from './contours';
import { generateHeightfield } from './heightfield';
import { ROUTE_DASH, ROUTE_RAMP, ROUTE_STEP, routeBleed, routeMarks, routeSteps } from './paper';
import { planTrail } from './trail';

const field = generateHeightfield({ seed: 'paper', template: 'twin-peaks' });
const trail = planTrail(field, { seed: 'paper', template: 'switchback', stops: 5 });
/** Scene units per footprint unit, as the model has them for a board of 4. */
const half = 1.88;
const lineWidth = 0.03;

const lengthOf = (points: readonly { x: number; z: number }[]): number => {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += Math.hypot((points[i]?.x ?? 0) - (points[i - 1]?.x ?? 0), (points[i]?.z ?? 0) - (points[i - 1]?.z ?? 0));
  return total * half;
};

describe('routeMarks', () => {
  it('prints the route as one even dashed line', () => {
    const marks = routeMarks(trail, half);
    expect(marks.length).toBeGreaterThan(10);
    // Dashes only: no dots or other marks that would make the line uneven.
    expect(marks.every((mark) => mark.kind === 'dash' && mark.points.length >= 2)).toBe(true);
    // Every dash but the last, which ends with the trail, has the same length. A dash that turns a corner is
    // measured along its points, so it comes out a little short.
    for (const mark of marks.slice(0, -1)) {
      const length = lengthOf(mark.points);
      expect(length).toBeLessThanOrEqual(ROUTE_DASH.dash + 1e-6);
      expect(length).toBeGreaterThan(ROUTE_DASH.dash * 0.9);
    }
    // They follow each other up the trail at one pitch.
    const pitch = (ROUTE_DASH.dash + ROUTE_DASH.gap) / half / trail.length;
    for (let i = 1; i < marks.length; i += 1) {
      const from = marks[i - 1]?.points[0]?.along ?? 0;
      const to = marks[i]?.points[0]?.along ?? 0;
      expect(to - from).toBeCloseTo(pitch, 6);
    }
  });

  it('leaves a gap that is still open once the round ends of the dashes are drawn', () => {
    // A round end adds half a line width to each end of a dash.
    const open = ROUTE_DASH.gap - lineWidth;
    expect(open).toBeGreaterThanOrEqual(lineWidth);
    expect(open).toBeLessThan(ROUTE_DASH.dash + lineWidth);
  });
});

describe('routeSteps', () => {
  const levels = traceContours(field, levelHeights(22), { simplify: 0.003 });
  const marks = routeMarks(trail, half);
  const steps = routeSteps(marks, levels);
  const cardsOf = (mark: (typeof marks)[number]): number[] => mark.points.map((point) => levelIndexAt(levels, point.x, point.z));

  it('finds the cut edge under every dash that steps from one card to another', () => {
    // A trail to the summit of a mountain cut into 22 cards crosses 21 edges or more. About six tenths of the line
    // are dash and the rest is gap, and only a crossing under a dash has two pieces to join.
    expect(steps.length).toBeGreaterThan(8);
    for (const step of steps) {
      // On the edge: a hair to one side is one card, a hair to another side is another.
      const around = new Set<number>();
      for (let k = 0; k < 24; k += 1) {
        const angle = (k / 24) * Math.PI * 2;
        around.add(levelIndexAt(levels, step.x + Math.cos(angle) * 0.004, step.z + Math.sin(angle) * 0.004));
      }
      expect(around.size).toBeGreaterThanOrEqual(2);
    }
  });

  it('marks a crossing once, lies on the dash it belongs to and skips a card the dash only grazes', () => {
    let changes = 0;
    let climbs = 0;
    for (const mark of marks) {
      const cards = cardsOf(mark);
      for (let i = 1; i < cards.length; i += 1) if (cards[i] !== cards[i - 1]) changes += 1;
      if (cards[0] !== cards[cards.length - 1]) climbs += 1;
    }
    // Never more marks than changes of card, and at least one for every dash that ends on another card.
    expect(steps.length).toBeLessThanOrEqual(changes);
    expect(steps.length).toBeGreaterThanOrEqual(climbs);
    // Every mark lies on the centre line of a dash: no further from its points than they are apart.
    const points = marks.flatMap((mark) => mark.points);
    for (const step of steps) {
      let nearest = Infinity;
      for (const point of points) nearest = Math.min(nearest, Math.hypot(point.x - step.x, point.z - step.z));
      expect(nearest).toBeLessThan(0.0061);
    }
  });

  it('has nothing to mark without cards, and nothing on a sheet that is all one card', () => {
    expect(routeSteps(marks, [])).toEqual([]);
    const sheet = [{ index: 0, height: 0, polygons: [{ outer: [{ x: -1, z: -1 }, { x: 1, z: -1 }, { x: 1, z: 1 }, { x: -1, z: 1 }], holes: [], area: 4, bounds: { minX: -1, minZ: -1, maxX: 1, maxZ: 1 } }] }];
    expect(routeSteps(marks, sheet)).toEqual([]);
  });

  it('draws the joining stroke no wider than the line', () => {
    // The stroke on a cut edge is twice ROUTE_STEP of the line's width across, whatever the angle of the crossing.
    expect(ROUTE_STEP * 2).toBeLessThanOrEqual(1);
    expect(ROUTE_STEP * 2).toBeGreaterThan(0.6);
    // Its ramp needs room inside the dot, as the line's ramp needs room inside the line.
    expect(ROUTE_STEP).toBeGreaterThanOrEqual(ROUTE_RAMP);
  });
});

describe('routeBleed', () => {
  it('reaches past the edge of the line and the whole of its ramp', () => {
    expect(routeBleed({ lineWidth })).toBeGreaterThan(lineWidth / 2 + lineWidth * ROUTE_RAMP);
    expect(routeBleed({ lineWidth: 0.06 })).toBeGreaterThan(routeBleed({ lineWidth }));
  });
});
