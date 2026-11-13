import { withAlpha } from '../look/theme';
import type { Draw2D } from '../paper/silhouette';

/**
 * The brush: one way of drawing for every cut-out in this folder.
 *
 * A drawing is written once and used twice. In the first pass every `piece` is filled in white, which gives the
 * outline the paper is cut along. In the second pass the same pieces are printed in their colours and the
 * `tone` and `line` calls add what is printed on the paper. A drawing can therefore never have print outside
 * its own paper, and its outline can never drift away from its print.
 *
 * Drawings are measured in hundredths of a scene unit: x runs to the right from the left edge, y runs up from
 * the foot. A standing cut-out lets its pieces run a little below y = 0, so its foot is a clean line on the
 * map. Colours are always tokens of the theme, with an alpha where a tone is printed over another.
 */
export type Path = (ctx: CanvasRenderingContext2D) => void;

/** Drawing units per scene unit. */
export const DESIGN = 100;

/** How far a piece is printed past its own outline, so a torn edge never shows an unprinted fringe. */
const BLEED = 1.6;

export interface Brush {
  readonly ctx: CanvasRenderingContext2D;
  /** Size of the drawing in drawing units. */
  readonly width: number;
  readonly height: number;
  /** True in the pass that cuts the outline. Print-only work can be skipped then. */
  readonly cutting: boolean;
  /** A piece of paper in one colour. Pieces make up the outline. */
  piece(color: string, path: Path): void;
  /** A flat tone printed on the paper. It adds nothing to the outline. */
  tone(color: string, alpha: number, path: Path): void;
  /** A printed line. `width` is in drawing units. */
  line(color: string, alpha: number, width: number, path: Path): void;
  /** Keeps everything drawn in `body` inside `path`. */
  inside(path: Path, body: () => void): void;
  /**
   * Runs `body` with y pointing down from the top edge, the way type is set. Without this, text would be
   * printed upside down. Only the print pass runs it.
   */
  upright(body: (ctx: CanvasRenderingContext2D) => void): void;
}

export type Drawing = (brush: Brush) => void;

/** A drawing with its name and its size in drawing units. Each module lists its drawings this way for checks. */
export interface NamedDrawing {
  readonly name: string;
  readonly draw: Drawing;
  readonly width: number;
  readonly height: number;
}

function createBrush(ctx: CanvasRenderingContext2D, width: number, height: number, cutting: boolean): Brush {
  return {
    ctx,
    width,
    height,
    cutting,
    piece(color, path) {
      ctx.beginPath();
      path(ctx);
      if (cutting) {
        ctx.fillStyle = '#fff';
        ctx.fill();
        return;
      }
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = BLEED;
      ctx.lineJoin = 'round';
      ctx.stroke();
    },
    tone(color, alpha, path) {
      if (cutting) return;
      ctx.beginPath();
      path(ctx);
      ctx.fillStyle = alpha >= 1 ? color : withAlpha(color, alpha);
      ctx.fill();
    },
    line(color, alpha, lineWidth, path) {
      if (cutting) return;
      ctx.beginPath();
      path(ctx);
      ctx.strokeStyle = alpha >= 1 ? color : withAlpha(color, alpha);
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    },
    inside(path, body) {
      ctx.save();
      ctx.beginPath();
      path(ctx);
      ctx.clip();
      body();
      ctx.restore();
    },
    upright(body) {
      if (cutting) return;
      ctx.save();
      ctx.translate(0, height);
      ctx.scale(1, -1);
      body(ctx);
      ctx.restore();
    },
  };
}

/** Runs a drawing on a canvas of `pxWidth` pixels for a drawing `width` units wide. */
function run(drawing: Drawing, width: number, height: number, cutting: boolean): Draw2D {
  return (ctx, pxWidth, pxHeight) => {
    const scale = pxWidth / width;
    ctx.save();
    ctx.translate(0, pxHeight);
    ctx.scale(scale, -scale);
    drawing(createBrush(ctx, width, height, cutting));
    ctx.restore();
  };
}

/** The two canvas drawings a sheet needs, from one brush drawing of `width` by `height` drawing units. */
export function sheetDrawings(drawing: Drawing, width: number, height: number): { readonly outline: Draw2D; readonly print: Draw2D } {
  return { outline: run(drawing, width, height, true), print: run(drawing, width, height, false) };
}

/** Plays a drawing straight onto a context, in drawing units. Tests use this with a recording context. */
export function playDrawing(drawing: Drawing, ctx: CanvasRenderingContext2D, width: number, height: number, cutting = false): void {
  drawing(createBrush(ctx, width, height, cutting));
}
