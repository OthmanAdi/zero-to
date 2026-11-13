import { Box3, Color, Group, Matrix4, Ray, Vector3, type Material, type Mesh, type MeshStandardMaterial } from 'three';
import type { FrameTime, SceneEnvironment } from '../scene/contract';
import { createTerrainModel, terrainMaterials, type TerrainPart } from '../terrain/model';
import { GROW, createGrowthClock } from './grow';
import { ROOM_ENV } from './room';
import { paperHalf, type SheetData } from './sheet-data';

/**
 * The port between the table and the paper mountain of the terrain package. The table talks to this interface
 * only; if the terrain part changes, this file changes and nothing else.
 *
 * What the port adds to the part:
 * - the growth clock (1.25 s up, 0.8 s down) that drives the part's card springs,
 * - the mount on a cover: the part's own board is put away and the flat cards lie on the cover's field,
 * - the tone of the print: a card that still lies flat takes the tone of the cover it is printed on,
 * - a pointer ray marched over the stepped ground, and anchors on the trail that ride the cards.
 */
export interface Mountain {
  /** Origin: the middle of the field on the cover's top face. */
  readonly object: Group;
  readonly part: TerrainPart;
  /** True once the cards are cut. The part cuts them when it is built, so this is true from the start. */
  readonly ready: boolean;
  /** The growth clock, 0 flat to 1 standing. The cards follow it on springs. */
  readonly grow: number;
  /** True while the clock or a card still moves. */
  readonly moving: boolean;
  readonly cards: number;
  readonly cardThickness: number;
  /** Height of the highest point above the cover right now. */
  readonly height: number;
  /** Height of the standing model above the cover. */
  readonly fullHeight: number;
  /** Height of the model while every card lies in the print: the cards keep a hair of thickness. */
  readonly flatHeight: number;
  /** Lets the mountain stand (1) or sink back into its print (0). */
  setGrow(target: 0 | 1, immediate?: boolean): void;
  /** Lifts the growth clock to at least this value at once. The dive uses it, where the scroll sets the pace. */
  raise(value: number): void;
  /** The card under a ray given in world space, or -1. */
  cardAt(ray: Ray): number;
  /** Lifts a card and all above it and inks its contour. -1 puts them back. */
  setHover(card: number): void;
  /** A point on the trail at a share of its length, on top of the card it crosses right now, in `object` space. */
  anchorAt(along: number, target?: Vector3): Vector3;
  /** The card the trail crosses at a share of its length. */
  cardOnTrail(along: number): number;
  /** How far a card has risen, 0 printed to 1 standing. */
  cardRise(card: number): number;
  /** The walked part of the trail, as a share of its length. */
  setWalked(along: number): void;
  /**
   * Stages whose checkpoint is passed. The terrain part flies every flag from the start and has no switch per
   * camp yet, so this is kept for the day it has one.
   */
  setPassed(stages: readonly number[]): void;
  /** Light the sheet under the mountain keeps, 0.3 to 1. */
  setDim(light: number): void;
  update(frame: FrameTime): void;
  dispose(): void;
}

/** How far the flat cards lie above the cover, so the two never fight for the same depth. */
const SEAT = 0.0025;

export function createMountain(data: SheetData, environment: SceneEnvironment, sheetTone: string): Mountain {
  const part = createTerrainModel({
    terrain: data.terrain,
    trail: data.trail,
    surfaces: data.surfaces,
    environment,
    cards: data.cards,
    cardThickness: GROW.thickness,
    size: GROW.size,
  });
  const cards = part.levels.length;
  const thickness = part.cardThickness;
  const half = paperHalf(GROW.size);

  const object = new Group();
  object.name = 'mountain';
  part.object.position.y = SEAT - part.boardHeight;
  object.add(part.object);

  // The cover is the board: the part's own is put away.
  const board = part.object.getObjectByName('terrain-board');
  if (board) {
    board.visible = false;
    board.castShadow = false;
  }

  // The room is dark, so the paper takes less from the environment map than the part's own default.
  const materials = terrainMaterials(part) as Material[];
  for (const material of materials) {
    if ('envMapIntensity' in material) (material as MeshStandardMaterial).envMapIntensity = ROOM_ENV.paper;
  }

  // A card that still lies flat shows three quarters of the sheet tone and a quarter of its own paper. The sheet
  // tone is the cloth of the cover, so the print is a field of the cover's colour with a breath of the ground
  // tints in it. The cover prints the same tones (`flatTones`), so a printed field and a flat model agree.
  const cardsMesh = part.object.getObjectByName('terrain-cards') as Mesh | undefined;
  const cardMaterial = cardsMesh?.material as MeshStandardMaterial | undefined;
  const wanted = new Color(sheetTone);
  if (cardMaterial) {
    const compile = cardMaterial.onBeforeCompile;
    cardMaterial.onBeforeCompile = (shader, renderer) => {
      compile.call(cardMaterial, shader, renderer);
      const sheet = shader.uniforms.uSheet?.value as Color | undefined;
      if (sheet && typeof sheet.copy === 'function') sheet.copy(wanted);
    };
  }

  const clock = createGrowthClock(0);
  part.grow(0, true);
  let standing = false;
  let settling = 0;
  let hoverCard = -1;
  let dim = 1;

  const inverse = new Matrix4();
  const local = new Ray();
  const point = new Vector3();
  const bounds = new Box3(
    new Vector3(-half, part.boardHeight, -half),
    new Vector3(half, part.boardHeight + cards * thickness + 0.06, half),
  );
  const enter = new Vector3();

  const cardUnder = (x: number, z: number): number => {
    const h = part.heightfield.sample(x / half, z / half);
    return Math.min(cards - 1, Math.max(0, Math.floor(h * cards)));
  };
  const flatTop = (card: number): number => part.boardHeight + (card + 1) * 0.0009;
  const standTop = (card: number): number => part.boardHeight + (card + 1) * thickness;

  const mountain: Mountain = {
    object,
    part,
    ready: true,
    get grow() {
      return clock.grow;
    },
    get moving() {
      return clock.moving || settling > 0;
    },
    cards,
    cardThickness: thickness,
    get height() {
      return part.cardTop(cards - 1) - part.boardHeight + SEAT;
    },
    fullHeight: cards * thickness + SEAT,
    flatHeight: cards * 0.0009 + SEAT,

    setGrow(target, immediate = false) {
      standing = target === 1;
      if (immediate) {
        clock.set(target);
        part.grow(target, true);
        settling = 0;
      }
    },

    raise(value) {
      const wanted = Math.min(1, Math.max(0, value));
      if (clock.grow >= wanted) return;
      clock.set(wanted);
      part.grow(wanted);
      settling = 1.2;
    },

    cardAt(ray) {
      part.object.updateWorldMatrix(true, false);
      inverse.copy(part.object.matrixWorld).invert();
      local.copy(ray).applyMatrix4(inverse);
      if (!local.intersectBox(bounds, enter)) return -1;
      // The ray is marched over the stepped ground: the model's cards as they stand right now, not its triangles.
      const step = 0.012;
      const reach = Math.hypot(2 * half, 2 * half, bounds.max.y) + 0.1;
      for (let travelled = 0; travelled <= reach; travelled += step) {
        point.copy(enter).addScaledVector(local.direction, travelled);
        if (Math.abs(point.x) > half + 1e-3 || Math.abs(point.z) > half + 1e-3) {
          if (travelled > step) break;
          continue;
        }
        const card = cardUnder(point.x, point.z);
        if (point.y <= part.cardTop(card)) return card;
        if (point.y < part.boardHeight) break;
      }
      return -1;
    },

    setHover(card) {
      const next = card < 0 ? -1 : Math.round(card);
      if (next === hoverCard) return;
      hoverCard = next;
      part.setHover(next < 0 ? null : next);
      settling = Math.max(settling, 0.6);
    },

    anchorAt(along, target = new Vector3()) {
      part.routeAt(along, target);
      const card = part.cardAt(target.x, target.z);
      target.y = part.cardTop(card >= 0 ? card : cardUnder(target.x, target.z)) + part.object.position.y;
      return target;
    },

    cardOnTrail(along) {
      part.routeAt(along, point);
      const card = part.cardAt(point.x, point.z);
      return card >= 0 ? card : cardUnder(point.x, point.z);
    },

    cardRise(card) {
      const index = Math.min(cards - 1, Math.max(0, Math.round(card)));
      // A card's top moves with every card under it, so its rise is read against both ends of that travel.
      const span = standTop(index) - flatTop(index);
      return span > 0 ? Math.min(1.2, Math.max(0, (part.cardTop(index) - flatTop(index)) / span)) : 1;
    },

    setWalked(along) {
      part.setProgress(along);
    },

    setPassed() {
      // See the interface: the part has no switch per flag.
    },

    setDim(light) {
      const next = Math.min(1, Math.max(0, light));
      if (Math.abs(next - dim) < 1e-3) return;
      dim = next;
      for (const material of materials) {
        const tint = (material as MeshStandardMaterial).color;
        // Every material of the part starts white or with its own colour; the dim is applied to the cards, which
        // are the only thing to see while the model lies flat.
        if (material === cardMaterial && tint) tint.setScalar(dim);
      }
    },

    update(frame) {
      if (frame.reduced) {
        clock.set(standing ? 1 : 0);
        part.grow(clock.grow, true);
        part.update(frame);
        settling = 0;
        return;
      }
      const before = clock.grow;
      clock.advance(frame.dt, standing);
      if (clock.grow !== before) {
        part.grow(clock.grow);
        settling = 1.2;
      } else if (settling > 0) {
        settling = Math.max(0, settling - frame.dt);
      }
      part.update(frame);
    },

    dispose() {
      object.removeFromParent();
      part.dispose();
    },
  };

  return mountain;
}
