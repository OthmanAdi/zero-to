import { graphemes } from '../i18n';

/**
 * Fitting the words of a checkpoint onto a signpost arm.
 *
 * An arm carries one `show` item of the roadmap as it was written: any script, any length, never upper-cased.
 * Short items are set on one line. Longer ones shrink a little, then break into two lines at a word boundary,
 * then end in an ellipsis. The full text is always in the DOM card beside the map, so nothing is lost.
 */
export interface ArmTextBox {
  readonly width: number;
  readonly height: number;
}

export interface ArmText {
  /** One or two lines, or none for an empty item. */
  readonly lines: readonly string[];
  /** Type size, in the unit of the box. */
  readonly size: number;
  /** True when the item did not fit and ends in an ellipsis. */
  readonly truncated: boolean;
}

/** The width of `text` set at `size`. On a canvas this is `measureText` with the arm's font. */
export type Measure = (text: string, size: number) => number;

export const ARM_TEXT = {
  /** Size of one line and of two lines, as shares of the height of the box. */
  oneLine: 0.5,
  twoLines: 0.37,
  /** How far a line may shrink before the next step is taken. */
  shrinkOne: 0.72,
  shrinkTwo: 0.8,
  /** Line pitch of two lines, as a multiple of the type size. */
  leading: 1.16,
  ellipsis: '…',
} as const;

/** Splits text where a line may break: after a space, and between the words of scripts that use no spaces. */
export function breakPieces(text: string, lang?: string): string[] {
  const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  let raw: string[] | null = null;
  if (Segmenter) {
    try {
      raw = Array.from(new Segmenter(lang, { granularity: 'word' }).segment(text), (part) => part.segment);
    } catch {
      raw = null;
    }
  }
  raw ??= text.split(/(\s+)/).filter((part) => part !== '');
  // Spaces and punctuation stay with the word before them, so no line starts with a comma or a space.
  const pieces: string[] = [];
  for (const part of raw) {
    const opensWord = /[\p{L}\p{N}]/u.test(part);
    const last = pieces.length - 1;
    if (!opensWord && last >= 0) pieces[last] += part;
    else if (opensWord && last >= 0 && /[(\[{«“‘'"-]$/u.test(pieces[last] as string) && !/\s$/.test(pieces[last] as string)) pieces[last] += part;
    else pieces.push(part);
  }
  return pieces;
}

function truncate(text: string, size: number, width: number, measure: Measure, lang?: string): string {
  const parts = graphemes(text.trimEnd(), lang);
  while (parts.length > 1 && measure(`${parts.join('').trimEnd()}${ARM_TEXT.ellipsis}`, size) > width) parts.pop();
  return `${parts.join('').trimEnd()}${ARM_TEXT.ellipsis}`;
}

export function layoutArmText(text: string, box: ArmTextBox, measure: Measure, lang?: string): ArmText {
  const clean = text.replace(/\s+/gu, ' ').trim();
  if (clean === '' || !(box.width > 0) || !(box.height > 0)) return { lines: [], size: box.height * ARM_TEXT.oneLine, truncated: false };

  const one = box.height * ARM_TEXT.oneLine;
  const oneWidth = measure(clean, one);
  if (oneWidth <= box.width) return { lines: [clean], size: one, truncated: false };
  if (box.width / oneWidth >= ARM_TEXT.shrinkOne) return { lines: [clean], size: (one * box.width) / oneWidth, truncated: false };

  // Two lines: the break that leaves the shorter longest line.
  const two = box.height * ARM_TEXT.twoLines;
  const pieces = breakPieces(clean, lang);
  let best: { first: string; second: string; widest: number } | null = null;
  for (let cut = 1; cut < pieces.length; cut += 1) {
    const first = pieces.slice(0, cut).join('').trim();
    const second = pieces.slice(cut).join('').trim();
    const widest = Math.max(measure(first, two), measure(second, two));
    if (!best || widest < best.widest) best = { first, second, widest };
  }
  if (best && best.widest <= box.width) return { lines: [best.first, best.second], size: two, truncated: false };
  if (best && box.width / best.widest >= ARM_TEXT.shrinkTwo) {
    return { lines: [best.first, best.second], size: (two * box.width) / best.widest, truncated: false };
  }

  // Too long even so: fill the first line, and end the second in an ellipsis.
  const size = two * ARM_TEXT.shrinkTwo;
  let first = '';
  let used = 0;
  for (const piece of pieces) {
    if (used > 0 && measure((first + piece).trim(), size) > box.width) break;
    first += piece;
    used += 1;
  }
  let rest = pieces.slice(used).join('');
  if (measure(first.trim(), size) > box.width) {
    // One unbroken word wider than the arm: break it between characters.
    const parts = graphemes(first, lang);
    let head = '';
    let taken = 0;
    for (const part of parts) {
      if (taken > 0 && measure(head + part, size) > box.width) break;
      head += part;
      taken += 1;
    }
    rest = parts.slice(taken).join('') + rest;
    first = head;
  }
  first = first.trim();
  rest = rest.trim();
  if (rest === '') return { lines: [first], size, truncated: false };
  if (measure(rest, size) <= box.width) return { lines: [first, rest], size, truncated: false };
  return { lines: [first, truncate(rest, size, box.width, measure, lang)], size, truncated: true };
}
