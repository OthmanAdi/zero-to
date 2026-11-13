import { InstancedMesh, Matrix4, Mesh, Raycaster, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { SceneEnvironment } from '../scene/contract';
import { levelIndexAt } from './contours';
import { MAX_CARDS, createTerrainModel, terrainMaterials, type TerrainPart } from './model';

const phone: SceneEnvironment = { envMap: null, maxTexture: 1024, phone: true };

function build(overrides: Partial<Parameters<typeof createTerrainModel>[0]> = {}): TerrainPart {
  return createTerrainModel({
    terrain: { seed: 'model', template: 'twin-peaks' },
    trail: { seed: 'model', template: 'switchback', stops: 5 },
    environment: phone,
    ...overrides,
  });
}

const frame = (dt: number, reduced = false): { dt: number; t: number; reduced: boolean } => ({ dt, t: 0, reduced });

describe('createTerrainModel', () => {
  it('builds the part the scene contract asks for', () => {
    const part = build();
    expect(part.object.isGroup).toBe(true);
    expect(part.raycastTarget).toBeInstanceOf(Mesh);
    expect(part.raycastTarget.visible).toBe(false);
    const cards = part.object.getObjectByName('terrain-cards') as Mesh;
    expect(cards.castShadow).toBe(true);
    expect(cards.receiveShadow).toBe(true);
    expect(cards.customDepthMaterial).toBeDefined();
    // One mesh holds every card, each vertex tagged with its card.
    const tags = cards.geometry.getAttribute('aCard');
    let highest = 0;
    for (let i = 0; i < tags.count; i += 1) highest = Math.max(highest, tags.getX(i));
    expect(highest).toBe(part.levels.length - 1);
    expect(part.object.getObjectByName('terrain-board')).toBeDefined();
    expect(terrainMaterials(part).length).toBeGreaterThan(3);
    part.dispose();
  });

  it('uses a coarser grid and fewer, thicker cards on phones', () => {
    const small = build();
    const large = build({ environment: { envMap: null, maxTexture: 2048, phone: false } });
    expect(small.heightfield.resolution).toBe(65);
    expect(large.heightfield.resolution).toBe(129);
    expect(small.levels.length).toBeLessThan(large.levels.length);
    expect(small.cardThickness).toBeGreaterThan(large.cardThickness);
    for (const part of [small, large]) {
      expect(part.cardThickness).toBeGreaterThanOrEqual(0.05);
      expect(part.cardThickness).toBeLessThanOrEqual(0.08);
      expect(part.levels.length).toBeLessThanOrEqual(MAX_CARDS);
      // The contract: a footprint of 4 by 4 and at most 1.4 high.
      expect(part.boardHeight + part.levels.length * part.cardThickness).toBeLessThanOrEqual(1.4);
      part.dispose();
    }
  });

  it('keeps the route on the card it crosses', () => {
    const part = build();
    const half = 2 - 4 * 0.03;
    const point = new Vector3();
    let steps = 0;
    for (let k = 0; k <= 200; k += 1) {
      const along = k / 200;
      const result = part.routeAt(along, point);
      expect(result).toBe(point);
      const card = levelIndexAt(part.levels, point.x / half, point.z / half);
      expect(card).toBeGreaterThanOrEqual(0);
      expect(part.cardAt(point.x, point.z)).toBe(card);
      // Exactly on top of that card: not above it, not inside it.
      expect(point.y).toBeCloseTo(part.boardHeight + (card + 1) * part.cardThickness, 9);
      expect(point.y).toBeCloseTo(part.cardTop(card), 6);
      expect(Math.abs(point.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(point.z)).toBeLessThanOrEqual(2);
      if (k > 0) steps += 1;
    }
    expect(steps).toBe(200);
    // The walk ends on the top card.
    expect(part.cardAt(part.routeAt(1).x, part.routeAt(1).z)).toBe(part.levels.length - 1);
    part.dispose();
  });

  it('reports where the stops stand, gate first and summit last, each one higher', () => {
    const part = build();
    expect(part.stopPositions.length).toBe(5);
    expect(part.stopPositions[0]?.distanceTo(part.routeAt(0))).toBeCloseTo(0, 9);
    expect(part.stopPositions[4]?.distanceTo(part.routeAt(1))).toBeCloseTo(0, 9);
    for (let i = 1; i < 5; i += 1) {
      expect((part.stopPositions[i]?.y ?? 0) >= (part.stopPositions[i - 1]?.y ?? 9)).toBe(true);
    }
    expect(part.stopPositions[4]?.y).toBeCloseTo(part.boardHeight + part.levels.length * part.cardThickness, 9);
    part.dispose();
  });

  it('is the same model for the same specs', () => {
    const a = build();
    const b = build();
    expect(a.stopPositions.map((p) => p.toArray())).toEqual(b.stopPositions.map((p) => p.toArray()));
    expect(a.surfaces).toEqual(b.surfaces);
    const ga = (a.object.getObjectByName('terrain-cards') as Mesh).geometry.getAttribute('position');
    const gb = (b.object.getObjectByName('terrain-cards') as Mesh).geometry.getAttribute('position');
    expect(ga.count).toBe(gb.count);
    expect(Array.from(ga.array.slice(0, 600))).toEqual(Array.from(gb.array.slice(0, 600)));
    a.dispose();
    b.dispose();
  });

  it('takes the surfaces that were asked for', () => {
    const part = build({ surfaces: ['sand', 'rock'] });
    expect(new Set(part.surfaces)).toEqual(new Set(['sand', 'rock']));
    expect(part.surfaces[0]).toBe('sand');
    expect(part.surfaces[part.surfaces.length - 1]).toBe('rock');
    part.dispose();
  });

  it('grows out of its print: flat at 0, standing at 1, bottom cards first', () => {
    const part = build();
    const count = part.levels.length;
    const standing = part.boardHeight + count * part.cardThickness;
    expect(part.cardTop(count - 1)).toBeCloseTo(standing, 6);

    part.grow(0, true);
    expect(part.cardTop(count - 1)).toBeLessThan(part.boardHeight + 0.03);
    // Still stacked in order, so flat cards do not fight for the same depth.
    for (let card = 1; card < count; card += 1) expect(part.cardTop(card)).toBeGreaterThan(part.cardTop(card - 1));

    part.grow(0.4, true);
    const lowerStep = part.cardTop(1) - part.cardTop(0);
    const upperStep = part.cardTop(count - 1) - part.cardTop(count - 2);
    expect(lowerStep).toBeGreaterThan(upperStep * 5);

    part.grow(1, true);
    expect(part.cardTop(count - 1)).toBeCloseTo(standing, 6);
    part.dispose();
  });

  it('plays the growth over time on springs and comes to rest standing', () => {
    const part = build();
    const count = part.levels.length;
    const standing = part.boardHeight + count * part.cardThickness;
    part.playGrow(1.25);
    expect(part.cardTop(count - 1)).toBeLessThan(part.boardHeight + 0.03);
    let previousBottom = part.cardTop(0);
    let rose = false;
    let peak = 0;
    for (let i = 0; i < 60 * 5; i += 1) {
      part.update(frame(1 / 60));
      if (part.cardTop(0) > previousBottom + 1e-6) rose = true;
      previousBottom = part.cardTop(0);
      peak = Math.max(peak, part.cardTop(count - 1));
      if (i === 30) expect(part.cardTop(count - 1)).toBeLessThan(standing * 0.8);
    }
    expect(rose).toBe(true);
    // The springs carry the stack a little past its height before it settles.
    expect(peak).toBeGreaterThan(standing);
    expect(part.cardTop(count - 1)).toBeCloseTo(standing, 4);
    part.dispose();
  });

  it('follows grow() on springs and jumps under reduced motion', () => {
    const part = build();
    const count = part.levels.length;
    const standing = part.boardHeight + count * part.cardThickness;
    part.grow(0);
    part.update(frame(1 / 60));
    expect(part.cardTop(count - 1)).toBeGreaterThan(part.boardHeight + 0.1);
    expect(part.cardTop(count - 1)).toBeLessThan(standing);
    part.update(frame(1 / 60, true));
    expect(part.cardTop(count - 1)).toBeLessThan(part.boardHeight + 0.03);
    part.playGrow();
    part.update(frame(1 / 60, true));
    expect(part.cardTop(count - 1)).toBeCloseTo(standing, 6);
    part.dispose();
  });

  it('lifts the hovered card and those above it, and puts them back', () => {
    const part = build();
    const count = part.levels.length;
    const before = part.cardTop(count - 1);
    const below = part.cardTop(2);
    part.setHover(3);
    for (let i = 0; i < 120; i += 1) part.update(frame(1 / 60));
    expect(part.cardTop(count - 1)).toBeGreaterThan(before + 0.015);
    expect(part.cardTop(3)).toBeGreaterThan(below + part.cardThickness + 0.015);
    expect(part.cardTop(2)).toBeCloseTo(below, 6);
    part.setHover(null);
    for (let i = 0; i < 180; i += 1) part.update(frame(1 / 60));
    expect(part.cardTop(count - 1)).toBeCloseTo(before, 5);
    part.dispose();
  });

  it('accepts any progress value', () => {
    const part = build();
    for (const value of [-1, 0, 0.3, 1, 7, Number.NaN]) expect(() => part.setProgress(value)).not.toThrow();
    part.dispose();
  });

  it('gives pointer rays something to hit that matches the model', () => {
    const part = build();
    part.object.updateMatrixWorld(true);
    const summit = part.stopPositions[part.stopPositions.length - 1] as Vector3;
    const ray = new Raycaster(new Vector3(summit.x, 5, summit.z), new Vector3(0, -1, 0));
    const hit = ray.intersectObject(part.raycastTarget, false)[0];
    expect(hit).toBeDefined();
    expect(Math.abs((hit?.point.y ?? 0) - summit.y)).toBeLessThan(part.cardThickness * 3);
    const miss = new Raycaster(new Vector3(3, 5, 3), new Vector3(0, -1, 0));
    expect(miss.intersectObject(part.raycastTarget, false).length).toBe(0);
    part.dispose();
  });

  it('stands flags on their cards and can leave the decorations out', () => {
    const part = build();
    const poles = part.object.getObjectByName('terrain-poles') as InstancedMesh;
    expect(poles.count).toBe(4);
    const matrix = new Matrix4();
    const at = new Vector3();
    poles.getMatrixAt(3, matrix);
    at.setFromMatrixPosition(matrix);
    expect(at.distanceTo(part.stopPositions[4] as Vector3)).toBeCloseTo(0, 5);
    part.dispose();

    const forest = createTerrainModel({
      terrain: { seed: 'trees', template: 'massif' },
      trail: { seed: 'trees', template: 'spiral', stops: 4 },
      surfaces: ['forest', 'scree'],
      environment: phone,
    });
    const trees = forest.object.getObjectByName('terrain-trees') as InstancedMesh;
    const stones = forest.object.getObjectByName('terrain-stones') as InstancedMesh;
    expect(trees.count).toBeGreaterThan(10);
    expect(stones.count).toBeGreaterThan(5);
    for (let i = 0; i < trees.count; i += 1) {
      trees.getMatrixAt(i, matrix);
      at.setFromMatrixPosition(matrix);
      const card = forest.cardAt(at.x, at.z);
      expect(forest.surfaces[card]).toBe('forest');
      expect(at.y).toBeCloseTo(forest.cardTop(card), 5);
    }
    forest.dispose();

    const bare = createTerrainModel({
      terrain: { seed: 'trees', template: 'massif' },
      trail: { seed: 'trees', template: 'spiral', stops: 4 },
      surfaces: ['forest', 'scree'],
      environment: phone,
      decorations: false,
    });
    expect(bare.object.getObjectByName('terrain-trees')).toBeUndefined();
    bare.dispose();
  });

  it('leaves its parent and frees everything on dispose', () => {
    const part = build();
    const parent = new Mesh();
    parent.add(part.object);
    part.dispose();
    expect(part.object.parent).toBeNull();
    expect(() => part.dispose()).not.toThrow();
  });
});
