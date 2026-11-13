import { ShaderLib } from 'three';
import { describe, expect, it } from 'vitest';
import {
  PAPER,
  createPaperDepthMaterial,
  createPaperMaterial,
  createPaperUniforms,
  paperShadowVertex,
  paperUniforms,
} from './material';
import { ROUTE, createRouteGeometry, createRouteMaterial } from './route';
import { blurField, silhouettePad } from './silhouette';
import { STACK, createSheetStack, keepApart, leafProgress, type Leaf, type LeafPose } from './stack';

const LYING = -Math.PI / 2;
const frame = (t: number, dt = 1 / 60, reduced = false) => ({ t, dt, reduced });

describe('paper material', () => {
  it('carries the tuned values of the scene', () => {
    expect(PAPER).toMatchObject({ warp: 0.026, deckle: 0.006, fibre: 0.085, rim: 0.55, hinge: 0.22, roughness: 0.94 });
    const material = createPaperMaterial({ size: [2, 1], seed: 4 });
    expect(material.roughness).toBe(0.94);
    expect(material.metalness).toBe(0);
    expect(material.alphaToCoverage).toBe(true);
    const uniforms = paperUniforms(material);
    expect(uniforms.uZtBox.value.toArray()).toEqual([2, 1, 0, 4]);
    expect(uniforms.uZtShape.value.x).toBe(0.026);
    expect(uniforms.uZtShape.value.z).toBe(0.006);
    expect(uniforms.uZtHasSil.value).toBe(0);
  });

  it('shares one program between all sheets and one set of uniforms between a sheet and its shadow', () => {
    const a = createPaperMaterial({ seed: 1 });
    const b = createPaperMaterial({ seed: 2, deckle: 0.02, back: '#ffffff' });
    expect(a.customProgramCacheKey()).toBe(b.customProgramCacheKey());
    const depth = createPaperDepthMaterial(a);
    expect(paperUniforms(depth)).toBe(paperUniforms(a));
    expect(createPaperDepthMaterial(a).customProgramCacheKey()).toBe(createPaperDepthMaterial(b).customProgramCacheKey());
    expect(paperUniforms(b).uZtShade.value.w).toBe(1);
    expect(createPaperUniforms().uZtShade.value.w).toBe(0);
  });

  it('finds every place of the stock shaders that it patches', () => {
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: ShaderLib.standard.vertexShader,
      fragmentShader: ShaderLib.standard.fragmentShader,
    };
    const material = createPaperMaterial();
    (material.onBeforeCompile as unknown as (s: typeof shader) => void)(shader);
    expect(shader.uniforms.uZtSil).toBe(paperUniforms(material).uZtSil);
    expect(shader.vertexShader).toContain('transformed.z += ztLift;');
    expect(shader.vertexShader).toContain('objectNormal = normalize( vec3( - ztSlope, 1.0 ) );');
    expect(shader.vertexShader).not.toContain('#include <shadowmap_vertex>');
    expect(shader.vertexShader).toContain('ztFar');
    expect(shader.fragmentShader).toContain('RE_Direct_Paper');
    expect(shader.fragmentShader).toContain('diffuseColor.a = ztEdge;');
    expect(shader.fragmentShader).toContain('uZtMatte > 0.5');

    const depthShader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: ShaderLib.depth.vertexShader,
      fragmentShader: ShaderLib.depth.fragmentShader,
    };
    const depth = createPaperDepthMaterial(material);
    (depth.onBeforeCompile as unknown as (s: typeof depthShader) => void)(depthShader);
    expect(depthShader.vertexShader).toContain('transformed.z += ztLift;');
    expect(depthShader.vertexShader).toContain('ztFoot');
    expect(depthShader.fragmentShader).toContain('if ( ztField() < 0.5 ) discard;');
    expect(depthShader.fragmentShader).not.toContain('#include <alphatest_fragment>');
  });

  it('knows the layout of the stock shadow lookup', () => {
    // If this fails after a three.js upgrade, sheets lit from behind lose their glow. Nothing else breaks.
    expect(paperShadowVertex()).not.toBeNull();
  });
});

describe('route', () => {
  it('measures length along the ground and lays two vertices per point', () => {
    const ribbon = createRouteGeometry([
      { x: 0, y: 0, z: 0 },
      { x: 3, y: 0.5, z: 0 },
      { x: 3, y: 0.5, z: 4 },
    ]);
    expect(ribbon.length).toBeCloseTo(7, 9);
    expect(ribbon.lengths).toEqual([0, 3, 7]);
    const position = ribbon.geometry.getAttribute('position');
    expect(position.count).toBe(6);
    expect(ribbon.geometry.getAttribute('aS').array[5]).toBeCloseTo(7, 6);
    expect(Array.from(ribbon.geometry.getAttribute('aV').array)).toEqual([1, -1, 1, -1, 1, -1]);
    // The first pair straddles the start, half a width to each side, lifted off the paper.
    expect(position.getZ(0) - position.getZ(1)).toBeCloseTo(-ROUTE.width, 6);
    expect(position.getY(0)).toBeCloseTo(ROUTE.lift, 6);
    expect(position.getY(2)).toBeCloseTo(0.5 + ROUTE.lift, 6);
    expect(ribbon.geometry.getIndex()?.count).toBe(12);
  });

  it('continues from an earlier panel and survives a single point', () => {
    const ribbon = createRouteGeometry([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], { startLength: 10, width: 0.2 });
    expect(ribbon.lengths).toEqual([10, 11]);
    expect(createRouteGeometry([{ x: 0, y: 0, z: 0 }]).length).toBe(0);
    expect(createRouteGeometry([]).geometry.getAttribute('position').count).toBe(0);
  });

  it('reveals, marks the walked part and rides a lift through uniforms', () => {
    const material = createRouteMaterial();
    material.setDraw(2.5);
    material.setWalked(1.25);
    material.setLift(0.03);
    expect(material.userData.route.uZtRoute.value.toArray()).toEqual([2.5, 1.25, ROUTE.period, ROUTE.ink]);
    expect(material.userData.route.uZtRouteLift.value.x).toBe(0.03);
    expect(ROUTE).toMatchObject({ width: 0.05, lift: 0.004, period: 0.15, ink: 0.6 });

    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: ShaderLib.standard.vertexShader,
      fragmentShader: ShaderLib.standard.fragmentShader,
    };
    (material.onBeforeCompile as unknown as (s: typeof shader) => void)(shader);
    expect(shader.vertexShader).toContain('attribute float aS;');
    expect(shader.fragmentShader).not.toContain('#include <alphatest_fragment>');
    expect(shader.fragmentShader).toContain('ztDash');
  });

  it('bends with the sheet it follows', () => {
    const sheet = createPaperMaterial({ size: [4.2, 5.6], seed: 3 });
    const route = createRouteMaterial({ follow: sheet });
    expect(route.userData.route.uZtBox).toBe(paperUniforms(sheet).uZtBox);
    expect(route.userData.route.uZtRouteLift.value.z).toBe(1);
    expect(createRouteMaterial().userData.route.uZtRouteLift.value.z).toBe(0);
  });
});

describe('silhouette', () => {
  it('blurs a hard edge into a field that passes one half on the edge', () => {
    const width = 64;
    const height = 8;
    const field = new Float32Array(width * height);
    for (let y = 0; y < height; y += 1) for (let x = 32; x < width; x += 1) field[y * width + x] = 1;
    blurField(field, width, height, 5);
    const row = (x: number) => field[3 * width + x] as number;
    expect((row(31) + row(32)) / 2).toBeCloseTo(0.5, 2);
    expect(row(10)).toBeCloseTo(0, 3);
    expect(row(54)).toBeCloseTo(1, 3);
    for (let x = 1; x < width; x += 1) expect(row(x)).toBeGreaterThanOrEqual(row(x - 1) - 1e-6);
    // About as wide as a Gaussian of that radius: one radius inside the edge the field is near 0.84.
    expect(row(36)).toBeGreaterThan(0.74);
    expect(row(36)).toBeLessThan(0.92);
  });

  it('leaves a field alone at radius 0 and pads for blur and tear', () => {
    const field = new Float32Array([0, 1, 0, 1]);
    expect(Array.from(blurField(field, 2, 2, 0))).toEqual([0, 1, 0, 1]);
    expect(silhouettePad(4)).toBe(18);
    expect(silhouettePad(0)).toBe(6);
  });
});

describe('sheet stack', () => {
  const leaf = (z: number, extra: Partial<Leaf> = {}): Leaf => ({ height: 1, width: 1, x: 0, z, ...extra });

  it('lets the front sheets lead both ways', () => {
    // Rising: the front sheet (highest rank) is ahead. Falling: it is already further down.
    expect(leafProgress(0.3, 2, 3, true)).toBeGreaterThan(leafProgress(0.3, 0, 3, true));
    expect(leafProgress(0.7, 2, 3, false)).toBeLessThan(leafProgress(0.7, 0, 3, false));
    for (const rising of [true, false]) {
      for (let rank = 0; rank < 3; rank += 1) {
        expect(leafProgress(0, rank, 3, rising)).toBe(0);
        expect(leafProgress(1, rank, 3, rising)).toBe(1);
        let last = 0;
        for (let i = 0; i <= 50; i += 1) {
          const value = leafProgress(i / 50, rank, 3, rising);
          expect(value).toBeGreaterThanOrEqual(last);
          last = value;
        }
      }
    }
  });

  it('ranks by depth, stiffens the front and rests lying sheets one on another', () => {
    const stack = createSheetStack();
    const front = stack.add(leaf(2));
    const back = stack.add(leaf(0));
    const middle = stack.add(leaf(1));
    expect([stack.state(back).rank, stack.state(middle).rank, stack.state(front).rank]).toEqual([0, 1, 2]);
    expect(stack.state(front).angle).toBe(LYING);
    expect(stack.state(back).lift).toBeCloseTo(STACK.restPerRank, 9);
    expect(stack.state(front).lift).toBeCloseTo(STACK.restPerRank * 3, 9);
    expect(stack.atRest).toBe(true);
    expect(() => stack.state(9)).toThrow();
  });

  it('stands up with a bounce and comes to rest standing', () => {
    const stack = createSheetStack();
    const poses: LeafPose[] = [];
    const index = stack.add(leaf(0, { apply: (pose) => poses.push(pose) }));
    stack.setFold(1);
    let peak = -Infinity;
    for (let i = 1; i <= 240; i += 1) {
      stack.update(frame(i / 60));
      peak = Math.max(peak, stack.state(index).angle);
    }
    // Underdamped: it swings past upright before it settles.
    expect(peak).toBeGreaterThan(0.05);
    expect(stack.state(index).angle).toBeCloseTo(0, 3);
    expect(stack.state(index).lift).toBeCloseTo(0, 4);
    expect(stack.state(index).up).toBeCloseTo(1, 3);
    expect(stack.atRest).toBe(true);
    expect(poses.length).toBeGreaterThan(200);
  });

  it('never lets a sheet go through the map, and bounces it', () => {
    const stack = createSheetStack();
    const index = stack.add(leaf(0));
    stack.setFold(1);
    for (let i = 1; i <= 120; i += 1) stack.update(frame(i / 60));
    stack.setFold(0);
    let rebounds = 0;
    let lastAngle = stack.state(index).angle;
    let falling = true;
    for (let i = 121; i <= 420; i += 1) {
      stack.update(frame(i / 60));
      const angle = stack.state(index).angle;
      expect(angle).toBeGreaterThanOrEqual(LYING);
      if (falling && angle > lastAngle + 1e-6) {
        rebounds += 1;
        falling = false;
      } else if (angle < lastAngle) {
        falling = true;
      }
      lastAngle = angle;
    }
    expect(rebounds).toBeGreaterThanOrEqual(1);
    expect(stack.state(index).angle).toBeCloseTo(LYING, 3);
  });

  it('keeps a sheet behind at least as low as a front sheet that reaches it', () => {
    const leaves = [leaf(1), leaf(0.5), leaf(0.5, { x: 3 }), leaf(-2)];
    const angles = [-1.2, -0.2, -0.2, -0.2];
    const moved = keepApart(leaves, angles);
    // The front sheet leans back 1.2 rad and reaches sin(1.2) = 0.93 behind its hinge.
    expect(moved).toEqual([1]);
    expect(angles).toEqual([-1.2, -1.2, -0.2, -0.2]);
    // A sheet that stands reaches nothing.
    expect(keepApart(leaves, [0, -0.5, -0.5, -0.5])).toEqual([]);
  });

  it('folds a whole stack without any sheet passing through another', () => {
    const stack = createSheetStack();
    const ids = [stack.add(leaf(0.9)), stack.add(leaf(0.6)), stack.add(leaf(0.3))];
    stack.setFold(1);
    for (let i = 1; i <= 240; i += 1) stack.update(frame(i / 60));
    stack.setFold(0);
    for (let i = 241; i <= 600; i += 1) {
      stack.update(frame(i / 60));
      const [front, middle, back] = ids.map((id) => stack.state(id).angle) as [number, number, number];
      // Whenever the front sheet reaches the hinge behind it, the sheet there is at least as far down.
      if (Math.sin(-front) > 0.3) expect(middle).toBeLessThanOrEqual(front + 1e-9);
      if (Math.sin(-middle) > 0.3) expect(back).toBeLessThanOrEqual(middle + 1e-9);
    }
    for (const id of ids) expect(stack.state(id).angle).toBeCloseTo(LYING, 3);
  });

  it('sways only while standing, and holds still for reduced motion', () => {
    const stack = createSheetStack();
    const index = stack.add(leaf(0, { sway: 0.01, phase: 1 }));
    stack.update(frame(1));
    expect(stack.state(index).sway).toBe(0);
    stack.setFold(1);
    stack.settle();
    let widest = 0;
    for (let i = 0; i < 600; i += 1) {
      stack.update(frame(i / 20, 1 / 20));
      widest = Math.max(widest, Math.abs(stack.state(index).sway));
    }
    expect(widest).toBeGreaterThan(0.008);
    expect(widest).toBeLessThanOrEqual(0.01);

    stack.setFold(0);
    stack.update(frame(40, 1 / 60, true));
    expect(stack.state(index).angle).toBe(LYING);
    expect(stack.state(index).sway).toBe(0);
    expect(stack.atRest).toBe(true);
  });

  it('uses a softer spring when a sheet brings its own', () => {
    const quick = createSheetStack();
    const slow = createSheetStack();
    const a = quick.add(leaf(0));
    const b = slow.add(leaf(0, { stiffness: 70, damping: 12 }));
    quick.setFold(1);
    slow.setFold(1);
    for (let i = 1; i <= 9; i += 1) {
      quick.update(frame(i / 60));
      slow.update(frame(i / 60));
    }
    expect(quick.state(a).angle).toBeGreaterThan(slow.state(b).angle);
  });
});
