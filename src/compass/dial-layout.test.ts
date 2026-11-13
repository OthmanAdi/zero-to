import { describe, expect, it } from 'vitest';
import { DIAL_FILL, LABEL_TURN, bandBlockBearing, dialPoint, dialToCanvas, dialUv, layoutDial } from './dial-layout';
import { TAU } from './heading';

const radiusOf = (point: { x: number; y: number }): number => Math.hypot(point.x, point.y);

describe('dialPoint', () => {
  it('has north at the top and east on the right, as a canvas counts', () => {
    expect(dialPoint(0, 1).y).toBeCloseTo(-1, 12);
    expect(dialPoint(Math.PI / 2, 1).x).toBeCloseTo(1, 12);
    expect(dialPoint(Math.PI, 1).y).toBeCloseTo(1, 12);
    expect(dialPoint(-Math.PI / 2, 0.5).x).toBeCloseTo(-0.5, 12);
  });
});

describe('layoutDial', () => {
  const layout = layoutDial();

  it('is deterministic', () => {
    expect(layoutDial()).toEqual(layout);
  });

  it('has a tick every two degrees, graded by tens and thirties', () => {
    expect(layout.ticks).toHaveLength(180);
    expect(layout.ticks.filter((tick) => tick.kind === 'major')).toHaveLength(12);
    expect(layout.ticks.filter((tick) => tick.kind === 'mid')).toHaveLength(24);
    const major = layout.ticks.find((tick) => tick.kind === 'major');
    const mid = layout.ticks.find((tick) => tick.kind === 'mid');
    const minor = layout.ticks.find((tick) => tick.kind === 'minor');
    if (!major || !mid || !minor) throw new Error('a tick kind is missing');
    expect(major.outer - major.inner).toBeGreaterThan(mid.outer - mid.inner);
    expect(mid.outer - mid.inner).toBeGreaterThan(minor.outer - minor.inner);
    expect(major.width).toBeGreaterThan(minor.width);
  });

  it('keeps every engraved mark on the metal ring', () => {
    for (const tick of layout.ticks) {
      expect(tick.inner).toBeGreaterThan(layout.cardRadius);
      expect(tick.outer).toBeLessThan(1);
      expect(tick.inner).toBeLessThan(tick.outer);
    }
    for (const label of layout.ringLabels) {
      expect(label.radius - label.size / 2).toBeGreaterThan(layout.cardRadius);
      expect(label.radius + label.size / 2).toBeLessThan(Math.min(...layout.ticks.map((tick) => tick.inner)) + 0.005);
    }
    for (const line of layout.ringLines) {
      expect(line.radius).toBeGreaterThan(layout.cardRadius);
      expect(line.radius).toBeLessThan(1);
    }
  });

  it('engraves N, E, S and W at the quarters and numerals at the other thirties', () => {
    const cardinals = layout.ringLabels.filter((label) => label.kind === 'cardinal');
    expect(cardinals.map((label) => label.text)).toEqual(['N', 'E', 'S', 'W']);
    cardinals.forEach((label, i) => expect(label.bearing).toBeCloseTo((i * TAU) / 4, 12));
    const numerals = layout.ringLabels.filter((label) => label.kind === 'numeral');
    expect(numerals.map((label) => label.text)).toEqual(['30', '60', '120', '150', '210', '240', '300', '330']);
    for (const label of numerals) expect(label.bearing).toBeCloseTo((Number(label.text) * Math.PI) / 180, 12);
    expect(cardinals[0]?.size).toBeGreaterThan(numerals[0]?.size ?? Infinity);
  });

  it('sets every letter and numeral upright, with N at bearing 0 at the top of the canvas', () => {
    expect(LABEL_TURN).toBe(0);
    for (const label of [...layout.ringLabels, ...layout.cardLabels]) expect(label.turn).toBe(0);
    const at = (text: string): { x: number; y: number } => {
      const label = [...layout.ringLabels, ...layout.cardLabels].find((item) => item.text === text);
      if (!label) throw new Error(`no label ${text}`);
      return dialToCanvas(dialPoint(label.bearing, label.radius), 1024);
    };
    const n = layout.ringLabels.find((label) => label.text === 'N');
    expect(n?.bearing).toBe(0);
    // Canvas rows count downwards: north is above the centre, south below, east right, west left.
    expect(at('N').x).toBeCloseTo(512, 6);
    expect(at('N').y).toBeLessThan(200);
    expect(at('S').y).toBeGreaterThan(824);
    expect(at('E').x).toBeGreaterThan(824);
    expect(at('W').x).toBeLessThan(200);
    // Clockwise: 30 is right of north, 330 left of it; NE is up and right, SW down and left.
    expect(at('30').x).toBeGreaterThan(512);
    expect(at('330').x).toBeLessThan(512);
    expect(at('NE').x).toBeGreaterThan(512);
    expect(at('NE').y).toBeLessThan(512);
    expect(at('SW').x).toBeLessThan(512);
    expect(at('SW').y).toBeGreaterThan(512);
  });

  it('draws a sixteen point rose that stays on the card, long points last', () => {
    expect(layout.rose).toHaveLength(32);
    expect(layout.rose.map((facet) => facet.rank)).toEqual([...Array(16).fill(2), ...Array(8).fill(1), ...Array(8).fill(0)]);
    for (const facet of layout.rose) {
      for (const point of facet.points) expect(radiusOf(point)).toBeLessThan(layout.band.inner);
    }
    // The north point: its tip is straight up and it is the longest.
    const north = layout.rose.filter((facet) => facet.rank === 0)[0];
    if (!north) throw new Error('the north point is missing');
    const tip = north.points[2];
    expect(tip.x).toBeCloseTo(0, 12);
    expect(tip.y).toBeLessThan(0);
    const longest = Math.max(...layout.rose.flatMap((facet) => facet.points.map(radiusOf)));
    expect(radiusOf(tip)).toBeCloseTo(longest, 12);
    // Each point is split into an inked half and a paper half.
    const tones = layout.rose.filter((facet) => facet.rank === 0).map((facet) => facet.tone);
    expect(tones).toEqual(['ink', 'paper', 'ink', 'paper', 'ink', 'paper', 'ink', 'paper']);
  });

  it('prints the four intercardinals between the points', () => {
    expect(layout.cardLabels.map((label) => label.text)).toEqual(['NE', 'SE', 'SW', 'NW']);
    for (const label of layout.cardLabels) {
      expect(label.radius + label.size / 2).toBeLessThan(layout.band.inner);
      expect(label.radius).toBeGreaterThan(0.62 * layout.cardRadius);
    }
  });

  it('marks north on the card edge', () => {
    const [tip, left, right] = layout.northMark;
    expect(tip.x).toBeCloseTo(0, 12);
    expect(left.x).toBeLessThan(0);
    expect(right.x).toBeGreaterThan(0);
    expect(radiusOf(left)).toBeLessThan(layout.cardRadius);
  });

  it('uses fewer ticks when asked', () => {
    const coarse = layoutDial({ tickStep: 5 });
    expect(coarse.ticks).toHaveLength(72);
    expect(coarse.ticks.filter((tick) => tick.kind === 'major')).toHaveLength(12);
    expect(coarse.ticks.filter((tick) => tick.kind === 'mid')).toHaveLength(24);
  });

  it('rejects options that cannot be drawn', () => {
    expect(() => layoutDial({ tickStep: 7 })).toThrow();
    expect(() => layoutDial({ tickStep: 0 })).toThrow();
    expect(() => layoutDial({ cardRadius: 1.2 })).toThrow();
  });

  it('has an even number of blocks in the border, so the chequer closes', () => {
    expect(layout.band.blocks % 2).toBe(0);
    expect(layout.band.outer).toBeLessThan(layout.cardRadius);
    expect(bandBlockBearing(layout.band, 0)).toBeCloseTo(TAU / layout.band.blocks / 2, 12);
  });
});

describe('dial coordinates', () => {
  it('maps the dial into the canvas with a margin', () => {
    expect(dialToCanvas({ x: 0, y: 0 }, 1024)).toEqual({ x: 512, y: 512 });
    const north = dialToCanvas(dialPoint(0, 1), 1024);
    expect(north.x).toBeCloseTo(512, 9);
    expect(north.y).toBeCloseTo(512 - 512 * DIAL_FILL, 9);
    expect(north.y).toBeGreaterThan(0);
  });

  it('gives texture coordinates that agree with the canvas: north (-Z) is the top', () => {
    const size = 1024;
    const radius = 0.77;
    const cases: Array<[number, number, number]> = [
      [0, -radius, 0],
      [radius, 0, Math.PI / 2],
      [0, radius, Math.PI],
      [-radius * 0.5, 0, -Math.PI / 2],
    ];
    for (const [x, z, bearing] of cases) {
      const uv = dialUv(x, z, radius);
      const onCanvas = dialToCanvas(dialPoint(bearing, Math.hypot(x, z) / radius), size);
      // A flipped canvas texture has v = 1 at the top row.
      expect(uv.u * size).toBeCloseTo(onCanvas.x, 6);
      expect((1 - uv.v) * size).toBeCloseTo(onCanvas.y, 6);
    }
  });
});
