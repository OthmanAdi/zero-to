import {
  BufferGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  LatheGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector2,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { dialUv } from './dial-layout';
import { TAU } from './heading';

/**
 * Every shape of the compass, built from numbers. Nothing here needs a renderer.
 *
 * Body frame: the pivot axis of the gimbal rings passes through the origin, +Y is up through the glass, north on
 * the dial is -Z and east is +X. Lengths are scene units for a compass whose outer ring has `OUTER_RADIUS`; the
 * part scales the whole body to the requested diameter.
 */
export const DIMS = {
  /** Radius of the dial (card plus engraved ring), which is also the inner radius of the bowl. */
  dialRadius: 0.77,
  /** Height of the paper card. */
  dialY: -0.07,
  /** How far the engraved ring stands above the card. */
  ringLift: 0.012,
  /** Radius of the paper card as a fraction of the dial radius. */
  cardFraction: 0.78,
  /** Height of the underside of the needle. */
  needleY: 0,
  /** Where the glass meets the bezel, and how far the dome rises above that. */
  glassSeatY: 0.05,
  glassRise: 0.17,
  /** Crest and valley of the fluted grip ring, and its half height. */
  gripCrest: 0.904,
  gripValley: 0.888,
  gripHalf: 0.036,
  /** The inner gimbal ring: a flat band round the bowl. */
  innerRing: { inner: 1.005, outer: 1.055, half: 0.055 },
  /** The outer ring: an upright hoop with a bow on top. */
  outerRing: { inner: 1.166, outer: 1.212, half: 0.038 },
} as const;

/** How far the bow rises above the outer ring and how far the drop hangs below it. */
const BOW_RISE = 0.269;
const DROP_FALL = 0.2;

/** The radius the requested diameter refers to: the outside of the outer ring. */
export const OUTER_RADIUS = DIMS.outerRing.outer;
/** The same for a compass built without the outer ring. */
export const INNER_OUTER_RADIUS = DIMS.innerRing.outer;

export interface Detail {
  /** Segments round the bowl and the rings. */
  readonly radial: number;
  /** Flutes on the grip ring. */
  readonly flutes: number;
  /** Segments round a pin or a small turned part. */
  readonly small: number;
  /** Segments of the glass dome: round and from the top down. */
  readonly glass: readonly [number, number];
}

export const DETAIL_DESKTOP: Detail = { radial: 128, flutes: 120, small: 20, glass: [72, 14] };
export const DETAIL_PHONE: Detail = { radial: 64, flutes: 64, small: 12, glass: [40, 8] };

/**
 * How far the unscaled compass reaches above and below its centre when it hangs straight: with the outer ring
 * from the top of the bow to the tip of the drop, without it from the top of the glass to the knob of the bowl.
 * Leaning and the swing of the rings only ever bring these points closer to the centre.
 */
export const EXTENT = {
  withOuterRing: { above: OUTER_RADIUS + BOW_RISE, below: OUTER_RADIUS + DROP_FALL },
  withoutOuterRing: { above: DIMS.glassSeatY + DIMS.glassRise, below: 0.665 },
} as const;

export function detailFor(phone: boolean): Detail {
  return phone ? DETAIL_PHONE : DETAIL_DESKTOP;
}

type Triple = readonly [number, number, number];

/**
 * A turned profile: points (radius, height) that a lathe sweeps round the Y axis. Trace it counter-clockwise in
 * the (radius, height) half plane (up the outside, inward over the top) and the surface faces outward.
 */
export class Profile {
  readonly points: Vector2[] = [];

  /** A point on a smooth stretch. */
  to(radius: number, y: number): this {
    this.points.push(new Vector2(Math.max(0, radius), y));
    return this;
  }

  /** A point with a sharp edge: the lathe gives a doubled point two normals. */
  hard(radius: number, y: number): this {
    return this.to(radius, y).to(radius, y);
  }

  /** Part of an ellipse round (cr, cy), from one angle to another in degrees. The first point is left out. */
  arc(cr: number, cy: number, rx: number, ry: number, fromDeg: number, toDeg: number, steps: number): this {
    for (let i = 1; i <= steps; i += 1) {
      const a = ((fromDeg + ((toDeg - fromDeg) * i) / steps) * Math.PI) / 180;
      this.to(cr + rx * Math.cos(a), cy + ry * Math.sin(a));
    }
    return this;
  }

  /** Makes the last point a sharp edge. */
  crease(): this {
    const last = this.points[this.points.length - 1];
    if (last) this.points.push(last.clone());
    return this;
  }
}

/** The bowl: a knob at the bottom, a collar, a deep rounded belly, a bead and a short straight wall. */
export function bowlProfile(): Profile {
  const p = new Profile();
  p.to(0, -0.665);
  p.arc(0, -0.615, 0.05, 0.05, -90, 40, 8);
  p.to(0.026, -0.562).to(0.05, -0.548);
  p.hard(0.105, -0.54).hard(0.105, -0.5273);
  p.arc(0, -0.17, 0.86, 0.36, -83, 0, 24).crease();
  p.arc(0.86, -0.145, 0.025, 0.025, -90, 90, 8).crease();
  p.hard(0.86, -0.052).hard(DIMS.gripValley, -0.044).to(DIMS.gripValley, -DIMS.gripHalf + 0.002);
  return p;
}

/** The bezel: a rounded ring above the grip that falls to the seat of the glass. */
export function bezelProfile(): Profile {
  const p = new Profile();
  p.to(DIMS.gripValley, DIMS.gripHalf - 0.002).to(DIMS.gripValley, 0.044);
  p.arc(0.832, 0.044, 0.054, 0.054, 0, 120, 10).crease();
  p.hard(0.782, 0.078).to(DIMS.dialRadius, DIMS.glassSeatY);
  return p;
}

/** The cross-section of a ring: a rectangle with eased corners and, if wanted, a raised bead on the outer face. */
export function bandProfile(inner: number, outer: number, half: number, bead = 0): Profile {
  const c = Math.min((outer - inner) * 0.3, half * 0.3);
  const p = new Profile();
  p.to(inner, -half + c).to(inner + c, -half).to(outer - c, -half).to(outer, -half + c);
  if (bead > 0) p.to(outer, -bead * 2).to(outer + bead, 0).to(outer, bead * 2);
  p.to(outer, half - c).to(outer - c, half).to(inner + c, half).to(inner, half - c).to(inner, -half + c);
  return p;
}

function lathe(profile: Profile, segments: number): BufferGeometry {
  return new LatheGeometry(profile.points, segments);
}

/** Loose triangles with flat faces. Each one is turned so that it faces the given direction. */
class Soup {
  private readonly positions: number[] = [];
  private readonly uvs: number[] = [];

  tri(a: Triple, b: Triple, c: Triple, facing: Triple, uv?: readonly [number, number, number, number, number, number]): void {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const flip = nx * facing[0] + ny * facing[1] + nz * facing[2] < 0;
    const [p, q] = flip ? [c, b] : [b, c];
    this.positions.push(a[0], a[1], a[2], p[0], p[1], p[2], q[0], q[1], q[2]);
    if (uv) {
      if (flip) this.uvs.push(uv[0], uv[1], uv[4], uv[5], uv[2], uv[3]);
      else this.uvs.push(uv[0], uv[1], uv[2], uv[3], uv[4], uv[5]);
    } else {
      this.uvs.push(0, 0, 0, 0, 0, 0);
    }
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('uv', new Float32BufferAttribute(this.uvs, 2));
    geometry.computeVertexNormals();
    // A plain index, so it merges with the indexed lathes.
    const count = this.positions.length / 3;
    const index: number[] = [];
    for (let i = 0; i < count; i += 1) index.push(i);
    geometry.setIndex(index);
    return geometry;
  }
}

/**
 * The grip ring: V-shaped flutes round the bowl, like the edge of a coin, with a small chamfer above and below.
 * Flat faces on purpose: every flute catches the lamp on its own as the compass turns.
 */
export function flutedBand(flutes: number, crest = DIMS.gripCrest, valley = DIMS.gripValley, half = DIMS.gripHalf): BufferGeometry {
  const soup = new Soup();
  const steps = flutes * 2;
  const chamfer = 0.008;
  const lip = valley - 0.002;
  const at = (k: number, radius: number, y: number): Triple => {
    const phi = (k / steps) * TAU;
    return [radius * Math.sin(phi), y, radius * Math.cos(phi)];
  };
  for (let k = 0; k < steps; k += 1) {
    const r0 = k % 2 === 0 ? crest : valley;
    const r1 = k % 2 === 0 ? valley : crest;
    const mid = ((k + 0.5) / steps) * TAU;
    const out: Triple = [Math.sin(mid), 0, Math.cos(mid)];
    const u0 = k / steps;
    const u1 = (k + 1) / steps;
    const y0 = -half + chamfer;
    const y1 = half - chamfer;
    const a = at(k, r0, y0);
    const b = at(k + 1, r1, y0);
    const c = at(k + 1, r1, y1);
    const d = at(k, r0, y1);
    soup.tri(a, b, d, out, [u0, 0.2, u1, 0.2, u0, 0.8]);
    soup.tri(b, c, d, out, [u1, 0.2, u1, 0.8, u0, 0.8]);
    const up: Triple = [out[0], 2, out[2]];
    const e = at(k, lip, half);
    const f = at(k + 1, lip, half);
    soup.tri(d, c, e, up, [u0, 0.8, u1, 0.8, u0, 1]);
    soup.tri(c, f, e, up, [u1, 0.8, u1, 1, u0, 1]);
    const down: Triple = [out[0], -2, out[2]];
    const g = at(k, lip, -half);
    const h = at(k + 1, lip, -half);
    soup.tri(a, b, g, down, [u0, 0.2, u1, 0.2, u0, 0]);
    soup.tri(b, h, g, down, [u1, 0.2, u1, 0, u0, 0]);
  }
  return soup.build();
}

/** Gives every vertex of a geometry one colour. Merged parts keep their own tint this way. */
export function tint(geometry: BufferGeometry, color: Color): BufferGeometry {
  const count = geometry.getAttribute('position').count;
  const values = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    values[i * 3] = color.r;
    values[i * 3 + 1] = color.g;
    values[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new Float32BufferAttribute(values, 3));
  return geometry;
}

/**
 * Gives every vertex a colour that runs from `low` to `high` along a measure of its position. This is the cheap
 * stand-in for ambient occlusion: the valleys of the flutes and the underside of the bowl are darker brass.
 */
export function shade(
  geometry: BufferGeometry,
  low: Color,
  high: Color,
  measure: (x: number, y: number, z: number) => number,
): BufferGeometry {
  const position = geometry.getAttribute('position');
  const values = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i += 1) {
    const k = Math.min(1, Math.max(0, measure(position.getX(i), position.getY(i), position.getZ(i))));
    values[i * 3] = low.r + (high.r - low.r) * k;
    values[i * 3 + 1] = low.g + (high.g - low.g) * k;
    values[i * 3 + 2] = low.b + (high.b - low.b) * k;
  }
  geometry.setAttribute('color', new Float32BufferAttribute(values, 3));
  return geometry;
}

/**
 * Darkens the colours of faces that look down. The room map does not know about the dark table under the
 * compass, so without this the underside would mirror a bright floor that is not there.
 */
export function occlude(geometry: BufferGeometry, floor = 0.42): BufferGeometry {
  const normal = geometry.getAttribute('normal');
  const color = geometry.getAttribute('color');
  for (let i = 0; i < color.count; i += 1) {
    const k = Math.min(1, Math.max(0, 0.2 - normal.getY(i)));
    const factor = 1 - (1 - floor) * k * k * (3 - 2 * k);
    color.setXYZ(i, color.getX(i) * factor, color.getY(i) * factor, color.getZ(i) * factor);
  }
  return geometry;
}

/** Merges parts into one geometry and frees the parts. */
function fuse(parts: BufferGeometry[], groups = false): BufferGeometry {
  const merged = mergeGeometries(parts, groups);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error('compass: the parts could not be merged');
  return merged;
}

/** A pin along the X or Z axis from one distance to another, with a knob on the far end. */
function pivot(axis: 'x' | 'z', sign: 1 | -1, from: number, to: number, detail: Detail): BufferGeometry[] {
  const length = to - from;
  const pin = new CylinderGeometry(0.024, 0.024, length, detail.small, 1, true);
  const collar = new CylinderGeometry(0.058, 0.05, 0.03, detail.small, 1, false);
  const knob = new SphereGeometry(0.043, detail.small, Math.max(6, Math.round(detail.small * 0.6)));
  pin.translate(0, from + length / 2, 0);
  collar.translate(0, from + 0.012, 0);
  knob.scale(1, 0.8, 1);
  knob.translate(0, to + 0.012, 0);
  const parts = [pin, collar, knob];
  for (const part of parts) {
    // The cylinder stands along +Y; lay it along the wanted axis.
    if (axis === 'x') part.rotateZ((-sign * Math.PI) / 2);
    else part.rotateX((sign * Math.PI) / 2);
  }
  return parts;
}

export interface BrassTints {
  /** The bowl and the bezel. */
  readonly body: Color;
  /** Shadowed brass: the valleys of the flutes and the underside of the bowl. */
  readonly deep: Color;
  /** The inside wall of the bowl, which the bezel keeps in the dark. */
  readonly wall: Color;
  /** The grip ring, a little paler so the flutes sparkle. */
  readonly grip: Color;
  /** The gimbal rings. */
  readonly ring: Color;
}

/** Everything that is rigid with the bowl, as one geometry: bowl, grip, bezel, inner wall, pivot post, cap, pins. */
export function buildBody(detail: Detail, tints: BrassTints): BufferGeometry {
  const parts: BufferGeometry[] = [];
  // The belly darkens towards the knob, the flutes darken in their valleys.
  parts.push(shade(lathe(bowlProfile(), detail.radial), tints.deep, tints.body, (_x, y) => (y + 0.62) / 0.4));
  parts.push(
    shade(flutedBand(detail.flutes), tints.deep, tints.grip, (x, _y, z) => {
      return (Math.hypot(x, z) - DIMS.gripValley) / (DIMS.gripCrest - DIMS.gripValley);
    }),
  );
  parts.push(tint(lathe(bezelProfile(), detail.radial), tints.body));

  const ringY = DIMS.dialY + DIMS.ringLift;
  const wall = new Profile().to(DIMS.dialRadius, DIMS.glassSeatY).to(DIMS.dialRadius, ringY);
  parts.push(tint(lathe(wall, detail.radial), tints.wall));
  const cardRadius = DIMS.dialRadius * DIMS.cardFraction;
  const step = new Profile().to(cardRadius, ringY).to(cardRadius, DIMS.dialY);
  parts.push(tint(lathe(step, detail.radial), tints.wall));

  const post = new Profile().to(0.036, DIMS.dialY).to(0.03, DIMS.dialY + 0.014).to(0.012, DIMS.needleY - 0.002);
  parts.push(tint(lathe(post, detail.small), tints.body));
  const cap = new Profile().hard(0.056, DIMS.needleY + 0.012).hard(0.056, DIMS.needleY + 0.03);
  cap.arc(0, DIMS.needleY + 0.03, 0.056, 0.016, 0, 90, 5);
  parts.push(tint(lathe(cap, detail.small), tints.grip));

  for (const sign of [1, -1] as const) {
    for (const part of pivot('x', sign, DIMS.gripCrest - 0.014, DIMS.innerRing.outer + 0.012, detail)) {
      parts.push(tint(part, tints.ring));
    }
  }
  return occlude(fuse(parts));
}

/** The inner gimbal ring with the two pins that carry the outer ring. */
export function buildInnerRing(detail: Detail, tints: BrassTints, withOuterPins: boolean): BufferGeometry {
  const ring = DIMS.innerRing;
  const parts: BufferGeometry[] = [tint(lathe(bandProfile(ring.inner, ring.outer, ring.half, 0.006), detail.radial), tints.ring)];
  if (withOuterPins) {
    for (const sign of [1, -1] as const) {
      for (const part of pivot('z', sign, ring.outer - 0.012, DIMS.outerRing.outer + 0.012, detail)) {
        parts.push(tint(part, tints.ring));
      }
    }
  }
  return occlude(fuse(parts));
}

/** The outer ring: an upright hoop in the YZ plane, with a turned post and a bow on top and a drop below. */
export function buildOuterRing(detail: Detail, tints: BrassTints): BufferGeometry {
  const ring = DIMS.outerRing;
  const hoop = lathe(bandProfile(ring.inner, ring.outer, ring.half, 0.005), detail.radial);
  hoop.rotateZ(Math.PI / 2);

  const top = ring.outer;
  const post = new Profile();
  post.hard(0.05, top - 0.012).hard(0.05, top + 0.012).to(0.024, top + 0.03);
  post.arc(0, top + 0.052, 0.036, 0.022, -70, 70, 6);
  post.to(0.02, top + 0.082).to(0.024, top + 0.1).to(0, top + 0.104);

  const bow = new TorusGeometry(0.082, 0.017, Math.max(8, Math.round(detail.small * 0.6)), detail.small * 2);
  bow.translate(0, top + 0.1 + 0.07, 0);

  const drop = new Profile();
  drop.to(0, -top - 0.2);
  drop.arc(0, -top - 0.115, 0.042, 0.085, -90, 60, 8);
  drop.to(0.016, -top - 0.03).hard(0.046, -top - 0.022).hard(0.046, -top + 0.012);

  return occlude(
    fuse([
      tint(hoop, tints.ring),
      tint(lathe(post, detail.small), tints.grip),
      tint(bow, tints.grip),
      tint(lathe(drop, detail.small), tints.grip),
    ]),
  );
}

/**
 * The dial plane: the paper card (group 0) and the engraved ring a little above it (group 1). Both carry the
 * texture coordinates of the painted dial, so north on the picture is north on the body.
 */
export function buildDial(detail: Detail): BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  const segments = detail.radial;
  const cardRadius = DIMS.dialRadius * DIMS.cardFraction;
  const ringY = DIMS.dialY + DIMS.ringLift;
  const vertex = (x: number, y: number, z: number): number => {
    positions.push(x, y, z);
    const uv = dialUv(x, z, DIMS.dialRadius);
    uvs.push(uv.u, uv.v);
    return positions.length / 3 - 1;
  };

  // Card: a fan. Seen from above with -Z up, +X is to the right, so centre, k+1, k is counter-clockwise.
  const centre = vertex(0, DIMS.dialY, 0);
  const rim: number[] = [];
  for (let k = 0; k < segments; k += 1) {
    const phi = (k / segments) * TAU;
    rim.push(vertex(cardRadius * Math.sin(phi), DIMS.dialY, cardRadius * Math.cos(phi)));
  }
  for (let k = 0; k < segments; k += 1) index.push(centre, rim[k] as number, rim[(k + 1) % segments] as number);
  const cardCount = index.length;

  // Ring: a strip between two circles.
  const inner: number[] = [];
  const outer: number[] = [];
  for (let k = 0; k < segments; k += 1) {
    const phi = (k / segments) * TAU;
    const s = Math.sin(phi);
    const c = Math.cos(phi);
    inner.push(vertex(cardRadius * s, ringY, cardRadius * c));
    outer.push(vertex(DIMS.dialRadius * s, ringY, DIMS.dialRadius * c));
  }
  for (let k = 0; k < segments; k += 1) {
    const n = (k + 1) % segments;
    index.push(inner[k] as number, outer[k] as number, outer[n] as number);
    index.push(inner[k] as number, outer[n] as number, inner[n] as number);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  const normals = new Float32Array(positions.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setIndex(index);
  geometry.addGroup(0, cardCount, 0);
  geometry.addGroup(cardCount, index.length - cardCount, 1);
  return geometry;
}

/**
 * The needle: a long lozenge with a ridge down the middle, pointing along -Z (north) at rest. Group 0 is the
 * north half and the jewel on the cap, group 1 the south half.
 */
export function buildNeedle(detail: Detail): BufferGeometry {
  const y = DIMS.needleY;
  const half = (tipZ: number, sign: 1 | -1): BufferGeometry => {
    const soup = new Soup();
    const up: Triple = [0, 1, 0];
    const down: Triple = [0, -1, 0];
    const waistZ = sign * 0.13;
    const left0: Triple = [-0.034, y, 0];
    const right0: Triple = [0.034, y, 0];
    const ridge0: Triple = [0, y + 0.022, 0];
    const leftW: Triple = [-0.068, y, waistZ];
    const rightW: Triple = [0.068, y, waistZ];
    const ridgeW: Triple = [0, y + 0.028, waistZ];
    const tip: Triple = [0, y + 0.004, sign * tipZ];
    soup.tri(ridge0, left0, leftW, up);
    soup.tri(ridge0, leftW, ridgeW, up);
    soup.tri(ridgeW, leftW, tip, up);
    soup.tri(ridge0, right0, rightW, up);
    soup.tri(ridge0, rightW, ridgeW, up);
    soup.tri(ridgeW, rightW, tip, up);
    soup.tri(left0, leftW, tip, down);
    soup.tri(left0, tip, right0, down);
    soup.tri(right0, tip, rightW, down);
    return soup.build();
  };

  const jewel = new SphereGeometry(0.019, detail.small, Math.max(6, Math.round(detail.small * 0.6)));
  jewel.translate(0, y + 0.046, 0);
  const north = fuse([half(0.66, -1), jewel]);
  const south = half(0.56, 1);
  return fuse([north, south], true);
}

/**
 * The shadow of the needle: its outline lying flat just above the dial, solid in the middle and fading to
 * nothing over a soft edge. The softness is vertex alpha (the colour attribute has four components), so the
 * blur costs no texture. Like the needle it points along -Z at rest.
 */
export function buildNeedleShadow(feather = 0.04): BufferGeometry {
  const y = DIMS.dialY + DIMS.ringLift + 0.003;
  // The outline seen from above, going round from the north tip: [x, z, outward x, outward z].
  const outline: ReadonlyArray<readonly [number, number, number, number]> = [
    [0, -0.66, 0, -1],
    [0.068, -0.13, 1, 0],
    [0.04, 0, 1, 0],
    [0.068, 0.13, 1, 0],
    [0, 0.56, 0, 1],
    [-0.068, 0.13, -1, 0],
    [-0.04, 0, -1, 0],
    [-0.068, -0.13, -1, 0],
  ];
  const positions: number[] = [0, y, 0];
  const colors: number[] = [1, 1, 1, 1];
  for (const [x, z, nx, nz] of outline) {
    // The solid core is a little smaller than the needle, so the fade straddles the true edge.
    positions.push(x - nx * feather * 0.35, y, z - nz * feather * 0.35);
    colors.push(1, 1, 1, 1);
  }
  for (const [x, z, nx, nz] of outline) {
    positions.push(x + nx * feather * 0.65, y, z + nz * feather * 0.65);
    colors.push(1, 1, 1, 0);
  }
  const count = outline.length;
  const index: number[] = [];
  // Seen from above the outline runs clockwise, so centre, next, this faces up.
  for (let k = 0; k < count; k += 1) {
    const n = (k + 1) % count;
    const core = 1 + k;
    const coreNext = 1 + n;
    const edge = 1 + count + k;
    const edgeNext = 1 + count + n;
    index.push(0, coreNext, core);
    index.push(core, coreNext, edgeNext);
    index.push(core, edgeNext, edge);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 4));
  geometry.setIndex(index);
  return geometry;
}

/** The glass: a shallow cap of a large sphere that sits on the bezel. */
export function buildGlass(detail: Detail): BufferGeometry {
  const a = DIMS.dialRadius + 0.004;
  const h = DIMS.glassRise;
  const radius = (a * a + h * h) / (2 * h);
  const geometry = new SphereGeometry(radius, detail.glass[0], detail.glass[1], 0, TAU, 0, Math.asin(a / radius));
  geometry.translate(0, DIMS.glassSeatY + h - radius, 0);
  return geometry;
}

/** Number of triangles a geometry draws. */
export function triangleCount(geometry: BufferGeometry): number {
  const index = geometry.getIndex();
  return (index ? index.count : geometry.getAttribute('position').count) / 3;
}
