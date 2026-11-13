import { Color, Mesh, PlaneGeometry, ShaderMaterial } from 'three';

/**
 * A faint glow in the air behind the compass, so the dark side of the brass stands out from the dark room.
 *
 * It is one quad that always faces the viewer. The vertex shader does that itself (it places the corners in view
 * space round the centre of the mesh), so the part never needs to know the camera. The quad sits behind the
 * compass as seen from the eye and fades out towards the table, so it never shows an edge where it would cut
 * into the table top.
 */
export interface HaloUniforms {
  readonly uColor: { value: Color };
  readonly uStrength: { value: number };
  /** Radius of the quad in scene units. */
  readonly uRadius: { value: number };
  /** How far behind the centre of the compass the quad sits, away from the eye. */
  readonly uBack: { value: number };
}

export interface Halo {
  readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  readonly uniforms: HaloUniforms;
  dispose(): void;
}

const VERTEX = /* glsl */ `
uniform float uRadius;
uniform float uBack;
varying vec2 vUv;
varying float vHeight;
void main() {
  vUv = uv;
  vec4 centre = modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
  vec4 corner = centre + vec4( position.xy * uRadius, - uBack, 0.0 );
  vHeight = ( inverse( viewMatrix ) * corner ).y;
  gl_Position = projectionMatrix * corner;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uStrength;
varying vec2 vUv;
varying float vHeight;
void main() {
  float r = length( vUv - 0.5 ) * 2.0;
  float glow = exp( - r * r * 3.4 ) * ( 1.0 - smoothstep( 0.7, 1.0, r ) );
  glow *= smoothstep( 0.0, 1.1, vHeight );
  // Alpha 0 with premultiplied blending: the colour is only added.
  gl_FragColor = vec4( uColor * uStrength * glow, 0.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createHalo(radius: number, back: number, color: string): Halo {
  const uniforms: HaloUniforms = {
    uColor: { value: new Color(color) },
    uStrength: { value: 0 },
    uRadius: { value: radius },
    uBack: { value: back },
  };
  const material = new ShaderMaterial({
    uniforms: uniforms as unknown as ShaderMaterial['uniforms'],
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
  });
  const geometry = new PlaneGeometry(2, 2);
  const mesh = new Mesh(geometry, material);
  mesh.name = 'compass-halo';
  // The shader moves the corners, so the bounds of the geometry say nothing about where it is drawn.
  mesh.frustumCulled = false;
  return {
    mesh,
    uniforms,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
