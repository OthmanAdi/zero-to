import type { UiLang } from '../i18n';
import { createRandom } from '../core/random';
import { drawBrandMark, drawWordmark } from '../look/brand';
import { formatHours, formatNumber } from '../look/format';
import { THEME, mix, withAlpha } from '../look/theme';
import { canvasFont, drawText, measureTextWidth } from '../look/type';
import type { TierName } from '../scene/palette';
import { levelIndexAt, markTrail, trailPointAt, type ContourLevel, type Ring } from '../terrain';
import { GROW } from './grow';
import type { SheetPrint } from './sheet-data';
import { say, tierKey } from './strings';
import { estimateTextWidth, layoutTitle, type TitleBox, type TitleLayout } from './title';

/**
 * The cover of a pocket map, printed on a canvas per roadmap. Layout is worked out as plain numbers first
 * (`coverLayout`), so it can be tested without a canvas, and painted second (`paintCover`).
 *
 * Sizes: the sheet body is 4.06 by 5.46 scene units and the canvas is 690 by 920 pixels at scale 1.
 */
export const COVER = {
  width: 690,
  height: 920,
  /** The sheet as the scene contract has it, and the bevelled body that is drawn. */
  sheet: { width: 4.2, depth: 5.6 },
  body: { width: 4.06, depth: 5.46, radius: 0.12 },
  /** Depths of the zones from the top edge, in scene units. */
  margin: 0.09,
  /**
   * From the margin to the field. The title keeps to the upper `titleBand` of it; below that lies the strip a
   * standing mountain takes on the screen when the hero camera looks across it, so the summit stays clear of
   * the title. With a band of 0.95 and a data row of 0.65, a mountain of 16 to 20 cards stood 35 to 45 px into
   * the title at the hero camera's 31 degrees, so 0.2 of the data row went to that strip.
   */
  topBand: 1.15,
  titleBand: 0.95,
  field: GROW.size,
  dataRow: 0.45,
} as const;

/**
 * Where the hero camera stands, seen from the middle of the lit sheet's cover: x to the right, y up, z toward
 * the lower edge, in scene units of a sheet at full size. It is the fitted pose of a 1440 by 900 window, which
 * looks down onto the far edge of the field at about 37 degrees, the flattest view of a cover the hero takes;
 * phones look down more steeply. The cover works out from here how far up it a standing mountain reaches.
 */
export const COVER_EYE = { x: -0.81, y: 11.77, z: 14.07 } as const;

/**
 * What stands on a full-grown mountain, in scene units, as the terrain model builds it: a hovered card lifts
 * itself and all above it, flag poles at the camps and the summit with their flags, the gate. Paper trees and
 * stones stand anywhere on forest and scree cards; their positions are the model's own, so the outline of such
 * a card is lifted by what a tree near the edge adds on the screen (measured on the gallery: up to 13 px, about
 * 0.06 of height), not by the tallest tree. `margin` takes every height a little larger, for windows that look
 * at the cover from a little lower than `COVER_EYE` (an 800 by 900 window: 36 degrees instead of 37).
 */
export const COVER_REACH = {
  hover: 0.025,
  tree: 0.07,
  stone: 0.03,
  camp: { pole: 0.19, flag: 0.1 },
  summit: { pole: 0.3, flag: 0.15 },
  gate: { post: 0.15, half: 0.1 },
  margin: 1.05,
  /** Columns across the cover the reach is kept in. */
  columns: 46,
  /** Room between a title glyph and the mountain, in canvas pixels. */
  gap: 6,
} as const;

/** Canvas pixels per scene unit, across and down. */
const UX = COVER.width / COVER.body.width;
const UY = COVER.height / COVER.body.depth;

/** How far the middle of the field lies below the middle of the sheet, in scene units (toward the lower edge). */
export const FIELD_OFFSET = COVER.margin + COVER.topBand + COVER.field / 2 - COVER.body.depth / 2;

export interface CoverSpec {
  readonly title: string;
  /** Language of the roadmap, for line breaking and letter shapes. */
  readonly lang: string;
  /** Place on the table, 1 for the roadmap that was opened. */
  readonly number: number;
  readonly tier: TierName;
  readonly stages: number;
  readonly minutes: number;
  /** Share of the minutes that are done, 0 to 1. */
  readonly share: number;
  readonly example: boolean;
  /** Measures the title. Without it widths are estimated, which is what tests use. */
  readonly measure?: (text: string, fontPx: number) => number;
}

export interface CoverText {
  readonly text: string;
  readonly x: number;
  /** Baseline. */
  readonly y: number;
  readonly px: number;
  readonly align: 'left' | 'center' | 'right';
}

export interface CoverRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface CoverLayout {
  readonly width: number;
  readonly height: number;
  /** The cover cloth of the target tier, and the colour everything is printed in. */
  readonly board: string;
  readonly ink: string;
  readonly mark: { readonly x: number; readonly y: number; readonly size: number };
  readonly wordmark: { readonly x: number; readonly y: number; readonly px: number };
  readonly number: CoverText;
  readonly example: CoverText | null;
  readonly titleBox: CoverRect;
  readonly title: TitleLayout & { readonly x: number; readonly y: number };
  /** The square the mountain grows in. */
  readonly field: CoverRect;
  /** The paper of the model inside the field. */
  readonly paper: CoverRect;
  readonly rule: number;
  readonly data: readonly CoverText[];
  readonly bar: CoverRect & { readonly share: number };
  readonly percent: CoverText;
}

const PAD = 38;
const TITLE_PX = 54;
const TITLE_LEADING = 1.06;

/** How a title is set in its box: at most three lines, shrinking from 100 to 56 percent. */
function titleSetting(spec: CoverSpec, box: CoverRect): TitleBox {
  return {
    width: box.width,
    height: box.height,
    fontPx: TITLE_PX,
    lineHeight: TITLE_LEADING,
    maxLines: 3,
    minScale: 0.56,
    measure: spec.measure ?? estimateTextWidth,
  };
}

/** Where everything on a cover goes, in canvas pixels at scale 1. */
export function coverLayout(spec: CoverSpec, lang: UiLang): CoverLayout {
  const top = COVER.margin * UY;
  const bandBottom = (COVER.margin + COVER.topBand) * UY;
  const titleBottom = (COVER.margin + COVER.titleBand) * UY;
  const fieldSize = { width: COVER.field * UX, height: COVER.field * UY };
  const field: CoverRect = { x: (COVER.width - fieldSize.width) / 2, y: bandBottom, width: fieldSize.width, height: fieldSize.height };
  const paperShare = 1 - 0.06;
  const paper: CoverRect = {
    x: field.x + (field.width * (1 - paperShare)) / 2,
    y: field.y + (field.height * (1 - paperShare)) / 2,
    width: field.width * paperShare,
    height: field.height * paperShare,
  };
  const rowTop = field.y + field.height;

  const brandBaseline = top + 37;
  const titleBox: CoverRect = { x: PAD, y: top + 50, width: COVER.width - 2 * PAD, height: titleBottom - (top + 50) - 8 };
  const title = layoutTitle(spec.title, spec.lang, titleSetting(spec, titleBox));

  const number: CoverText = {
    text: say('number', { n: String(Math.max(1, Math.round(spec.number))).padStart(2, '0') }, lang).toUpperCase(),
    x: COVER.width - PAD,
    y: brandBaseline - 3,
    px: 13,
    align: 'right',
  };
  const example: CoverText | null = spec.example
    ? { text: say('example', undefined, lang).toUpperCase(), x: COVER.width - PAD - 92, y: brandBaseline - 3, px: 11, align: 'right' }
    : null;

  const dataY = rowTop + 35;
  const tierName = say(tierKey(spec.tier), undefined, lang);
  const columns = [
    say('stages', { count: Math.max(0, Math.round(spec.stages)) }, lang),
    formatHours(spec.minutes, { lang, unit: 'hours' }),
    say('toTier', { tier: tierName }, lang),
  ];
  const data: CoverText[] = columns.map((text, index) => ({
    text: text.toUpperCase(),
    x: PAD + ((COVER.width - 2 * PAD - 44) * index) / columns.length,
    y: dataY,
    px: 13,
    align: 'left' as const,
  }));
  // The language code is a code, not roadmap text: it is set like the other labels.
  data.push({ text: spec.lang.slice(0, 2).toUpperCase(), x: COVER.width - PAD, y: dataY, px: 13, align: 'right' });

  const share = Number.isFinite(spec.share) ? Math.min(1, Math.max(0, spec.share)) : 0;
  const percentText = `${formatNumber(Math.round(share * 100), { lang, fraction: 0 })} %`;
  const barY = rowTop + 52;
  const bar = { x: PAD, y: barY, width: COVER.width - 2 * PAD - 64, height: 4, share };

  return {
    width: COVER.width,
    height: COVER.height,
    board: THEME.cover[spec.tier] ?? THEME.cover.bronze,
    ink: THEME.paperHi,
    mark: { x: PAD - 3, y: brandBaseline - 25, size: 30 },
    wordmark: { x: PAD + 34, y: brandBaseline - 3, px: 21 },
    number,
    example,
    titleBox,
    title: { ...title, x: PAD, y: titleBox.y + titleBox.height - title.height },
    field,
    paper,
    rule: rowTop + 11,
    data,
    bar,
    percent: { text: percentText, x: COVER.width - PAD, y: barY + 8, px: 13, align: 'right' },
  };
}

/**
 * How far up the cover the full-grown mountain of a print reaches as the hero camera sees it, in canvas pixels
 * at scale 1: for each of `COVER_REACH.columns` columns across the cover, the smallest y it covers, or the
 * cover's height where it covers nothing above the field. Every card's outline is lifted to the top of its card
 * (with the hover lift and what stands on it) and projected from `COVER_EYE` back onto the cover.
 */
export function coverReach(print: SheetPrint, eye: { readonly x: number; readonly y: number; readonly z: number } = COVER_EYE): Float64Array {
  const columns = COVER_REACH.columns;
  const columnWidth = COVER.width / columns;
  const reach = new Float64Array(columns).fill(COVER.height);
  const half = print.half;
  const thickness = GROW.thickness;
  const fieldZ = FIELD_OFFSET;
  // Steps along an outline short enough that no column is jumped over.
  const stride = (columnWidth / UX / half) * 0.45;

  const mark = (x: number, z: number, height: number): void => {
    const lift = height * COVER_REACH.margin;
    if (lift >= eye.y) return;
    const k = eye.y / (eye.y - lift);
    const sx = eye.x + (x * half - eye.x) * k;
    const sz = eye.z + (fieldZ + z * half - eye.z) * k;
    const u = (sx / COVER.body.width + 0.5) * COVER.width;
    const v = (sz / COVER.body.depth + 0.5) * COVER.height;
    if (!(u >= 0 && u < COVER.width)) return;
    const column = Math.min(columns - 1, Math.floor(u / columnWidth));
    if (v < (reach[column] as number)) reach[column] = v;
  };
  const line = (ax: number, az: number, bx: number, bz: number, height: number): void => {
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / stride));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      mark(ax + (bx - ax) * t, az + (bz - az) * t, height);
    }
  };

  print.levels.forEach((level, card) => {
    const kind = print.surfaces[card];
    const standing = kind === 'forest' ? COVER_REACH.tree : kind === 'scree' ? COVER_REACH.stone : 0;
    const height = (card + 1) * thickness + COVER_REACH.hover + standing;
    for (const polygon of level.polygons) {
      const ring = polygon.outer;
      for (let i = 0; i < ring.length; i += 1) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        if (a && b) line(a.x, a.z, b.x, b.z, height);
      }
    }
  });

  // Flags fly to the right of their poles; the gate is two posts and a bar across the trail.
  const stops = print.trail.stops;
  stops.forEach((stop, index) => {
    const card = Math.max(0, levelIndexAt(print.levels, stop.x, stop.z));
    const ground = (card + 1) * thickness + COVER_REACH.hover;
    if (index === 0) {
      const reachAcross = COVER_REACH.gate.half / half;
      line(stop.x - reachAcross, stop.z, stop.x + reachAcross, stop.z, ground + COVER_REACH.gate.post);
      return;
    }
    const { pole, flag } = index === stops.length - 1 ? COVER_REACH.summit : COVER_REACH.camp;
    line(stop.x, stop.z, stop.x + flag / half, stop.z, ground + pole);
  });
  return reach;
}

/** The highest point of a reach (the smallest y) over a stretch of the cover, in canvas pixels. */
function reachOver(reach: ArrayLike<number>, x0: number, x1: number): number {
  const columnWidth = COVER.width / reach.length;
  const from = Math.max(0, Math.floor((x0 - 4) / columnWidth));
  const to = Math.min(reach.length - 1, Math.floor((x1 + 4) / columnWidth));
  let lowest: number = COVER.height;
  for (let column = from; column <= to; column += 1) lowest = Math.min(lowest, reach[column] as number);
  return lowest;
}

/**
 * The layout with its title set clear of the mountain that will stand in front of it (`coverReach`). The title
 * stays at the foot of its box while every line clears the mountain where that line runs; otherwise it moves
 * up, then shrinks as far as 56 percent, then keeps to the strip above the highest point and ends in an
 * ellipsis. A cover whose mountain stays clear keeps the title `coverLayout` gave it.
 */
export function clearTitle(layout: CoverLayout, spec: CoverSpec, reach: ArrayLike<number>): CoverLayout {
  const box = layout.titleBox;
  const setting = titleSetting(spec, box);
  const measure = setting.measure ?? estimateTextWidth;
  const rtl = layout.title.direction === 'rtl';
  const gap = COVER_REACH.gap;

  /** The top of the block for these lines at this size, or null when no place in the box clears the mountain. */
  const place = (lines: readonly string[], fontPx: number): number | null => {
    const lineHeight = fontPx * TITLE_LEADING;
    let top = box.y + box.height - lines.length * lineHeight;
    lines.forEach((line, index) => {
      const width = measure(line, fontPx);
      const x0 = rtl ? box.x + box.width - width : box.x;
      top = Math.min(top, reachOver(reach, x0, x0 + width) - gap - (index + 1) * lineHeight);
    });
    return top >= box.y - 0.5 ? top : null;
  };

  let title = layoutTitle(spec.title, spec.lang, { ...setting, fits: (lines, fontPx) => place(lines, fontPx) !== null });
  let top = place(title.lines, title.fontPx);
  if (top === null) {
    const room = reachOver(reach, box.x, box.x + box.width) - gap - box.y;
    const least = TITLE_PX * (setting.minScale ?? 0.56) * TITLE_LEADING;
    title = layoutTitle(spec.title, spec.lang, { ...setting, height: Math.min(box.height, Math.max(least, room)) });
    top = box.y;
  }
  if (title.fontPx === layout.title.fontPx && title.lines.join('\n') === layout.title.lines.join('\n') && Math.abs(top - layout.title.y) < 0.01) return layout;
  return { ...layout, title: { ...title, x: layout.title.x, y: top } };
}

/** A 2D context of either canvas kind. */
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Measures a title in the display face on a real canvas, for `CoverSpec.measure`. */
export function titleMeasure(ctx: Ctx, lang: string): (text: string, fontPx: number) => number {
  return (text, fontPx) => {
    ctx.font = canvasFont('display', fontPx, 600);
    return measureTextWidth(ctx, text, { lang });
  };
}

function traceRing(ctx: Ctx, ring: Ring, px: (x: number) => number, py: (z: number) => number): void {
  const first = ring[0];
  if (!first) return;
  ctx.moveTo(px(first.x), py(first.z));
  for (let i = 1; i < ring.length; i += 1) {
    const point = ring[i];
    if (point) ctx.lineTo(px(point.x), py(point.z));
  }
  ctx.closePath();
}

function traceLevel(ctx: Ctx, level: ContourLevel, px: (x: number) => number, py: (z: number) => number): void {
  ctx.beginPath();
  for (const polygon of level.polygons) {
    traceRing(ctx, polygon.outer, px, py);
    for (const hole of polygon.holes) traceRing(ctx, hole, px, py);
  }
}

export interface CoverPrint {
  /** The mountain of this roadmap as plain data. Without it the field stays empty. */
  readonly print?: SheetPrint | null;
  /** You-are-here as a share of the drawn trail, where the pin's dot is printed. */
  readonly here?: number;
  /** Share of the trail that is walked: printed darker. */
  readonly walked?: number;
  /**
   * The tone of each card while it lies in the print, bottom card first: the cover's cloth with a quarter of the
   * card's own paper in it. With these the printed field and the flat model look the same.
   */
  readonly tones?: readonly string[];
  readonly lang: UiLang;
  readonly seed?: number | string;
}

/**
 * Paints a cover. The canvas is `layout.width * scale` wide. The field prints the level set the model is cut
 * from, in ink at half strength, with the dashed trail, the camp dots and the dot of the pin, so the print and
 * the model agree line for line.
 */
export function paintCover(ctx: Ctx, layout: CoverLayout, spec: CoverSpec, extra: CoverPrint, scale = 1): void {
  const { width, height } = layout;
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  // The cloth: the tier colour, a little lighter in the middle, with a weave of single threads.
  ctx.fillStyle = layout.board;
  ctx.fillRect(0, 0, width, height);
  const glow = ctx.createRadialGradient(width / 2, height * 0.45, 40, width / 2, height * 0.45, height * 0.72);
  glow.addColorStop(0, withAlpha(mix(layout.board, '#ffffff', 0.5), 0.1));
  glow.addColorStop(1, withAlpha(mix(layout.board, '#000000', 0.6), 0.2));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
  const random = createRandom(extra.seed ?? spec.title);
  ctx.lineWidth = 1;
  for (let i = 0; i < 520; i += 1) {
    const light = random() < 0.5;
    ctx.strokeStyle = light ? `rgba(255,255,255,${0.02 + random() * 0.035})` : `rgba(0,0,0,${0.03 + random() * 0.05})`;
    const across = random() < 0.5;
    const at = random() * (across ? height : width);
    const from = random() * (across ? width : height);
    const length = 30 + random() * 260;
    ctx.beginPath();
    if (across) {
      ctx.moveTo(from, at);
      ctx.lineTo(from + length, at + (random() - 0.5) * 1.2);
    } else {
      ctx.moveTo(at, from);
      ctx.lineTo(at + (random() - 0.5) * 1.2, from + length);
    }
    ctx.stroke();
  }

  // A blind-stamped frame, as on a cloth-bound atlas.
  ctx.strokeStyle = withAlpha(layout.ink, 0.16);
  ctx.lineWidth = 1.2;
  ctx.strokeRect(13, 13, width - 26, height - 26);

  // The field: the mountain's own contour lines.
  const { paper, field } = layout;
  const px = (x: number): number => paper.x + (x * 0.5 + 0.5) * paper.width;
  const py = (z: number): number => paper.y + (z * 0.5 + 0.5) * paper.height;
  const print = extra.print;
  if (print) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(paper.x, paper.y, paper.width, paper.height);
    ctx.clip();
    ctx.lineJoin = 'round';
    const tones = extra.tones;
    if (tones && tones.length > 0) {
      ctx.fillStyle = tones[0] as string;
      ctx.fillRect(paper.x, paper.y, paper.width, paper.height);
      print.levels.forEach((level, index) => {
        if (index === 0 || level.polygons.length === 0) return;
        ctx.fillStyle = tones[Math.min(index, tones.length - 1)] as string;
        traceLevel(ctx, level, px, py);
        ctx.fill('evenodd');
      });
    }
    ctx.strokeStyle = withAlpha(THEME.ink, 0.5);
    print.levels.forEach((level, index) => {
      if (index === 0 || level.polygons.length === 0) return;
      // Every fifth line is an index contour, drawn a little heavier, as on a survey map.
      ctx.lineWidth = index % 5 === 0 ? 1.7 : 1.05;
      traceLevel(ctx, level, px, py);
      ctx.stroke();
    });

    // The trail: dashes in the signal colour, the walked part solid and darker.
    const half = print.half;
    const walked = Math.min(1, Math.max(0, extra.walked ?? 0));
    const marks = markTrail(print.trail, { dash: 0.12 / half, gap: 0.042 / half, dotEvery: 0 });
    ctx.lineCap = 'round';
    ctx.lineWidth = 0.03 * UX;
    for (const mark of marks) {
      const first = mark.points[0];
      if (!first) continue;
      ctx.strokeStyle = first.along < walked ? mix(THEME.signalDeep, THEME.ink, 0.35) : THEME.signal;
      ctx.beginPath();
      mark.points.forEach((point, index) => (index === 0 ? ctx.moveTo(px(point.x), py(point.z)) : ctx.lineTo(px(point.x), py(point.z))));
      ctx.stroke();
    }
    // Camps: a dot per stop, the summit a little larger, the gate a ring.
    print.trail.stops.forEach((stop, index) => {
      const last = index === print.trail.stops.length - 1;
      const radius = (last ? 0.065 : 0.05) * UX;
      ctx.beginPath();
      ctx.arc(px(stop.x), py(stop.z), radius, 0, Math.PI * 2);
      if (index === 0) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = THEME.signal;
        ctx.stroke();
      } else {
        ctx.fillStyle = THEME.signal;
        ctx.fill();
      }
    });
    // The pin lies in the print as a dot until the mountain stands.
    if (extra.here !== undefined) {
      const here = trailPointAt(print.trail, extra.here);
      ctx.beginPath();
      ctx.arc(px(here.x), py(here.z), 0.034 * UX, 0, Math.PI * 2);
      ctx.fillStyle = THEME.signal;
      ctx.fill();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = withAlpha(layout.ink, 0.85);
      ctx.stroke();
    }
    ctx.restore();
  }
  // Neat line round the paper, and tick marks on the field's corners.
  ctx.strokeStyle = withAlpha(layout.ink, 0.28);
  ctx.lineWidth = 1;
  ctx.strokeRect(paper.x - 0.5, paper.y - 0.5, paper.width + 1, paper.height + 1);
  ctx.strokeStyle = withAlpha(layout.ink, 0.5);
  const tick = 9;
  for (const [cx, cy, sx, sy] of [
    [field.x, field.y, 1, 1],
    [field.x + field.width, field.y, -1, 1],
    [field.x, field.y + field.height, 1, -1],
    [field.x + field.width, field.y + field.height, -1, -1],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(cx + sx * tick, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + sy * tick);
    ctx.stroke();
  }

  // Top band: mark and wordmark, number, title.
  drawBrandMark(ctx as CanvasRenderingContext2D, layout.mark.x, layout.mark.y, layout.mark.size, { ink: layout.ink });
  ctx.textBaseline = 'alphabetic';
  drawWordmark(ctx as CanvasRenderingContext2D, layout.wordmark.x, layout.wordmark.y, layout.wordmark.px, { ink: layout.ink });
  const label = (item: CoverText, alpha: number): void => {
    ctx.font = canvasFont('label', item.px, 500);
    ctx.fillStyle = withAlpha(layout.ink, alpha);
    drawText(ctx, item.text, item.x, item.y, { tracking: 0.14, lang: extra.lang, align: item.align });
  };
  label(layout.number, 0.92);
  if (layout.example) label(layout.example, 0.66);

  // With the print at hand the title keeps clear of the mountain that grows out of it. Every cover painted from
  // the same print and spec sets its title the same way.
  const title = print ? clearTitle(layout, spec, coverReach(print)).title : layout.title;
  ctx.fillStyle = layout.ink;
  ctx.font = canvasFont('display', title.fontPx, 600);
  title.lines.forEach((line, index) => {
    const baseline = title.y + index * title.lineHeightPx + title.fontPx * 0.84;
    const rtl = title.direction === 'rtl';
    drawText(ctx, line, rtl ? layout.titleBox.x + layout.titleBox.width : title.x, baseline, {
      lang: spec.lang,
      align: rtl ? 'right' : 'left',
    });
  });

  // Data row and the walked bar.
  ctx.fillStyle = withAlpha(layout.ink, 0.3);
  ctx.fillRect(PAD, layout.rule, width - 2 * PAD, 1);
  for (const item of layout.data) label(item, 0.9);
  ctx.fillStyle = withAlpha(layout.ink, 0.24);
  ctx.fillRect(layout.bar.x, layout.bar.y, layout.bar.width, layout.bar.height);
  if (layout.bar.share > 0) {
    ctx.fillStyle = THEME.signal;
    ctx.fillRect(layout.bar.x, layout.bar.y, Math.max(3, layout.bar.width * layout.bar.share), layout.bar.height);
  }
  label(layout.percent, 0.9);

  ctx.restore();
}
