import { CanvasTexture, Color, CylinderGeometry, Group, Mesh, MeshStandardMaterial, RepeatWrapping, SphereGeometry, SRGBColorSpace, Vector3 } from 'three';
import { createRandom } from '../core/random';
import { THEME } from '../look/theme';
import { bounceFloor, clamp01, easeInOutCubic, settleSpring, spring, stepSpringKC, type Spring } from '../paper/motion';
import type { SceneEnvironment } from '../scene/contract';

/** The red pin that marks you-are-here: a paper ball on a steel needle. */
export const PIN = {
  /**
   * Radius of the head. A head of 0.029 is under five pixels across in the hero at 1440 by 900; at 0.038 it shows
   * the 40 pixels of signal the hero is checked for. The dive has to end `diveDistance` from the centre of the
   * head for it to fill the frame.
   */
  radius: 0.038,
  /** Distance from the centre of the head at which its angular radius is 36 degrees: radius / sin(36 degrees). */
  diveDistance: 0.038 / Math.sin((36 * Math.PI) / 180),
  /** Height of the needle. */
  needle: 0.23,
  /** How far above its place the pin starts its fall. */
  drop: 0.29,
  k: 200,
  c: 13,
  /** Share of its speed the pin keeps when it bounces off the card. */
  bounce: 0.25,
  /** Seconds the pin takes to press flat into a printed dot, and to stand up from one. */
  press: 0.22,
} as const;

export interface Pin {
  readonly object: Group;
  /** 0 is a dot in the print, 1 is the standing pin. */
  readonly up: number;
  /** Stand the pin up (it drops in) or press it back into the print. */
  setStanding(standing: boolean, immediate?: boolean): void;
  /** Light the sheet under the pin keeps. */
  setDim(light: number): void;
  /** `anchor` is the foot of the needle in the space of the pin's parent. */
  update(dt: number, anchor: Vector3, reduced: boolean): void;
  /** Centre of the head in world space. */
  headWorld(target?: Vector3): Vector3;
  dispose(): void;
}

function fibreTexture(): CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const random = createRandom('zero-to-pin');
  context.fillStyle = '#f2f2f2';
  context.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 520; i += 1) {
    const tone = random() < 0.5 ? 255 : 150;
    context.fillStyle = `rgba(${tone},${tone},${tone},${0.1 + random() * 0.22})`;
    context.fillRect(random() * 64, random() * 64, 1 + random() * 4, 1);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(3, 2);
  return texture;
}

export function createPin(environment: SceneEnvironment): Pin {
  const object = new Group();
  object.name = 'pin';

  const fibre = fibreTexture();
  const signal = new Color(THEME.signal);
  const headMaterial = new MeshStandardMaterial({
    color: signal.clone(),
    map: fibre,
    bumpMap: fibre,
    bumpScale: 0.6,
    roughness: 0.82,
    metalness: 0,
    envMap: environment.envMap,
    envMapIntensity: 0.25,
    // A breath of its own colour, so the head stays red on its shaded side and in the shadow of the mountain.
    emissive: signal.clone(),
    emissiveIntensity: 0.16,
  });
  const needleMaterial = new MeshStandardMaterial({
    color: new Color(THEME.steel),
    roughness: 0.32,
    metalness: 0.85,
    envMap: environment.envMap,
    envMapIntensity: 0.9,
  });

  // The head keeps its 64 by 40 segments on every device: the dive ends with this ball filling the screen.
  const headGeometry = new SphereGeometry(PIN.radius, 64, 40);
  const head = new Mesh(headGeometry, headMaterial);
  head.name = 'pin-head';
  head.castShadow = true;
  const needleGeometry = new CylinderGeometry(0.0035, 0.0022, 1, 10, 1);
  needleGeometry.translate(0, 0.5, 0);
  const needle = new Mesh(needleGeometry, needleMaterial);
  needle.name = 'pin-needle';
  needle.castShadow = true;
  object.add(needle, head);

  const fall: Spring = spring(0);
  let standing = false;
  let up = 0;
  let dim = 1;

  const place = (anchor: Vector3): void => {
    const stand = easeInOutCubic(clamp01(up));
    const length = PIN.needle * stand;
    object.position.set(anchor.x, anchor.y + fall.x, anchor.z);
    needle.scale.set(1, Math.max(1e-4, length), 1);
    needle.visible = stand > 0.02;
    // Pressed flat, the head is a printed dot a little wider than the ball.
    head.position.y = length + PIN.radius * (0.07 + 0.83 * stand);
    head.scale.set(1 + 0.25 * (1 - stand), 0.06 + 0.94 * stand, 1 + 0.25 * (1 - stand));
  };

  return {
    object,
    get up() {
      return up;
    },
    setStanding(next, immediate = false) {
      if (next && !standing) {
        // The fall starts above the card.
        fall.x = immediate ? 0 : PIN.drop;
        fall.v = 0;
      }
      standing = next;
      if (immediate) {
        up = next ? 1 : 0;
        settleSpring(fall, 0);
      }
    },
    setDim(light) {
      const next = Math.min(1, Math.max(0, light));
      if (Math.abs(next - dim) < 1e-3) return;
      dim = next;
      headMaterial.color.copy(signal).multiplyScalar(dim);
      headMaterial.emissiveIntensity = 0.16 * dim;
    },
    update(dt, anchor, reduced) {
      if (reduced) {
        up = standing ? 1 : 0;
        settleSpring(fall, 0);
      } else {
        const step = dt / PIN.press;
        up = standing ? Math.min(1, up + step) : Math.max(0, up - step);
        if (fall.x !== 0 || fall.v !== 0) {
          stepSpringKC(fall, 0, PIN.k, PIN.c, dt);
          bounceFloor(fall, 0, PIN.bounce);
          if (Math.abs(fall.x) < 2e-4 && Math.abs(fall.v) < 2e-3) settleSpring(fall, 0);
        }
      }
      place(anchor);
    },
    headWorld(target = new Vector3()) {
      return head.getWorldPosition(target);
    },
    dispose() {
      object.removeFromParent();
      headGeometry.dispose();
      needleGeometry.dispose();
      headMaterial.dispose();
      needleMaterial.dispose();
      fibre?.dispose();
    },
  };
}
