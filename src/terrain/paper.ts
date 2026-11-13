import type { Random } from '../core/random';
import { range } from '../core/random';
import type { SurfaceKind } from '../scene/palette';
import { levelIndexAt, type ContourLevel, type Ring } from './contours';
import { markTrail, type Trail, type TrailMark } from './trail';

/**
 * Everything that is printed or pressed into the paper of the terrain model, drawn on 2D canvases. The canvases are
 * read by the card shader as plain numbers, not as colours, one meaning per channel:
 *
 * ground canvas (white means "nothing here")
 *   red    light left by the contact shadow of the card above
 *   green  the printed ground pattern of the band (grass tufts, scree dots and so on)
 *   blue   the cut edge of each card: a ragged band just inside its outline
 *
 * route canvas (black means "nothing here")
 *   red    distance to the route marks, 0.5 exactly on their edge, so the shader can draw a sharp edge at any zoom
 *   blue   how far along the trail the nearest piece of route is, 0..1
 *
 * Both canvases look straight down on the model: canvas x is the footprint's x, canvas y is its z.
 */

/** A canvas with a 2D context, or null where there is none (tests, very old browsers). */
export function createCanvas(size: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  let context: CanvasRenderingContext2D | null = null;
  try {
    context = canvas.getContext('2d');
  } catch {
    context = null;
  }
  return context ? { canvas, context } : null;
}

/**
 * Paper fibre: a grey tile that repeats without a seam. Mid grey is plain paper, lighter and darker are fibres,
 * flecks and soft blotches.
 */
export function paintGrain(context: CanvasRenderingContext2D, size: number, random: Random): void {
  context.globalCompositeOperation = 'source-over';
  context.fillStyle = 'rgb(128,128,128)';
  context.fillRect(0, 0, size, size);

  // Draws something at a point and again wherever it would cross an edge, so the tile wraps.
  const wrapped = (x: number, y: number, reach: number, draw: (px: number, py: number) => void): void => {
    for (let oy = -1; oy <= 1; oy += 1) {
      for (let ox = -1; ox <= 1; ox += 1) {
        const px = x + ox * size;
        const py = y + oy * size;
        if (px < -reach || py < -reach || px > size + reach || py > size + reach) continue;
        draw(px, py);
      }
    }
  };

  // Soft blotches: the sheet is never one even tone.
  for (let i = 0; i < 26; i += 1) {
    const radius = range(random, 0.08, 0.2) * size;
    const light = random() < 0.5;
    const strength = range(random, 0.035, 0.075);
    wrapped(random() * size, random() * size, radius, (px, py) => {
      const blot = context.createRadialGradient(px, py, 0, px, py, radius);
      blot.addColorStop(0, light ? `rgba(255,255,255,${strength})` : `rgba(0,0,0,${strength})`);
      blot.addColorStop(1, light ? 'rgba(255,255,255,0)' : 'rgba(0,0,0,0)');
      context.fillStyle = blot;
      context.fillRect(px - radius, py - radius, radius * 2, radius * 2);
    });
  }

  // Fibres: many short hairs, most of them lying one way, as in machine-made paper.
  context.lineCap = 'round';
  const fibres = Math.round((size * size) / 95);
  for (let i = 0; i < fibres; i += 1) {
    const across = random() < 0.22;
    const angle = (across ? Math.PI / 2 : 0) + range(random, -0.38, 0.38);
    const length = range(random, 0.012, 0.05) * size;
    const dx = Math.cos(angle) * length;
    const dy = Math.sin(angle) * length;
    const bow = range(random, -0.25, 0.25) * length;
    const light = random() < 0.55;
    context.strokeStyle = light ? `rgba(255,255,255,${range(random, 0.05, 0.2)})` : `rgba(0,0,0,${range(random, 0.04, 0.15)})`;
    context.lineWidth = range(random, 0.6, 1.5);
    wrapped(random() * size, random() * size, length, (px, py) => {
      context.beginPath();
      context.moveTo(px, py);
      context.quadraticCurveTo(px + dx * 0.5 - dy * (bow / length), py + dy * 0.5 + dx * (bow / length), px + dx, py + dy);
      context.stroke();
    });
  }

  // Flecks.
  const flecks = Math.round((size * size) / 420);
  for (let i = 0; i < flecks; i += 1) {
    context.fillStyle = random() < 0.7 ? `rgba(0,0,0,${range(random, 0.08, 0.3)})` : `rgba(255,255,255,${range(random, 0.1, 0.3)})`;
    const dot = range(random, 0.5, 1.3);
    context.fillRect(random() * size, random() * size, dot, dot);
  }
}

type ToPixel = (value: number) => number;

function traceRing(context: CanvasRenderingContext2D, ring: Ring, px: ToPixel): void {
  const first = ring[0];
  if (!first) return;
  context.moveTo(px(first.x), px(first.z));
  for (let i = 1; i < ring.length; i += 1) {
    const point = ring[i];
    if (point) context.lineTo(px(point.x), px(point.z));
  }
  context.closePath();
}

function traceLevel(context: CanvasRenderingContext2D, level: ContourLevel, px: ToPixel): void {
  context.beginPath();
  for (const polygon of level.polygons) {
    traceRing(context, polygon.outer, px);
    for (const hole of polygon.holes) traceRing(context, hole, px);
  }
}

/** How dark each pattern prints, as the green value it leaves (255 is no ink). */
const PATTERN_TONE: Record<SurfaceKind, number> = {
  water: 172,
  sand: 176,
  grass: 160,
  forest: 150,
  dirt: 166,
  scree: 150,
  rock: 152,
  snow: 214,
};

/** One small map symbol of a ground surface, drawn at a point. `unit` is the length of one scene unit in pixels. */
function drawSymbol(context: CanvasRenderingContext2D, kind: SurfaceKind, x: number, y: number, unit: number, random: Random): void {
  const s = unit * 0.024;
  context.beginPath();
  switch (kind) {
    case 'water': {
      // A short ripple.
      const w = s * range(random, 1.5, 2.3);
      context.moveTo(x - w, y);
      context.bezierCurveTo(x - w * 0.5, y - s * 0.7, x - w * 0.5, y + s * 0.7, x, y);
      context.bezierCurveTo(x + w * 0.5, y - s * 0.7, x + w * 0.5, y + s * 0.7, x + w, y);
      context.stroke();
      return;
    }
    case 'sand': {
      for (let i = 0; i < 3; i += 1) {
        const dx = range(random, -s, s) * 1.4;
        const dy = range(random, -s, s) * 1.4;
        context.moveTo(x + dx + s * 0.22, y + dy);
        context.arc(x + dx, y + dy, s * 0.22, 0, Math.PI * 2);
      }
      context.fill();
      return;
    }
    case 'grass': {
      // A tuft: three blades from one root.
      for (const lean of [-0.55, 0, 0.55]) {
        context.moveTo(x, y + s * 0.5);
        context.lineTo(x + lean * s * 1.3, y - s * range(random, 0.6, 1.1));
      }
      context.stroke();
      return;
    }
    case 'forest': {
      // The round crown a map uses for a tree.
      const r = s * range(random, 0.7, 1);
      context.arc(x, y, r, 0, Math.PI * 2);
      context.moveTo(x, y + r);
      context.lineTo(x, y + r * 1.7);
      context.stroke();
      return;
    }
    case 'dirt': {
      const angle = range(random, 0, Math.PI);
      const dx = Math.cos(angle) * s * 1.2;
      const dy = Math.sin(angle) * s * 1.2;
      context.moveTo(x - dx, y - dy);
      context.lineTo(x + dx, y + dy);
      context.stroke();
      return;
    }
    case 'scree': {
      for (let i = 0; i < 4; i += 1) {
        const dx = range(random, -s, s) * 1.5;
        const dy = range(random, -s, s) * 1.5;
        const r = s * range(random, 0.2, 0.42);
        context.moveTo(x + dx, y + dy - r);
        context.lineTo(x + dx + r, y + dy + r * 0.8);
        context.lineTo(x + dx - r, y + dy + r * 0.8);
        context.closePath();
      }
      context.fill();
      return;
    }
    case 'rock': {
      // Hachures: a few short strokes side by side, pointing down the slope of the page.
      const angle = range(random, 0.9, 2.2);
      const dx = Math.cos(angle) * s * 1.3;
      const dy = Math.sin(angle) * s * 1.3;
      for (const shift of [-1, 0, 1]) {
        const ox = -dy * 0.55 * shift;
        const oy = dx * 0.55 * shift;
        context.moveTo(x + ox - dx * 0.5, y + oy - dy * 0.5);
        context.lineTo(x + ox + dx * (0.5 - Math.abs(shift) * 0.18), y + oy + dy * (0.5 - Math.abs(shift) * 0.18));
      }
      context.stroke();
      return;
    }
    case 'snow': {
      context.arc(x, y, s * 0.2, 0, Math.PI * 2);
      context.fill();
      return;
    }
  }
}

export interface GroundPrint {
  /** Side of the square canvas in pixels. */
  readonly size: number;
  /** Pixels per scene unit. */
  readonly unit: number;
  readonly levels: readonly ContourLevel[];
  readonly surfaces: readonly SurfaceKind[];
  readonly random: Random;
}

/**
 * Paints the ground canvas, one card after the other from the sheet upward, the way the stack is built. Each card
 * first throws its contact shadow on what lies below, then covers its own area with clean paper, prints its ground
 * pattern and gets its ragged cut edge.
 */
export function paintGround(context: CanvasRenderingContext2D, print: GroundPrint): void {
  const { size, unit, levels, surfaces, random } = print;
  const px: ToPixel = (value) => (value * 0.5 + 0.5) * size;
  context.globalCompositeOperation = 'source-over';
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, size, size);
  context.lineJoin = 'round';
  context.lineCap = 'round';

  // Where the symbols go: a jittered grid, each point given to the card it lies on.
  const spacing = 0.086;
  const symbols: { x: number; z: number }[][] = levels.map(() => []);
  const columns = Math.floor((size / unit) / spacing);
  for (let row = 0; row < columns; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = -1 + ((column + 0.5 + range(random, -0.36, 0.36) + (row % 2) * 0.5) / columns) * 2;
      const z = -1 + ((row + 0.5 + range(random, -0.36, 0.36)) / columns) * 2;
      if (Math.abs(x) > 0.985 || Math.abs(z) > 0.985) continue;
      const index = levelIndexAt(levels, x, z);
      if (index >= 0) symbols[index]?.push({ x, z });
    }
  }

  levels.forEach((level, index) => {
    if (level.polygons.length === 0) return;
    if (index > 0) {
      // Contact shadow: several strokes of falling width darken the red channel round the outline.
      context.globalCompositeOperation = 'multiply';
      context.strokeStyle = 'rgb(226,255,255)';
      traceLevel(context, level, px);
      for (let pass = 0; pass < 8; pass += 1) {
        context.lineWidth = 2 * unit * (0.1 - (0.1 - 0.012) * (pass / 7));
        context.stroke();
      }
    }

    context.globalCompositeOperation = 'source-over';
    context.fillStyle = '#ffffff';
    traceLevel(context, level, px);
    context.fill('evenodd');

    context.save();
    traceLevel(context, level, px);
    context.clip('evenodd');

    const kind = surfaces[index] ?? 'grass';
    const tone = PATTERN_TONE[kind];
    context.strokeStyle = `rgb(255,${tone},255)`;
    context.fillStyle = `rgb(255,${tone},255)`;
    context.lineWidth = Math.max(1, unit * 0.0052);
    for (const point of symbols[index] ?? []) drawSymbol(context, kind, px(point.x), px(point.z), unit, random);

    // The cut edge: short strokes of wandering width along the outline. The clip keeps only their inner half.
    context.globalCompositeOperation = 'multiply';
    context.strokeStyle = 'rgb(255,255,70)';
    const piece = Math.max(3, unit * 0.022);
    let width = 0.5;
    for (const polygon of level.polygons) {
      for (const ring of [polygon.outer, ...polygon.holes]) {
        for (let i = 0; i < ring.length; i += 1) {
          const a = ring[i];
          const b = ring[(i + 1) % ring.length];
          if (!a || !b) continue;
          const ax = px(a.x);
          const ay = px(a.z);
          const bx = px(b.x);
          const by = px(b.z);
          const steps = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / piece));
          for (let k = 0; k < steps; k += 1) {
            width = Math.min(1, Math.max(0.12, width + range(random, -0.3, 0.3)));
            context.lineWidth = 2 * unit * (0.004 + 0.012 * width);
            context.beginPath();
            context.moveTo(ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps);
            context.lineTo(ax + ((bx - ax) * (k + 1)) / steps, ay + ((by - ay) * (k + 1)) / steps);
            context.stroke();
          }
        }
      }
    }
    context.restore();
  });
  context.globalCompositeOperation = 'source-over';
}

export interface RoutePrint {
  readonly size: number;
  /** Pixels per scene unit. */
  readonly unit: number;
  /** Scene units per footprint unit: the footprint is 2 wide, the paper is 2 x this. */
  readonly half: number;
  readonly trail: Trail;
  /** Width of the printed line in scene units. */
  readonly lineWidth: number;
  /** Radius of the large dot printed under each stop, in scene units. */
  readonly stopRadius: number;
}

/**
 * The printed route is one even dashed line. The lengths are in scene units and measure the centre line: a dash is
 * drawn with round ends, so on paper it is one line width longer and the gap one line width shorter.
 */
export const ROUTE_DASH = { dash: 0.1, gap: 0.062 } as const;

/** How far the distance ramp reaches to either side of the edge of the line, as a share of the line's width. */
export const ROUTE_RAMP = 0.42;

/** The dashes of the printed route. `half` is scene units per footprint unit. */
export function routeMarks(trail: Trail, half: number): TrailMark[] {
  return markTrail(trail, { dash: ROUTE_DASH.dash / half, gap: ROUTE_DASH.gap / half, dotEvery: 0 });
}

/** How far, in scene units, the along-the-trail channel reaches past the centre of the line. */
export function routeBleed(print: Pick<RoutePrint, 'lineWidth'>): number {
  return print.lineWidth / 2 + print.lineWidth * ROUTE_RAMP + 0.008;
}

/**
 * Paints the route canvas: dashes and stop dots as a distance field in red, and the position along the trail in
 * blue.
 */
export function paintRoute(context: CanvasRenderingContext2D, print: RoutePrint): void {
  const { size, unit, half, trail, lineWidth, stopRadius } = print;
  const px: ToPixel = (value) => (value * 0.5 + 0.5) * size;
  context.globalCompositeOperation = 'source-over';
  context.fillStyle = '#000000';
  context.fillRect(0, 0, size, size);
  // 'lighten' keeps the larger value of every channel, so the channels never disturb each other.
  context.globalCompositeOperation = 'lighten';
  context.lineCap = 'round';
  context.lineJoin = 'round';

  // Blue: position along the trail, as a broad band under everything red.
  const bleed = routeBleed(print) * unit;
  context.lineWidth = bleed * 2;
  const points = trail.points;
  let start = 0;
  while (start < points.length - 1) {
    const tone = Math.round((points[start + 1]?.along ?? 0) * 255);
    let end = start + 1;
    while (end < points.length - 1 && Math.round((points[end + 1]?.along ?? 0) * 255) === tone) end += 1;
    context.strokeStyle = `rgb(0,0,${tone})`;
    context.beginPath();
    for (let i = start; i <= end; i += 1) {
      const p = points[i];
      if (!p) continue;
      if (i === start) context.moveTo(px(p.x), px(p.z));
      else context.lineTo(px(p.x), px(p.z));
    }
    context.stroke();
    start = end;
  }
  const ringReach = (stopRadius * 1.3 + lineWidth) * unit;
  for (const stop of trail.stops) {
    context.fillStyle = `rgb(0,0,${Math.round(stop.along * 255)})`;
    context.beginPath();
    context.arc(px(stop.x), px(stop.z), ringReach, 0, Math.PI * 2);
    context.fill();
  }

  // Red: nested strokes from wide and dark to narrow and bright build a ramp that is 0.5 on the true edge.
  const marks = routeMarks(trail, half);
  const spread = lineWidth * ROUTE_RAMP * unit;
  const steps = 10;
  for (let step = 1; step <= steps; step += 1) {
    const value = step / steps;
    const grow = spread * (1 - 2 * value);
    const tone = `rgb(${Math.round(value * 255)},0,0)`;
    context.strokeStyle = tone;
    context.fillStyle = tone;

    const lineReach = (lineWidth / 2) * unit + grow;
    if (lineReach > 0.3) {
      context.lineWidth = lineReach * 2;
      context.beginPath();
      for (const mark of marks) {
        mark.points.forEach((p, i) => {
          if (i === 0) context.moveTo(px(p.x), px(p.z));
          else context.lineTo(px(p.x), px(p.z));
        });
      }
      context.stroke();
    }

    // A larger dot under every stop, the largest under the summit.
    context.beginPath();
    trail.stops.forEach((stop, index) => {
      const last = index === trail.stops.length - 1;
      const reach = (last ? stopRadius * 1.3 : stopRadius) * unit + grow;
      if (reach <= 0.3) return;
      context.moveTo(px(stop.x) + reach, px(stop.z));
      context.arc(px(stop.x), px(stop.z), reach, 0, Math.PI * 2);
    });
    context.fill();
  }
  context.globalCompositeOperation = 'source-over';
}
