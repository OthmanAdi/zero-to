import { describe, expect, it } from 'vitest';
import { missingKeys } from '../i18n';
import { ARM_TEXT, breakPieces, layoutArmText, type Measure } from './arm-text';
import { stageBoardText } from './board';
import { DESIGN } from './brush';
import { ARM, armLength, armSwingAt } from './signpost';
import {
  DEFAULT_SIGNPOST,
  MAX_ARMS,
  SIGNPOSTS,
  SIGNPOST_CATALOGUE,
  SIGNPOST_KEYS,
  THEME_SIGNPOSTS,
  isSignpostKey,
  resolveSignpost,
  signpostStyle,
} from './signposts';
import { PROPS_STRINGS } from './strings';

describe('signpost styles', () => {
  it('are the seven a roadmap can choose, with timber as the default', () => {
    expect([...SIGNPOST_KEYS]).toEqual(['timber', 'cairn', 'trig-pillar', 'blaze-post', 'snow-pole', 'buoy', 'summit-flag']);
    expect(Object.keys(SIGNPOSTS).sort()).toEqual([...SIGNPOST_KEYS].sort());
    expect(DEFAULT_SIGNPOST).toBe('timber');
    for (const key of SIGNPOST_KEYS) {
      const style = SIGNPOSTS[key];
      expect(style.key).toBe(key);
      expect(typeof style.draw).toBe('function');
      expect(typeof style.arms).toBe('function');
      expect(style.size.width).toBeGreaterThan(0.2);
      expect(style.size.height).toBeGreaterThan(0.9);
      expect(style.size.height).toBeLessThan(1.5);
    }
  });

  it('answers an unknown key with timber', () => {
    expect(signpostStyle('lighthouse')).toBe(SIGNPOSTS.timber);
    expect(signpostStyle(undefined)).toBe(SIGNPOSTS.timber);
    expect(signpostStyle(null)).toBe(SIGNPOSTS.timber);
    expect(signpostStyle('')).toBe(SIGNPOSTS.timber);
    expect(signpostStyle('toString')).toBe(SIGNPOSTS.timber);
    expect(signpostStyle('buoy')).toBe(SIGNPOSTS.buoy);
    expect(isSignpostKey('snow-pole')).toBe(true);
    expect(isSignpostKey('constructor')).toBe(false);
  });

  it('resolves in the order checkpoint, map, theme, timber', () => {
    expect(resolveSignpost('cairn', 'buoy', 'alpine-winter')).toBe('cairn');
    expect(resolveSignpost(undefined, 'buoy', 'alpine-winter')).toBe('buoy');
    expect(resolveSignpost('nonsense', 'buoy', 'alpine-winter')).toBe('buoy');
    expect(resolveSignpost(undefined, undefined, 'alpine-winter')).toBe('snow-pole');
    expect(resolveSignpost(undefined, 'nonsense', 'coastal-survey')).toBe('buoy');
    expect(resolveSignpost(undefined, undefined, 'desert-expedition')).toBe('cairn');
    expect(resolveSignpost(undefined, undefined, 'classic-topo')).toBe('timber');
    expect(resolveSignpost(undefined, undefined, 'unknown-theme')).toBe('timber');
    expect(resolveSignpost()).toBe('timber');
    for (const key of Object.values(THEME_SIGNPOSTS)) expect(isSignpostKey(key)).toBe(true);
  });

  it('gives n anchors for 1 to 5 arms, none overlapping, all on the mast', () => {
    for (const key of SIGNPOST_KEYS) {
      const style = SIGNPOSTS[key];
      for (let n = 1; n <= MAX_ARMS; n += 1) {
        const anchors = style.arms(n);
        expect(anchors, `${key} ${n}`).toHaveLength(n);
        for (const anchor of anchors) {
          expect(anchor.height, `${key} ${n}`).toBeGreaterThan(0.085);
          expect(anchor.height).toBeLessThanOrEqual(style.arm.height + 1e-9);
          expect(anchor.reach).toBeGreaterThan(0.5);
          expect(anchor.y - anchor.height / 2, `${key} ${n} foot`).toBeGreaterThan(0.04);
          expect(anchor.y + anchor.height / 2, `${key} ${n} top`).toBeLessThan(style.size.height);
          expect(Math.abs(anchor.x)).toBeLessThan(style.size.width / 2);
        }
        for (let i = 1; i < anchors.length; i += 1) {
          const upper = anchors[i - 1]!;
          const lower = anchors[i]!;
          const gap = upper.y - upper.height / 2 - (lower.y + lower.height / 2);
          expect(gap, `${key} ${n} arms ${i - 1} and ${i}`).toBeGreaterThan(0.015);
        }
      }
    }
  });

  it('holds the number of arms to 1 to 5 whatever is asked', () => {
    const style = SIGNPOSTS.timber;
    expect(style.arms(0)).toHaveLength(1);
    expect(style.arms(-2)).toHaveLength(1);
    expect(style.arms(9)).toHaveLength(5);
    expect(style.arms(Number.NaN)).toHaveLength(1);
    expect(style.arms(2.6)).toHaveLength(3);
  });

  it('swings an arm half a turn, and lets the stop take most of an overshoot', () => {
    expect(armSwingAt(0)).toBeCloseTo(Math.PI);
    expect(armSwingAt(1)).toBeCloseTo(0);
    expect(armSwingAt(0.5)).toBeCloseTo(Math.PI / 2);
    // A spring of 120 / 9 passes its target by about a quarter. The arm passes the stop by far less.
    expect(armSwingAt(1.24)).toBeLessThan(0);
    expect(armSwingAt(1.24)).toBeGreaterThan(-0.3);
    expect(armSwingAt(-0.24)).toBeGreaterThan(Math.PI);
    expect(armSwingAt(-0.24)).toBeLessThan(Math.PI + 0.3);
    // The difference between ticked and not ticked is far more than the 25 degrees a glance needs.
    expect(((armSwingAt(0) - armSwingAt(1)) * 180) / Math.PI).toBeGreaterThanOrEqual(25);
    expect(ARM.swing).toEqual({ k: 120, c: 9 });
  });

  it('keeps an arm long enough for one word and no longer than its reach', () => {
    for (const key of SIGNPOST_KEYS) {
      const { arm } = SIGNPOSTS[key];
      const h = arm.height * DESIGN;
      const reach = arm.reach * DESIGN;
      expect(armLength(0, h, arm, reach)).toBeCloseTo(h * ARM.shortest);
      expect(armLength(10_000, h, arm, reach)).toBe(reach);
      const middle = armLength(20, h, arm, reach);
      expect(middle).toBeGreaterThan(h * ARM.shortest - 1e-9);
      expect(middle).toBeLessThanOrEqual(reach);
      expect(armLength(30, h, arm, reach)).toBeGreaterThanOrEqual(middle);
    }
  });
});

describe('the signpost catalogue', () => {
  it('describes every style in plain words in both languages', () => {
    expect(SIGNPOST_CATALOGUE.map((entry) => entry.key)).toEqual([...SIGNPOST_KEYS]);
    expect(SIGNPOST_CATALOGUE.filter((entry) => entry.default).map((entry) => entry.key)).toEqual(['timber']);
    for (const entry of SIGNPOST_CATALOGUE) {
      for (const lang of ['en', 'de'] as const) {
        expect(entry.name[lang].length, entry.key).toBeGreaterThan(3);
        expect(entry.description[lang].length, entry.key).toBeGreaterThan(60);
        expect(entry.description[lang].length, entry.key).toBeLessThan(220);
        // Plain prose: no dash used as a pause, no markup.
        expect(entry.description[lang]).not.toMatch(/[–—<>*_]| - /);
      }
      expect(entry.surfaces.length).toBeGreaterThan(0);
    }
    expect(new Set(SIGNPOST_CATALOGUE.map((entry) => entry.name.en)).size).toBe(SIGNPOST_CATALOGUE.length);
  });
});

describe('props strings', () => {
  it('have the same keys and placeholders in English and German', () => {
    expect(Object.keys(PROPS_STRINGS.de).sort()).toEqual(Object.keys(PROPS_STRINGS.en).sort());
    expect(missingKeys(PROPS_STRINGS)).toEqual([]);
  });

  it('never score or scold', () => {
    const banned = /\b(behind|streaks?|badges?|score|points|failed|wrong|hinterher|versagt|falsch|Punkte|Abzeichen)\b/i;
    for (const text of [...Object.values(PROPS_STRINGS.en), ...Object.values(PROPS_STRINGS.de)]) expect(banned.test(text), text).toBe(false);
  });

  it('fill the stage board in the interface language', () => {
    const en = stageBoardText({ index: 2, count: 5, minutes: 360, practiceMinutes: 252, tier: 'gold', tierUp: true }, 'en');
    expect(en.kicker).toBe('Stage 2 of 5');
    expect(en.title).toMatch(/^about 6/);
    expect(en.lines).toEqual(['70 % hands-on']);
    expect(en.tierLabel).toBe('Gold');
    expect(en.plate).toBe('Up to Gold');
    expect(en.passed).toBe('Passed');
    const de = stageBoardText({ index: 1, count: 3, minutes: 90, practiceMinutes: 0, tier: 'silver' }, 'de');
    expect(de.kicker).toBe('Etappe 1 von 3');
    expect(de.title).toMatch(/^ca\. 1,5/);
    expect(de.lines).toEqual(['0 % Praxis']);
    expect(de.tierLabel).toBe('Silber');
    expect(de.plate).toBeUndefined();
    expect(stageBoardText({ index: 1, count: 1, minutes: 0, practiceMinutes: 30, tier: 'bronze' }, 'en').lines).toEqual(['0 % hands-on']);
  });
});

describe('arm text', () => {
  /** Every character is half its size wide, so widths can be worked out by hand. */
  const measure: Measure = (text, size) => Array.from(text).length * size * 0.5;
  const box = { width: 60, height: 12 };
  const fits = (text: string) => {
    const layout = layoutArmText(text, box, measure, 'en');
    for (const line of layout.lines) expect(measure(line, layout.size), `"${line}"`).toBeLessThanOrEqual(box.width + 1e-6);
    return layout;
  };

  it('sets a short item on one line at full size', () => {
    const layout = fits('Read a staff');
    expect(layout.lines).toEqual(['Read a staff']);
    expect(layout.size).toBeCloseTo(box.height * ARM_TEXT.oneLine);
    expect(layout.truncated).toBe(false);
  });

  it('shrinks an item that is a little too long, and keeps it whole', () => {
    // 24 characters at size 6 are 72 wide: 60 / 72 is 0.83, above the limit of one line.
    const layout = fits('Name the notes of C majo');
    expect(layout.lines).toHaveLength(1);
    expect(layout.size).toBeLessThan(box.height * ARM_TEXT.oneLine);
    expect(layout.size).toBeGreaterThanOrEqual(box.height * ARM_TEXT.oneLine * ARM_TEXT.shrinkOne - 1e-9);
  });

  it('breaks a longer item into two balanced lines at a word boundary', () => {
    const layout = fits('Explain the difference between a list and a tuple');
    expect(layout.lines).toHaveLength(2);
    expect(layout.truncated).toBe(false);
    expect(layout.lines.join(' ')).toBe('Explain the difference between a list and a tuple');
    expect(Math.abs(layout.lines[0]!.length - layout.lines[1]!.length)).toBeLessThan(12);
  });

  it('ends an item that cannot fit in an ellipsis, and says so', () => {
    const text = 'Explain a lifetime error to someone else, then fix it without the compiler and write down what you learned from it';
    const layout = fits(text);
    expect(layout.lines).toHaveLength(2);
    expect(layout.truncated).toBe(true);
    expect(layout.lines[1]!.endsWith(ARM_TEXT.ellipsis)).toBe(true);
    expect(text.startsWith(layout.lines[0]!)).toBe(true);
  });

  it('never upper-cases, and collapses stray white space', () => {
    expect(layoutArmText('  read   a\tstaff ', box, measure).lines).toEqual(['read a staff']);
    expect(layoutArmText('iOS und macOS', box, measure, 'de').lines.join(' ')).toBe('iOS und macOS');
  });

  it('gives no lines for an empty item or an arm with no room', () => {
    expect(layoutArmText('', box, measure).lines).toEqual([]);
    expect(layoutArmText('   ', box, measure).lines).toEqual([]);
    expect(layoutArmText('words', { width: 0, height: 12 }, measure).lines).toEqual([]);
  });

  it('breaks one unbroken word that is wider than the arm between characters', () => {
    const layout = fits('Donaudampfschifffahrtsgesellschaftskapitänsmützenabzeichenhersteller');
    expect(layout.lines).toHaveLength(2);
    expect(layout.lines[0]!.length).toBeGreaterThan(10);
  });

  it('wraps scripts that write without spaces', () => {
    const layout = fits('関数を書いてテストを追加し、結果を仲間に説明する。それから直す');
    expect(layout.lines.length).toBe(2);
    expect(layout.lines[0]!.length).toBeGreaterThan(3);
    const thai = fits('อธิบายความแตกต่างระหว่างรายการและทูเพิลให้เพื่อนฟังแล้วเขียนสรุปสั้นๆ');
    expect(thai.lines.length).toBe(2);
  });

  it('keeps right-to-left text in reading order', () => {
    const layout = fits('اشرح الفرق بين القائمة والصف لشخص آخر ثم اكتب ملخصا');
    expect(layout.lines).toHaveLength(2);
    expect('اشرح الفرق بين القائمة والصف لشخص آخر ثم اكتب ملخصا'.startsWith(layout.lines[0]!)).toBe(true);
  });

  it('keeps punctuation with the word before it', () => {
    const pieces = breakPieces('one, two (three) four', 'en');
    expect(pieces.join('')).toBe('one, two (three) four');
    for (const piece of pieces) expect(piece).not.toMatch(/^[\s,)]/);
  });
});
