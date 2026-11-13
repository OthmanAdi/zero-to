import { describe, expect, it } from 'vitest';
import { advance, fitTitle, linesOf, longestRun, type TitleBox } from './cover-title';

const box: TitleBox = { measure: 79, height: 57, max: 13.6, min: 7.5, leading: 1.04 };
const compound = 'Bundesausbildungsförderungsgesetz';
const hundred = 'Understanding CSS Transforms Module Level 2: 3D Rendering Contexts and Backface Visibility, for Real';
const widths = Array.from({ length: 19 }, (_, step) => 120 + step * 10);

describe('advance', () => {
  it('knows the letters of the title face', () => {
    expect(advance('m')).toBeGreaterThan(advance('n'));
    expect(advance('i')).toBeLessThan(advance('o'));
    expect(advance('W')).toBeGreaterThan(advance('w'));
  });

  it('measures an accented letter as its base letter', () => {
    expect(advance('ö')).toBe(advance('o'));
    expect(advance('É')).toBe(advance('E'));
  });

  it('takes ideographs at full width and unknown characters as wide letters', () => {
    expect(advance('書')).toBe(1);
    expect(advance('Ж')).toBeGreaterThanOrEqual(advance('n'));
  });
});

describe('longestRun', () => {
  it('lets a line break at spaces, after hyphens and after slashes', () => {
    expect(longestRun('Read-only / write-once')).toBeCloseTo(longestRun('write-'), 5);
  });

  it('lets a line break between ideographs', () => {
    expect(longestRun('読書の記録')).toBe(1);
  });
});

describe('fitTitle', () => {
  it('sets a short title at the largest size', () => {
    expect(fitTitle('CSS', box)).toEqual({ size: 13.6, lines: 1, clamp: 4, broken: false });
  });

  it('sets a longer title smaller than a short one, even when both would fit', () => {
    expect(fitTitle('Keeping a Commonplace Book: Notes on Reading Slowly', box).size).toBeLessThan(fitTitle('How to Read a Paper', box).size);
  });

  it('is deterministic', () => {
    expect(fitTitle(hundred, box)).toEqual(fitTitle(hundred, box));
  });

  it('shrinks a title until its longest word fits the line', () => {
    const fit = fitTitle('Commonplace', { ...box, measure: 60 });
    expect(longestRun('Commonplace') * fit.size).toBeLessThanOrEqual(60);
    expect(fit.broken).toBe(false);
  });

  it('hyphenates a 33-letter German compound at the smallest size instead of cutting it', () => {
    expect([...compound].length).toBe(33);
    const fit = fitTitle(compound, box);
    expect(fit.size).toBe(box.min);
    expect(fit.broken).toBe(true);
    expect(fit.lines).toBeGreaterThan(1);
    expect(fit.lines).toBeLessThanOrEqual(fit.clamp);
  });

  it('fits a 100-character title whole, with no word broken', () => {
    expect(hundred.length).toBe(100);
    const fit = fitTitle(hundred, box);
    expect(fit.broken).toBe(false);
    expect(fit.size).toBeGreaterThanOrEqual(box.min);
    expect(fit.lines).toBeLessThanOrEqual(fit.clamp);
    expect(fit.lines * fit.size * box.leading).toBeLessThanOrEqual(box.height);
  });

  it.each([compound, hundred, `Was ab 2025 gilt: ${compound}`])('never sets %s below 9 px from 120 to 300 px wide', (title) => {
    const fit = fitTitle(title, box);
    for (const width of widths) {
      const px = (fit.size * width) / 100;
      const measure = (box.measure * width) / 100;
      expect(px).toBeGreaterThanOrEqual(9);
      if (!fit.broken) expect(longestRun(title) * px).toBeLessThanOrEqual(measure);
      expect(linesOf(title, px, measure)).toBe(fit.lines);
    }
  });

  it('keeps a title with a long compound among short words inside its box', () => {
    const fit = fitTitle(`Was ab 2025 gilt: ${compound}`, box);
    expect(fit.broken).toBe(true);
    expect(fit.lines * fit.size * box.leading).toBeLessThanOrEqual(box.height);
  });

  it('handles an empty title', () => {
    expect(fitTitle('', box).size).toBe(box.max);
  });
});
