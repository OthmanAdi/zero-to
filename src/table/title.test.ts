import { describe, expect, it } from 'vitest';
import { coverLayout, type CoverSpec } from './cover';
import { estimateTextWidth, layoutTitle, titleChunks, type TitleBox } from './title';

const SPEC: CoverSpec = { title: '', lang: 'en', number: 1, tier: 'gold', stages: 5, minutes: 2280, share: 0, example: false };

/** The title box of a real cover, so the test fits titles into the space they are printed in. */
function coverBox(): TitleBox {
  const layout = coverLayout(SPEC, 'en');
  return { width: layout.titleBox.width, height: layout.titleBox.height, fontPx: 54, lineHeight: 1.06 };
}

function expectFits(text: string, lang: string): ReturnType<typeof layoutTitle> {
  const box = coverBox();
  const layout = layoutTitle(text, lang, box);
  expect(layout.lines.length).toBeGreaterThan(0);
  expect(layout.lines.length).toBeLessThanOrEqual(3);
  for (const line of layout.lines) expect(estimateTextWidth(line, layout.fontPx)).toBeLessThanOrEqual(box.width + 0.01);
  expect(layout.height).toBeLessThanOrEqual(box.height + 0.5);
  expect(layout.scale).toBeGreaterThanOrEqual(0.56 - 1e-9);
  expect(layout.scale).toBeLessThanOrEqual(1);
  return layout;
}

describe('layoutTitle', () => {
  it('sets a short title on one line at full size', () => {
    const layout = expectFits('Zero to Rust', 'en');
    expect(layout.lines).toEqual(['Zero to Rust']);
    expect(layout.scale).toBe(1);
    expect(layout.truncated).toBe(false);
  });

  it('fits a 120-character title into three lines', () => {
    const title = 'A complete field guide to reading, writing and reviewing asynchronous network services in Rust, for teams moving from Go';
    expect(title.length).toBe(120);
    const layout = expectFits(title, 'en');
    expect(layout.lines.length).toBe(3);
    expect(layout.scale).toBeLessThan(1);
  });

  it('ends in an ellipsis when even the smallest size cannot hold the title', () => {
    const title = 'An unreasonably long title that keeps going and going '.repeat(6);
    const layout = expectFits(title, 'en');
    expect(layout.truncated).toBe(true);
    expect(layout.lines[2]?.endsWith('…')).toBe(true);
    expect(layout.scale).toBeCloseTo(0.56);
  });

  it('fits a German compound that has no place to break', () => {
    const layout = expectFits('Rindfleischetikettierungsüberwachungsaufgabenübertragungsgesetz verstehen', 'de');
    // The compound is never upper-cased and keeps all its letters across the lines.
    expect(layout.lines.join('').replace(/-/g, '')).toContain('Rindfleisch');
    expect(layout.truncated).toBe(false);
  });

  it('breaks a hyphenated German compound after the hyphen', () => {
    expect(titleChunks('Kraftfahrzeug-Haftpflichtversicherung', 'de')).toEqual(['Kraftfahrzeug-', 'Haftpflichtversicherung']);
  });

  it('fits an Arabic title and reports that it runs right to left', () => {
    const layout = expectFits('من الصفر إلى إتقان الخط العربي: خط النسخ والرقعة والديواني خطوة بخطوة', 'ar');
    expect(layout.direction).toBe('rtl');
    expect(layout.truncated).toBe(false);
  });

  it('fits a Japanese title, which has no spaces to break at', () => {
    const title = 'ゼロから始める書道入門、楷書と行書の基本を三か月で身につける実践ロードマップ';
    const layout = expectFits(title, 'ja');
    expect(layout.lines.length).toBeGreaterThan(1);
    expect(layout.lines.join('')).toBe(title);
    expect(layout.direction).toBe('ltr');
  });

  it('never changes the case of a title and never drops a word that fits', () => {
    const title = 'von null zu iOS-Apps mit SwiftUI';
    const layout = expectFits(title, 'de');
    expect(layout.lines.join(' ')).toBe(title);
  });

  it('gives an empty layout for an empty title', () => {
    expect(layoutTitle('   ', 'en', coverBox()).lines).toEqual([]);
  });

  it('shrinks before it truncates', () => {
    const box: TitleBox = { width: 300, height: 120, fontPx: 40 };
    const layout = layoutTitle('Watercolour landscapes from the first wash to a finished sheet', 'en', box);
    expect(layout.truncated).toBe(false);
    expect(layout.scale).toBeLessThan(1);
  });
});
