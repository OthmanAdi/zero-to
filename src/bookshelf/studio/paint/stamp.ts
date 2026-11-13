import type { Stamp } from '../types';
import { BLACK, contrast, css, luminance, mix, parseColour, type Rgba } from './colour';

/**
 * What a stamp does to the parts of a face. Foil and blind stamps press the lettering, the rules, the
 * frames and the device into the board; the drawing, a pasted paper label and the cloth itself are never
 * stamped. A printed (ink) volume has nothing stamped at all.
 */

/** The parts of a face, as far as stamping is concerned. */
export type Part =
  /** The cloth or card of the board. */
  | 'ground'
  /** The title and every other line of type set on the cloth: author, imprint, number, the read check. */
  | 'lettering'
  /** Bands across a spine and the rule over a plate. */
  | 'rule'
  /** Rules round the board. */
  | 'frame'
  /** The publisher's device on a spine. */
  | 'device'
  /** The band of a band cover, where a look blocks it in foil (Oak Library). */
  | 'block'
  /** The procedural drawing or the outline plate, and a band printed as part of it. */
  | 'art'
  /** A paper label pasted on, and the type printed on it. */
  | 'label';

const PRESSED: ReadonlySet<Part> = new Set(['lettering', 'rule', 'frame', 'device', 'block']);

/** Whether `part` is white on the mask for `stamp`. */
export function isStamped(part: Part, stamp: Stamp): boolean {
  return stamp !== 'ink' && PRESSED.has(part);
}

export function isFoil(stamp: Stamp): boolean {
  return stamp === 'gold' || stamp === 'silver' || stamp === 'copper' || stamp === 'holo';
}

/**
 * The body colour of each foil under flat light. Gold is the gold Oak Library letters in; holo is a
 * pale pearl, since its colours come from the material, not from the print.
 */
export const FOIL_BODY: Record<'gold' | 'silver' | 'copper' | 'holo', string> = {
  gold: '#dcb969',
  silver: '#c9ccd0',
  copper: '#c8845b',
  holo: '#d3d2de',
};

/** Least contrast a foil keeps against its cloth under flat light, so a title still reads before it shines. */
export const FOIL_CONTRAST = 3;
/** How much darker than its cloth a blind stamp prints. */
export const BLIND_DEPTH = 0.2;
/** Below this luminance a cloth cannot go darker; there a blind stamp shows a trace of the lettering colour. */
const DARKEST = 0.02;
/** A cloth darker than this keeps the foil's own body, which is always lighter than it. */
const DARK_CLOTH = 0.18;

/** The cloth pressed without foil: a shade darker, or on near-black cloth a trace lighter. */
export function blindInk(cloth: Rgba, ink: Rgba): Rgba {
  if (luminance(cloth) < DARKEST) return mix(cloth, ink, 0.88);
  return mix(cloth, BLACK, 1 - BLIND_DEPTH);
}

/**
 * The foil's body, darkened in small steps until it keeps `FOIL_CONTRAST` against the cloth. A pale cloth
 * gets an antique, deeper foil, the way Oak Library blocks bone and ochre volumes in a dark one.
 */
export function foilInk(stamp: 'gold' | 'silver' | 'copper' | 'holo', cloth: Rgba): Rgba {
  const body = parseColour(FOIL_BODY[stamp])!;
  // On a dark cloth the foil reads by being lighter; darkening it would only lose what contrast it has.
  if (contrast(body, cloth) >= FOIL_CONTRAST || luminance(cloth) < DARK_CLOTH) return body;
  for (let step = 1; step <= 16; step++) {
    // Rounded as the canvas will print it, so the contrast holds for the colour actually painted.
    const deeper = parseColour(css(mix(body, BLACK, 1 - step * 0.05)))!;
    if (contrast(deeper, cloth) >= FOIL_CONTRAST) return deeper;
  }
  return mix(body, BLACK, 0.2);
}

/**
 * Colour of foil for a stamp, as the color canvas shows it under flat light (the material adds the
 * shine). `cloth` is the board's colour and `ink` the colour the look letters it in; both are CSS colours.
 * A printed stamp is the ink itself, a blind one the cloth a shade darker.
 */
export function stampInk(stamp: Stamp, cloth: string, ink: string): string {
  const board = parseColour(cloth) ?? BLACK;
  const lettering = parseColour(ink) ?? { r: 255, g: 255, b: 255, a: 1 };
  if (stamp === 'ink') return css(lettering);
  if (stamp === 'blind') return css(blindInk(board, lettering));
  return css(foilInk(stamp, board));
}
