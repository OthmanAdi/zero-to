import { resolveCloth, resolvePattern, type PatternName } from './variants';
import type { ShelfItem } from './types';
import { fitTitle, linesOf, type TitleBox } from './cover-title';
import { imprintOf, seriesOf } from './imprint';
import { cleanOutline } from './cover-outline';

/**
 * Procedural cover art. Every cover is drawn from a seed with plain SVG shapes,
 * so the project ships no image files and two volumes rarely look alike.
 * Built with DOM calls only: nothing here parses markup.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Small deterministic generator (mulberry32). Same seed, same cover. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shape(name: string, attributes: Record<string, string | number>): SVGElement {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

const round = (value: number): number => Math.round(value * 100) / 100;

/**
 * What a painter lays down: the key drawing in the first ink and the rest in the second. The two are
 * printed as two passes, the second slightly out of register, so where they cross they overprint.
 */
interface Print {
  first: SVGElement[];
  second: SVGElement[];
}

/**
 * A painter draws into a box `w` wide and `h` high (in viewBox units) and keeps every shape inside it,
 * so the composition is fixed to the plate's own edges and nothing is ever cropped.
 */
type Painter = (random: () => number, w: number, h: number) => Print;

/**
 * An arch standing on the bottom edge: the upper half of a ring centred `legs` above the base, with
 * straight sides down to it. With no inner radius it is a solid half disc on legs.
 */
function arch(cx: number, base: number, outer: number, inner: number, legs = 0): string {
  const o = round(outer);
  const i = round(inner);
  const b = round(base);
  const spring = round(base - legs);
  const outside = `M${round(cx - o)} ${b} L${round(cx - o)} ${spring} A${o} ${o} 0 0 1 ${round(cx + o)} ${spring} L${round(cx + o)} ${b}`;
  if (i <= 0) return `${outside} Z`;
  return `${outside} L${round(cx + i)} ${b} L${round(cx + i)} ${spring} A${i} ${i} 0 0 0 ${round(cx - i)} ${spring} L${round(cx - i)} ${b} Z`;
}

/** Where a ray leaving the bottom edge at `x` at `angle` (0 to the right, PI/2 straight up) meets the box. */
function rayEnd(x: number, w: number, h: number, angle: number): [number, number] {
  const dx = Math.cos(angle);
  const dy = -Math.sin(angle);
  let t = h / -dy;
  if (dx > 1e-9) t = Math.min(t, (w - x) / dx);
  if (dx < -1e-9) t = Math.min(t, x / -dx);
  return [x + t * dx, h + t * dy];
}

const fill = (d: string): SVGElement => shape('path', { d, fill: 'currentColor' });

const painters: Record<PatternName, Painter> = {
  arcs(random, w, h) {
    const cx = w * (0.5 + (random() - 0.5) * 0.24);
    const reach = Math.min(cx, w - cx, h);
    // In a box taller than the arches are wide, they rise on straight sides to the head of the box.
    const legs = Math.max(0, h - reach);
    const rings = 5 + Math.floor(random() * 3);
    const pitch = reach / (rings + 0.6);
    const print: Print = { first: [], second: [fill(arch(cx, h, pitch * 0.9, 0, legs))] };
    for (let ring = 1; ring <= rings; ring++) {
      const outer = Math.min(reach, pitch * (ring + 0.6));
      print[ring % 2 === 0 ? 'second' : 'first'].push(fill(arch(cx, h, outer, outer - pitch * 0.58, legs)));
    }
    return print;
  },

  bars(random, w, h) {
    const count = 9 + Math.floor(random() * 5);
    const slot = w / count;
    const base = Math.max(0.8, h * 0.012);
    const print: Print = { first: [], second: [] };
    for (let index = 0; index < count; index++) {
      const height = h * (0.18 + random() * 0.76);
      const bar = shape('rect', {
        x: round(index * slot + slot * 0.19),
        y: round(h - height),
        width: round(slot * 0.62),
        height: round(height),
        fill: 'currentColor',
      });
      print[random() > 0.35 ? 'first' : 'second'].push(bar);
    }
    // A base line in the second ink, crossing the foot of every bar.
    print.second.push(shape('rect', { x: 0, y: round(h - base), width: round(w), height: round(base), fill: 'currentColor' }));
    return print;
  },

  dots(random, w, h) {
    const columns = 7;
    const pitch = w / columns;
    const rows = Math.max(1, Math.floor(h / pitch + 0.001));
    const top = (h - rows * pitch) / 2;
    const span = Math.max(w, h) * 1.1;
    const screen = (x0: number, y0: number, across: number, down: number, scale: number): SVGElement[] => {
      const focusX = w * (0.15 + random() * 0.7);
      const focusY = h * (0.15 + random() * 0.7);
      const dots: SVGElement[] = [];
      for (let row = 0; row < down; row++) {
        for (let column = 0; column < across; column++) {
          const x = x0 + column * pitch;
          const y = y0 + row * pitch;
          const near = Math.max(0, 1 - Math.hypot(x - focusX, y - focusY) / span);
          const radius = pitch * scale * (0.08 + 0.33 * Math.pow(near, 1.6));
          dots.push(shape('circle', { cx: round(x), cy: round(y), r: round(radius), fill: 'currentColor' }));
        }
      }
      return dots;
    };
    // Two screens, the second set half a step off the first, as a duotone is printed.
    return {
      first: screen(pitch / 2, top + pitch / 2, columns, rows, 1),
      second: rows > 1 ? screen(pitch, top + pitch, columns - 1, rows - 1, 0.85) : [],
    };
  },

  rays(random, w, h) {
    const x = w * (0.3 + random() * 0.4);
    const count = 13 + Math.floor(random() * 7);
    const print: Print = { first: [], second: [] };
    for (let index = 0; index < count; index++) {
      const angle = Math.PI * (0.06 + (0.88 * index) / (count - 1));
      const wide = index % 3 === 0;
      const spread = wide ? 0.024 : 0.012;
      const [ax, ay] = rayEnd(x, w, h, angle - spread);
      const [bx, by] = rayEnd(x, w, h, angle + spread);
      const ray = shape('polygon', {
        points: `${round(x)},${round(h)} ${round(ax)},${round(ay)} ${round(bx)},${round(by)}`,
        fill: 'currentColor',
      });
      print[wide ? 'first' : 'second'].push(ray);
    }
    const sun = Math.min(x, w - x, h) * (0.16 + random() * 0.1);
    print.second.push(fill(arch(x, h, sun, 0)));
    return print;
  },

  tiles(random, w, h) {
    const columns = 5;
    const rows = Math.max(1, Math.round(h / (w / columns)));
    const size = Math.min(w / columns, h / rows);
    const left = (w - columns * size) / 2;
    const top = (h - rows * size) / 2;
    const s = round(size);
    // One path per ink, so neighbouring quarter discs join without a hairline between them.
    const paths = { first: '', second: '' };
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const x0 = round(left + column * size);
        const y0 = round(top + row * size);
        const x1 = round(x0 + s);
        const y1 = round(y0 + s);
        // A quarter disc whose centre is one corner of the cell.
        const quarters = [
          `M${x0} ${y0} L${x1} ${y0} A${s} ${s} 0 0 1 ${x0} ${y1} Z`,
          `M${x1} ${y0} L${x1} ${y1} A${s} ${s} 0 0 1 ${x0} ${y0} Z`,
          `M${x1} ${y1} L${x0} ${y1} A${s} ${s} 0 0 1 ${x1} ${y0} Z`,
          `M${x0} ${y1} L${x0} ${y0} A${s} ${s} 0 0 1 ${x1} ${y1} Z`,
        ];
        const quarter = quarters[Math.floor(random() * 4)] ?? quarters[0]!;
        paths[random() > 0.3 ? 'first' : 'second'] += quarter;
      }
    }
    return {
      first: paths.first ? [fill(paths.first)] : [],
      second: paths.second ? [fill(paths.second)] : [],
    };
  },

  waves(random, w, h) {
    const lines = 7 + Math.floor(random() * 3);
    const gap = h / (lines + 1);
    const wavelength = w * (0.22 + random() * 0.22);
    const print: Print = { first: [], second: [] };
    for (let line = 0; line < lines; line++) {
      const heavy = line % 2 === 0;
      const width = heavy ? 2.8 : 1.4;
      const y = gap * (line + 1);
      const amplitude = Math.min(2.5 + random() * 4.5, gap * 0.4);
      const phase = random() * Math.PI * 2;
      const from = width / 2;
      const to = w - width / 2;
      const steps = Math.ceil(((to - from) / wavelength) * 16);
      const points: string[] = [];
      for (let step = 0; step <= steps; step++) {
        const x = from + ((to - from) * step) / steps;
        points.push(`${round(x)},${round(y + amplitude * Math.sin((x / wavelength) * Math.PI * 2 + phase))}`);
      }
      print[heavy ? 'first' : 'second'].push(
        shape('polyline', {
          points: points.join(' '),
          fill: 'none',
          stroke: 'currentColor',
          'stroke-width': width,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        }),
      );
    }
    return print;
  },
};

/** Room left round the drawing so the second ink, printed slightly off, still lands inside the box. */
const REGISTER = 0.7;

/** One pass of ink: a group in the stylesheet's colour for that ink, shifted by `offset`. */
function inkPass(ink: 1 | 2, shapes: SVGElement[], offset: [number, number]): SVGGElement {
  const group = document.createElementNS(SVG_NS, 'g') as SVGGElement;
  group.setAttribute('class', `bb-cover__ink bb-cover__ink--${ink}`);
  group.setAttribute('transform', `translate(${round(REGISTER + offset[0])} ${round(REGISTER + offset[1])})`);
  for (const element of shapes) group.appendChild(element);
  return group;
}

/**
 * The drawing alone, as a decorative SVG. `aspect` is the width of the box it is shown in divided by its
 * height; the drawing is composed for that box and shown whole (`meet`), never cropped to fit. It is
 * printed in two inks, the second a fraction off register, the way a small press prints a jacket.
 */
export function createCoverArt(pattern: string | undefined, seed = 1, aspect = 1): SVGSVGElement {
  const w = 100;
  const h = round(w / (Number.isFinite(aspect) && aspect > 0 ? Math.min(4, Math.max(0.25, aspect)) : 1));
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('bb-cover__art');
  const name = resolvePattern(pattern);
  const print = painters[name](createRandom(seed), w - 2 * REGISTER, h - 2 * REGISTER);
  // The register drifts with its own generator, so it never changes the drawing itself.
  const drift = createRandom(seed ^ 0x5bd1e995);
  const off = (): number => (drift() - 0.5) * 2 * (REGISTER - 0.1);
  svg.appendChild(inkPass(1, print.first, [0, 0]));
  svg.appendChild(inkPass(2, print.second, [off(), off()]));
  return svg;
}

/** A page holds about this many paragraphs: fewer leave the foot of the plate empty, as on a short page. */
const PAGE_LINES = 12;

/**
 * The plate of a link with saved text: the text's own silhouette, one rule per paragraph, set ragged
 * right, each paragraph after the first indented as on a printed page. A heading is a heavier, shorter
 * bar printed in the second ink. `outline` is what `outlineOf` gives for the text.
 */
export function createOutlineArt(outline: readonly number[], aspect = 1, seed = 1): SVGSVGElement {
  const w = 100;
  const h = round(w / (Number.isFinite(aspect) && aspect > 0 ? Math.min(4, Math.max(0.25, aspect)) : 1));
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('bb-cover__art');

  const values = cleanOutline(outline);
  const width = w - 2 * REGISTER;
  const pitch = (h - 2 * REGISTER) / Math.max(values.length, PAGE_LINES);
  const indent = width * 0.06;
  const print: Print = { first: [], second: [] };
  let afterParagraph = false;
  values.forEach((value, line) => {
    const heading = value < 0;
    const length = Math.abs(value);
    const thickness = pitch * (heading ? 0.62 : 0.34);
    const x = !heading && afterParagraph ? indent : 0;
    // A heading is one line of display type: a heavy bar of 30 to 60 % of the line, never a full one.
    const extent = heading ? width * (0.3 + 0.3 * Math.min(1, length * 4)) : (width - x) * length;
    const rule = shape('rect', {
      x: round(x),
      y: round(line * pitch + pitch * 0.82 - thickness),
      width: round(extent),
      height: round(thickness),
      fill: 'currentColor',
    });
    print[heading ? 'second' : 'first'].push(rule);
    afterParagraph = !heading;
  });

  const drift = createRandom(seed ^ 0x5bd1e995);
  const off = (): number => (drift() - 0.5) * 2 * (REGISTER - 0.1);
  svg.appendChild(inkPass(1, print.first, [0, 0]));
  svg.appendChild(inkPass(2, print.second, [off(), off()]));
  return svg;
}

/** A BCP 47 tag as the store keeps it. Anything else is left off rather than passed to the page. */
const LANG = /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8}){0,4}$/;

/** Width over height of a cover on the default shelf. */
export const COVER_ASPECT = 206 / 340;

/**
 * The four ways a cover is laid out. One site always gets the same one, so its links read as a series.
 * plate: title at the head, a rule, the drawing under it. label: the title on a paper label pasted on
 * the cloth, the drawing small below. band: the drawing printed across the head, the title under it.
 * frame: a double rule round the board, the title centred, the drawing as a small device.
 */
export const LAYOUTS = ['plate', 'label', 'band', 'frame'] as const;
export type CoverLayout = (typeof LAYOUTS)[number];

interface LayoutGrid {
  /** Line length of the title, in cqw. */
  measure: number;
  /** Height the title block may take, in cqw, on a cover `height` cqw high. */
  head: (height: number) => number;
  /** Largest and smallest title size, in cqw. */
  max: number;
  min: number;
  /** Width over height of the plate, on a cover `height` cqw high. */
  plate: (height: number) => number;
}

/**
 * The grid of each layout in cqw, mirroring cover.css. The label and the frame set their titles on a
 * shorter line, so they may go a little smaller; the 9 px floor in the stylesheet still holds.
 */
const GRID: Record<CoverLayout, LayoutGrid> = {
  plate: { measure: 79, head: (h) => h * 0.47 - 10, max: 13.6, min: 7.5, plate: (h) => 79 / Math.max(1, h * 0.5 - 14 - 5) },
  label: { measure: 65, head: (h) => h * 0.47 - 6 - 11, max: 11, min: 7, plate: () => 1 },
  band: { measure: 79, head: (h) => h * 0.53 - 8 - 13, max: 13.6, min: 7.5, plate: (h) => 100 / (h * 0.47) },
  frame: { measure: 67, head: (h) => h * 0.735 - 47.5, max: 12, min: 7, plate: () => 1 },
};

const TITLE = { leading: 1.04, gap: 3 };
const AUTHOR = { size: 5.6, leading: 1.2, lines: 2 };

export interface CoverOptions {
  /**
   * Width over height of the box the cover fills. The title and the plate are composed for it, so give
   * the real value when the cover is not in the default proportion. Defaults to `COVER_ASPECT`.
   */
  aspect?: number;
}

/** The layout of every cover from one site. A link with no site gets the plain plate. */
export function layoutOf(source: string | undefined): CoverLayout {
  return LAYOUTS[seriesOf(source, LAYOUTS.length)] ?? LAYOUTS[0];
}

/** The room the title of `item` has in `layout` on a cover `aspect` wide for 1 high, in cqw. */
export function titleBoxOf(item: ShelfItem, layout: CoverLayout, aspect = COVER_ASPECT): TitleBox {
  const grid = GRID[layout];
  let height = grid.head(100 / aspect);
  if (item.author) {
    const lines = Math.min(AUTHOR.lines, linesOf(item.author, AUTHOR.size, grid.measure));
    height -= lines * AUTHOR.size * AUTHOR.leading + TITLE.gap;
  }
  return { measure: grid.measure, height, max: grid.max, min: grid.min, leading: TITLE.leading };
}

/**
 * A small tick set in the imprint line of a link marked as read, the way a reader pencils one on a
 * finished book. A link part read gets none: the slip on the volume already shows how far.
 */
function doneMark(): HTMLElement {
  const mark = document.createElement('span');
  mark.className = 'bb-cover__done';
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.setAttribute('viewBox', '0 0 12 12');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.appendChild(
    shape('path', {
      d: 'M2.4 6.6 L4.9 9 L9.8 3.2',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.5,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    }),
  );
  mark.appendChild(svg);
  return mark;
}

function textElement(tag: string, className: string, text: string): HTMLElement {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

/**
 * A complete front cover: cloth, title, drawing, and at the foot the imprint of the site it comes from.
 * It sizes its type from its own width, so the same element works at spine
 * scale on the shelf and at full size beside the reader. Everything on it is
 * said again next to it (caption, reader heading), so it is hidden from
 * assistive technology.
 */
export function createCover(item: ShelfItem, mark?: string, options: CoverOptions = {}): HTMLElement {
  const aspect = options.aspect && Number.isFinite(options.aspect) && options.aspect > 0 ? options.aspect : COVER_ASPECT;
  const layout = layoutOf(item.source);
  const cover = document.createElement('span');
  cover.className = `bb-cover bb-cloth--${resolveCloth(item.cloth)}`;
  cover.dataset.layout = layout;
  cover.dataset.pattern = resolvePattern(item.pattern);
  cover.setAttribute('aria-hidden', 'true');
  if (item.lang && LANG.test(item.lang)) cover.lang = item.lang;

  const head = document.createElement('span');
  head.className = 'bb-cover__head';
  const title = textElement('span', 'bb-cover__title', item.title);
  const fit = fitTitle(item.title, titleBoxOf(item, layout, aspect));
  title.style.setProperty('--bb-cover-title', `${fit.size}cqw`);
  title.style.setProperty('--bb-cover-lines', String(fit.clamp));
  if (fit.broken) title.classList.add('bb-cover__title--break');
  head.appendChild(title);
  if (item.author) head.appendChild(textElement('span', 'bb-cover__author', item.author));
  cover.appendChild(head);

  const plate = document.createElement('span');
  plate.className = 'bb-cover__plate';
  const outline = cleanOutline(item.outline);
  const plateAspect = GRID[layout].plate(100 / aspect);
  cover.dataset.plate = outline.length > 0 ? 'outline' : 'art';
  plate.appendChild(
    outline.length > 0
      ? createOutlineArt(outline, plateAspect, item.seed ?? 1)
      : createCoverArt(item.pattern, item.seed ?? 1, plateAspect),
  );
  cover.appendChild(plate);

  const imprint = imprintOf(item.source).name;
  const label = mark ?? item.mark;
  if (item.done) cover.dataset.done = '';
  if (imprint || label || item.done) {
    const foot = document.createElement('span');
    foot.className = 'bb-cover__foot';
    if (imprint) foot.appendChild(textElement('span', 'bb-cover__imprint', imprint));
    if (item.done) foot.appendChild(doneMark());
    if (label) foot.appendChild(textElement('span', 'bb-cover__mark', label));
    cover.appendChild(foot);
  }
  return cover;
}
