import type { UiLang } from '../i18n';
import { createRandom } from '../core/random';
import { drawBrandMark, drawWordmark } from '../look/brand';
import { formatHours, formatNumber } from '../look/format';
import { THEME, mix, withAlpha } from '../look/theme';
import { canvasFont, drawText, measureTextWidth } from '../look/type';
import type { TierName } from '../scene/palette';
import { markTrail, trailPointAt, type ContourLevel, type Ring } from '../terrain';
import { GROW } from './grow';
import type { SheetPrint } from './sheet-data';
import { say, tierKey } from './strings';
import { estimateTextWidth, layoutTitle, type TitleLayout } from './title';

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
  topBand: 0.95,
  field: GROW.size,
  dataRow: 0.65,
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

/** Where everything on a cover goes, in canvas pixels at scale 1. */
export function coverLayout(spec: CoverSpec, lang: UiLang): CoverLayout {
  const top = COVER.margin * UY;
  const bandBottom = (COVER.margin + COVER.topBand) * UY;
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
  const titleBox: CoverRect = { x: PAD, y: top + 50, width: COVER.width - 2 * PAD, height: bandBottom - (top + 50) - 8 };
  const title = layoutTitle(spec.title, spec.lang, {
    width: titleBox.width,
    height: titleBox.height,
    fontPx: TITLE_PX,
    lineHeight: 1.06,
    maxLines: 3,
    minScale: 0.56,
    measure: spec.measure ?? estimateTextWidth,
  });

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

  const dataY = rowTop + 46;
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
  const barY = rowTop + 74;
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
    rule: rowTop + 16,
    data,
    bar,
    percent: { text: percentText, x: COVER.width - PAD, y: barY + 8, px: 13, align: 'right' },
  };
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

  ctx.fillStyle = layout.ink;
  ctx.font = canvasFont('display', layout.title.fontPx, 600);
  layout.title.lines.forEach((line, index) => {
    const baseline = layout.title.y + index * layout.title.lineHeightPx + layout.title.fontPx * 0.84;
    const rtl = layout.title.direction === 'rtl';
    drawText(ctx, line, rtl ? layout.titleBox.x + layout.titleBox.width : layout.title.x, baseline, {
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
