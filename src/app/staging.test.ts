import { describe, expect, it } from 'vitest';
import { STAGING, boxRows, clothShows, heroRows, lampCandela, lampPlace, placeBox } from './staging';

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
