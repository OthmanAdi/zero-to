import type { FrameTime } from './contract';

/** Small touch screens get lighter textures and geometry. */
export function phoneLike(screenWidth: number, screenHeight: number, coarsePointer: boolean): boolean {
  return Math.min(screenWidth, screenHeight) < 600 || (coarsePointer && Math.max(screenWidth, screenHeight) < 1100);
}

/** Device pixel ratio the renderer draws at: sharp on desktops, capped on phones where fill rate runs out first. */
export function pixelRatioFor(devicePixelRatio: number, phone: boolean): number {
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(ratio, phone ? 1.75 : 2);
}

export interface FrameClock {
  /** Advances to `seconds` (a monotonic time) and returns the frame time the parts receive. */
  tick(seconds: number, reduced: boolean): FrameTime;
  /** Forget the last tick, so the first frame after a pause does not jump. */
  resume(): void;
}

/** The longest step a frame may take, so a stalled tab does not throw springs across the scene. */
export const MAX_FRAME_STEP = 0.1;

export function createFrameClock(): FrameClock {
  let last: number | null = null;
  let elapsed = 0;
  return {
    tick(seconds, reduced) {
      const dt = last === null ? 0 : Math.min(MAX_FRAME_STEP, Math.max(0, seconds - last));
      last = seconds;
      elapsed += dt;
      return { dt, t: elapsed, reduced };
    },
    resume() {
      last = null;
    },
  };
}
