import { describe, expect, it } from 'vitest';
import { isUp } from '../sections/model';
import { STAGING, boxRows, clothShows, focusAt, formFor, heroRows, lampCandela, lampPlace, placeBox, spotFrame, standingAt } from './staging';

describe('the rows of a box', () => {
  it('follows a box up through the window and gives nothing once it is out of it', () => {
    expect(boxRows({ top: 900, height: 900 }, 900)).toBeNull();
    expect(boxRows({ top: 600, height: 900 }, 900)).toEqual({ from: 600, to: 900 });
    expect(boxRows({ top: 0, height: 900 }, 900)).toEqual({ from: 0, to: 900 });
    expect(boxRows({ top: -300, height: 900 }, 900)).toEqual({ from: 0, to: 600 });
    expect(boxRows({ top: -900, height: 900 }, 900)).toBeNull();
    expect(boxRows({ top: 0, height: 0 }, 900)).toBeNull();
    expect(boxRows({ top: 0, height: 900 }, 0)).toBeNull();
  });

  it('never leaves the window, whatever the box is', () => {
    for (let top = -2000; top <= 2000; top += 37) {
      const rows = boxRows({ top, height: 900 }, 844);
      if (!rows) continue;
      expect(rows.from).toBeGreaterThanOrEqual(0);
      expect(rows.to).toBeLessThanOrEqual(844);
      expect(rows.to).toBeGreaterThan(rows.from);
    }
  });
});

describe('the rows of the hero', () => {
  it('ends where the ground of the sections has become the night', () => {
    // At the top of the page the sections start under the window: the hero has all of it.
    expect(heroRows(900, 900)).toBe(900);
    // A third of a window, and never more than 280 pixels, below the top of the sections.
    expect(heroRows(400, 900)).toBe(400 + 270);
    expect(heroRows(400, 1400)).toBe(400 + STAGING.band.most);
    expect(heroRows(-200, 900)).toBe(70);
    expect(heroRows(-270, 900)).toBe(0);
    expect(heroRows(-5000, 900)).toBe(0);
    expect(heroRows(100, 0)).toBe(0);
  });
});

describe('the place of a station', () => {
  const box = { left: 0, top: 0, width: 1440, height: 900 };

  it('is the same box of the screen wherever the page is scrolled to', () => {
    const place = { left: 720, top: 300, width: 600, height: 300 };
    const still = placeBox(place, box, 1440, 900, 0);
    expect(still).toEqual({ x0: 0, x1: (1320 / 1440) * 2 - 1, y0: 1 - (600 / 900) * 2, y1: 1 - (300 / 900) * 2 });
    const scrolled = placeBox({ ...place, top: place.top + 420 }, { ...box, top: 420 }, 1440, 900, 0);
    expect(scrolled.y0).toBeCloseTo(still.y0, 10);
    expect(scrolled.y1).toBeCloseTo(still.y1, 10);
  });

  it('keeps a margin inside the place and stays the right way up', () => {
    const place = { left: 700, top: 200, width: 640, height: 320 };
    const tight = placeBox(place, box, 1440, 900, 0);
    const roomy = placeBox(place, box, 1440, 900);
    expect(roomy.x0).toBeGreaterThan(tight.x0);
    expect(roomy.x1).toBeLessThan(tight.x1);
    expect(roomy.y0).toBeGreaterThan(tight.y0);
    expect(roomy.y1).toBeLessThan(tight.y1);
    expect(roomy.x1).toBeGreaterThan(roomy.x0);
    expect(roomy.y1).toBeGreaterThan(roomy.y0);
  });
});

describe('the lamp of a station', () => {
  it('hangs up, behind and to the right of the sheet, and further away over a wider one', () => {
    const narrow = lampPlace(3);
    const wide = lampPlace(7.9);
    expect(narrow.distance).toBe(STAGING.lamp.least);
    expect(wide.distance).toBeCloseTo((7.9 / 2) * STAGING.lamp.reach, 10);
    for (const place of [narrow, wide]) {
      expect(place.y).toBeGreaterThan(0);
      expect(place.x).toBeGreaterThan(0);
      expect(Math.hypot(place.x, place.y, place.z)).toBeCloseTo(place.distance, 10);
      expect(Math.asin(place.y / place.distance) * (180 / Math.PI)).toBeCloseTo(STAGING.lamp.elevation, 6);
    }
  });

  it('gives the sheet the same light from any distance', () => {
    const near = lampCandela(340, STAGING.lamp.least);
    const far = lampCandela(340, STAGING.lamp.least * 2);
    expect(near).toBeCloseTo(340 * STAGING.lamp.strength, 10);
    // Twice as far takes four times the candela for the same light on the sheet.
    expect(far / near).toBeCloseTo(4, 10);
  });
});

describe('the cloth under a station', () => {
  it('shows whole in the middle and has faded into the night at its rim', () => {
    expect(clothShows(0)).toBe(1);
    expect(clothShows(STAGING.cloth.fadeFrom)).toBe(1);
    expect(clothShows(1)).toBe(0);
    expect(clothShows(1.4)).toBe(0);
    let last = 1;
    for (let share = 0; share <= 1; share += 0.02) {
      const now = clothShows(share);
      expect(now).toBeLessThanOrEqual(last);
      last = now;
    }
  });
});

describe('a station framed one thing at a time', () => {
  it('dwells on each thing and pans between two round the boundary of their shares', () => {
    // Three things: dwell windows and pans as the shares of the hold.
    expect(focusAt(0, 3)).toBe(0);
    expect(focusAt(0.24, 3)).toBe(0);
    expect(focusAt(1 / 3, 3)).toBeCloseTo(0.5, 9);
    expect(focusAt(0.42, 3)).toBe(1);
    expect(focusAt(0.58, 3)).toBe(1);
    expect(focusAt(0.76, 3)).toBe(2);
    expect(focusAt(1, 3)).toBe(2);
    // The pan of three things is 0.16 of the hold, centred on the boundary.
    const pan = STAGING.focus.pan / 3;
    expect(focusAt(1 / 3 - pan / 2 - 1e-6, 3)).toBe(0);
    expect(focusAt(1 / 3 + pan / 2 + 1e-6, 3)).toBe(1);
    // It never goes back while the hold grows, and one thing has nothing to pan to.
    let last = 0;
    for (let step = 0; step <= 400; step += 1) {
      const now = focusAt(step / 400, 4);
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
    }
    expect(last).toBe(3);
    expect(focusAt(0.5, 1)).toBe(0);
  });

  it('comes up bare and stands each thing when the camera comes to it', () => {
    expect(standingAt({ phase: 'ahead', hold: 0 }, 4)).toBe(0);
    expect(standingAt({ phase: 'forming', hold: 0 }, 4)).toBe(0);
    expect(standingAt({ phase: 'active', hold: STAGING.focus.pop / 2 }, 4)).toBe(0);
    expect(standingAt({ phase: 'active', hold: STAGING.focus.pop }, 4)).toBe(1);
    expect(standingAt({ phase: 'active', hold: 0.24 }, 4)).toBe(1);
    expect(standingAt({ phase: 'active', hold: 0.26 }, 4)).toBe(2);
    expect(standingAt({ phase: 'active', hold: 0.99 }, 4)).toBe(4);
    expect(standingAt({ phase: 'done', hold: 1 }, 4)).toBe(4);
    // The second stands at the middle of the pan towards it.
    let first = -1;
    for (let step = 0; step <= 1000; step += 1) {
      if (standingAt({ phase: 'active', hold: step / 1000 }, 4) >= 2) {
        first = step / 1000;
        break;
      }
    }
    expect(focusAt(first, 4)).toBeGreaterThanOrEqual(STAGING.focus.arrive);
    expect(focusAt(first - 0.001, 4)).toBeLessThan(STAGING.focus.arrive);
  });

  it('turns a number of things standing into a form that stands exactly those', () => {
    for (const count of [1, 3, 4, 5]) {
      for (let up = 0; up <= count; up += 1) {
        const form = formFor(up, count);
        const standing = Array.from({ length: count }, (_unused, index) => isUp(form, index, count)).filter(Boolean).length;
        expect(standing, `${up} of ${count}`).toBe(up);
      }
    }
  });

  it('frames a spot with the route in front of it, and aims a little up its height', () => {
    const frame = spotFrame({ x: 1, z: -0.6, width: 2, depth: 0, height: 2 }, 1.2, 400, { side: 0.5, back: 0.4, front: 0.3 });
    const xs = frame.points.map((point) => point.x);
    const zs = frame.points.map((point) => point.z);
    expect(Math.min(...xs)).toBeCloseTo(400 + 1 - 1.5, 9);
    expect(Math.max(...xs)).toBeCloseTo(400 + 1 + 1.5, 9);
    expect(Math.min(...zs)).toBeCloseTo(-1, 9);
    expect(Math.max(...zs)).toBeCloseTo(1.5, 9);
    expect(Math.max(...frame.points.map((point) => point.y))).toBe(2);
    expect(frame.target).toEqual({ x: 401, y: 0.64, z: 0.25 });
    // A deep spot reaches past the route: the frame goes to the front of the spot.
    const ring = spotFrame({ x: 0, z: 0, width: 4, depth: 4, height: 1 }, 1.2, 0, { side: 0, back: 0, front: 0.3 });
    expect(Math.max(...ring.points.map((point) => point.z))).toBeCloseTo(2.3, 9);
  });
});
