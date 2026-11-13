import { TAU } from './heading';

/**
 * Where everything on the dial goes. Pure numbers, no canvas: the painter in `dial-texture.ts` only follows this.
 *
 * Lengths are fractions of the dial radius (1 is the outer edge of the engraved ring). Angles are bearings:
 * radians clockwise from north. A dial point is `dialPoint(bearing, radius)` with x to the east and y to the
 * south, which is how a canvas counts when north is at the top.
 */
export interface DialPoint {
  readonly x: number;
  readonly y: number;
}

export function dialPoint(bearing: number, radius: number): DialPoint {
  return { x: radius * Math.sin(bearing), y: -radius * Math.cos(bearing) };
}

export type TickKind = 'minor' | 'mid' | 'major';

export interface DialTick {
  readonly bearing: number;
  readonly degrees: number;
  readonly kind: TickKind;
  readonly inner: number;
  readonly outer: number;
  /** Line width as a fraction of the dial radius. */
  readonly width: number;
}

export type LabelKind = 'cardinal' | 'numeral' | 'intercardinal';

export interface DialLabel {
  readonly bearing: number;
  readonly radius: number;
  readonly text: string;
  /** Font size as a fraction of the dial radius. */
  readonly size: number;
  readonly kind: LabelKind;
}

export type FacetTone = 'ink' | 'paper' | 'soft';

/** One half of a point of the compass rose: a triangle from the centre to the tip. */
export interface RoseFacet {
  readonly points: readonly [DialPoint, DialPoint, DialPoint];
  readonly tone: FacetTone;
  /** 0 for the four long points, 1 for the four between them, 2 for the eight short ones. */
  readonly rank: 0 | 1 | 2;
}

export interface DialRing {
  readonly radius: number;
  readonly width: number;
}

export interface DialBand {
  readonly inner: number;
  readonly outer: number;
  /** Number of blocks round the band; every second one is inked. */
  readonly blocks: number;
}

export interface DialLayout {
  /** Outer radius of the paper card. The engraved metal ring runs from here to 1. */
  readonly cardRadius: number;
  /** Engraved ticks on the metal ring. */
  readonly ticks: readonly DialTick[];
  /** Engraved letters and numerals on the metal ring. */
  readonly ringLabels: readonly DialLabel[];
  /** Fine engraved circles that border the metal ring. */
  readonly ringLines: readonly DialRing[];
  /** Rose facets in drawing order: short points first, long points last. */
  readonly rose: readonly RoseFacet[];
  /** Ink circles on the card. */
  readonly cardLines: readonly DialRing[];
  /** The chequered border of the card. */
  readonly band: DialBand;
  /** Small printed letters on the card. */
  readonly cardLabels: readonly DialLabel[];
  /** The north mark on the card edge: a triangle that points outward. */
  readonly northMark: readonly [DialPoint, DialPoint, DialPoint];
}

export interface DialLayoutOptions {
  /** Degrees between two ticks. 2 on desktops, 5 where the texture is small. */
  readonly tickStep?: number;
  /** Outer radius of the paper card, as a fraction of the dial radius. */
  readonly cardRadius?: number;
}

const CARDINALS = ['N', 'E', 'S', 'W'] as const;
const INTERCARDINALS = ['NE', 'SE', 'SW', 'NW'] as const;

const rad = (degrees: number): number => (degrees * Math.PI) / 180;

/** Builds the layout of the dial. The same options always give the same layout. */
export function layoutDial(options: DialLayoutOptions = {}): DialLayout {
  const tickStep = options.tickStep ?? 2;
  const cardRadius = options.cardRadius ?? 0.78;
  if (!(tickStep > 0) || 360 % tickStep !== 0) throw new Error('layoutDial: tickStep must divide 360');
  if (!(cardRadius > 0.3 && cardRadius < 0.95)) throw new Error('layoutDial: cardRadius must lie between 0.3 and 0.95');

  // The metal ring between the card and the rim.
  const ringWidth = 1 - cardRadius;
  const tickOuter = 1 - ringWidth * 0.1;
  const ticks: DialTick[] = [];
  for (let degrees = 0; degrees < 360; degrees += tickStep) {
    const kind: TickKind = degrees % 30 === 0 ? 'major' : degrees % 10 === 0 ? 'mid' : 'minor';
    const length = ringWidth * (kind === 'major' ? 0.3 : kind === 'mid' ? 0.24 : 0.14);
    const width = kind === 'major' ? 0.0075 : kind === 'mid' ? 0.0055 : 0.0038;
    ticks.push({ bearing: rad(degrees), degrees, kind, inner: tickOuter - length, outer: tickOuter, width });
  }

  const labelRadius = cardRadius + ringWidth * 0.34;
  const ringLabels: DialLabel[] = [];
  for (let degrees = 0; degrees < 360; degrees += 30) {
    if (degrees % 90 === 0) {
      const text = CARDINALS[degrees / 90] as string;
      ringLabels.push({ bearing: rad(degrees), radius: labelRadius, text, size: ringWidth * 0.5, kind: 'cardinal' });
    } else {
      ringLabels.push({
        bearing: rad(degrees),
        radius: labelRadius,
        text: String(degrees),
        size: ringWidth * 0.27,
        kind: 'numeral',
      });
    }
  }

  const ringLines: DialRing[] = [
    { radius: cardRadius + ringWidth * 0.07, width: 0.004 },
    { radius: 1 - ringWidth * 0.05, width: 0.005 },
  ];

  // The rose on the card. Lengths below are fractions of the card radius.
  const c = cardRadius;
  const rose: RoseFacet[] = [];
  const addPoint = (bearing: number, tip: number, spread: number, waist: number, rank: 0 | 1 | 2): void => {
    const centre: DialPoint = { x: 0, y: 0 };
    const tipPoint = dialPoint(bearing, tip * c);
    const left = dialPoint(bearing - spread, waist * c);
    const right = dialPoint(bearing + spread, waist * c);
    // The half that comes first when going clockwise is inked, the other stays paper: the classic split point.
    rose.push({ points: [centre, left, tipPoint], tone: rank === 2 ? 'soft' : 'ink', rank });
    rose.push({ points: [centre, tipPoint, right], tone: 'paper', rank });
  };
  for (let i = 0; i < 8; i += 1) addPoint(rad(22.5 + 45 * i), 0.46, rad(11.25), 0.25, 2);
  for (let i = 0; i < 4; i += 1) addPoint(rad(45 + 90 * i), 0.62, rad(22.5), 0.19, 1);
  for (let i = 0; i < 4; i += 1) addPoint(rad(90 * i), 0.86, rad(45), 0.135, 0);

  const cardLines: DialRing[] = [
    { radius: 0.975 * c, width: 0.006 },
    { radius: 0.885 * c, width: 0.003 },
    { radius: 0.4 * c, width: 0.003 },
    { radius: 0.385 * c, width: 0.0018 },
  ];

  const band: DialBand = { inner: 0.905 * c, outer: 0.955 * c, blocks: 72 };

  const cardLabels: DialLabel[] = INTERCARDINALS.map((text, i) => ({
    bearing: rad(45 + 90 * i),
    radius: 0.755 * c,
    text,
    size: 0.085 * c,
    kind: 'intercardinal' as const,
  }));

  const northMark: [DialPoint, DialPoint, DialPoint] = [
    dialPoint(0, 0.9 * c),
    dialPoint(rad(-2.6), 0.972 * c),
    dialPoint(rad(2.6), 0.972 * c),
  ];

  return { cardRadius, ticks, ringLabels, ringLines, rose, cardLines, band, cardLabels, northMark };
}

/** Maps a dial point to canvas pixels. `size` is the canvas side; the dial fills `fill` of the half side. */
export function dialToCanvas(point: DialPoint, size: number, fill = DIAL_FILL): DialPoint {
  const half = size / 2;
  return { x: half + point.x * half * fill, y: half + point.y * half * fill };
}

/** The dial does not touch the canvas edge, so mip levels never bleed the outside colour into the rim. */
export const DIAL_FILL = 0.98;

/**
 * Texture coordinates of a point on the dial plane. `x` is east and `z` is south in the frame of the compass body
 * (the scene's +X and +Z when the body is not turned); `dialRadius` is the radius of the dial in the same units.
 * With a flipped canvas texture (the three.js default), v = 1 is the top of the canvas, which is north.
 */
export function dialUv(x: number, z: number, dialRadius: number): { u: number; v: number } {
  const k = (0.5 * DIAL_FILL) / dialRadius;
  return { u: 0.5 + x * k, v: 0.5 - z * k };
}

/** The bearing of the middle of block `index` of the chequered band. */
export function bandBlockBearing(band: DialBand, index: number): number {
  return ((index + 0.5) / band.blocks) * TAU;
}
