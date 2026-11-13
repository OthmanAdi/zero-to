/**
 * How much detail Studio can afford on this device, learnt from how long its frames take.
 *
 * The motion engine never moves more than 64 ms of time in one frame, so that a stalled frame cannot throw
 * a volume across the shelf. A device that needs 300 ms to draw Studio's frame therefore stretches a move
 * of 700 ms to several seconds. Rather than let the shelf crawl, Studio draws less: fewer device pixels
 * per CSS px, smaller shadow maps and coarser painted faces, one step at a time, until its frames fit the
 * budget. It never asks for more again within a visit, so it cannot see-saw.
 */

/** A frame that takes longer than this, in ms, is too slow for the shelf's motion. */
export const SLOW_FRAME_MS = 40;
/** Frames looked at before deciding; the first ones also compile programs and upload textures. */
export const WINDOW = 5;
/** Frames skipped at the start, while programs are compiled and textures uploaded. */
export const WARM_UP = 2;
/** Each step down keeps this share of the density, and none goes below the floor. */
export const STEP = 0.6;
export const FLOOR = 0.75;

export interface Budget {
  /** Most device pixels per CSS px the canvas and the painted faces may use. */
  readonly density: number;
  /** How many times Studio has stepped down. */
  readonly steps: number;
  /**
   * Records how long one frame took to draw, in ms. Returns true when the budget has just stepped down,
   * so the caller fits the canvas again.
   */
  record(ms: number): boolean;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function createBudget(start: number): Budget {
  let density = Math.max(FLOOR, start);
  let steps = 0;
  let seen = 0;
  let recent: number[] = [];
  return {
    get density() {
      return density;
    },
    get steps() {
      return steps;
    },
    record(ms) {
      seen++;
      if (seen <= WARM_UP || !Number.isFinite(ms) || ms < 0) return false;
      recent.push(ms);
      if (recent.length < WINDOW) return false;
      const typical = median(recent);
      recent = [];
      if (typical <= SLOW_FRAME_MS || density <= FLOOR) return false;
      density = Math.max(FLOOR, Math.round(density * STEP * 100) / 100);
      steps++;
      return true;
    },
  };
}

/** Renderers that draw on the processor instead of a graphics chip. They cannot afford a sharp canvas. */
const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i;

/** Whether a WebGL context draws in software, by the name it gives its renderer. */
export function isSoftwareRenderer(name: string): boolean {
  return SOFTWARE.test(name);
}

/** The density Studio starts at: the screen's own, but one device pixel per px where drawing is in software. */
export function startingDensity(screen: number, rendererName: string, most: number): number {
  return isSoftwareRenderer(rendererName) ? 1 : Math.min(most, Math.max(1, screen));
}
