import { BufferAttribute, BufferGeometry } from 'three';

/**
 * A loose leaf of paper hinged at the spine: a strip `length` long and `height` tall that bends as one
 * smooth arc in the floor plane. At rest it lies along -z, against the text block. `angle` turns its root
 * away from the block toward +x (open), and `curl` bends it further along its length, so a page that is
 * lifted at its root trails its free edge the way paper does.
 */

/** Points along the length of a leaf. */
export const LEAF_SEGMENTS = 18;

export interface LeafShape {
  /** Turn of the root in radians, 0 shut, PI/2 standing straight out from the spine. */
  angle: number;
  /** Extra turn, in radians, gained between the root and the free edge. Negative trails behind the root. */
  curl: number;
  /**
   * Extra turn gained over the outer part of the leaf only, from `LEAF_KNEE` to the free edge. It lets the
   * edge trail or flick on its own while the inner part, held by the binding, keeps its line.
   */
  flick?: number;
}

/** Share of a leaf's length at which its outer, freer part begins. */
export const LEAF_KNEE = 0.55;

/**
 * Direction of travel along a leaf at `s` (0 root, 1 free edge), in radians from shut. It is linear from
 * the root to the knee and from the knee to the edge, so the leaf has no kink: the direction is continuous
 * and only the curvature changes at the knee.
 */
export function leafTangent(shape: LeafShape, s: number): number {
  const outer = s > LEAF_KNEE ? (s - LEAF_KNEE) / (1 - LEAF_KNEE) : 0;
  return shape.angle + shape.curl * s + (shape.flick ?? 0) * outer;
}

/**
 * Centre line of a bent leaf: positions (x, z) and unit normals for `LEAF_SEGMENTS + 1` points from the
 * root (s = 0) to the free edge (s = 1). The arc keeps the leaf's length, so paper never stretches.
 */
export function leafLine(length: number, shape: LeafShape): { x: number[]; z: number[]; nx: number[]; nz: number[] } {
  const x = [0];
  const z = [0];
  const nx: number[] = [];
  const nz: number[] = [];
  const step = length / LEAF_SEGMENTS;
  for (let i = 0; i <= LEAF_SEGMENTS; i++) {
    const s = i / LEAF_SEGMENTS;
    // Direction of travel along the leaf at s: (sin a, -cos a) in (x, z).
    const a = leafTangent(shape, s);
    // The face that looks toward +x when the leaf is shut.
    nx.push(Math.cos(a));
    nz.push(Math.sin(a));
    if (i === LEAF_SEGMENTS) break;
    // Midpoint rule over the segment keeps the arc length exact enough for a few degrees per step.
    const mid = leafTangent(shape, s + 0.5 / LEAF_SEGMENTS);
    x.push(x[i]! + Math.sin(mid) * step);
    z.push(z[i]! - Math.cos(mid) * step);
  }
  return { x, z, nx, nz };
}

/** How light the paper is at `s` along a leaf (0 root, 1 free edge): darker in the gutter, full from a third out. */
export function gutterShade(s: number): number {
  const t = Math.min(1, Math.max(0, s / 0.32));
  return 0.58 + 0.42 * t * t * (3 - 2 * t);
}

export function leafGeometry(): BufferGeometry {
  const columns = LEAF_SEGMENTS + 1;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(columns * 2 * 3), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(columns * 2 * 3), 3));
  const uv = new Float32Array(columns * 2 * 2);
  for (let i = 0; i < columns; i++) {
    uv.set([i / LEAF_SEGMENTS, 0, i / LEAF_SEGMENTS, 1], i * 4);
  }
  geometry.setAttribute('uv', new BufferAttribute(uv, 2));
  // The gutter: paper is in shade where the leaves crowd together at the binding, and clears within a third of its length.
  const color = new Float32Array(columns * 2 * 3);
  for (let i = 0; i < columns; i++) {
    const shade = gutterShade(i / LEAF_SEGMENTS);
    color.set([shade, shade, shade * 0.97, shade, shade, shade * 0.97], i * 6);
  }
  geometry.setAttribute('color', new BufferAttribute(color, 3));
  const index: number[] = [];
  for (let i = 0; i < LEAF_SEGMENTS; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  geometry.setIndex(index);
  return geometry;
}

/** Writes a bent leaf into a geometry made by `leafGeometry`. */
export function bendLeaf(geometry: BufferGeometry, length: number, height: number, shape: LeafShape): void {
  const line = leafLine(length, shape);
  const position = geometry.getAttribute('position') as BufferAttribute;
  const normal = geometry.getAttribute('normal') as BufferAttribute;
  for (let i = 0; i <= LEAF_SEGMENTS; i++) {
    for (let j = 0; j < 2; j++) {
      const k = i * 2 + j;
      position.setXYZ(k, line.x[i]!, j * height, line.z[i]!);
      normal.setXYZ(k, line.nx[i]!, 0, line.nz[i]!);
    }
  }
  position.needsUpdate = true;
  normal.needsUpdate = true;
  geometry.computeBoundingSphere();
}
