import { describe, expect, it } from 'vitest';
import { bendLeaf, gutterShade, leafGeometry, leafLine, leafTangent, LEAF_KNEE, LEAF_SEGMENTS } from './leaf';

const lengthOf = (line: { x: number[]; z: number[] }) => {
  let total = 0;
  for (let i = 1; i < line.x.length; i++) total += Math.hypot(line.x[i]! - line.x[i - 1]!, line.z[i]! - line.z[i - 1]!);
  return total;
};

describe('a bent leaf', () => {
  it('lies flat against the block when shut', () => {
    const line = leafLine(200, { angle: 0, curl: 0 });
    expect(line.x.every((x) => Math.abs(x) < 1e-9)).toBe(true);
    expect(line.z.at(-1)).toBeCloseTo(-200, 6);
  });

  it('stands straight out from the spine at a quarter turn', () => {
    const line = leafLine(200, { angle: Math.PI / 2, curl: 0 });
    expect(line.x.at(-1)).toBeCloseTo(200, 6);
    expect(line.z.at(-1)).toBeCloseTo(0, 6);
  });

  it('keeps its length however it bends', () => {
    for (const shape of [{ angle: 0.4, curl: 1.2 }, { angle: 1.2, curl: -0.9 }, { angle: 2.6, curl: 0.5 }]) {
      expect(lengthOf(leafLine(180, shape))).toBeCloseTo(180, 0);
    }
  });

  it('turns its outer part on its own without a kink and without stretching', () => {
    const shape = { angle: 0.3, curl: -0.1, flick: 0.4 };
    // Up to the knee the flick changes nothing; at the edge all of it has been gained.
    expect(leafTangent(shape, LEAF_KNEE)).toBeCloseTo(0.3 - 0.1 * LEAF_KNEE, 9);
    expect(leafTangent(shape, 1)).toBeCloseTo(0.3 - 0.1 + 0.4, 9);
    // The direction is continuous across the knee.
    expect(leafTangent(shape, LEAF_KNEE + 1e-6) - leafTangent(shape, LEAF_KNEE - 1e-6)).toBeCloseTo(0, 5);
    expect(lengthOf(leafLine(180, shape))).toBeCloseTo(180, 0);
  });

  it('is darker in the gutter and full paper white from a third of its length', () => {
    expect(gutterShade(0)).toBeLessThan(0.65);
    expect(gutterShade(0.16)).toBeGreaterThan(gutterShade(0));
    expect(gutterShade(0.33)).toBe(1);
    expect(gutterShade(1)).toBe(1);
    const color = leafGeometry().getAttribute('color');
    expect(color.count).toBe((LEAF_SEGMENTS + 1) * 2);
    expect(color.getX(0)).toBeCloseTo(gutterShade(0), 6);
    expect(color.getX(color.count - 1)).toBe(1);
  });

  it('writes unit normals and both edges of the leaf', () => {
    const geometry = leafGeometry();
    bendLeaf(geometry, 150, 300, { angle: 0.8, curl: 0.6 });
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    expect(position.count).toBe((LEAF_SEGMENTS + 1) * 2);
    expect(position.getY(1)).toBe(300);
    for (let k = 0; k < normal.count; k++) {
      expect(Math.hypot(normal.getX(k), normal.getY(k), normal.getZ(k))).toBeCloseTo(1, 5);
    }
  });
});
