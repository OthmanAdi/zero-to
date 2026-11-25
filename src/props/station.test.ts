import { describe, expect, it } from 'vitest';
import { STATION, STATION_ROUTE, routeDepth, routePoints } from './station';

describe('the route of a station', () => {
  const [width, depth] = STATION.sheet.altitudes;
  const points = routePoints(width, depth);

  it('runs from the start dot of the print to its end, in the units of the sheet', () => {
    const [startX, startY] = STATION_ROUTE[0] as readonly [number, number];
    const [endX, endY] = STATION_ROUTE[STATION_ROUTE.length - 1] as readonly [number, number];
    expect(points[0]?.x).toBeCloseTo((startX - 0.5) * width, 9);
    expect(points[0]?.z).toBeCloseTo((startY - 0.5) * depth, 9);
    expect(points[points.length - 1]?.x).toBeCloseTo((endX - 0.5) * width, 9);
    expect(points[points.length - 1]?.z).toBeCloseTo((endY - 0.5) * depth, 9);
    // In front of the peaks, which stand behind the middle of the sheet.
    for (const point of points) expect(point.z).toBeGreaterThan(STATION.row.z);
  });

  it('never turns back, so it crosses each line across the sheet once', () => {
    for (let index = 1; index < points.length; index += 1) expect((points[index]?.x ?? 0) - (points[index - 1]?.x ?? 0)).toBeGreaterThan(0);
  });

  it('gives the depth of the route along the sheet, and keeps the depth of an end beyond it', () => {
    for (const point of points) expect(routeDepth(points, point.x)).toBeCloseTo(point.z, 9);
    const first = points[0] as { x: number; z: number };
    const last = points[points.length - 1] as { x: number; z: number };
    expect(routeDepth(points, first.x - 5)).toBe(first.z);
    expect(routeDepth(points, last.x + 5)).toBe(last.z);
    const middle = (first.x + last.x) / 2;
    const z = routeDepth(points, middle);
    expect(z).toBeGreaterThan(Math.min(...points.map((point) => point.z)) - 1e-9);
    expect(z).toBeLessThan(Math.max(...points.map((point) => point.z)) + 1e-9);
    expect(routeDepth([], 1)).toBe(0);
  });
});
