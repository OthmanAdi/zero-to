import { Matrix4, PerspectiveCamera } from 'three';
import type { FrameVolume, ShelfFrame } from '../shelf/types';

/**
 * Studio draws in the CSS shelf's own space: one unit is one CSS px, the origin is the scene's
 * perspective origin (the middle of the scene box), x runs right, y up and z toward the viewer.
 * A camera placed `perspective` px in front of that origin, looking straight in, projects every point
 * exactly where the browser projects the same point of the DOM, so the painted volumes cover the
 * transparent DOM ones that keep the controls.
 */

const DEG = Math.PI / 180;

/** Extra canvas above and below the scene box, as a share of its height: lifted and dropping volumes leave the box. */
export const MARGIN_TOP = 0.32;
export const MARGIN_BOTTOM = 0.12;

export interface CanvasBox {
  /** Canvas size in CSS px. */
  width: number;
  height: number;
  /** How far the canvas starts above the scene box, in CSS px. */
  top: number;
}

export function canvasBox(width: number, height: number): CanvasBox {
  const top = Math.round(height * MARGIN_TOP);
  return { width, height: height + top + Math.round(height * MARGIN_BOTTOM), top };
}

/**
 * Sets a camera to match CSS `perspective: <perspective>px` with its origin at the middle of a
 * `width` x `height` box, drawing into a canvas that reaches `box.top` px above that box.
 */
export function fitCamera(camera: PerspectiveCamera, width: number, height: number, perspective: number, box: CanvasBox): void {
  const p = Math.max(1, perspective);
  camera.fov = (2 * Math.atan(height / 2 / p)) / DEG;
  camera.aspect = width / height;
  camera.near = Math.max(1, p * 0.05);
  camera.far = p * 4;
  camera.position.set(0, 0, p);
  camera.lookAt(0, 0, 0);
  // The canvas is a window onto a larger image whose middle is still the perspective origin.
  camera.setViewOffset(width, height, 0, -box.top, box.width, box.height);
  camera.updateProjectionMatrix();
}

/** Where the foot of the row's centre stands in Studio space. */
export function rowOrigin(frame: Pick<ShelfFrame, 'height' | 'floorY' | 'rowGive'>): { x: number; y: number } {
  return { x: frame.rowGive, y: frame.floorY - frame.height / 2 };
}

const scratch = new Matrix4();

/**
 * The matrix that takes a volume's own space (origin at the foot of the spine's middle, the spine face in
 * the plane z = 0, the body running back to z = -coverWidth) to Studio space, built from the same parts
 * and in the same order as the shelf's CSS transform. CSS has y down: a CSS rotateZ(a) is a turn of -a
 * here, and a CSS translateY(t) a move of -t.
 */
export function volumeMatrix(volume: FrameVolume, origin: { x: number; y: number }, out = new Matrix4()): Matrix4 {
  out.makeTranslation(origin.x + volume.x + volume.corner, origin.y + volume.lift, volume.z);
  if (volume.lean !== 0) out.multiply(scratch.makeRotationZ(-volume.lean * DEG));
  if (volume.corner !== 0) out.multiply(scratch.makeTranslation(-volume.corner, 0, 0));
  if (volume.tilt !== 0) out.multiply(scratch.makeRotationZ(-volume.tilt * DEG));
  if (volume.angle !== 0) out.multiply(scratch.makeRotationY(-volume.angle * DEG));
  return out;
}

/**
 * A CSS matrix (y down) as a Studio matrix (y up): conjugation by a flip of y, which changes the sign of
 * every entry that mixes y with another axis.
 */
export function fromCssMatrix(matrix: DOMMatrixReadOnly, out = new Matrix4()): Matrix4 {
  const m = matrix;
  // Matrix4.set takes rows; DOMMatrix mRC is column C, row R in the CSS convention (m41 is x translation).
  out.set(
    m.m11, -m.m21, m.m31, m.m41,
    -m.m12, m.m22, -m.m32, -m.m42,
    m.m13, -m.m23, m.m33, m.m43,
    m.m14, -m.m24, m.m34, m.m44,
  );
  return out;
}
