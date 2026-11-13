import {
  Color,
  DoubleSide,
  MeshDepthMaterial,
  MeshStandardMaterial,
  ShaderChunk,
  Vector4,
  type ColorRepresentation,
  type IUniform,
  type Texture,
} from 'three';
import { THEME } from '../look/theme';

/**
 * The paper material: a standard lit material with the things that make a sheet read as paper.
 *
 * 1. No sheet is flat. Three slow waves bend it, phased by a seed, and the normal follows the bend.
 * 2. The edge is torn, not cut. The outline is a soft field (see `makeSilhouette`), looked up at a position
 *    that noise has nudged, and cut at one half. The shadow caster uses the same edge.
 * 3. The surface has grain: long fibres crossed by short ones, soft blotches and a few dark flecks. Each layer
 *    fades out where it would be finer than a pixel, so the paper never shimmers.
 * 4. A cut shows its core and its hinge: a lighter band just inside the edge, and a contact shade along the
 *    foot where a standing sheet meets the map.
 * 5. Paper lets light through. A sheet lit from behind glows on the side that faces the viewer.
 *
 * Because it is a patched `MeshStandardMaterial`, real lights, shadow maps, fog and tone mapping keep working.
 * All sheets share one shader program: everything that differs between sheets is a uniform.
 */

/** Tuned values of the scene. Lengths are in scene units. */
export const PAPER = {
  warp: 0.026,
  deckle: 0.006,
  fibre: 0.085,
  rim: 0.55,
  hinge: 0.22,
  through: 0.25,
  roughness: 0.94,
  rimColor: '#fffdf4',
} as const;

export interface PaperOptions {
  /** The print: what is drawn on the sheet. Without it the sheet is plain paper in `color`. */
  readonly map?: Texture | null;
  /** The outline as a soft field, white inside. Without it the whole rectangle is paper and nothing is torn. */
  readonly silhouette?: Texture | null;
  /** Paper tone. It multiplies the print. */
  readonly color?: ColorRepresentation;
  /** Tone of the reverse side. Without it the print shows on both sides. */
  readonly back?: ColorRepresentation | null;
  /** Size of the drawing in scene units: width and height. */
  readonly size?: readonly [width: number, height: number];
  /** Margin round the drawing that the mesh and its textures also cover, in scene units. */
  readonly pad?: number;
  /** Any number. Sheets with different seeds bend and tear differently. */
  readonly seed?: number;
  /** Largest bend out of the plane. */
  readonly warp?: number;
  /** 1 keeps the foot of a standing sheet straight on its hinge line. */
  readonly pinned?: boolean;
  /** How far the torn edge strays, as a share of the sheet's longer side. */
  readonly deckle?: number;
  /** Strength of the fibre grain. */
  readonly fibre?: number;
  /** Strength of the lighter core just inside the cut. */
  readonly rim?: number;
  readonly rimColor?: ColorRepresentation;
  /** Contact shade along the foot, 0 for a sheet that lies flat. */
  readonly hinge?: number;
  /** Share of the light from behind that comes through the sheet. */
  readonly through?: number;
  readonly roughness?: number;
}

export interface PaperUniforms {
  readonly uZtSil: IUniform<Texture | null>;
  readonly uZtHasSil: IUniform<number>;
  /** x, y: size of the drawing. z: padding. w: seed. */
  readonly uZtBox: IUniform<Vector4>;
  /** x: warp, y: pinned, z: deckle, w: fibre. */
  readonly uZtShape: IUniform<Vector4>;
  /** x: rim, y: hinge, z: through, w: 1 when the back has its own tone. */
  readonly uZtShade: IUniform<Vector4>;
  readonly uZtRimColor: IUniform<Color>;
  readonly uZtBack: IUniform<Color>;
  /** 0 normal. 1 shows the sheet as flat white, for measuring its outline in a capture. */
  readonly uZtMatte: IUniform<number>;
}

export type PaperMaterial = MeshStandardMaterial & { readonly userData: { paper: PaperUniforms } };
export type PaperDepthMaterial = MeshDepthMaterial & { readonly userData: { paper: PaperUniforms } };

/** Height of the band at a standing sheet's foot that casts from nearer the light, and by how much. */
const FOOT_BAND = 0.05;
const FOOT_PULL = 0.03;

/** One program for every sheet. The number changes when the shader text changes. */
const PAPER_KEY = 'zt-paper-6';
const PAPER_DEPTH_KEY = 'zt-paper-depth-6';

const GLSL_NOISE = /* glsl */ `
float ztHash( vec2 p ) {
	vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.x + p3.y ) * p3.z );
}
float ztNoise( vec2 p ) {
	vec2 i = floor( p );
	vec2 f = fract( p );
	vec2 u = f * f * ( 3.0 - 2.0 * f );
	return mix(
		mix( ztHash( i ), ztHash( i + vec2( 1.0, 0.0 ) ), u.x ),
		mix( ztHash( i + vec2( 0.0, 1.0 ) ), ztHash( i + vec2( 1.0, 1.0 ) ), u.x ),
		u.y
	);
}
float ztFbm( vec2 p ) {
	float v = 0.5 * ztNoise( p );
	v += 0.25 * ztNoise( p * 2.03 + 17.1 );
	v += 0.125 * ztNoise( p * 4.01 + 43.7 );
	return v / 0.875;
}
`;

/** The bend of a sheet as shader text, so things that lie on a sheet (the route) can bend with it. */
export const PAPER_WARP_GLSL = /* glsl */ `
uniform vec4 uZtBox;
uniform vec4 uZtShape;

// Three slow waves across the sheet. Returns the lift out of the plane and its slope.
float ztWarp( vec2 p, float sheetV, out vec2 slope ) {
	float seed = uZtBox.w * 6.2831853;
	float pin = mix( 1.0, smoothstep( 0.0, 0.4, sheetV ), uZtShape.y );
	float a1 = p.x * 1.54 + seed + 0.3;
	float a2 = p.y * 1.2 + seed * 1.7 + 1.9;
	float a3 = ( p.x * 0.6 + p.y * 0.8 ) * 0.86 + seed * 2.3 + 4.1;
	// A standing sheet bends both ways. A lying sheet rests on its low points and lifts elsewhere, so it
	// never dips into what it lies on.
	float amount = uZtShape.x * pin * mix( 0.5, 1.0, uZtShape.y );
	slope = amount * vec2(
		0.45 * 1.54 * cos( a1 ) + 0.22 * 0.86 * 0.6 * cos( a3 ),
		0.33 * 1.2 * cos( a2 ) + 0.22 * 0.86 * 0.8 * cos( a3 )
	);
	return amount * ( 0.45 * sin( a1 ) + 0.33 * sin( a2 ) + 0.22 * sin( a3 ) + ( 1.0 - uZtShape.y ) );
}
`;

const GLSL_VERTEX_PARS = /* glsl */ `
${PAPER_WARP_GLSL}
varying vec2 vZtUv;
varying vec2 vZtPos;
`;

/** How much each scale of the tear moves the edge, as a share of the deckle. */
const TEAR = [1.2, 0.95, 0.8, 0.66] as const;

const GLSL_FRAGMENT_PARS = /* glsl */ `
#define TEAR_1 ${TEAR[0].toFixed(3)}
#define TEAR_2 ${TEAR[1].toFixed(3)}
#define TEAR_3 ${TEAR[2].toFixed(3)}
#define TEAR_4 ${TEAR[3].toFixed(3)}
uniform sampler2D uZtSil;
uniform float uZtHasSil;
uniform vec4 uZtBox;
uniform vec4 uZtShape;
uniform vec4 uZtShade;
uniform vec3 uZtRimColor;
uniform vec3 uZtBack;
uniform float uZtMatte;
varying vec2 vZtUv;
varying vec2 vZtPos;
${GLSL_NOISE}
// 1 where a pattern of this frequency is coarser than a pixel, 0 where it would alias.
float ztSeen( vec2 coord ) {
	vec2 w = fwidth( coord );
	return 1.0 - smoothstep( 0.45, 1.1, max( w.x, w.y ) );
}
// The outline field at this fragment, looked up where noise has nudged it: the torn edge.
float ztField() {
	if ( uZtHasSil < 0.5 ) return 1.0;
	float longer = max( uZtBox.x, uZtBox.y );
	// Four scales of tear, each rougher than a smooth falloff would make it: the wander of the hand, the bite
	// of the tear, and two scales of frayed fibre. Each fades out where it would be finer than a pixel, so
	// the fray appears as the camera comes close and never glitters from afar.
	vec2 q = vZtPos / longer + uZtBox.w * 0.37;
	vec2 q1 = q * 26.0;
	vec2 q2 = q * 61.0 + 5.3;
	vec2 q3 = q * 143.0 + 9.7;
	vec2 q4 = q * 331.0 + 3.1;
	vec2 nudge = ( vec2( ztNoise( q1 ), ztNoise( q1 + vec2( 31.7, 11.3 ) ) ) - 0.5 ) * TEAR_1
		+ ( vec2( ztNoise( q2 ), ztNoise( q2 + vec2( 13.1, 47.9 ) ) ) - 0.5 ) * TEAR_2 * ztSeen( q2 )
		+ ( vec2( ztNoise( q3 ), ztNoise( q3 + vec2( 71.3, 23.9 ) ) ) - 0.5 ) * TEAR_3 * ztSeen( q3 )
		+ ( vec2( ztNoise( q4 ), ztNoise( q4 + vec2( 17.9, 61.1 ) ) ) - 0.5 ) * TEAR_4 * ztSeen( q4 );
	vec2 padded = uZtBox.xy + 2.0 * uZtBox.z;
	return texture2D( uZtSil, vZtUv + nudge * uZtShape.z * longer / padded ).r;
}
// Long thin streaks of noise lying three ways, like the fibres of felt. Centred on 0.
float ztFibres( vec2 p ) {
	vec2 q1 = vec2( 0.574 * p.x - 0.819 * p.y, 0.819 * p.x + 0.574 * p.y );
	vec2 q2 = vec2( - 0.423 * p.x - 0.906 * p.y, 0.906 * p.x - 0.423 * p.y );
	float f = ztNoise( p * vec2( 150.0, 9.0 ) )
		+ ztNoise( q1 * vec2( 171.0, 7.0 ) + 19.0 )
		+ ztNoise( q2 * vec2( 133.0, 11.0 ) + 47.0 );
	return ( f / 3.0 - 0.5 ) * 1.15;
}
`;

const GLSL_VERTEX_BEGIN = /* glsl */ `
	vec2 ztPadded = uZtBox.xy + 2.0 * uZtBox.z;
	vZtUv = uv;
	vZtPos = position.xy;
	float ztSheetV = ( uv.y * ztPadded.y - uZtBox.z ) / uZtBox.y;
	vec2 ztSlope;
	float ztLift = ztWarp( position.xy, ztSheetV, ztSlope );
`;

/** The values a sheet's two materials share. Change `.value` and both follow. */
export function createPaperUniforms(options: PaperOptions = {}): PaperUniforms {
  const size = options.size ?? [1, 1];
  return {
    uZtSil: { value: options.silhouette ?? null },
    uZtHasSil: { value: options.silhouette ? 1 : 0 },
    uZtBox: { value: new Vector4(size[0], size[1], options.pad ?? 0, options.seed ?? 0) },
    uZtShape: {
      value: new Vector4(options.warp ?? PAPER.warp, options.pinned ? 1 : 0, options.deckle ?? PAPER.deckle, options.fibre ?? PAPER.fibre),
    },
    uZtShade: {
      value: new Vector4(
        options.rim ?? PAPER.rim,
        options.hinge ?? 0,
        options.through ?? PAPER.through,
        options.back === undefined || options.back === null ? 0 : 1,
      ),
    },
    uZtRimColor: { value: new Color(options.rimColor ?? PAPER.rimColor) },
    uZtBack: { value: new Color(options.back ?? THEME.paper) },
    uZtMatte: { value: 0 },
  };
}

function bind(shader: { uniforms: Record<string, IUniform> }, uniforms: PaperUniforms): void {
  for (const [name, uniform] of Object.entries(uniforms)) shader.uniforms[name] = uniform;
}

/**
 * The stock shadow lookup pushes its sample along the surface normal to hide acne. That is right for the lit
 * side of a sheet. On the other side the push lands behind the sheet, so a sheet lit from behind would shade
 * its own glow. Paper therefore makes the push twice, once each way, and keeps the sample that is nearer the
 * light. Neither side of a sheet shades itself, and everything else still casts its shadow on both.
 */
const SPOT_LOOKUP = 'vSpotLightCoord[ i ] = spotLightMatrix[ i ] * shadowWorldPosition;';
const DIR_LOOKUP = 'vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;';

/** The shadow lookup of paper, or null when this three.js lays the stock one out differently. */
export function paperShadowVertex(): string | null {
  const chunk = ShaderChunk.shadowmap_vertex;
  if (!chunk.includes(SPOT_LOOKUP) || !chunk.includes(DIR_LOOKUP)) return null;
  return chunk
    .replace(
      SPOT_LOOKUP,
      /* glsl */ `${SPOT_LOOKUP}
		#if ( defined( USE_SHADOWMAP ) && UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		{
			vec4 ztFar = spotLightMatrix[ i ] * vec4( worldPosition.xyz - shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias, 1.0 );
			if ( ztFar.w < vSpotLightCoord[ i ].w ) vSpotLightCoord[ i ] = ztFar;
		}
		#endif`,
    )
    .replace(
      DIR_LOOKUP,
      /* glsl */ `${DIR_LOOKUP}
			{
				vec4 ztFar = directionalShadowMatrix[ i ] * vec4( worldPosition.xyz - shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 1.0 );
				if ( ztFar.z < vDirectionalShadowCoord[ i ].z ) vDirectionalShadowCoord[ i ] = ztFar;
			}`,
    );
}

/** Creates the lit material of a sheet. */
export function createPaperMaterial(options: PaperOptions = {}): PaperMaterial {
  const uniforms = createPaperUniforms(options);
  const material = new MeshStandardMaterial({
    color: options.color ?? (options.map ? '#ffffff' : THEME.paper),
    map: options.map ?? null,
    roughness: options.roughness ?? PAPER.roughness,
    metalness: 0,
    side: DoubleSide,
    shadowSide: DoubleSide,
    alphaTest: 0.5,
    alphaToCoverage: true,
  });
  material.userData.paper = uniforms;
  material.onBeforeCompile = (shader) => {
    bind(shader, uniforms);
    const shadowVertex = paperShadowVertex();
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${GLSL_VERTEX_PARS}`)
      .replace(
        '#include <beginnormal_vertex>',
        `${GLSL_VERTEX_BEGIN}\n#include <beginnormal_vertex>\n\tobjectNormal = normalize( vec3( - ztSlope, 1.0 ) );`,
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\ttransformed.z += ztLift;');
    if (shadowVertex) shader.vertexShader = shader.vertexShader.replace('#include <shadowmap_vertex>', shadowVertex);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_FRAGMENT_PARS}`)
      .replace(
        '#include <lights_physical_pars_fragment>',
        /* glsl */ `#include <lights_physical_pars_fragment>
// Light from behind comes through the sheet, softened and tinted by the paper.
void RE_Direct_Paper( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	float ztBehind = saturate( - dot( geometryNormal, directLight.direction ) );
	reflectedLight.directDiffuse += ztBehind * uZtShade.z * directLight.color * BRDF_Lambert( material.diffuseContribution );
}
#undef RE_Direct
#define RE_Direct RE_Direct_Paper`,
      )
      .replace(
        '#include <alphatest_fragment>',
        /* glsl */ `
	// The reverse side of a printed sheet is plain paper.
	if ( uZtShade.w > 0.5 && ! gl_FrontFacing ) diffuseColor.rgb = uZtBack;

	float ztEdge = ztField();
	float ztSheetV = ( vZtUv.y * ( uZtBox.y + 2.0 * uZtBox.z ) - uZtBox.z ) / uZtBox.y;

	// Grain: fibres lying three ways like felt, soft blotches, a few dark flecks.
	vec2 ztP = vZtPos + uZtBox.w * 3.1;
	vec2 ztFine = ztP * 150.0;
	float ztGrain = ztFibres( ztP ) * ztSeen( ztFine )
		+ ( ztFbm( ztP * 9.0 ) - 0.5 ) * 0.45
		+ ( ztFbm( ztP * 1.4 + 7.7 ) - 0.5 ) * 0.55;
	diffuseColor.rgb *= 1.0 + ztGrain * uZtShape.w;
	vec2 ztCell = ztP * 162.0;
	float ztFleck = step( 0.9965, ztHash( floor( ztCell ) ) ) * ztSeen( ztCell ) * step( 0.001, uZtShape.w );
	diffuseColor.rgb *= 1.0 - 0.15 * ztFleck;

	// The cut shows a lighter core just inside the edge.
	float ztRim = smoothstep( 0.5, 0.585, ztEdge ) * ( 1.0 - smoothstep( 0.585, 0.8, ztEdge ) ) * uZtHasSil;
	diffuseColor.rgb = mix( diffuseColor.rgb, uZtRimColor, ztRim * uZtShade.x );

	// Contact shade where a standing sheet meets the map.
	diffuseColor.rgb *= 1.0 - uZtShade.y * ( 1.0 - smoothstep( 0.0, 0.085, ztSheetV ) );

	diffuseColor.a = ztEdge;
#include <alphatest_fragment>`,
      )
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `
	if ( uZtMatte > 0.5 ) outgoingLight = vec3( 1.0e3 );
#include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => PAPER_KEY;
  return material as PaperMaterial;
}

/**
 * Creates the shadow caster that belongs to a paper material. It bends and tears exactly as the sheet does,
 * because it reads the same uniforms, so the shadow has the sheet's own outline. Put it on the mesh as
 * `customDepthMaterial`.
 */
export function createPaperDepthMaterial(source: PaperMaterial | PaperUniforms): PaperDepthMaterial {
  const uniforms = 'uZtBox' in source ? source : source.userData.paper;
  const material = new MeshDepthMaterial({ side: DoubleSide });
  material.userData.paper = uniforms;
  material.onBeforeCompile = (shader) => {
    bind(shader, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${GLSL_VERTEX_PARS}`)
      .replace('#include <begin_vertex>', `${GLSL_VERTEX_BEGIN}\n#include <begin_vertex>\n\ttransformed.z += ztLift;`)
      .replace(
        '#include <project_vertex>',
        /* glsl */ `#include <project_vertex>
	// The foot of a standing sheet casts from a little nearer the light. That closes the sliver of light
	// which shadow bias would leave between a foot and its shadow, and it shades the foot itself, the way
	// a sheet is darkest where it meets the map.
	float ztFoot = ( 1.0 - smoothstep( 0.0, ${FOOT_BAND.toFixed(3)}, ztSheetV * uZtBox.y ) ) * uZtShape.y;
	mvPosition.z += ztFoot * ${FOOT_PULL.toFixed(3)};
	gl_Position = projectionMatrix * mvPosition;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_FRAGMENT_PARS}`)
      .replace('#include <alphatest_fragment>', '\tif ( ztField() < 0.5 ) discard;');
  };
  material.customProgramCacheKey = () => PAPER_DEPTH_KEY;
  return material as PaperDepthMaterial;
}

/** The uniforms of a paper material, for changing a sheet after it is built. */
export function paperUniforms(material: PaperMaterial | PaperDepthMaterial): PaperUniforms {
  return material.userData.paper;
}
