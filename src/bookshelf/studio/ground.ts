import { DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, PlaneGeometry, ShaderMaterial } from 'three';
import type { ShelfFrame } from '../shelf/types';

/**
 * Contact shadows: where a volume meets the board, the board is dark. A lamp far away cannot draw this,
 * because it comes from all the light the volume keeps off the board, so it is laid down round the foot
 * of every volume, as a function of the distance from the foot in px: a tight crease right at the foot,
 * where no light gets in at all, and a soft patch that reaches a little further out. It follows the
 * outline of the foot all the way round and turns with the volume. Two volumes side by side overlap
 * their shadows in the gap between them, so the gap closes to dark, and under a lifted volume the
 * shadow stays on the board and grows fainter.
 */

const DEG = Math.PI / 180;
/** Most volumes a frame can ground. More than a wide screen ever shows. */
const LIMIT = 192;
/** How far the soft patch reaches out from the foot, in px. */
export const FRONT = 18;
/** Half width of the crease at the foot, in px. */
export const CREASE_PX = 2.5;
/** Darkness of the crease and of the soft patch where each is darkest, before the strength of the look. */
export const CREASE = 0.8;
export const PATCH = 0.38;

/**
 * Alpha of the shadow `distance` px out from the foot of a volume. `lifted` is 1 for a volume standing
 * on the board and falls toward 0.35 as it is raised: the crease goes first, the patch stays.
 */
export function contactAlpha(distance: number, lifted = 1): number {
  const d = Math.max(0, distance);
  if (d >= FRONT) return 0;
  const crease = CREASE * lifted * lifted * Math.exp(-(d * d) / (CREASE_PX * CREASE_PX));
  const t = Math.max(0, 1 - d / FRONT);
  return Math.min(1, crease + PATCH * t * t) * lifted;
}

const vertexShader = /* glsl */ `
attribute float lifted;
varying vec2 vPlace;
varying vec2 vFoot;
varying float vLifted;
varying float vDepth;
void main() {
	// The patch is the foot of the volume and a margin of FRONT px round it; its size is in the instance matrix.
	vec2 size = vec2( length( instanceMatrix[ 0 ].xyz ), length( instanceMatrix[ 2 ].xyz ) );
	vFoot = size * 0.5 - ${FRONT.toFixed(1)};
	vPlace = position.xz * size;
	vLifted = lifted;
	vec4 world = modelMatrix * instanceMatrix * vec4( position, 1.0 );
	vDepth = world.z;
	gl_Position = projectionMatrix * viewMatrix * world;
}`;

const fragmentShader = /* glsl */ `
uniform float strength;
uniform float edge;
varying vec2 vPlace;
varying vec2 vFoot;
varying float vLifted;
varying float vDepth;
void main() {
	// Nothing lies on the air in front of the board.
	if ( vDepth > edge ) discard;
	vec2 q = abs( vPlace ) - vFoot;
	float d = max( 0.0, length( max( q, 0.0 ) ) + min( max( q.x, q.y ), 0.0 ) );
	float crease = ${CREASE.toFixed(2)} * vLifted * vLifted * exp( - d * d / ${(CREASE_PX * CREASE_PX).toFixed(2)} );
	float t = max( 0.0, 1.0 - d / ${FRONT.toFixed(1)} );
	float alpha = min( 1.0, crease + ${PATCH.toFixed(2)} * t * t ) * vLifted * strength;
	gl_FragColor = vec4( 0.102, 0.094, 0.082, alpha );
}`;

export class ContactShadows {
  readonly mesh: InstancedMesh;
  private readonly material: ShaderMaterial;
  private readonly lifted: InstancedBufferAttribute;
  private readonly matrix = new Matrix4();
  private readonly turn = new Matrix4();
  private readonly scale = new Matrix4();

  constructor() {
    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { strength: { value: 0.6 }, edge: { value: 1e6 } },
      transparent: true,
      depthWrite: false,
    });
    // A unit patch lying on the board, its middle at the origin: x across the volume, z along its depth.
    const geometry = new PlaneGeometry(1, 1);
    geometry.rotateX(-Math.PI / 2);
    this.lifted = new InstancedBufferAttribute(new Float32Array(LIMIT).fill(1), 1);
    this.lifted.setUsage(DynamicDrawUsage);
    geometry.setAttribute('lifted', this.lifted);
    this.mesh = new InstancedMesh(geometry, this.material, LIMIT);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /** How dark the shadows are, 0 to 1. Each look has its own: a dark board shows less of them than a pale one. */
  setStrength(value: number): void {
    this.material.uniforms.strength!.value = value;
  }

  /**
   * Lays a shadow round the foot of every volume of the frame that stands in its place. `edge` is how far
   * the board reaches toward the viewer, in px from the row: past it there is nothing to lie on.
   */
  update(frame: ShelfFrame, origin: { x: number; y: number }, edge = 1e6): void {
    let count = 0;
    for (const volume of frame.volumes) {
      if (volume.hidden || count >= LIMIT) continue;
      // A lifted volume keeps less light off the board right under it.
      const lifted = Math.max(0.35, 1 - Math.max(0, volume.lift) / 60);
      this.matrix.makeTranslation(origin.x + volume.x, origin.y + 0.35 + count * 0.002, volume.z);
      this.turn.makeRotationY(-volume.angle * DEG);
      this.matrix.multiply(this.turn);
      // The foot runs from the spine face back by the width of the cover; the patch is centred on it.
      this.turn.makeTranslation(0, 0, -volume.coverWidth / 2);
      this.matrix.multiply(this.turn);
      this.scale.makeScale(volume.spineWidth + 2 * FRONT, 1, volume.coverWidth + 2 * FRONT);
      this.matrix.multiply(this.scale);
      this.mesh.setMatrixAt(count, this.matrix);
      this.lifted.setX(count, lifted);
      count++;
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.lifted.needsUpdate = true;
    this.material.uniforms.edge!.value = edge;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
