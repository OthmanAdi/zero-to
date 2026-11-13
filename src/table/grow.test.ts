import { describe, expect, it } from 'vitest';
import { GROW, cardCount, cardShape, countUp, createGrowthClock, growCard, mountainHeight, tierSummit } from './grow';
import { TIER_NAMES } from '../scene/palette';

describe('growCard', () => {
  it('stands every card when the mountain is grown and prints every card when it is sunk', () => {
    for (const n of [12, 16, 20, 24]) {
      for (let k = 0; k < n; k += 1) {
        expect(growCard(k, n, 0)).toBe(1);
        expect(growCard(k, n, 1)).toBe(0);
      }
    }
  });

  it('rises monotonically with the growth for every card', () => {
    const n = 20;
    for (let k = 0; k < n; k += 1) {
      let previous = -1;
      for (let step = 0; step <= 200; step += 1) {
        const grow = step / 200;
        const value = growCard(k, n, 1 - grow);
        expect(value).toBeGreaterThanOrEqual(previous - 1e-12);
        previous = value;
      }
    }
  });

  it('lets the bottom card lead: a lower card is never behind a higher one', () => {
    const n = 16;
    for (let step = 0; step <= 100; step += 1) {
      const sink = step / 100;
      for (let k = 1; k < n; k += 1) expect(growCard(k - 1, n, sink)).toBeGreaterThanOrEqual(growCard(k, n, sink));
    }
    // Early in the growth only the bottom card has moved.
    expect(growCard(0, n, 0.97)).toBeGreaterThan(0);
    expect(growCard(1, n, 0.97)).toBe(0);
  });

  it('keeps the top card flat until the spread of seven reaches it', () => {
    const n = 24;
    const top = n - 1;
    // The top card starts when grow * (n - 1 + 7) passes n - 1.
    const starts = (n - 1) / (n - 1 + GROW.spread);
    expect(growCard(top, n, 1 - (starts - 0.01))).toBe(0);
    expect(growCard(top, n, 1 - (starts + 0.01))).toBeGreaterThan(0);
    // At that moment exactly seven cards are on their way and the rest below stand.
    const moving = Array.from({ length: n }, (_, k) => growCard(k, n, 1 - starts)).filter((p) => p > 1e-9 && p < 1 - 1e-9).length;
    expect(moving).toBe(GROW.spread - 1);
    expect(growCard(top - GROW.spread, n, 1 - starts)).toBeCloseTo(1);
  });
});

describe('cardShape', () => {
  it('is a printed line at 0 and a full card at 1', () => {
    expect(cardShape(0)).toEqual({ thickness: 0, flat: 1 });
    expect(cardShape(1).thickness).toBe(1);
    expect(cardShape(1).flat).toBe(0);
  });

  it('thickens monotonically and overshoots 1.2 times past the end', () => {
    let previous = -1;
    for (let step = 0; step <= 100; step += 1) {
      const value = cardShape(step / 100).thickness;
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
    expect(cardShape(1.1).thickness).toBeCloseTo(1.12);
  });

  it('is already a card, no longer a line, a little before it has its full thickness', () => {
    expect(cardShape(0.86).flat).toBe(0);
    expect(cardShape(0.5).flat).toBeGreaterThan(0);
  });
});

describe('height and card count', () => {
  it('gives 12, 16, 20 and 24 cards for the four tiers', () => {
    expect(TIER_NAMES.map((tier) => cardCount(tierSummit(tier)))).toEqual([12, 16, 20, 24]);
  });

  it('makes a bronze roadmap 0.72 high and a diamond one 1.4', () => {
    expect(mountainHeight(tierSummit('bronze'))).toBeCloseTo(0.7175, 3);
    expect(mountainHeight(tierSummit('diamond'))).toBeCloseTo(1.4);
    expect(cardCount(1) * GROW.thickness).toBeCloseTo(1.392);
  });

  it('never asks the shader for more rows than it has', () => {
    expect(cardCount(2)).toBeLessThanOrEqual(28);
    expect(cardCount(-1)).toBeGreaterThanOrEqual(3);
  });
});

describe('countUp', () => {
  it('counts the hours up with the cards', () => {
    expect(countUp(38, 0)).toBe(0);
    expect(countUp(38, 1)).toBe(38);
    expect(countUp(38, 0.5)).toBeCloseTo(19);
    expect(countUp(38, 0.25)).toBeLessThan(38 * 0.25);
  });
});

describe('createGrowthClock', () => {
  it('grows in 1.25 s and sinks in 0.8 s', () => {
    const clock = createGrowthClock(0);
    let t = 0;
    while (clock.grow < 1 && t < 5) {
      clock.advance(1 / 120, true);
      t += 1 / 120;
    }
    expect(t).toBeCloseTo(GROW.seconds, 1);
    t = 0;
    while (clock.grow > 0 && t < 5) {
      clock.advance(1 / 120, false);
      t += 1 / 120;
    }
    expect(t).toBeCloseTo(GROW.sinkSeconds, 1);
    expect(clock.advance(0.1, false)).toBe(0);
    expect(clock.moving).toBe(false);
  });
});
