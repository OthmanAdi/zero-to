/**
 * Writing a roadmap into the single-file viewer. The template carries an empty
 * `<script type="application/json" id="zero-to-roadmap">` element; this module fills it, optionally fills or adds
 * `#zero-to-receipt` with the link-check counts, and sets the document title.
 *
 * The template's inlined scripts may contain the same element names as text, so the elements are found with a
 * small scanner that skips over the bodies of <script>, <style>, <textarea> and <title> and over comments.
 */
import type { Roadmap } from '../roadmap/types';
import type { Totals } from './links';

export const ROADMAP_ELEMENT_ID = 'zero-to-roadmap';
export const RECEIPT_ELEMENT_ID = 'zero-to-receipt';
export const TITLE_SUFFIX = ' · zero-to';

export class ViewerTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ViewerTemplateError';
  }
}

/** The counts the viewer shows next to "links opened on". */
export interface ReceiptCounts extends Totals {
  readonly checkedOn: string;
}

interface Element {
  readonly name: string;
  readonly id: string | null;
  /** Index of "<" of the start tag. */
  readonly start: number;
  /** Index just after the start tag's ">". */
  readonly contentStart: number;
  /** Index of "<" of the end tag (raw-text elements only). */
  readonly contentEnd: number;
  /** Index just after the end tag's ">" (raw-text elements only). */
  readonly end: number;
}

const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title']);

function attribute(attrs: string, name: string): string | null {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
  const match = re.exec(attrs);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? '';
}

/** Index just after the ">" that closes the tag starting at `from`, respecting quoted attribute values. */
function tagEnd(html: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < html.length; i += 1) {
    const c = html[i];
    if (quote !== null) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      return i + 1;
    }
  }
  return -1;
}

/** The raw-text elements of a page (script, style, textarea, title), in document order. */
export function rawTextElements(html: string): Element[] {
  const found: Element[] = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) break;
    if (html.startsWith('<!--', lt)) {
      const close = html.indexOf('-->', lt + 4);
      i = close < 0 ? html.length : close + 3;
      continue;
    }
    const open = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(html.slice(lt, lt + 64));
    if (!open || open[1] === undefined) {
      i = lt + 1;
      continue;
    }
    const name = open[1].toLowerCase();
    const contentStart = tagEnd(html, lt + open[0].length);
    if (contentStart < 0) break;
    if (!RAW_TEXT.has(name)) {
      i = contentStart;
      continue;
    }
    const closer = new RegExp(`</${name}[\\s/>]`, 'gi');
    closer.lastIndex = contentStart;
    const close = closer.exec(html);
    const contentEnd = close ? close.index : html.length;
    const end = close ? tagEnd(html, close.index) : html.length;
    const attrs = html.slice(lt + open[0].length, contentStart - 1);
    found.push({ name, id: attribute(attrs, 'id'), start: lt, contentStart, contentEnd, end: end < 0 ? html.length : end });
    i = end < 0 ? html.length : end;
  }
  return found;
}

const BACKSLASH = String.fromCharCode(92);
const LINE_BREAKS = new RegExp(`[${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]`, 'g');

/** "<" as a JSON escape: backslash, u, 003c. */
export const ESCAPED_LT = `${BACKSLASH}u003c`;

/**
 * JSON that is safe inside a <script> element: every "<" becomes the escape backslash-u-003c, so no "</script>"
 * can close the element early. The two Unicode line separators are escaped as well.
 */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, ESCAPED_LT)
    .replace(LINE_BREAKS, (c) => `${BACKSLASH}u${c.charCodeAt(0).toString(16)}`);
}

export function escapeHtmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

interface Splice {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

function applySplices(html: string, splices: readonly Splice[]): string {
  let out = html;
  for (const s of [...splices].sort((a, b) => b.from - a.from)) {
    out = out.slice(0, s.from) + s.text + out.slice(s.to);
  }
  return out;
}

/** Fills the template. Throws ViewerTemplateError when the template has no roadmap element. */
export function injectRoadmap(template: string, roadmap: Roadmap, receipt?: ReceiptCounts): string {
  const elements = rawTextElements(template);
  const holder = elements.find((e) => e.name === 'script' && e.id === ROADMAP_ELEMENT_ID);
  if (!holder) {
    throw new ViewerTemplateError(
      `The viewer template has no <script type="application/json" id="${ROADMAP_ELEMENT_ID}"> element, so it is not a zero-to viewer build.`,
    );
  }
  const splices: Splice[] = [{ from: holder.contentStart, to: holder.contentEnd, text: scriptJson(roadmap) }];

  if (receipt !== undefined) {
    const counts = { opened: receipt.opened, kept: receipt.kept, dead: receipt.dead, flagged: receipt.flagged, checkedOn: receipt.checkedOn };
    const slot = elements.find((e) => e.name === 'script' && e.id === RECEIPT_ELEMENT_ID);
    if (slot) {
      splices.push({ from: slot.contentStart, to: slot.contentEnd, text: scriptJson(counts) });
    } else {
      splices.push({ from: holder.end, to: holder.end, text: `\n<script type="application/json" id="${RECEIPT_ELEMENT_ID}">${scriptJson(counts)}</script>` });
    }
  }

  const title = escapeHtmlText(`${roadmap.title}${TITLE_SUFFIX}`);
  const titleElement = elements.find((e) => e.name === 'title');
  if (titleElement) {
    splices.push({ from: titleElement.contentStart, to: titleElement.contentEnd, text: title });
  } else {
    const head = /<head\b[^>]*>/i.exec(template);
    const at = head ? head.index + head[0].length : holder.start;
    splices.push({ from: at, to: at, text: `<title>${title}</title>` });
  }
  return applySplices(template, splices);
}

/** Reads the roadmap back out of a built page (for tests and for checking a build). */
export function extractRoadmapJson(html: string, id = ROADMAP_ELEMENT_ID): unknown {
  const element = rawTextElements(html).find((e) => e.name === 'script' && e.id === id);
  if (!element) return undefined;
  const text = html.slice(element.contentStart, element.contentEnd).trim();
  return text === '' ? undefined : (JSON.parse(text) as unknown);
}
