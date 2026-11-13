import { BoxGeometry, Group, Mesh, MeshStandardMaterial, type Raycaster } from 'three';
import { THEME } from '../look/theme';
import { buildSheet, type Sheet } from '../paper/sheet';
import type { FrameTime, ScenePart } from '../scene/contract';
import { artSheetSpec, type PropArt } from './art';
import { createStand, hitSheet, type Stand } from './stand';

/** How far a lake lifts its far edge, in radians. */
export const TIP_RISE = 0.33;
/** How far a hanging prop drifts sideways, and how fast. */
const DRIFT = { reach: 0.08, rate: 0.21 } as const;

export interface PropOptions {
  readonly scale?: number;
  readonly flip?: boolean;
  readonly seed?: number;
  readonly phone?: boolean;
  /** Height of the wire of a hanging prop, in scene units. */
  readonly wire?: number;
  /** Starts standing. */
  readonly up?: boolean;
}

/** One drawing of the registry as a thing in the scene: it stands up, lies down, sways and answers a tap. */
export interface PropPart extends ScenePart<Group> {
  readonly art: PropArt;
  readonly sheet: Sheet;
  /** 0 lying, 1 standing, as it is now. */
  readonly up: number;
  readonly standing: boolean;
  setUp(up: boolean, immediate?: boolean): void;
  /** Wobbles the prop, as a tap does. */
  tap(): void;
  /** Distance along the ray to the paper of this prop, or null when the ray misses it. */
  hit(raycaster: Raycaster): number | null;
  /** The tap swing at this moment, in radians. */
  readonly swing: number;
  readonly atRest: boolean;
}

export function createProp(art: PropArt, options: PropOptions = {}): PropPart {
  const seed = options.seed ?? 0;
  const sheet = buildSheet(artSheetSpec(art, { scale: options.scale, flip: options.flip, phone: options.phone, seed }));
  const stand: Stand = createStand({
    sway: art.sway,
    phase: (seed % 97) * 0.13,
    rise: art.pose === 'tip' ? TIP_RISE : Math.PI / 2,
    up: options.up,
  });
  const object = new Group();
  object.add(stand.hinge);
  stand.hinge.add(sheet.object);

  let wire: Mesh<BoxGeometry, MeshStandardMaterial> | null = null;
  if (art.pose === 'hang') {
    const height = options.wire ?? 0.6;
    // The wire is steel, a hair behind the cloud so the cloud covers its end.
    wire = new Mesh(new BoxGeometry(0.011, height + sheet.height * 0.4, 0.004), new MeshStandardMaterial({ color: THEME.steel, roughness: 0.5, metalness: 0.6 }));
    wire.position.set(0, (height + sheet.height * 0.4) / 2, -0.03);
    wire.castShadow = true;
    stand.hinge.add(wire);
    sheet.object.position.y = height;
  }

  return {
    object,
    art,
    sheet,
    get up() {
      return stand.up;
    },
    get standing() {
      return stand.standing;
    },
    get swing() {
      return stand.swing;
    },
    get atRest() {
      return stand.atRest;
    },
    setUp(up, immediate) {
      stand.setUp(up, immediate);
    },
    tap() {
      stand.tap();
    },
    hit(raycaster) {
      return stand.up > 0.2 || art.pose === 'tip' ? hitSheet(raycaster, sheet) : null;
    },
    update(frame: FrameTime) {
      stand.update(frame);
      if (art.pose === 'hang') {
        stand.hinge.position.x = frame.reduced ? 0 : Math.sin(DRIFT.rate * frame.t + 1.7 * (seed % 13)) * DRIFT.reach * Math.min(1, stand.up);
      }
    },
    dispose() {
      sheet.dispose();
      if (wire) {
        wire.geometry.dispose();
        wire.material.dispose();
      }
    },
  };
}
