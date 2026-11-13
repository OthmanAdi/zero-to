import { describe, expect, it } from 'vitest';
import { missingKeys } from '../i18n';
import { THEME } from '../look/theme';
import { TIER_NAMES } from '../scene/palette';
import { COVER, FIELD_OFFSET, coverLayout, type CoverSpec } from './cover';
import { GROW } from './grow';
import { TABLE_STRINGS } from './strings';

const SPEC: CoverSpec = {
  title: 'Zero to Rust, coming from Python',
  lang: 'en',
  number: 1,
  tier: 'gold',
  stages: 5,
  minutes: 2280,
  share: 0.25,
  example: false,
};

/** Durations are set with no-break spaces; the tests compare the words. */
const plain = (text: string): string => text.replace(/\s/gu, ' ');

describe('coverLayout', () => {
  it('stacks the top band, the field and the data row inside the canvas', () => {
    const layout = coverLayout(SPEC, 'en');
    expect(layout.width).toBe(690);
    expect(layout.height).toBe(920);
    expect(layout.titleBox.y + layout.titleBox.height).toBeLessThanOrEqual(layout.field.y);
    expect(layout.field.y + layout.field.height).toBeLessThanOrEqual(layout.rule);
    for (const item of layout.data) expect(item.y).toBeGreaterThan(layout.field.y + layout.field.height);
    expect(layout.bar.y + layout.bar.height).toBeLessThan(layout.height - 10);
    expect(layout.title.y).toBeGreaterThanOrEqual(layout.titleBox.y - 0.5);
    expect(layout.title.y + layout.title.height).toBeLessThanOrEqual(layout.titleBox.y + layout.titleBox.height + 0.5);
  });

  it('gives the mountain a square of 3.68 scene units with the paper inside it', () => {
    const layout = coverLayout(SPEC, 'en');
    expect((layout.field.width / COVER.width) * COVER.body.width).toBeCloseTo(GROW.size);
    expect((layout.field.height / COVER.height) * COVER.body.depth).toBeCloseTo(GROW.size);
    expect(layout.paper.x).toBeGreaterThan(layout.field.x);
    expect(layout.paper.width).toBeLessThan(layout.field.width);
    // The field is centred across and sits a little below the middle of the sheet.
    expect(layout.field.x + layout.field.width / 2).toBeCloseTo(COVER.width / 2);
    const middle = ((layout.field.y + layout.field.height / 2) / COVER.height - 0.5) * COVER.body.depth;
    expect(middle).toBeCloseTo(FIELD_OFFSET);
    expect(FIELD_OFFSET).toBeGreaterThan(0);
  });

  it('takes its cloth from the target tier', () => {
    for (const tier of TIER_NAMES) expect(coverLayout({ ...SPEC, tier }, 'en').board).toBe(THEME.cover[tier]);
  });

  it('prints the number, the stages, the hours and the tier in the interface language', () => {
    const en = coverLayout(SPEC, 'en');
    expect(en.number.text).toBe('NO. 01');
    expect(en.data.map((item) => plain(item.text))).toEqual(['5 STAGES', 'ABOUT 38 H', 'TO GOLD', 'EN']);
    expect(en.percent.text).toBe('25 %');
    const de = coverLayout({ ...SPEC, number: 3, lang: 'de-DE' }, 'de');
    expect(de.number.text).toBe('NR. 03');
    expect(de.data.map((item) => plain(item.text))).toEqual(['5 ETAPPEN', 'CA. 38 STD.', 'BIS GOLD', 'DE']);
  });

  it('never upper-cases the title', () => {
    const layout = coverLayout({ ...SPEC, title: 'von null zu iOS' }, 'de');
    expect(layout.title.lines.join(' ')).toBe('von null zu iOS');
  });

  it('marks a gallery example and leaves the mark off a person’s own roadmap', () => {
    expect(coverLayout(SPEC, 'en').example).toBeNull();
    expect(coverLayout({ ...SPEC, example: true }, 'en').example?.text).toBe('EXAMPLE');
    expect(coverLayout({ ...SPEC, example: true }, 'de').example?.text).toBe('BEISPIEL');
  });

  it('keeps the walked share inside the bar', () => {
    expect(coverLayout({ ...SPEC, share: 3 }, 'en').bar.share).toBe(1);
    expect(coverLayout({ ...SPEC, share: -1 }, 'en').bar.share).toBe(0);
    expect(coverLayout({ ...SPEC, share: Number.NaN }, 'en').percent.text).toMatch(/%$/);
  });

  it('fits a title of any length into the title box', () => {
    const long = coverLayout({ ...SPEC, title: 'A very long title about a very long subject '.repeat(5) }, 'en');
    expect(long.title.lines.length).toBeLessThanOrEqual(3);
    expect(long.title.height).toBeLessThanOrEqual(long.titleBox.height + 0.5);
  });
});

describe('strings', () => {
  it('has every key in English and in German', () => {
    expect(missingKeys(TABLE_STRINGS)).toEqual([]);
  });
});
