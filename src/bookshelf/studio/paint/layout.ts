import type { CoverLayout } from '../../shelf/cover-art';

/**
 * Where everything on a face goes, in CSS px of the face, worked out from the same grid the stylesheet
 * uses (shelf.css for the spine, cover.css and variants.css for the cover). Pure: no page, no canvas.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Longest side of any canvas, in device px. */
export const MAX_SIDE = 2048;

export interface CanvasSize {
  width: number;
  height: number;
  /** Device px per CSS px across and down. They differ from the density only by rounding or the clamp. */
  scaleX: number;
  scaleY: number;
}

/**
 * The canvas for a face `width` by `height` CSS px at `density` device px per CSS px. A side longer than
 * `MAX_SIDE` scales the whole face down, so its pixels stay square.
 */
export function canvasSize(width: number, height: number, density: number): CanvasSize {
  const w = Number.isFinite(width) && width > 0 ? width : 1;
  const h = Number.isFinite(height) && height > 0 ? height : 1;
  const d = Number.isFinite(density) && density > 0 ? density : 1;
  const k = Math.min(d, MAX_SIDE / w, MAX_SIDE / h);
  const cw = Math.min(MAX_SIDE, Math.max(1, Math.round(w * k)));
  const ch = Math.min(MAX_SIDE, Math.max(1, Math.round(h * k)));
  return { width: cw, height: ch, scaleX: cw / w, scaleY: ch / h };
}

/** What a look changes about where things go. */
export interface LookGeometry {
  /** Space between the parts of a spine, in spine widths. */
  spineGap: number;
  /** The spine shows its number at the head (`--bb-spine-mark: 1`). */
  spineMark: boolean;
  /** The number is printed reversed out of a small block (Pocket Paperbacks). */
  markBlock: boolean;
  /** The plate of a plate cover runs off both edges as a printed panel (Pocket Paperbacks). */
  platePanel: boolean;
  /** A line tooled round the board of every cover but the frame (Oak Library). */
  boardLine: boolean;
}

// ---------- spine ----------

export interface SpinePlan {
  /** Room for the read check at the head. Always kept, so marking a link read never moves the title. */
  done: Rect;
  /** The number at the head, when the look prints one: its box and its type size. */
  mark: { rect: Rect; size: number } | null;
  /** The bands above and below the title. */
  rules: [Rect, Rect];
  /** The room the title is set in, along the spine. */
  title: Rect;
  device: Rect;
}

/** The parts of a spine stacked from head to tail, as the flex column in shelf.css stacks them. */
export function spinePlan(width: number, height: number, look: LookGeometry): SpinePlan {
  const pad = width * 0.2;
  const gap = width * look.spineGap;
  const doneHeight = Math.max(10, width * 0.2);
  const markSize = Math.max(9, width * 0.17);
  const markHeight = look.spineMark ? (look.markBlock ? markSize * 1.45 : markSize) : 0;
  const ruleHeight = 4;
  const ruleWidth = width * 0.62;
  const deviceSize = Math.max(14, width * 0.44);

  let y = pad;
  const done: Rect = { x: 0, y, width, height: doneHeight };
  y += doneHeight + gap;
  let mark: SpinePlan['mark'] = null;
  if (look.spineMark) {
    mark = { rect: { x: 0, y, width, height: markHeight }, size: markSize };
    y += markHeight + gap;
  }
  const rule = (top: number): Rect => ({ x: (width - ruleWidth) / 2, y: top, width: ruleWidth, height: ruleHeight });
  const head = rule(y);
  y += ruleHeight + gap;
  const device: Rect = { x: (width - deviceSize) / 2, y: height - pad - deviceSize, width: deviceSize, height: deviceSize };
  const tail = rule(device.y - gap - ruleHeight);
  const titleEnd = tail.y - gap;
  return { done, mark, rules: [head, tail], title: { x: 0, y, width, height: Math.max(0, titleEnd - y) }, device };
}

/** Share of the measured room a fitted spine title may fill (TITLE_ROOM in shelf.ts). */
export const TITLE_ROOM = 0.97;
/** Room a pasted label keeps round its title along the spine, in spine widths, at each end. */
export const LABEL_INSET = 0.16;

/** Length a spine title may take, as the shelf works it out before fitting the title to it. */
export function spineTitleLength(plan: SpinePlan, width: number, label: boolean): number {
  return plan.title.height * TITLE_ROOM - (label ? 2 * LABEL_INSET * width : 0);
}

// ---------- cover ----------

export interface Frame {
  /** The outer edge of the rule. */
  rect: Rect;
  /** Its thickness, drawn inward from `rect`. */
  line: number;
  /** A tooled line pressed into the board rather than a printed rule. */
  blind: boolean;
}

export interface CoverPlan {
  layout: CoverLayout;
  /** One cqw: a hundredth of the cover's width, in px. */
  unit: number;
  /** The content box of the title block. For a label it is the widest the label's type may run. */
  head: Rect;
  align: 'start' | 'center';
  /** The paper label of a label cover, before its height is known: its left, width and bottom. */
  label: { x: number; width: number; bottom: number; min: number; max: number; padX: number; padY: number } | null;
  plate: Rect;
  /** The plate is a printed panel of the art colour (a band, or Pocket's plate). */
  panel: boolean;
  /** A rule over the plate in the art colour. */
  rule: boolean;
  /** Where the drawing is shown, whole and centred (`meet`). */
  art: Rect;
  /** The line at the foot: left, width, the bottom of its line box, and how it is set. Null when left off. */
  foot: { x: number; width: number; bottom: number; align: 'start' | 'center' } | null;
  frames: Frame[];
  /** False on a cover so small that its type is left off (`width < 120px`). */
  type: boolean;
  /** Author type size in px; the 9 px floor only holds on a small cover, as in the stylesheet. */
  authorSize: number;
}

/** Hairline rules on the cover are one CSS px (`calc(1px * var(--bb-cover-k, 1))`). */
const HAIRLINE = 1;

export function coverPlan(layout: CoverLayout, width: number, height: number, look: LookGeometry): CoverPlan {
  const c = width / 100;
  const H = height;
  const small = width < 170;
  const plan: CoverPlan = {
    layout,
    unit: c,
    head: { x: 12 * c, y: 10 * c, width: 79 * c, height: 0.47 * H - 10 * c },
    align: 'start',
    label: null,
    plate: { x: 12 * c, y: 0.5 * H, width: 79 * c, height: H - 14 * c - 0.5 * H },
    panel: false,
    rule: true,
    art: { x: 0, y: 0, width: 0, height: 0 },
    foot: small ? null : { x: 12 * c, width: 79 * c, bottom: H - 5 * c, align: 'start' },
    frames: [],
    type: width >= 120,
    authorSize: small ? Math.max(9, 5.6 * c) : 5.6 * c,
  };

  if (layout === 'plate') {
    if (look.platePanel) {
      plan.plate = { x: 0, y: 0.5 * H, width, height: H - 13 * c - 0.5 * H };
      plan.panel = true;
      plan.rule = false;
      plan.art = { x: 12 * c, y: plan.plate.y + 5 * c, width: width - 21 * c, height: plan.plate.height - 10 * c };
    } else {
      // The art hangs 5cqw under the rule, inside the plate's padding box (below its 1px border).
      const top = plan.plate.y + HAIRLINE;
      plan.art = { x: plan.plate.x, y: top + 5 * c, width: plan.plate.width, height: plan.plate.height - HAIRLINE - 5 * c };
    }
  } else if (layout === 'label') {
    plan.align = 'center';
    plan.head = { x: 13 * c + 6 * c, y: 0, width: 77 * c - 12 * c, height: 0 };
    plan.label = { x: 13 * c, width: 77 * c, bottom: 0.47 * H, min: 0.29 * H, max: 0.47 * H - 6 * c, padX: 6 * c, padY: 5.5 * c };
    plan.plate = { x: 27.5 * c, y: 0.735 * H - 31 * c, width: 48 * c, height: 48 * c };
    plan.rule = false;
    plan.art = { ...plan.plate };
    if (plan.foot) plan.foot.align = 'center';
  } else if (layout === 'band') {
    plan.plate = { x: 0, y: 0, width, height: 0.47 * H };
    plan.panel = true;
    plan.rule = false;
    plan.art = { ...plan.plate };
    plan.head = { x: 12 * c, y: 0.47 * H + 8 * c, width: 79 * c, height: H - 13 * c - (0.47 * H + 8 * c) };
  } else {
    plan.align = 'center';
    plan.head = { x: 19 * c, y: 16 * c, width: 67 * c, height: 0.735 * H - 31.5 * c - 16 * c };
    plan.plate = { x: 33.5 * c, y: 0.735 * H - 27.5 * c, width: 38 * c, height: 38 * c };
    plan.rule = false;
    plan.art = { ...plan.plate };
    if (plan.foot) plan.foot = { x: 19 * c, width: 67 * c, bottom: H - 11 * c, align: 'center' };
    // A double rule: a 1px border, and inside it a half-pixel outline offset by -(1.6cqw + 1.5px).
    const outer: Rect = { x: 11 * c, y: 6 * c, width: width - 17 * c, height: H - 12 * c };
    const inset = 1.6 * c + 1.5 - 0.5;
    plan.frames.push({ rect: outer, line: HAIRLINE, blind: false });
    plan.frames.push({
      rect: { x: outer.x + inset, y: outer.y + inset, width: outer.width - 2 * inset, height: outer.height - 2 * inset },
      line: 0.5,
      blind: false,
    });
  }

  if (look.boardLine && layout !== 'frame') {
    plan.frames.push({
      rect: { x: 8.5 * c, y: 4.5 * c, width: width - 13 * c, height: H - 9 * c },
      line: HAIRLINE,
      blind: true,
    });
  }
  return plan;
}

/** The label's box once the height of its type is known: it grows upward from its foot, within its limits. */
export function labelBox(label: NonNullable<CoverPlan['label']>, content: number): Rect {
  const height = Math.min(label.max, Math.max(label.min, content + 2 * label.padY));
  return { x: label.x, y: label.bottom - height, width: label.width, height };
}

// ---------- back ----------

/** The small device near the foot of the back board, which is seen with its spine edge on the right. */
export function backDevice(width: number, height: number): Rect {
  const c = width / 100;
  const size = Math.max(10, 8 * c);
  // The margins of the front mirrored: the wider one is at the spine.
  const centre = (9 * c + (width - 12 * c)) / 2;
  return { x: centre - size / 2, y: height - 9 * c - size, width: size, height: size };
}
