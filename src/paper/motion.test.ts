import { describe, expect, it } from 'vitest';
import {
  EASE,
  bounceFloor,
  critDamp,
  easeOutBack,
  easeOutElastic,
  fitPose,
  orbitDirection,
  projectToScreen,
  seg,
  settleSpring,
  smooth,
  spring,
  springAtRest,
  springEnergy,
  stepSpringKC,
  type ScreenBox,
  type Vec3,
} from './motion';

describe('stepSpringKC', () => {
  it('never gains energy for any frame time up to 34 ms at stiffness 260', () => {
    for (const c of [0, 4, 12, 24, 32.25, 60]) {
      for (const dt of [0.001, 0.004, 0.0083, 0.0167, 0.025, 0.034]) {
        const state = spring(1, -3);
        let energy = springEnergy(state, 0, 260);
        for (let step = 0; step < 400; step += 1) {
          stepSpringKC(state, 0, 260, c, dt);
          const next = springEnergy(state, 0, 260);
          expect(next).toBeLessThanOrEqual(energy * (1 + 1e-9) + 1e-12);
          energy = next;
        }
      }
    }
  });

  it('gives the same curve whatever the frame rate', () => {
    const coarse = spring(0, 0);
    const fine = spring(0, 0);
    for (let step = 0; step < 30; step += 1) stepSpringKC(coarse, 1, 150, 12, 1 / 30);
    for (let step = 0; step < 240; step += 1) stepSpringKC(fine, 1, 150, 12, 1 / 240);
    expect(coarse.x).toBeCloseTo(fine.x, 9);
    expect(coarse.v).toBeCloseTo(fine.v, 8);
  });

  it('overshoots when underdamped and does not when overdamped', () => {
    const lively = spring(0, 0);
    const heavy = spring(0, 0);
    let livelyPeak = 0;
    let heavyPeak = 0;
    for (let step = 0; step < 600; step += 1) {
      stepSpringKC(lively, 1, 150, 12, 1 / 120);
      stepSpringKC(heavy, 1, 15, 9, 1 / 120);
      livelyPeak = Math.max(livelyPeak, lively.x);
      heavyPeak = Math.max(heavyPeak, heavy.x);
    }
    expect(livelyPeak).toBeGreaterThan(1.1);
    expect(livelyPeak).toBeLessThan(1.25);
    expect(heavyPeak).toBeLessThanOrEqual(1 + 1e-9);
    expect(springAtRest(lively, 1, 1e-3)).toBe(true);
  });

  it('matches a small-step semi-implicit integration of the same equation', () => {
    const exact = spring(0.3, 1.5);
    stepSpringKC(exact, 1, 55, 14, 0.5);
    let x = 0.3;
    let v = 1.5;
    const h = 1e-5;
    for (let step = 0; step < 50000; step += 1) {
      v += ((1 - x) * 55 - v * 14) * h;
      x += v * h;
    }
    expect(exact.x).toBeCloseTo(x, 4);
    expect(exact.v).toBeCloseTo(v, 3);
  });

  it('coasts to a stop with drag only, and stands still without time', () => {
    const coasting = spring(0, 2);
    stepSpringKC(coasting, 0, 0, 4, 10);
    expect(coasting.x).toBeCloseTo(0.5, 6);
    expect(coasting.v).toBeCloseTo(0, 6);
    const still = spring(0.4, 1);
    stepSpringKC(still, 1, 150, 12, 0);
    expect(still).toEqual({ x: 0.4, v: 1 });
  });

  it('is critically damped exactly at c = 2 sqrt(k)', () => {
    const a = spring(0, 0);
    const b = spring(0, 0);
    stepSpringKC(a, 1, 64, 16, 0.3);
    critDamp(b, 1, 8, 0.3);
    expect(a.x).toBeCloseTo(b.x, 9);
    expect(a.v).toBeCloseTo(b.v, 9);
  });
});

describe('critDamp', () => {
  it('reaches 95 percent in about 0.6 s at 8 radians per second and never overshoots', () => {
    const state = spring(0, 0);
    let reached = -1;
    for (let step = 1; step <= 240; step += 1) {
      critDamp(state, 1, 8, 1 / 120);
      expect(state.x).toBeLessThanOrEqual(1);
      if (reached < 0 && state.x >= 0.95) reached = step / 120;
    }
    expect(reached).toBeGreaterThan(0.55);
    expect(reached).toBeLessThan(0.65);
  });
});

describe('floor and rest', () => {
  it('turns the speed round at the floor and scales it', () => {
    const sheet = spring(-1.7, -3);
    expect(bounceFloor(sheet, -Math.PI / 2, 0.2)).toBe(true);
    expect(sheet.x).toBe(-Math.PI / 2);
    expect(sheet.v).toBeCloseTo(0.6, 12);
    expect(bounceFloor(sheet, -Math.PI / 2, 0.2)).toBe(false);
  });

  it('settles on the target', () => {
    expect(settleSpring(spring(3, 9), 1)).toEqual({ x: 1, v: 0 });
  });
});

describe('easings', () => {
  it('start at 0 and end at exactly 1', () => {
    for (const [name, ease] of Object.entries(EASE)) {
      expect(ease(0), name).toBeCloseTo(0, 12);
      expect(ease(1), name).toBe(1);
      expect(ease(2), name).toBe(1);
      expect(ease(-1), name).toBeCloseTo(0, 12);
    }
  });

  it('elastic-out ends at exactly 1 for every period and rings past it on the way', () => {
    for (const period of [0.2, 0.3, 0.42, 0.75]) {
      expect(easeOutElastic(1, period)).toBe(1);
      expect(easeOutElastic(0, period)).toBe(0);
    }
    let peak = 0;
    for (let i = 0; i <= 200; i += 1) peak = Math.max(peak, easeOutElastic(i / 200, 0.42));
    expect(peak).toBeGreaterThan(1.1);
  });

  it('back-out passes the end by more with a larger overshoot', () => {
    const peakOf = (overshoot: number) => {
      let peak = 0;
      for (let i = 0; i <= 200; i += 1) peak = Math.max(peak, easeOutBack(i / 200, overshoot));
      return peak;
    };
    expect(peakOf(1.70158)).toBeCloseTo(1.1, 2);
    expect(peakOf(2.4)).toBeGreaterThan(peakOf(1.70158));
  });

  it('in-out curves are symmetric and monotonic', () => {
    for (const ease of [EASE.cubicInOut, EASE.power2InOut]) {
      let last = 0;
      for (let i = 0; i <= 100; i += 1) {
        const value = ease(i / 100);
        expect(value).toBeGreaterThanOrEqual(last);
        expect(value + ease(1 - i / 100)).toBeCloseTo(1, 12);
        last = value;
      }
    }
  });

  it('bounce-out stays inside 0..1', () => {
    for (let i = 0; i <= 400; i += 1) {
      const value = EASE.bounceOut(i / 400);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('seg and smooth clamp', () => {
    expect(seg(0.5, 0.14, 1)).toBeCloseTo(0.4186, 4);
    expect(seg(-1, 0, 1)).toBe(0);
    expect(seg(3, 0, 1)).toBe(1);
    expect(smooth(0.5)).toBe(0.5);
    expect(smooth(7)).toBe(1);
  });
});

describe('fitPose', () => {
  // A sheet lying on the table, a mountain box on it and the compass above the centre.
  const hero: Vec3[] = [];
  for (const x of [-2.1, 2.1]) for (const z of [3, 8.6]) hero.push({ x, y: 0, z });
  for (const x of [-1.84, 1.84]) for (const z of [3.96, 7.64]) hero.push({ x, y: 1.4, z });
  for (let i = 0; i < 12; i += 1) {
    const a = (i / 12) * Math.PI * 2;
    hero.push({ x: Math.cos(a) * 1.2, y: 1.1 + Math.sin(a) * 1.2, z: 0 });
  }
  const panel: Vec3[] = [
    { x: 0, y: 0, z: 0 },
    { x: 4.2, y: 0, z: 0 },
    { x: 0, y: 0, z: 5.6 },
    { x: 4.2, y: 0, z: 5.6 },
    { x: 0, y: 1.9, z: 0.4 },
    { x: 4.2, y: 1.9, z: 0.4 },
  ];
  const cases: { name: string; points: Vec3[]; elevation: number; yaw: number; fov: number; box: ScreenBox }[] = [
    { name: 'hero', points: hero, elevation: 44, yaw: -4, fov: 32, box: { x0: -0.44, x1: 0.2, y0: -0.96, y1: 0.68 } },
    { name: 'hero narrow', points: hero, elevation: 47, yaw: -6, fov: 38, box: { x0: -0.9, x1: 0.9, y0: -0.96, y1: 0.2 } },
    { name: 'panel', points: panel, elevation: 30, yaw: -9, fov: 34, box: { x0: -0.8, x1: 0.98, y0: -0.98, y1: 0.84 } },
    { name: 'wide', points: panel, elevation: 30, yaw: -17, fov: 40, box: { x0: -0.9, x1: 0.9, y0: -0.7, y1: 0.7 } },
    { name: 'shut map', points: panel, elevation: 58, yaw: -4, fov: 34, box: { x0: -0.6, x1: 0.6, y0: -0.6, y1: 0.6 } },
  ];

  for (const aspect of [0.46, 1, 1.6, 2.4]) {
    for (const scene of cases) {
      it(`puts every point inside the box within 0.02: ${scene.name}, aspect ${aspect}`, () => {
        const pose = fitPose(scene.points, { x: 0, y: 0, z: 2 }, scene.elevation, scene.yaw, scene.fov, scene.box, aspect);
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (const point of scene.points) {
          const screen = projectToScreen(pose, point, aspect);
          expect(screen.z).toBeGreaterThan(0);
          minX = Math.min(minX, screen.x);
          maxX = Math.max(maxX, screen.x);
          minY = Math.min(minY, screen.y);
          maxY = Math.max(maxY, screen.y);
        }
        expect(minX).toBeGreaterThanOrEqual(scene.box.x0 - 0.02);
        expect(maxX).toBeLessThanOrEqual(scene.box.x1 + 0.02);
        expect(minY).toBeGreaterThanOrEqual(scene.box.y0 - 0.02);
        expect(maxY).toBeLessThanOrEqual(scene.box.y1 + 0.02);
        // It fits, it does not merely shrink: one dimension fills the box.
        const fill = Math.max((maxX - minX) / (scene.box.x1 - scene.box.x0), (maxY - minY) / (scene.box.y1 - scene.box.y0));
        expect(fill).toBeGreaterThan(0.97);
        expect(fill).toBeLessThan(1.02);
      });
    }
  }

  it('keeps the viewing direction it was given', () => {
    const pose = fitPose(panel, { x: 2, y: 0, z: 2 }, 30, -9, 34, { x0: -0.8, x1: 0.98, y0: -0.98, y1: 0.84 }, 1.6);
    const dir = orbitDirection(30, -9);
    expect((pose.position.x - pose.target.x) / pose.distance).toBeCloseTo(dir.x, 9);
    expect((pose.position.y - pose.target.y) / pose.distance).toBeCloseTo(dir.y, 9);
    expect((pose.position.z - pose.target.z) / pose.distance).toBeCloseTo(dir.z, 9);
    expect(pose.fov).toBe(34);
  });

  it('returns the starting pose when there is nothing to fit', () => {
    const pose = fitPose([], { x: 1, y: 0, z: 0 }, 90, 0, 30, { x0: -1, x1: 1, y0: -1, y1: 1 }, 1);
    expect(pose.distance).toBe(12.8);
    expect(pose.position.y).toBeCloseTo(12.8, 9);
    expect(pose.target).toEqual({ x: 1, y: 0, z: 0 });
  });

  it('survives looking straight down', () => {
    const pose = fitPose(panel, { x: 2, y: 0, z: 2 }, 90, 0, 34, { x0: -0.8, x1: 0.8, y0: -0.8, y1: 0.8 }, 1.3);
    for (const point of panel) {
      const screen = projectToScreen(pose, point, 1.3);
      expect(Math.abs(screen.x)).toBeLessThanOrEqual(0.82);
      expect(Math.abs(screen.y)).toBeLessThanOrEqual(0.82);
    }
  });
});
