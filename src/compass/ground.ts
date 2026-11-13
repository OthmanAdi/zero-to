import { Color, Mesh, PlaneGeometry, ShaderMaterial } from 'three';

/**
 * What the floating compass leaves on the table: a soft contact shadow and, when it is active, a pool of light
 * with a faint ring. One quad, one draw call, no texture.
 *
 * The blending is premultiplied: the colour written is added to the table and the alpha says how much of the
 * table is taken away first. So the same fragment can darken (shadow, alpha only) and brighten (glow, colour
 * only).
 */
export interface GroundUniforms {
  readonly uHalf: { value: number };
  readonly uShadow: { value: number };
  readonly uShadowRadius: { value: number };
  readonly uGlow: { value: number };
  readonly uGlowColor: { value: Color };
  readonly uPoolRadius: { value: number };
  readonly uRingRadius: { value: number };
  readonly uRingWidth: { value: number };
}

export interface Ground {
  readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  readonly uniforms: GroundUniforms;
  dispose(): void;
}

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

const FRAGMENT = /* glsl */ `
varying vec2 vUv;
uniform float uHalf;
uniform float uShadow;
uniform float uShadowRadius;
uniform float uGlow;
uniform vec3 uGlowColor;
uniform float uPoolRadius;
uniform float uRingRadius;
uniform float uRingWidth;

void main() {
  float r = length( ( vUv - 0.5 ) * 2.0 * uHalf );
  // Everything fades out before the edge of the quad, so the quad itself never shows.
  float edge = 1.0 - smoothstep( 0.8 * uHalf, uHalf, r );

  float core = 1.0 - smoothstep( 0.0, uShadowRadius, r );
  float shadow = uShadow * core * core * ( 3.0 - 2.0 * core ) * ( 1.0 - 0.55 * uGlow );

  float pool = exp( - ( r * r ) / ( uPoolRadius * uPoolRadius ) );
  float d = ( r - uRingRadius ) / uRingWidth;
  float ring = exp( - d * d );
  vec3 glow = uGlowColor * uGlow * ( 0.26 * pool + 0.045 * ring );

  gl_FragColor = vec4( glow * edge, shadow * edge );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createGround(half: number, glowColor: string): Ground {
  const uniforms: GroundUniforms = {
    uHalf: { value: half },
    uShadow: { value: 0.5 },
    uShadowRadius: { value: half * 0.5 },
    uGlow: { value: 0 },
    uGlowColor: { value: new Color(glowColor) },
    uPoolRadius: { value: half * 0.42 },
    uRingRadius: { value: half * 0.6 },
    uRingWidth: { value: half * 0.035 },
  };
  const material = new ShaderMaterial({
    uniforms: uniforms as unknown as ShaderMaterial['uniforms'],
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const geometry = new PlaneGeometry(half * 2, half * 2);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new Mesh(geometry, material);
  mesh.name = 'compass-ground';
  mesh.renderOrder = 1;
  return {
    mesh,
    uniforms,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
