import type { ReaderProgress } from './types';

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/** Vertical extent of one top-level block in scroll content coordinates. */
export interface BlockBox {
  top: number;
  bottom: number;
}

/** Where every text begins. Also the place of a link that has no text to be anywhere in. */
export const START: Readonly<ReaderProgress> = { block: 0, ratio: 0, percent: 0 };

const clamp01 = (value: number): number => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);
const round3 = (value: number): number => Math.round(value * 1000) / 1000;

export function maxScrollTop(metrics: ScrollMetrics): number {
  return Math.max(0, metrics.scrollHeight - metrics.clientHeight);
}

/** Index of the first block whose bottom lies below `edge`, or -1. Blocks are sorted top to bottom. */
function firstBlockBelow(blocks: BlockBox[], edge: number): number {
  let low = 0;
  let high = blocks.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((blocks[middle]?.bottom ?? Infinity) > edge) high = middle;
    else low = middle + 1;
  }
  return low < blocks.length ? low : -1;
}

/**
 * Reading position for plain numbers. `topInset` is the height of the sticky bar, so the
 * reading edge is the first pixel row the person can actually see.
 */
export function positionFromMetrics(metrics: ScrollMetrics, blocks: BlockBox[], topInset = 0): ReaderProgress {
  const max = maxScrollTop(metrics);
  const percent = max <= 0 ? 1 : clamp01(metrics.scrollTop / max);
  const edge = metrics.scrollTop + topInset;
  const index = firstBlockBelow(blocks, edge);
  const box = index === -1 ? undefined : blocks[index];
  if (!box) return { block: Math.max(0, blocks.length - 1), ratio: blocks.length ? 1 : 0, percent };
  const height = box.bottom - box.top;
  return { block: index, ratio: height > 0 ? clamp01((edge - box.top) / height) : 0, percent };
}

/** Inverse of `positionFromMetrics` for block and ratio: the scrollTop that puts that spot at the reading edge. */
export function scrollTopFor(
  position: Pick<ReaderProgress, 'block' | 'ratio'>,
  blocks: BlockBox[],
  topInset = 0,
  maxScroll = Infinity,
): number {
  const index = Math.min(Math.max(0, Math.trunc(position.block) || 0), blocks.length - 1);
  const box = blocks[index];
  if (!box) return 0;
  const target = box.top + clamp01(position.ratio) * (box.bottom - box.top) - topInset;
  return Math.min(Math.max(0, target), maxScroll);
}

/** Vertical part of a CSS transform that is currently applied, so a rise in progress does not skew a measurement. */
function translatedY(node: HTMLElement): number {
  const view = node.ownerDocument.defaultView;
  if (!view || typeof view.DOMMatrixReadOnly !== 'function') return 0;
  const { transform } = view.getComputedStyle(node);
  if (!transform || transform === 'none') return 0;
  try {
    const shift = new view.DOMMatrixReadOnly(transform).m42;
    return Number.isFinite(shift) ? shift : 0;
  } catch {
    return 0;
  }
}

/** Measures the direct `[data-block]` children of `body` relative to the scroller's content. */
export function measureBlocks(scroller: HTMLElement, body: HTMLElement): BlockBox[] {
  const origin = scroller.getBoundingClientRect().top - scroller.scrollTop + translatedY(body);
  return Array.from(body.children)
    .filter((child) => child.hasAttribute('data-block'))
    .map((child) => {
      const rect = child.getBoundingClientRect();
      return { top: rect.top - origin, bottom: rect.bottom - origin };
    });
}

export interface TrackerOptions {
  scroller: HTMLElement;
  measure: () => BlockBox[];
  topInset: () => number;
  /** Called when the position changed. `silent` is true for changes the person did not cause. */
  onChange: (position: ReaderProgress, silent: boolean) => void;
}

export interface ProgressTracker {
  current(): ReaderProgress;
  /** Scrolls so the saved block and ratio sit at the reading edge. Null forgets any pending restore. */
  restore(position: ReaderProgress | null): void;
  /** Recomputes after the content or its layout changed. */
  sync(silent: boolean): void;
  /** Layout changed (fonts, width, content): drop measurements and keep a pending restore in place. */
  settle(): void;
  destroy(): void;
}

const same = (a: ReaderProgress, b: ReaderProgress): boolean =>
  a.block === b.block && a.ratio === b.ratio && a.percent === b.percent;

function schedule(callback: () => void): () => void {
  if (typeof requestAnimationFrame === 'function') {
    const handle = requestAnimationFrame(callback);
    return () => cancelAnimationFrame(handle);
  }
  const handle = setTimeout(callback, 16);
  return () => clearTimeout(handle);
}

export function createProgressTracker(options: TrackerOptions): ProgressTracker {
  const { scroller } = options;
  let cache: BlockBox[] | null = null;
  let last: ReaderProgress = { block: 0, ratio: 0, percent: 1 };
  let cancelFrame: (() => void) | null = null;
  let pending: ReaderProgress | null = null;
  let appliedTop = Number.NaN;

  const metrics = (): ScrollMetrics => ({
    scrollTop: scroller.scrollTop,
    scrollHeight: scroller.scrollHeight,
    clientHeight: scroller.clientHeight,
  });
  const blocks = (): BlockBox[] => (cache ??= options.measure());

  function sync(silent: boolean): void {
    const raw = positionFromMetrics(metrics(), blocks(), options.topInset());
    const next = { block: raw.block, ratio: round3(raw.ratio), percent: round3(raw.percent) };
    if (same(next, last)) return;
    last = next;
    options.onChange(next, silent);
  }

  function applyPending(): void {
    if (!pending) return;
    const max = maxScrollTop(metrics());
    const top = pending.percent <= 0 ? 0 : scrollTopFor(pending, blocks(), options.topInset(), max);
    scroller.scrollTop = top;
    appliedTop = scroller.scrollTop;
    sync(true);
  }

  function onScroll(): void {
    if (cancelFrame) return;
    cancelFrame = schedule(() => {
      cancelFrame = null;
      sync(false);
    });
  }
  scroller.addEventListener('scroll', onScroll, { passive: true });

  return {
    current: () => last,
    restore(position) {
      pending = position;
      cache = null;
      if (position) applyPending();
    },
    sync,
    settle() {
      cache = null;
      // Re-apply only while the person has not moved away from the restored spot.
      if (pending && Math.abs(scroller.scrollTop - appliedTop) <= 2) applyPending();
      else sync(false);
    },
    destroy() {
      scroller.removeEventListener('scroll', onScroll);
      cancelFrame?.();
      cancelFrame = null;
      pending = null;
    },
  };
}
