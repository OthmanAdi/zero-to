import type { PaintedFace, Stamp } from '../types';
import { coverPlan, labelBox, type CoverPlan, type Rect } from './layout';
import type { LookInput, LookRules, Palette } from './look';
import { baseline, createPen, finish, fontOf, image, mark, setType, type Pen } from './pen';
import { isStamped } from './stamp';
import { breakLines, clampLines, ellipsize } from './wrap';
import type { CoverLayout } from '../../shelf/cover-art';

/** What the CSS cover says about itself once createCover has built it. */
export interface CoverFacts {
  layout: CoverLayout;
  title: string;
  /** Title size in cqw and the most lines it may take, as cover-title fitted them. */
  size: number;
  clamp: number;
  /** A word is longer than the line: hyphenated rather than broken. */
  broken: boolean;
  author: string;
  imprint: string;
  done: boolean;
  /** The number printed at the outer corner of the foot. */
  number: string;
}

export interface FrontJob {
  facts: CoverFacts;
  look: LookInput;
  rules: LookRules;
  palette: Palette;
  stamp: Stamp;
  width: number;
  height: number;
  density: number;
  art: HTMLImageElement | null;
}

/** Plans the cover for `job`; exported so the art can be decoded at the size it is drawn. */
export function planFront(job: Pick<FrontJob, 'facts' | 'rules' | 'width' | 'height'>): CoverPlan {
  return coverPlan(job.facts.layout, job.width, job.height, job.rules);
}

function strokeFrame(ctx: CanvasRenderingContext2D, rect: Rect, line: number): void {
  // The rule lies inside its box, as a border does.
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.rect(rect.x + line, rect.y + line, rect.width - 2 * line, rect.height - 2 * line);
  ctx.fill('evenodd');
}

interface SetLines {
  lines: string[];
  font: string;
  size: number;
  spacing: number;
  leading: number;
}

function drawLines(pen: Pen, set: SetLines, top: number, box: Rect, align: 'start' | 'center', colour: string, stamped: boolean): void {
  const metrics = pen.metrics(set.font);
  const line = set.size * set.leading;
  mark(pen, { colour, stamped }, (ctx) => {
    setType(ctx, set.font, set.spacing);
    ctx.textAlign = align === 'center' ? 'center' : 'left';
    const x = align === 'center' ? box.x + box.width / 2 : box.x;
    set.lines.forEach((text, index) => ctx.fillText(text, x, baseline(top + index * line, line, set.size, metrics)));
  });
}

export function paintFront(job: FrontJob): PaintedFace {
  const { facts, look, palette, stamp, width, height } = job;
  const plan = planFront(job);
  const c = plan.unit;
  const pen = createPen(width, height, job.density);
  const pressed = (part: Parameters<typeof isStamped>[0]) => isStamped(part, stamp);

  // The board.
  mark(pen, { colour: palette.ground, stamped: false }, (ctx) => ctx.fillRect(0, 0, width, height));

  // Rules round the board come first, as the cover's ::before does.
  for (const frame of plan.frames) {
    mark(pen, { colour: frame.blind ? palette.boardLine : palette.frame, stamped: pressed('frame') }, (ctx) =>
      strokeFrame(ctx, frame.rect, frame.line),
    );
  }

  // The title block.
  if (plan.type) {
    const measureWith = (font: string, spacing: number) => (text: string) => {
      setType(pen.color, font, spacing);
      return pen.color.measureText(text).width;
    };
    const titleSize = Math.max(9, facts.size * c);
    const titleFont = fontOf('normal', '600', titleSize, look.serif);
    const titleSpacing = -0.012 * titleSize;
    const measureTitle = measureWith(titleFont, titleSpacing);
    const titleLines = clampLines(
      breakLines(facts.title, plan.head.width, measureTitle, { balance: true, hyphenate: facts.broken }),
      Math.max(1, facts.clamp),
      plan.head.width,
      measureTitle,
    );
    const title: SetLines = { lines: titleLines, font: titleFont, size: titleSize, spacing: titleSpacing, leading: 1.04 };
    let author: SetLines | null = null;
    if (facts.author) {
      const size = plan.authorSize;
      const font = fontOf('italic', '400', size, look.serif);
      const measureAuthor = measureWith(font, 0);
      author = {
        lines: clampLines(breakLines(facts.author, plan.head.width, measureAuthor), 2, plan.head.width, measureAuthor),
        font,
        size,
        spacing: 0,
        leading: 1.2,
      };
    }
    const blockHeight = (set: SetLines) => set.lines.length * set.size * set.leading;
    const content = blockHeight(title) + (author ? 3 * c + blockHeight(author) : 0);

    let top = plan.head.y;
    let ink = palette.coverTitle;
    let lettering = palette.lettering;
    let stamped = pressed('lettering');
    if (plan.label) {
      const box = labelBox(plan.label, content);
      // The paper label and its inner hairline at half strength, then its own ink.
      mark(pen, { colour: palette.paper, stamped: false }, (ctx) => ctx.fillRect(box.x, box.y, box.width, box.height));
      const inset = 2.5 * c;
      mark(pen, { colour: palette.paperInk, alpha: 0.5, stamped: false }, (ctx) =>
        strokeFrame(ctx, { x: box.x + inset, y: box.y + inset, width: box.width - 2 * inset, height: box.height - 2 * inset }, 0.75),
      );
      top = box.y + (box.height - content) / 2;
      ink = palette.paperInk;
      lettering = palette.paperInk;
      stamped = false;
    }
    drawLines(pen, title, top, plan.head, plan.align, ink, stamped);
    if (author) drawLines(pen, author, top + blockHeight(title) + 3 * c, plan.head, plan.align, lettering, stamped);
  }

  // The plate: a printed panel, the rule over it, and the drawing.
  const plate = plan.plate;
  if (plan.panel) {
    const band = facts.layout === 'band';
    const colour = band ? palette.bandPanel : palette.panel;
    const stamped = band && job.rules.bandFoil && pressed('block');
    mark(pen, { colour, stamped }, (ctx) => ctx.fillRect(plate.x, plate.y, plate.width, plate.height));
  } else if (plan.rule && job.rules.plateRule) {
    mark(pen, { colour: palette.plateRule, stamped: pressed('rule') }, (ctx) => ctx.fillRect(plate.x, plate.y, plate.width, 1));
  }
  if (job.art) image(pen, job.art, plan.art.x, plan.art.y, plan.art.width, plan.art.height);

  // The foot: imprint, read check and number.
  if (plan.foot && (facts.imprint || facts.done || (facts.number && look.coverMark))) {
    const foot = plan.foot;
    const imprintSize = Math.max(9, 4.4 * c);
    const imprintFont = fontOf('italic', '400', imprintSize, look.serif);
    const imprintSpacing = 0.02 * imprintSize;
    setType(pen.color, imprintFont, imprintSpacing);
    const imprint = facts.imprint ? ellipsize(facts.imprint, foot.width * 0.74, (text) => pen.color.measureText(text).width) : '';
    const imprintWidth = imprint ? pen.color.measureText(imprint).width : 0;
    const tick = facts.done ? Math.max(9, 4.4 * c) : 0;
    const gap = 2 * c;
    const lineBox = imprint ? 1.2 * imprintSize : 0;
    const footHeight = Math.max(lineBox, tick);
    const footTop = foot.bottom - footHeight;
    const row = imprintWidth + (imprint && tick ? gap : 0) + tick;
    let x = foot.align === 'center' ? foot.x + (foot.width - row) / 2 : foot.x;
    const stamped = pressed('lettering');
    if (imprint) {
      const metrics = pen.metrics(imprintFont);
      const y = baseline(footTop + (footHeight - lineBox) / 2, lineBox, imprintSize, metrics);
      const at = x;
      mark(pen, { colour: palette.lettering, stamped }, (ctx) => {
        setType(ctx, imprintFont, imprintSpacing);
        ctx.fillText(imprint, at, y);
      });
      x += imprintWidth + (tick ? gap : 0);
    }
    if (tick) {
      const k = tick / 12;
      const left = x;
      const top = footTop + (footHeight - tick) / 2;
      mark(pen, { colour: palette.lettering, stamped }, (ctx) => {
        ctx.lineWidth = 1.5 * k;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(left + 2.4 * k, top + 6.6 * k);
        ctx.lineTo(left + 4.9 * k, top + 9 * k);
        ctx.lineTo(left + 9.8 * k, top + 3.2 * k);
        ctx.stroke();
      });
    }
    if (facts.number && look.coverMark) {
      const size = Math.max(9, 4.2 * c);
      const font = fontOf('normal', '500', size, look.mono);
      const metrics = pen.metrics(font);
      const line = 1.2 * size;
      const y = baseline(foot.bottom - line, line, size, metrics);
      mark(pen, { colour: palette.lettering, stamped }, (ctx) => {
        setType(ctx, font, 0.06 * size);
        // Letter spacing follows the last figure too, so the box ends a spacing past it.
        const width = ctx.measureText(facts.number).width;
        ctx.fillText(facts.number, foot.x + foot.width - width, y);
      });
    }
  }
  return finish(pen);
}
