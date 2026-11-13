import { describe, expect, it } from 'vitest';
import { COVER_ASPECT, createCover, createCoverArt, createOutlineArt, LAYOUTS, layoutOf, titleBoxOf } from './cover-art';
import { fitTitle } from './cover-title';
import { PATTERNS } from './variants';
import type { ShelfItem } from './types';

const item = (overrides: Partial<ShelfItem> = {}): ShelfItem => ({ id: 'a', title: 'A Title', ...overrides });

type Bounds = [number, number, number, number];

/** Points on an SVG arc segment with equal radii and no rotation, from the endpoint form (SVG 2, B.2.4). */
function arcPoints(x1: number, y1: number, r: number, large: boolean, sweep: boolean, x2: number, y2: number): number[][] {
  const hx = (x1 - x2) / 2;
  const hy = (y1 - y2) / 2;
  const radius = Math.max(r, Math.hypot(hx, hy));
  const root = Math.sqrt(Math.max(0, (radius ** 2 - hx ** 2 - hy ** 2) / (hx ** 2 + hy ** 2 || 1)));
  const sign = large === sweep ? -1 : 1;
  const cx = sign * root * hy + (x1 + x2) / 2;
  const cy = -sign * root * hx + (y1 + y2) / 2;
  const start = Math.atan2(y1 - cy, x1 - cx);
  let delta = Math.atan2(y2 - cy, x2 - cx) - start;
  if (sweep && delta < 0) delta += Math.PI * 2;
  if (!sweep && delta > 0) delta -= Math.PI * 2;
  return Array.from({ length: 33 }, (_, step) => {
    const angle = start + (delta * step) / 32;
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  });
}

/** Every point a path passes through, for absolute M, L, H, V, A and Z, the commands the painters write. */
function pathPoints(d: string): number[][] {
  const tokens = d.match(/[MLHVAZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  const points: number[][] = [];
  let x = 0;
  let y = 0;
  let command = '';
  for (let index = 0; index < tokens.length; ) {
    if (/[a-z]/i.test(tokens[index]!)) command = tokens[index++]!;
    if (command !== command.toUpperCase()) throw new Error(`relative command ${command} in ${d}`);
    const next = () => Number(tokens[index++]);
    if (command === 'M' || command === 'L') [x, y] = [next(), next()];
    else if (command === 'H') x = next();
    else if (command === 'V') y = next();
    else if (command === 'A') {
      const r = next();
      next();
      next();
      const large = next() === 1;
      const sweep = next() === 1;
      const [ex, ey] = [next(), next()];
      points.push(...arcPoints(x, y, r, large, sweep, ex, ey));
      [x, y] = [ex, ey];
    } else if (command === 'Z') continue;
    else throw new Error(`unexpected command ${command}`);
    points.push([x, y]);
  }
  return points;
}

function translation(element: Element | null): [number, number] {
  let dx = 0;
  let dy = 0;
  for (let node = element; node && node.tagName.toLowerCase() !== 'svg'; node = node.parentElement) {
    const match = /translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)/.exec(node.getAttribute('transform') ?? '');
    if (match) [dx, dy] = [dx + Number(match[1]), dy + Number(match[2])];
  }
  return [dx, dy];
}

/** The box that holds every painted shape of a drawing, strokes included. */
function paintedBounds(svg: SVGSVGElement): Bounds {
  const box: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const element of svg.querySelectorAll('circle, rect, line, polyline, polygon, path')) {
    const number = (name: string) => Number(element.getAttribute(name) ?? 0);
    const stroked = (element.getAttribute('stroke') ?? 'none') !== 'none';
    const pad = stroked ? number('stroke-width') / 2 : 0;
    const [dx, dy] = translation(element);
    let points: number[][];
    switch (element.tagName.toLowerCase()) {
      case 'circle': {
        const [cx, cy, r] = [number('cx'), number('cy'), number('r')];
        points = [[cx - r, cy - r], [cx + r, cy + r]];
        break;
      }
      case 'rect':
        points = [[number('x'), number('y')], [number('x') + number('width'), number('y') + number('height')]];
        break;
      case 'line':
        points = [[number('x1'), number('y1')], [number('x2'), number('y2')]];
        break;
      case 'path':
        points = pathPoints(element.getAttribute('d') ?? '');
        break;
      default:
        points = (element.getAttribute('points') ?? '').trim().split(/\s+/).map((pair) => pair.split(',').map(Number));
    }
    for (const [px = 0, py = 0] of points) {
      box[0] = Math.min(box[0], px + dx - pad);
      box[1] = Math.min(box[1], py + dy - pad);
      box[2] = Math.max(box[2], px + dx + pad);
      box[3] = Math.max(box[3], py + dy + pad);
    }
  }
  return box;
}

describe('createCoverArt', () => {
  it.each(PATTERNS)('draws at least one shape for %s', (pattern) => {
    const svg = createCoverArt(pattern, 5);
    expect(svg.childElementCount).toBeGreaterThan(0);
  });

  it.each(PATTERNS)('is deterministic for %s: the same seed gives identical markup', (pattern) => {
    expect(createCoverArt(pattern, 42).outerHTML).toBe(createCoverArt(pattern, 42).outerHTML);
  });

  it.each(PATTERNS)('differs between seeds for %s', (pattern) => {
    expect(createCoverArt(pattern, 1).outerHTML).not.toBe(createCoverArt(pattern, 2).outerHTML);
  });

  it('falls back to the first pattern for an unknown or missing name', () => {
    const fallback = createCoverArt(PATTERNS[0], 9).outerHTML;
    expect(createCoverArt('no-such-pattern', 9).outerHTML).toBe(fallback);
    expect(createCoverArt(undefined, 9).outerHTML).toBe(fallback);
  });

  it('defaults the seed to 1', () => {
    expect(createCoverArt('bars').outerHTML).toBe(createCoverArt('bars', 1).outerHTML);
  });

  it('produces finite numbers only, even for odd seeds', () => {
    for (const seed of [0, -7, 1.5, 2 ** 32 + 3, Number.MAX_SAFE_INTEGER]) {
      for (const pattern of PATTERNS) {
        expect(createCoverArt(pattern, seed).outerHTML).not.toMatch(/NaN|Infinity/);
      }
    }
  });

  it('is a decorative svg shown whole in its box', () => {
    const svg = createCoverArt('arcs', 3);
    expect(svg.getAttribute('viewBox')).toBe('0 0 100 100');
    expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.classList.contains('bb-cover__art')).toBe(true);
  });

  it.each(PATTERNS)('prints %s in two inks, the second a fraction off register', (pattern) => {
    const offsets = [1, 2, 3, 4, 5].map((seed) => {
      const svg = createCoverArt(pattern, seed, 1.2);
      const first = svg.querySelector('.bb-cover__ink--1');
      const second = svg.querySelector('.bb-cover__ink--2');
      expect(first?.childElementCount).toBeGreaterThan(0);
      expect(second?.childElementCount).toBeGreaterThan(0);
      const [x1, y1] = translation(first?.firstElementChild ?? null);
      const [x2, y2] = translation(second?.firstElementChild ?? null);
      return Math.hypot(x2 - x1, y2 - y1);
    });
    for (const offset of offsets) expect(offset).toBeLessThanOrEqual(0.6 * Math.SQRT2 + 0.01);
    expect(Math.max(...offsets)).toBeGreaterThan(0.05);
  });

  it('keeps the drawing the same whatever the register, so only the second pass moves', () => {
    const shapes = (svg: SVGSVGElement) => [...svg.querySelectorAll('.bb-cover__ink > *')].map((node) => node.outerHTML);
    expect(shapes(createCoverArt('tiles', 8, 1))).toEqual(shapes(createCoverArt('tiles', 8, 1)));
  });

  it('is composed in the aspect of the box it is shown in', () => {
    expect(createCoverArt('bars', 3, 1.25).getAttribute('viewBox')).toBe('0 0 100 80');
    expect(createCoverArt('bars', 3, 0.5).getAttribute('viewBox')).toBe('0 0 100 200');
    expect(createCoverArt('bars', 3, Number.NaN).getAttribute('viewBox')).toBe('0 0 100 100');
  });

  describe.each([0.6, 1, 1.45])('in a box %s wide for 1 high', (aspect) => {
    it.each(PATTERNS)('keeps every shape of %s inside the box', (pattern) => {
      for (const seed of [1, 2, 7, 99, 2024]) {
        const svg = createCoverArt(pattern, seed, aspect);
        const [, , width = 0, height = 0] = (svg.getAttribute('viewBox') ?? '').split(' ').map(Number);
        const [left, top, right, bottom] = paintedBounds(svg);
        expect(left).toBeGreaterThanOrEqual(-0.01);
        expect(top).toBeGreaterThanOrEqual(-0.01);
        expect(right).toBeLessThanOrEqual(width + 0.01);
        expect(bottom).toBeLessThanOrEqual(height + 0.01);
      }
    });

    it.each(PATTERNS)('uses most of the box for %s, so nothing floats in a corner', (pattern) => {
      const svg = createCoverArt(pattern, 5, aspect);
      const [, , width = 0, height = 0] = (svg.getAttribute('viewBox') ?? '').split(' ').map(Number);
      const [left, top, right, bottom] = paintedBounds(svg);
      expect(right - left).toBeGreaterThan(width * 0.6);
      expect(bottom - top).toBeGreaterThan(height * 0.45);
    });
  });
});

describe('createOutlineArt', () => {
  const rules = (svg: SVGSVGElement) =>
    [...svg.querySelectorAll('rect')].map((rect) => ({
      heading: rect.closest('.bb-cover__ink--2') !== null,
      x: Number(rect.getAttribute('x')),
      y: Number(rect.getAttribute('y')),
      width: Number(rect.getAttribute('width')),
      height: Number(rect.getAttribute('height')),
    }));

  it('sets one rule per paragraph, in reading order, ragged at the right', () => {
    const drawn = rules(createOutlineArt([1, 0.5, 0.25], 1.2));
    expect(drawn).toHaveLength(3);
    expect(drawn.map((rule) => rule.y)).toEqual([...drawn.map((rule) => rule.y)].sort((a, b) => a - b));
    expect(drawn[0]!.width).toBeGreaterThan(drawn[1]!.width);
    expect(drawn[1]!.width).toBeGreaterThan(drawn[2]!.width);
    expect(drawn[1]!.x).toBeGreaterThan(drawn[0]!.x);
  });

  it('gives even a short heading a bar a reader would see as a headline', () => {
    const [stub] = rules(createOutlineArt([-0.04, 1], 1)).filter((rule) => rule.heading);
    expect(stub!.width).toBeGreaterThan(25);
  });

  it('sets a heading as a heavier, shorter bar than a full paragraph, in the second ink', () => {
    const drawn = rules(createOutlineArt([-1, 1], 1));
    const heading = drawn.find((rule) => rule.heading);
    const paragraph = drawn.find((rule) => !rule.heading);
    expect(heading!.y).toBeLessThan(paragraph!.y);
    expect(heading!.height).toBeGreaterThan(paragraph!.height * 1.5);
    expect(heading!.width).toBeLessThan(paragraph!.width);
  });

  it('prints at most eighteen rules', () => {
    expect(rules(createOutlineArt(Array.from({ length: 40 }, () => 0.7), 1))).toHaveLength(18);
  });

  it.each([0.6, 1, 1.45])('keeps every rule inside a box %s wide for 1 high', (aspect) => {
    const svg = createOutlineArt(Array.from({ length: 18 }, (_, index) => (index % 5 === 0 ? -1 : 1)), aspect, 3);
    const [, , width = 0, height = 0] = (svg.getAttribute('viewBox') ?? '').split(' ').map(Number);
    const [left, top, right, bottom] = paintedBounds(svg);
    expect(left).toBeGreaterThanOrEqual(-0.01);
    expect(top).toBeGreaterThanOrEqual(-0.01);
    expect(right).toBeLessThanOrEqual(width + 0.01);
    expect(bottom).toBeLessThanOrEqual(height + 0.01);
  });

  it('leaves the foot of the plate empty for a short text, as on a short page', () => {
    const svg = createOutlineArt([1, 0.5], 1);
    expect(paintedBounds(svg)[3]).toBeLessThan(30);
  });
});

describe('createCover', () => {
  it('puts the title, author, imprint and mark in as text', () => {
    const cover = createCover(item({ source: 'www.example.com', author: 'Ada' }), '07');
    expect(cover.querySelector('.bb-cover__title')?.textContent).toBe('A Title');
    expect(cover.querySelector('.bb-cover__author')?.textContent).toBe('Ada');
    expect(cover.querySelector('.bb-cover__imprint')?.textContent).toBe('Example');
    expect(cover.querySelector('.bb-cover__mark')?.textContent).toBe('07');
  });

  it('sets the imprint at the foot and nothing about the site at the head', () => {
    const cover = createCover(item({ source: 'www.w3.org' }));
    expect(cover.querySelector('.bb-cover__foot > .bb-cover__imprint')?.textContent).toBe('W3');
    expect(cover.querySelector('.bb-cover__head')?.textContent).toBe('A Title');
  });

  it('omits imprint, author and mark when there are none', () => {
    const cover = createCover(item());
    expect(cover.querySelector('.bb-cover__imprint')).toBeNull();
    expect(cover.querySelector('.bb-cover__foot')).toBeNull();
    expect(createCover(item({ source: 'localhost' })).querySelector('.bb-cover__imprint')).toBeNull();
    expect(cover.querySelector('.bb-cover__author')).toBeNull();
    expect(cover.querySelector('.bb-cover__mark')).toBeNull();
  });

  it('falls back to the item mark when no mark argument is given', () => {
    expect(createCover(item({ mark: 'X1' })).querySelector('.bb-cover__mark')?.textContent).toBe('X1');
  });

  it('sets the mark at the foot, not in a box at the head', () => {
    const cover = createCover(item(), '07');
    expect(cover.querySelector('.bb-cover__foot > .bb-cover__mark')).not.toBeNull();
    expect(cover.querySelector('.bb-cover__head .bb-cover__mark')).toBeNull();
  });

  it('is hidden from assistive technology, since everything on it is said beside it', () => {
    expect(createCover(item()).getAttribute('aria-hidden')).toBe('true');
  });

  it('renders markup in a title as text and creates no elements from it', () => {
    const hostile = '<img src=x onerror=1>';
    const cover = createCover(item({ title: hostile, source: `${hostile}.example.org`, author: hostile }));
    expect(cover.querySelector('img')).toBeNull();
    expect(cover.querySelector('.bb-cover__title')?.textContent).toBe(hostile);
    expect(cover.querySelector('.bb-cover__imprint')?.textContent).toBe('Example');
    expect(cover.querySelector('.bb-cover__author')?.textContent).toBe(hostile);
    expect(cover.querySelectorAll('[onerror]').length).toBe(0);
  });

  it('sizes the title from its text and hyphenates only what cannot fit', () => {
    const short = createCover(item({ title: 'CSS' })).querySelector<HTMLElement>('.bb-cover__title')!;
    const long = createCover(item({ title: 'Bundesausbildungsförderungsgesetz', lang: 'de' }));
    const longTitle = long.querySelector<HTMLElement>('.bb-cover__title')!;
    expect(parseFloat(short.style.getPropertyValue('--bb-cover-title'))).toBeGreaterThan(
      parseFloat(longTitle.style.getPropertyValue('--bb-cover-title')),
    );
    expect(short.style.getPropertyValue('--bb-cover-title')).toMatch(/^\d+(\.\d)?cqw$/);
    expect(Number(short.style.getPropertyValue('--bb-cover-lines'))).toBeGreaterThanOrEqual(1);
    expect(short.classList.contains('bb-cover__title--break')).toBe(false);
    expect(longTitle.classList.contains('bb-cover__title--break')).toBe(true);
    expect(long.lang).toBe('de');
  });

  it('takes the language from the item only when it is a plain language tag', () => {
    expect(createCover(item({ lang: 'de-AT' })).lang).toBe('de-AT');
    expect(createCover(item({ lang: 'de" onload="x' })).hasAttribute('lang')).toBe(false);
    expect(createCover(item()).hasAttribute('lang')).toBe(false);
  });

  it('lays out every cover from one site the same way, so a site reads as a series', () => {
    const one = createCover(item({ source: 'en.example.org' })).dataset.layout;
    expect(createCover(item({ source: 'de.example.org', title: 'Other' })).dataset.layout).toBe(one);
    expect(createCover(item({ source: 'https://www.example.org/wiki/X' })).dataset.layout).toBe(one);
    expect(layoutOf('en.example.org')).toBe(one);
  });

  it('uses all four layouts across sites and the plate for a link with no site', () => {
    const sites = ['example.org', 'example.com', 'example.net', 'example.edu', 'w3.org', 'ietf.org', 'iso.org', 'unicode.org'];
    expect(new Set(sites.map(layoutOf))).toEqual(new Set(LAYOUTS));
    expect(createCover(item()).dataset.layout).toBe('plate');
  });

  describe.each(LAYOUTS)('the %s layout', (layout) => {
    const fits = (title: string, aspect: number) => {
      const box = titleBoxOf(item({ title, author: 'S. Keshav' }), layout, aspect);
      const fit = fitTitle(title, box);
      return { box, fit, whole: fit.lines <= fit.clamp && fit.lines * fit.size * box.leading <= box.height };
    };

    it.each([COVER_ASPECT, 0.68])('holds a two-line and a four-line title with an author at %s wide for 1 high', (aspect) => {
      const two = fits('How to Read a Paper', aspect);
      const four = fits('Keeping a Commonplace Book: Notes on Reading Slowly', aspect);
      expect(two.fit.lines).toBeLessThanOrEqual(3);
      expect(two.whole).toBe(true);
      expect(four.fit.lines).toBeGreaterThanOrEqual(3);
      expect(four.whole).toBe(true);
      expect(fits('Barrierefreiheitsstärkungsgesetz: Was ab 2025 für Webseiten gilt', aspect).whole).toBe(true);
    });

    it('holds a page title of 70 characters with an author on the default shelf', () => {
      const long = fits('Keeping a Commonplace Book: Notes on Reading Slowly and Remembering It', COVER_ASPECT);
      expect(long.whole).toBe(true);
      expect(long.fit.size).toBeGreaterThanOrEqual(long.box.min);
    });
  });

  it('prints the shape of the saved text as the plate when there is one', () => {
    const outline = [-0.3, 1, 0.4, 0.8];
    const cover = createCover(item({ outline, pattern: 'dots', source: 'www.w3.org' }));
    expect(cover.dataset.plate).toBe('outline');
    const rules = cover.querySelectorAll('.bb-cover__plate rect');
    expect(rules).toHaveLength(outline.length);
    expect(createCover(item({ pattern: 'dots' })).dataset.plate).toBe('art');
    expect(createCover(item({ outline: [] })).dataset.plate).toBe('art');
    expect(createCover(item({ outline: [Number.NaN] })).dataset.plate).toBe('art');
  });

  it('sets a quiet tick in the imprint line of a link marked as read', () => {
    const cover = createCover(item({ source: 'example.org', done: true }));
    expect(cover.hasAttribute('data-done')).toBe(true);
    const foot = cover.querySelector('.bb-cover__foot');
    expect([...(foot?.children ?? [])].map((child) => child.className)).toEqual(['bb-cover__imprint', 'bb-cover__done']);
    expect(createCover(item({ done: true })).querySelector('.bb-cover__foot > .bb-cover__done')).not.toBeNull();
  });

  it('marks nothing on a link that is only part read', () => {
    const cover = createCover(item({ source: 'example.org', progress: 0.4 }));
    expect(cover.querySelector('.bb-cover__done')).toBeNull();
    expect(cover.hasAttribute('data-done')).toBe(false);
  });

  it('records the resolved pattern and cloth', () => {
    const cover = createCover(item({ pattern: 'waves', cloth: 'rust' }));
    expect(cover.dataset.pattern).toBe('waves');
    expect(cover.classList.contains('bb-cloth--rust')).toBe(true);

    const unknown = createCover(item({ pattern: 'nope', cloth: 'nope' }));
    expect(unknown.dataset.pattern).toBe(PATTERNS[0]);
    expect(unknown.classList.contains('bb-cloth--ink')).toBe(true);
  });

  it('contains the drawing for the item seed', () => {
    const first = createCover(item({ pattern: 'dots', seed: 3 }));
    const second = createCover(item({ pattern: 'dots', seed: 3 }));
    const other = createCover(item({ pattern: 'dots', seed: 4 }));
    expect(first.querySelector('svg')?.outerHTML).toBe(second.querySelector('svg')?.outerHTML);
    expect(first.querySelector('svg')?.outerHTML).not.toBe(other.querySelector('svg')?.outerHTML);
  });
});
