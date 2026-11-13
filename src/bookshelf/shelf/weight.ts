/**
 * What gives the volumes of a row their weight, as pure functions: a turn that carries on a little past
 * where the row stops, and a lean that rocks back once and runs down the row as a wave. No DOM and no
 * clock of their own, so they are unit-testable; the shelf steps them with the time of its frames.
 */

/** Something with mass on a spring: where it is, and how fast it moves in units a second. */
export interface Sprung {
  value: number;
  speed: number;
}

const SUBSTEP_MS = 4;
/** A frame that came later than this is stepped as if it took this long, so a stall cannot throw anything. */
const LATE_MS = 64;

function advance(body: Sprung, from: number, to: number, ms: number, stiffness: number, damping: number, carried: boolean): void {
  const span = Math.min(Math.max(ms, 0), LATE_MS);
  if (!(span > 0)) return;
  // What is carried is slowed against the thing that carries it, not against the room.
  const rate = carried ? ((to - from) / span) * 1000 : 0;
  let done = 0;
  while (done < span) {
    const step = Math.min(SUBSTEP_MS, span - done);
    // Pulled toward where the lead is as the step begins, which is where the body was stepped to.
    const lead = from + (to - from) * (done / span);
    done += step;
    const seconds = step / 1000;
    body.speed += (stiffness * (lead - body.value) + damping * (rate - body.speed)) * seconds;
    body.value += body.speed * seconds;
  }
}

/**
 * Steps something carried along by a lead that went evenly from `from` to `to` over the last `ms`. It is
 * held to the lead by a spring and slowed against it, so it goes with a lead that moves steadily, falls
 * behind one that starts, and keeps its speed when the lead slows: it runs a little past where the lead
 * stops and comes back. `ratio` is the damping ratio: 1 never swings back, less does.
 */
export function stepFollower(body: Sprung, from: number, to: number, ms: number, stiffness: number, ratio: number): void {
  advance(body, from, to, ms, stiffness, 2 * ratio * Math.sqrt(Math.max(0, stiffness)), true);
}

/**
 * How far a volume is turned once what it carries is counted in: the layout's `weight`, and `gain` of
 * what the follower is ahead of it or behind. A volume that is hardly turned carries hardly anything, so
 * one leaving the centre comes to rest exactly as the layout says; the turn is never less than none and
 * never more than `most` of a full one, however fast the volume came by.
 */
export function carriedTurn(weight: number, follower: number, gain: number, most: number): number {
  if (!(weight > 0)) return 0;
  return Math.min(most, Math.max(0, weight + gain * (follower - weight) * weight));
}

/**
 * Steps the lean of the standing volumes toward `wanted` degrees over `ms`, as a head on a spring: it
 * comes on behind the travel and, when the row stops, rocks back past upright once before it is still.
 */
export function stepRock(body: Sprung, wanted: number, ms: number, stiffness: number, damping: number): void {
  advance(body, wanted, wanted, ms, stiffness, damping, false);
}

/** The lean at one moment, as the wave keeps it: the newest last. */
export interface WaveSample {
  time: number;
  value: number;
}

/**
 * The lean as it was at `time`, between the two samples around it. Before the first sample the row had
 * not begun to move, so there is none; after the last it is the last.
 */
export function waveAt(samples: readonly WaveSample[], time: number): number {
  const count = samples.length;
  if (count === 0 || time < samples[0]!.time) return 0;
  for (let index = count - 1; index >= 0; index--) {
    const early = samples[index]!;
    if (early.time > time) continue;
    const late = samples[index + 1];
    if (!late || late.time <= early.time) return early.value;
    return early.value + ((late.value - early.value) * (time - early.time)) / (late.time - early.time);
  }
  return 0;
}

/**
 * How long after the middle of the row a volume `distance` places away takes up the lean, in ms: `perSlot`
 * for each place, so the lean runs down the row as a wave, and never more than `most`.
 */
export function waveDelay(distance: number, perSlot: number, most: number): number {
  if (!Number.isFinite(distance)) return 0;
  return Math.min(most, Math.abs(distance) * perSlot);
}

/**
 * Share of the lean a volume takes for its thickness: a spine `even` px wide at scale 1 takes all of it,
 * a thicker one stands firmer and takes less, a thin one a little more, within `least` and `most`.
 */
export function leanShare(spineWidth: number, even = 60, least = 0.6, most = 1.2): number {
  if (!(spineWidth > 0)) return 1;
  return Math.min(most, Math.max(least, even / spineWidth));
}
