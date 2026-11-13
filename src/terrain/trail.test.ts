import { describe, expect, it } from 'vitest';
import { TERRAIN_TEMPLATE_IDS, generateHeightfield, heightfieldFromData, type Heightfield } from './heightfield';
import {
  TRAIL_TEMPLATE_IDS,
  markTrail,
  planTrail,
  resolveTrailTemplate,
  trailPointAt,
  type Trail,
  type TrailTemplate,
} from './trail';

const fields = new Map<string, Heightfield>();
function fieldFor(template: (typeof TERRAIN_TEMPLATE_IDS)[number], seed: number | string = 'trail'): Heightfield {
  const key = `${template}/${seed}`;
  let field = fields.get(key);
  if (!field) {
    field = generateHeightfield({ seed, template });
    fields.set(key, field);
  }
  return field;
}

function expectSoundTrail(field: Heightfield, trail: Trail, stops: number): void {
  expect(trail.stops.length).toBe(stops);
  expect(trail.points.length).toBeGreaterThan(stops);
  expect(trail.length).toBeGreaterThan(0.2);

  // The gate is the first point, the summit the last.
  const first = trail.points[0];
  const last = trail.points[trail.points.length - 1];
  expect(trail.stops[0]).toMatchObject({ index: 0, along: 0, x: first?.x, z: first?.z });
  const summit = trail.stops[stops - 1];
  expect(summit).toMatchObject({ index: stops - 1, along: 1, h: 1 });
  expect(summit?.x).toBeCloseTo(field.summit.x, 9);
  expect(summit?.z).toBeCloseTo(field.summit.z, 9);
  expect(last?.x).toBeCloseTo(field.summit.x, 9);

  // Every stop is higher than the one before, and further along.
  for (let k = 1; k < stops; k += 1) {
    const lower = trail.stops[k - 1];
    const upper = trail.stops[k];
    expect(upper?.index).toBe(k);
    expect((upper?.h ?? 0) > (lower?.h ?? 1)).toBe(true);
    expect((upper?.along ?? 0) > (lower?.along ?? 1)).toBe(true);
  }
  // The gate stands at the foot.
  expect(trail.stops[0]?.h).toBeLessThan(0.25);
  expect(trail.stops[0]?.h).toBeGreaterThan(0.02);

  // The route stays inside the footprint, runs forward, is evenly spaced and its length adds up.
  let walked = 0;
  let inside = true;
  let forward = true;
  let even = true;
  let heightsMatch = true;
  for (let i = 0; i < trail.points.length; i += 1) {
    const p = trail.points[i];
    if (!p) continue;
    if (Math.abs(p.x) > 0.97 || Math.abs(p.z) > 0.97) inside = false;
    if (i < trail.points.length - 1 && Math.abs(p.h - field.sample(p.x, p.z)) > 1e-6) heightsMatch = false;
    const q = trail.points[i - 1];
    if (!q) continue;
    const step = Math.hypot(p.x - q.x, p.z - q.z);
    walked += step;
    if (p.along <= q.along) forward = false;
    if (step > 0.02 || step < 0.002) even = false;
  }
  expect(inside).toBe(true);
  expect(forward).toBe(true);
  expect(even).toBe(true);
  expect(heightsMatch).toBe(true);
  expect(walked).toBeCloseTo(trail.length, 6);

  // Stops lie on the route.
  for (const stop of trail.stops) {
    const on = trailPointAt(trail, stop.along);
    expect(on.x).toBeCloseTo(stop.x, 6);
    expect(on.z).toBeCloseTo(stop.z, 6);
  }
}

describe('planTrail', () => {
  it('plans the same trail for the same seed', () => {
    const field = fieldFor('massif');
    for (const template of [...TRAIL_TEMPLATE_IDS, 'random'] as const) {
      const a = planTrail(field, { seed: 'rust', stops: 6, template });
      const b = planTrail(field, { seed: 'rust', stops: 6, template });
      expect(a).toEqual(b);
    }
  });

  it('plans different trails for different seeds', () => {
    const field = fieldFor('massif');
    const a = planTrail(field, { seed: 'rust', stops: 6, template: 'spiral' });
    const b = planTrail(field, { seed: 'zig', stops: 6, template: 'spiral' });
    expect(a.stops[0]).not.toEqual(b.stops[0]);
  });

  for (const terrain of TERRAIN_TEMPLATE_IDS) {
    for (const template of TRAIL_TEMPLATE_IDS) {
      it(`${template} on ${terrain}: rises through its stops and stays on the map`, () => {
        const field = fieldFor(terrain);
        expectSoundTrail(field, planTrail(field, { seed: 'rust', stops: 6, template }), 6);
      });
    }
  }

  it('handles every number of stops from 2 to 12 and clamps the rest', () => {
    const field = fieldFor('twin-peaks', 5);
    for (let stops = 2; stops <= 12; stops += 1) {
      expectSoundTrail(field, planTrail(field, { seed: 9, stops, template: 'switchback' }), stops);
    }
    expect(planTrail(field, { seed: 9, stops: 1, template: 'spiral' }).stops.length).toBe(2);
    expect(planTrail(field, { seed: 9, stops: 40, template: 'spiral' }).stops.length).toBe(12);
    expect(planTrail(field, { seed: 9, stops: Number.NaN, template: 'spiral' }).stops.length).toBe(2);
  });

  it('holds up over many seeds on the phone grid', () => {
    for (let seed = 0; seed < 12; seed += 1) {
      const field = generateHeightfield({ seed, template: 'random', resolution: 65 });
      const stops = 3 + (seed % 8);
      expectSoundTrail(field, planTrail(field, { seed, stops, template: 'random' }), stops);
    }
  });

  it('puts camps near the heights that were asked for', () => {
    const field = fieldFor('massif');
    const wanted = [0.1, 0.2, 0.5, 0.8, 1];
    const trail = planTrail(field, { seed: 'h', stops: 5, template: 'traverse', stopHeights: wanted });
    expectSoundTrail(field, trail, 5);
    for (let k = 0; k < 4; k += 1) expect(Math.abs((trail.stops[k]?.h ?? 0) - (wanted[k] ?? 0))).toBeLessThan(0.06);
  });

  it('repairs stop heights that do not rise and ignores a list of the wrong length', () => {
    const field = fieldFor('ridge');
    expectSoundTrail(field, planTrail(field, { seed: 1, stops: 4, template: 'ridge-walk', stopHeights: [0.5, 0.2, 0.9, 0.3] }), 4);
    expectSoundTrail(field, planTrail(field, { seed: 1, stops: 4, template: 'ridge-walk', stopHeights: [0.5] }), 4);
  });

  it('takes a detour instead of the straight line on a steep cone', () => {
    const cone = (() => {
      const n = 65;
      const data = new Float32Array(n * n);
      for (let j = 0; j < n; j += 1) {
        for (let i = 0; i < n; i += 1) {
          data[j * n + i] = Math.max(0, 1 - Math.hypot(-1 + (2 * i) / (n - 1), -1 + (2 * j) / (n - 1)) / 0.8);
        }
      }
      return heightfieldFromData(n, data);
    })();
    const trail = planTrail(cone, { seed: 2, stops: 2, template: 'switchback' });
    const gate = trail.stops[0];
    const direct = Math.hypot((gate?.x ?? 0) - cone.summit.x, (gate?.z ?? 0) - cone.summit.z);
    expect(trail.length).toBeGreaterThan(direct * 1.5);
    // And it never gives away much height on the way.
    let lost = 0;
    for (let i = 1; i < trail.points.length; i += 1) {
      lost += Math.max(0, (trail.points[i - 1]?.h ?? 0) - (trail.points[i]?.h ?? 0));
    }
    expect(lost).toBeLessThan(0.08);
  });

  it('gives each template its own character', () => {
    const field = fieldFor('volcano');
    // The middle of the mountain: its high ground, weighted by height.
    let weight = 0;
    let centreX = 0;
    let centreZ = 0;
    const n = field.resolution;
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        const w = field.at(i, j) ** 3;
        weight += w;
        centreX += w * (-1 + (2 * i) / (n - 1));
        centreZ += w * (-1 + (2 * j) / (n - 1));
      }
    }
    centreX /= weight;
    centreZ /= weight;
    const turned = (template: TrailTemplate): number => {
      // Angle swept round that middle by the lower stops. Near the top the direction means little.
      const trail = planTrail(field, { seed: 'c', stops: 7, template });
      const low = trail.stops.slice(0, 4);
      let sum = 0;
      for (let i = 1; i < low.length; i += 1) {
        const a = low[i - 1];
        const b = low[i];
        if (!a || !b) continue;
        let d = Math.atan2(b.z - centreZ, b.x - centreX) - Math.atan2(a.z - centreZ, a.x - centreX);
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        sum += d;
      }
      return Math.abs(sum);
    };
    expect(turned('spiral')).toBeGreaterThan(Math.PI * 0.9);
    expect(turned('switchback')).toBeLessThan(Math.PI * 0.5);
    expect(turned('ridge-walk')).toBeLessThan(Math.PI * 0.5);
  });

  it("'random' picks a template from the seed and says which", () => {
    const field = fieldFor('massif');
    const seen = new Set<string>();
    for (let seed = 0; seed < 40; seed += 1) seen.add(resolveTrailTemplate({ seed, template: 'random' }));
    expect(seen.size).toBe(TRAIL_TEMPLATE_IDS.length);
    expect(planTrail(field, { seed: 3, stops: 4, template: 'random' }).template).toBe(resolveTrailTemplate({ seed: 3, template: 'random' }));
    expect(() => planTrail(field, { seed: 3, stops: 4, template: 'climb' as never })).toThrow();
  });
});

describe('trailPointAt and markTrail', () => {
  const field = fieldFor('massif');
  const trail = planTrail(field, { seed: 'marks', stops: 5, template: 'switchback' });

  it('finds points by their share of the trail', () => {
    expect(trailPointAt(trail, 0)).toMatchObject({ x: trail.points[0]?.x, z: trail.points[0]?.z });
    expect(trailPointAt(trail, 1).h).toBeCloseTo(1, 6);
    expect(trailPointAt(trail, -3).along).toBe(0);
    expect(trailPointAt(trail, 7).along).toBe(1);
    const half = trailPointAt(trail, 0.5);
    expect(half.along).toBe(0.5);
    expect(Math.abs(half.x)).toBeLessThan(1);
  });

  it('breaks the route into dashes with a dot in place of every fourth', () => {
    const marks = markTrail(trail);
    expect(marks.length).toBeGreaterThan(10);
    let previous = -1;
    marks.forEach((mark, index) => {
      expect(mark.kind).toBe((index + 1) % 4 === 0 ? 'dot' : 'dash');
      expect(mark.points.length).toBe(mark.kind === 'dot' ? 1 : mark.points.length);
      if (mark.kind === 'dash') expect(mark.points.length).toBeGreaterThanOrEqual(2);
      for (const point of mark.points) {
        expect(point.along).toBeGreaterThanOrEqual(previous);
        previous = point.along;
      }
    });
    expect(previous).toBeLessThanOrEqual(1);
    expect(markTrail(trail, { dotEvery: 0 }).every((mark) => mark.kind === 'dash')).toBe(true);
    expect(markTrail(trail)).toEqual(markTrail(trail));
  });
});
