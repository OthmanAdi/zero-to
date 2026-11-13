import { AmbientLight, Color, Group, PointLight, SpotLight, Vector3 } from 'three';
import { LAMP } from '../look/lamp';
import { THEME } from '../look/theme';
import { clamp01, lerp, smooth, spring, stepSpringKC, settleSpring, type Spring } from '../paper/motion';
import type { SceneEnvironment } from '../scene/contract';

/**
 * The one lamp over the table. It has three poses and blends between them:
 *
 * - overhead: it hangs above, behind and left of its pool, so shadows fall toward the viewer. The pool follows
 *   the pointer on a spring.
 * - rake: while a mountain stands the lamp comes down and lights it from the side, so every terrace throws a
 *   shadow. The pointer swings it round the mountain.
 * - sun: during the dive it sinks to a low sun behind the pin.
 *
 * A second, narrow beam from the same lamp head falls on the compass, which floats outside the main cone.
 */
export const LAMP_RIG = {
  pool: { k: 24, c: 7.2, reachX: 1.7, reachZ: 1.1 },
  rake: {
    distance: 7.6,
    azimuthLeft: 250,
    azimuthRight: 112,
    elevationTop: 38,
    elevationBottom: 23,
    rest: { azimuth: 112, elevation: 27 },
    cone: 44,
    intensity: 0.82,
    ambient: 0.21,
    bounce: 0.07,
    k: 7.5,
    c: 4.3,
    /** On touch screens the rest pose drifts by this many degrees of azimuth over this many seconds. */
    drift: 12,
    driftSeconds: 9,
  },
  sun: { azimuth: 122, elevation: 13, cone: 15 },
  /**
   * Strength of the overhead pose next to the calibrated lamp. The lamp is calibrated for white card; while no
   * mountain stands there is only cover cloth in its pool, which takes more light without burning out.
   */
  overhead: 1.5,
  /** How far under the table top the bounce light sits. */
  bounceDepth: 1.4,
  /** The beam on the compass: half-angle in degrees and its strength next to the lamp. */
  compass: { cone: 17, intensity: 0.5, penumbra: 0.9 },
  /** Three.js lights are physical: an ambient light of 0.08 is close to nothing, so the room's fill is scaled up. */
  ambientScale: 3.2,
  ambientColor: '#aebbdc',
} as const;

export interface LampState {
  /** Seconds of scene time, for the drift. */
  readonly t: number;
  readonly dt: number;
  readonly reduced: boolean;
  /** 0 is off, 1 is on. The intro overshoots 1 for a moment. */
  readonly on: number;
  /** 0 is the cold lamp of the first moment, 1 is the warm lamp. */
  readonly warm: number;
  /** 0 is overhead, 1 is the raking pose. */
  readonly rake: number;
  /** 0 to 1: the low sun of the dive. */
  readonly sun: number;
  /** The middle of the lit slot on the table. */
  readonly slot: Vector3;
  /** What the raking lamp looks at: the middle of the standing mountain. */
  readonly focus: Vector3;
  /** What the compass beam looks at. */
  readonly compass: Vector3;
  /** 0 to 1: how much of the compass beam is on. */
  readonly compassOn: number;
}

export interface LampRig {
  readonly object: Group;
  readonly key: SpotLight;
  /** Pointer in normalised device coordinates, or null when there is none (touch, or the pointer left). */
  setPointer(x: number | null, y: number | null): void;
  update(state: LampState): void;
  dispose(): void;
}

const RAD = Math.PI / 180;

function direction(azimuth: number, elevation: number, target: Vector3): Vector3 {
  const az = azimuth * RAD;
  const el = elevation * RAD;
  return target.set(Math.cos(az) * Math.cos(el), Math.sin(el), -Math.sin(az) * Math.cos(el));
}

export function createLamp(environment: SceneEnvironment, touch = false): LampRig {
  const object = new Group();
  object.name = 'table-lamp';

  const key = new SpotLight(new Color(LAMP.color), LAMP.intensity, 0, LAMP.cone * RAD, LAMP.penumbra, LAMP.decay);
  key.name = 'lamp-key';
  key.castShadow = true;
  const mapSize = environment.phone ? LAMP.shadow.phoneMapSize : Math.min(LAMP.shadow.mapSize, environment.maxTexture);
  key.shadow.mapSize.set(mapSize, mapSize);
  key.shadow.camera.near = LAMP.shadow.near;
  key.shadow.camera.far = LAMP.shadow.far;
  key.shadow.bias = LAMP.shadow.bias;
  key.shadow.normalBias = LAMP.shadow.normalBias;
  key.shadow.radius = 2.2;

  const bounce = new PointLight(new Color(LAMP.color), LAMP.intensity * LAMP.bounce, 0, LAMP.decay);
  bounce.name = 'lamp-bounce';
  const ambient = new AmbientLight(new Color(LAMP_RIG.ambientColor), LAMP.ambient * LAMP_RIG.ambientScale);
  ambient.name = 'lamp-ambient';

  const beam = new SpotLight(new Color(LAMP.color), 0, 0, LAMP_RIG.compass.cone * RAD, LAMP_RIG.compass.penumbra, LAMP.decay);
  beam.name = 'lamp-compass-beam';
  if (!environment.phone) {
    beam.castShadow = true;
    beam.shadow.mapSize.set(1024, 1024);
    beam.shadow.camera.near = 1.5;
    beam.shadow.camera.far = 24;
    beam.shadow.bias = -0.0003;
    beam.shadow.normalBias = 0.012;
    beam.shadow.radius = 3;
  }

  object.add(key, key.target, bounce, ambient, beam, beam.target);

  const cold = new Color(LAMP.colorCold);
  const warm = new Color(LAMP.color);
  const sunColor = new Color(THEME.sun);
  const colour = new Color();

  const poolX: Spring = spring(0);
  const poolZ: Spring = spring(0);
  const azimuth: Spring = spring(LAMP_RIG.rake.rest.azimuth);
  const elevation: Spring = spring(LAMP_RIG.rake.rest.elevation);
  let pointerX: number | null = null;
  let pointerY: number | null = null;

  const overhead = new Vector3();
  const raking = new Vector3();
  const sunPosition = new Vector3();
  const position = new Vector3();
  const aim = new Vector3();
  const dir = new Vector3();
  const head = new Vector3();

  return {
    object,
    key,
    setPointer(x, y) {
      pointerX = x === null || !Number.isFinite(x) ? null : Math.min(1, Math.max(-1, x));
      pointerY = y === null || !Number.isFinite(y) ? null : Math.min(1, Math.max(-1, y));
    },
    update(state) {
      const { dt, reduced } = state;
      const has = pointerX !== null && pointerY !== null && !reduced;

      // Where the pool wants to be, and where the raking lamp wants to stand.
      const wantX = has ? (pointerX as number) * LAMP_RIG.pool.reachX : 0;
      const wantZ = has ? -(pointerY as number) * LAMP_RIG.pool.reachZ : 0;
      let wantAzimuth: number = LAMP_RIG.rake.rest.azimuth;
      let wantElevation: number = LAMP_RIG.rake.rest.elevation;
      if (has) {
        wantAzimuth = lerp(LAMP_RIG.rake.azimuthLeft, LAMP_RIG.rake.azimuthRight, ((pointerX as number) + 1) / 2);
        wantElevation = lerp(LAMP_RIG.rake.elevationBottom, LAMP_RIG.rake.elevationTop, ((pointerY as number) + 1) / 2);
      } else if (touch && !reduced) {
        wantAzimuth += LAMP_RIG.rake.drift * Math.sin((state.t * Math.PI * 2) / LAMP_RIG.rake.driftSeconds);
      }
      if (reduced) {
        settleSpring(poolX, 0);
        settleSpring(poolZ, 0);
        settleSpring(azimuth, wantAzimuth);
        settleSpring(elevation, wantElevation);
      } else {
        stepSpringKC(poolX, wantX, LAMP_RIG.pool.k, LAMP_RIG.pool.c, dt);
        stepSpringKC(poolZ, wantZ, LAMP_RIG.pool.k, LAMP_RIG.pool.c, dt);
        stepSpringKC(azimuth, wantAzimuth, LAMP_RIG.rake.k, LAMP_RIG.rake.c, dt);
        stepSpringKC(elevation, wantElevation, LAMP_RIG.rake.k, LAMP_RIG.rake.c, dt);
      }

      const rake = smooth(clamp01(state.rake));
      const sun = smooth(clamp01(state.sun));

      // Overhead: above, behind and left of the pool.
      aim.set(state.slot.x + poolX.x, state.slot.y, state.slot.z + poolZ.x);
      overhead.set(aim.x + LAMP.offset.x, aim.y + LAMP.offset.y, aim.z + LAMP.offset.z);
      head.set(state.slot.x + LAMP.offset.x, state.slot.y + LAMP.offset.y, state.slot.z + LAMP.offset.z);
      // Rake: low, round the mountain.
      raking.copy(state.focus).addScaledVector(direction(azimuth.x, elevation.x, dir), LAMP_RIG.rake.distance);
      sunPosition.copy(state.focus).addScaledVector(direction(LAMP_RIG.sun.azimuth, LAMP_RIG.sun.elevation, dir), LAMP_RIG.rake.distance);

      position.copy(overhead).lerp(raking, rake).lerp(sunPosition, sun);
      aim.lerp(state.focus, Math.max(rake, sun));
      key.position.copy(position);
      key.target.position.copy(aim);
      key.angle = lerp(lerp(LAMP.cone, LAMP_RIG.rake.cone, rake), LAMP_RIG.sun.cone, sun) * RAD;

      const on = Math.max(0, state.on);
      colour.copy(cold).lerp(warm, clamp01(state.warm)).lerp(sunColor, sun);
      key.color.copy(colour);
      key.intensity = LAMP.intensity * on * lerp(LAMP_RIG.overhead, LAMP_RIG.rake.intensity, rake);
      // The bounce is the lamp's light coming back off the lit desk. It sits under the table top, between the
      // pool and the compass, so it throws no pool of its own on the wood and warms the brass from below.
      bounce.color.copy(colour);
      bounce.position.set(state.slot.x * 0.5, -LAMP_RIG.bounceDepth, state.slot.z * 0.55);
      bounce.intensity = LAMP.intensity * on * lerp(LAMP.bounce, LAMP_RIG.rake.bounce, rake);
      ambient.intensity = LAMP_RIG.ambientScale * Math.min(1, on) * lerp(LAMP.ambient, LAMP_RIG.rake.ambient, rake);

      // The beam on the compass stays with the lamp head, wherever the raking light has gone.
      beam.position.copy(head);
      beam.target.position.copy(state.compass);
      beam.color.copy(colour);
      // The light stays in the scene at zero: taking it out would make every material compile again.
      beam.intensity = LAMP.intensity * LAMP_RIG.compass.intensity * on * clamp01(state.compassOn) * (1 - sun);
    },
    dispose() {
      key.shadow.map?.dispose();
      beam.shadow.map?.dispose();
      key.dispose();
      beam.dispose();
      bounce.dispose();
      ambient.dispose();
      object.clear();
    },
  };
}
