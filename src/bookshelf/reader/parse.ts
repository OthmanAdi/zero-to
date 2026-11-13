import { squash, withBreaks } from './breaks';
import type { Block, Inline } from './types';

/** Longest input that is parsed. Anything beyond is dropped. */
export const MAX_INPUT_LENGTH = 500_000;

/** Emphasis and link markers only pair up within this distance, which keeps odd input fast. */
const MAX_SPAN = 4000;
const MAX_DEPTH = 8;
/** Marker search steps allowed per paragraph, per character. Only odd input ever runs out. */
const STEPS_PER_CHAR = 20;

let stepsLeft = 0;

/** Returns the trimmed URL when it is an absolute http(s) link, otherwise null. */
export function safeHttpUrl(value: string): string | null {
  const candidate = value.trim();
  if (!candidate || /\s/.test(candidate)) return null;
  try {
    const { protocol } = new URL(candidate);
    return protocol === 'http:' || protocol === 'https:' ? candidate : null;
  } catch {
    return null;
  }
}

interface Match {
  nodes: Inline[];
  end: number;
}

function appendInlines(out: Inline[], nodes: Inline[]): void {
  for (const node of nodes) {
    const last = out[out.length - 1];
    if (node.t === 'text' && last?.t === 'text') last.v += node.v;
    else out.push(node);
  }
}

const isWordChar = (ch: string): boolean => /[\p{L}\p{N}]/u.test(ch);
const isSpace = (ch: string): boolean => ch === '' || /\s/.test(ch);

function matchCode(src: string, start: number): Match | null {
  const close = src.indexOf('`', start + 1);
  if (close <= start + 1) return null;
  return { nodes: [{ t: 'code', v: src.slice(start + 1, close) }], end: close + 1 };
}

/** First closing marker after `from` that `accept` allows, searched within MAX_SPAN. */
function findCloser(src: string, marker: string, from: number, accept: (at: number) => boolean): number {
  let at = src.indexOf(marker, from);
  while (at !== -1 && at - from <= MAX_SPAN && stepsLeft-- > 0) {
    if (accept(at)) return at;
    at = src.indexOf(marker, at + 1);
  }
  return -1;
}

function matchStrong(src: string, start: number, depth: number): Match | null {
  const from = start + 2;
  if (isSpace(src.charAt(from))) return null;
  let close = findCloser(src, '**', from, (at) => at > from && !isSpace(src.charAt(at - 1)));
  if (close === -1) return null;
  while (src.charAt(close + 2) === '*') close += 1; // `***x***`: close with the last two stars
  return { nodes: [{ t: 'strong', c: parseInlines(src.slice(from, close), true, depth + 1) }], end: close + 2 };
}

function matchEmphasis(src: string, start: number, marker: string, depth: number): Match | null {
  const from = start + 1;
  if (isSpace(src.charAt(from)) || src.charAt(from) === marker) return null;
  if (marker === '_' && isWordChar(src.charAt(start - 1))) return null; // snake_case stays literal
  const close = findCloser(src, marker, from, (at) => {
    if (src.charAt(at + 1) === marker) return false; // part of a `**` or `__` run
    if (src.charAt(at - 1) === marker || isSpace(src.charAt(at - 1))) return false;
    return marker === '*' || !isWordChar(src.charAt(at + 1));
  });
  if (close === -1) return null;
  return { nodes: [{ t: 'em', c: parseInlines(src.slice(from, close), true, depth + 1) }], end: close + 1 };
}

/** Index of the `)` that balances an already opened `(`, or -1. */
function findClosingParen(src: string, from: number): number {
  let depth = 1;
  const limit = Math.min(src.length, from + MAX_SPAN);
  for (let at = from; at < limit && stepsLeft-- > 0; at += 1) {
    const ch = src.charAt(at);
    if (ch === '(') depth += 1;
    else if (ch === ')' && --depth === 0) return at;
  }
  return -1;
}

function matchLink(src: string, start: number, depth: number): Match | null {
  const window = src.slice(start, start + MAX_SPAN);
  const middle = window.indexOf('](');
  if (middle < 2) return null;
  const label = window.slice(1, middle);
  if (label.includes('[')) return null;
  const close = findClosingParen(src, start + middle + 2);
  if (close === -1) return null;
  const labelInlines = parseInlines(label, false, depth + 1);
  const href = safeHttpUrl(src.slice(start + middle + 2, close));
  const nodes: Inline[] = href ? [{ t: 'link', href, c: labelInlines }] : labelInlines;
  return { nodes, end: close + 1 };
}

function matchAt(src: string, at: number, allowLinks: boolean, depth: number): Match | null {
  const ch = src.charAt(at);
  if (ch === '`') return matchCode(src, at);
  if (ch === '*' && src.charAt(at + 1) === '*') return matchStrong(src, at, depth);
  if (ch === '*' || ch === '_') return matchEmphasis(src, at, ch, depth);
  if (ch === '[' && allowLinks) return matchLink(src, at, depth);
  return null;
}

/** Parses the inline subset. Text that does not form a complete construct stays literal. */
export function parseInlines(src: string, allowLinks = true, depth = 0): Inline[] {
  if (depth === 0) stepsLeft = STEPS_PER_CHAR * src.length + 1000;
  if (depth > MAX_DEPTH) return src ? [{ t: 'text', v: src }] : [];
  const out: Inline[] = [];
  let at = 0;
  while (at < src.length) {
    const match = matchAt(src, at, allowLinks, depth);
    if (match) {
      appendInlines(out, match.nodes);
      at = match.end;
    } else {
      appendInlines(out, [{ t: 'text', v: src.charAt(at) }]);
      at += 1;
    }
  }
  return out;
}

const FENCE = /^```/;
const FENCE_END = /^```\s*$/;
const RULE = /^---+$/;
const HEADING = /^(#{1,3})\s+(\S.*)$/;
const QUOTE = /^>\s?(.*)$/;
// Pasted text rarely uses markdown: typographic bullets and dashes start a list as well.
const BULLET = /^(?:[-*]\s+|[\u2022\u00b7\u25e6\u25aa\u25ab\u2023\u25cf\u25cb]\s*|[\u2013\u2014]\s+)(\S.*)$/;
const ORDERED = /^\d{1,9}\.\s+(\S.*)$/;

interface Read {
  block: Block | null;
  next: number;
}

const lineAt = (lines: string[], index: number): string => (lines[index] ?? '').trim();

function startsBlock(line: string): boolean {
  return [FENCE, RULE, HEADING, QUOTE, BULLET, ORDERED].some((pattern) => pattern.test(line));
}

function readFence(lines: string[], start: number): Read {
  const body: string[] = [];
  let index = start + 1;
  while (index < lines.length && !FENCE_END.test(lineAt(lines, index))) {
    body.push(lines[index] ?? '');
    index += 1;
  }
  return { block: { type: 'code', text: body.join('\n') }, next: index + 1 };
}

function readQuote(lines: string[], start: number): Read {
  const parts: string[] = [];
  let index = start;
  for (let match = QUOTE.exec(lineAt(lines, index)); match; match = QUOTE.exec(lineAt(lines, index))) {
    if (match[1]?.trim()) parts.push(match[1].trim());
    index += 1;
  }
  const inlines = parseInlines(parts.join(' '));
  return { block: inlines.length ? { type: 'quote', inlines } : null, next: index };
}

function readList(lines: string[], start: number, ordered: boolean): Read {
  const pattern = ordered ? ORDERED : BULLET;
  const items: Inline[][] = [];
  let index = start;
  for (let match = pattern.exec(lineAt(lines, index)); match; match = pattern.exec(lineAt(lines, index))) {
    items.push(parseInlines((match[1] ?? '').trim()));
    index += 1;
  }
  return { block: { type: 'list', ordered, items }, next: index };
}

function readParagraph(lines: string[], start: number): Read {
  const parts = [squash(lineAt(lines, start))];
  let index = start + 1;
  while (index < lines.length) {
    const line = lineAt(lines, index);
    if (!line || startsBlock(line)) break;
    parts.push(squash(line));
    index += 1;
  }
  // A line break inside a paragraph is the writer's own, so it stays.
  return { block: { type: 'paragraph', inlines: withBreaks(parseInlines(parts.join('\n'))) }, next: index };
}

function readBlock(lines: string[], start: number): Read {
  const line = lineAt(lines, start);
  if (FENCE.test(line)) return readFence(lines, start);
  if (RULE.test(line)) return { block: { type: 'rule' }, next: start + 1 };
  const heading = HEADING.exec(line);
  if (heading) {
    const level = heading[1] === '###' ? 3 : 2;
    return { block: { type: 'heading', level, inlines: parseInlines(heading[2] ?? '') }, next: start + 1 };
  }
  if (QUOTE.test(line)) return readQuote(lines, start);
  if (BULLET.test(line)) return readList(lines, start, false);
  if (ORDERED.test(line)) return readList(lines, start, true);
  return readParagraph(lines, start);
}

/** Parses markdown-lite into blocks. Never throws; unusable input yields an empty list. */
export function parseMarkdownLite(text: string): Block[] {
  try {
    if (typeof text !== 'string') return [];
    const lines = text.slice(0, MAX_INPUT_LENGTH).replace(/\r\n?/g, '\n').split('\n');
    const blocks: Block[] = [];
    let index = 0;
    while (index < lines.length) {
      if (!lineAt(lines, index)) {
        index += 1;
        continue;
      }
      const { block, next } = readBlock(lines, index);
      if (block) blocks.push(block);
      index = Math.max(next, index + 1);
    }
    return blocks;
  } catch {
    return [];
  }
}
