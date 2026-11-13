/**
 * Colours as the painter needs them: read from what the stylesheet gives, mixed the way `color-mix(in srgb)`
 * mixes, and written back as CSS a canvas accepts. Nothing here touches the page.
 */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  /** 0 to 1. */
  a: number;
}

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

function channel(text: string): number {
  const value = text.trim();
  if (value.endsWith('%')) return clamp((parseFloat(value) / 100) * 255, 0, 255);
  return clamp(parseFloat(value), 0, 255);
}

function alpha(text: string | undefined): number {
  if (text === undefined) return 1;
  const value = text.trim();
  if (value.endsWith('%')) return clamp(parseFloat(value) / 100, 0, 1);
  return clamp(parseFloat(value), 0, 1);
}

/**
 * Reads `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()` and `rgba()` in either syntax, `color(srgb ...)`,
 * `transparent`, `black` and `white`. Anything else gives null: the caller resolves it on the page first.
 */
export function parseColour(text: string): Rgba | null {
  const value = text.trim().toLowerCase();
  if (value === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (value === 'black') return { r: 0, g: 0, b: 0, a: 1 };
  if (value === 'white') return { r: 255, g: 255, b: 255, a: 1 };
  const hex = /^#([0-9a-f]{3,8})$/.exec(value);
  if (hex) {
    const digits = hex[1]!;
    if (digits.length === 3 || digits.length === 4) {
      const [r, g, b, a] = [...digits].map((digit) => parseInt(digit + digit, 16));
      return { r: r!, g: g!, b: b!, a: a === undefined ? 1 : a / 255 };
    }
    if (digits.length === 6 || digits.length === 8) {
      const pair = (index: number) => parseInt(digits.slice(index, index + 2), 16);
      return { r: pair(0), g: pair(2), b: pair(4), a: digits.length === 8 ? pair(6) / 255 : 1 };
    }
    return null;
  }
  const rgb = /^rgba?\((.*)\)$/.exec(value);
  if (rgb) {
    const body = rgb[1]!;
    const [colours, slash] = body.split('/');
    const parts = colours!.includes(',') ? colours!.split(',') : colours!.trim().split(/\s+/);
    if (parts.length < 3) return null;
    const a = slash !== undefined ? alpha(slash) : parts.length > 3 ? alpha(parts[3]) : 1;
    const result = { r: channel(parts[0]!), g: channel(parts[1]!), b: channel(parts[2]!), a };
    return [result.r, result.g, result.b, result.a].some(Number.isNaN) ? null : result;
  }
  const srgb = /^color\(srgb\s+([^)]*)\)$/.exec(value);
  if (srgb) {
    const [colours, slash] = srgb[1]!.split('/');
    const parts = colours!.trim().split(/\s+/).map((part) => (part.endsWith('%') ? parseFloat(part) / 100 : parseFloat(part)));
    if (parts.length < 3 || parts.some(Number.isNaN)) return null;
    return { r: clamp(parts[0]! * 255, 0, 255), g: clamp(parts[1]! * 255, 0, 255), b: clamp(parts[2]! * 255, 0, 255), a: alpha(slash) };
  }
  return null;
}

const hex2 = (value: number): string => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0');

/** As CSS: `#rrggbb` when opaque, `rgba()` otherwise. */
export function css(colour: Rgba): string {
  if (colour.a >= 1) return `#${hex2(colour.r)}${hex2(colour.g)}${hex2(colour.b)}`;
  return `rgba(${Math.round(colour.r)}, ${Math.round(colour.g)}, ${Math.round(colour.b)}, ${Math.round(colour.a * 1000) / 1000})`;
}

/** Parses or falls back, so a missing custom property never stops a face from painting. */
export function colourOr(text: string | undefined, fallback: string): Rgba {
  return parseColour(text ?? '') ?? parseColour(fallback) ?? { r: 0, g: 0, b: 0, a: 1 };
}

/**
 * `color-mix(in srgb, one share%, other)`: the two colours mixed with premultiplied alpha, as the
 * stylesheet does. `share` is the part of `one`, 0 to 1.
 */
export function mix(one: Rgba, other: Rgba, share: number): Rgba {
  const p = clamp(share, 0, 1);
  const q = 1 - p;
  const a = one.a * p + other.a * q;
  if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: (one.r * one.a * p + other.r * other.a * q) / a,
    g: (one.g * one.a * p + other.g * other.a * q) / a,
    b: (one.b * one.a * p + other.b * other.a * q) / a,
    a,
  };
}

/** `colour` laid over an opaque `ground`, as it is seen. */
export function over(colour: Rgba, ground: Rgba): Rgba {
  const a = clamp(colour.a, 0, 1);
  return {
    r: colour.r * a + ground.r * (1 - a),
    g: colour.g * a + ground.g * (1 - a),
    b: colour.b * a + ground.b * (1 - a),
    a: 1,
  };
}

const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };

/** Relative luminance (WCAG), 0 to 1. */
export function luminance(colour: Rgba): number {
  const linear = (value: number) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linear(colour.r) + 0.7152 * linear(colour.g) + 0.0722 * linear(colour.b);
}

export function contrast(one: Rgba, other: Rgba): number {
  const a = luminance(one);
  const b = luminance(other);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** A gradient stop: a colour and its place, 0 to 1. */
export interface Stop {
  colour: Rgba;
  at: number;
}

/**
 * The mean colour of a linear gradient across its length. A foil the stylesheet draws as a gradient (a
 * fake highlight) is painted flat in this colour, so it reads the same at a glance and the material adds
 * the real shine.
 */
export function gradientMean(stops: readonly Stop[]): Rgba {
  if (stops.length === 0) return BLACK;
  if (stops.length === 1) return stops[0]!.colour;
  const sorted = [...stops].sort((one, other) => one.at - other.at);
  const parts: { colour: Rgba; weight: number }[] = [];
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  if (first.at > 0) parts.push({ colour: first.colour, weight: first.at });
  for (let index = 1; index < sorted.length; index++) {
    const from = sorted[index - 1]!;
    const to = sorted[index]!;
    const weight = Math.max(0, to.at - from.at);
    if (weight > 0) parts.push({ colour: mix(from.colour, to.colour, 0.5), weight });
  }
  if (last.at < 1) parts.push({ colour: last.colour, weight: 1 - last.at });
  const total = parts.reduce((sum, part) => sum + part.weight, 0) || 1;
  return parts.reduce<Rgba>(
    (sum, part) => ({
      r: sum.r + (part.colour.r * part.weight) / total,
      g: sum.g + (part.colour.g * part.weight) / total,
      b: sum.b + (part.colour.b * part.weight) / total,
      a: sum.a + (part.colour.a * part.weight) / total,
    }),
    { r: 0, g: 0, b: 0, a: 0 },
  );
}

export { BLACK };
