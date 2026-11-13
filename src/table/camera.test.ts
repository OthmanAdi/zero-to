import { describe, expect, it } from 'vitest';
import { projectToScreen, type Vec3 } from '../paper/motion';
import { HERO_CAMERA, heroPose, heroShot, introPush, isNarrow } from './camera';
import { COVER } from './cover';
import { TURN } from './turntable';

/** The points a table with five sheets hands the camera: the lit sheet, a tall mountain and the compass. */
function points(): Vec3[] {
  const list: Vec3[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) list.push({ x: (sx * COVER.body.width) / 2, y: 0.07, z: TURN.radius + (sz * COVER.body.depth) / 2 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) list.push({ x: sx * 1.2, y: 1.46, z: TURN.radius + 0.15 + sz * 1.2 });
  list.push({ x: 0, y: 4.9, z: 0 }, { x: 0, y: 0.9, z: 0 }, { x: -2, y: 2.9, z: 0 }, { x: 2, y: 2.9, z: 0 });
  return list;
}

describe('isNarrow', () => {
  it('is true up to 760 px wide or for a tall window', () => {
    expect(isNarrow(390, 844)).toBe(true);
    expect(isNarrow(760, 400)).toBe(true);
    expect(isNarrow(1000, 1300)).toBe(true);
    expect(isNarrow(1440, 900)).toBe(false);
    expect(isNarrow(1024, 768)).toBe(false);
  });
});

describe('heroShot', () => {
  it('uses the wide shot on a desktop and the narrow one on a phone', () => {
    expect(heroShot(1440, 900)).toMatchObject({ elevation: HERO_CAMERA.wide.elevation, fov: HERO_CAMERA.wide.fov });
    expect(heroShot(390, 844)).toMatchObject({ elevation: HERO_CAMERA.narrow.elevation, fov: HERO_CAMERA.narrow.fov });
  });

  it('moves the top of the box down to clear a headline above the scene', () => {
    const free = heroShot(390, 844);
    const cleared = heroShot(390, 844, { clearBelow: 0.3 });
    expect(cleared.box.y1).toBeCloseTo(0.3 - HERO_CAMERA.textGap);
    expect(cleared.box.y1).toBeLessThan(free.box.y1);
    // A headline that is not in the way changes nothing, and the box never collapses.
    expect(heroShot(390, 844, { clearBelow: 0.9 }).box.y1).toBe(free.box.y1);
    expect(heroShot(390, 844, { clearBelow: -2 }).box.y1).toBeGreaterThan(free.box.y0);
  });

  it('takes the space of overlays off the box', () => {
    const box = heroShot(1440, 900, { insets: { left: 0.1, bottom: 0.05 } }).box;
    expect(box.x0).toBeCloseTo(HERO_CAMERA.wide.box.x0 + 0.1);
    expect(box.y0).toBeCloseTo(HERO_CAMERA.wide.box.y0 + 0.05);
  });
});

describe('heroPose', () => {
  it('fits the lit sheet, its mountain and the compass into the box on a desktop and on a phone', () => {
    for (const [width, height] of [
      [1440, 900],
      [1920, 1080],
      [1024, 768],
      [390, 844],
    ] as const) {
      const shot = heroShot(width, height);
      const pose = heroPose(points(), width, height);
      for (const point of points()) {
        const screen = projectToScreen(pose, point, width / height);
        expect(screen.z).toBeGreaterThan(0);
        expect(screen.x).toBeGreaterThanOrEqual(shot.box.x0 - 0.02);
        expect(screen.x).toBeLessThanOrEqual(shot.box.x1 + 0.02);
        expect(screen.y).toBeGreaterThanOrEqual(shot.box.y0 - 0.02);
        expect(screen.y).toBeLessThanOrEqual(shot.box.y1 + 0.02);
      }
    }
  });

  it('puts the compass above the lit sheet on the screen', () => {
    const pose = heroPose(points(), 1440, 900);
    const compass = projectToScreen(pose, { x: 0, y: 2.9, z: 0 }, 1.6);
    const sheet = projectToScreen(pose, { x: 0, y: 0.07, z: TURN.radius }, 1.6);
    expect(compass.y).toBeGreaterThan(sheet.y + 0.5);
    // The sheet lies in the middle of the screen, between the headline and the side card.
    expect(Math.abs(sheet.x)).toBeLessThan(0.08);
  });
});

describe('introPush', () => {
  it('runs from 0 to 1 in 3.4 s and slows down as it arrives', () => {
    expect(introPush(0)).toBe(0);
    expect(introPush(HERO_CAMERA.intro.seconds)).toBe(1);
    expect(introPush(10)).toBe(1);
    let previous = 0;
    for (let t = 0.1; t <= 3.4; t += 0.1) {
      const now = introPush(t);
      expect(now).toBeGreaterThanOrEqual(previous);
      previous = now;
    }
    expect(introPush(1.7)).toBeGreaterThan(0.8);
  });
});
