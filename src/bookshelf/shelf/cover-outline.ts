/**
 * The shape of a saved text, for printing on its cover: one value per paragraph in reading order, its
 * length relative to the longest, 0 to 1. A heading is given as a negative value. Seen from across the
 * room, a page is exactly this: a column of grey bars, ragged at the right, with the headings darker.
 */

/** At most this many paragraphs are printed: the first page, not the whole text. */
export const OUTLINE_LIMIT = 18;
/** The shortest bar still printed, so a one-word paragraph does not vanish. */
const SHORTEST = 0.04;

/** The heading syntax of the markdown-lite text: one to three hashes and a space. */
const HEADING = /^#{1,3}\s+\S/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const FENCE = /^\s*```/;

interface Unit {
  heading: boolean;
  length: number;
}

/** Characters a reader would see: markup and the address of a link do not count. */
function visibleLength(line: string): number {
  const text = line
    .replace(/^\s*#{1,3}\s+/, '')
    .replace(/^\s*>\s?/, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return [...text].length;
}

function unitsOf(block: string): Unit[] {
  const units: Unit[] = [];
  let paragraph = 0;
  const close = () => {
    if (paragraph > 0) units.push({ heading: false, length: paragraph });
    paragraph = 0;
  };
  for (const line of block.split('\n')) {
    if (RULE.test(line) || FENCE.test(line)) continue;
    if (HEADING.test(line)) {
      close();
      units.push({ heading: true, length: visibleLength(line) });
      continue;
    }
    const length = visibleLength(line);
    if (length > 0) paragraph += length + (paragraph > 0 ? 1 : 0);
  }
  close();
  return units;
}

/**
 * The outline of `text`, at most `limit` values. Paragraphs are separated by a blank line; a text
 * pasted with no blank lines at all, one paragraph to a line, is read a line at a time instead.
 */
export function outlineOf(text: string, limit = OUTLINE_LIMIT): number[] {
  const normal = text.replace(/\r\n?/g, '\n').trim();
  if (normal === '' || limit <= 0) return [];
  const blocks = normal.split(/\n[ \t]*\n/);
  let units = blocks.flatMap(unitsOf);
  if (blocks.length === 1 && units.length === 1 && normal.includes('\n')) {
    units = normal.split('\n').flatMap(unitsOf);
  }
  const kept = units.slice(0, limit);
  const longest = Math.max(0, ...kept.map((unit) => unit.length));
  if (longest === 0) return [];
  return kept.map((unit) => {
    const value = Math.max(SHORTEST, Math.round((unit.length / longest) * 1000) / 1000);
    return unit.heading ? -value : value;
  });
}

/** An outline as a cover may trust it: finite, within -1 to 1, never zero, at most the limit. */
export function cleanOutline(outline: readonly unknown[] | undefined): number[] {
  if (!Array.isArray(outline)) return [];
  return outline
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value !== 0)
    .slice(0, OUTLINE_LIMIT)
    .map((value) => Math.sign(value) * Math.min(1, Math.max(SHORTEST, Math.abs(value))));
}
