import { createRandom, range, type Random } from '../core/random';
import type { UiLang } from '../i18n';
import { drawBrandMark } from '../look/brand';
import { formatDay, formatHours } from '../look/format';
import { THEME, mix, withAlpha } from '../look/theme';
import { canvasFont, drawText, measureTextWidth } from '../look/type';
import type { SurfaceKind, TierName } from '../scene/palette';
import { heightfieldFromData, traceContours, type ContourLevel, type Point2 } from '../terrain';
import { PANEL } from './fold';
import { panelRoutePoints, pathPoint, type PanelPlan, type WalkPlan } from './plan';
import { say, surfaceKey, tierKey } from './strings';
import { MODEL, STRIP } from './strip';
import { PLACE } from './timeline';

/**
 * Everything the walk prints: the face of every panel, the tops of its cards, the legend inside the cover and
 * the mini map of a stage. All of it is drawn on a 2D canvas from the plan, in panel coordinates.
 */
type Ctx = CanvasRenderingContext2D;

/** The print of a panel at scale 1, in pixels: 690 by 920 for 4.2 by 5.6. */
export const PRINT = { width: 690, height: 920, activeScale: 2, restScale: 1.5, phoneScale: 1, dimInk: 0.35 } as const;

/** How dark each ground prints its pattern, and how much of its colour the paper of a card takes. */
const TINT = { low: 0.3, high: 0.1 } as const;

/** One contour line of a panel, in panel coordinates. `major` marks every fifth line. */
export interface ContourLine {
  readonly points: readonly Point2[];
  readonly major: boolean;
}

/**
 * The contour lines printed on a panel. They are cut at the same heights as the panel's cards, so every card
 * edge of the model has its own printed line, and the lines run on over the whole panel.
 */
export function panelContours(panel: PanelPlan, resolution = 97): ContourLine[] {
  const { ground, cards } = panel;
  const data = new Float32Array(resolution * resolution);
  for (let j = 0; j < resolution; j += 1) {
    const z = -PANEL.depth / 2 + (j / (resolution - 1)) * PANEL.depth;
    for (let i = 0; i < resolution; i += 1) data[j * resolution + i] = ground.sample((i / (resolution - 1)) * PANEL.width, z);
  }
  const first = Math.ceil((ground.min - cards.floor) / cards.step + 1e-6);
  const last = Math.floor((ground.max - cards.floor) / cards.step - 1e-6);
  const every = Math.max(1, Math.ceil((last - first + 1) / 44));
  const heights: number[] = [];
  const numbers: number[] = [];
  for (let k = first; k <= last; k += 1) {
    if (((k % every) + every) % every !== 0) continue;
    heights.push(cards.floor + k * cards.step);
    numbers.push(k / every);
  }
  const levels: ContourLevel[] = traceContours(heightfieldFromData(resolution, data), heights, { smooth: 2, simplify: 0.003, minArea: 0.0009 });
  const lines: ContourLine[] = [];
  const onBorder = (p: Point2): boolean => Math.abs(p.x) > 0.9985 || Math.abs(p.z) > 0.9985;
  const place = (p: Point2): Point2 => ({ x: ((p.x + 1) / 2) * PANEL.width, z: (p.z / 2) * PANEL.depth });
  levels.forEach((level, index) => {
    const major = (((numbers[index] as number) % 5) + 5) % 5 === 0;
    for (const polygon of level.polygons) {
      for (const ring of [polygon.outer, ...polygon.holes]) {
        // A ring that runs along the border of the panel is cut there: the border is not a contour.
        let run: Point2[] = [];
        const count = ring.length;
        let startAt = 0;
        for (let k = 0; k < count; k += 1) {
          if (onBorder(ring[k] as Point2) && onBorder(ring[(k + 1) % count] as Point2)) {
            startAt = (k + 1) % count;
            break;
          }
        }
        for (let step = 0; step <= count; step += 1) {
          const a = ring[(startAt + step) % count] as Point2;
          const b = ring[(startAt + step + 1) % count] as Point2;
          run.push(place(a));
          if ((onBorder(a) && onBorder(b)) || step === count) {
            if (run.length > 1) lines.push({ points: run, major });
            run = [];
          }
        }
      }
    }
  });
  return lines;
}

function px(width: number, height: number): { X: (x: number) => number; Y: (z: number) => number; unit: number } {
  return { X: (x) => (x / PANEL.width) * width, Y: (z) => ((z + PANEL.depth / 2) / PANEL.depth) * height, unit: width / PANEL.width };
}

function strokeLine(ctx: Ctx, points: readonly Point2[], X: (x: number) => number, Y: (z: number) => number): void {
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(X(point.x), Y(point.z));
    else ctx.lineTo(X(point.x), Y(point.z));
  });
  ctx.stroke();
}

function fitText(ctx: Ctx, text: string, maxWidth: number, lang?: string): string {
  if (measureTextWidth(ctx, text, lang ? { lang } : {}) <= maxWidth) return text;
  const parts = Array.from(text);
  while (parts.length > 1 && measureTextWidth(ctx, `${parts.join('').trimEnd()}…`, lang ? { lang } : {}) > maxWidth) parts.pop();
  return `${parts.join('').trimEnd()}…`;
}

/** Soft relief shading of a panel's ground, lit from the back left, as a small canvas to be stretched. */
function reliefCanvas(panel: PanelPlan): HTMLCanvasElement | null {
  const { cols, rows, data } = panel.ground;
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const image = ctx.createImageData(cols, rows);
  const at = (i: number, j: number): number => data[Math.min(rows - 1, Math.max(0, j)) * cols + Math.min(cols - 1, Math.max(0, i))] as number;
  const gain = 18 / Math.max(0.05, panel.ground.max - panel.ground.min);
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      const gx = at(i + 1, j) - at(i - 1, j);
      const gz = at(i, j + 1) - at(i, j - 1);
      // Positive where the ground faces the light.
      const lit = Math.max(-1, Math.min(1, (gx * -0.6 + gz * -0.8) * -gain * 0.5));
      const value = lit < 0 ? 255 : 0;
      const index = (j * cols + i) * 4;
      image.data[index] = value;
      image.data[index + 1] = value;
      image.data[index + 2] = value;
      image.data[index + 3] = Math.round(Math.abs(lit) * (lit < 0 ? 70 : 110));
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function dashedRoute(ctx: Ctx, points: readonly { x: number; z: number; s: number }[], X: (x: number) => number, Y: (z: number) => number, period: number, ink: number, from = -Infinity, to = Infinity): void {
  ctx.beginPath();
  let drawing = false;
  for (let k = 0; k < points.length; k += 1) {
    const point = points[k] as { x: number; z: number; s: number };
    const inside = point.s >= from && point.s <= to && (period <= 0 || ((point.s / period) % 1 + 1) % 1 < ink);
    if (inside) {
      if (drawing) ctx.lineTo(X(point.x), Y(point.z));
      else ctx.moveTo(X(point.x), Y(point.z));
    }
    drawing = inside;
  }
  ctx.stroke();
}

/** Dense points of a panel's route, so printed dashes have clean ends. */
function densePath(panel: PanelPlan, step = 0.012): { x: number; z: number; s: number }[] {
  const points = panelRoutePoints(panel);
  const out: { x: number; z: number; s: number }[] = [];
  for (let k = 0; k < points.length - 1; k += 1) {
    const a = points[k] as { x: number; z: number; s: number };
    const b = points[k + 1] as { x: number; z: number; s: number };
    const pieces = Math.max(1, Math.ceil((b.s - a.s) / step));
    for (let piece = 0; piece < pieces; piece += 1) {
      const t = piece / pieces;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, s: a.s + (b.s - a.s) * t });
    }
  }
  out.push(points[points.length - 1] as { x: number; z: number; s: number });
  return out;
}

export interface PanelPrint {
  readonly plan: WalkPlan;
  readonly panel: PanelPlan;
  readonly contours: readonly ContourLine[];
  readonly lang: UiLang;
  /** 1 for a panel whose way is open, 0.35 for one beyond the last passed checkpoint. */
  readonly ink: number;
  /** True when this stage is where the roadmap lets a learner go in. */
  readonly entry: boolean;
}

/** The paper tone of a panel: paper with a wash of the ground the stage is walked on. */
export function panelPaper(surface: SurfaceKind): string {
  return mix(THEME.paper, THEME.surface[surface], 0.14);
}

function waypointLabels(ctx: Ctx, print: Pick<PanelPrint, 'panel' | 'plan'>, X: (x: number) => number, Y: (z: number) => number, unit: number, alpha: number): void {
  const { panel, plan } = print;
  const roadLang = plan.roadmap.lang;
  panel.marks.forEach((mark, index) => {
    const x = X(mark.x);
    const y = Y(mark.z);
    const r = unit * 0.036;
    ctx.fillStyle = THEME.paperHi;
    ctx.strokeStyle = withAlpha(THEME.ink, alpha);
    ctx.lineWidth = unit * 0.012;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    if (mark.waypoint.optional) ctx.setLineDash([unit * 0.02, unit * 0.016]);
    ctx.stroke();
    ctx.setLineDash([]);
    if (!mark.waypoint.optional) {
      ctx.fillStyle = withAlpha(THEME.ink, alpha);
      ctx.beginPath();
      ctx.arc(x, y, r * 0.42, 0, Math.PI * 2);
      ctx.fill();
    }
    // The title: above or below the route in turn, on a strip of paper so contours do not cross it.
    const below = index % 2 === 1;
    ctx.font = canvasFont('text', unit * 0.082, 600);
    const text = fitText(ctx, mark.waypoint.title, unit * 1.05, roadLang);
    const width = measureTextWidth(ctx, text, { lang: roadLang });
    const left = Math.min(X(PANEL.width) - width - unit * 0.1, Math.max(unit * 0.1, x - width / 2));
    const base = below ? y + unit * 0.2 : y - unit * 0.115;
    ctx.fillStyle = withAlpha(THEME.paperHi, 0.78 * alpha);
    ctx.fillRect(left - unit * 0.03, base - unit * 0.078, width + unit * 0.06, unit * 0.105);
    ctx.fillStyle = withAlpha(THEME.ink, alpha);
    drawText(ctx, text, left, base, { lang: roadLang });
  });
}

/** Prints the face of a panel. The canvas is already filled with the panel's paper tone. */
export function paintPanel(ctx: Ctx, width: number, height: number, print: PanelPrint): void {
  const { panel, plan, lang, contours } = print;
  const { X, Y, unit } = px(width, height);
  const ink = Math.min(1, Math.max(0.2, print.ink));
  const roadLang = plan.roadmap.lang;
  const surface = THEME.surface[panel.surface];
  const stageCount = plan.panels.length;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // The wash of the ground, deeper toward the front, and the relief.
  const wash = ctx.createLinearGradient(0, 0, 0, height);
  wash.addColorStop(0, withAlpha(surface, 0.02));
  wash.addColorStop(1, withAlpha(surface, 0.2));
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, width, height);
  const relief = reliefCanvas(panel);
  if (relief) {
    ctx.save();
    ctx.globalAlpha = 0.5 * ink;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(relief, 0, 0, width, height);
    ctx.restore();
  }

  // Contours.
  for (const line of contours) {
    ctx.strokeStyle = withAlpha(THEME.ink, (line.major ? 0.34 : 0.17) * ink);
    ctx.lineWidth = unit * (line.major ? 0.0095 : 0.0065);
    strokeLine(ctx, line.points, X, Y);
  }

  // The frame of the model's window, as a faint registration line, and the creases.
  ctx.strokeStyle = withAlpha(THEME.ink, 0.1 * ink);
  ctx.lineWidth = unit * 0.006;
  ctx.strokeRect(X(MODEL.x0), Y(MODEL.z0), X(MODEL.x1) - X(MODEL.x0), Y(MODEL.z1) - Y(MODEL.z0));
  for (const edge of [0, 1]) {
    const shade = ctx.createLinearGradient(edge === 0 ? 0 : width, 0, edge === 0 ? unit * 0.2 : width - unit * 0.2, 0);
    shade.addColorStop(0, withAlpha(THEME.ink, 0.13));
    shade.addColorStop(1, withAlpha(THEME.ink, 0));
    ctx.fillStyle = shade;
    ctx.fillRect(edge === 0 ? 0 : width - unit * 0.2, 0, unit * 0.2, height);
  }

  // The route ahead, as the map prints it: thin ink dashes. The walked route is laid over it in the scene.
  const route = densePath(panel);
  ctx.strokeStyle = withAlpha(THEME.ink, 0.5 * ink);
  ctx.lineWidth = unit * 0.017;
  dashedRoute(ctx, route, X, Y, 0.11, 0.55);

  // The stops at both ends, and the ring of the entry.
  const start = pathPoint(panel, 0);
  const end = pathPoint(panel, 1);
  for (const [point, camp] of [[start, false], [end, true]] as const) {
    ctx.fillStyle = THEME.paperHi;
    ctx.strokeStyle = withAlpha(camp ? THEME.signalDeep : THEME.ink, 0.8 * ink);
    ctx.lineWidth = unit * 0.014;
    ctx.beginPath();
    if (camp) {
      const s = unit * 0.07;
      ctx.moveTo(X(point.x), Y(point.z) - s);
      ctx.lineTo(X(point.x) + s, Y(point.z) + s * 0.75);
      ctx.lineTo(X(point.x) - s, Y(point.z) + s * 0.75);
      ctx.closePath();
    } else {
      ctx.arc(X(point.x), Y(point.z), unit * 0.05, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.stroke();
  }
  if (print.entry) {
    ctx.strokeStyle = withAlpha(THEME.signalDeep, 0.75 * ink);
    ctx.lineWidth = unit * 0.012;
    ctx.setLineDash([unit * 0.035, unit * 0.025]);
    ctx.beginPath();
    ctx.arc(X(start.x), Y(start.z), unit * 0.13, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  waypointLabels(ctx, print, X, Y, unit, 0.88 * ink);

  // The title along the back edge, and the stage line over it.
  const left = X(0.26);
  ctx.fillStyle = withAlpha(THEME.ink, 0.62 * ink);
  ctx.font = canvasFont('label', unit * 0.066, 500);
  const kicker = `${String(panel.index + 1).padStart(2, '0')}  ·  ${say('stageOf', { i: panel.index + 1, n: stageCount }, lang)}  ·  ${say(tierKey(panel.stage.tier), undefined, lang)}  ·  ${formatHours(panel.trek.minutes, { lang })}`;
  drawText(ctx, kicker.toUpperCase(), left, Y(-PANEL.depth / 2 + 0.2), { tracking: 0.14, lang });
  ctx.fillStyle = withAlpha(THEME.ink, 0.9 * ink);
  ctx.font = canvasFont('display', unit * 0.2, 500);
  drawText(ctx, fitText(ctx, panel.stage.title, unit * 3.6, roadLang), left, Y(-PANEL.depth / 2 + 0.47), { tracking: -0.01, lang: roadLang });
  ctx.strokeStyle = withAlpha(THEME.ink, 0.3 * ink);
  ctx.lineWidth = unit * 0.006;
  ctx.beginPath();
  ctx.moveTo(left, Y(-PANEL.depth / 2 + 0.56));
  ctx.lineTo(X(PANEL.width - 0.26), Y(-PANEL.depth / 2 + 0.56));
  ctx.stroke();

  // The stamp: the day the links were opened, and how many sources the stage has.
  const sources = new Set<string>();
  for (const waypoint of panel.stage.waypoints) for (const id of waypoint.resources) sources.add(id);
  for (const id of panel.stage.project?.resources ?? []) sources.add(id);
  const stampLines = [say('checked', { day: formatDay(plan.roadmap.checkedOn, { style: 'iso' }) }, lang).toUpperCase(), say('sources', { count: sources.size }, lang).toUpperCase()];
  ctx.save();
  ctx.translate(X(PANEL.width - 0.95), Y(-PANEL.depth / 2 + 0.98));
  ctx.rotate((-7 * Math.PI) / 180);
  ctx.font = canvasFont('label', unit * 0.07, 500);
  const stampWidth = Math.max(...stampLines.map((line) => measureTextWidth(ctx, line, { tracking: 0.1 }))) + unit * 0.2;
  const stampHeight = unit * 0.3;
  ctx.strokeStyle = withAlpha(THEME.inkSoft, 0.62 * ink);
  ctx.lineWidth = unit * 0.013;
  ctx.strokeRect(-stampWidth / 2, -stampHeight / 2, stampWidth, stampHeight);
  ctx.lineWidth = unit * 0.005;
  ctx.strokeRect(-stampWidth / 2 + unit * 0.025, -stampHeight / 2 + unit * 0.025, stampWidth - unit * 0.05, stampHeight - unit * 0.05);
  ctx.fillStyle = withAlpha(THEME.inkSoft, 0.7 * ink);
  stampLines.forEach((line, index) => drawText(ctx, line, 0, -unit * 0.02 + index * unit * 0.1, { tracking: 0.1, align: 'center', lang }));
  ctx.restore();

  // The profile of the stage along the front edge.
  paintProfile(ctx, print, X, Y, unit, ink);
  ctx.restore();
}

function paintProfile(ctx: Ctx, print: PanelPrint, X: (x: number) => number, Y: (z: number) => number, unit: number, ink: number): void {
  const { panel, plan, lang } = print;
  const top = 2.36;
  const bottom = 2.64;
  const points = panel.route.points;
  let low = Infinity;
  let high = -Infinity;
  for (const point of points) {
    if (point.h < low) low = point.h;
    if (point.h > high) high = point.h;
  }
  const span = Math.max(1e-4, high - low);
  const heightAt = (h: number): number => bottom - 0.03 - ((h - low) / span) * (bottom - top - 0.06);
  ctx.beginPath();
  ctx.moveTo(X(points[0]?.x ?? 0), Y(bottom));
  for (const point of points) ctx.lineTo(X(point.x), Y(heightAt(point.h)));
  ctx.lineTo(X(points[points.length - 1]?.x ?? PANEL.width), Y(bottom));
  ctx.closePath();
  ctx.fillStyle = withAlpha(THEME.tier[panel.stage.tier as TierName], 0.14 * Math.max(ink, 0.6) + 0.1);
  ctx.fill();
  ctx.strokeStyle = withAlpha(THEME.ink, 0.62 * ink);
  ctx.lineWidth = unit * 0.011;
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(X(point.x), Y(heightAt(point.h)));
    else ctx.lineTo(X(point.x), Y(heightAt(point.h)));
  });
  ctx.stroke();
  ctx.strokeStyle = withAlpha(THEME.ink, 0.3 * ink);
  ctx.lineWidth = unit * 0.006;
  ctx.beginPath();
  ctx.moveTo(X(STRIP.margin), Y(bottom));
  ctx.lineTo(X(PANEL.width - STRIP.margin), Y(bottom));
  ctx.stroke();

  ctx.font = canvasFont('label', unit * 0.058, 500);
  for (const mark of panel.marks) {
    const point = pathPoint(panel, mark.at);
    const at = panel.route.points[Math.round(mark.at * (panel.route.points.length - 1))];
    const y = Y(heightAt(at?.h ?? low));
    ctx.fillStyle = withAlpha(THEME.ink, 0.8 * ink);
    ctx.beginPath();
    ctx.arc(X(point.x), y, unit * 0.02, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = withAlpha(THEME.ink, 0.66 * ink);
    drawText(ctx, formatHours(mark.minutesAfter, { lang, approx: false, unit: 'hours' }).toUpperCase(), X(point.x), y - unit * 0.05, { align: 'center', tracking: 0.06, lang });
  }
  // The camp, in the colour of the route.
  const camp = pathPoint(panel, PLACE.camp);
  const campHeight = Y(heightAt(points[points.length - 1]?.h ?? high));
  ctx.fillStyle = withAlpha(THEME.signal, Math.max(0.5, ink));
  ctx.beginPath();
  ctx.arc(X(camp.x), campHeight, unit * 0.03, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = withAlpha(THEME.signalDeep, Math.max(0.5, ink));
  drawText(ctx, say(panel.last ? 'summit' : 'camp', undefined, lang).toUpperCase(), X(camp.x) + unit * 0.06, campHeight + unit * 0.02, { tracking: 0.12, lang });
}

// ---------------------------------------------------------------------------------------------------------
// The tops of the cards.

/** The paper tone of every card, bottom first: from the shaded paper to the lightest, tinted by its ground. */
export function cardTones(surfaces: readonly SurfaceKind[]): string[] {
  const last = Math.max(1, surfaces.length - 1);
  return surfaces.map((kind, index) => {
    const t = index / last;
    const paper = mix(THEME.paperShade, THEME.paperHi, t);
    return mix(paper, THEME.surface[kind], TINT.low + (TINT.high - TINT.low) * t);
  });
}

function traceLevel(ctx: Ctx, level: ContourLevel, X: (x: number) => number, Y: (z: number) => number): void {
  ctx.beginPath();
  for (const polygon of level.polygons) {
    for (const ring of [polygon.outer, ...polygon.holes]) {
      ring.forEach((point, index) => {
        if (index === 0) ctx.moveTo(X(point.x), Y(point.z));
        else ctx.lineTo(X(point.x), Y(point.z));
      });
      ctx.closePath();
    }
  }
}

/** One mark of a ground's pattern at a point, in the darker tone of that ground. */
function groundMark(ctx: Ctx, kind: SurfaceKind, x: number, y: number, unit: number, random: Random): void {
  const s = unit * 0.05 * range(random, 0.8, 1.25);
  switch (kind) {
    case 'grass': {
      // A tuft: three short blades.
      ctx.beginPath();
      for (const lean of [-0.5, 0, 0.5]) {
        ctx.moveTo(x + lean * s * 0.3, y);
        ctx.lineTo(x + lean * s, y - s * (lean === 0 ? 1 : 0.72));
      }
      ctx.stroke();
      return;
    }
    case 'forest': {
      // A conifer as maps print it: a small tick with two boughs.
      ctx.beginPath();
      ctx.moveTo(x, y + s * 0.5);
      ctx.lineTo(x, y - s * 0.6);
      ctx.moveTo(x - s * 0.42, y + s * 0.1);
      ctx.lineTo(x, y - s * 0.3);
      ctx.lineTo(x + s * 0.42, y + s * 0.1);
      ctx.stroke();
      return;
    }
    case 'dirt': {
      ctx.beginPath();
      ctx.moveTo(x - s * 0.6, y);
      ctx.lineTo(x + s * 0.6, y + s * range(random, -0.15, 0.15));
      ctx.stroke();
      return;
    }
    case 'scree': {
      for (let k = 0; k < 3; k += 1) {
        ctx.beginPath();
        ctx.arc(x + range(random, -s, s), y + range(random, -s * 0.6, s * 0.6), s * range(random, 0.1, 0.22), 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }
    case 'rock': {
      // A crack: two strokes that meet.
      ctx.beginPath();
      ctx.moveTo(x - s * 0.7, y + s * 0.3);
      ctx.lineTo(x, y - s * 0.35);
      ctx.lineTo(x + s * 0.75, y + s * 0.1);
      ctx.stroke();
      return;
    }
    case 'snow': {
      ctx.beginPath();
      ctx.arc(x, y, s * 0.09, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    case 'sand': {
      for (let k = 0; k < 4; k += 1) {
        ctx.beginPath();
        ctx.arc(x + range(random, -s, s), y + range(random, -s * 0.5, s * 0.5), s * 0.07, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }
    case 'water': {
      ctx.beginPath();
      ctx.moveTo(x - s, y);
      ctx.quadraticCurveTo(x - s * 0.5, y - s * 0.4, x, y);
      ctx.quadraticCurveTo(x + s * 0.5, y + s * 0.4, x + s, y);
      ctx.stroke();
      return;
    }
  }
}

/** How strongly each ground prints its pattern, and how far apart its marks are. Snow is nearly bare. */
const PATTERN: Record<SurfaceKind, { readonly alpha: number; readonly spacing: number }> = {
  water: { alpha: 0.34, spacing: 0.2 },
  sand: { alpha: 0.4, spacing: 0.17 },
  grass: { alpha: 0.42, spacing: 0.16 },
  forest: { alpha: 0.3, spacing: 0.17 },
  dirt: { alpha: 0.3, spacing: 0.18 },
  scree: { alpha: 0.36, spacing: 0.17 },
  rock: { alpha: 0.3, spacing: 0.21 },
  snow: { alpha: 0.22, spacing: 0.28 },
};

export interface CardPrint {
  readonly plan: WalkPlan;
  readonly panel: PanelPlan;
  readonly lang: UiLang;
  readonly ink: number;
}

/**
 * Prints the tops of a panel's cards as one sheet over the model's window. Each card is laid on the ones
 * below it, the way the stack is built: it throws its contact shadow, covers its own area with its paper tone,
 * takes the pattern of its ground and shows its cut edge. The waypoint marks are printed last.
 */
export function paintCardTops(ctx: Ctx, width: number, height: number, print: CardPrint): void {
  const { panel } = print;
  const spanX = MODEL.x1 - MODEL.x0;
  const spanZ = MODEL.z1 - MODEL.z0;
  const X = (x: number): number => ((x - MODEL.x0) / spanX) * width;
  const Y = (z: number): number => ((z - MODEL.z0) / spanZ) * height;
  const unit = width / spanX;
  const tones = cardTones(panel.cardSurfaces);
  const random = createRandom(`${panel.seed}/tops`);
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Where the pattern goes: a jittered grid, each point given to the card it lies on.
  const marks: { x: number; z: number }[][] = panel.cards.levels.map(() => []);
  const cell = 0.115;
  for (let z = MODEL.z0 + cell / 2; z < MODEL.z1; z += cell) {
    for (let x = MODEL.x0 + cell / 2; x < MODEL.x1; x += cell) {
      const px0 = x + range(random, -0.04, 0.04);
      const pz0 = z + range(random, -0.04, 0.04);
      const card = panel.cards.cardAt(px0, pz0);
      if (card >= 0) marks[card]?.push({ x: px0, z: pz0 });
    }
  }

  panel.cards.levels.forEach((level, index) => {
    if (level.polygons.length === 0) return;
    const kind = panel.cardSurfaces[index] ?? panel.surface;
    if (index > 0) {
      // Contact shadow on what lies below: wide and faint, then narrow and darker, offset away from the light.
      ctx.save();
      ctx.translate(unit * 0.012, unit * 0.016);
      traceLevel(ctx, level, X, Y);
      for (const [spread, alpha] of [[0.085, 0.05], [0.05, 0.07], [0.024, 0.1]] as const) {
        ctx.strokeStyle = withAlpha(THEME.ink, alpha);
        ctx.lineWidth = unit * spread * 2;
        ctx.stroke();
      }
      ctx.restore();
    }
    traceLevel(ctx, level, X, Y);
    ctx.fillStyle = tones[index] ?? THEME.paper;
    ctx.fill('evenodd');

    ctx.save();
    traceLevel(ctx, level, X, Y);
    ctx.clip('evenodd');
    const pattern = PATTERN[kind];
    const dark = mix(THEME.surface[kind], THEME.ink, kind === 'snow' ? 0.5 : 0.28);
    ctx.strokeStyle = withAlpha(dark, pattern.alpha);
    ctx.fillStyle = withAlpha(dark, pattern.alpha);
    ctx.lineWidth = Math.max(1, unit * 0.009);
    const keep = Math.min(1, (cell / pattern.spacing) ** 2);
    for (const point of marks[index] ?? []) {
      if (random() > keep) continue;
      groundMark(ctx, kind, X(point.x), Y(point.z), unit, random);
    }
    // The cut edge: a darker line just inside the outline, and the lighter core of the paper inside that.
    traceLevel(ctx, level, X, Y);
    ctx.strokeStyle = withAlpha(THEME.paperHi, 0.55);
    ctx.lineWidth = unit * 0.03;
    ctx.stroke();
    ctx.strokeStyle = withAlpha(THEME.ink, 0.2);
    ctx.lineWidth = unit * 0.011;
    ctx.stroke();
    ctx.restore();
  });

  waypointLabels(ctx, print, X, Y, unit, 0.9 * Math.max(0.5, print.ink));
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------------------
// The legend, printed on the inside of the cover.

export interface LegendPrint {
  readonly plan: WalkPlan;
  readonly lang: UiLang;
}

/** Prints the inside of the cover: what the marks of this map mean, its grounds and its tiers. */
export function paintLegend(ctx: Ctx, width: number, height: number, print: LegendPrint): void {
  const { plan, lang } = print;
  const unit = width / PANEL.width;
  const roadLang = plan.roadmap.lang;
  const left = unit * 0.42;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.fillStyle = withAlpha(THEME.ink, 0.06);
  ctx.fillRect(0, 0, width, height);
  drawBrandMark(ctx, left, unit * 0.38, unit * 0.3, { ink: THEME.ink });
  ctx.fillStyle = THEME.inkSoft;
  ctx.font = canvasFont('label', unit * 0.072, 500);
  drawText(ctx, say('legend', undefined, lang).toUpperCase(), left + unit * 0.42, unit * 0.58, { tracking: 0.14, lang });
  ctx.fillStyle = THEME.ink;
  ctx.font = canvasFont('display', unit * 0.2, 500);
  drawText(ctx, fitText(ctx, plan.roadmap.title, width - left * 2, roadLang), left, unit * 1.02, { tracking: -0.01, lang: roadLang });
  ctx.fillStyle = THEME.inkSoft;
  ctx.font = canvasFont('label', unit * 0.066, 500);
  const facts = `${say('stages', { count: plan.panels.length }, lang)}  ·  ${formatHours(plan.data.trek.totalMinutes, { lang })}  ·  ${say('toTier', { tier: say(tierKey(plan.data.tier), undefined, lang) }, lang)}`;
  drawText(ctx, facts.toUpperCase(), left, unit * 1.24, { tracking: 0.12, lang });

  let y = unit * 1.75;
  const row = (draw: (x: number, y: number) => void, text: string): void => {
    draw(left + unit * 0.25, y - unit * 0.035);
    ctx.fillStyle = THEME.ink;
    ctx.font = canvasFont('text', unit * 0.1, 400);
    drawText(ctx, text, left + unit * 0.7, y, { lang });
    y += unit * 0.27;
  };
  const dash = (color: string, solid: boolean) => (x: number, at: number): void => {
    ctx.strokeStyle = color;
    ctx.lineWidth = unit * 0.03;
    ctx.setLineDash(solid ? [] : [unit * 0.08, unit * 0.06]);
    ctx.beginPath();
    ctx.moveTo(x - unit * 0.24, at);
    ctx.lineTo(x + unit * 0.24, at);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  const dot = (fill: string, stroke: string, radius: number, dashed = false) => (x: number, at: number): void => {
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = unit * 0.014;
    if (dashed) ctx.setLineDash([unit * 0.02, unit * 0.016]);
    ctx.beginPath();
    ctx.arc(x, at, unit * radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
  };
  row(dash(THEME.signal, false), say('legendRoute', undefined, lang));
  row(dash(THEME.signal, true), say('legendWalked', undefined, lang));
  row(dot(THEME.signal, THEME.signalDeep, 0.05), say('legendHere', undefined, lang));
  row(dot(THEME.ink, THEME.ink, 0.03), say('legendWaypoint', undefined, lang));
  row(dot(THEME.paperHi, THEME.ink, 0.036, true), say('legendSide', undefined, lang));
  row((x, at) => {
    ctx.strokeStyle = THEME.walnut;
    ctx.lineWidth = unit * 0.022;
    ctx.beginPath();
    ctx.moveTo(x, at + unit * 0.08);
    ctx.lineTo(x, at - unit * 0.09);
    ctx.moveTo(x, at - unit * 0.06);
    ctx.lineTo(x + unit * 0.14, at - unit * 0.06);
    ctx.moveTo(x, at - unit * 0.005);
    ctx.lineTo(x - unit * 0.12, at - unit * 0.005);
    ctx.stroke();
  }, say('legendSignpost', undefined, lang));
  row((x, at) => {
    ctx.fillStyle = THEME.paperHi;
    ctx.strokeStyle = THEME.signalDeep;
    ctx.lineWidth = unit * 0.016;
    ctx.beginPath();
    ctx.moveTo(x, at - unit * 0.085);
    ctx.lineTo(x + unit * 0.1, at + unit * 0.065);
    ctx.lineTo(x - unit * 0.1, at + unit * 0.065);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }, say('legendCamp', undefined, lang));
  row((x, at) => {
    ctx.strokeStyle = THEME.signal;
    ctx.lineWidth = unit * 0.02;
    ctx.beginPath();
    ctx.ellipse(x, at + unit * 0.03, unit * 0.12, unit * 0.05, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = THEME.surface.rock;
    for (const [dx, dy, r] of [[-0.03, 0.03, 0.04], [0.03, 0.03, 0.036], [0, -0.025, 0.032]] as const) {
      ctx.beginPath();
      ctx.arc(x + unit * dx, at + unit * dy, unit * r, 0, Math.PI * 2);
      ctx.fill();
    }
  }, say('legendCairn', undefined, lang));

  // The grounds of this mountain, from the foot up.
  y += unit * 0.14;
  ctx.fillStyle = THEME.inkSoft;
  ctx.font = canvasFont('label', unit * 0.066, 500);
  drawText(ctx, say('legendGround', undefined, lang).toUpperCase(), left, y, { tracking: 0.14, lang });
  y += unit * 0.14;
  const kinds: SurfaceKind[] = [];
  for (const kind of plan.print.surfaces) if (kinds[kinds.length - 1] !== kind && !kinds.includes(kind)) kinds.push(kind);
  const swatch = (width - left * 2) / Math.max(1, kinds.length);
  kinds.forEach((kind, index) => {
    ctx.fillStyle = mix(THEME.paper, THEME.surface[kind], 0.55);
    ctx.fillRect(left + index * swatch, y, swatch - unit * 0.03, unit * 0.2);
    const random = createRandom(`legend/${kind}`);
    const dark = mix(THEME.surface[kind], THEME.ink, 0.3);
    ctx.strokeStyle = dark;
    ctx.fillStyle = dark;
    ctx.lineWidth = Math.max(1, unit * 0.009);
    for (let k = 0; k < 5; k += 1) groundMark(ctx, kind, left + index * swatch + ((k + 0.5) / 5) * (swatch - unit * 0.03), y + unit * 0.12, unit, random);
    ctx.fillStyle = THEME.ink;
    ctx.font = canvasFont('label', unit * 0.058, 500);
    drawText(ctx, fitText(ctx, say(surfaceKey(kind), undefined, lang), swatch - unit * 0.04, lang), left + index * swatch, y + unit * 0.3, { lang });
  });

  // The tiers of this roadmap, as bands of altitude.
  y += unit * 0.6;
  ctx.fillStyle = THEME.inkSoft;
  ctx.font = canvasFont('label', unit * 0.066, 500);
  drawText(ctx, say('legendTiers', undefined, lang).toUpperCase(), left, y, { tracking: 0.14, lang });
  y += unit * 0.14;
  const tiers: TierName[] = [];
  for (const stage of plan.roadmap.stages) if (!tiers.includes(stage.tier)) tiers.push(stage.tier);
  const band = (width - left * 2) / Math.max(1, tiers.length);
  tiers.forEach((tier, index) => {
    ctx.fillStyle = THEME.tier[tier];
    ctx.fillRect(left + index * band, y, band - unit * 0.03, unit * 0.09);
    ctx.fillStyle = THEME.ink;
    ctx.font = canvasFont('label', unit * 0.058, 500);
    drawText(ctx, say(tierKey(tier), undefined, lang), left + index * band, y + unit * 0.2, { lang });
  });

  ctx.fillStyle = THEME.inkSoft;
  ctx.font = canvasFont('label', unit * 0.06, 500);
  drawText(ctx, say('checked', { day: formatDay(plan.roadmap.checkedOn, { style: 'iso' }) }, lang).toUpperCase(), left, height - unit * 0.34, { tracking: 0.12, lang });
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------------------
// The mini map of a stage.

/** The mini map: 560 by 300, showing the panel across and the band the route runs in. */
export const MINI = { width: 560, height: 300 } as const;

/** The part of a panel the mini map shows, in panel coordinates. */
export function miniWindow(): { x0: number; x1: number; z0: number; z1: number } {
  const depth = (PANEL.width * MINI.height) / MINI.width;
  return { x0: 0, x1: PANEL.width, z0: STRIP.routeZ - depth / 2, z1: STRIP.routeZ + depth / 2 };
}

/** The pixel of a panel point on the mini map. */
export function miniPixel(x: number, z: number): { x: number; y: number } {
  const window = miniWindow();
  return { x: ((x - window.x0) / (window.x1 - window.x0)) * MINI.width, y: ((z - window.z0) / (window.z1 - window.z0)) * MINI.height };
}

export interface MiniPrint {
  readonly plan: WalkPlan;
  readonly panel: PanelPlan;
  readonly contours: readonly ContourLine[];
  readonly lang: UiLang;
  /** The route is solid up to this length on the panel (you-are-here), or 0. */
  readonly walked: number;
}

/**
 * Draws the base of a stage's mini map: ground, contours, the dashed route with its walked part solid, the
 * waypoint dots and an arrow that points uphill. The walker's own dot is added by whoever shows the map.
 */
export function paintMiniMap(ctx: Ctx, print: MiniPrint): void {
  const { panel, contours, lang } = print;
  const { width, height } = MINI;
  const X = (x: number): number => miniPixel(x, 0).x;
  const Y = (z: number): number => miniPixel(0, z).y;
  const unit = width / PANEL.width;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = mix(THEME.paper, THEME.surface[panel.surface], 0.1);
  ctx.fillRect(0, 0, width, height);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const line of contours) {
    ctx.strokeStyle = withAlpha(THEME.ink, line.major ? 0.34 : 0.16);
    ctx.lineWidth = line.major ? 1.1 : 0.8;
    strokeLine(ctx, line.points, X, Y);
  }
  const route = densePath(panel, 0.01);
  ctx.strokeStyle = withAlpha(THEME.signal, 0.55);
  ctx.lineWidth = 2.4;
  dashedRoute(ctx, route, X, Y, 0.16, 0.6, print.walked);
  if (print.walked > 0) {
    ctx.strokeStyle = THEME.signal;
    ctx.lineWidth = 2.8;
    dashedRoute(ctx, route, X, Y, 0, 1, -Infinity, print.walked);
  }
  for (const mark of panel.marks) {
    ctx.fillStyle = THEME.paperHi;
    ctx.strokeStyle = THEME.ink;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(X(mark.x), Y(mark.z), 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (!mark.waypoint.optional) {
      ctx.fillStyle = THEME.ink;
      ctx.beginPath();
      ctx.arc(X(mark.x), Y(mark.z), 1.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const camp = pathPoint(panel, PLACE.camp);
  ctx.fillStyle = THEME.paperHi;
  ctx.strokeStyle = THEME.signalDeep;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(X(camp.x), Y(camp.z) - 7);
  ctx.lineTo(X(camp.x) + 7, Y(camp.z) + 5);
  ctx.lineTo(X(camp.x) - 7, Y(camp.z) + 5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Uphill is toward the back of every panel, so the arrow points up the page.
  ctx.strokeStyle = withAlpha(THEME.ink, 0.7);
  ctx.fillStyle = withAlpha(THEME.ink, 0.7);
  ctx.lineWidth = 1.4;
  const ax = width - 26;
  ctx.beginPath();
  ctx.moveTo(ax, 44);
  ctx.lineTo(ax, 18);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(ax, 12);
  ctx.lineTo(ax + 5, 22);
  ctx.lineTo(ax - 5, 22);
  ctx.closePath();
  ctx.fill();
  ctx.font = canvasFont('label', 9, 500);
  drawText(ctx, say('uphill', undefined, lang).toUpperCase(), ax + 6, 58, { align: 'right', tracking: 0.1, lang });
  void unit;
  ctx.restore();
}
