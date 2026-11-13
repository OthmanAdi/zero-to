import { LEAF_KNEE, type LeafShape } from './leaf';
import { LEAVES, type Opening } from './volume';

/**
 * How the pages of a volume move: pure functions from a time to an `Opening` (the board's turn and the
 * shape of each loose leaf). Nothing here keeps state or reads a clock, so every moment can be drawn
 * again, played backwards, or tested.
 *
 * A leaf is described by the direction it runs in at three places: its root, its knee and its free edge.
 * Each of the three follows the same move, the outer ones a little later, so the paper trails its root
 * and catches up (follow-through). The result is then held to what paper can do, see `tidy`.
 *
 * The numbers start from measuring a reference (see the 0.3 notes): boards open 12 to 14 degrees under
 * the hand and 15 to 18 in flight, 90 % of the way in about a quarter of a second, the stack fanned in
 * proportion to each leaf's place in it, and the bend of a page growing toward its free edge. The reference
 * moves everything on one exponential and steps its lag twice a frame. Here the board has mass (a spring
 * that overshoots a tenth and settles), every leaf follows on its own, slower the deeper it lies, the bend
 * comes from how fast the leaf turns, and all of it is solved in closed form, so it does not depend on
 * the frame rate.
 */

/** Direction of a leaf at its root, its knee and its free edge, in radians from shut. */
type Knots = [root: number, knee: number, edge: number];

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

function knotsOf(shape: LeafShape | undefined): Knots {
  if (!shape) return [0, 0, 0];
  return [shape.angle, shape.angle + shape.curl * LEAF_KNEE, shape.angle + shape.curl + (shape.flick ?? 0)];
}

function shapeOf(knots: Knots): LeafShape {
  const curl = (knots[1] - knots[0]) / LEAF_KNEE;
  return { angle: knots[0], curl, flick: knots[2] - knots[0] - curl };
}

/** A shut volume. */
export function shut(): Opening {
  return { cover: 0, leaves: Array.from({ length: LEAVES }, () => ({ angle: 0, curl: 0, flick: 0 })) };
}

/** Whether nothing of an opening would show. */
export function isShut(opening: Opening): boolean {
  return opening.cover < 0.0005 && opening.leaves.every((leaf) => knotsOf(leaf).every((knot) => Math.abs(knot) < 0.0005));
}

/** The board keeps this share of its turn clear of the first leaf. */
const BOARD_CLEAR = 0.96;

/**
 * Holds an opening to what paper can do. A leaf never runs further out than the leaf in front of it (or
 * than the board, for the first), at its root, its knee and its edge, and never back into the block.
 * Between those three places the direction is linear, so the order holds along the whole leaf: leaves
 * cannot pass through each other or through the board, and the last one stays closest to the block.
 */
export function tidy(opening: Opening): Opening {
  const cover = Math.max(0, opening.cover);
  let limit: Knots = [cover * BOARD_CLEAR, cover * BOARD_CLEAR, cover * BOARD_CLEAR];
  const leaves = Array.from({ length: LEAVES }, (_, index) => {
    const wanted = knotsOf(opening.leaves[index]);
    const held: Knots = [
      Math.min(limit[0], Math.max(0, wanted[0])),
      Math.min(limit[1], Math.max(0, wanted[1])),
      Math.min(limit[2], Math.max(0, wanted[2])),
    ];
    limit = held;
    return shapeOf(held);
  });
  return { cover, leaves };
}

/** Adds one opening to another, for a flutter over a volume that already stands open, and tidies the sum. */
export function layer(base: Opening, extra: Opening): Opening {
  const leaves = Array.from({ length: LEAVES }, (_, index) => {
    const a = knotsOf(base.leaves[index]);
    const b = knotsOf(extra.leaves[index]);
    return shapeOf([a[0] + b[0], a[1] + b[1], a[2] + b[2]]);
  });
  return tidy({ cover: base.cover + extra.cover, leaves });
}

/** How far the board stands open under the hand, in radians: about 16 degrees. */
export const PEEK_COVER = 0.28;
/** The board's spring, acceleration = K (target - x) - C velocity: a tenth of overshoot, settled near 450 ms. */
const BOARD_K = 140;
const BOARD_C = 14;
/** After this long a peek has arrived for the eye and is drawn as arrived. */
export const PEEK_REST_MS = 1100;
/** Time constants of a leaf's own lag, in ms: opening, the first leaf and what the last adds; closing likewise. */
const LEAF_OPEN_MS = 73;
const LEAF_OPEN_MORE_MS = 230;
const LEAF_CLOSE_MS = 30;
const LEAF_CLOSE_MORE_MS = 48;
/** Seconds of its own turning a leaf bends by: the free edge trails a leaf that turns fast. */
const CURL_PER_RATE = 0.05;
const CURL_MOST = 0.6;
/** The bend a leaf keeps at rest, in radians for the first leaf: its edge hangs back a little. */
const REST_CURL = -0.08;
/** How fast the bend a leaf had when the hand came or left dies away, and how fast the new one sets in, in ms. */
const CURL_FADE_MS = 60;
const CURL_ONSET_MS = 25;

/** Share of its way a spring released at rest has gone after `ms`: it overshoots, comes back and settles. */
function sprung(ms: number): number {
  if (ms <= 0) return 0;
  const t = ms / 1000;
  const decay = BOARD_C / 2;
  const swing = Math.sqrt(BOARD_K - decay * decay);
  return 1 - Math.exp(-decay * t) * (Math.cos(swing * t) + (decay / swing) * Math.sin(swing * t));
}

/** The same spring with just enough damping not to swing: a board coming shut does not bounce off the block. */
function damped(ms: number): number {
  if (ms <= 0) return 0;
  const x = (Math.sqrt(BOARD_K) * ms) / 1000;
  return 1 - Math.exp(-x) * (1 + x);
}

/** Share of the stack a leaf has in front of it: 1 for the first leaf, falling toward the block. */
const placeOf = (index: number): number => Math.max(0, 1 - index / LEAVES);

/** How deep a leaf lies in the loose stack: 0 for the first leaf, 1 for the last. */
const depthOf = (index: number): number => (LEAVES > 1 ? index / (LEAVES - 1) : 0);

/** A volume standing open under the hand, at rest. */
export function peekRest(): Opening {
  const leaves = Array.from({ length: LEAVES }, (_, index) => {
    const place = placeOf(index);
    // The first leaves follow the board, the rest stay near the block; every free edge hangs back a little.
    const root = PEEK_COVER * 0.8 * place ** 1.6;
    return { angle: root, curl: Math.max(-root * 0.6, REST_CURL * place), flick: 0 };
  });
  return tidy({ cover: PEEK_COVER, leaves });
}

/**
 * A volume standing open by a share of the way to `peekRest`, 0 shut to 1: for a host that eases the
 * opening itself, such as a book that opens as far as it is turned or pressed.
 */
export function peekShare(amount: number): Opening {
  const share = clamp01(amount);
  if (share === 0) return shut();
  const rest = peekRest();
  return tidy({
    cover: rest.cover * share,
    leaves: rest.leaves.map((leaf) => ({ angle: leaf.angle * share, curl: leaf.curl * share, flick: (leaf.flick ?? 0) * share })),
  });
}

/**
 * The presented volume `ms` after the hand came (`open`) or left. The board swings out on its spring,
 * a little too far, and settles. Each leaf follows on its own lag, slower the deeper it lies, so the fan
 * runs from the board down the stack; while a leaf turns its free edge trails by how fast it turns, and
 * the bend relaxes as it comes to rest. Leaving, the leaves nearest the block go first and the board
 * last, without a bounce, so it gathers the paper instead of passing through it. `from` is how the volume
 * stood at that moment, so a hand that comes back half way through continues from where the pages are.
 */
export function peekAt(ms: number, open: boolean, from: Opening = shut()): Opening {
  const to = open ? peekRest() : shut();
  if (ms >= PEEK_REST_MS) return to;
  const t = Math.max(0, ms);
  const cover = from.cover + (to.cover - from.cover) * (open ? sprung(t) : damped(t));
  const fade = Math.exp(-t / CURL_FADE_MS);
  const onset = 1 - Math.exp(-t / CURL_ONSET_MS);
  const leaves = Array.from({ length: LEAVES }, (_, index) => {
    const depth = depthOf(index);
    const tau = open ? LEAF_OPEN_MS + LEAF_OPEN_MORE_MS * depth : LEAF_CLOSE_MS + LEAF_CLOSE_MORE_MS * (1 - depth);
    const was = from.leaves[index] ?? { angle: 0, curl: 0 };
    const will = to.leaves[index] ?? { angle: 0, curl: 0 };
    const left = Math.exp(-t / tau);
    const angle = will.angle + (was.angle - will.angle) * left;
    // Radians a second the root is turning right now; the paper bends against it.
    const rate = ((will.angle - was.angle) / tau) * left * 1000;
    const trail = Math.min(CURL_MOST, Math.max(-CURL_MOST, -CURL_PER_RATE * rate)) * onset;
    return {
      angle,
      curl: will.curl + (was.curl - will.curl) * fade + trail,
      // The outer part of the leaf is the freest: it trails half as much again.
      flick: (was.flick ?? 0) * fade + trail * 0.5,
    };
  });
  return tidy({ cover, leaves });
}

/**
 * An opening drawn back to a share of itself: the board and every leaf turn that share of their way. A
 * hand near the hinge opens a volume less than a hand at its fore-edge.
 */
export function scaled(opening: Opening, share: number): Opening {
  const k = clamp01(share);
  if (k >= 1) return opening;
  return tidy({
    cover: opening.cover * k,
    leaves: opening.leaves.map((leaf) => ({ angle: leaf.angle * k, curl: leaf.curl * k, flick: (leaf.flick ?? 0) * k })),
  });
}

/** How long the flutter of a volume that has just arrived at the centre lasts, in ms. */
export const ARRIVE_MS = 340;
/** The most the board gives during that flutter, in radians: about four degrees. */
export const ARRIVE_COVER = 0.075;

/** A bump that rises to 1 at `peak` (a share of its length) and has died away, smoothly, by 1. */
function bump(u: number, peak: number): number {
  if (u <= 0 || u >= 1) return 0;
  const rise = (u / peak) * Math.exp(1 - u / peak);
  const tail = clamp01((u - 0.6) / 0.4);
  return rise * (1 - tail * tail * (3 - 2 * tail));
}

/**
 * A volume that has just stopped at the centre after travelling `steps` places: the board gives a few
 * degrees and the free edges of the leaves run through one after another, as pages do when a book is set
 * down. Shut before 0 and from `ARRIVE_MS` on. A longer journey flutters a little more, up to a limit.
 */
export function arrivalAt(ms: number, steps: number): Opening {
  if (ms <= 0 || ms >= ARRIVE_MS || steps < 1) return shut();
  const u = ms / ARRIVE_MS;
  const strength = Math.min(1, 0.7 + 0.15 * (Math.min(3, Math.abs(steps)) - 1));
  const cover = ARRIVE_COVER * strength * bump(u, 0.3);
  const leaves = Array.from({ length: LEAVES }, (_, index) => {
    const place = 0.35 + 0.65 * placeOf(index);
    const late = 0.03 + 0.2 * depthOf(index);
    const edge = ARRIVE_COVER * strength * 0.9 * place * bump(u - late, 0.2);
    // The root hardly moves: it is the free edge that runs.
    return shapeOf([edge * 0.12, edge * 0.4, edge]);
  });
  return tidy({ cover, leaves });
}

/**
 * Shares of the flight between which the volume stands open, and the most its board turns. The volume
 * first tips and lifts off the shelf shut; the board is more than a tenth open only between a quarter and
 * three quarters of the way.
 */
export const FLIGHT_OPEN_FROM = 0.2;
export const FLIGHT_OPEN_TO = 0.78;
/** About 15 degrees, as the reference's boards open while its book is carried. */
export const FLIGHT_COVER = 0.27;
/** In shares of the flight: each leaf's delay behind the one in front, and the lag of the knee and the edge. */
const FLIGHT_STAGGER = 0.075;
const FLIGHT_KNEE_LAG = 0.03;
const FLIGHT_EDGE_LAG = 0.07;

/** How open the carried volume is at `time`: nothing, then a swell with its top in the middle, then nothing. */
function swell(time: number): number {
  const w = clamp01((time - FLIGHT_OPEN_FROM) / (FLIGHT_OPEN_TO - FLIGHT_OPEN_FROM));
  const s = Math.sin(Math.PI * w);
  return s * s;
}

/**
 * The pages of a volume in the air at `time`, 0 on the shelf and 1 beside the page. As it leaves the row
 * the board swings open and the leaves follow, the free edges last; before it lands it has closed again,
 * so the cover that arrives is a shut one. It depends on nothing but `time`: flown backwards, it plays
 * backwards, and a flight turned round in the air has no jump.
 */
export function flightOpening(time: number): Opening {
  const t = clamp01(time);
  if (t <= FLIGHT_OPEN_FROM || t >= FLIGHT_OPEN_TO) return shut();
  const cover = FLIGHT_COVER * swell(t);
  const leaves = Array.from({ length: LEAVES }, (_, index) => {
    const place = placeOf(index);
    const reach = FLIGHT_COVER * 0.82 * place * Math.sqrt(place);
    const late = depthOf(index) * FLIGHT_STAGGER;
    return shapeOf([
      reach * swell(t - late),
      reach * 0.86 * swell(t - late - FLIGHT_KNEE_LAG),
      reach * 0.7 * swell(t - late - FLIGHT_EDGE_LAG),
    ]);
  });
  return tidy({ cover, leaves });
}
