import { dirOf, graphemes, scriptOf, type Direction } from '../i18n';

/**
 * Fits a title of any length and script into a box of at most three lines: wrap at word boundaries, then shrink
 * from 100 to 56 percent, then end in an ellipsis. Titles are never upper-cased and never tracked.
 */
export interface TitleBox {
  /** Width and height of the box in pixels. */
  readonly width: number;
  readonly height: number;
  /** Font size at 100 percent. */
  readonly fontPx: number;
  /** Line height as a share of the font size. Default 1.06. */
  readonly lineHeight?: number;
  /** Most lines allowed. Default 3. */
  readonly maxLines?: number;
  /** Smallest size as a share of `fontPx`. Default 0.56. */
  readonly minScale?: number;
  /** Width of a piece of text at a font size. Without it an estimate by script is used. */
  readonly measure?: (text: string, fontPx: number) => number;
}

export interface TitleLayout {
  readonly lines: readonly string[];
  readonly fontPx: number;
  /** Share of the box's `fontPx` the title was set at, 1 to `minScale`. */
  readonly scale: number;
  readonly lineHeightPx: number;
  /** Width of the widest line and height of the block. */
  readonly width: number;
  readonly height: number;
  /** True when the title did not fit and ends in an ellipsis. */
  readonly truncated: boolean;
  readonly direction: Direction;
}

const ELLIPSIS = '…';
const SCALES = [1, 0.94, 0.88, 0.82, 0.76, 0.7, 0.64, 0.6, 0.56];
const WIDE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}＀-￯　-〿]/u;
/** Scripts that are written without spaces between words: a line may break between any two words. */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}＀-￯　-〿]/u;
const BREAK_AFTER = /[-‐–—/]$/u;
const SPACE = /^\s+$/u;

/** A width guess for when no canvas is at hand: wide scripts take a full em, Latin about half. */
export function estimateTextWidth(text: string, fontPx: number): number {
  let em = 0;
  for (const char of text) {
    if (WIDE.test(char)) em += 1;
    else if (char === ' ') em += 0.27;
    else if (/[A-ZÀ-Þ]/u.test(char)) em += 0.68;
    else if (/[mwMW@]/u.test(char)) em += 0.84;
    else if (/[iljtfI.,:;'!|]/u.test(char)) em += 0.31;
    else if (/\p{M}/u.test(char)) em += 0;
    else em += 0.55;
  }
  return em * fontPx;
}

/**
 * The pieces a title may be broken between: words with the space that follows them, the halves of a hyphenated
 * word, and single words of scripts that are written without spaces.
 */
export function titleChunks(text: string, lang: string): string[] {
  const clean = text.replace(/\s+/gu, ' ').trim();
  if (clean === '') return [];
  const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  let parts: { segment: string; word: boolean }[] | null = null;
  if (Segmenter) {
    try {
      parts = Array.from(new Segmenter(lang || undefined, { granularity: 'word' }).segment(clean), (part) => ({
        segment: part.segment,
        word: part.isWordLike === true,
      }));
    } catch {
      parts = null;
    }
  }
  if (!parts) {
    parts = clean.split(/(\s+)/u).filter((piece) => piece !== '').map((segment) => ({ segment, word: !SPACE.test(segment) }));
  }

  const chunks: string[] = [];
  let current = '';
  let canBreak = false;
  for (const part of parts) {
    if (SPACE.test(part.segment)) {
      current += ' ';
      canBreak = true;
      continue;
    }
    // A new word starts a new piece when a space, a hyphen or a script without spaces allows a break there.
    const unspaced = UNSPACED.test(part.segment) || UNSPACED.test(current.slice(-2));
    if (current !== '' && part.word && (canBreak || BREAK_AFTER.test(current) || unspaced)) {
      chunks.push(current);
      current = '';
    }
    current += part.segment;
    canBreak = false;
  }
  if (current !== '') chunks.push(current);
  return chunks;
}

function wrap(
  chunks: readonly string[],
  width: number,
  fontPx: number,
  measure: (text: string, fontPx: number) => number,
  hard: boolean,
  lang: string,
): string[] | null {
  const lines: string[] = [];
  let line = '';
  const push = (): void => {
    if (line.trim() !== '') lines.push(line.trim());
    line = '';
  };
  for (const chunk of chunks) {
    const joined = line + chunk;
    if (measure(joined.trimEnd(), fontPx) <= width) {
      line = joined;
      continue;
    }
    if (line !== '') push();
    if (measure(chunk.trimEnd(), fontPx) <= width) {
      line = chunk;
      continue;
    }
    // One piece is wider than the box.
    if (!hard) return null;
    const hyphen = scriptOf(chunk) === 'latin' || scriptOf(chunk) === 'cyrillic' || scriptOf(chunk) === 'greek' ? '-' : '';
    let rest = graphemes(chunk, lang);
    while (rest.length > 0) {
      let take = rest.length;
      while (take > 1 && measure(rest.slice(0, take).join('').trimEnd() + (take < rest.length ? hyphen : ''), fontPx) > width) take -= 1;
      const piece = rest.slice(0, take).join('');
      rest = rest.slice(take);
      if (rest.length > 0) lines.push(piece.trimEnd() + hyphen);
      else line = piece;
    }
  }
  push();
  return lines;
}

function widest(lines: readonly string[], fontPx: number, measure: (text: string, fontPx: number) => number): number {
  return lines.reduce((most, line) => Math.max(most, measure(line, fontPx)), 0);
}

export function layoutTitle(text: string, lang: string, box: TitleBox): TitleLayout {
  const measure = box.measure ?? estimateTextWidth;
  const leading = box.lineHeight ?? 1.06;
  const maxLines = Math.max(1, Math.round(box.maxLines ?? 3));
  const minScale = Math.min(1, Math.max(0.1, box.minScale ?? 0.56));
  const chunks = titleChunks(text, lang);
  const direction = dirOf(text);
  const result = (lines: string[], scale: number, truncated: boolean): TitleLayout => {
    const fontPx = box.fontPx * scale;
    return {
      lines,
      fontPx,
      scale,
      lineHeightPx: fontPx * leading,
      width: widest(lines, fontPx, measure),
      height: lines.length * fontPx * leading,
      truncated,
      direction,
    };
  };
  if (chunks.length === 0) return result([], 1, false);

  const scales = SCALES.filter((scale) => scale > minScale + 1e-6).concat(minScale);
  for (const scale of scales) {
    const fontPx = box.fontPx * scale;
    const lines = wrap(chunks, box.width, fontPx, measure, false, lang);
    if (lines && lines.length <= maxLines && lines.length * fontPx * leading <= box.height + 0.5) return result(lines, scale, false);
  }

  // Smallest size, words broken where they must be, and whatever is left over ends in an ellipsis.
  const fontPx = box.fontPx * minScale;
  const fitLines = Math.max(1, Math.min(maxLines, Math.floor((box.height + 0.5) / (fontPx * leading))));
  const all = wrap(chunks, box.width, fontPx, measure, true, lang) ?? [];
  if (all.length <= fitLines) return result(all, minScale, false);
  const kept = all.slice(0, fitLines);
  let last = graphemes(`${kept[fitLines - 1] ?? ''} ${all[fitLines] ?? ''}`, lang);
  while (last.length > 1 && measure(last.join('').trimEnd() + ELLIPSIS, fontPx) > box.width) last = last.slice(0, -1);
  kept[fitLines - 1] = last.join('').replace(/[\s\-,.;:]+$/u, '') + ELLIPSIS;
  return result(kept, minScale, true);
}
