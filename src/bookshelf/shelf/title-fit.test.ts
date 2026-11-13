import { beforeEach, describe, expect, it } from 'vitest';
import { fitTitle, forgetTitleWidths, measureTitle, type TitleFont } from './title-fit';

const serif: TitleFont = { family: 'Georgia, serif', weight: '600', letterSpacing: 0, upper: false };
const mono: TitleFont = { family: '"Some Mono", monospace', weight: '500', letterSpacing: 0.06, upper: true };

beforeEach(() => forgetTitleWidths());

describe('measureTitle', () => {
  it('grows with the text and with letter spacing', () => {
    expect(measureTitle('Margins and notes', serif)).toBeGreaterThan(measureTitle('Margins', serif));
    expect(measureTitle('Margins', { ...serif, letterSpacing: 0.1 })).toBeGreaterThan(measureTitle('Margins', serif));
  });

  it('measures a soft hyphen as nothing', () => {
    expect(measureTitle('Barriere­freiheit', serif)).toBe(measureTitle('Barrierefreiheit', serif));
  });
});

describe('fitTitle', () => {
  it('sets a short title on one line at the largest size the spine allows', () => {
    const fit = fitTitle('Link rot', { length: 300, breadth: 58 }, serif);
    expect(fit.lines).toEqual(['Link rot']);
    expect(fit.size).toBeCloseTo(0.34 * 58, 9);
    expect(fit.clipped).toBe(false);
  });

  it('shrinks a longer title to fit along the spine', () => {
    const title = 'A Field Guide to the Margins of Books';
    const fit = fitTitle(title, { length: 260, breadth: 58 }, serif);
    expect(fit.lines).toHaveLength(1);
    expect(fit.size * measureTitle(title, serif)).toBeLessThanOrEqual(260 + 1e-9);
    expect(fit.size).toBeGreaterThanOrEqual(11);
  });

  it('sets a long title on two balanced lines on a wide spine instead of shrinking it below 11 px', () => {
    const title = 'Web Content Accessibility Guidelines (WCAG) 2.2, Understanding Success Criteria';
    const fit = fitTitle(title, { length: 240, breadth: 70 }, serif);
    expect(fit.lines).toHaveLength(2);
    expect(fit.clipped).toBe(false);
    expect(fit.size).toBeGreaterThanOrEqual(9);
    const [first, second] = fit.lines.map((line) => measureTitle(line, serif));
    expect(Math.max(first!, second!) * fit.size).toBeLessThanOrEqual(240 + 1e-9);
    expect(Math.abs(first! - second!) / Math.max(first!, second!)).toBeLessThan(0.35);
    expect(fit.lines.join(' ')).toBe(title);
  });

  it('keeps a narrow spine on one line', () => {
    const fit = fitTitle('Web Content Accessibility Guidelines Understanding Success Criteria', { length: 240, breadth: 36 }, serif);
    expect(fit.lines).toHaveLength(1);
  });

  it('never breaks a compound word except at a hyphenation point', () => {
    const word = 'Barrierefreiheitsstärkungsgesetzbegründung';
    const plain = fitTitle(word, { length: 150, breadth: 70 }, serif);
    expect(plain.lines).toEqual([word]);
    const marked = fitTitle('Barrierefreiheits­stärkungs­gesetzbegründung', { length: 150, breadth: 70 }, serif);
    expect(marked.lines).toHaveLength(2);
    expect(marked.lines[0]!.endsWith('-')).toBe(true);
    expect(marked.lines.join('').replace('-', '')).toBe(word);
  });

  it('breaks after a hyphen that is part of the title', () => {
    const fit = fitTitle('Langzeitarchivierung-Grundlagen-Handreichung', { length: 150, breadth: 70 }, serif);
    expect(fit.lines).toHaveLength(2);
    expect(fit.lines[0]!.endsWith('-')).toBe(true);
  });

  it('clips only as the last resort, and never below 9 px', () => {
    const fit = fitTitle('An extraordinarily long title that cannot possibly fit anywhere on this spine', { length: 120, breadth: 30 }, serif);
    expect(fit.clipped).toBe(true);
    expect(fit.size).toBe(9);
  });

  it('measures capitals for a face set in capitals, and keeps the text as written', () => {
    const fit = fitTitle('What is a URL?', { length: 300, breadth: 36 }, mono);
    expect(fit.lines).toEqual(['What is a URL?']);
    expect(measureTitle('abc', mono)).toBe(measureTitle('ABC', mono));
  });
});
