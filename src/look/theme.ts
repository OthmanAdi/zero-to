import { PALETTE } from '../scene/palette';

/**
 * The whole look as one object: the scene palette plus the colours of the room, the type and the covers.
 *
 * Rules that go with it:
 *
 * - `signal` is the only saturated colour, and it always means the route, the pin or "you are here". It never
 *   means an error or a status.
 * - On paper, small text in the signal colour uses `signalDeep`. `signal` itself is for display sizes and
 *   graphics.
 * - Tier colours appear on covers, blazes, dial blocks, profile bands and ratings, and nowhere else.
 * - Verified is the unmarked state. Only `status.gated` and `status.unverified` are ever shown.
 */
export const THEME = {
  ...PALETTE,

  /** The page before the lamp is on. */
  void: '#05070b',

  /** The cloth under the table. */
  cloth: '#18202e',
  clothDeep: '#0d121b',

  /** The turntable. */
  walnut: '#5a4532',
  walnutDeep: '#1c140e',

  /** Type on the room. */
  text: '#eef0f2',
  textSoft: '#a9b2bf',
  textFaint: '#8a94a3',

  /** The second paper tone of the contour cards. */
  card: '#ece5d8',

  /** The lamp once it is warm, the lamp before it warms, and the low sun of the dive. */
  lampLight: '#ffe9c9',
  lampCold: '#b9c9ff',
  sun: '#ffe7c2',

  /** Cover cloth by target tier. `paperHi` is the type colour on all four. */
  cover: {
    bronze: '#7d5233',
    silver: '#566170',
    gold: '#86671d',
    diamond: '#48579a',
  },

  /** The two marked states of a resource. */
  status: {
    gated: '#8a5a12',
    unverified: PALETTE.inkSoft,
  },

  /** Tape on notes. */
  tape: 'rgba(226, 208, 160, 0.55)',
} as const;

export type Theme = typeof THEME;

/**
 * The focus ring, one rule for every package.
 *
 * - On the room (the dark ground) a focused control gets a 2 px ring in the lamp colour, 2 px off its edge.
 * - On paper the lamp colour alone is too faint, so the ring is 2 px of ink, and the lamp is kept as a halo
 *   round it. The ink carries the contrast (12 to 1 on paper), the halo carries the look.
 *
 * In CSS the rule comes with `look.css`: any control inside `.zt-paper` or `.zt-on-paper`, or a control that
 * carries `.zt-on-paper` itself, gets the paper ring. Everything else gets the room ring.
 */
export const FOCUS = {
  width: 2,
  offset: 2,
  room: THEME.lamp,
  paper: THEME.ink,
  /** The halo as a box shadow: a band of lamp colour under the ink ring and a soft glow beyond it. */
  halo: '0 0 0 4px var(--zt-lamp), 0 0 10px 6px rgba(255, 217, 160, 0.6)',
} as const;

/** The custom properties of the focus ring. */
export function focusTokens(): [name: string, value: string][] {
  return [
    ['--zt-focus-width', `${FOCUS.width}px`],
    ['--zt-focus-offset', `${FOCUS.offset}px`],
    ['--zt-focus-room', 'var(--zt-lamp)'],
    ['--zt-focus-paper', 'var(--zt-ink)'],
    ['--zt-focus-halo', FOCUS.halo],
  ];
}

/** The prefix of every custom property the look injects. */
export const TOKEN_PREFIX = '--zt-';

function kebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * Every colour of the theme as a custom property name and its value: `night` is `--zt-night`, `paperHi` is
 * `--zt-paper-hi`, `tier.gold` is `--zt-tier-gold`.
 */
export function tokenEntries(theme: Theme = THEME): [name: string, value: string][] {
  const entries: [string, string][] = [];
  const walk = (node: Readonly<Record<string, unknown>>, path: string) => {
    for (const [key, value] of Object.entries(node)) {
      const name = path ? `${path}-${kebab(key)}` : kebab(key);
      if (typeof value === 'string') entries.push([`${TOKEN_PREFIX}${name}`, value]);
      else if (value && typeof value === 'object') walk(value as Record<string, unknown>, name);
    }
  };
  walk(theme, '');
  return entries;
}

/** The custom property name of a token path, for example `tokenName('tier.gold')` is `--zt-tier-gold`. */
export function tokenName(path: string): string {
  return `${TOKEN_PREFIX}${path.split('.').map(kebab).join('-')}`;
}

/** `var(--zt-…)` for a token path, for styles written in script. */
export function tokenVar(path: string): string {
  return `var(${tokenName(path)})`;
}

/**
 * The theme as a `:root` rule. The build inlines this in the document head so the first paint already has every
 * colour. `extra` adds properties from other parts of the look, such as the font stacks.
 */
export function tokensCss(extra: readonly (readonly [string, string])[] = [], theme: Theme = THEME): string {
  const lines = [...tokenEntries(theme), ...extra].map(([name, value]) => `  ${name}: ${value};`);
  return `:root {\n${lines.join('\n')}\n}\n`;
}

// ---------------------------------------------------------------------------------------------------------
// Colour arithmetic. Small on purpose: enough to check contrast and to hand colours to a canvas or a shader.

/** A colour as red, green and blue from 0 to 1, in sRGB. */
export type Rgb = readonly [r: number, g: number, b: number];

/** Reads `#rgb` or `#rrggbb`. */
export function hexToRgb(hex: string): Rgb {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match?.[1]) throw new Error(`hexToRgb: "${hex}" is not a hex colour`);
  const digits = match[1].length === 3 ? match[1].replace(/./g, '$&$&') : match[1];
  const value = Number.parseInt(digits, 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

export function rgbToHex(rgb: Rgb): string {
  const part = (value: number) =>
    Math.round(Math.min(1, Math.max(0, value)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${part(rgb[0])}${part(rgb[1])}${part(rgb[2])}`;
}

/** A hex colour with an alpha, as a CSS colour: `withAlpha('#1f2a3d', 0.5)` is `rgba(31, 42, 61, 0.5)`. */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`;
}

/** Blends two hex colours in sRGB: `t` 0 is `a`, 1 is `b`. Prints and tints use this. */
export function mix(a: string, b: string, t: number): string {
  const from = hexToRgb(a);
  const to = hexToRgb(b);
  return rgbToHex([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t]);
}

function channelToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

/** Relative luminance as WCAG 2 defines it: 0 is black, 1 is white. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b);
}

/** WCAG 2 contrast ratio of two colours, from 1 (the same) to 21 (black on white). */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The pairs of type colour and ground that the interface uses for text. Each must reach 4.5 to 1. The test
 * beside this file checks all of them, and the type sheet prints the numbers.
 */
export const TEXT_PAIRS: readonly { readonly name: string; readonly ink: string; readonly ground: string }[] = [
  { name: 'text on night', ink: THEME.text, ground: THEME.night },
  { name: 'textSoft on night', ink: THEME.textSoft, ground: THEME.night },
  { name: 'textFaint on night', ink: THEME.textFaint, ground: THEME.night },
  { name: 'text on nightSoft', ink: THEME.text, ground: THEME.nightSoft },
  { name: 'textSoft on nightSoft', ink: THEME.textSoft, ground: THEME.nightSoft },
  { name: 'textFaint on nightSoft', ink: THEME.textFaint, ground: THEME.nightSoft },
  { name: 'ink on paper', ink: THEME.ink, ground: THEME.paper },
  { name: 'ink on paperHi', ink: THEME.ink, ground: THEME.paperHi },
  { name: 'ink on card', ink: THEME.ink, ground: THEME.card },
  { name: 'inkSoft on paper', ink: THEME.inkSoft, ground: THEME.paper },
  { name: 'inkSoft on paperHi', ink: THEME.inkSoft, ground: THEME.paperHi },
  { name: 'signalDeep on paper', ink: THEME.signalDeep, ground: THEME.paper },
  { name: 'signalDeep on paperHi', ink: THEME.signalDeep, ground: THEME.paperHi },
  { name: 'status.gated on paper', ink: THEME.status.gated, ground: THEME.paper },
  { name: 'status.gated on paperHi', ink: THEME.status.gated, ground: THEME.paperHi },
  { name: 'status.unverified on paper', ink: THEME.status.unverified, ground: THEME.paper },
  { name: 'paperHi on cover.bronze', ink: THEME.paperHi, ground: THEME.cover.bronze },
  { name: 'paperHi on cover.silver', ink: THEME.paperHi, ground: THEME.cover.silver },
  { name: 'paperHi on cover.gold', ink: THEME.paperHi, ground: THEME.cover.gold },
  { name: 'paperHi on cover.diamond', ink: THEME.paperHi, ground: THEME.cover.diamond },
];

/** Focus rings are graphics, so they need 3 to 1 against their ground. Both are checked in the test. */
export const FOCUS_PAIRS: readonly { readonly name: string; readonly ring: string; readonly ground: string }[] = [
  { name: 'lamp ring on night', ring: FOCUS.room, ground: THEME.night },
  { name: 'lamp ring on nightSoft', ring: FOCUS.room, ground: THEME.nightSoft },
  { name: 'ink ring on paper', ring: FOCUS.paper, ground: THEME.paper },
  { name: 'ink ring on paperHi', ring: FOCUS.paper, ground: THEME.paperHi },
  { name: 'ink ring on card', ring: FOCUS.paper, ground: THEME.card },
  { name: 'ink ring on the lamp halo', ring: FOCUS.paper, ground: THEME.lamp },
];
