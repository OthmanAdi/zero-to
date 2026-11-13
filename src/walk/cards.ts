import {
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LinearMipmapLinearFilter,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
  ShapeUtils,
  Vector2,
} from 'three';
import type { UiLang } from '../i18n';
import { THEME } from '../look/theme';
import { createPaperMaterial, type PaperMaterial } from '../paper/material';
import { settleSpring, spring, stepSpringKC, type Spring } from '../paper/motion';
import type { SceneEnvironment } from '../scene/contract';
import { GROW, cardShape, growCard } from '../table/grow';
import type { ContourLevel, ContourPolygon, Point2 } from '../terrain';
import type { PanelPlan, WalkPlan } from './plan';
import { cardTones, paintCardTops } from './print';
import { MODEL } from './strip';

/**
 * The card model of one panel: a stack of paper cards cut along the panel's own contours. It grows out of the
 * print the way the mountain on the table does, bottom card first with a spread of cards on the move, each on
 * its own spring. Everything that stands on the model asks it how high the ground is right now.
 */
export const CARDS = {
  k: GROW.k,
  c: GROW.c,
  /** Thickness of a card that still lies in the print. Not zero, so stacked flat cards do not flicker. */
  flat: 0.0006,
  /** The side of a card is this much darker than its top. */
  side: 0.74,
  /** Pixels per scene unit of the print on the card tops, at scale 1. */
  resolution: 246,
} as const;

export interface CardModel {
  /** In panel coordinates. */
  readonly object: Group;
  readonly count: number;
  /** How far the model should stand: 0 lies in the print, 1 stands. */
  setFold(up: number): void;
  readonly fold: number;
  /** Puts every card on its target at once. */
  settle(): void;
  /** Steps the springs. Returns true while a card still moves. */
  update(dt: number, reduced: boolean): boolean;
  readonly moving: boolean;
  /** Height of the top of a card right now. Card -1 is the bare panel. */
  cardTop(card: number): number;
  /** Height of the ground under a point of the panel right now. */
  groundAt(x: number, z: number): number;
  /** Height of the whole stack when it stands. */
  readonly height: number;
  /** Prints the card tops again, when the ink of the panel changes. */
  repaint(ink: number): void;
  dispose(): void;
}

function topGeometry(level: ContourLevel): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const spanX = MODEL.x1 - MODEL.x0;
  const spanZ = MODEL.z1 - MODEL.z0;
  for (const polygon of level.polygons) {
    const contour = polygon.outer.map((p) => new Vector2(p.x, -p.z));
    const holes = polygon.holes.map((hole) => hole.map((p) => new Vector2(p.x, -p.z)));
    const all = [...contour, ...holes.flat()];
    const base = positions.length / 3;
    for (const point of all) {
      // Sheet space: x across, y toward the back of the panel, z out of the paper.
      positions.push(point.x, point.y, 0);
      normals.push(0, 0, 1);
      uvs.push((point.x - MODEL.x0) / spanX, 1 - (-point.y - MODEL.z0) / spanZ);
    }
    for (const face of ShapeUtils.triangulateShape(contour, holes)) {
      const a = all[face[0] as number] as Vector2;
      const b = all[face[1] as number] as Vector2;
      const c = all[face[2] as number] as Vector2;
      const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (area >= 0) indices.push(base + (face[0] as number), base + (face[1] as number), base + (face[2] as number));
      else indices.push(base + (face[0] as number), base + (face[2] as number), base + (face[1] as number));
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

function wallGeometry(level: ContourLevel, tone: Color): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const ring = (points: readonly Point2[]): void => {
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i] as Point2;
      const b = points[(i + 1) % points.length] as Point2;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const length = Math.hypot(dx, dz);
      if (length < 1e-7) continue;
      // Paper lies on the left of every ring, so the right of an edge faces outward.
      const nx = dz / length;
      const nz = -dx / length;
      const base = positions.length / 3;
      positions.push(a.x, 0, a.z, b.x, 0, b.z, b.x, 1, b.z, a.x, 1, a.z);
      for (let k = 0; k < 4; k += 1) normals.push(nx, 0, nz);
      // A little darker toward the foot, where the card below shades it.
      for (const shade of [0.86, 0.86, 1, 1]) colors.push(tone.r * shade, tone.g * shade, tone.b * shade);
      // Wound so that the face seen from outside is the front: a double-sided material flips the normal of a back face.
      indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  };
  for (const polygon of level.polygons as readonly ContourPolygon[]) {
    ring(polygon.outer);
    for (const hole of polygon.holes) ring(hole);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  return geometry;
}

export interface CardModelOptions {
  readonly plan: WalkPlan;
  readonly environment: SceneEnvironment;
  readonly lang: UiLang;
  readonly ink: number;
  /** Scale of the print on the card tops: 2 for the panel under the walker, 1.5 for the rest. */
  readonly scale: number;
}

export function createCardModel(panel: PanelPlan, options: CardModelOptions): CardModel {
  const { plan, environment, lang } = options;
  const object = new Group();
  object.name = `panel-${panel.index}-cards`;
  const count = panel.cards.count;
  const thickness = MODEL.thickness;

  // One print for all card tops.
  const spanX = MODEL.x1 - MODEL.x0;
  const spanZ = MODEL.z1 - MODEL.z0;
  const resolution = Math.min(CARDS.resolution * options.scale, environment.maxTexture / spanX);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(spanX * resolution);
  canvas.height = Math.round(spanZ * resolution);
  const context = canvas.getContext('2d');
  const paint = (ink: number): void => {
    if (!context) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = THEME.paper;
    context.fillRect(0, 0, canvas.width, canvas.height);
    paintCardTops(context, canvas.width, canvas.height, { plan, panel, lang, ink });
  };
  paint(options.ink);
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = environment.phone ? 4 : 8;
  map.minFilter = LinearMipmapLinearFilter;

  const topMaterial: PaperMaterial = createPaperMaterial({ map, size: [spanX, spanZ], seed: panel.index * 7.3 + 1.1, warp: 0, rim: 0, through: 0.1 });
  const wallMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0, side: DoubleSide });
  const tones = cardTones(panel.cardSurfaces);

  interface Card {
    readonly top: Mesh<BufferGeometry, PaperMaterial>;
    readonly wall: Mesh<BufferGeometry, MeshStandardMaterial>;
    readonly spring: Spring;
    thickness: number;
    base: number;
  }
  const cards: Card[] = panel.cards.levels.map((level, index) => {
    const top = new Mesh(topGeometry(level), topMaterial);
    top.rotation.x = -Math.PI / 2;
    top.castShadow = true;
    top.receiveShadow = true;
    const wall = new Mesh(wallGeometry(level, new Color(tones[index] ?? THEME.paper).multiplyScalar(CARDS.side)), wallMaterial);
    wall.castShadow = true;
    wall.receiveShadow = true;
    object.add(top, wall);
    return { top, wall, spring: spring(0), thickness: CARDS.flat, base: 0 };
  });

  let fold = 0;
  let moving = false;

  const place = (): void => {
    let base = 0;
    let any = false;
    for (const card of cards) {
      const shape = cardShape(card.spring.x);
      card.thickness = Math.max(CARDS.flat, thickness * shape.thickness);
      card.base = base;
      base += card.thickness;
      card.wall.position.y = card.base;
      card.wall.scale.y = card.thickness;
      card.top.position.y = base;
      if (card.spring.x > 0.004) any = true;
    }
    // While the model lies in the print, the print itself shows: it carries the same contours.
    object.visible = any;
  };
  place();

  const targetOf = (index: number): number => growCard(index, count, 1 - fold);

  return {
    object,
    count,
    get fold() {
      return fold;
    },
    get moving() {
      return moving;
    },
    height: count * thickness,
    setFold(up) {
      const next = Math.min(1, Math.max(0, up));
      if (next !== fold) moving = true;
      fold = next;
    },
    settle() {
      cards.forEach((card, index) => settleSpring(card.spring, targetOf(index)));
      moving = false;
      place();
    },
    update(dt, reduced) {
      if (!moving) return false;
      if (reduced) {
        cards.forEach((card, index) => settleSpring(card.spring, targetOf(index)));
        moving = false;
        place();
        return false;
      }
      let busy = false;
      const step = Math.min(dt, 0.034);
      cards.forEach((card, index) => {
        const target = targetOf(index);
        stepSpringKC(card.spring, target, CARDS.k, CARDS.c, step);
        if (card.spring.x < 0) {
          card.spring.x = 0;
          card.spring.v = Math.max(0, card.spring.v);
        }
        if (Math.abs(card.spring.x - target) > 5e-4 || Math.abs(card.spring.v) > 5e-3) busy = true;
        else settleSpring(card.spring, target);
      });
      moving = busy;
      place();
      return busy;
    },
    cardTop(card) {
      if (card < 0) return 0;
      const entry = cards[Math.min(cards.length - 1, card)] as Card;
      return entry.base + entry.thickness;
    },
    groundAt(x, z) {
      if (!object.visible) return 0;
      const card = panel.cards.cardAt(x, z);
      if (card < 0) return 0;
      const entry = cards[card] as Card;
      return entry.base + entry.thickness;
    },
    repaint(ink) {
      paint(ink);
      map.needsUpdate = true;
    },
    dispose() {
      for (const card of cards) {
        card.top.geometry.dispose();
        card.wall.geometry.dispose();
      }
      topMaterial.dispose();
      wallMaterial.dispose();
      map.dispose();
    },
  };
}
