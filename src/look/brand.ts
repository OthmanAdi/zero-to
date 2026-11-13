import { THEME } from './theme';
import { canvasFont, type TextContext } from './type';

/**
 * The mark: "the zero bearing". The digit 0 drawn as a compass bezel, crossed by a needle that leaves the ring
 * at the upper right. It reads as a slashed zero, as a compass, and as "zero, then onward".
 *
 * It is drawn on a 32 by 32 grid and comes in two cuts, like a typeface with optical sizes:
 *
 * - the regular cut, from 21 px up: a ring of stroke 3, a lozenge needle and a brass pivot;
 * - the small cut, up to 20 px: a ring of stroke 4 on whole pixels at 16 px, a needle of even width and no
 *   pivot, so the favicon stays crisp.
 *
 * In both, the ring is cut away for a hair beside the needle, so the needle lies over the bezel and does not
 * melt into it.
 */

/** The grid the mark is drawn on. */
export const MARK_GRID = 32;

/** Sizes up to this many pixels get the small cut. */
export const SMALL_CUT_MAX = 20;

type Point = readonly [x: number, y: number];

export interface MarkGeometry {
  readonly cut: 'regular' | 'small';
  readonly ring: { readonly cx: number; readonly cy: number; readonly rx: number; readonly ry: number; readonly stroke: number };
  /** The half of the needle that points onward, in the signal colour. */
  readonly needleUpper: readonly Point[];
  /** The half of the needle that points back to zero, in the ink colour. */
  readonly needleLower: readonly Point[];
  /** The shape cut out of the ring so the needle lies over it. */
  readonly clearance: readonly Point[];
  /** Radius of the pivot dot, 0 when the cut has none. */
  readonly pivot: number;
}

const TAIL: Point = [6.5, 27.5];
const TIP: Point = [25.5, 4.5];
const CENTRE: Point = [16, 16];
const NEEDLE_HALF_LENGTH = Math.hypot(TIP[0] - CENTRE[0], TIP[1] - CENTRE[1]);
/** The hair between the needle and the ring, on the 32 grid, measured at the needle's waist. */
const CLEARANCE = 0.85;

function needleShape(halfWidth: number, extend: number, even: boolean): { upper: Point[]; lower: Point[]; outline: Point[] } {
  const dx = TIP[0] - TAIL[0];
  const dy = TIP[1] - TAIL[1];
  const length = Math.hypot(dx, dy);
  const ux = dx / length;
  const uy = dy / length;
  const nx = -uy;
  const ny = ux;
  const tip: Point = [TIP[0] + ux * extend, TIP[1] + uy * extend];
  const tail: Point = [TAIL[0] - ux * extend, TAIL[1] - uy * extend];
  const left: Point = [CENTRE[0] + nx * halfWidth, CENTRE[1] + ny * halfWidth];
  const right: Point = [CENTRE[0] - nx * halfWidth, CENTRE[1] - ny * halfWidth];
  if (even) {
    // A bar of even width: four corners per half.
    const tipLeft: Point = [tip[0] + nx * halfWidth, tip[1] + ny * halfWidth];
    const tipRight: Point = [tip[0] - nx * halfWidth, tip[1] - ny * halfWidth];
    const tailLeft: Point = [tail[0] + nx * halfWidth, tail[1] + ny * halfWidth];
    const tailRight: Point = [tail[0] - nx * halfWidth, tail[1] - ny * halfWidth];
    return {
      upper: [tipLeft, tipRight, right, left],
      lower: [left, right, tailRight, tailLeft],
      outline: [tipLeft, tipRight, tailRight, tailLeft],
    };
  }
  return { upper: [tip, right, left], lower: [tail, left, right], outline: [tip, right, tail, left] };
}

/** The shapes of the mark on its 32 grid for a pixel size. Both the SVG and the canvas drawing use them. */
export function markGeometry(size: number): MarkGeometry {
  if (size <= SMALL_CUT_MAX) {
    const needle = needleShape(1.9, 0, true);
    return {
      cut: 'small',
      ring: { cx: 16, cy: 16, rx: 10, ry: 12, stroke: 4 },
      needleUpper: needle.upper,
      needleLower: needle.lower,
      clearance: needleShape(1.9 + 1.3, 4, true).outline,
      pivot: 0,
    };
  }
  const needle = needleShape(2.6, 0, false);
  return {
    cut: 'regular',
    ring: { cx: 16, cy: 16, rx: 9.5, ry: 12, stroke: 3 },
    needleUpper: needle.upper,
    needleLower: needle.lower,
    // A lozenge a little larger than the needle. Its sides run parallel to the needle's at a hair's distance.
    clearance: needleShape(2.6 + CLEARANCE, (NEEDLE_HALF_LENGTH * CLEARANCE) / 2.6, false).outline,
    pivot: 1.2,
  };
}

export interface BrandMarkOptions {
  /** Colour of the ring and the lower half of the needle. The text colour of the room by default. */
  readonly ink?: string;
  readonly signal?: string;
  readonly brass?: string;
  /**
   * A background tile behind the mark, for app icons: a rounded square in this colour with the mark at two
   * thirds of the size.
   */
  readonly tile?: string;
  /**
   * For a favicon: the ink follows the browser's colour scheme, dark ink on a light tab strip and light ink
   * on a dark one. SVG only.
   */
  readonly adaptive?: boolean;
  /** An accessible name. Without it the SVG is marked as decoration. */
  readonly title?: string;
}

const round = (value: number): string => String(Math.round(value * 1000) / 1000);
const path = (points: readonly Point[]): string => `M${points.map((p) => `${round(p[0])} ${round(p[1])}`).join('L')}Z`;

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

let markCount = 0;

/** The mark as SVG markup at `size` pixels. */
export function brandMark(size: number, options: BrandMarkOptions = {}): string {
  const g = markGeometry(size);
  const ink = options.ink ?? THEME.text;
  const signal = options.signal ?? THEME.signal;
  const brass = options.brass ?? THEME.brass;
  markCount += 1;
  const clip = `zt-mark-${markCount}`;
  const inkFill = options.adaptive ? 'class="zt-mark-ink"' : `fill="${ink}"`;
  const inkStroke = options.adaptive ? 'class="zt-mark-ring"' : `stroke="${ink}"`;
  const style = options.adaptive
    ? `<style>.zt-mark-ink{fill:${THEME.ink}}.zt-mark-ring{stroke:${THEME.ink}}@media (prefers-color-scheme:dark){.zt-mark-ink{fill:${THEME.text}}.zt-mark-ring{stroke:${THEME.text}}}</style>`
    : '';
  const label = options.title
    ? `role="img" aria-label="${escapeXml(options.title)}"`
    : 'aria-hidden="true" focusable="false"';
  const body =
    `<defs><clipPath id="${clip}"><path clip-rule="evenodd" d="M0 0H32V32H0Z${path(g.clearance)}"/></clipPath></defs>` +
    `<ellipse cx="${g.ring.cx}" cy="${g.ring.cy}" rx="${g.ring.rx}" ry="${g.ring.ry}" fill="none" ${inkStroke} stroke-width="${g.ring.stroke}" clip-path="url(#${clip})"/>` +
    `<path d="${path(g.needleLower)}" ${inkFill}/>` +
    `<path d="${path(g.needleUpper)}" fill="${signal}"/>` +
    (g.pivot > 0 ? `<circle cx="16" cy="16" r="${g.pivot}" fill="${brass}"/>` : '');
  const inner = options.tile
    ? `<rect width="32" height="32" rx="7" fill="${options.tile}"/><g transform="translate(16 16) scale(0.68) translate(-16 -16)">${body}</g>`
    : body;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32" ${label}>${style}${inner}</svg>`;
}

/** The mark as an SVG element, parsed from the same markup. */
export function createBrandMark(size: number, options: BrandMarkOptions = {}, doc: Document = document): Element {
  const parsed = new DOMParser().parseFromString(brandMark(size, options), 'image/svg+xml');
  return doc.importNode(parsed.documentElement, true);
}

/** The mark as a `data:` address, for an `<img>`, a favicon link or a canvas image. */
export function brandMarkDataUrl(size: number, options: BrandMarkOptions = {}): string {
  return `data:image/svg+xml,${encodeURIComponent(brandMark(size, options))}`;
}

/** The part of a 2D context the mark needs. */
export interface MarkContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  ellipse(x: number, y: number, rx: number, ry: number, rotation: number, start: number, end: number): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  clip(rule?: CanvasFillRule): void;
  fill(): void;
  stroke(): void;
}

function trace(ctx: MarkContext, points: readonly Point[]): void {
  points.forEach((point, index) => (index === 0 ? ctx.moveTo(point[0], point[1]) : ctx.lineTo(point[0], point[1])));
  ctx.closePath();
}

/**
 * Draws the mark on a canvas with its top left corner at (`x`, `y`). Covers print it this way. The ring is
 * clipped, not erased, so whatever is already on the canvas stays.
 */
export function drawBrandMark(ctx: MarkContext, x: number, y: number, size: number, options: BrandMarkOptions = {}): void {
  const g = markGeometry(size);
  const ink = options.ink ?? THEME.text;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / MARK_GRID, size / MARK_GRID);
  if (options.tile) {
    ctx.fillStyle = options.tile;
    ctx.beginPath();
    ctx.rect(0, 0, MARK_GRID, MARK_GRID);
    ctx.fill();
    ctx.translate(16, 16);
    ctx.scale(0.68, 0.68);
    ctx.translate(-16, -16);
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(-8, -8, MARK_GRID + 16, MARK_GRID + 16);
  trace(ctx, g.clearance);
  ctx.clip('evenodd');
  ctx.beginPath();
  ctx.ellipse(g.ring.cx, g.ring.cy, g.ring.rx, g.ring.ry, 0, 0, Math.PI * 2);
  ctx.strokeStyle = ink;
  ctx.lineWidth = g.ring.stroke;
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = ink;
  ctx.beginPath();
  trace(ctx, g.needleLower);
  ctx.fill();
  ctx.fillStyle = options.signal ?? THEME.signal;
  ctx.beginPath();
  trace(ctx, g.needleUpper);
  ctx.fill();
  if (g.pivot > 0) {
    ctx.fillStyle = options.brass ?? THEME.brass;
    ctx.beginPath();
    ctx.arc(16, 16, g.pivot, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------------------
// The wordmark: "zero-to" in the display face at weight 600, where the hyphen is two dashes of the route.

/** The hyphen, in em of the wordmark's size: two dashes on the height of a hyphen. */
export const WORDMARK_DASH = { length: 0.15, gap: 0.085, thickness: 0.078, rise: 0.235, side: 0.07 } as const;

export interface WordmarkOptions {
  readonly ink?: string;
  readonly signal?: string;
}

/**
 * The wordmark as an element. It takes its size from the font size where it is put and its ink from the
 * `color` there, so it sits in a header, a footer or a card without options. Screen readers hear "zero-to".
 */
export function createWordmark(doc: Document = document, options: WordmarkOptions = {}): HTMLElement {
  const d = WORDMARK_DASH;
  const root = doc.createElement('span');
  root.className = 'zt-wordmark';
  root.setAttribute('role', 'img');
  root.setAttribute('aria-label', 'zero-to');
  if (options.ink) root.style.color = options.ink;
  const part = (text: string) => {
    const span = doc.createElement('span');
    span.setAttribute('aria-hidden', 'true');
    span.textContent = text;
    return span;
  };
  const hyphen = doc.createElement('span');
  hyphen.className = 'zt-wordmark-dash';
  hyphen.setAttribute('aria-hidden', 'true');
  hyphen.style.cssText =
    `display:inline-block;width:${d.length * 2 + d.gap}em;height:${d.thickness}em;margin:0 ${d.side}em;` +
    `vertical-align:${d.rise}em;border-radius:${d.thickness / 3}em;` +
    `background:linear-gradient(90deg, currentColor ${d.length}em, transparent ${d.length}em, transparent ${d.length + d.gap}em, currentColor ${d.length + d.gap}em);` +
    `color:${options.signal ?? `var(--zt-signal, ${THEME.signal})`}`;
  root.append(part('zero'), hyphen, part('to'));
  return root;
}

/**
 * Prints the wordmark on a canvas with its left end at `x` on the baseline `y`, `px` high, and returns its
 * width. The display face must be loaded first (`loadFonts`).
 */
export function drawWordmark(
  ctx: TextContext & { fillStyle: string | CanvasGradient | CanvasPattern; fillRect(x: number, y: number, w: number, h: number): void },
  x: number,
  y: number,
  px: number,
  options: WordmarkOptions = {},
): number {
  const d = WORDMARK_DASH;
  const ink = options.ink ?? THEME.text;
  const savedFont = ctx.font;
  const savedAlign = ctx.textAlign;
  ctx.font = canvasFont('display', px, 600);
  ctx.textAlign = 'left';
  ctx.fillStyle = ink;
  ctx.fillText('zero', x, y);
  let cursor = x + ctx.measureText('zero').width + d.side * px;
  ctx.fillStyle = options.signal ?? THEME.signal;
  const top = y - (d.rise + d.thickness) * px;
  ctx.fillRect(cursor, top, d.length * px, d.thickness * px);
  ctx.fillRect(cursor + (d.length + d.gap) * px, top, d.length * px, d.thickness * px);
  cursor += (d.length * 2 + d.gap + d.side) * px;
  ctx.fillStyle = ink;
  ctx.fillText('to', cursor, y);
  const width = cursor + ctx.measureText('to').width - x;
  ctx.font = savedFont;
  ctx.textAlign = savedAlign;
  return width;
}

export interface BrandOptions extends BrandMarkOptions, WordmarkOptions {
  /** Height of the mark in pixels. 34 in the header. */
  readonly size?: number;
  /** Size of the wordmark in pixels. 18 in the header. */
  readonly wordmark?: number;
}

/** Mark and wordmark side by side, as the header shows them. */
export function createBrand(doc: Document = document, options: BrandOptions = {}): HTMLElement {
  const size = options.size ?? 34;
  const root = doc.createElement('span');
  root.className = 'zt-brand';
  root.style.cssText = `display:inline-flex;align-items:center;gap:${Math.round(size * 0.3)}px`;
  const mark = doc.createElement('span');
  mark.style.cssText = `display:inline-flex;width:${size}px;height:${size}px;flex:none`;
  mark.append(createBrandMark(size, options, doc));
  const word = createWordmark(doc, options);
  word.style.fontSize = `${options.wordmark ?? 18}px`;
  root.append(mark, word);
  return root;
}
