/** Body sizes in pixels, smallest first. A scale is an index into this list. */
export const TEXT_SIZES = [17, 19, 21, 24, 28] as const;

export const MAX_TEXT_SCALE = TEXT_SIZES.length - 1;

/** A whole step from 0 to 4, or null for anything else (null means the size follows the screen). */
export function normaliseScale(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(MAX_TEXT_SCALE, Math.max(0, Math.round(value)));
}

/** The step whose size is closest to a measured size. */
export function nearestScale(px: number): number {
  let best = 0;
  TEXT_SIZES.forEach((size, index) => {
    if (Math.abs(size - px) < Math.abs((TEXT_SIZES[best] ?? size) - px)) best = index;
  });
  return best;
}

/** The step after pressing smaller (-1) or larger (+1). With no chosen step it starts from the size on screen. */
export function stepScale(current: number | null, delta: -1 | 1, measuredPx: number): number {
  const from = current ?? nearestScale(measuredPx);
  return Math.min(MAX_TEXT_SCALE, Math.max(0, from + delta));
}
