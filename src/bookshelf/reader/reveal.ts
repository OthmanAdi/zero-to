export interface RevealFrame {
  /** True when nothing should be visible. */
  closed: boolean;
  /** True when the sheet is fully open and interactive. */
  open: boolean;
  /** Opacity of the sheet: a number while it fades, empty when it is fully open. */
  opacity: string;
  /** True once the text should have entered (on the way in) and false again on the way out. */
  content: boolean;
}

/** The sheet fades in over this window of the opening, and out over the same window on closing. */
export const SHEET_FADE_START = 0.17;
export const SHEET_FADE_END = 0.6;
/** The header and the text start to enter once the sheet is nearly opaque. */
export const CONTENT_START = 0.54;

/** Applies the frames of `revealFrame` to the dialog. */
export function createRevealer(root: HTMLElement, sheet: HTMLElement): (progress: number) => void {
  const reducedQuery = root.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;
  let last = 0;
  return (progress) => {
    const frame = revealFrame(progress, reducedQuery?.matches === true);
    // Going from closed straight to open (a restored session) shows the text at once instead of letting it rise.
    if (frame.open && last <= 0) root.dataset.enter = 'instant';
    else if (!frame.open && !frame.closed) delete root.dataset.enter;
    last = progress;
    root.dataset.open = frame.open ? '1' : '0';
    root.dataset.content = frame.content ? '1' : '0';
    root.dataset.closed = frame.closed ? '1' : '0';
    sheet.style.opacity = frame.opacity;
  };
}

const clamp01 = (value: number): number => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);
const round = (value: number): number => Math.round(value * 1000) / 1000;

/**
 * Pure maths for the open transition. `progress` is linear time from 0 (closed) to 1 (open); closing
 * plays it backwards, so one function serves both directions. With reduced motion the sheet is shown
 * as soon as the transition starts and the stylesheet cross-fades it.
 */
export function revealFrame(progress: number, reduced = false): RevealFrame {
  const p = clamp01(progress);
  if (p <= 0) return { closed: true, open: false, opacity: '0', content: false };
  if (p >= 1) return { closed: false, open: true, opacity: '', content: true };
  if (reduced) return { closed: false, open: false, opacity: '1', content: true };
  const fade = clamp01((p - SHEET_FADE_START) / (SHEET_FADE_END - SHEET_FADE_START));
  return { closed: false, open: false, opacity: String(round(fade)), content: p >= CONTENT_START };
}
