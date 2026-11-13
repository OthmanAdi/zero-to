import { Color, Vector3, type BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import {
  DETAIL_DESKTOP,
  DETAIL_PHONE,
  DIMS,
  OUTER_RADIUS,
  Profile,
  bandProfile,
  bezelProfile,
  bowlProfile,
  buildBody,
  buildDial,
  buildGlass,
  buildInnerRing,
  buildNeedle,
  buildOuterRing,
  detailFor,
  flutedBand,
  triangleCount,
  type BrassTints,
} from './geometry';

const TINTS: BrassTints = {
  body: new Color('#c9a15b'),
  deep: new Color('#8a6a32'),
  wall: new Color('#4a3a1c'),
  grip: new Color('#d8b878'),
  ring: new Color('#b08a48'),
};

function bounds(geometry: BufferGeometry): { min: Vector3; max: Vector3 } {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) throw new Error('no bounding box');
  return { min: box.min, max: box.max };
}

/** How many triangles face along `direction` (their normal has a positive part that way). */
function facing(geometry: BufferGeometry, direction: Vector3): { towards: number; total: number } {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  if (!index) throw new Error('expected an indexed geometry');
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  let towards = 0;
  for (let i = 0; i < index.count; i += 3) {
    a.fromBufferAttribute(position, index.getX(i));
    b.fromBufferAttribute(position, index.getX(i + 1));
    c.fromBufferAttribute(position, index.getX(i + 2));
    const normal = b.sub(a).cross(c.sub(a));
    if (normal.dot(direction) > 0) towards += 1;
  }
  return { towards, total: index.count / 3 };
}

describe('profiles', () => {
  it('doubles a point for a sharp edge', () => {
    const p = new Profile().to(1, 0).hard(1, 1).to(0, 1);
    expect(p.points).toHaveLength(4);
    expect(p.points[1]?.equals(p.points[2] as never)).toBe(true);
  });

  it('never goes left of the axis', () => {
    for (const profile of [bowlProfile(), bezelProfile(), bandProfile(1, 1.05, 0.05, 0.006)]) {
      for (const point of profile.points) expect(point.x).toBeGreaterThanOrEqual(0);
    }
  });

  it('turns the bowl from the knob up to the grip', () => {
    const points = bowlProfile().points;
    expect(points[0]?.x).toBe(0);
    expect(points[0]?.y).toBeLessThan(-0.6);
    const last = points[points.length - 1];
    expect(last?.x).toBeCloseTo(DIMS.gripValley, 9);
    expect(last?.y).toBeCloseTo(-DIMS.gripHalf + 0.002, 9);
    expect(Math.max(...points.map((point) => point.x))).toBeLessThan(DIMS.gripCrest);
  });

  it('ends the bezel on the seat of the glass', () => {
    const points = bezelProfile().points;
    const last = points[points.length - 1];
    expect(last?.x).toBeCloseTo(DIMS.dialRadius, 9);
    expect(last?.y).toBeCloseTo(DIMS.glassSeatY, 9);
  });

  it('closes the cross-section of a ring', () => {
    const points = bandProfile(1, 1.05, 0.05).points;
    expect(points[0]?.equals(points[points.length - 1] as never)).toBe(true);
  });
});

describe('flutedBand', () => {
  it('has six flat triangles per half flute and stays between crest and valley', () => {
    const geometry = flutedBand(40);
    expect(triangleCount(geometry)).toBe(40 * 2 * 6);
    const { min, max } = bounds(geometry);
    expect(max.x).toBeLessThanOrEqual(DIMS.gripCrest + 1e-6);
    expect(max.y).toBeCloseTo(DIMS.gripHalf, 6);
    expect(min.y).toBeCloseTo(-DIMS.gripHalf, 6);
    expect(geometry.getAttribute('uv')).toBeDefined();
    expect(geometry.getAttribute('normal')).toBeDefined();
  });
});

describe('built parts', () => {
  it('builds the body as one geometry with a colour for every vertex', () => {
    const body = buildBody(DETAIL_DESKTOP, TINTS);
    const count = body.getAttribute('position').count;
    expect(body.getAttribute('color').count).toBe(count);
    expect(body.getAttribute('uv').count).toBe(count);
    expect(body.getAttribute('normal').count).toBe(count);
    const { min, max } = bounds(body);
    // The pivot pins reach out to the inner ring; the knob is the lowest point.
    expect(max.x).toBeGreaterThan(DIMS.innerRing.outer);
    expect(max.x).toBeLessThan(DIMS.outerRing.inner);
    expect(min.y).toBeCloseTo(-0.665, 3);
    expect(max.z).toBeLessThanOrEqual(DIMS.gripCrest + 1e-6);
  });

  it('lays the dial flat, facing up, with the card and the ring as two groups', () => {
    const dial = buildDial(DETAIL_DESKTOP);
    expect(dial.groups).toHaveLength(2);
    expect(dial.groups[0]?.materialIndex).toBe(0);
    expect(dial.groups[1]?.materialIndex).toBe(1);
    const up = facing(dial, new Vector3(0, 1, 0));
    expect(up.towards).toBe(up.total);
    const { min, max } = bounds(dial);
    expect(max.x).toBeCloseTo(DIMS.dialRadius, 6);
    expect(min.y).toBeCloseTo(DIMS.dialY, 6);
    expect(max.y).toBeCloseTo(DIMS.dialY + DIMS.ringLift, 6);
    const uv = dial.getAttribute('uv');
    for (let i = 0; i < uv.count; i += 1) {
      expect(uv.getX(i)).toBeGreaterThanOrEqual(0);
      expect(uv.getX(i)).toBeLessThanOrEqual(1);
      expect(uv.getY(i)).toBeGreaterThanOrEqual(0);
      expect(uv.getY(i)).toBeLessThanOrEqual(1);
    }
  });

  it('points the needle north (-Z) at rest, red half first', () => {
    const needle = buildNeedle(DETAIL_DESKTOP);
    expect(needle.groups).toHaveLength(2);
    const { min, max } = bounds(needle);
    expect(min.z).toBeCloseTo(-0.66, 6);
    expect(max.z).toBeCloseTo(0.56, 6);
    expect(Math.abs(min.z)).toBeLessThan(DIMS.dialRadius);
    // Group 0 holds the half on -Z.
    const position = needle.getAttribute('position');
    const index = needle.getIndex();
    const first = needle.groups[0];
    if (!index || !first) throw new Error('the needle has no groups');
    let lowest = Infinity;
    let highest = -Infinity;
    for (let i = first.start; i < first.start + first.count; i += 1) {
      const z = position.getZ(index.getX(i));
      lowest = Math.min(lowest, z);
      highest = Math.max(highest, z);
    }
    expect(lowest).toBeCloseTo(-0.66, 6);
    expect(highest).toBeLessThan(0.05);
  });

  it('keeps the needle under the glass and above the dial', () => {
    const needle = bounds(buildNeedle(DETAIL_DESKTOP));
    const glass = bounds(buildGlass(DETAIL_DESKTOP));
    expect(needle.min.y).toBeGreaterThan(DIMS.dialY + DIMS.ringLift);
    expect(needle.max.y).toBeLessThan(glass.max.y - 0.05);
    expect(glass.min.y).toBeCloseTo(DIMS.glassSeatY, 3);
    expect(glass.max.y).toBeCloseTo(DIMS.glassSeatY + DIMS.glassRise, 6);
  });

  it('stands the outer ring upright in the YZ plane with the bow on top', () => {
    const ring = bounds(buildOuterRing(DETAIL_DESKTOP, TINTS));
    expect(ring.max.z).toBeCloseTo(OUTER_RADIUS + 0.005, 3);
    expect(ring.max.x).toBeLessThan(0.12);
    expect(ring.max.y).toBeGreaterThan(OUTER_RADIUS + 0.2);
    expect(ring.min.y).toBeCloseTo(-OUTER_RADIUS - 0.2, 3);
  });

  it('lets the rings turn past each other and past the bowl', () => {
    expect(DIMS.gripCrest).toBeLessThan(DIMS.innerRing.inner);
    expect(DIMS.innerRing.outer + 0.006).toBeLessThan(DIMS.outerRing.inner);
    // The inner ring sweeps a sphere when it rocks; the glass and the knob stay inside it.
    expect(DIMS.glassSeatY + DIMS.glassRise).toBeLessThan(DIMS.innerRing.inner);
    expect(0.665).toBeLessThan(DIMS.innerRing.inner);
  });

  it('carries the outer ring on two pins of the inner ring', () => {
    const withPins = bounds(buildInnerRing(DETAIL_DESKTOP, TINTS, true));
    const without = bounds(buildInnerRing(DETAIL_DESKTOP, TINTS, false));
    expect(withPins.max.z).toBeGreaterThan(OUTER_RADIUS);
    expect(without.max.z).toBeLessThan(DIMS.innerRing.outer + 0.01);
  });
});

describe('brass shading', () => {
  it('darkens faces that look down and leaves the others alone', () => {
    const body = buildBody(DETAIL_PHONE, TINTS);
    const normal = body.getAttribute('normal');
    const color = body.getAttribute('color');
    const position = body.getAttribute('position');
    let knob = -1;
    let bezel = -1;
    for (let i = 0; i < position.count; i += 1) {
      if (knob < 0 && position.getY(i) < -0.6 && normal.getY(i) < -0.9) knob = i;
      if (bezel < 0 && position.getY(i) > 0.09 && normal.getY(i) > 0.9) bezel = i;
    }
    expect(knob).toBeGreaterThanOrEqual(0);
    expect(bezel).toBeGreaterThanOrEqual(0);
    expect(color.getX(bezel)).toBeCloseTo(TINTS.body.r, 5);
    expect(color.getX(knob)).toBeLessThan(TINTS.deep.r * 0.5);
  });
});

describe('triangle budget', () => {
  const total = (phone: boolean): number => {
    const detail = detailFor(phone);
    return [
      buildBody(detail, TINTS),
      buildInnerRing(detail, TINTS, true),
      buildOuterRing(detail, TINTS),
      buildDial(detail),
      buildNeedle(detail),
      buildGlass(detail),
    ].reduce((sum, geometry) => sum + triangleCount(geometry), 0);
  };

  it('stays under 60 000 triangles on a desktop', () => {
    expect(total(false)).toBeLessThan(60_000);
  });

  it('uses fewer than half of that on a phone', () => {
    expect(total(true)).toBeLessThan(total(false) * 0.6);
    expect(detailFor(true)).toBe(DETAIL_PHONE);
  });
});
