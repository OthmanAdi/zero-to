/**
 * The room the volumes are lit in: a dim studio with soft boxes, drawn once into an environment map.
 * A warm key stands high on the left behind the viewer, in the direction the stage's key light shines
 * from (38 degrees left, 42 up), so a reflection and a shadow tell of the same lamp. A weak fill, close to
 * neutral, stands low on the right: the room may turn a little and the white of a cover must not turn
 * with it. Narrow strips and a top light give gloss and foil something sharp to reflect, and two lamps
 * behind the shelf catch edges. The caller turns the room with `scene.environmentRotation`.
 */
import * as THREE from 'three';

export interface StudioEnvironment {
  texture: THREE.Texture;
  dispose(): void;
}

/** One lamp of the room: a lit rectangle that faces the centre. */
export interface SoftBox {
  /** Where it stands, the viewer being on +z and up being +y. */
  position: readonly [number, number, number];
  size: readonly [number, number];
  /** Linear colour. */
  color: readonly [number, number, number];
  /** Radiance against a white card at 1. */
  intensity: number;
  /** Share of the rectangle taken by its soft edge, 0 (hard) to 1. */
  feather: number;
}

export const STUDIO_LAMPS: readonly SoftBox[] = [
  // Key: a warm box front left and well above the eye, with an edge, so gloss shows a window and not a haze.
  { position: [-5.7, 8.3, 7.3], size: [7, 6], color: [1, 0.94, 0.86], intensity: 4.2, feather: 0.3 },
  // Fill: wider, close to neutral and much weaker, front right.
  { position: [8.1, 1.4, 5.7], size: [9, 8], color: [0.86, 0.91, 1], intensity: 1.0, feather: 0.8 },
  // Top light along the row.
  { position: [0, 10, 3], size: [12, 3], color: [1, 0.97, 0.92], intensity: 4, feather: 0.4 },
  // Narrow strips: the sharp lines that run across gloss and foil.
  // The one nearest the eye is the band that crosses a cover as it turns: narrow, so it passes a title and does not sit on it.
  { position: [-1.5, 0.8, 11], size: [0.3, 10], color: [1, 0.95, 0.88], intensity: 22, feather: 0.12 },
  { position: [4.2, 0.5, 10], size: [0.38, 9], color: [0.86, 0.92, 1], intensity: 17, feather: 0.12 },
  { position: [-10, 1, 3.5], size: [0.5, 9], color: [1, 0.9, 0.8], intensity: 15, feather: 0.12 },
  // Behind the shelf, for edges and for a volume turned away.
  { position: [-9, 3, -7], size: [5, 5], color: [1, 0.8, 0.6], intensity: 3.5, feather: 0.6 },
  { position: [8.5, 4.5, -7.5], size: [4, 6], color: [0.7, 0.82, 1], intensity: 3, feather: 0.6 },
  // Light coming back off the table.
  { position: [0, -8, 3], size: [16, 12], color: [1, 0.9, 0.78], intensity: 0.45, feather: 0.8 },
];

/** Opacity of a soft box at (u, v) in 0 to 1: full in the middle, falling off over the feathered rim. */
export function softBoxFalloff(u: number, v: number, feather: number): number {
  const rim = Math.max(1e-4, feather * 0.5);
  const edge = Math.min(u, 1 - u, v, 1 - v);
  const t = Math.max(0, Math.min(1, edge / rim));
  return t * t * (3 - 2 * t);
}

function falloffTexture(feather: number): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const at = (y * size + x) * 4;
      data[at] = data[at + 1] = data[at + 2] = 255;
      data[at + 3] = Math.round(softBoxFalloff((x + 0.5) / size, (y + 0.5) / size, feather) * 255);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Draws the room and filters it for every roughness. `size` is the edge of a cube face in pixels. */
export function createStudioEnvironment(renderer: THREE.WebGLRenderer, size = 256): StudioEnvironment {
  const room = new THREE.Scene();
  const disposables: { dispose(): void }[] = [];

  // Walls: a little light from above, warm and darker at the floor, so no reflection is ever pure black.
  const shell = new THREE.BoxGeometry(60, 40, 60);
  const position = shell.getAttribute('position');
  const tones = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index += 1) {
    const top = position.getY(index) > 0;
    tones.set(top ? [0.3, 0.31, 0.34] : [0.1, 0.09, 0.08], index * 3);
  }
  shell.setAttribute('color', new THREE.BufferAttribute(tones, 3));
  const walls = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, toneMapped: false });
  room.add(new THREE.Mesh(shell, walls));
  disposables.push(shell, walls);

  const plane = new THREE.PlaneGeometry(1, 1);
  disposables.push(plane);
  for (const lamp of STUDIO_LAMPS) {
    const falloff = falloffTexture(lamp.feather);
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(lamp.color[0] * lamp.intensity, lamp.color[1] * lamp.intensity, lamp.color[2] * lamp.intensity),
      map: falloff,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(plane, material);
    mesh.position.set(lamp.position[0], lamp.position[1], lamp.position[2]);
    mesh.scale.set(lamp.size[0], lamp.size[1], 1);
    mesh.lookAt(0, 0, 0);
    room.add(mesh);
    disposables.push(falloff, material);
  }

  const generator = new THREE.PMREMGenerator(renderer);
  const target = generator.fromScene(room, 0, 0.1, 100, { size });
  generator.dispose();
  for (const item of disposables) item.dispose();
  target.texture.name = 'bb-studio-environment';

  return {
    texture: target.texture,
    dispose: () => target.dispose(),
  };
}
