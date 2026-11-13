/**
 * Silhouettes: how any drawing gets a paper edge.
 *
 * A cut-out is drawn in white on black, then blurred. The result is not a mask but a soft field that falls from
 * 1 inside the shape to 0 outside and passes one half exactly on the outline. The paper shader reads that field
 * at a position nudged by noise and cuts at one half, which gives a chewed edge from any vector drawing, and
 * a known distance from the edge for the lighter core of the cut.
 */

export type Draw2D = (ctx: CanvasRenderingContext2D, width: number, height: number) => void;

export interface SilhouetteSize {
  /** Width and height of the drawing in canvas pixels. */
  readonly width: number;
  readonly height: number;
  /** Margin round the drawing in pixels. By default wide enough for the blur and the tear. */
  readonly pad?: number;
}

export interface Silhouette {
  /** The field: red, green and blue hold the same value. Its size is the drawing plus the padding all round. */
  readonly canvas: HTMLCanvasElement;
  readonly width: number;
  readonly height: number;
  readonly pad: number;
  readonly blur: number;
  /**
   * The field at a point of the drawing, 0 to 1. `u` runs left to right and `v` bottom to top, both 0 to 1
   * across the drawing (not the padding). A tap counts as a hit on paper where this is at least one half.
   */
  valueAt(u: number, v: number): number;
}

/** The padding a field needs so its blur and its tear stay inside the canvas. */
export function silhouettePad(blur: number): number {
  return Math.ceil(blur * 3) + 6;
}

/**
 * Blurs one channel of a pixel grid in place with three box passes, which is very close to a Gaussian of the
 * given radius. Used where the canvas has no blur filter.
 */
export function blurField(field: Float32Array, width: number, height: number, radius: number): Float32Array {
  // Three box passes of half-width r have the spread sqrt(r * r + r). Solve that for the radius asked for.
  const r = Math.max(0, Math.round(Math.sqrt(radius * radius + 0.25) - 0.5));
  if (r === 0 || width === 0 || height === 0) return field;
  const scratch = new Float32Array(field.length);
  const pass = (source: Float32Array, target: Float32Array, count: number, stride: number, lines: number, lineStride: number) => {
    const window = r * 2 + 1;
    for (let line = 0; line < lines; line += 1) {
      const base = line * lineStride;
      let sum = 0;
      for (let i = -r; i <= r; i += 1) sum += source[base + Math.min(count - 1, Math.max(0, i)) * stride] as number;
      for (let i = 0; i < count; i += 1) {
        target[base + i * stride] = sum / window;
        const leave = Math.max(0, i - r);
        const enter = Math.min(count - 1, i + r + 1);
        sum += (source[base + enter * stride] as number) - (source[base + leave * stride] as number);
      }
    }
  };
  for (let round = 0; round < 3; round += 1) {
    pass(field, scratch, width, 1, height, width);
    pass(scratch, field, height, width, width, 1);
  }
  return field;
}

/** A rectangle with round corners as a path on the context. */
export function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.arcTo(x + width, y, x + width, y + r, r);
  ctx.lineTo(x + width, y + height - r);
  ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
  ctx.lineTo(x + r, y + height);
  ctx.arcTo(x, y + height, x, y + height - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function supportsFilter(ctx: CanvasRenderingContext2D): boolean {
  return typeof (ctx as { filter?: unknown }).filter === 'string';
}

/**
 * Draws a shape and turns it into a soft outline field.
 *
 * `draw` gets a context whose origin is the top left corner of the drawing, with white as fill and stroke.
 * Whatever it paints is paper. It may paint past the drawing's box into the padding: a standing cut-out should
 * run on below its foot, so the foot is a clean line on the map and not a torn one.
 */
export function makeSilhouette(draw: Draw2D, blur: number, size: SilhouetteSize): Silhouette {
  const width = Math.max(1, Math.round(size.width));
  const height = Math.max(1, Math.round(size.height));
  const pad = Math.max(0, Math.round(size.pad ?? silhouettePad(blur)));
  const fullWidth = width + pad * 2;
  const fullHeight = height + pad * 2;

  const sharp = document.createElement('canvas');
  sharp.width = fullWidth;
  sharp.height = fullHeight;
  const sharpCtx = sharp.getContext('2d');
  if (!sharpCtx) throw new Error('makeSilhouette: no 2D canvas');
  sharpCtx.fillStyle = '#000';
  sharpCtx.fillRect(0, 0, fullWidth, fullHeight);
  sharpCtx.save();
  sharpCtx.translate(pad, pad);
  sharpCtx.fillStyle = '#fff';
  sharpCtx.strokeStyle = '#fff';
  draw(sharpCtx, width, height);
  sharpCtx.restore();

  const canvas = document.createElement('canvas');
  canvas.width = fullWidth;
  canvas.height = fullHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('makeSilhouette: no 2D canvas');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, fullWidth, fullHeight);

  if (blur <= 0) {
    ctx.drawImage(sharp, 0, 0);
  } else if (supportsFilter(ctx)) {
    ctx.filter = `blur(${blur}px)`;
    ctx.drawImage(sharp, 0, 0);
    ctx.filter = 'none';
  } else {
    const image = sharpCtx.getImageData(0, 0, fullWidth, fullHeight);
    const field = new Float32Array(fullWidth * fullHeight);
    for (let i = 0; i < field.length; i += 1) field[i] = image.data[i * 4] as number;
    blurField(field, fullWidth, fullHeight, blur);
    for (let i = 0; i < field.length; i += 1) {
      const value = Math.round(field[i] as number);
      image.data[i * 4] = value;
      image.data[i * 4 + 1] = value;
      image.data[i * 4 + 2] = value;
      image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }

  let pixels: Uint8ClampedArray | null = null;
  return {
    canvas,
    width,
    height,
    pad,
    blur,
    valueAt(u, v) {
      if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return 0;
      pixels ??= ctx.getImageData(0, 0, fullWidth, fullHeight).data;
      const x = Math.min(fullWidth - 1, Math.round(pad + u * (width - 1)));
      const y = Math.min(fullHeight - 1, Math.round(pad + (1 - v) * (height - 1)));
      return (pixels[(y * fullWidth + x) * 4] as number) / 255;
    },
  };
}
