import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  CLOTHS,
  DEFAULT_VARIANT,
  listVariants,
  PATTERNS,
  resolveCloth,
  resolvePattern,
  resolveVariant,
  VARIANTS,
} from './variants';
import { DEFAULT_LIGHT } from './light';
import type { Variant } from './types';

describe('VARIANTS', () => {
  it.each(Object.entries(VARIANTS))('%s has positive sizes and a matching name', (key, variant) => {
    const { geometry } = variant;
    expect(variant.name).toBe(key);
    expect(variant.label.length).toBeGreaterThan(0);
    expect(variant.summary.length).toBeGreaterThan(0);
    for (const size of [geometry.spineWidth, geometry.bookHeight, geometry.coverWidth, geometry.gap, geometry.focusGap, geometry.perspective]) {
      expect(size).toBeGreaterThan(0);
    }
    expect(geometry.focusPush).toBeGreaterThanOrEqual(0);
    expect(geometry.focusLift).toBeGreaterThanOrEqual(0);
    expect(geometry.focusAngle).toBeGreaterThan(0);
    expect(typeof variant.loop).toBe('boolean');
  });

  it.each(Object.entries(VARIANTS))('%s has a name a person can read and a way to move', (_key, variant) => {
    // A short name for a menu: words that start with a capital, no codes or punctuation.
    expect(variant.label).toMatch(/^[A-Z][a-z]+( [A-Z][a-z]+)+$/);
    const { motion } = variant;
    expect(motion.openDuration).toBeGreaterThan(0);
    expect(motion.closeDuration).toBeGreaterThan(0);
    expect(motion.closeDuration).toBeLessThanOrEqual(motion.openDuration);
    expect(motion.openHold).toBeGreaterThanOrEqual(0);
    // Every look steps along the row on the spring a released drag uses.
    expect(motion.travel).toBeNull();
  });

  it('gives every look its own name and words', () => {
    const looks = Object.values(VARIANTS);
    for (const field of ['label', 'summary'] as const) {
      expect(new Set(looks.map((variant) => variant[field])).size, field).toBe(looks.length);
    }
  });

  it('includes the default and lists every variant', () => {
    expect(VARIANTS[DEFAULT_VARIANT]).toBeDefined();
    expect(listVariants().map((variant) => variant.name).sort()).toEqual(Object.keys(VARIANTS).sort());
  });

  it('gives every look its own light, and only Night a lamp', () => {
    for (const variant of Object.values(VARIANTS)) {
      const { light } = variant;
      expect(light, variant.name).toBeDefined();
      expect(light!.ambient).toBeGreaterThan(0);
      expect(light!.ambient).toBeLessThan(1);
      // The light is in front of the row, or nothing a person sees would be lit.
      expect(light!.z).toBeGreaterThan(0);
      expect(light!.tint).toMatch(/^#[0-9a-f]{3,6}$/);
    }
    expect(VARIANTS.night?.light?.lamp).toBeDefined();
    for (const name of ['paper', 'oak', 'pocket']) expect(VARIANTS[name]?.light?.lamp, name).toBeUndefined();
    // Paper is lit like a look that names no light, so a custom look built from it matches the default.
    expect(VARIANTS.paper?.light).toEqual(DEFAULT_LIGHT);
  });

  it('presents a volume a little short of square and never off the floor', () => {
    for (const variant of Object.values(VARIANTS)) {
      expect(variant.geometry.focusAngle, variant.name).toBeGreaterThanOrEqual(80);
      expect(variant.geometry.focusAngle, variant.name).toBeLessThan(90);
      expect(variant.geometry.focusLift, variant.name).toBe(0);
    }
    expect(VARIANTS.paper?.geometry.focusAngle).toBe(84);
    expect(VARIANTS.night?.geometry.focusAngle).toBe(86);
  });

  it('leaves it to the shelf whether a row is long enough to loop', () => {
    for (const variant of Object.values(VARIANTS)) expect(variant.loop, variant.name).toBe(true);
  });

  it('sums up every look in one plain sentence', () => {
    for (const variant of Object.values(VARIANTS)) {
      const { summary } = variant;
      expect(summary, variant.name).toMatch(/^[A-Z][^.!?]*\.$/);
      expect(summary.length, variant.name).toBeLessThanOrEqual(90);
      // It says what the look is, not which one to pick or how the app works.
      expect(summary, variant.name).not.toMatch(/\b(default|variant|theme|look|style)\b/i);
      expect(summary.split(' ').length, variant.name).toBeGreaterThanOrEqual(6);
    }
  });
});

describe('resolveVariant', () => {
  it('returns a known variant by name', () => {
    expect(resolveVariant('oak')).toBe(VARIANTS.oak);
  });

  it('falls back to paper for unknown names and undefined', () => {
    expect(resolveVariant('does-not-exist').name).toBe('paper');
    expect(resolveVariant(undefined).name).toBe('paper');
    expect(resolveVariant('').name).toBe('paper');
  });

  it('passes a full variant object through unchanged', () => {
    const custom: Variant = { ...VARIANTS.paper!, name: 'custom' };
    expect(resolveVariant(custom)).toBe(custom);
  });
});

describe('resolveCloth and resolvePattern', () => {
  it('keep known names', () => {
    for (const cloth of CLOTHS) expect(resolveCloth(cloth)).toBe(cloth);
    for (const pattern of PATTERNS) expect(resolvePattern(pattern)).toBe(pattern);
  });

  it('fall back to the first entry for unknown or missing names', () => {
    expect(resolveCloth('chartreuse')).toBe(CLOTHS[0]);
    expect(resolveCloth(undefined)).toBe(CLOTHS[0]);
    expect(resolveCloth('')).toBe(CLOTHS[0]);
    expect(resolvePattern('zigzag')).toBe(PATTERNS[0]);
    expect(resolvePattern(undefined)).toBe(PATTERNS[0]);
  });

  it('is case sensitive', () => {
    expect(resolveCloth('RUST')).toBe(CLOTHS[0]);
  });
});

describe('a look dresses a cover the same wherever it stands', () => {
  const sheets = ['cover.css', 'variants.css'].map((name) => readFileSync(join(import.meta.dirname, name), 'utf8'));
  const STYLE_ID = 'looks-under-test';
  const DRESS = ['background-color', 'color', 'box-shadow', 'border-radius'] as const;
  const HOOKS = ['--cloth', '--cloth-ink', '--cloth-art', '--bb-cover-shadow', '--bb-cover-mark', '--bb-cover-joint', '--bb-cover-edge'] as const;

  beforeAll(() => {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = sheets.join('\n');
    document.head.appendChild(style);
  });

  afterEach(() => {
    document.body.replaceChildren();
    delete document.documentElement.dataset.variant;
  });

  const cover = (cloth: string): HTMLElement => {
    const element = document.createElement('div');
    element.className = `bb-cover bb-cloth--${cloth}`;
    return element;
  };

  const dressOf = (element: HTMLElement): string[] => {
    const computed = getComputedStyle(element);
    return [...DRESS, ...HOOKS].map((property) => `${property}: ${computed.getPropertyValue(property).trim()}`);
  };

  it.each(Object.keys(VARIANTS))('%s: on the shelf, in the air and beside the page', (look) => {
    document.documentElement.dataset.variant = look;
    for (const cloth of CLOTHS) {
      const shelf = document.createElement('section');
      shelf.className = 'bb-shelf';
      shelf.dataset.variant = look;
      const onShelf = cover(cloth);
      shelf.appendChild(onShelf);
      // The flying copy and the reader's cover hang outside the shelf, straight under the page.
      const flying = document.createElement('div');
      flying.className = `bb-flight__book bb-cloth--${cloth}`;
      const inAir = cover(cloth);
      flying.appendChild(inAir);
      const besidePage = cover(cloth);
      document.body.append(shelf, flying, besidePage);
      expect(dressOf(inAir), `${look} ${cloth} in the air`).toEqual(dressOf(onShelf));
      expect(dressOf(besidePage), `${look} ${cloth} beside the page`).toEqual(dressOf(onShelf));
      expect(getComputedStyle(flying).getPropertyValue('--cloth')).toBe(getComputedStyle(onShelf).getPropertyValue('--cloth'));
    }
  });

  it.each(Object.keys(VARIANTS))('%s: a shelf used alone dresses its covers without the page', (look) => {
    for (const cloth of CLOTHS) {
      const alone = document.createElement('section');
      alone.className = 'bb-shelf';
      alone.dataset.variant = look;
      const onShelf = cover(cloth);
      alone.appendChild(onShelf);
      document.body.appendChild(alone);
      const expected = dressOf(onShelf);
      document.body.replaceChildren();

      document.documentElement.dataset.variant = look;
      const besidePage = cover(cloth);
      document.body.appendChild(besidePage);
      expect(dressOf(besidePage), `${look} ${cloth}`).toEqual(expected);
      delete document.documentElement.dataset.variant;
      document.body.replaceChildren();
    }
  });
});

describe('colour roles of each look', () => {
  const css = [join(import.meta.dirname, '..', 'styles', 'tokens.css'), join(import.meta.dirname, 'variants.css')]
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');

  const rgb = (colour: string): [number, number, number] => {
    const hex = colour.trim().replace('#', '');
    const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex;
    return [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16)) as [number, number, number];
  };
  const luminance = (colour: string): number => {
    const [r, g, b] = rgb(colour).map((value) => {
      const channel = value / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const contrast = (one: string, other: string): number => {
    const [light, dark] = [luminance(one), luminance(other)].sort((a, b) => b - a);
    return (light! + 0.05) / (dark! + 0.05);
  };
  const hue = (colour: string): number => {
    const [r, g, b] = rgb(colour).map((value) => value / 255) as [number, number, number];
    const max = Math.max(r, g, b);
    const span = max - Math.min(r, g, b);
    if (span === 0) return 0;
    const sector = max === r ? ((g - b) / span) % 6 : max === g ? (b - r) / span + 2 : (r - g) / span + 4;
    return (sector * 60 + 360) % 360;
  };

  let roles: (look: string) => Record<string, string>;

  beforeAll(() => {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    roles = (look) => {
      document.documentElement.dataset.variant = look;
      const computed = getComputedStyle(document.documentElement);
      const read = (name: string): string => computed.getPropertyValue(name).trim();
      const values = Object.fromEntries(
        [
          '--bb-focus-ring',
          '--bb-danger',
          '--bb-danger-ink',
          '--bb-danger-wash',
          '--bb-toast-bg',
          '--bb-toast-ink',
          '--bb-accent',
          '--bb-accent-strong',
          '--bb-accent-ink',
          '--bb-paper',
          '--bb-paper-raised',
          '--bb-sheet',
        ].map((name) => [name, read(name)]),
      );
      delete document.documentElement.dataset.variant;
      return values;
    };
  });

  it.each(Object.keys(VARIANTS))('%s: the focus ring holds 3:1 on every ground of the look', (look) => {
    const role = roles(look);
    for (const ground of ['--bb-paper', '--bb-paper-raised', '--bb-sheet']) {
      expect(contrast(role['--bb-focus-ring']!, role[ground]!), `${look} ring on ${ground}`).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(Object.keys(VARIANTS))('%s: warnings, toasts and filled controls are readable', (look) => {
    const role = roles(look);
    const pass = (text: string, ground: string): void => {
      expect(contrast(role[text]!, role[ground]!), `${look} ${text} on ${ground}`).toBeGreaterThanOrEqual(4.5);
    };
    for (const ground of ['--bb-paper', '--bb-paper-raised', '--bb-sheet', '--bb-danger-wash']) pass('--bb-danger', ground);
    pass('--bb-danger-ink', '--bb-danger');
    pass('--bb-toast-ink', '--bb-toast-bg');
    pass('--bb-accent-ink', '--bb-accent');
    pass('--bb-accent-ink', '--bb-accent-strong');
  });

  it.each(Object.keys(VARIANTS))('%s: every cloth carries legible lettering and a visible device', (look) => {
    document.documentElement.dataset.variant = look;
    for (const cloth of CLOTHS) {
      const volume = document.createElement('div');
      volume.className = `bb-cloth--${cloth}`;
      document.body.appendChild(volume);
      const computed = getComputedStyle(volume);
      const root = getComputedStyle(document.documentElement);
      // A value the cloth does not set itself is inherited from the page root, as a browser would.
      const read = (name: string): string => computed.getPropertyValue(name).trim() || root.getPropertyValue(name).trim();
      expect(contrast(read('--cloth-ink'), read('--cloth')), `${look} ${cloth} lettering`).toBeGreaterThanOrEqual(4.5);
      // The second colour carries the spine's device and the cover's drawing: a graphic, so 3:1.
      expect(contrast(read('--cloth-art'), read('--cloth')), `${look} ${cloth} device`).toBeGreaterThanOrEqual(3);
      if (look === 'oak') {
        for (const stop of ['--bb-foil-1', '--bb-foil-2', '--bb-foil-3']) {
          expect(contrast(read(stop), read('--cloth')), `oak ${cloth} ${stop}`).toBeGreaterThanOrEqual(4.5);
        }
      }
      volume.remove();
    }
    delete document.documentElement.dataset.variant;
  });

  it.each(Object.keys(VARIANTS))('%s: focus can never be mistaken for an error', (look) => {
    const role = roles(look);
    const apart = Math.abs(hue(role['--bb-focus-ring']!) - hue(role['--bb-danger']!));
    expect(Math.min(apart, 360 - apart), look).toBeGreaterThanOrEqual(90);
  });
});
