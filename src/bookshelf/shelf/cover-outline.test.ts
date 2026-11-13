import { describe, expect, it } from 'vitest';
import { cleanOutline, OUTLINE_LIMIT, outlineOf } from './cover-outline';

describe('outlineOf', () => {
  it('gives nothing for an empty text', () => {
    expect(outlineOf('')).toEqual([]);
    expect(outlineOf('  \n\n \t ')).toEqual([]);
  });

  it('gives one value per paragraph, the longest as 1', () => {
    expect(outlineOf('aaaa\n\naa\n\naaaaaaaa')).toEqual([0.5, 0.25, 1]);
  });

  it('gives a heading as a negative value', () => {
    expect(outlineOf('## Four\n\nEight ch')).toEqual([-0.5, 1]);
  });

  it('reads headings the way the reader does', () => {
    expect(outlineOf('#tag here\n\n#### deep').every((value) => value > 0)).toBe(true);
    expect(outlineOf('intro text\n## Next')).toEqual([1, -0.4]);
  });

  it('counts what a reader sees, not markup or link addresses', () => {
    const [link, plain] = outlineOf('[word](https://example.org/a/very/long/address)\n\nword');
    expect(link).toBe(plain);
    expect(outlineOf('**bold** text\n\nbold text')).toEqual([1, 1]);
  });

  it('keeps the lines of one paragraph together', () => {
    expect(outlineOf('one line\nand another\n\nshort')).toHaveLength(2);
  });

  it('reads a text pasted one paragraph to a line a line at a time', () => {
    expect(outlineOf('First paragraph here.\nSecond one.\nThird, the longest of them all.')).toHaveLength(3);
  });

  it('treats Windows line endings like any other', () => {
    expect(outlineOf('aaaa\r\n\r\naa')).toEqual([1, 0.5]);
  });

  it('skips rules and code fences but counts the code', () => {
    expect(outlineOf('text\n\n---\n\n```\ncode\n```')).toEqual([1, 1]);
  });

  it('keeps at most the first page of paragraphs', () => {
    const text = Array.from({ length: 40 }, (_, index) => 'word '.repeat(index + 1)).join('\n\n');
    const outline = outlineOf(text);
    expect(outline).toHaveLength(OUTLINE_LIMIT);
    expect(outline.at(-1)).toBe(1);
    expect(outlineOf(text, 5)).toHaveLength(5);
  });

  it('never gives zero, so a very short paragraph still prints', () => {
    const outline = outlineOf(`a\n\n${'x'.repeat(500)}`);
    expect(outline[0]).toBeGreaterThan(0);
    expect(outline.every((value) => Math.abs(value) <= 1)).toBe(true);
  });
});

describe('cleanOutline', () => {
  it('keeps finite values within -1 to 1, drops the rest and caps the count', () => {
    expect(cleanOutline([0.5, Number.NaN, 2, -3, 0, Infinity])).toEqual([0.5, 1, -1]);
    expect(cleanOutline(Array.from({ length: 30 }, () => 0.5))).toHaveLength(OUTLINE_LIMIT);
    expect(cleanOutline(undefined)).toEqual([]);
    expect(cleanOutline(['a', null] as unknown[])).toEqual([]);
  });
});
