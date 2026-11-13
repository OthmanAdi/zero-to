import { describe, expect, it } from 'vitest';
import { generateHeightfield } from './heightfield';
import { ROUTE_DASH, ROUTE_RAMP, routeBleed, routeMarks } from './paper';
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

describe('routeBleed', () => {
  it('reaches past the edge of the line and the whole of its ramp', () => {
    expect(routeBleed({ lineWidth })).toBeGreaterThan(lineWidth / 2 + lineWidth * ROUTE_RAMP);
    expect(routeBleed({ lineWidth: 0.06 })).toBeGreaterThan(routeBleed({ lineWidth }));
  });
});
