import { Color, Group, Mesh, Vector3, type BufferGeometry, type CanvasTexture, type Material } from 'three';
import type { FrameTime, ScenePart, SceneEnvironment } from '../scene/contract';
import { PALETTE } from '../scene/palette';
import {
  DIMS,
  EXTENT,
  INNER_OUTER_RADIUS,
  OUTER_RADIUS,
  buildBody,
  buildDial,
  buildGlass,
  buildInnerRing,
  buildNeedle,
  buildNeedleShadow,
  buildOuterRing,
  detailFor,
  triangleCount,
  type BrassTints,
} from './geometry';
import { createGround } from './ground';
import { createHalo } from './halo';
import { bearingToDirection, needleYaw, normalizeBearing, retarget, worldToBody } from './heading';
import {
  createBrass,
  createCard,
  createDialRing,
  createDialTexture,
  createGlass,
  createNeedleNorth,
  createNeedleShadow,
  createNeedleSouth,
  dialTextureSize,
  type CompassColors,
  type MaterialSetup,
} from './materials';
import { SHOWPIECE_MOTION, clamp, contactShadow, damp, showpiecePose, tipToAxisAngle, type ShowpieceMotion } from './motion';
import { NEEDLE_SPRING, stepSpring, type SpringParams, type SpringState } from './spring';

export type { CompassColors } from './materials';

export interface CompassOptions {
  /** What the host knows about the device and the room. Without it the compass is built for a desktop and reflects nothing. */
  readonly environment?: SceneEnvironment;
  /** Colours. Each one falls back to the scene palette. */
  readonly colors?: Partial<CompassColors>;
  /**
   * Width of the compass across its outermost ring, in scene units. With the outer ring the default is the
   * largest compass that fits, bob included, between `FLOAT_BAND.bottom` and `FLOAT_BAND.top` above the table
   * (about 1.66: the ring stands upright, so the compass is taller than it is wide). Without it the default is 2.4.
   */
  readonly diameter?: number;
  /**
   * Rest height of the centre of the compass above the table. By default the lowest part, at the bottom of the
   * bob, is `FLOAT_BAND.bottom` above the table.
   */
  readonly height?: number;
  /** The upright outer ring with the bow. Without it the compass is a flat bowl in one ring. */
  readonly outerRing?: boolean;
  /** The bearing the needle shows at the start, in radians clockwise from north (-Z). */
  readonly heading?: number;
  /** The glow at the start, 0 to 1. */
  readonly glow?: number;
  /** How far the dial leans out of the horizontal so that it can be read from the side, in radians. */
  readonly lean?: number;
  /** The bearing the dial leans towards. The default is south (+Z), where the camera usually is. */
  readonly leanBearing?: number;
  /** The turn of the body at scene time 0, and its fixed turn with reduced motion (a `rotation.y`). */
  readonly restYaw?: number;
  /** The largest tilt `setTilt` can add, in radians. */
  readonly tilt?: number;
  /**
   * Where the key lamp stands as seen from the compass: its bearing and its elevation above the horizon, in
   * radians. Only the small shadow of the needle on the dial uses this. The default is a lamp behind and to the
   * left of the compass, 60 degrees up.
   */
  readonly lightBearing?: number;
  readonly lightElevation?: number;
  readonly motion?: Partial<ShowpieceMotion>;
  /** The needle spring. */
  readonly spring?: Partial<SpringParams>;
  /** Seed for the paper speckle and the brush marks of the dial. */
  readonly seed?: number | string;
}

export interface HeadingOptions {
  /** Jump to the bearing without the swing. */
  readonly immediate?: boolean;
}

export interface CompassPart extends ScenePart<Group> {
  /**
   * Points the needle along a bearing on the table: radians, clockwise seen from above, 0 is north (-Z), a
   * quarter turn is east (+X). The needle swings there the short way round and settles.
   */
  setHeading(radians: number, options?: HeadingOptions): void;
  /** How strongly the compass is lit up: the light pool on the table, the halo behind it and the needle. 0 to 1. */
  setGlow(amount: number): void;
  /** Mouse parallax. `x` is right and `y` is up, both -1 to 1; the dial tips a little towards the pointer. */
  setTilt(x: number, y: number): void;
  /** The bearing the needle shows right now, in [0, 2*PI). It moves while the needle swings. */
  readonly bearing: number;
  /** The bearing that was asked for, in [0, 2*PI). */
  readonly heading: number;
  /** Triangles drawn by the whole part. */
  readonly triangles: number;
  /** The highest point the compass reaches above the origin of `object` (the table top), at the top of the bob. */
  readonly topY: number;
  /** The lowest point the compass reaches above the origin of `object`, at the bottom of the bob. */
  readonly bottomY: number;
}

/** The band above the table that the default compass floats in, bob included. */
export const FLOAT_BAND = { bottom: 0.9, top: 3 } as const;

const DEFAULT_ENVIRONMENT: SceneEnvironment = { envMap: null, maxTexture: 2048, phone: false };

export function defaultCompassColors(): CompassColors {
  return {
    brass: PALETTE.brass,
    brassDeep: PALETTE.brassDeep,
    steel: PALETTE.steel,
    glass: PALETTE.glass,
    paper: PALETTE.paper,
    paperShade: PALETTE.paperShade,
    ink: PALETTE.ink,
    inkSoft: PALETTE.inkSoft,
    signal: PALETTE.signal,
    lamp: PALETTE.lamp,
  };
}

/** Default width of the compass without the outer ring. */
const FLAT_DIAMETER = 2.4;

/**
 * The hero of the table: a brass gimbal compass that floats, turns slowly and keeps its needle on the active map.
 *
 * `object` is a group whose origin is the point on the table under the compass; the compass floats above it and
 * its shadow and light pool lie at the origin. Add it at the table centre.
 */
export function createCompass(options: CompassOptions = {}): CompassPart {
  const environment = options.environment ?? DEFAULT_ENVIRONMENT;
  const colors: CompassColors = { ...defaultCompassColors(), ...options.colors };
  const withOuterRing = options.outerRing ?? true;
  const motion: ShowpieceMotion = { ...SHOWPIECE_MOTION, ...options.motion };
  const bob = Math.abs(motion.bobHeight);
  const extent = withOuterRing ? EXTENT.withOuterRing : EXTENT.withoutOuterRing;
  const widest = withOuterRing ? OUTER_RADIUS : INNER_OUTER_RADIUS;
  // With the upright ring the height decides the size: the tallest compass that stays inside the band.
  const fitted = (2 * widest * (FLOAT_BAND.top - FLOAT_BAND.bottom - 2 * bob)) / (extent.above + extent.below);
  const diameter = options.diameter ?? (withOuterRing ? fitted : FLAT_DIAMETER);
  const scale = diameter / (2 * widest);
  const height = options.height ?? FLOAT_BAND.bottom + bob + extent.below * scale;
  const topY = height + extent.above * scale + bob;
  const bottomY = height - extent.below * scale - bob;
  const springParams: SpringParams = { ...NEEDLE_SPRING, ...options.spring };
  const lean = options.lean ?? 0.2;
  const leanDirection = bearingToDirection(options.leanBearing ?? Math.PI);
  const restYaw = options.restYaw ?? 0.6;
  const maxTilt = options.tilt ?? 0.07;
  // The needle's shadow falls away from the lamp. It is short: the needle stands only a little above the dial.
  const lightElevation = clamp(options.lightElevation ?? Math.PI / 3, 0.3, Math.PI / 2);
  const shadowAway = bearingToDirection((options.lightBearing ?? -0.59) + Math.PI);
  const shadowReach = (DIMS.needleY - DIMS.dialY + 0.02) / Math.tan(lightElevation);

  const detail = detailFor(environment.phone);
  const setup: MaterialSetup = { colors, envMap: environment.envMap, phone: environment.phone };

  // Tints of the one brass material.
  const brass = new Color(colors.brass);
  const deep = new Color(colors.brassDeep);
  const tints: BrassTints = {
    body: brass.clone(),
    deep: brass.clone().lerp(deep, 0.7),
    wall: deep.clone().multiplyScalar(0.5),
    grip: brass.clone().lerp(new Color(0xffffff), 0.12),
    ring: brass.clone().lerp(deep, 0.28),
  };

  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];
  const keep = <T extends BufferGeometry>(geometry: T): T => {
    geometries.push(geometry);
    return geometry;
  };
  const own = <T extends Material>(material: T): T => {
    materials.push(material);
    return material;
  };

  const dialTexture: CanvasTexture | null = createDialTexture(
    colors,
    dialTextureSize(environment.maxTexture, environment.phone),
    options.seed ?? 'zero-to-compass',
  );

  const brassMaterial = own(createBrass(setup));
  const cardMaterial = own(createCard(setup, dialTexture));
  const ringMaterial = own(createDialRing(setup, dialTexture));
  const northMaterial = own(createNeedleNorth(setup));
  const southMaterial = own(createNeedleSouth(setup));
  const glass = createGlass(setup);
  own(glass.material);

  const root = new Group();
  root.name = 'compass';
  const floater = new Group();
  floater.name = 'compass-floater';
  const spinner = new Group();
  spinner.name = 'compass-body';
  spinner.scale.setScalar(scale);
  root.add(floater);
  floater.add(spinner);

  const body = new Mesh(keep(buildBody(detail, tints)), brassMaterial);
  body.name = 'compass-bowl';
  body.castShadow = true;
  body.receiveShadow = true;

  const dial = new Mesh(keep(buildDial(detail)), [cardMaterial, ringMaterial]);
  dial.name = 'compass-dial';
  dial.receiveShadow = true;

  const needle = new Mesh(keep(buildNeedle(detail)), [northMaterial, southMaterial]);
  needle.name = 'compass-needle';
  // A lamp that lights a whole table cannot resolve a shadow this small; the compass draws its own.
  needle.castShadow = false;

  const needleShadow = new Mesh(keep(buildNeedleShadow()), own(createNeedleShadow()));
  needleShadow.name = 'compass-needle-shadow';
  needleShadow.renderOrder = 1;

  const dome = new Mesh(keep(buildGlass(detail)), glass.material);
  dome.name = 'compass-glass';
  dome.renderOrder = 2;

  const innerRing = new Group();
  innerRing.name = 'compass-inner-ring';
  const innerMesh = new Mesh(keep(buildInnerRing(detail, tints, withOuterRing)), brassMaterial);
  innerMesh.castShadow = true;
  innerMesh.receiveShadow = true;
  innerRing.add(innerMesh);

  const outerRing = new Group();
  outerRing.name = 'compass-outer-ring';
  if (withOuterRing) {
    const outerMesh = new Mesh(keep(buildOuterRing(detail, tints)), brassMaterial);
    outerMesh.castShadow = true;
    outerMesh.receiveShadow = true;
    outerRing.add(outerMesh);
    innerRing.add(outerRing);
  }

  spinner.add(body, dial, needleShadow, needle, dome, innerRing);

  const groundHalf = 2.9 * scale;
  const ground = createGround(groundHalf, colors.lamp);
  ground.mesh.position.y = 0.004;
  ground.uniforms.uPoolRadius.value = 1.25 * scale;
  ground.uniforms.uRingRadius.value = 1.72 * scale;
  ground.uniforms.uRingWidth.value = 0.085 * scale;
  root.add(ground.mesh);

  const halo = createHalo(2.5 * scale, 1.6 * scale, colors.lamp);
  floater.add(halo.mesh);

  let triangles = 4;
  for (const geometry of geometries) triangles += triangleCount(geometry);

  // State.
  const startHeading = normalizeBearing(options.heading ?? 0);
  let spring: SpringState = { value: startHeading, velocity: 0 };
  let target = startHeading;
  let glowTarget = clamp(options.glow ?? 0, 0, 1);
  let glowNow = glowTarget;
  let tiltTargetX = 0;
  let tiltTargetY = 0;
  let tiltX = 0;
  let tiltY = 0;
  let bodyYaw = restYaw;
  let disposed = false;
  const axis = new Vector3();

  const placeNeedle = (tremble: number): void => {
    needle.rotation.y = needleYaw(spring.value + tremble, bodyYaw);
    // The shadow lies under the needle, pushed away from the lamp. The push is a direction on the table, so it
    // is turned back into the frame of the body like everything else that must not turn with it.
    const push = worldToBody(shadowAway.x * shadowReach, shadowAway.z * shadowReach, bodyYaw);
    needleShadow.rotation.y = needle.rotation.y;
    needleShadow.position.set(push.x, 0, push.z);
  };

  const apply = (frame: FrameTime): void => {
    const reduced = frame.reduced;
    const dt = Math.max(0, frame.dt);
    const pose = showpiecePose(frame.t, motion, reduced);

    // Float and turn.
    floater.position.y = height + pose.bob;
    if (reduced) {
      tiltX = 0;
      tiltY = 0;
    } else {
      tiltX = damp(tiltX, tiltTargetX, 5, dt);
      tiltY = damp(tiltY, tiltTargetY, 5, dt);
    }
    const tipX = lean * leanDirection.x + pose.wobbleX + tiltX * maxTilt;
    const tipZ = lean * leanDirection.z + pose.wobbleZ - tiltY * maxTilt;
    const tip = tipToAxisAngle(tipX, tipZ);
    floater.quaternion.setFromAxisAngle(axis.set(tip.x, tip.y, tip.z), tip.angle);
    bodyYaw = restYaw + pose.spin;
    spinner.rotation.y = bodyYaw;
    // The dial floats like the card of a ship's compass: it keeps north while the bowl turns under it, so its
    // lettering always faces a viewer in the south the right way up.
    dial.rotation.y = needleYaw(0, bodyYaw);
    innerRing.rotation.x = pose.ringRock;
    outerRing.rotation.z = pose.ringSwing;

    // The needle holds its bearing on the table while the body turns under it.
    if (reduced) spring = { value: target, velocity: 0 };
    else spring = stepSpring(spring, target, dt, springParams);
    // A resting needle is never perfectly still.
    const tremble = reduced ? 0 : 0.006 * Math.sin(frame.t * 2.3) + 0.004 * Math.sin(frame.t * 5.1 + 1);
    placeNeedle(tremble);

    // Light and shadow on the table.
    glowNow = reduced ? glowTarget : damp(glowNow, glowTarget, 4, dt);
    const breath = reduced ? 1 : 1 + 0.07 * Math.sin(frame.t * 1.3);
    ground.uniforms.uGlow.value = glowNow * breath;
    const shadow = contactShadow(pose.lift);
    ground.uniforms.uShadow.value = 0.46 * shadow.strength;
    ground.uniforms.uShadowRadius.value = 1.5 * scale * shadow.scale;
    halo.uniforms.uStrength.value = (0.03 + 0.075 * glowNow) * breath;
    northMaterial.emissiveIntensity = 0.05 + 0.4 * glowNow;
  };

  apply({ dt: 0, t: 0, reduced: false });

  return {
    object: root,
    update(frame: FrameTime): void {
      if (disposed) return;
      apply(frame);
    },
    setHeading(radians: number, headingOptions: HeadingOptions = {}): void {
      if (!Number.isFinite(radians)) return;
      target = retarget(spring.value, radians);
      if (headingOptions.immediate) {
        spring = { value: target, velocity: 0 };
        placeNeedle(0);
      }
    },
    setGlow(amount: number): void {
      if (!Number.isFinite(amount)) return;
      glowTarget = clamp(amount, 0, 1);
    },
    setTilt(x: number, y: number): void {
      tiltTargetX = Number.isFinite(x) ? clamp(x, -1, 1) : 0;
      tiltTargetY = Number.isFinite(y) ? clamp(y, -1, 1) : 0;
    },
    get bearing(): number {
      return normalizeBearing(spring.value);
    },
    get heading(): number {
      return normalizeBearing(target);
    },
    get triangles(): number {
      return triangles;
    },
    get topY(): number {
      return topY;
    },
    get bottomY(): number {
      return bottomY;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      root.removeFromParent();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      dialTexture?.dispose();
      ground.dispose();
      halo.dispose();
      floater.clear();
      root.clear();
    },
  };
}

/** The radius of the dial in scene units for a compass of the given diameter. Handy for hosts that frame it. */
export function dialRadiusFor(diameter: number, outerRing = true): number {
  return (DIMS.dialRadius * diameter) / (2 * (outerRing ? OUTER_RADIUS : INNER_OUTER_RADIUS));
}
