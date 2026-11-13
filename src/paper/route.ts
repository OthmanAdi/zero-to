import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  MeshStandardMaterial,
  Vector4,
  type ColorRepresentation,
  type IUniform,
} from 'three';
import { THEME } from '../look/theme';
import { PAPER_WARP_GLSL, type PaperDepthMaterial, type PaperMaterial } from './material';
import type { Vec3 } from './motion';

/**
 * The route: printed ink on the map. It is a flat ribbon that the shader turns into a dashed, slightly
 * bleeding line. It is lit like the paper it lies on, so it falls into shade with its panel and does not glow.
 *
 * The ribbon is drawn up to `draw` (a length along the route), so the route appears as the walker advances.
 * The part up to `walked` is a solid line: the way already done.
 */

export const ROUTE = {
  width: 0.05,
  /** Height above the paper. */
  lift: 0.004,
  /** Length of one dash and its gap together, and the share of it that is ink. */
  period: 0.15,
  ink: 0.6,
} as const;

export interface RouteOptions {
  readonly color?: ColorRepresentation;
  readonly period?: number;
  readonly ink?: number;
  readonly seed?: number;
  /**
   * The lying sheet the route is printed on. The ribbon then bends with that sheet. Its mesh must be a child
   * of the sheet's `object`, with the route laid out in that frame (x across, z down the sheet).
   */
  readonly follow?: PaperMaterial | PaperDepthMaterial;
}

export interface RouteUniforms {
  /** x: drawn length. y: walked length. z: dash period. w: ink share. */
  readonly uZtRoute: IUniform<Vector4>;
  /** x: lift added to every vertex. y: seed. z: 1 when the ribbon follows a sheet. */
  readonly uZtRouteLift: IUniform<Vector4>;
  /** The followed sheet's box and shape, shared with its material. */
  readonly uZtBox: IUniform<Vector4>;
  readonly uZtShape: IUniform<Vector4>;
}

export type RouteMaterial = MeshStandardMaterial & {
  readonly userData: { route: RouteUniforms };
  /** Reveals the route up to this length. */
  setDraw(length: number): void;
  /** Makes the route solid up to this length. */
  setWalked(length: number): void;
  /** Raises the whole ribbon, for a panel whose cards have lifted. */
  setLift(lift: number): void;
};

const ROUTE_KEY = 'zt-route-3';

/** Creates the ink material for a ribbon from `createRouteGeometry`. One program serves every route. */
export function createRouteMaterial(options: RouteOptions = {}): RouteMaterial {
  const uniforms: RouteUniforms = {
    uZtRoute: { value: new Vector4(1e9, 0, options.period ?? ROUTE.period, options.ink ?? ROUTE.ink) },
    uZtRouteLift: { value: new Vector4(0, options.seed ?? 0, options.follow ? 1 : 0, 0) },
    uZtBox: options.follow?.userData.paper.uZtBox ?? { value: new Vector4(1, 1, 0, 0) },
    uZtShape: options.follow?.userData.paper.uZtShape ?? { value: new Vector4(0, 0, 0, 0) },
  };
  const material = new MeshStandardMaterial({
    color: new Color(options.color ?? THEME.signal),
    roughness: 0.9,
    metalness: 0,
    side: DoubleSide,
    alphaTest: 0.5,
    alphaToCoverage: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  }) as RouteMaterial;
  material.userData.route = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
attribute float aS;
attribute float aV;
uniform vec4 uZtRouteLift;
varying vec2 vZtRoute;
${PAPER_WARP_GLSL}`,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
	vec2 ztRouteSlope;
	transformed.y += uZtRouteLift.x + uZtRouteLift.z * ztWarp( vec2( position.x, - position.z ), 1.0, ztRouteSlope );
	vZtRoute = vec2( aS, aV );`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
uniform vec4 uZtRoute;
uniform vec4 uZtRouteLift;
varying vec2 vZtRoute;
float ztRouteHash( vec2 p ) {
	vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.x + p3.y ) * p3.z );
}
float ztRouteNoise( vec2 p ) {
	vec2 i = floor( p );
	vec2 f = fract( p );
	vec2 u = f * f * ( 3.0 - 2.0 * f );
	return mix(
		mix( ztRouteHash( i ), ztRouteHash( i + vec2( 1.0, 0.0 ) ), u.x ),
		mix( ztRouteHash( i + vec2( 0.0, 1.0 ) ), ztRouteHash( i + vec2( 1.0, 1.0 ) ), u.x ),
		u.y
	);
}`,
      )
      .replace(
        '#include <alphatest_fragment>',
        /* glsl */ `
	float ztS = vZtRoute.x;
	float ztV = abs( vZtRoute.y );
	float ztSeed = uZtRouteLift.y * 13.7;
	float ztBleed = ztRouteNoise( vec2( ztS * 58.0, sign( vZtRoute.y ) * 7.0 + ztSeed ) );
	// Across: the ink ends where the edge noise says, so the line is not ruled.
	float ztInk = 0.92 - ( ztV + ztBleed * 0.55 );
	// Along: dashes beyond the walked part, each with a ragged end.
	float ztPhase = fract( ztS / uZtRoute.z );
	float ztRag = ( ztRouteNoise( vec2( ztS * 97.0 + 5.0, vZtRoute.y * 2.3 + ztSeed ) ) - 0.5 ) * 0.08;
	float ztDash = min( ztPhase + 0.02, uZtRoute.w + ztRag - ztPhase ) * uZtRoute.z * 14.0;
	float ztSolid = step( ztS, uZtRoute.y );
	ztInk = min( ztInk, mix( ztDash, 1.0, ztSolid ) );
	// The drawn end.
	ztInk = min( ztInk, ( uZtRoute.x - ztS ) * 30.0 );
	diffuseColor.rgb *= 0.9 + 0.14 * ztRouteNoise( vec2( ztS * 9.0, vZtRoute.y * 3.0 + ztSeed ) );
	diffuseColor.a = clamp( 0.5 + ztInk / max( 1.0e-4, fwidth( ztInk ) * 1.5 ), 0.0, 1.0 );
	#ifdef ALPHA_TO_COVERAGE
	if ( diffuseColor.a <= 0.0 ) discard;
	#else
	if ( diffuseColor.a < 0.5 ) discard;
	#endif`,
      );
  };
  material.customProgramCacheKey = () => ROUTE_KEY;
  material.setDraw = (length) => {
    uniforms.uZtRoute.value.x = length;
  };
  material.setWalked = (length) => {
    uniforms.uZtRoute.value.y = length;
  };
  material.setLift = (lift) => {
    uniforms.uZtRouteLift.value.x = lift;
  };
  return material;
}

export interface RouteGeometryOptions {
  readonly width?: number;
  /** Height above each point. */
  readonly lift?: number;
  /** Length along the route at the first point, when a route continues from another panel. */
  readonly startLength?: number;
}

export interface RouteRibbon {
  readonly geometry: BufferGeometry;
  /** Length along the route at the last point. */
  readonly length: number;
  /** Length along the route at every input point. */
  readonly lengths: readonly number[];
}

/**
 * Builds the ribbon for a route through `points`. The route lies on the ground: its width is laid out in the
 * XZ plane and every point keeps its own height. Lengths are measured in the XZ plane too, so dashes keep
 * their size on a slope.
 */
export function createRouteGeometry(points: readonly Vec3[], options: RouteGeometryOptions = {}): RouteRibbon {
  const half = (options.width ?? ROUTE.width) / 2;
  const lift = options.lift ?? ROUTE.lift;
  const count = points.length;
  const positions: number[] = [];
  const normals: number[] = [];
  const along: number[] = [];
  const across: number[] = [];
  const indices: number[] = [];
  const lengths: number[] = [];
  let length = options.startLength ?? 0;

  for (let i = 0; i < count; i += 1) {
    const point = points[i] as Vec3;
    const before = points[Math.max(0, i - 1)] as Vec3;
    const after = points[Math.min(count - 1, i + 1)] as Vec3;
    if (i > 0) length += Math.hypot(point.x - before.x, point.z - before.z);
    lengths.push(length);
    let tx = after.x - before.x;
    let tz = after.z - before.z;
    const size = Math.hypot(tx, tz) || 1;
    tx /= size;
    tz /= size;
    // The left of the direction of travel, seen from above.
    const sx = tz;
    const sz = -tx;
    positions.push(point.x + sx * half, point.y + lift, point.z + sz * half);
    positions.push(point.x - sx * half, point.y + lift, point.z - sz * half);
    normals.push(0, 1, 0, 0, 1, 0);
    along.push(length, length);
    across.push(1, -1);
    if (i < count - 1) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('aS', new Float32BufferAttribute(along, 1));
  geometry.setAttribute('aV', new Float32BufferAttribute(across, 1));
  geometry.setIndex(indices);
  return { geometry, length, lengths };
}
