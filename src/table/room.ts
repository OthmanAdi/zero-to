import {
  CanvasTexture,
  Color,
  CylinderGeometry,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  PlaneGeometry,
  RGBAFormat,
  RepeatWrapping,
  SRGBColorSpace,
  UnsignedByteType,
  type Texture,
} from 'three';
import { createRandom } from '../core/random';
import { THEME, hexToRgb } from '../look/theme';
import type { SceneEnvironment } from '../scene/contract';

/** The room under the lamp: a dark cloth and, on it, the round walnut turntable. */
export const ROOM = {
  tableRadius: 9,
  tableThickness: 0.09,
  tableSegments: 160,
  grooveInner: 8.64,
  grooveOuter: 8.71,
  cloth: { width: 300, depth: 150, tile: 3.4 },
  /** Rings per scene unit across a plank. */
  ringFrequency: 5.2,
  plankWidth: 2.35,
  side: '#120d09',
  groove: '#070504',
} as const;

/** How strongly paper, cloth and wood take light from the shared environment map. The room is dark. */
export const ROOM_ENV = { paper: 0.16, wood: 0.34, cloth: 0.05 } as const;

export interface RoomPiece<T extends Mesh = Mesh> {
  readonly mesh: T;
  dispose(): void;
}

// ---------------------------------------------------------------------------------------------------------
// The cloth.

function weaveCanvas(size: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const random = createRandom('zero-to-cloth');
  const image = context.createImageData(size, size);
  const data = image.data;
  const deep = hexToRgb(THEME.clothDeep);
  const high = hexToRgb(THEME.cloth);

  // Mottling: a coarse grid of tones, read back smoothly and wrapped, so the tile has no seam.
  const cells = 8;
  const blotch = Array.from({ length: cells * cells }, () => random());
  const mottle = (x: number, y: number): number => {
    const u = (x / size) * cells;
    const v = (y / size) * cells;
    const i = Math.floor(u);
    const j = Math.floor(v);
    const fu = u - i;
    const fv = v - j;
    const su = fu * fu * (3 - 2 * fu);
    const sv = fv * fv * (3 - 2 * fv);
    const at = (a: number, b: number): number => blotch[(((b % cells) + cells) % cells) * cells + (((a % cells) + cells) % cells)] as number;
    return (at(i, j) * (1 - su) + at(i + 1, j) * su) * (1 - sv) + (at(i, j + 1) * (1 - su) + at(i + 1, j + 1) * su) * sv;
  };

  // Slubs: thicker stretches of single threads.
  const slub = new Float32Array(size * size);
  for (let i = 0; i < 420; i += 1) {
    const along = random() < 0.5;
    const thread = Math.floor(random() * (size / 4)) * 4;
    const start = Math.floor(random() * size);
    const length = 10 + Math.floor(random() * 46);
    const strength = 0.1 + random() * 0.22;
    for (let k = 0; k < length; k += 1) {
      const fade = Math.sin((Math.PI * k) / length);
      for (let w = 0; w < 3; w += 1) {
        const x = along ? (start + k) % size : (thread + w) % size;
        const y = along ? (thread + w) % size : (start + k) % size;
        slub[y * size + x] = Math.max(slub[y * size + x] as number, strength * fade);
      }
    }
  }

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // Plain weave: threads two pixels wide with a pixel of shade between, running over and under in turn.
      const over = ((x >> 2) + (y >> 2)) % 2 === 0;
      const across = over ? y & 3 : x & 3;
      const round = across === 1 || across === 2 ? 1 : 0.45;
      const lengthwise = over ? x & 3 : y & 3;
      const dip = lengthwise === 0 || lengthwise === 3 ? 0.82 : 1;
      let tone = 0.2 + 0.5 * round * dip;
      tone *= 0.82 + 0.36 * mottle(x, y);
      tone += slub[y * size + x] as number;
      tone += (random() - 0.5) * 0.08;
      const t = Math.min(1, Math.max(0, tone));
      const o = (y * size + x) * 4;
      data[o] = Math.round((deep[0] + (high[0] - deep[0]) * t) * 255);
      data[o + 1] = Math.round((deep[1] + (high[1] - deep[1]) * t) * 255);
      data[o + 2] = Math.round((deep[2] + (high[2] - deep[2]) * t) * 255);
      data[o + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

/** The cloth the table stands on: dark bookcloth with a woven tile, far larger than the view. */
export function createCloth(environment: SceneEnvironment): RoomPiece {
  const canvas = weaveCanvas(512);
  let map: Texture | null = null;
  if (canvas) {
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.repeat.set(ROOM.cloth.width / ROOM.cloth.tile, ROOM.cloth.depth / ROOM.cloth.tile);
    texture.anisotropy = environment.phone ? 2 : 8;
    map = texture;
  }
  const material = new MeshStandardMaterial({
    color: map ? 0xffffff : new Color(THEME.cloth),
    map,
    roughness: 0.97,
    metalness: 0,
    envMap: environment.envMap,
    envMapIntensity: ROOM_ENV.cloth,
    // Away from the lamp the cloth is the room: it keeps a trace of its own tone instead of going black.
    emissive: new Color(THEME.night),
    emissiveIntensity: 0.55,
  });
  const geometry = new PlaneGeometry(ROOM.cloth.width, ROOM.cloth.depth);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new Mesh(geometry, material);
  mesh.name = 'table-cloth';
  mesh.position.y = -ROOM.tableThickness;
  mesh.receiveShadow = true;
  return {
    mesh,
    dispose() {
      geometry.dispose();
      material.dispose();
      map?.dispose();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// The wood.

/**
 * A field of numbers the wood shader reads, baked once: red is a smooth cloudy noise (it bends the growth
 * rings), green is noise drawn out along one axis (the fibres), blue is speckle (the pores). It tiles, and its
 * mip levels fade each fine layer where it would be smaller than a pixel.
 */
function woodField(size: number): DataTexture {
  const random = createRandom('zero-to-walnut');
  const data = new Uint8Array(size * size * 4);
  const cloud = new Float32Array(size * size);
  let weight = 0;
  for (const [cells, gain] of [
    [6, 1],
    [14, 0.5],
    [34, 0.25],
    [80, 0.12],
  ] as const) {
    const grid = Array.from({ length: cells * cells }, () => random());
    weight += gain;
    for (let y = 0; y < size; y += 1) {
      const v = (y / size) * cells;
      const j = Math.floor(v);
      const fv = v - j;
      const sv = fv * fv * (3 - 2 * fv);
      for (let x = 0; x < size; x += 1) {
        const u = (x / size) * cells;
        const i = Math.floor(u);
        const fu = u - i;
        const su = fu * fu * (3 - 2 * fu);
        const i1 = (i + 1) % cells;
        const j1 = (j + 1) % cells;
        const a = grid[j * cells + i] as number;
        const b = grid[j * cells + i1] as number;
        const c = grid[j1 * cells + i] as number;
        const d = grid[j1 * cells + i1] as number;
        cloud[y * size + x] = (cloud[y * size + x] as number) + gain * ((a * (1 - su) + b * su) * (1 - sv) + (c * (1 - su) + d * su) * sv);
      }
    }
  }
  // Fibres: white noise averaged along y, wrapped.
  const raw = new Float32Array(size * size);
  for (let i = 0; i < raw.length; i += 1) raw[i] = random();
  const reach = 9;
  for (let x = 0; x < size; x += 1) {
    let sum = 0;
    for (let k = -reach; k <= reach; k += 1) sum += raw[(((k % size) + size) % size) * size + x] as number;
    for (let y = 0; y < size; y += 1) {
      const o = (y * size + x) * 4;
      data[o] = Math.round(Math.min(1, Math.max(0, (cloud[y * size + x] as number) / weight)) * 255);
      // The running mean of 19 samples is narrow; stretch it back over the full range.
      data[o + 1] = Math.round(Math.min(1, Math.max(0, 0.5 + (sum / (2 * reach + 1) - 0.5) * 3.4)) * 255);
      data[o + 2] = Math.round(random() * 255);
      data[o + 3] = 255;
      sum += (raw[((y + reach + 1) % size) * size + x] as number) - (raw[((y - reach + size) % size) * size + x] as number);
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  texture.colorSpace = NoColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

const WOOD_VERTEX_HEAD = /* glsl */ `
varying vec2 vWood;
`;

const WOOD_VERTEX_BODY = /* glsl */ `
#include <begin_vertex>
vWood = position.xz;
`;

const WOOD_FRAGMENT_HEAD = /* glsl */ `
uniform sampler2D uWoodField;
uniform vec3 uWoodLight;
uniform vec3 uWoodDark;
uniform vec3 uGroove;
uniform vec4 uWoodShape;
varying vec2 vWood;
float woodTone = 0.5;
float woodGroove = 0.0;
`;

/**
 * The top is glued from planks that run along z. Each plank is a cut through its own log: the growth rings are
 * circles round a pith that lies beside and below the plank and climbs slowly along it, so some planks show
 * straight grain and some show the arches of a flat-sawn board.
 */
const WOOD_FRAGMENT_COLOR = /* glsl */ `
#include <color_fragment>
{
  vec2 p = vWood;
  float plankWidth = uWoodShape.y;
  float across = p.x / plankWidth + 0.5;
  float plank = floor( across );
  float within = ( fract( across ) - 0.5 ) * plankWidth;
  float h1 = fract( sin( plank * 91.7 + 3.1 ) * 43758.5453 );
  float h2 = fract( sin( plank * 37.3 + 4.7 ) * 24634.6345 );
  float h3 = fract( sin( plank * 12.9 + 9.2 ) * 13758.1173 );

  float along = p.y + ( h3 - 0.5 ) * 40.0;
  float bend = texture2D( uWoodField, vec2( p.x * 0.045 + h1 * 5.0, along * 0.021 ) ).r - 0.5;
  float bend2 = texture2D( uWoodField, vec2( p.x * 0.16 + h2 * 3.0, along * 0.075 ) ).r - 0.5;
  float pithAcross = within + ( h1 - 0.5 ) * 3.4 + bend * 0.9;
  float pithBelow = 0.35 + h2 * 1.5 + along * ( h3 - 0.5 ) * 0.085 + bend2 * 0.25;
  float radius = length( vec2( pithAcross, pithBelow ) );
  float phase = radius * uWoodShape.x + bend * 2.2 + bend2 * 0.7;
  float ringFade = 1.0 - smoothstep( 0.22, 0.75, fwidth( phase ) );
  float ring = fract( phase );
  float late = smoothstep( 0.35, 0.93, ring ) * ( 1.0 - smoothstep( 0.93, 1.0, ring ) );

  vec3 fine = texture2D( uWoodField, vec2( p.x * 0.62, along * 0.034 ) ).rgb;
  vec3 finer = texture2D( uWoodField, vec2( p.x * 2.3 + 0.31, along * 0.11 + 0.17 ) ).rgb;
  float fibre = ( fine.g - 0.5 ) * 0.34 + ( finer.g - 0.5 ) * 0.2;
  float pore = smoothstep( 0.6, 0.95, finer.b * 0.55 + finer.g * 0.6 );

  float tone = 0.44 - 0.24 * late * ringFade + ( 1.0 - ringFade ) * -0.08;
  tone += fibre * 0.8 - 0.09 * pore;
  tone *= 0.84 + 0.26 * h2;
  tone += bend * 0.16;

  // The joint between two planks: a hair of shadow.
  float joint = abs( abs( fract( across ) - 0.5 ) - 0.5 ) * plankWidth;
  float jointWidth = max( 0.006, fwidth( p.x ) * 0.8 );
  tone *= 1.0 - 0.5 * ( 1.0 - smoothstep( 0.0, jointWidth, joint ) );

  tone = clamp( tone, 0.0, 1.0 );
  vec3 wood = mix( uWoodDark, uWoodLight, tone * tone * ( 3.0 - 2.0 * tone ) );
  // Warmer in the early wood, a touch greyer where the plank is pale.
  wood *= mix( vec3( 1.0, 0.94, 0.86 ), vec3( 1.0 ), tone );

  // The turned groove near the rim, and the worn lip of the edge.
  float r = length( p );
  float aa = max( 0.004, fwidth( r ) );
  woodGroove = smoothstep( uWoodShape.z - aa, uWoodShape.z + aa, r ) * ( 1.0 - smoothstep( uWoodShape.w - aa, uWoodShape.w + aa, r ) );
  float inner = smoothstep( uWoodShape.z - 0.05, uWoodShape.z, r ) * ( 1.0 - woodGroove );
  wood = mix( wood, uGroove, woodGroove );
  wood *= 1.0 + 0.12 * inner * step( r, uWoodShape.z + 0.01 );
  wood *= 1.0 - 0.3 * smoothstep( 8.9, 9.0, r );

  woodTone = tone;
  diffuseColor.rgb *= wood;
}
`;

const WOOD_FRAGMENT_ROUGHNESS = /* glsl */ `
#include <roughnessmap_fragment>
roughnessFactor = clamp( roughnessFactor + ( woodTone - 0.5 ) * 0.22 + woodGroove * 0.3, 0.3, 1.0 );
`;

/**
 * The turntable: a walnut disc, varnished, with a turned groove near the rim so the eye can follow the turn.
 * Its top is at y = 0. The grain is drawn in the shader in the disc's own space, so it turns with the table.
 */
export function createTableTop(environment: SceneEnvironment): RoomPiece {
  const field = woodField(environment.phone ? 256 : 512);
  field.anisotropy = environment.phone ? 4 : 16;
  const uniforms = {
    uWoodField: { value: field },
    uWoodLight: { value: new Color(THEME.walnut) },
    uWoodDark: { value: new Color(THEME.walnutDeep) },
    uGroove: { value: new Color(ROOM.groove) },
    uWoodShape: { value: [ROOM.ringFrequency, ROOM.plankWidth, ROOM.grooveInner, ROOM.grooveOuter] },
  };
  const top = new MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.62,
    metalness: 0,
    ior: 1.43,
    specularIntensity: 0.72,
    clearcoat: 0.12,
    clearcoatRoughness: 0.5,
    envMap: environment.envMap,
    envMapIntensity: ROOM_ENV.wood,
  });
  top.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WOOD_VERTEX_HEAD}`)
      .replace('#include <begin_vertex>', WOOD_VERTEX_BODY);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${WOOD_FRAGMENT_HEAD}`)
      .replace('#include <color_fragment>', WOOD_FRAGMENT_COLOR)
      .replace('#include <roughnessmap_fragment>', WOOD_FRAGMENT_ROUGHNESS);
  };
  top.customProgramCacheKey = () => 'zero-to-table-wood';
  const side = new MeshStandardMaterial({ color: new Color(ROOM.side), roughness: 0.7, metalness: 0 });

  const geometry = new CylinderGeometry(ROOM.tableRadius, ROOM.tableRadius, ROOM.tableThickness, ROOM.tableSegments, 1, false);
  geometry.translate(0, -ROOM.tableThickness / 2, 0);
  // Cylinder groups: 0 is the wall, 1 the top cap, 2 the bottom cap.
  const mesh = new Mesh(geometry, [side, top, side]);
  mesh.name = 'table-top';
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return {
    mesh,
    dispose() {
      geometry.dispose();
      top.dispose();
      side.dispose();
      field.dispose();
    },
  };
}
