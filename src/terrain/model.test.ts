import {
  Color,
  InstancedMesh,
  Matrix4,
  Mesh,
  Raycaster,
  Vector3,
  type DataTexture,
  type MeshStandardMaterial,
  type Texture,
  type Vector2,
  type Vector4,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from 'three';
import { describe, expect, it } from 'vitest';
import type { SceneEnvironment } from '../scene/contract';
import { PALETTE } from '../scene/palette';
import { levelIndexAt } from './contours';
import { MAX_CARDS, ROUTE_LINE, TERRAIN_HOVER, createTerrainModel, terrainMaterials, type TerrainPart } from './model';

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

  it('lifts the hovered card and those above it, lets them glow, inks its outline, and puts them back', () => {
    const part = build();
    const cards = part.object.getObjectByName('terrain-cards') as Mesh;
    const shader = {
      uniforms: {},
      vertexShader: '#include <common>\n#include <begin_vertex>',
      fragmentShader: '#include <common>\n#include <color_fragment>',
    } as unknown as WebGLProgramParametersWithUniforms;
    (cards.material as MeshStandardMaterial).onBeforeCompile(shader, null as unknown as WebGLRenderer);
    const u = shader.uniforms as unknown as {
      uCard: { value: Vector4[] };
      uContour: { value: Texture };
      uContourCard: { value: Vector4 };
      uContourInk: { value: Vector4 };
      uHoverInk: { value: Color };
      uHoverLine: { value: Vector2 };
    };
    const channel = (card: number): number => u.uContourCard.value.toArray().indexOf(card);
    const inkOf = (card: number): number => (channel(card) < 0 ? 0 : (u.uContourInk.value.toArray()[channel(card)] as number));

    // GLSL refuses a name declared twice in one block, and only a real GPU compile would say so: check it here.
    const declared = [...shader.fragmentShader.matchAll(/\b(?:float|vec2|vec3|vec4)\s+([A-Za-z_]\w*)\s*=/g)].map((m) => m[1]);
    expect(declared.filter((name, i) => declared.indexOf(name) !== i)).toEqual([]);
    // The lifted cards light up, the hovered outline is inked, and nothing is drawn while no card is hovered.
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance += paper * vCardGlow;');
    expect(shader.fragmentShader).toMatch(/paper = mix\(paper, uHoverInk \* [^;]*, contour\);/);
    expect(u.uHoverInk.value.r).toBeCloseTo(new Color(PALETTE.signal).r * TERRAIN_HOVER.ink, 6);
    expect(u.uHoverLine.value.toArray()).toEqual([2.2, 4.6]);
    expect(u.uContourCard.value.toArray()).toEqual([-1, -1, -1, -1]);

    const count = part.levels.length;
    const before = part.cardTop(count - 1);
    const below = part.cardTop(2);
    const third = part.cardTop(3);
    part.setHover(3);
    // The glow eases toward its goal at 12 per second: after 0.1 s it has come 1 - e^-1.2 of the way.
    for (let i = 0; i < 6; i += 1) part.update(frame(1 / 60));
    expect(u.uCard.value[3]?.w).toBeCloseTo(TERRAIN_HOVER.glow * (1 - Math.exp(-1.2)), 4);
    for (let i = 0; i < 114; i += 1) part.update(frame(1 / 60));
    // SPEC 1.5: the hovered card and every card above it lift 0.064 and glow 0.26.
    expect(part.cardTop(count - 1) - before).toBeCloseTo(0.064, 6);
    expect(part.cardTop(3) - third).toBeCloseTo(0.064, 6);
    expect(part.cardTop(2)).toBeCloseTo(below, 6);
    for (let card = 0; card < count; card += 1) expect(u.uCard.value[card]?.w).toBeCloseTo(card >= 3 ? 0.26 : 0, 6);
    expect(inkOf(3)).toBe(1);
    const field = u.uContour.value as DataTexture;
    expect(field.isDataTexture).toBe(true);
    expect(field.image.width).toBe(256);

    // A pick further down: the cards between come up on their own springs, and the old outline fades out.
    part.setHover(1);
    part.update(frame(1 / 60));
    expect(inkOf(1)).toBeGreaterThan(0);
    expect(inkOf(1)).toBeLessThan(0.5);
    expect(inkOf(3)).toBeGreaterThan(0.5);
    expect(part.cardTop(1)).toBeLessThan(part.cardTop(0) + part.cardThickness + 0.064);
    for (let i = 0; i < 120; i += 1) part.update(frame(1 / 60));
    expect(inkOf(1)).toBe(1);
    expect(inkOf(3)).toBe(0);
    expect(u.uCard.value[1]?.w).toBeCloseTo(0.26, 6);
    expect(u.uCard.value[0]?.w).toBe(0);

    part.setHover(null);
    for (let i = 0; i < 180; i += 1) part.update(frame(1 / 60));
    expect(part.cardTop(count - 1)).toBeCloseTo(before, 6);
    for (let card = 0; card < count; card += 1) expect(u.uCard.value[card]?.w).toBe(0);
    expect(u.uContourInk.value.toArray()).toEqual([0, 0, 0, 0]);
    part.dispose();
  });

  it('jumps to the hover and back under reduced motion', () => {
    const part = build();
    const count = part.levels.length;
    const before = part.cardTop(count - 1);
    part.setHover(2);
    part.update(frame(1 / 60, true));
    expect(part.cardTop(count - 1) - before).toBeCloseTo(TERRAIN_HOVER.lift, 6);
    part.setHover(null);
    part.update(frame(1 / 60, true));
    expect(part.cardTop(count - 1)).toBeCloseTo(before, 6);
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

  it('prints the route on the faces of the cards and not down their cut edges', () => {
    const part = build();
    const cards = part.object.getObjectByName('terrain-cards') as Mesh;
    // The faces look up, the cut edges look sideways and their bevels half up: the shader tells them apart by that.
    const normal = cards.geometry.getAttribute('normal');
    const wall = cards.geometry.getAttribute('aWall');
    let faces = 0;
    let edges = 0;
    let bevels = 0;
    for (let i = 0; i < normal.count; i += 1) {
      const up = normal.getY(i);
      if (wall.getX(i) < 0.5) {
        expect(up).toBeGreaterThan(0.99);
        faces += 1;
      } else if (Math.abs(up) < 0.05) {
        edges += 1;
      } else if (up > 0.6 && up < 0.8) {
        bevels += 1;
      }
    }
    expect(faces).toBeGreaterThan(0);
    expect(edges).toBeGreaterThan(0);
    expect(bevels).toBeGreaterThan(0);

    const shader = {
      uniforms: {},
      vertexShader: '#include <common>\n#include <begin_vertex>',
      fragmentShader: '#include <common>\n#include <color_fragment>',
    } as unknown as WebGLProgramParametersWithUniforms;
    (cards.material as MeshStandardMaterial).onBeforeCompile(shader, null as unknown as WebGLRenderer);
    expect(shader.vertexShader).toContain('vCardUp = normal.y;');
    // The ink is held back by how far a face looks up: none at 0 (a cut edge), all of it from 0.6 (bevel and face).
    expect(shader.fragmentShader).toContain('float printed = smoothstep(0.35, 0.6, vCardUp);');
    expect(shader.fragmentShader).toMatch(/float inked = [^;]*\* printed;/);
    expect(shader.fragmentShader).toMatch(/paper = mix\(paper, ink, inked \* [0-9.]+\);/);

    // The numbers the shader keeps the line readable with: half its width and the reach of its ramp in print
    // coordinates, and the least half width in pixels.
    const line = (shader.uniforms as unknown as { uRouteLine: { value: Vector3 } }).uRouteLine.value;
    const print = (shader.uniforms as unknown as { uPrintScale: { value: number } }).uPrintScale.value;
    expect(line.x).toBeCloseTo((ROUTE_LINE.width / 2) * print, 12);
    expect(line.y).toBeGreaterThan(0);
    expect(line.y).toBeLessThan(line.x);
    expect(line.z).toBe(ROUTE_LINE.minPixels / 2);

    // Down a cut edge the only ink is the stroke that joins the two pieces of a dash. It is read from the green
    // channel, which marks the crossings, never from the red one, which would paint the whole edge under a dash.
    expect(shader.fragmentShader).toMatch(/float stitch = [^;]*route\.g\)[^;]*\* \(1\.0 - printed\)[^;]*;/);
    expect(shader.fragmentShader).not.toMatch(/route\.r[^;]*\(1\.0 - printed\)/);
    expect(shader.fragmentShader).toMatch(/paper = mix\(paper, ink \* [^;]*, stitch \* [0-9.]+\);/);
    // A card that still lies in the print has no edge to ink.
    expect(shader.fragmentShader).toMatch(/float stitch = [^;]*smoothstep\([0-9.]+, [0-9.]+, rise\);/);
    part.dispose();
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
