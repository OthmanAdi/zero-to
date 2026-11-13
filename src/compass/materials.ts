import {
  CanvasTexture,
  ClampToEdgeWrapping,
  Color,
  LinearMipmapLinearFilter,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  SRGBColorSpace,
  type Material,
  type Texture,
} from 'three';
import { createRandom } from '../core/random';
import { layoutDial } from './dial-layout';
import { paintDial, type DialColors } from './dial-texture';

/** The colours the compass is made of. Every one defaults to the scene palette. */
export interface CompassColors {
  readonly brass: string;
  readonly brassDeep: string;
  readonly steel: string;
  readonly glass: string;
  readonly paper: string;
  readonly paperShade: string;
  readonly ink: string;
  readonly inkSoft: string;
  /** The north half of the needle and the north mark. */
  readonly signal: string;
  /** The light pool on the table. */
  readonly lamp: string;
}

export interface MaterialSetup {
  readonly colors: CompassColors;
  readonly envMap: Texture | null;
  readonly phone: boolean;
}

/**
 * Lacquered brass. The colour comes from the vertices (each merged part has its own tint), the metal is brushed
 * round the turning axis so highlights stretch across it, and a thin clear coat adds a second, sharp reflection.
 * Phones get the plain metal: one lobe, no anisotropy.
 */
export function createBrass(setup: MaterialSetup): MeshStandardMaterial {
  const common = {
    color: 0xffffff,
    vertexColors: true,
    metalness: 1,
    roughness: 0.21,
    envMap: setup.envMap,
    envMapIntensity: 0.85,
  };
  const material = setup.phone
    ? new MeshStandardMaterial(common)
    : new MeshPhysicalMaterial({
        ...common,
        anisotropy: 0.4,
        anisotropyRotation: 0,
        clearcoat: 0.3,
        clearcoatRoughness: 0.05,
      });
  return darkenBelowHorizon(material, 0.2, setup.phone ? 'phone' : 'desktop');
}

/**
 * The room map shows a bright floor, but under the compass there is a dark table. This patch dims every
 * reflection whose mirror direction points below the horizon, so the underside of the metal reflects darkness.
 * `floor` is what is left of a reflection that points straight down.
 */
export function darkenBelowHorizon<T extends MeshStandardMaterial>(material: T, floor: number, key: string): T {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.tableFloor = { value: floor };
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform float tableFloor;\nvoid main() {')
      .replace(
        '#include <lights_fragment_end>',
        [
          '#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )',
          // A direction times the view matrix from the left is that direction in world space.
          '  vec3 tableDir = normalize( ( vec4( reflect( - geometryViewDir, geometryNormal ), 0.0 ) * viewMatrix ).xyz );',
          '  float tableFade = mix( tableFloor, 1.0, smoothstep( -0.6, 0.12, tableDir.y ) );',
          '  radiance *= tableFade;',
          '  #ifdef USE_CLEARCOAT',
          '    clearcoatRadiance *= tableFade;',
          '  #endif',
          '#endif',
          '#include <lights_fragment_end>',
        ].join('\n'),
      );
  };
  material.customProgramCacheKey = () => `zero-to-compass-brass-${key}`;
  return material;
}

/** The engraved ring round the card: the same metal, a little paler and more matt, so the marks stay readable. */
export function createDialRing(setup: MaterialSetup, dial: Texture | null): MeshStandardMaterial {
  const color = new Color(setup.colors.brass).lerp(new Color(setup.colors.paper), 0.16);
  return new MeshStandardMaterial({
    color,
    metalness: 1,
    roughness: 0.42,
    map: dial,
    bumpMap: dial,
    bumpScale: dial ? 1.4 : 0,
    envMap: setup.envMap,
    envMapIntensity: 0.7,
  });
}

/** The paper card. The painted dial is its colour, its relief and its sheen. */
export function createCard(setup: MaterialSetup, dial: Texture | null): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: dial ? 0xffffff : new Color(setup.colors.paper),
    metalness: 0,
    roughness: 1,
    map: dial,
    roughnessMap: dial,
    bumpMap: dial,
    bumpScale: dial ? 0.5 : 0,
    envMap: setup.envMap,
    envMapIntensity: 0.14,
  });
}

/** Matt red enamel for the north half of the needle. It can glow a little when the compass is active. */
export function createNeedleNorth(setup: MaterialSetup): MeshStandardMaterial {
  const common = {
    color: new Color(setup.colors.signal),
    emissive: new Color(setup.colors.signal),
    emissiveIntensity: 0,
    metalness: 0,
    roughness: 0.42,
    envMap: setup.envMap,
    envMapIntensity: 0.45,
  };
  return new MeshStandardMaterial(common);
}

/** Blued steel for the south half: the steel colour pulled most of the way to the ink, so it reads against the card. */
export function createNeedleSouth(setup: MaterialSetup): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: new Color(setup.colors.steel).lerp(new Color(setup.colors.ink), 0.72),
    metalness: 0.7,
    roughness: 0.38,
    envMap: setup.envMap,
    envMapIntensity: 0.6,
  });
}

export interface GlassUniforms {
  readonly glassRim: { value: Color };
  readonly glassRimStrength: { value: number };
  readonly glassEdge: { value: number };
  /** The brightest a reflection on the glass can get, in linear light before tone mapping. */
  readonly glassCap: { value: number };
}

/**
 * The glass dome without a transmission pass. The surface has no colour of its own, so all it adds is what it
 * reflects: a faint ghost of the room, one small glint of the lamp and a thin cool rim where it turns away from
 * the eye. The shader is patched in three places:
 *
 * - the rim light is added to the outgoing light;
 * - the outgoing light goes through a soft knee, so a highlight approaches `glassCap` and no further, however
 *   strong the lamp of the host is: the glint stays a small bright point instead of growing into a white patch;
 * - the reflection is laid over the dial instead of added to it: the alpha is at least as large as the brightest
 *   channel, so reflection plus dial can never exceed white and the rose stays readable under the glint.
 */
export function createGlass(setup: MaterialSetup): { material: MeshPhysicalMaterial; uniforms: GlassUniforms } {
  const uniforms: GlassUniforms = {
    glassRim: { value: new Color(setup.colors.glass) },
    glassRimStrength: { value: 0.09 },
    glassEdge: { value: 0.16 },
    glassCap: { value: 1.5 },
  };
  const material = new MeshPhysicalMaterial({
    color: 0x000000,
    metalness: 0,
    // The base lobe is wide and weak: a soft bloom round the glint. The clear coat is the glint itself.
    roughness: 0.3,
    ior: 1.52,
    specularIntensity: 0.12,
    specularColor: new Color(setup.colors.glass),
    clearcoat: 1,
    clearcoatRoughness: 0.07,
    envMap: setup.envMap,
    envMapIntensity: 0.1,
    transparent: true,
    opacity: 0.04,
    premultipliedAlpha: true,
    depthWrite: false,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.glassRim = uniforms.glassRim;
    shader.uniforms.glassRimStrength = uniforms.glassRimStrength;
    shader.uniforms.glassEdge = uniforms.glassEdge;
    shader.uniforms.glassCap = uniforms.glassCap;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        [
          'uniform vec3 glassRim;',
          'uniform float glassRimStrength;',
          'uniform float glassEdge;',
          'uniform float glassCap;',
          'void main() {',
        ].join('\n'),
      )
      .replace(
        '#include <opaque_fragment>',
        [
          'float glassFacing = saturate( abs( dot( normalize( normal ), normalize( vViewPosition ) ) ) );',
          'float glassFresnel = pow( 1.0 - glassFacing, 5.0 );',
          'outgoingLight += glassRim * glassRimStrength * glassFresnel;',
          'float glassPeak = max( outgoingLight.r, max( outgoingLight.g, outgoingLight.b ) );',
          'outgoingLight *= 1.0 / ( 1.0 + glassPeak / glassCap );',
          '#include <opaque_fragment>',
          'gl_FragColor.a = saturate( diffuseColor.a + glassEdge * glassFresnel );',
        ].join('\n'),
      )
      // By now the colour is tone mapped. Do not scale it by the alpha; raise the alpha to cover it instead.
      .replace(
        '#include <premultiplied_alpha_fragment>',
        'gl_FragColor.a = max( gl_FragColor.a, max( gl_FragColor.r, max( gl_FragColor.g, gl_FragColor.b ) ) );',
      );
  };
  material.customProgramCacheKey = () => 'zero-to-compass-glass';
  return { material, uniforms };
}

/**
 * The soft shadow of the needle on the dial: black, with the softness in the vertex alpha of its geometry. The
 * shadow maps of a table-sized lamp cannot resolve something this small, so the compass draws it itself.
 */
export function createNeedleShadow(): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color: 0x0a0704,
    vertexColors: true,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
    toneMapped: false,
  });
}

/**
 * How the painted dial is put on the dial plane. The canvas is used as painted: flipped once vertically (the
 * three.js default, so the top row of the canvas is v = 1, which the dial geometry maps to north), never
 * mirrored, repeated or turned.
 */
export function configureDialTexture<T extends Texture>(texture: T): T {
  texture.colorSpace = SRGBColorSpace;
  texture.flipY = true;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.repeat.set(1, 1);
  texture.offset.set(0, 0);
  texture.rotation = 0;
  texture.anisotropy = 8;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.name = 'compass-dial';
  return texture;
}

/**
 * Paints the dial into a canvas texture. Returns null where there is no 2D canvas (tests, very old browsers);
 * the compass then falls back to plain colours.
 */
export function createDialTexture(colors: CompassColors, size: number, seed: number | string): CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext('2d');
  } catch {
    ctx = null;
  }
  if (!ctx) return null;
  const dialColors: DialColors = {
    paper: colors.paper,
    paperShade: colors.paperShade,
    ink: colors.ink,
    inkSoft: colors.inkSoft,
    signal: colors.signal,
    engraving: '#1a130b',
  };
  paintDial(ctx, {
    size,
    layout: layoutDial({ tickStep: size >= 2048 ? 2 : 5 }),
    colors: dialColors,
    random: createRandom(seed),
  });
  return configureDialTexture(new CanvasTexture(canvas));
}

/** The side of the dial canvas for a device. */
export function dialTextureSize(maxTexture: number, phone: boolean): number {
  const cap = phone ? 1024 : 2048;
  const size = Math.min(cap, Math.max(256, Math.floor(maxTexture)));
  // Powers of two mip cleanly.
  return 2 ** Math.floor(Math.log2(size));
}

export function disposeMaterial(material: Material | Material[]): void {
  for (const one of Array.isArray(material) ? material : [material]) one.dispose();
}
