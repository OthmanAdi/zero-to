import { Mesh, Object3D, Vector3, type Material } from 'three';
import { describe, expect, it } from 'vitest';
import { PALETTE } from '../scene/palette';
import { createCompass, defaultCompassColors, dialRadiusFor } from './compass';
import { bearingToDirection, shortestTurn } from './heading';

// No WebGL here: the part is built with a null environment and only its transforms are read.
const frame = (t: number, dt = 1 / 60, reduced = false): { t: number; dt: number; reduced: boolean } => ({ t, dt, reduced });
const deg = (degrees: number): number => (degrees * Math.PI) / 180;

function named(root: Object3D, name: string): Object3D {
  const found = root.getObjectByName(name);
  if (!found) throw new Error(`no object named ${name}`);
  return found;
}

/** Where the needle points on the table, as a unit vector, read from the scene graph. */
function needleDirection(root: Object3D): { x: number; z: number } {
  root.updateMatrixWorld(true);
  const needle = named(root, 'compass-needle');
  const origin = needle.localToWorld(new Vector3(0, 0, 0));
  const tip = needle.localToWorld(new Vector3(0, 0, -1));
  const flat = tip.sub(origin).setY(0).normalize();
  return { x: flat.x, z: flat.z };
}

function run(part: ReturnType<typeof createCompass>, from: number, seconds: number, reduced = false): number {
  let t = from;
  for (let i = 0; i < Math.round(seconds * 60); i += 1) {
    t += 1 / 60;
    part.update(frame(t, 1 / 60, reduced));
  }
  return t;
}

describe('createCompass', () => {
  it('builds without a renderer and stays inside the triangle budget', () => {
    const part = createCompass();
    expect(part.object.name).toBe('compass');
    expect(part.triangles).toBeGreaterThan(5_000);
    expect(part.triangles).toBeLessThan(60_000);
    const phone = createCompass({ environment: { envMap: null, maxTexture: 1024, phone: true } });
    expect(phone.triangles).toBeLessThan(part.triangles * 0.6);
    part.dispose();
    phone.dispose();
  });

  it('takes its colours from the palette unless told otherwise', () => {
    expect(defaultCompassColors().brass).toBe(PALETTE.brass);
    expect(defaultCompassColors().signal).toBe(PALETTE.signal);
    const part = createCompass({ colors: { signal: '#00ff00' } });
    const needle = named(part.object, 'compass-needle') as Mesh;
    const north = (needle.material as Material[])[0] as unknown as { color: { getHexString(): string } };
    expect(north.color.getHexString()).toBe('00ff00');
    part.dispose();
  });

  it('is as wide as asked and floats clear of the table', () => {
    const part = createCompass({ diameter: 2.4 });
    part.update(frame(0, 0, true));
    part.object.updateMatrixWorld(true);
    const body = named(part.object, 'compass-body');
    const floater = named(part.object, 'compass-floater');
    expect(dialRadiusFor(2.4)).toBeCloseTo(0.77 * body.scale.x, 9);
    // The lowest point of the outer ring assembly is 0.2 below the ring.
    const lowest = floater.position.y - (2.4 / 2 + 0.2 * body.scale.x);
    expect(lowest).toBeGreaterThan(0.25);
    expect(part.object.position.y).toBe(0);
    const flat = createCompass({ outerRing: false });
    expect(named(flat.object, 'compass-floater').position.y).toBeLessThan(floater.position.y);
    part.dispose();
    flat.dispose();
  });

  it('bobs about 0.06 and turns the body while time runs', () => {
    const part = createCompass();
    const floater = named(part.object, 'compass-floater');
    const body = named(part.object, 'compass-body');
    part.update(frame(0, 0));
    const restY = floater.position.y;
    const restYaw = body.rotation.y;
    part.update(frame(1));
    expect(floater.position.y - restY).toBeCloseTo(0.06, 9);
    part.update(frame(3));
    expect(floater.position.y - restY).toBeCloseTo(-0.06, 9);
    part.update(frame(10));
    expect(body.rotation.y - restYaw).toBeCloseTo((Math.PI * 2) / 4, 9);
    part.dispose();
  });

  it('keeps the needle on the world bearing while the body turns under it', () => {
    const part = createCompass({ heading: deg(72), lean: 0, motion: { wobble: 0 } });
    for (const t of [0, 3, 9.5, 21, 38]) {
      part.update(frame(t, 0));
      const direction = needleDirection(part.object);
      const wanted = bearingToDirection(deg(72));
      // The resting needle trembles by well under a degree.
      expect(direction.x).toBeCloseTo(wanted.x, 1);
      expect(direction.z).toBeCloseTo(wanted.z, 1);
      expect(Math.hypot(direction.x - wanted.x, direction.z - wanted.z)).toBeLessThan(0.02);
    }
    part.dispose();
  });

  it('swings to a new heading the short way, overshoots a little and settles', () => {
    const part = createCompass({ heading: deg(350) });
    part.setHeading(deg(60));
    expect(part.heading).toBeCloseTo(deg(60), 9);
    expect(part.bearing).toBeCloseTo(deg(350), 9);
    let t = 0;
    let furthest = 0;
    let wrongWay = 0;
    for (let i = 0; i < 240; i += 1) {
      t += 1 / 60;
      part.update(frame(t));
      const travelled = shortestTurn(deg(350), part.bearing);
      furthest = Math.max(furthest, travelled);
      wrongWay = Math.min(wrongWay, travelled);
    }
    expect(wrongWay).toBeGreaterThan(-1e-6);
    expect(furthest).toBeGreaterThan(deg(70) * 1.08);
    expect(furthest).toBeLessThan(deg(70) * 1.3);
    expect(part.bearing).toBeCloseTo(deg(60), 3);
    part.dispose();
  });

  it('jumps when asked to', () => {
    const part = createCompass({ heading: 0, lean: 0, motion: { wobble: 0 } });
    part.update(frame(5, 0));
    part.setHeading(deg(216), { immediate: true });
    expect(part.bearing).toBeCloseTo(deg(216), 9);
    const direction = needleDirection(part.object);
    expect(direction.x).toBeCloseTo(bearingToDirection(deg(216)).x, 9);
    expect(direction.z).toBeCloseTo(bearingToDirection(deg(216)).z, 9);
    part.dispose();
  });

  it('holds still with reduced motion and snaps the needle', () => {
    const part = createCompass({ heading: 0 });
    const floater = named(part.object, 'compass-floater');
    const body = named(part.object, 'compass-body');
    part.update(frame(0, 0, true));
    const y = floater.position.y;
    const yaw = body.rotation.y;
    const quaternion = floater.quaternion.clone();
    part.setTilt(1, -1);
    part.setHeading(deg(144));
    part.update(frame(7.3, 1 / 60, true));
    expect(floater.position.y).toBe(y);
    expect(body.rotation.y).toBe(yaw);
    // angleTo goes through an arc cosine, which is only good to about 1e-7 near zero.
    expect(floater.quaternion.angleTo(quaternion)).toBeCloseTo(0, 6);
    expect(floater.quaternion.toArray()).toEqual(quaternion.toArray());
    expect(named(part.object, 'compass-inner-ring').rotation.x).toBe(0);
    expect(part.bearing).toBeCloseTo(deg(144), 9);
    part.dispose();
  });

  it('tips a little towards the pointer, and never far', () => {
    const part = createCompass({ lean: 0, motion: { wobble: 0 } });
    const floater = named(part.object, 'compass-floater');
    part.setTilt(5, 0);
    run(part, 0, 3);
    const up = new Vector3(0, 1, 0).applyQuaternion(floater.quaternion);
    expect(up.x).toBeGreaterThan(0.03);
    expect(up.x).toBeLessThan(0.12);
    expect(Math.abs(up.z)).toBeLessThan(1e-6);
    part.dispose();
  });

  it('leans the dial towards the viewer on +Z by default', () => {
    const part = createCompass({ motion: { wobble: 0 } });
    part.update(frame(0, 0));
    const up = new Vector3(0, 1, 0).applyQuaternion(named(part.object, 'compass-floater').quaternion);
    expect(up.z).toBeGreaterThan(0.1);
    expect(Math.abs(up.x)).toBeLessThan(1e-9);
    part.dispose();
  });

  it('eases the glow and clamps it', () => {
    const part = createCompass({ glow: 0 });
    const ground = named(part.object, 'compass-ground') as Mesh;
    const glow = (): number => (ground.material as unknown as { uniforms: { uGlow: { value: number } } }).uniforms.uGlow.value;
    part.update(frame(0, 0, true));
    expect(glow()).toBe(0);
    part.setGlow(9);
    part.update(frame(0.1, 0.1));
    expect(glow()).toBeGreaterThan(0);
    expect(glow()).toBeLessThan(0.6);
    part.update(frame(0.2, 0.1, true));
    expect(glow()).toBe(1);
    part.dispose();
  });

  it('lights the halo behind the compass with the glow', () => {
    const part = createCompass({ glow: 0 });
    const halo = named(part.object, 'compass-halo') as Mesh;
    const strength = (): number =>
      (halo.material as unknown as { uniforms: { uStrength: { value: number } } }).uniforms.uStrength.value;
    part.update(frame(0, 0, true));
    const idle = strength();
    expect(idle).toBeGreaterThan(0);
    expect(idle).toBeLessThan(0.05);
    part.setGlow(1);
    part.update(frame(0, 0, true));
    expect(strength()).toBeGreaterThan(idle * 2);
    expect(strength()).toBeLessThan(0.2);
    // It floats with the compass, and the shader places it, so it must never be culled by its tiny bounds.
    expect(halo.parent?.name).toBe('compass-floater');
    expect(halo.frustumCulled).toBe(false);
    part.dispose();
  });

  it('shrinks the contact shadow when the compass rises', () => {
    const part = createCompass();
    const ground = named(part.object, 'compass-ground') as Mesh;
    const uniforms = (ground.material as unknown as { uniforms: Record<string, { value: number }> }).uniforms;
    part.update(frame(1, 0));
    const high = { radius: uniforms.uShadowRadius?.value ?? 0, strength: uniforms.uShadow?.value ?? 0 };
    part.update(frame(3, 0));
    const low = { radius: uniforms.uShadowRadius?.value ?? 0, strength: uniforms.uShadow?.value ?? 0 };
    expect(high.radius).toBeLessThan(low.radius);
    expect(high.strength).toBeLessThan(low.strength);
    part.dispose();
  });

  it('ignores values that are not numbers', () => {
    const part = createCompass({ heading: deg(30) });
    part.setHeading(Number.NaN);
    part.setGlow(Number.NaN);
    part.setTilt(Number.NaN, Number.POSITIVE_INFINITY);
    run(part, 0, 1);
    expect(part.heading).toBeCloseTo(deg(30), 9);
    expect(Number.isFinite(part.bearing)).toBe(true);
    part.dispose();
  });

  it('frees everything and leaves its parent on dispose', () => {
    const parent = new Object3D();
    const part = createCompass();
    parent.add(part.object);
    const meshes: Mesh[] = [];
    part.object.traverse((child) => {
      if (child instanceof Mesh) meshes.push(child);
    });
    expect(meshes.length).toBeGreaterThanOrEqual(6);
    let disposed = 0;
    for (const mesh of meshes) mesh.geometry.addEventListener('dispose', () => (disposed += 1));
    part.dispose();
    expect(disposed).toBe(meshes.length);
    expect(parent.children).toHaveLength(0);
    expect(part.object.children).toHaveLength(0);
    // Safe to call again, and update after dispose does nothing.
    part.dispose();
    part.update(frame(1));
  });
});
