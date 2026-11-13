import { TIER_NAMES, type TierName } from '../scene/palette';
import { clamp01, easeInOutCubic, seg, smooth } from '../paper/motion';

/**
 * The growth of the paper mountain as numbers. A mountain is a stack of contour cards. Each card starts as its
 * own printed line on the cover; the bottom card thickens first and lifts the rest, and a spread of seven cards
 * travels up the stack.
 */
export const GROW = {
  /** Seconds from the flat print to the standing mountain. */
  seconds: 1.25,
  /** Seconds back into the print. */
  sinkSeconds: 0.8,
  /** How many cards are on the move at once. */
  spread: 7,
  /** The card spring. */
  k: 150,
  c: 12,
  /** Thickness of one card. */
  thickness: 0.058,
  /** Height of a mountain that reaches the top of the last tier. */
  fullHeight: 1.4,
  /** Cards of that mountain. */
  fullCards: 24,
  /** Side of the square the model stands on, in scene units. */
  size: 3.68,
  /** A card counts as landed above this share of its rise. Trail marks, camps and the pin wait for it. */
  landed: 0.92,
} as const;

/**
 * Where card `k` of `n` (0 is the bottom card) is heading while the mountain is `sinkP` sunk: 1 is standing,
 * 0 is a printed line. `sinkP` is `1 - grow`.
 */
export function growCard(k: number, n: number, sinkP: number): number {
  const cards = Math.max(1, Math.round(n));
  const card = Math.min(cards - 1, Math.max(0, Math.round(k)));
  const stagger = clamp01((clamp01(sinkP) * (cards - 1 + GROW.spread) - (cards - 1 - card)) / GROW.spread);
  return 1 - stagger;
}

export interface CardShape {
  /** Thickness as a share of the full card. Above 1 while the spring overshoots. */
  readonly thickness: number;
  /** 1 while the card is still a printed line, 0 once it is a card. */
  readonly flat: number;
}

/** What a card looks like when its spring is at `p` (0 printed, 1 standing, above 1 overshooting). */
export function cardShape(p: number): CardShape {
  const rise = Math.max(0, p);
  const thickness = rise > 1 ? 1 + (rise - 1) * 1.2 : 1 - easeInOutCubic(seg(1 - rise, 0, 0.86));
  return { thickness, flat: smooth(seg(1 - rise, 0.14, 1)) };
}

/** The altitude a roadmap reaches when its last stage ends at the top of `tier`, 0 to 1. */
export function tierSummit(tier: TierName): number {
  const index = TIER_NAMES.indexOf(tier);
  return (Math.max(0, index) + 1) / TIER_NAMES.length;
}

/** Physical height of the model for a summit altitude of 0 to 1: a bronze roadmap is 0.72 high, a diamond one 1.4. */
export function mountainHeight(summitAltitude: number): number {
  return GROW.fullHeight * (0.35 + 0.65 * clamp01(summitAltitude));
}

/** Cards in the stack: 12, 16, 20 or 24 for the four tiers. */
export function cardCount(summitAltitude: number): number {
  return Math.max(3, Math.round((GROW.fullCards * mountainHeight(summitAltitude)) / GROW.fullHeight));
}

/** The hours the big number shows while the mountain is `grow` grown: it counts up with the cards. */
export function countUp(total: number, grow: number): number {
  return total * easeInOutCubic(clamp01(grow));
}

/**
 * The growth clock of one mountain: `grow` runs to 1 in 1.25 s while the mountain may stand and back to 0 in
 * 0.8 s once it may not.
 */
export interface GrowthClock {
  readonly grow: number;
  /** True while the value still moves. */
  readonly moving: boolean;
  advance(dt: number, standing: boolean): number;
  set(value: number): void;
}

export function createGrowthClock(start = 0): GrowthClock {
  let grow = clamp01(start);
  let moving = false;
  return {
    get grow() {
      return grow;
    },
    get moving() {
      return moving;
    },
    advance(dt, standing) {
      const before = grow;
      if (dt > 0) grow = standing ? Math.min(1, grow + dt / GROW.seconds) : Math.max(0, grow - dt / GROW.sinkSeconds);
      moving = grow !== before;
      return grow;
    },
    set(value) {
      grow = clamp01(value);
      moving = false;
    },
  };
}
