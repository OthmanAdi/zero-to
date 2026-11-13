import {
  CanvasTexture,
  Color,
  LinearMipmapLinearFilter,
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
}

/**
 * The glass dome without a transmission pass. The surface has no colour of its own, so all it adds is what it
 * reflects: the room, the lamp and a cool rim where it turns away from the eye. The shader is patched in two
 * places: the rim light is added to the outgoing light, and the reflections are blended on top of the dial at
 * full strength (premultiplied blending) while the alpha only says how much the glass dims what is behind it.
 */
export function createGlass(setup: MaterialSetup): { material: MeshPhysicalMaterial; uniforms: GlassUniforms } {
  const uniforms: GlassUniforms = {
    glassRim: { value: new Color(setup.colors.glass) },
    glassRimStrength: { value: 0.1 },
    glassEdge: { value: 0.2 },
  };
  const material = new MeshPhysicalMaterial({
    color: 0x000000,
    metalness: 0,
    roughness: 0.06,
    ior: 1.52,
    specularIntensity: 1,
    specularColor: new Color(setup.colors.glass),
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    envMap: setup.envMap,
    envMapIntensity: 0.32,
    transparent: true,
    opacity: 0.05,
    premultipliedAlpha: true,
    depthWrite: false,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.glassRim = uniforms.glassRim;
    shader.uniforms.glassRimStrength = uniforms.glassRimStrength;
    shader.uniforms.glassEdge = uniforms.glassEdge;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        'uniform vec3 glassRim;\nuniform float glassRimStrength;\nuniform float glassEdge;\nvoid main() {',
      )
      .replace(
        '#include <opaque_fragment>',
        [
          'float glassFacing = saturate( abs( dot( normalize( normal ), normalize( vViewPosition ) ) ) );',
          'float glassFresnel = pow( 1.0 - glassFacing, 4.0 );',
          'outgoingLight += glassRim * glassRimStrength * glassFresnel;',
          '#include <opaque_fragment>',
          'gl_FragColor.a = saturate( diffuseColor.a + glassEdge * glassFresnel );',
        ].join('\n'),
      )
      // The reflections are already what should be added; do not scale them by the alpha.
      .replace('#include <premultiplied_alpha_fragment>', '');
  };
  material.customProgramCacheKey = () => 'zero-to-compass-glass';
  return { material, uniforms };
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
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.name = 'compass-dial';
  return texture;
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
