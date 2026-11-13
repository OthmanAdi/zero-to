import { describe, expect, it } from 'vitest';
import { breakLines, clampLines, ellipsize } from './wrap';

describe('line breaking', () => {
  const measure = (text: string) => text.length;

  it('breaks greedily at spaces and after a hyphen or slash', () => {
    expect(breakLines('one two three four', 9, measure)).toEqual(['one two', 'three', 'four']);
    expect(breakLines('well-known/path', 6, measure)).toEqual(['well-', 'known/', 'path']);
  });

  it('balances to the same number of lines with the least spread in length', () => {
    expect(breakLines('How to Live on 24 Hours a Day', 12, measure)).toEqual(['How to Live', 'on 24 Hours', 'a Day']);
    expect(breakLines('How to Live on 24 Hours a Day', 12, measure, { balance: true })).toEqual([
      'How to',
      'Live on 24',
      'Hours a Day',
    ]);
  });

  it('never splits a word to balance', () => {
    expect(breakLines('Commonplace book', 12, measure, { balance: true })).toEqual(['Commonplace', 'book']);
  });

  it('splits a word longer than the line, with a hyphen when it is hyphenated', () => {
    expect(breakLines('Langzeitarchivierung', 8, measure)).toEqual(['Langzeit', 'archivie', 'rung']);
    const hyphenated = breakLines('Langzeitarchivierung', 8, measure, { hyphenate: true });
    expect(hyphenated[0]).toBe('Langzei-');
    expect(hyphenated.join('').replaceAll('-', '')).toBe('Langzeitarchivierung');
  });

  it('clamps to a number of lines with an ellipsis on the last one kept', () => {
    expect(clampLines(['one', 'two', 'three'], 2, 4, measure)).toEqual(['one', 'two…']);
    expect(clampLines(['one', 'two'], 2, 4, measure)).toEqual(['one', 'two']);
    expect(clampLines(['one', 'twofold'], 1, 4, measure)).toEqual(['one…']);
  });

  it('cuts one line with an ellipsis only when it is too long', () => {
    expect(ellipsize('Wikipedia', 20, measure)).toBe('Wikipedia');
    expect(ellipsize('Wikipedia', 5, measure)).toBe('Wiki…');
  });
});
