import { TAU } from './heading';
import { DIAL_FILL, bandBlockBearing, dialPoint, type DialLabel, type DialLayout, type DialPoint } from './dial-layout';

/**
 * Paints the dial face onto a 2D canvas: a cream paper card with an ink compass rose in the middle and, round
 * it, the engraved ring.
 *
 * One picture does three jobs. It is the colour of the card. On the metal ring it is a tint: the ring area is
 * left almost white so the metal keeps its own colour, and the engraving is dark, like cuts filled with black
 * wax. And because dark means "lower" for a bump map and "smoother" for a roughness map, the same picture also
 * gives the engraving a little depth and the ink a little sheen.
 */
export interface DialColors {
  readonly paper: string;
  readonly paperShade: string;
  readonly ink: string;
  readonly inkSoft: string;
  readonly signal: string;
  /** The dark filling of the engraved marks on the metal ring. */
  readonly engraving: string;
}

export interface PaintDialOptions {
  /** Canvas side in pixels. */
  readonly size: number;
  readonly layout: DialLayout;
  readonly colors: DialColors;
  /** A source of numbers in [0, 1) for the paper speckle and the brush marks. */
  readonly random: () => number;
  /** Font stack for letters and numerals. */
  readonly fontFamily?: string;
}

export const DIAL_FONT = "Georgia, 'Times New Roman', Times, serif";

/** Paints the whole dial. The context must belong to a square canvas of `options.size` pixels. */
export function paintDial(ctx: CanvasRenderingContext2D, options: PaintDialOptions): void {
  const { size, layout, colors, random } = options;
  const family = options.fontFamily ?? DIAL_FONT;
  const half = size / 2;
  const unit = half * DIAL_FILL;
  const px = (fraction: number): number => fraction * unit;
  const at = (point: DialPoint): DialPoint => ({ x: half + point.x * unit, y: half + point.y * unit });
  const fine = Math.max(1, size / 1024);

  const circle = (radius: number): void => {
    ctx.beginPath();
    ctx.arc(half, half, px(radius), 0, TAU);
  };

  const label = (item: DialLabel, weight: string, color: string): void => {
    const p = at(dialPoint(item.bearing, item.radius));
    const fontPx = px(item.size);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(item.bearing);
    ctx.font = `${weight} ${fontPx.toFixed(1)}px ${family}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    // Capitals sit a little high on the middle baseline; nudge them to the optical centre.
    ctx.fillText(item.text, 0, fontPx * 0.06);
    ctx.restore();
  };

  // 1. The metal ring area: almost white, so the metal under it shows its own colour.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  // Fine circular brush marks, as left by a lathe.
  const streaks = Math.round(size * 0.22);
  ctx.lineCap = 'butt';
  for (let i = 0; i < streaks; i += 1) {
    const radius = layout.cardRadius + (1.02 - layout.cardRadius) * random();
    const start = random() * TAU;
    const sweep = (0.2 + 0.8 * random()) * TAU * 0.5;
    ctx.strokeStyle = `rgba(38, 26, 10, ${(0.03 + 0.1 * random()).toFixed(3)})`;
    ctx.lineWidth = fine * (0.6 + 1.2 * random());
    ctx.beginPath();
    ctx.arc(half, half, px(radius), start, start + sweep);
    ctx.stroke();
  }

  // 2. The paper card.
  circle(layout.cardRadius);
  ctx.fillStyle = colors.paper;
  ctx.fill();

  ctx.save();
  circle(layout.cardRadius);
  ctx.clip();

  // Age: darker towards the edge, a few soft blotches, speckle and fibres.
  const age = ctx.createRadialGradient(half, half, px(layout.cardRadius * 0.35), half, half, px(layout.cardRadius));
  age.addColorStop(0, withAlpha(colors.paperShade, 0.14));
  age.addColorStop(0.75, withAlpha(colors.paperShade, 0.34));
  age.addColorStop(1, withAlpha(colors.paperShade, 0.8));
  ctx.fillStyle = age;
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 14; i += 1) {
    const p = at(dialPoint(random() * TAU, layout.cardRadius * Math.sqrt(random())));
    const r = px(0.04 + 0.1 * random());
    const blot = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    blot.addColorStop(0, withAlpha(colors.paperShade, 0.2 + 0.2 * random()));
    blot.addColorStop(1, withAlpha(colors.paperShade, 0));
    ctx.fillStyle = blot;
    ctx.fillRect(p.x - r, p.y - r, 2 * r, 2 * r);
  }

  const speckles = Math.round(size * 0.6);
  for (let i = 0; i < speckles; i += 1) {
    const p = at(dialPoint(random() * TAU, layout.cardRadius * Math.sqrt(random())));
    ctx.fillStyle = withAlpha(colors.ink, 0.03 + 0.07 * random());
    const s = fine * (0.5 + 1.1 * random());
    ctx.fillRect(p.x, p.y, s, s);
  }
  ctx.lineWidth = fine * 0.6;
  for (let i = 0; i < Math.round(size * 0.12); i += 1) {
    const p = at(dialPoint(random() * TAU, layout.cardRadius * Math.sqrt(random())));
    const angle = random() * TAU;
    const length = fine * (4 + 10 * random());
    ctx.strokeStyle = withAlpha(colors.inkSoft, 0.05 + 0.08 * random());
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + Math.cos(angle) * length, p.y + Math.sin(angle) * length);
    ctx.stroke();
  }

  // The chequered border.
  const band = layout.band;
  const blockSweep = TAU / band.blocks;
  ctx.fillStyle = colors.ink;
  for (let i = 0; i < band.blocks; i += 2) {
    // Canvas angles start at east; bearings start at north.
    const middle = bandBlockBearing(band, i) - Math.PI / 2;
    ctx.beginPath();
    ctx.arc(half, half, px(band.outer), middle - blockSweep / 2, middle + blockSweep / 2);
    ctx.arc(half, half, px(band.inner), middle + blockSweep / 2, middle - blockSweep / 2, true);
    ctx.closePath();
    ctx.fill();
  }
  ctx.strokeStyle = colors.ink;
  for (const edge of [band.inner, band.outer]) {
    ctx.lineWidth = Math.max(1, px(0.0028));
    circle(edge);
    ctx.stroke();
  }

  for (const line of layout.cardLines) {
    ctx.strokeStyle = colors.ink;
    ctx.lineWidth = Math.max(1, px(line.width));
    circle(line.radius);
    ctx.stroke();
  }

  // The rose: short points first, long points on top.
  ctx.lineJoin = 'miter';
  for (const facet of layout.rose) {
    const [a, b, c] = facet.points.map(at) as [DialPoint, DialPoint, DialPoint];
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.closePath();
    ctx.fillStyle = facet.tone === 'ink' ? colors.ink : facet.tone === 'soft' ? colors.inkSoft : colors.paper;
    ctx.fill();
    ctx.strokeStyle = colors.ink;
    ctx.lineWidth = Math.max(1, px(facet.rank === 0 ? 0.0034 : 0.0026));
    ctx.stroke();
  }

  for (const item of layout.cardLabels) label(item, '600', colors.ink);

  // The north mark, in the one signal colour.
  const [n0, n1, n2] = layout.northMark.map(at) as [DialPoint, DialPoint, DialPoint];
  ctx.beginPath();
  ctx.moveTo(n0.x, n0.y);
  ctx.lineTo(n1.x, n1.y);
  ctx.lineTo(n2.x, n2.y);
  ctx.closePath();
  ctx.fillStyle = colors.signal;
  ctx.fill();

  // The ring stands a little above the card and shades its edge.
  const shade = ctx.createRadialGradient(half, half, px(layout.cardRadius * 0.93), half, half, px(layout.cardRadius));
  shade.addColorStop(0, 'rgba(20, 14, 6, 0)');
  shade.addColorStop(1, 'rgba(20, 14, 6, 0.34)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();

  // 3. The engraving on the metal ring.
  ctx.strokeStyle = colors.engraving;
  for (const line of layout.ringLines) {
    ctx.lineWidth = Math.max(1, px(line.width));
    circle(line.radius);
    ctx.stroke();
  }
  for (const tick of layout.ticks) {
    const a = at(dialPoint(tick.bearing, tick.inner));
    const b = at(dialPoint(tick.bearing, tick.outer));
    ctx.lineWidth = Math.max(1, px(tick.width));
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  for (const item of layout.ringLabels) label(item, item.kind === 'cardinal' ? '700' : '600', colors.engraving);
}

/** `#rrggbb` (or `#rgb`) with an alpha, as a CSS colour. Anything else is passed through unchanged. */
export function withAlpha(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return hex;
  const digits = match[1] as string;
  const full = digits.length === 3 ? [...digits].map((d) => d + d).join('') : digits;
  const value = Number.parseInt(full, 16);
  const a = Math.min(1, Math.max(0, alpha));
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${Number(a.toFixed(3))})`;
}
