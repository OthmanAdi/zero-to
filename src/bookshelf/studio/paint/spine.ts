import { fitTitle, type TitleFit } from '../../shelf/title-fit';
import type { PaintedFace, Stamp } from '../types';
import { LABEL_INSET, spinePlan, spineTitleLength, type Rect } from './layout';
import type { LookInput, LookRules, Palette } from './look';
import { baseline, createPen, finish, fontOf, mark, setType, type Pen } from './pen';
import { isStamped } from './stamp';
import { ellipsize } from './wrap';

export type SpineTreatment = 'bands' | 'label' | 'plain';
export type DeviceShape = 'circle' | 'square' | 'lozenge' | 'shield';

export interface SpineJob {
  title: string;
  /** The number at the head, as the shelf prints it. */
  number: string;
  initial: string;
  done: boolean;
  treatment: SpineTreatment;
  shape: DeviceShape;
  look: LookInput;
  rules: LookRules;
  palette: Palette;
  stamp: Stamp;
  width: number;
  height: number;
  density: number;
}

/** Below this spine width the number at the head would fall under 9 px, so a look leaves it off. */
export const NARROW_SPINE = 40;

/** The title fitted to the spine as the shelf fits it (shelf.ts `fitSpine`). */
export function fitSpineTitle(job: Pick<SpineJob, 'title' | 'treatment' | 'look' | 'rules' | 'width' | 'height'>): TitleFit {
  const plan = spinePlan(job.width, job.height, job.rules);
  const length = spineTitleLength(plan, job.width, job.treatment === 'label');
  return fitTitle(job.title, { length, breadth: job.width }, job.look.spineTitle);
}

/** The outline of a device shape in `rect`, as the ::before of `.bb-spine__device` draws it. */
export function deviceShape(ctx: CanvasRenderingContext2D, shape: DeviceShape, rect: Rect): void {
  const { x, y, width: s } = rect;
  ctx.beginPath();
  if (shape === 'circle') {
    ctx.ellipse(x + s / 2, y + s / 2, s / 2, s / 2, 0, 0, Math.PI * 2);
  } else if (shape === 'square') {
    ctx.roundRect(x + 0.08 * s, y + 0.08 * s, 0.84 * s, 0.84 * s, 1);
  } else if (shape === 'lozenge') {
    ctx.save();
    ctx.translate(x + s / 2, y + s / 2);
    ctx.rotate(Math.PI / 4);
    ctx.roundRect(-0.35 * s, -0.35 * s, 0.7 * s, 0.7 * s, 1);
    ctx.restore();
  } else {
    const w = 0.8 * s;
    const h = 0.92 * s;
    ctx.roundRect(x + 0.1 * s, y + 0.04 * s, w, h, [
      { x: 1, y: 1 },
      { x: 1, y: 1 },
      { x: 0.5 * w, y: 0.42 * h },
      { x: 0.5 * w, y: 0.42 * h },
    ]);
  }
  ctx.fill();
}

/** The device with its initial knocked out in the cloth: the spine's, and the quiet one on the back. */
export function paintDevice(
  pen: Pen,
  rect: Rect,
  shape: DeviceShape,
  initial: string,
  ink: { colour: string; stamped: boolean },
  ground: string,
  type: { family: string; size: number },
): void {
  mark(pen, ink, (ctx) => deviceShape(ctx, shape, rect));
  if (!initial) return;
  const font = fontOf('normal', '600', type.size, type.family);
  const metrics = pen.metrics(font);
  const y = baseline(rect.y + (rect.height - type.size) / 2, type.size, type.size, metrics);
  mark(pen, { colour: ground, stamped: false }, (ctx) => {
    setType(ctx, font, 0);
    ctx.textAlign = 'center';
    ctx.fillText(initial, rect.x + rect.width / 2, y);
  });
}

export function paintSpine(job: SpineJob): PaintedFace {
  const { look, rules, palette, stamp, width: w, height: h } = job;
  const plan = spinePlan(w, h, rules);
  const pen = createPen(w, h, job.density);
  const pressed = (part: Parameters<typeof isStamped>[0]) => isStamped(part, stamp);

  mark(pen, { colour: palette.ground, stamped: false }, (ctx) => ctx.fillRect(0, 0, w, h));

  // The read check: a small L turned a quarter left, in the box kept for it at the head.
  if (job.done) {
    const size = Math.max(10, w * 0.24);
    const box = plan.done;
    const cx = w / 2;
    const cy = box.y + box.height / 2 - 0.075 * size;
    const bw = 0.55 * size;
    const bh = 0.3 * size;
    const line = Math.max(1.5, 0.12 * size);
    mark(pen, { colour: palette.lettering, stamped: pressed('lettering') }, (ctx) => {
      ctx.translate(cx, cy);
      ctx.rotate(-Math.PI / 4);
      ctx.beginPath();
      ctx.rect(-bw / 2, -bh / 2, line, bh);
      ctx.rect(-bw / 2, bh / 2 - line, bw, line);
      ctx.fill();
    });
  }

  // The number at the head.
  if (plan.mark && (rules.markBlock || w >= NARROW_SPINE)) {
    const { rect, size } = plan.mark;
    const font = fontOf('normal', '500', size, look.mono);
    const spacing = 0.06 * size;
    setType(pen.color, font, spacing);
    const text = job.number;
    const textWidth = pen.color.measureText(text).width;
    const metrics = pen.metrics(font);
    if (palette.markBlock) {
      const blockWidth = textWidth + 0.6 * size;
      const block: Rect = { x: (w - blockWidth) / 2, y: rect.y, width: blockWidth, height: rect.height };
      mark(pen, { colour: palette.markBlock, stamped: pressed('lettering') }, (ctx) => {
        ctx.beginPath();
        ctx.roundRect(block.x, block.y, block.width, block.height, 1);
        ctx.fill();
      });
      const y = baseline(rect.y + 0.25 * size, size, size, metrics);
      mark(pen, { colour: palette.markInk, stamped: false }, (ctx) => {
        setType(ctx, font, spacing);
        ctx.fillText(text, block.x + 0.3 * size, y);
      });
    } else {
      const y = baseline(rect.y, size, size, metrics);
      mark(pen, { colour: palette.markInk, alpha: palette.markAlpha, stamped: pressed('lettering') }, (ctx) => {
        setType(ctx, font, spacing);
        ctx.fillText(text, (w - textWidth) / 2, y);
      });
    }
  }

  // Bands at head and tail: a 4 px band between two hairlines.
  if (job.treatment === 'bands' && rules.bands) {
    mark(pen, { colour: palette.band, alpha: palette.bandAlpha, stamped: pressed('rule') }, (ctx) => {
      ctx.beginPath();
      for (const rule of plan.rules) {
        ctx.rect(rule.x, rule.y, rule.width, 1);
        ctx.rect(rule.x, rule.y + rule.height - 1, rule.width, 1);
      }
      ctx.fill();
    });
  }

  paintSpineTitle(pen, job, plan.title);

  paintDevice(
    pen,
    plan.device,
    job.shape,
    job.initial,
    { colour: palette.device, stamped: pressed('device') },
    palette.initial,
    { family: look.serif, size: Math.max(9, w * 0.26) },
  );
  return finish(pen);
}

/**
 * The title set along the spine. In vertical-rl the first line stands at the right and the type runs
 * from head to tail; a look that turns the title (Paper Row) reads it from tail to head instead, its
 * first line at the left.
 */
function paintSpineTitle(pen: Pen, job: SpineJob, box: Rect): void {
  const { look, rules, palette, stamp, width: w } = job;
  if (box.height <= 0) return;
  const fit = fitSpineTitle(job);
  const face = look.spineTitle;
  const size = fit.size;
  const font = fontOf('normal', face.weight, size, face.family);
  const spacing = face.letterSpacing * size;
  let lines = fit.lines.map((line) => (face.upper ? line.toUpperCase() : line));
  const line = size * (lines.length === 2 ? 1.02 : 1);
  const label = job.treatment === 'label';
  const padAlong = label ? LABEL_INSET * w : 0;
  const padAcross = label ? 0.08 * w : 0;
  const across = lines.length * line + 2 * padAcross;
  const metrics = pen.metrics(font);
  setType(pen.color, font, spacing);
  const measure = (text: string) => pen.color.measureText(text).width;
  // A title that could not be set whole ends in an ellipsis where the spine cuts it (`.is-clipped`).
  if (fit.clipped) lines = lines.map((text) => ellipsize(text, box.height - 2 * padAlong, measure));
  const longest = Math.max(...lines.map(measure));

  // Turn the context so x runs along the title and y across it, from its first line.
  const frame = (ctx: CanvasRenderingContext2D) => {
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.width, box.height);
    ctx.clip();
    if (rules.turned) {
      ctx.translate(w / 2 - across / 2, box.y + box.height);
      ctx.rotate(-Math.PI / 2);
    } else {
      ctx.translate(w / 2 + across / 2, box.y);
      ctx.rotate(Math.PI / 2);
    }
  };

  if (label) {
    const length = Math.min(box.height, longest + 2 * padAlong);
    mark(pen, { colour: palette.spinePaper, stamped: false }, (ctx) => {
      frame(ctx);
      ctx.beginPath();
      ctx.roundRect(0, 0, length, across, 1);
      ctx.fill();
    });
    mark(pen, { colour: 'rgba(0, 0, 0, 0.25)', stamped: false }, (ctx) => {
      frame(ctx);
      ctx.beginPath();
      ctx.rect(0, 0, length, across);
      ctx.rect(0.5, 0.5, length - 1, across - 1);
      ctx.fill('evenodd');
    });
  }

  const ink = label ? palette.spinePaperInk : palette.spineTitle;
  mark(pen, { colour: ink, stamped: !label && isStamped('lettering', stamp) }, (ctx) => {
    frame(ctx);
    setType(ctx, font, spacing);
    lines.forEach((text, index) => ctx.fillText(text, padAlong, baseline(padAcross + index * line, line, size, metrics)));
  });
}
