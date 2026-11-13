import { describe, expect, it } from 'vitest';
import { STAMPS } from '../types';
import { contrast, css, gradientMean, luminance, mix, parseColour, type Rgba } from './colour';
import { FOIL_CONTRAST, isStamped, stampInk, type Part } from './stamp';

const rgb = (text: string): Rgba => parseColour(text)!;

describe('colour', () => {
  it('reads the colour syntaxes a stylesheet and a canvas give', () => {
    expect(parseColour('#a4442a')).toEqual({ r: 164, g: 68, b: 42, a: 1 });
    expect(parseColour(' #fff ')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColour('rgba(0, 0, 0, 0.3)')).toEqual({ r: 0, g: 0, b: 0, a: 0.3 });
    expect(parseColour('rgb(10 20 30 / 50%)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseColour('color(srgb 1 0.5 0)')).toEqual({ r: 255, g: 127.5, b: 0, a: 1 });
    expect(parseColour('oklch(0.5 0.1 20)')).toBeNull();
  });

  it('mixes as color-mix(in srgb) does', () => {
    expect(css(mix(rgb('#ffffff'), rgb('#000000'), 0.7))).toBe('#b3b3b3');
    expect(css(mix(rgb('#c9b78f'), rgb('#efe9dc'), 0.55))).toBe(css(mix(rgb('#efe9dc'), rgb('#c9b78f'), 0.45)));
  });

  it('flattens a gradient to its mean colour', () => {
    const black = rgb('#000');
    const white = rgb('#fff');
    expect(css(gradientMean([{ colour: black, at: 0 }, { colour: white, at: 1 }]))).toBe('#808080');
    // The ends hold their colour beyond the first and last stops.
    expect(css(gradientMean([{ colour: black, at: 0.5 }, { colour: white, at: 0.5 }]))).toBe('#808080');
  });
});

describe('stamps', () => {
  const parts: Part[] = ['ground', 'lettering', 'rule', 'frame', 'device', 'block', 'art', 'label'];

  it('puts lettering, rules, frames and the device on the mask for every stamp but ink', () => {
    for (const stamp of STAMPS) {
      const stamped = parts.filter((part) => isStamped(part, stamp));
      expect(stamped).toEqual(stamp === 'ink' ? [] : ['lettering', 'rule', 'frame', 'device', 'block']);
    }
  });

  it('never stamps the drawing, a pasted label or the cloth', () => {
    for (const stamp of STAMPS) for (const part of ['ground', 'art', 'label'] as const) expect(isStamped(part, stamp)).toBe(false);
  });

  it('prints ink as the lettering colour and presses blind a shade darker than the cloth', () => {
    expect(stampInk('ink', '#a4442a', '#f8eedf')).toBe('#f8eedf');
    const blind = rgb(stampInk('blind', '#a4442a', '#f8eedf'));
    expect(luminance(blind)).toBeLessThan(luminance(rgb('#a4442a')));
    expect(luminance(blind)).toBeGreaterThan(luminance(rgb('#a4442a')) * 0.5);
  });

  it('shows black cloth pressed blind by a trace of its lettering, since it cannot go darker', () => {
    const blind = rgb(stampInk('blind', '#000000', '#ffffff'));
    expect(luminance(blind)).toBeGreaterThan(0);
  });

  it('keeps the foil body on dark cloth and deepens it on pale cloth until it reads', () => {
    expect(stampInk('gold', '#1f1e1b', '#efe9dc')).toBe('#dcb969');
    expect(stampInk('silver', '#17484a', '#efe9dc')).toBe('#c9ccd0');
    for (const stamp of ['gold', 'silver', 'copper', 'holo'] as const) {
      for (const cloth of ['#e4dccb', '#c9982f', '#f0d27e', '#ffc531']) {
        expect(contrast(rgb(stampInk(stamp, cloth, '#1f1e1b')), rgb(cloth))).toBeGreaterThanOrEqual(FOIL_CONTRAST);
      }
    }
  });

  it('gives each metal its own colour', () => {
    const inks = new Set(['gold', 'silver', 'copper', 'holo'].map((stamp) => stampInk(stamp as 'gold', '#1f1e1b', '#fff')));
    expect(inks.size).toBe(4);
  });
});
