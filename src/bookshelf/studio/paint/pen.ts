import type { PaintedFace } from '../types';
import { canvasSize } from './layout';

/**
 * Draws one face on its two canvases at once. Everything is given in CSS px of the face. A stamped part
 * is drawn white on the mask; an unstamped part is cut out of the mask, so a drawing or a knocked-out
 * initial printed over a stamped block leaves the mask black where it lies. The mask is filled black
 * behind everything when the face is finished.
 */
export interface Pen {
  color: CanvasRenderingContext2D;
  mask: CanvasRenderingContext2D;
  face: PaintedFace;
  /** Vertical metrics of a font, per px of its size, measured once per face. */
  metrics(font: string): { ascent: number; descent: number };
}

export function createPen(width: number, height: number, density: number): Pen {
  const size = canvasSize(width, height, density);
  const make = (): [HTMLCanvasElement, CanvasRenderingContext2D] => {
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Studio paint needs a 2D canvas.');
    ctx.setTransform(size.scaleX, 0, 0, size.scaleY, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    return [canvas, ctx];
  };
  const [colorCanvas, color] = make();
  const [maskCanvas, mask] = make();
  const known = new Map<string, { ascent: number; descent: number }>();
  return {
    color,
    mask,
    face: { color: colorCanvas, mask: maskCanvas },
    metrics(font) {
      const found = known.get(font);
      if (found) return found;
      color.save();
      color.font = font;
      const probe = color.measureText('Hxgé');
      const px = parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? '16') || 16;
      color.restore();
      const ascent = (probe.fontBoundingBoxAscent ?? px * 0.9) / px;
      const descent = (probe.fontBoundingBoxDescent ?? px * 0.25) / px;
      const result = { ascent, descent };
      known.set(font, result);
      return result;
    },
  };
}

export interface Ink {
  colour: string;
  alpha?: number;
  stamped: boolean;
}

/**
 * Runs `draw` on the colour canvas in the ink's colour and on the mask as the stamp says. `draw` fills
 * or strokes with whatever style is current, and may set its own transform and clip inside.
 */
export function mark(pen: Pen, ink: Ink, draw: (ctx: CanvasRenderingContext2D) => void): void {
  const { color, mask } = pen;
  color.save();
  color.globalAlpha = ink.alpha ?? 1;
  color.fillStyle = ink.colour;
  color.strokeStyle = ink.colour;
  draw(color);
  color.restore();

  mask.save();
  if (ink.stamped) {
    mask.fillStyle = '#fff';
    mask.strokeStyle = '#fff';
  } else {
    mask.globalCompositeOperation = 'destination-out';
    mask.fillStyle = '#000';
    mask.strokeStyle = '#000';
    mask.globalAlpha = ink.alpha ?? 1;
  }
  draw(mask);
  mask.restore();
}

/** An image laid on the face; it is never stamped, so it only cuts the mask. */
export function image(pen: Pen, picture: CanvasImageSource, x: number, y: number, width: number, height: number): void {
  if (width <= 0 || height <= 0) return;
  pen.color.drawImage(picture, x, y, width, height);
  pen.mask.save();
  pen.mask.globalCompositeOperation = 'destination-out';
  pen.mask.drawImage(picture, x, y, width, height);
  pen.mask.restore();
}

/** Fills the mask black wherever nothing stamped was drawn. */
export function finish(pen: Pen): PaintedFace {
  const { mask } = pen;
  mask.save();
  mask.setTransform(1, 0, 0, 1, 0, 0);
  mask.globalCompositeOperation = 'destination-over';
  mask.fillStyle = '#000';
  mask.fillRect(0, 0, mask.canvas.width, mask.canvas.height);
  mask.restore();
  return pen.face;
}

/** Sets the type on a context; letter spacing in px where the canvas supports it. */
export function setType(ctx: CanvasRenderingContext2D, font: string, spacing: number): void {
  ctx.font = font;
  if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${spacing}px`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

/** Where the baseline falls in a line box `line` px high whose top is at `top`, as CSS places it. */
export function baseline(top: number, line: number, size: number, metrics: { ascent: number; descent: number }): number {
  return top + (line - (metrics.ascent + metrics.descent) * size) / 2 + metrics.ascent * size;
}

export function fontOf(style: string, weight: string, size: number, family: string): string {
  return `${style === 'italic' ? 'italic ' : ''}${weight} ${Math.round(size * 1000) / 1000}px ${family}`;
}
