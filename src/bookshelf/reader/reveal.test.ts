import { describe, expect, it } from 'vitest';
import { CONTENT_START, SHEET_FADE_END, SHEET_FADE_START, revealFrame } from './reveal';

describe('revealFrame', () => {
  it('is closed and transparent at 0, open and clear at 1', () => {
    expect(revealFrame(0)).toEqual({ closed: true, open: false, opacity: '0', content: false });
    expect(revealFrame(1)).toEqual({ closed: false, open: true, opacity: '', content: true });
  });

  it('keeps the sheet transparent until the fade window starts', () => {
    expect(revealFrame(SHEET_FADE_START).opacity).toBe('0');
    expect(revealFrame(0.05).opacity).toBe('0');
  });

  it('fades linearly across the window and is opaque at its end', () => {
    const middle = (SHEET_FADE_START + SHEET_FADE_END) / 2;
    expect(Number(revealFrame(middle).opacity)).toBeCloseTo(0.5, 3);
    expect(revealFrame(SHEET_FADE_END).opacity).toBe('1');
    expect(revealFrame(0.9).opacity).toBe('1');
  });

  it('starts the text after the sheet is nearly opaque', () => {
    expect(SHEET_FADE_END).toBeGreaterThan(CONTENT_START);
    expect(revealFrame(CONTENT_START - 0.01).content).toBe(false);
    expect(revealFrame(CONTENT_START).content).toBe(true);
  });

  it('is the same function in both directions', () => {
    expect(revealFrame(0.4)).toEqual(revealFrame(0.4));
  });

  it('shows everything from the first frame with reduced motion and leaves the fade to the stylesheet', () => {
    expect(revealFrame(0.01, true)).toEqual({ closed: false, open: false, opacity: '1', content: true });
    expect(revealFrame(0, true).closed).toBe(true);
  });

  it('survives values that are not numbers', () => {
    expect(revealFrame(Number.NaN).closed).toBe(true);
    expect(revealFrame(5).open).toBe(true);
    expect(revealFrame(-2).closed).toBe(true);
  });
});
