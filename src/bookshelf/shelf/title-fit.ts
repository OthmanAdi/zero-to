/**
 * Fitting a title to a spine, the way a binder letters one: as large as the spine allows on one line,
 * then on two balanced lines, and clipped only when nothing else works. Widths are measured once per
 * title and font; nothing here reads layout.
 */

export interface TitleFont {
  /** CSS font family list, as computed. */
  family: string;
  weight: string;
  /** Extra space after each character, in em. */
  letterSpacing: number;
  upper: boolean;
}

export interface TitleFit {
  /** Font size in px. */
  size: number;
  /** One or two lines, in reading order. */
  lines: string[];
  /** True only when the title could not be set whole at the smallest size: the last resort. */
  clipped: boolean;
}

/** Room for the title, in px: along the spine and across it. */
export interface SpineRoom {
  length: number;
  breadth: number;
}

/** Below this a title is set on two lines instead, if the spine is wide enough to hold them. */
const ONE_LINE_MIN = 11;
/** Nothing printed on a spine is set smaller than this. */
const FLOOR = 9;
/** Largest title for a spine of a given width. */
const LARGEST = 0.34;
/** Share of the spine's width that two lines of type may fill. */
const TWO_LINES_FILL = 0.72;
const TWO_LINES_LEADING = 1.02;
/** Narrower spines never take two lines: they would look crowded. */
const TWO_LINES_MIN_BREADTH = 44;
const SOFT_HYPHEN = '­';
/** Size a title is first measured at: near the sizes spines are lettered in. */
const PROBE_SIZE = 14;

const widths = new Map<string, number>();
let context: CanvasRenderingContext2D | null | undefined;

function canvas(): CanvasRenderingContext2D | null {
  if (context !== undefined) return context;
  try {
    context = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  } catch {
    context = null;
  }
  return context;
}

/** Forget measured widths, for when a web font finishes loading and replaces its fallback. */
export function forgetTitleWidths(): void {
  widths.clear();
}

/** The text as it is printed: soft hyphens only show where a line breaks at one. */
function plain(text: string): string {
  return text.split(SOFT_HYPHEN).join('');
}

function visible(text: string, font: TitleFont): string {
  return font.upper ? plain(text).toUpperCase() : plain(text);
}

/**
 * Width of `text` set in `font` at `size` px, in em. The size matters: a face with an optical size axis
 * is drawn wider at small sizes than at large ones.
 */
export function measureTitle(text: string, font: TitleFont, size = PROBE_SIZE): number {
  const shown = visible(text, font);
  const px = Math.max(FLOOR, Math.round(size));
  const key = `${px}|${font.weight}|${font.family}|${font.letterSpacing}|${font.upper ? 1 : 0}|${shown}`;
  const known = widths.get(key);
  if (known !== undefined) return known;
  const ctx = canvas();
  let width: number;
  if (ctx) {
    ctx.font = `${font.weight} ${px}px ${font.family}`;
    width = ctx.measureText(shown).width / px;
  } else {
    // Without a canvas, estimate: an average character of a text face, a fixed advance for a mono one.
    const mono = /mono/i.test(font.family);
    const each = mono ? 0.6 : font.upper ? 0.66 : 0.5;
    width = shown.length * each;
  }
  width += shown.length * font.letterSpacing;
  widths.set(key, width);
  return width;
}

interface Split {
  first: string;
  second: string;
}

/** Every way to break a title into two lines at a space, after a hyphen or slash, or at a soft hyphen. */
function splits(title: string): Split[] {
  const result: Split[] = [];
  for (let index = 1; index < title.length - 1; index++) {
    const char = title[index]!;
    if (char === ' ') {
      result.push({ first: title.slice(0, index).trimEnd(), second: title.slice(index + 1).trimStart() });
    } else if ((char === '-' || char === '/') && title[index + 1] !== ' ' && title[index - 1] !== ' ') {
      result.push({ first: title.slice(0, index + 1), second: title.slice(index + 1) });
    } else if (char === SOFT_HYPHEN) {
      result.push({ first: `${title.slice(0, index)}-`, second: title.slice(index + 1) });
    }
  }
  return result.filter((split) => split.first !== '' && split.second !== '');
}

export function fitTitle(title: string, room: SpineRoom, font: TitleFont): TitleFit {
  const text = title.trim().replace(/\s+/g, ' ');
  const largest = Math.max(FLOOR, LARGEST * room.breadth);
  const length = Math.max(1, room.length);
  // Measure once near the expected size, then again at the size that gives, since widths depend on size.
  const fits = (lines: string[], cap: number): number => {
    const widest = (size: number): number => Math.max(0.01, ...lines.map((line) => measureTitle(line, font, size)));
    const first = Math.min(cap, length / widest(PROBE_SIZE));
    return Math.min(cap, length / widest(first));
  };
  const single = fits([text], largest);
  if (single >= ONE_LINE_MIN) return { size: single, lines: [plain(text)], clipped: false };

  if (room.breadth >= TWO_LINES_MIN_BREADTH) {
    let best: { size: number; split: Split } | null = null;
    const across = Math.min(largest, (TWO_LINES_FILL * room.breadth) / (2 * TWO_LINES_LEADING));
    for (const split of splits(text)) {
      const size = fits([split.first, split.second], across);
      if (!best || size > best.size) best = { size, split };
    }
    if (best && best.size > single && best.size >= FLOOR) {
      return { size: best.size, lines: [plain(best.split.first), plain(best.split.second)], clipped: false };
    }
  }

  return { size: Math.max(FLOOR, single), lines: [plain(text)], clipped: single < FLOOR };
}
