/**
 * Studio contract. Studio is an optional second way to draw the shelf: a WebGL layer that paints the
 * same volumes, at the same places, with lit materials. The DOM shelf stays where it is, transparent,
 * and keeps every control, gesture, focus ring and announcement. Studio only paints.
 *
 * This file holds the names and shapes the parts of Studio agree on. It imports nothing at runtime, so
 * the app can read these types without loading three.js.
 */

/** What a volume is bound in. Each one answers light in its own way. */
export const BINDINGS = ['cloth', 'linen', 'leather', 'paper', 'gloss', 'velvet', 'foil', 'holo'] as const;
export type Binding = (typeof BINDINGS)[number];

/** How the title and rules are put on the cover and spine. */
export const STAMPS = ['gold', 'silver', 'copper', 'holo', 'blind', 'ink'] as const;
export type Stamp = (typeof STAMPS)[number];

/** Human names, for pickers and announcements. */
export const BINDING_LABELS: Record<Binding, string> = {
  cloth: 'Book cloth',
  linen: 'Linen',
  leather: 'Leather',
  paper: 'Paper over boards',
  gloss: 'Gloss laminate',
  velvet: 'Velvet',
  foil: 'Metal foil',
  holo: 'Holographic foil',
};

export const STAMP_LABELS: Record<Stamp, string> = {
  gold: 'Gold foil',
  silver: 'Silver foil',
  copper: 'Copper foil',
  holo: 'Holographic foil',
  blind: 'Blind deboss',
  ink: 'Printed ink',
};

export function isBinding(value: unknown): value is Binding {
  return typeof value === 'string' && (BINDINGS as readonly string[]).includes(value);
}

export function isStamp(value: unknown): value is Stamp {
  return typeof value === 'string' && (STAMPS as readonly string[]).includes(value);
}

/**
 * One painted face of a volume, ready to become textures. Both canvases have the same size.
 * `color` is the face as printed: cloth colour, art and ink. `mask` is white where the face is stamped
 * (foil or blind deboss) and black elsewhere; the material makes the white parts metal, smooth and
 * pressed in, so the title catches the light while the cloth around it does not.
 */
export interface PaintedFace {
  color: HTMLCanvasElement;
  mask: HTMLCanvasElement;
}

/** The three outer faces of a volume, painted for one item and one look. */
export interface PaintedVolume {
  front: PaintedFace;
  spine: PaintedFace;
  back: PaintedFace;
}

/** Which way Studio draws. `classic` is the CSS shelf alone. */
export const PAINTS = ['classic', 'studio'] as const;
export type Paint = (typeof PAINTS)[number];

export function isPaint(value: unknown): value is Paint {
  return typeof value === 'string' && (PAINTS as readonly string[]).includes(value);
}
