/**
 * Breaking lines of type the way the browser breaks them on a cover: at spaces and after a hyphen,
 * dash or slash, a word too long for the line split where it overflows, `text-wrap: balance` evening
 * the lines out, and a line clamp ending in an ellipsis. Widths come from a measure function, so this
 * is pure and the canvas can supply the real advances.
 */

export type Measure = (text: string) => number;

/** Characters after which a line may break inside a word. */
const BREAK_AFTER = new Set(['-', '‐', '–', '—', '/']);
/** Chromium balances up to this many lines; a longer paragraph is wrapped as usual. */
export const BALANCE_LIMIT = 6;
const ELLIPSIS = '…';

interface Token {
  text: string;
  /** A space follows it. */
  space: boolean;
}

function tokensOf(text: string): Token[] {
  const tokens: Token[] = [];
  for (const word of text.trim().split(/\s+/)) {
    if (word === '') continue;
    let start = 0;
    for (let index = 0; index < word.length - 1; index++) {
      if (BREAK_AFTER.has(word[index]!) && index + 1 > start) {
        tokens.push({ text: word.slice(start, index + 1), space: false });
        start = index + 1;
      }
    }
    tokens.push({ text: word.slice(start), space: true });
  }
  if (tokens.length > 0) tokens[tokens.length - 1]!.space = false;
  return tokens;
}

/** The longest start of `word` that fits `width`, with a hyphen when the word is hyphenated. */
function splitWord(word: string, width: number, measure: Measure, hyphen: boolean): [string, string] {
  const chars = [...word];
  let fit = 1;
  for (let count = 2; count < chars.length; count++) {
    const head = chars.slice(0, count).join('') + (hyphen ? '-' : '');
    if (measure(head) > width) break;
    fit = count;
  }
  // A hyphenated break leaves at least two letters on each side when it can.
  if (hyphen && fit > 2 && chars.length - fit < 2) fit = Math.max(2, chars.length - 2);
  return [chars.slice(0, fit).join('') + (hyphen ? '-' : ''), chars.slice(fit).join('')];
}

/** Greedy lines on a line `width` long. */
function greedy(tokens: Token[], width: number, measure: Measure, hyphen: boolean): string[] {
  const lines: string[] = [];
  let line = '';
  let pending = '';
  const queue = tokens.map((token) => ({ ...token }));
  while (queue.length > 0) {
    const token = queue.shift()!;
    const candidate = line === '' ? token.text : line + pending + token.text;
    if (line !== '' && measure(candidate) > width) {
      lines.push(line);
      line = '';
      pending = '';
      queue.unshift(token);
      continue;
    }
    if (line === '' && measure(token.text) > width && [...token.text].length > 1) {
      const [head, rest] = splitWord(token.text, width, measure, hyphen);
      lines.push(head);
      if (rest !== '') queue.unshift({ text: rest, space: token.space });
      continue;
    }
    line = candidate;
    pending = token.space ? ' ' : '';
  }
  if (line !== '') lines.push(line);
  return lines;
}

export interface WrapOptions {
  /** Even the lines out, as `text-wrap: balance` does. */
  balance?: boolean;
  /** A word longer than the line is hyphenated where it breaks rather than just broken. */
  hyphenate?: boolean;
}

/** The lines `text` is set in on a line `width` long. */
export function breakLines(text: string, width: number, measure: Measure, options: WrapOptions = {}): string[] {
  const tokens = tokensOf(text);
  if (tokens.length === 0) return [];
  const hyphen = options.hyphenate === true;
  const lines = greedy(tokens, width, measure, hyphen);
  if (!options.balance || lines.length < 2 || lines.length > BALANCE_LIMIT) return lines;
  return balanceLines(tokens, lines.length, width, measure) ?? lines;
}

/** The text of tokens `from` to `to` (exclusive) set on one line. */
function lineOf(tokens: Token[], from: number, to: number): string {
  let text = '';
  for (let index = from; index < to; index++) {
    const token = tokens[index]!;
    text += token.text + (token.space && index < to - 1 ? ' ' : '');
  }
  return text;
}

/**
 * The same number of lines as the greedy break, with breaks chosen so the line lengths vary least: the
 * sum of their squared differences from the mean is smallest. This is how Chromium balances a heading
 * (its score line breaker), so a short line falls where Chromium puts it. Words are never split to
 * balance; a text with a word longer than the line is left as the greedy break set it.
 */
function balanceLines(tokens: Token[], count: number, width: number, measure: Measure): string[] | null {
  const n = tokens.length;
  const widths = new Map<number, number>();
  const widthOf = (from: number, to: number): number => {
    const key = from * 1024 + to;
    let known = widths.get(key);
    if (known === undefined) {
      known = measure(lineOf(tokens, from, to));
      widths.set(key, known);
    }
    return known;
  };
  if (tokens.some((_, index) => widthOf(index, index + 1) > width)) return null;
  const mean = measure(lineOf(tokens, 0, n)) / count;
  // best[lines][end]: least cost of setting tokens 0..end on that many lines, and where the last line began.
  const best: { cost: number; from: number }[][] = [];
  for (let lines = 0; lines <= count; lines++) best.push(Array.from({ length: n + 1 }, () => ({ cost: Infinity, from: -1 })));
  best[0]![0] = { cost: 0, from: -1 };
  for (let lines = 1; lines <= count; lines++) {
    for (let end = 1; end <= n; end++) {
      for (let from = lines - 1; from < end; from++) {
        const before = best[lines - 1]![from]!.cost;
        if (before === Infinity) continue;
        const line = widthOf(from, end);
        if (line > width) continue;
        const cost = before + (line - mean) * (line - mean);
        if (cost < best[lines]![end]!.cost) best[lines]![end] = { cost, from };
      }
    }
  }
  if (best[count]![n]!.cost === Infinity) return null;
  const result: string[] = [];
  let end = n;
  for (let lines = count; lines > 0; lines--) {
    const from = best[lines]![end]!.from;
    result.unshift(lineOf(tokens, from, end));
    end = from;
  }
  return result;
}

/** Keeps at most `max` lines; the last one kept ends in an ellipsis when any were cut, as a line clamp does. */
export function clampLines(lines: string[], max: number, width: number, measure: Measure): string[] {
  if (lines.length <= max || max < 1) return lines;
  const kept = lines.slice(0, max);
  let last = kept[max - 1]!.trimEnd();
  while (last.length > 0 && measure(last + ELLIPSIS) > width) last = [...last].slice(0, -1).join('').trimEnd();
  kept[max - 1] = last + ELLIPSIS;
  return kept;
}

/** `text` on one line no wider than `width`, cut with an ellipsis if it is wider (`text-overflow: ellipsis`). */
export function ellipsize(text: string, width: number, measure: Measure): string {
  if (measure(text) <= width) return text;
  let cut = [...text];
  while (cut.length > 0 && measure(cut.join('') + ELLIPSIS) > width) cut = cut.slice(0, -1);
  return cut.join('') + ELLIPSIS;
}
