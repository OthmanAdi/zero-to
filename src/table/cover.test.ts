import { describe, expect, it } from 'vitest';
import { missingKeys } from '../i18n';
import { THEME } from '../look/theme';
import deutsch from '../roadmap/samples/deutsch-a1-von-null.json';
import langgraph from '../roadmap/samples/langgraph-for-a-python-dev.json';
import music from '../roadmap/samples/music-theory-for-a-class.json';
import photography from '../roadmap/samples/photography-basics.json';
import rust from '../roadmap/samples/rust-for-a-python-dev.json';
import statistics from '../roadmap/samples/statistics-for-data-work.json';
import type { Roadmap } from '../roadmap/types';
import { TIER_NAMES } from '../scene/palette';
import { COVER, COVER_EYE, COVER_REACH, FIELD_OFFSET, clearTitle, coverLayout, coverReach, type CoverLayout, type CoverSpec } from './cover';
import { GROW } from './grow';
import { deriveSheet, tracePrint } from './sheet-data';
import { TABLE_STRINGS } from './strings';
import { estimateTextWidth } from './title';

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

const GALLERY = [photography, rust, deutsch, music, statistics, langgraph] as unknown as Roadmap[];

function specOf(roadmap: Roadmap, number: number): CoverSpec {
  const data = deriveSheet({ roadmap, example: true });
  return { title: roadmap.title, lang: roadmap.lang, number, tier: data.tier, stages: data.stageCount, minutes: data.totalMinutes, share: 0, example: true };
}

/** Every line of a title, as a box: where it runs across the cover and where its line ends below. */
function lineBoxes(layout: CoverLayout): { x0: number; x1: number; bottom: number }[] {
  const { title, titleBox } = layout;
  return title.lines.map((line, index) => {
    const width = estimateTextWidth(line, title.fontPx);
    const x0 = title.direction === 'rtl' ? titleBox.x + titleBox.width - width : title.x;
    return { x0, x1: x0 + width, bottom: title.y + (index + 1) * title.lineHeightPx };
  });
}

/** The highest point of a reach over a stretch of the cover. */
function highest(reach: ArrayLike<number>, x0: number, x1: number): number {
  const width = COVER.width / reach.length;
  let top: number = COVER.height;
  for (let column = Math.max(0, Math.floor(x0 / width)); column <= Math.min(reach.length - 1, Math.floor(x1 / width)); column += 1) top = Math.min(top, reach[column] as number);
  return top;
}

describe('the title and the mountain', () => {
  it('leaves 0.2 of the top band between the title and the field, and the data row inside the stamped frame', () => {
    const layout = coverLayout(SPEC, 'en');
    expect((layout.field.y - (layout.titleBox.y + layout.titleBox.height)) / (COVER.height / COVER.body.depth)).toBeGreaterThan(0.2);
    expect(layout.rule).toBeGreaterThan(layout.field.y + layout.field.height + 4);
    expect(layout.percent.y).toBeLessThan(COVER.height - 13 - 8);
    for (const item of layout.data) expect(item.y).toBeLessThan(layout.bar.y - 8);
  });

  it('works out how far up the cover a standing mountain reaches, from the field toward the top', () => {
    const data = deriveSheet({ roadmap: GALLERY[0] as Roadmap });
    const reach = coverReach(tracePrint(data, false));
    const layout = coverLayout(SPEC, 'en');
    expect(reach.length).toBe(COVER_REACH.columns);
    const top = Math.min(...reach);
    expect(top).toBeLessThan(layout.field.y);
    expect(top).toBeGreaterThan(layout.titleBox.y);
    // Seen from lower down, the same mountain reaches further up.
    const lower = coverReach(tracePrint(data, false), { ...COVER_EYE, y: COVER_EYE.y * 0.8 });
    expect(Math.min(...lower)).toBeLessThan(top);
  });

  it('keeps the title a cover would print when the mountain stays clear of it', () => {
    const layout = coverLayout(SPEC, 'en');
    const clear = new Float64Array(COVER_REACH.columns).fill(COVER.height);
    expect(clearTitle(layout, SPEC, clear)).toBe(layout);
  });

  it('moves a title up, then shrinks it, until every line clears the mountain where that line runs', () => {
    const layout = coverLayout(SPEC, 'en');
    // A mountain that reaches into the foot of the title box all across the cover.
    const reach = new Float64Array(COVER_REACH.columns).fill(layout.titleBox.y + layout.titleBox.height - 2);
    const fitted = clearTitle(layout, SPEC, reach);
    expect(fitted).not.toBe(layout);
    for (const box of lineBoxes(fitted)) expect(box.bottom + COVER_REACH.gap).toBeLessThanOrEqual(highest(reach, box.x0, box.x1) + 0.5);
    expect(fitted.title.y).toBeGreaterThanOrEqual(fitted.titleBox.y - 0.5);
    expect(fitted.title.scale).toBeGreaterThanOrEqual(0.56 - 1e-9);
    // A mountain that leaves room for one small line only: the title keeps to it and ends in an ellipsis.
    const tall = new Float64Array(COVER_REACH.columns).fill(layout.titleBox.y + 40);
    const long = { ...SPEC, title: 'A very long title about a very long subject '.repeat(3) };
    const squeezed = clearTitle(coverLayout(long, 'en'), long, tall);
    expect(squeezed.title.lines.length).toBe(1);
    expect(squeezed.title.truncated).toBe(true);
  });

  it('keeps every gallery title clear of its own mountain, desktop and phone print alike', () => {
    GALLERY.forEach((roadmap, index) => {
      const spec = specOf(roadmap, index + 1);
      for (const phone of [false, true]) {
        const reach = coverReach(tracePrint(deriveSheet({ roadmap, example: true }), phone));
        const fitted = clearTitle(coverLayout(spec, 'en'), spec, reach);
        expect(fitted.title.truncated, roadmap.title).toBe(false);
        expect(fitted.title.scale, roadmap.title).toBeGreaterThanOrEqual(0.64);
        for (const box of lineBoxes(fitted)) expect(box.bottom + COVER_REACH.gap, roadmap.title).toBeLessThanOrEqual(highest(reach, box.x0 - 4, box.x1 + 4) + 0.5);
      }
    });
  });
});

describe('strings', () => {
  it('has every key in English and in German', () => {
    expect(missingKeys(TABLE_STRINGS)).toEqual([]);
  });
});
