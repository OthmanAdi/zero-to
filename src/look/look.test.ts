import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { missingKeys, stringIssues } from '../i18n';
import { PALETTE } from '../scene/palette';
import { brandMark, drawBrandMark, markGeometry, type MarkContext } from './brand';
import { NBSP, formatDay, formatHours, formatNumber, roundHours } from './format';
import { LAMP } from './lamp';
import { say } from './strings';
import {
  FOCUS,
  FOCUS_PAIRS,
  TEXT_PAIRS,
  THEME,
  contrast,
  focusTokens,
  hexToRgb,
  luminance,
  mix,
  rgbToHex,
  tokenEntries,
  tokenName,
  tokensCss,
  withAlpha,
} from './theme';
import { injectTokens, lookCss } from './tokens';
import {
  FONTS,
  FONT_ROLES,
  MAX_ROADMAP_TRACKING,
  TYPE,
  canvasFont,
  drawText,
  loadFonts,
  measureTextWidth,
  typeTokens,
  type TextContext,
} from './type';

describe('theme', () => {
  it('keeps the scene palette and adds the room, the type and the covers', () => {
    for (const [key, value] of Object.entries(PALETTE)) expect(THEME[key as keyof typeof PALETTE]).toEqual(value);
    expect(THEME.void).toBe('#05070b');
    expect(THEME.cover.gold).toBe('#86671d');
    expect(THEME.status.unverified).toBe(PALETTE.inkSoft);
  });

  it('gives every token a custom property', () => {
    const leaves: string[] = [];
    const walk = (node: object, path: string[]) => {
      for (const [key, value] of Object.entries(node)) {
        if (typeof value === 'string') leaves.push([...path, key].join('.'));
        else walk(value as object, [...path, key]);
      }
    };
    walk(THEME, []);
    const entries = new Map(tokenEntries());
    expect(entries.size).toBe(leaves.length);
    for (const leaf of leaves) {
      const name = tokenName(leaf);
      expect(name).toMatch(/^--zt-[a-z0-9-]+$/);
      expect(entries.has(name), `${leaf} has no custom property`).toBe(true);
    }
    for (const name of ['--zt-night', '--zt-paper', '--zt-ink', '--zt-signal', '--zt-text', '--zt-tier-gold', '--zt-paper-hi', '--zt-cover-bronze']) {
      expect(entries.has(name), name).toBe(true);
    }
    expect(entries.get('--zt-tier-gold')).toBe(THEME.tier.gold);
  });

  it('writes the tokens into the document once and replaces them on a second call', () => {
    const style = injectTokens(document);
    expect(injectTokens(document)).toBe(style);
    expect(document.querySelectorAll('#zt-tokens')).toHaveLength(1);
    const css = style.textContent ?? '';
    for (const [name, value] of [...tokenEntries(), ...typeTokens(), ...focusTokens()]) {
      expect(css).toContain(`${name}: ${value};`);
    }
    expect(css).toBe(lookCss());
    expect(tokensCss().startsWith(':root {')).toBe(true);
  });

  it('reaches 4.5 to 1 on every text pair', () => {
    for (const pair of TEXT_PAIRS) {
      expect(contrast(pair.ink, pair.ground), pair.name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('matches the contrast figures the palette was chosen for', () => {
    expect(contrast(THEME.text, THEME.night)).toBeCloseTo(16.8, 1);
    expect(contrast(THEME.textSoft, THEME.night)).toBeCloseTo(9.0, 1);
    expect(contrast(THEME.textFaint, THEME.night)).toBeCloseTo(6.3, 1);
    expect(contrast(THEME.paperHi, THEME.cover.bronze)).toBeCloseTo(6.3, 1);
    expect(contrast(THEME.paperHi, THEME.cover.silver)).toBeCloseTo(5.9, 1);
    expect(contrast(THEME.paperHi, THEME.cover.gold)).toBeCloseTo(5.0, 1);
    expect(contrast(THEME.paperHi, THEME.cover.diamond)).toBeCloseTo(6.4, 1);
    expect(contrast(THEME.signalDeep, THEME.paper)).toBeCloseTo(5.0, 1);
    // The signal colour itself is for display sizes and graphics on paper, not for small text.
    expect(contrast(THEME.signal, THEME.paper)).toBeGreaterThanOrEqual(3);
    expect(contrast(THEME.signal, THEME.paper)).toBeLessThan(4.5);
  });

  it('rings a focused control in lamp colour on the room, and in ink with a lamp halo on paper', () => {
    expect(FOCUS).toMatchObject({ width: 2, offset: 2, room: THEME.lamp, paper: THEME.ink });
    expect(FOCUS.halo).toContain('var(--zt-lamp)');
    const tokens = new Map(focusTokens());
    expect(tokens.get('--zt-focus-width')).toBe('2px');
    expect(tokens.get('--zt-focus-offset')).toBe('2px');
    expect(tokens.get('--zt-focus-room')).toBe('var(--zt-lamp)');
    expect(tokens.get('--zt-focus-paper')).toBe('var(--zt-ink)');
    expect(tokens.get('--zt-focus-halo')).toBe(FOCUS.halo);
    // A ring is a graphic: 3 to 1 against its ground. The lamp ring would fail that on paper, which is the
    // reason for the ink ring there.
    for (const pair of FOCUS_PAIRS) expect(contrast(pair.ring, pair.ground), pair.name).toBeGreaterThanOrEqual(3);
    expect(contrast(THEME.lamp, THEME.paper)).toBeLessThan(3);

    // The stylesheet carries both rules, built on the tokens.
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'look.css'), 'utf8').replace(/\s+/g, ' ');
    expect(css).toContain('outline: var(--zt-focus-width, 2px) solid var(--zt-focus-room, #ffd9a0);');
    expect(css).toContain(':where(.zt-paper, .zt-on-paper) :where(a, button, input, select, textarea, summary, [tabindex]):focus-visible');
    expect(css).toContain(':where(.zt-on-paper):focus-visible');
    expect(css).toContain('outline-color: var(--zt-focus-paper, #1f2a3d);');
    expect(css).toContain('box-shadow: var(--zt-focus-halo, 0 0 0 4px #ffd9a0);');
  });

  it('does colour arithmetic', () => {
    expect(hexToRgb('#fff')).toEqual([1, 1, 1]);
    expect(rgbToHex(hexToRgb('#1f2a3d'))).toBe('#1f2a3d');
    expect(luminance('#000000')).toBe(0);
    expect(contrast('#000', '#fff')).toBeCloseTo(21, 6);
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(withAlpha('#1f2a3d', 0.5)).toBe('rgba(31, 42, 61, 0.5)');
    expect(() => hexToRgb('rgba(0,0,0,1)')).toThrow();
  });
});

describe('type', () => {
  it('names three faces and ends every stack in system faces', () => {
    expect(FONT_ROLES).toEqual(['display', 'text', 'label']);
    expect(FONTS.display.stack).toMatch(/serif$/);
    expect(FONTS.text.stack).toMatch(/sans-serif$/);
    expect(FONTS.label.stack).toMatch(/monospace$/);
    for (const role of FONT_ROLES) expect(FONTS[role].stack.startsWith(`'${FONTS[role].family}'`)).toBe(true);
  });

  it('keeps the scale of the build notes', () => {
    expect(TYPE.headline).toMatchObject({ size: 64, phoneSize: 40, weight: 500, lineHeight: 1, tracking: -0.02, opticalSize: 144 });
    expect(TYPE.title.size).toBe(26);
    expect(TYPE.body).toMatchObject({ size: 16, lineHeight: 1.5 });
    expect(TYPE.label).toMatchObject({ size: 10.5, tracking: 0.14 });
    expect(TYPE.data.tracking).toBeLessThanOrEqual(MAX_ROADMAP_TRACKING);
  });

  it('builds canvas font strings', () => {
    expect(canvasFont('display', 48, 600)).toBe(`600 48px ${FONTS.display.stack}`);
    expect(canvasFont('display', 48, 500, 'italic')).toBe(`italic 500 48px ${FONTS.display.stack}`);
    expect(canvasFont('label', 10.5)).toBe(`400 10.5px ${FONTS.label.stack}`);
    // The mono has no weight above 500 and no italic. Asking for them must not make the browser fake one.
    expect(canvasFont('label', 12, 700, 'italic')).toBe(`500 12px ${FONTS.label.stack}`);
  });

  /** A stand-in context: every character is 10 wide, except that "T" and "o" tuck together by 2. */
  function fakeContext(): TextContext & { calls: { text: string; x: number; y: number; align: string; direction: string }[] } {
    const calls: { text: string; x: number; y: number; align: string; direction: string }[] = [];
    return {
      font: '500 20px Test',
      textAlign: 'left',
      direction: 'ltr',
      calls,
      fillText(text, x, y) {
        calls.push({ text, x, y, align: this.textAlign, direction: this.direction });
      },
      measureText(text) {
        return { width: [...text].length * 10 - (text.includes('To') ? 2 : 0) };
      },
    };
  }

  it('draws untracked text in one call', () => {
    const ctx = fakeContext();
    expect(drawText(ctx, 'Total', 5, 30)).toBe(48);
    expect(ctx.calls).toEqual([{ text: 'Total', x: 5, y: 30, align: 'left', direction: 'ltr' }]);
  });

  it('tracks Latin text character by character and keeps its kerning', () => {
    const ctx = fakeContext();
    // 0.1 em of 20 px is 2 px between characters.
    const width = drawText(ctx, 'Total', 100, 30, { tracking: 0.1 });
    expect(ctx.calls.map((call) => call.text)).toEqual(['T', 'o', 't', 'a', 'l']);
    expect(ctx.calls.map((call) => call.x)).toEqual([100, 110, 122, 134, 146]);
    expect(width).toBe(56);
    expect(measureTextWidth(ctx, 'Total', { tracking: 0.1 })).toBe(56);
    expect(ctx.textAlign).toBe('left');
  });

  it('anchors tracked text at its middle or its right end', () => {
    const centred = fakeContext();
    drawText(centred, 'ab', 100, 0, { tracking: 0.5, align: 'center' });
    expect(centred.calls.map((call) => call.x)).toEqual([85, 105]);
    const right = fakeContext();
    drawText(right, 'ab', 100, 0, { tracking: 0.5, align: 'right' });
    expect(right.calls.map((call) => call.x)).toEqual([70, 90]);
  });

  it('never splits a joined script, and starts right-to-left text from the right', () => {
    const ctx = fakeContext();
    const width = drawText(ctx, 'تعلم', 40, 10, { tracking: 0.14, lang: 'ar' });
    expect(ctx.calls).toEqual([{ text: 'تعلم', x: 40 + width, y: 10, align: 'right', direction: 'rtl' }]);
    const han = fakeContext();
    drawText(han, '书法入门', 0, 0, { tracking: 0.14 });
    expect(han.calls).toHaveLength(1);
    expect(han.calls[0]?.direction).toBe('ltr');
    expect(ctx.direction).toBe('ltr');
  });

  it('skips spaces but keeps their room, and draws nothing for an empty string', () => {
    const ctx = fakeContext();
    drawText(ctx, 'a b', 0, 0, { tracking: 0.1 });
    expect(ctx.calls.map((call) => call.text)).toEqual(['a', 'b']);
    expect(ctx.calls[1]?.x).toBe(24);
    expect(drawText(ctx, '', 0, 0, { tracking: 0.1 })).toBe(0);
  });

  it('reports instead of failing when faces cannot be loaded', async () => {
    const report = await loadFonts({ timeout: 20 });
    expect(Array.isArray(report.loaded)).toBe(true);
    expect(report.loaded.length + report.missing.length).toBe(3);
    expect(report.ready).toBe(report.missing.length === 0);
  });
});

describe('format', () => {
  it('prints estimates in hours or minutes', () => {
    expect(formatHours(45, { lang: 'en' })).toBe('about 45\u00a0min');
    expect(formatHours(45, { lang: 'de' })).toBe('ca. 45\u00a0Min.');
    expect(formatHours(270, { lang: 'en' })).toBe('about 4.5\u00a0h');
    expect(formatHours(270, { lang: 'de' })).toBe('ca. 4,5\u00a0Std.');
    expect(formatHours(38 * 60 + 10, { lang: 'en' })).toBe('about 38\u00a0h');
    expect(formatHours(360, { lang: 'en', approx: false })).toBe('6\u00a0h');
    expect(formatHours(30, { lang: 'en', unit: 'hours', approx: false })).toBe('0.5\u00a0h');
    expect(formatHours(58, { lang: 'en' })).toBe('about 1\u00a0h');
    expect(formatHours(3, { lang: 'en' })).toBe('about 5\u00a0min');
    expect(formatHours(0, { lang: 'en' })).toBe('0\u00a0min');
    expect(formatHours(Number.NaN, { lang: 'de' })).toBe('0\u00a0Min.');
  });

  it('joins a number to its unit with a no-break space, never a plain one', () => {
    expect(NBSP).toBe('\u00a0');
    for (const lang of ['en', 'de'] as const) {
      for (const minutes of [0, 5, 45, 60, 90, 270, 600, 2290]) {
        for (const approx of [true, false]) {
          const text = formatHours(minutes, { lang, approx });
          // Exactly one no-break space, between the figure and the unit.
          expect(text.split(NBSP), text).toHaveLength(2);
          expect(text).toMatch(/\d\u00a0\p{L}/u);
          expect(text).not.toMatch(/\d \p{L}/u);
        }
      }
    }
  });

  it('rounds hours the way it prints them', () => {
    expect(roundHours(270)).toBe(4.5);
    expect(roundHours(275)).toBe(4.5);
    expect(roundHours(610)).toBe(10);
    expect(formatNumber(4.5, { lang: 'de' })).toBe('4,5');
    expect(formatNumber(1234.56, { lang: 'en', fraction: 0 })).toBe('1,235');
  });

  it('keeps a calendar day the same day everywhere', () => {
    expect(formatDay('2026-11-13', { style: 'iso' })).toBe('2026-11-13');
    expect(formatDay('2026-11-13', { lang: 'en' })).toBe('13\u00a0Nov\u00a02026');
    expect(formatDay('2026-11-13', { lang: 'de' })).toMatch(/^13\.\u00a0Nov\.?\u00a02026$/);
    expect(formatDay(new Date(2026, 10, 13), { style: 'iso' })).toBe('2026-11-13');
    expect(formatDay('2026-11-13T23:30:00-11:00', { style: 'iso' })).toBe('2026-11-13');
  });

  it('holds a date together with no-break spaces', () => {
    for (const lang of ['en', 'de'] as const) {
      expect(formatDay('2026-03-04', { lang })).not.toContain(' ');
      expect(formatDay('2026-03-04', { lang }).split(NBSP)).toHaveLength(3);
      // The long form may break once, after the weekday, and nowhere else.
      const long = formatDay('2026-01-01', { lang, style: 'long' });
      expect(long.split(' '), long).toHaveLength(2);
      expect(long.split(NBSP), long).toHaveLength(3);
    }
    expect(formatDay('2026-01-01', { lang: 'en', style: 'long' })).toMatch(/^Thursday,? 1\u00a0January\u00a02026$/);
    expect(formatDay('2026-01-01', { lang: 'de', style: 'long' })).toMatch(/^Donnerstag, 1\.\u00a0Januar\u00a02026$/);
  });

  it('returns what it cannot read', () => {
    expect(formatDay('soon')).toBe('soon');
    expect(formatDay('2026-02-30')).toBe('2026-02-30');
    expect(formatDay(new Date(Number.NaN))).toBe('');
  });
});

describe('brand mark', () => {
  it('has a small cut for favicons and a regular cut above', () => {
    expect(markGeometry(16).cut).toBe('small');
    expect(markGeometry(20).cut).toBe('small');
    expect(markGeometry(21).cut).toBe('regular');
    // On the 32 grid a stroke of 4 is 2 px at 16 px, and its outer edge lands on whole pixels.
    const small = markGeometry(16).ring;
    expect(small.stroke / 2).toBe(2);
    expect(((small.cx - small.rx - small.stroke / 2) / 2) % 1).toBe(0);
    expect(((small.cy - small.ry - small.stroke / 2) / 2) % 1).toBe(0);
    expect(markGeometry(16).pivot).toBe(0);
  });

  it('draws the ring and the needle of the build notes', () => {
    const regular = markGeometry(32);
    expect(regular.ring).toEqual({ cx: 16, cy: 16, rx: 9.5, ry: 12, stroke: 3 });
    expect(regular.pivot).toBe(1.2);
    expect(regular.needleUpper[0]).toEqual([25.5, 4.5]);
    expect(regular.needleLower[0]).toEqual([6.5, 27.5]);
    // Widest at the centre: 2.6 either side.
    const right = regular.needleUpper[1] ?? [0, 0];
    const left = regular.needleUpper[2] ?? [0, 0];
    expect(Math.hypot(right[0] - left[0], right[1] - left[1])).toBeCloseTo(5.2, 6);
    // The tip leaves the ring: it lies outside the ellipse's outer edge by about 2.5.
    const dx = 25.5 - 16;
    const dy = 4.5 - 16;
    const length = Math.hypot(dx, dy);
    const onRing = 1 / Math.sqrt((dx / length / 9.5) ** 2 + (dy / length / 12) ** 2);
    expect(length - onRing - 1.5).toBeGreaterThan(2);
    expect(length - onRing - 1.5).toBeLessThan(3);
  });

  it('writes self-contained SVG in the theme colours', () => {
    const svg = brandMark(32);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"')).toBe(true);
    expect(svg).toContain('<ellipse');
    expect(svg).toContain(`fill="${THEME.signal}"`);
    expect(svg).toContain(`stroke="${THEME.text}"`);
    expect(svg).toContain(`fill="${THEME.brass}"`);
    expect(svg).toContain('aria-hidden="true"');
    expect(brandMark(16)).not.toContain('<circle');
    expect(brandMark(64, { title: 'zero-to' })).toContain('role="img" aria-label="zero-to"');
    expect(brandMark(64, { ink: THEME.ink })).toContain(`stroke="${THEME.ink}"`);
    expect(brandMark(128, { tile: THEME.night })).toContain(`<rect width="32" height="32" rx="7" fill="${THEME.night}"/>`);
    expect(brandMark(32, { adaptive: true })).toContain('prefers-color-scheme:dark');
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(parsed.documentElement.tagName.toLowerCase()).toBe('svg');
  });

  it('draws on a canvas without erasing what is there', () => {
    const calls: string[] = [];
    const ctx = new Proxy({} as MarkContext, {
      get: (_, name: string) => (..._args: unknown[]) => void calls.push(name),
      set: () => true,
    });
    drawBrandMark(ctx, 10, 10, 64);
    expect(calls).toContain('ellipse');
    expect(calls).toContain('clip');
    expect(calls.filter((name) => name === 'fill')).toHaveLength(3);
    expect(calls.filter((name) => name === 'save').length).toBe(calls.filter((name) => name === 'restore').length);
  });
});

describe('strings and lamp', () => {
  it('has every string in both languages', () => {
    expect(say('about', { duration: '6 h' }, 'en')).toBe('about 6 h');
    expect(say('about', { duration: '6 Std.' }, 'de')).toBe('ca. 6 Std.');
    expect(say('hours', { n: 6 }, 'en')).toBe('6\u00a0h');
    expect(say('minutes', { n: 45 }, 'de')).toBe('45\u00a0Min.');
    expect(stringIssues().filter((issue) => issue.startsWith('look:'))).toEqual([]);
    expect(missingKeys({ en: { a: 'x' }, de: {} })).toHaveLength(1);
  });

  it('describes the calibrated lamp', () => {
    expect(LAMP.offset).toEqual({ x: -1.9, y: 7.9, z: -3.2 });
    expect(LAMP.exposure).toBe(1);
    expect(LAMP.intensity).toBeGreaterThan(0);
    expect(LAMP.cardBand).toEqual([228, 245]);
    expect(LAMP.color).toBe(THEME.lampLight);
  });
});
