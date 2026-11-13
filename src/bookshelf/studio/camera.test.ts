import { Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { FrameVolume } from '../shelf/types';
import { canvasBox, fitCamera, fromCssMatrix, rowOrigin, volumeMatrix } from './camera';

function volume(parts: Partial<FrameVolume>): FrameVolume {
  return {
    id: 'a',
    index: 0,
    slot: 0,
    item: { id: 'a', title: 'A' },
    element: document.createElement('li'),
    spineWidth: 40,
    bookHeight: 300,
    coverWidth: 200,
    x: 0,
    corner: 0,
    lean: 0,
    tilt: 0,
    angle: 0,
    lift: 0,
    z: 0,
    weight: 0,
    centre: false,
    hidden: false,
    ...parts,
  };
}

const at = (matrix: Matrix4, x: number, y: number, z: number) => new Vector3(x, y, z).applyMatrix4(matrix);

describe('Studio camera', () => {
  it('projects a point in the plane of the scene where CSS draws it', () => {
    const camera = new PerspectiveCamera();
    const box = canvasBox(1200, 500);
    fitCamera(camera, 1200, 500, 2000, box);
    camera.updateMatrixWorld();
    // The top-left corner of the scene box, in Studio space, lands on the canvas where the box starts.
    const corner = new Vector3(-600, 250, 0).project(camera);
    const px = ((corner.x + 1) / 2) * box.width;
    const py = ((1 - corner.y) / 2) * box.height;
    expect(px).toBeCloseTo(0, 3);
    expect(py).toBeCloseTo(box.top, 3);
    // A point brought toward the viewer is drawn larger about the perspective origin, as CSS does it.
    const near = new Vector3(100, 0, 400).project(camera);
    const drawnX = ((near.x + 1) / 2) * box.width - 600;
    expect(drawnX).toBeCloseTo(100 * (2000 / (2000 - 400)), 3);
  });

  it('puts the foot of the row on the floor line', () => {
    expect(rowOrigin({ height: 500, floorY: 30, rowGive: 12 })).toEqual({ x: 12, y: -220 });
  });

  it('turns a volume so its front board faces the viewer at 90 degrees', () => {
    const matrix = volumeMatrix(volume({ angle: 90 }), { x: 0, y: 0 });
    const normal = new Vector3(1, 0, 0).transformDirection(matrix);
    expect(normal.z).toBeCloseTo(1, 6);
    // The board's plane, half a spine to the right, comes round to stand half a spine in front.
    const hinge = at(matrix, 20, 0, 0);
    expect(hinge.x).toBeCloseTo(0, 6);
    expect(hinge.z).toBeCloseTo(20, 6);
  });

  it('leans about the corner that stays on the floor, the way the CSS transform does', () => {
    const lean = volumeMatrix(volume({ lean: -10, corner: -20, x: 50 }), { x: 0, y: 0 });
    // CSS rotateZ(-10deg) about the left foot corner: that corner does not move.
    const foot = at(lean, -20, 0, 0);
    expect(foot.x).toBeCloseTo(30, 6);
    expect(foot.y).toBeCloseTo(0, 6);
    // The head leans left: a CSS rotateZ(-10deg) turns a point above the corner toward -x.
    const head = at(lean, -20, 300, 0);
    expect(head.x).toBeLessThan(30);
  });

  it('lifts with the CSS lift and keeps CSS y down out of Studio space', () => {
    const lifted = at(volumeMatrix(volume({ lift: 12 }), { x: 0, y: -100 }), 0, 0, 0);
    expect(lifted.y).toBeCloseTo(-88, 6);
  });

  it('reads a CSS matrix with y down as the same motion with y up', () => {
    const css = { m11: 1, m12: 0, m13: 0, m14: 0, m21: 0, m22: 1, m23: 0, m24: 0, m31: 0, m32: 0, m33: 1, m34: 0, m41: 3, m42: -6, m43: 2, m44: 1 };
    const matrix = fromCssMatrix(css as unknown as DOMMatrixReadOnly);
    const moved = at(matrix, 0, 0, 0);
    // CSS translateY(-6px) moves up the screen: +6 here.
    expect(moved.toArray()).toEqual([3, 6, 2]);
  });
});
