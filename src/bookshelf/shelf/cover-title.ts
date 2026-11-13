/**
 * Sizing a cover title from its own text, without measuring anything on the page.
 *
 * Widths come from the advance widths of the title face (the bundled serif at weight 600, in em), so
 * the size is known while the cover is built, before any font has loaded, and comes out the same on
 * every machine. All lengths are in cqw: hundredths of the cover's width.
 */

const LOWER = [
  0.533, 0.598, 0.484, 0.611, 0.503, 0.391, 0.53, 0.612, 0.295, 0.278, 0.598, 0.289, 0.912, 0.619, 0.574, 0.61, 0.596,
  0.447, 0.432, 0.401, 0.6, 0.582, 0.825, 0.573, 0.571, 0.494,
];
const UPPER = [
  0.756, 0.695, 0.71, 0.78, 0.699, 0.636, 0.776, 0.856, 0.378, 0.412, 0.803, 0.647, 1.058, 0.776, 0.806, 0.668, 0.807,
  0.742, 0.586, 0.743, 0.797, 0.744, 1.068, 0.764, 0.732, 0.676,
];
const OTHER: Record<string, number> = {
  ' ': 0.21,
  '.': 0.241,
  ',': 0.242,
  ':': 0.271,
  ';': 0.276,
  '!': 0.271,
  '?': 0.487,
  "'": 0.195,
  '’': 0.195,
  '"': 0.38,
  '“': 0.38,
  '”': 0.38,
  '(': 0.246,
  ')': 0.246,
  '-': 0.319,
  '–': 0.467,
  '—': 0.632,
  '/': 0.24,
  '&': 0.769,
  'ß': 0.662,
};
const DIGIT = 0.631;
/** Anything the table does not know is taken as a wide letter, so an estimate errs toward a smaller size. */
const UNKNOWN = 0.66;
const FULL_WIDTH = 1;
/** Part of the line kept free, so a small error in the estimate never pushes a word over the edge. */
const SAFETY = 0.95;

/** Scripts set without spaces, where a line may break between any two characters. */
const IDEOGRAPHIC = /[ᄀ-ᇿ⺀-鿿가-힯豈-﫿︰-﹏＀-￯]/;
/** Characters after which a browser may break a line inside a word. */
const BREAK_AFTER = new Set(['-', '‐', '–', '—', '/']);

/** Advance width of one character in em. */
export function advance(char: string): number {
  const code = char.charCodeAt(0);
  if (code >= 97 && code <= 122) return LOWER[code - 97] ?? UNKNOWN;
  if (code >= 65 && code <= 90) return UPPER[code - 65] ?? UNKNOWN;
  if (code >= 48 && code <= 57) return DIGIT;
  const known = OTHER[char];
  if (known !== undefined) return known;
  if (IDEOGRAPHIC.test(char)) return FULL_WIDTH;
  const base = char.normalize('NFD').charAt(0);
  return base !== char && base.length > 0 ? advance(base) : UNKNOWN;
}

/** A run of text that is never broken unless it is wider than a line, and the space that follows it. */
interface Unit {
  width: number;
  space: number;
}

function unitsOf(title: string): Unit[] {
  const units: Unit[] = [];
  let width = 0;
  const close = (space: number) => {
    if (width > 0) units.push({ width, space });
    else if (units.length > 0) units[units.length - 1]!.space += space;
    width = 0;
  };
  for (const char of title.trim()) {
    if (/\s/.test(char)) {
      close(advance(' '));
      continue;
    }
    if (IDEOGRAPHIC.test(char)) {
      close(0);
      width = advance(char);
      close(0);
      continue;
    }
    width += advance(char);
    if (BREAK_AFTER.has(char)) close(0);
  }
  close(0);
  return units;
}

/** Width of the widest run that a line cannot break, in em. */
export function longestRun(title: string): number {
  return unitsOf(title).reduce((widest, unit) => Math.max(widest, unit.width), 0);
}

/** Lines a text takes at `size` on a line `measure` long, both in the same unit. */
export function linesOf(text: string, size: number, measure: number): number {
  return countLines(unitsOf(text), (measure * SAFETY) / size);
}

/** How many lines a greedy break gives on a line `room` em long. A run wider than a line is broken. */
function countLines(units: Unit[], room: number): number {
  let lines = 1;
  let used = 0;
  for (const unit of units) {
    if (used > 0 && used + unit.width > room) {
      lines += 1;
      used = 0;
    }
    if (unit.width > room) {
      const extra = Math.ceil(unit.width / room) - 1;
      lines += extra;
      used = unit.width - extra * room;
    } else {
      used += unit.width;
    }
    used += unit.space;
  }
  return lines;
}

/** The room a title has on a cover, in cqw. */
export interface TitleBox {
  /** Line length. */
  measure: number;
  /** Height the lines of the title may take. */
  height: number;
  /** Largest size, for a short title. */
  max: number;
  /** Smallest size. Below it a long word is hyphenated instead. */
  min: number;
  /** Line height as a multiple of the size. */
  leading: number;
}

export interface TitleFit {
  /** Font size in cqw. */
  size: number;
  /** Lines the title is expected to take at that size. */
  lines: number;
  /** Most lines that fit the box at that size: the last guard, never expected to cut. */
  clamp: number;
  /** A word is longer than the line even at the smallest size, so it has to be hyphenated. */
  broken: boolean;
}

/** Titles up to about this many characters may take the largest size; longer ones step down gently. */
const TAPER = 30;
const STEP = 0.1;

/**
 * The largest size at which the longest word fits the line, the title fits the box, and a long title
 * is set a little smaller than a short one even when it would fit.
 */
export function fitTitle(title: string, box: TitleBox): TitleFit {
  const units = unitsOf(title);
  const chars = Math.max(1, [...title.trim()].length);
  const longest = longestRun(title);
  const room = box.measure * SAFETY;
  const linesAt = (size: number) => countLines(units, room / size);

  let size = Math.min(box.max, longest > 0 ? room / longest : box.max, box.max * Math.sqrt(TAPER / chars));
  size = Math.max(box.min, Math.floor(size / STEP) * STEP);
  while (size - STEP >= box.min && linesAt(size) * size * box.leading > box.height) size -= STEP;
  size = Math.round(size * 10) / 10;

  return {
    size,
    lines: linesAt(size),
    clamp: Math.max(1, Math.floor(box.height / (size * box.leading) + 0.001)),
    broken: longest * size > room,
  };
}
