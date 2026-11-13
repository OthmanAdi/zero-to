import type { Light } from './types';

/**
 * One light for every face of every volume. A face's brightness is a Lambert term against the look's
 * light, relative to a face square to the viewer at the centre of the row, and the shelf draws the
 * difference as a film of the light's tint over the face. A face square to the viewer at the centre
 * therefore keeps its own colour exactly.
 */

/** Light from the upper left and in front: what a volume looks like when a look names no light. */
export const DEFAULT_LIGHT: Light = { x: -0.42, z: 0.91, ambient: 0.42, tint: '#000' };

/**
 * A lamp above the centre of the row, a little over two cover widths in front of it. The spines at the
 * edges of a wide screen get about four tenths of the light the centre gets.
 */
export const DEFAULT_LAMP: Light = { x: 0, z: 2.2, ambient: 0.4, tint: '#120a02', lamp: { reach: 1.8, floor: 0.55 } };

/** No face goes darker than this, so a board turned fully away still shows its cloth. */
const DEEPEST = 0.72;

export interface FaceShades {
  spine: number;
  /** The front board, where the cover is printed. */
  front: number;
  back: number;
}

export function resolveLight(light: Light | undefined): Light {
  return light ?? DEFAULT_LIGHT;
}

/** Share of a lamp's light that reaches a volume `offset` cover widths from the centre of the row. */
export function lampReach(light: Light, offset: number): number {
  if (!light.lamp) return 1;
  const reach = Math.max(0.01, light.lamp.reach);
  return Math.max(light.lamp.floor, 1 / (1 + (offset / reach) ** 2));
}

function direction(x: number, z: number): [number, number] {
  const length = Math.hypot(x, z) || 1;
  return [x / length, z / length];
}

/** Brightest the sheen on a board ever gets, as an opacity of the light's colour. */
const SHEEN = 0.12;
/** How tight the highlight is: high enough that it only shows in the last twenty degrees of a turn. */
const SHEEN_POWER = 14;
/** Where the band of the sheen comes to rest on a presented board, as a background position. */
const SWEEP_REST = 0.625;

/**
 * Background position of the sheen's band for a volume with focus weight `weight`: it enters at the
 * fore-edge late in the turn and comes to rest over the third of the board nearest the light.
 */
export function sweepOf(weight: number): number {
  const t = Math.min(1, Math.max(0, (weight - 0.55) / 0.45));
  return SWEEP_REST * t * t * (3 - 2 * t);
}

/**
 * Opacity of the soft highlight a cloth board catches as it turns to face the viewer: strong only where
 * the board's normal is close to half way between the light and the viewer.
 */
export function sheenOf(light: Light, angle: number, offset = 0): number {
  const [lx, lz] = light.lamp ? direction(light.x - offset, light.z) : direction(light.x, light.z);
  const [hx, hz] = direction(lx, lz + 1);
  const radians = (angle * Math.PI) / 180;
  const facing = Math.max(0, Math.cos(radians) * hx + Math.sin(radians) * hz);
  return SHEEN * lampReach(light, offset) * facing ** SHEEN_POWER;
}

/**
 * Shade of the three faces of a volume turned by `angle` degrees (0 shows the spine, 90 the cover),
 * standing `offset` cover widths right of the centre of the row. Only a lamp cares where a volume stands:
 * it lights each volume from its own side and less the further away it is.
 */
export function faceShades(light: Light, angle: number, offset = 0): FaceShades {
  const ambient = Math.min(1, Math.max(0, light.ambient));
  const lamp = light.lamp !== undefined;
  const [lx, lz] = lamp ? direction(light.x - offset, light.z) : direction(light.x, light.z);
  // The reference is a face square to the viewer at the centre of the row, wherever this volume stands.
  const centreZ = lamp ? direction(light.x, light.z)[1] : lz;
  const lit = (nx: number, nz: number): number => ambient + (1 - ambient) * Math.max(0, nx * lx + nz * lz);
  // A light that misses the viewer's side entirely leaves nothing to compare against; treat it as faint.
  const square = Math.max(0.05, ambient + (1 - ambient) * Math.max(0, centreZ));
  const share = lampReach(light, offset);
  const shade = (nx: number, nz: number): number =>
    Math.min(DEEPEST, Math.max(0, 1 - (share * lit(nx, nz)) / square));
  const radians = (angle * Math.PI) / 180;
  const sin = Math.sin(radians);
  const cos = Math.cos(radians);
  return {
    spine: shade(-sin, cos),
    front: shade(cos, sin),
    back: shade(-cos, -sin),
  };
}
