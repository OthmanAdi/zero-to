import type { ScreenBox } from '../paper/motion';
import type { StopId } from '../sections/model';

/** The stops whose stations the page draws in 3D: the four altitudes and what a roadmap carries. */
export const STAGED_STOPS: readonly StopId[] = ['what', 'trail'];

/**
 * The stations of the landing page as plain numbers. A staged stop is a box of the page one window tall, and its
 * paper station is drawn in 3D where the flat drawing stood. The one canvas stays where it is: every frame it is
 * cleared to the night, and each picture is drawn into the rows its box has on the screen. That is the hero
 * while it is in view, and every staged station whose box is. Nothing here touches three.js or the document.
 */
export const STAGING = {
  /**
   * The camera on a station: degrees above the sheet, degrees round it (negative stands a little to the left)
   * and the lens in degrees. It is fitted, not placed: it is moved along that direction until the sheet and what
   * stands on it fill the station's place.
   */
  shot: { elevation: 27, yaw: -10, fov: 32 },
  /** Room left round the station inside its place, as a share of the place on each side. */
  margin: 0.03,
  /**
   * The station's lamp, seen from the middle of the sheet: `azimuth` degrees round it and `elevation` degrees
   * up, `reach` half sheet widths away and never nearer than `least`. `strength` is its light on the sheet next
   * to the table's lamp, `cone` its half angle in degrees, `penumbra` how soft the edge of its pool is, and
   * `bounce` the share of it that an unshadowed light at the lamp gives back as the room's fill.
   */
  lamp: { azimuth: 122, elevation: 34, reach: 3.4, least: 7.6, strength: 0.82, cone: 30, penumbra: 0.7, focus: 0.7, bounce: 0.07, shadowMap: 1024 },
  /** Light that has no direction, so that a shadow on the sheet keeps its colour. */
  ambient: 0.21,
  /**
   * The cloth a station lies on: its radius in sheet widths, and the share of that radius from which it fades
   * into the night, so the pool of the lamp has no edge.
   */
  cloth: { radius: 1.15, fadeFrom: 0.4 },
  /**
   * A station is built when the top of its box is within this many window heights of the top of the window:
   * `busy` while the table's intro plays or the page moves, `calm` once the table stands still.
   */
  build: { busy: 1.15, calm: 2.2 },
  /** Where the stations stand in the scene: this far from the table and from each other, out of each other's sight. */
  away: 400,
  apart: 60,
  /**
   * The hero's picture ends this far below the top of the sections, where their ground has become the night:
   * a share of the window's height, and never more than `most` pixels. `app.css` draws the same band.
   */
  band: { share: 0.3, most: 280 },
} as const;

/** A box on the screen in pixels, as `getBoundingClientRect` gives it. */
export interface Rows {
  readonly top: number;
  readonly height: number;
}

/**
 * The rows of the window a box covers, from the top: `from` is its first row and `to` the row after its last.
 * Null when no part of it is in the window.
 */
export function boxRows(box: Rows, viewport: number): { readonly from: number; readonly to: number } | null {
  if (!(viewport > 0) || !(box.height > 0)) return null;
  const from = Math.max(0, Math.round(box.top));
  const to = Math.min(Math.round(viewport), Math.round(box.top + box.height));
  return to - from >= 1 ? { from, to } : null;
}

/** The row after the last one the hero's picture is drawn in, for the top of the sections on the screen. 0 for none. */
export function heroRows(sectionsTop: number, viewport: number): number {
  if (!(viewport > 0)) return 0;
  const band = Math.min(viewport * STAGING.band.share, STAGING.band.most);
  return Math.max(0, Math.min(Math.round(viewport), Math.round(sectionsTop + band)));
}

export interface Place {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The place of a station's picture as a box of the screen (-1 left and bottom, 1 right and top), for a stop
 * whose own box stands at the top of the window. `place` and `box` are both read from the screen at the same
 * moment, wherever the page is scrolled to: only where the place lies inside the box counts.
 */
export function placeBox(place: Place, box: Place, width: number, viewport: number, margin: number = STAGING.margin): ScreenBox {
  const w = Math.max(1, width);
  const h = Math.max(1, viewport);
  const insetX = place.width * margin;
  const insetY = place.height * margin;
  const left = place.left - box.left + insetX;
  const right = place.left - box.left + place.width - insetX;
  const top = place.top - box.top + insetY;
  const bottom = place.top - box.top + place.height - insetY;
  return { x0: (left / w) * 2 - 1, x1: (right / w) * 2 - 1, y0: 1 - (bottom / h) * 2, y1: 1 - (top / h) * 2 };
}

/** Where a station's lamp hangs, measured from the middle of its sheet, and how far away that is. */
export function lampPlace(sheetWidth: number): { readonly x: number; readonly y: number; readonly z: number; readonly distance: number } {
  const { azimuth, elevation, reach, least } = STAGING.lamp;
  const az = (azimuth * Math.PI) / 180;
  const el = (elevation * Math.PI) / 180;
  const distance = Math.max(least, (sheetWidth / 2) * reach);
  return { x: distance * Math.sin(az) * Math.cos(el), y: distance * Math.sin(el), z: -distance * Math.cos(az) * Math.cos(el), distance };
}

/** The lamp's candela at a distance, so that the sheet under it is as bright as under the table's lamp at `least`. */
export function lampCandela(tableCandela: number, distance: number): number {
  return tableCandela * STAGING.lamp.strength * (distance / STAGING.lamp.least) ** 2;
}

/** How much of the cloth shows at a share of its radius: all of it in the middle, none at the rim. */
export function clothShows(share: number): number {
  const from = STAGING.cloth.fadeFrom;
  if (!(share > from)) return 1;
  if (share >= 1) return 0;
  const t = (share - from) / (1 - from);
  return 1 - t * t * (3 - 2 * t);
}
