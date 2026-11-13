/**
 * Time source for the motion engine. The browser clock uses requestAnimationFrame;
 * the manual clock lets tests advance time deterministically.
 */
export interface Clock {
  now(): number;
  request(callback: (time: number) => void): number;
  cancel(handle: number): void;
}

export const browserClock: Clock = {
  now: () => performance.now(),
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

export interface ManualClock extends Clock {
  /** Moves time forward, running queued frames every `frameMs` (default 1000 / 60). */
  advance(ms: number, frameMs?: number): void;
  /** Number of frames waiting to run. Zero means every animation is at rest. */
  pending(): number;
}

export function createManualClock(start = 0): ManualClock {
  let time = start;
  let nextHandle = 1;
  const queue = new Map<number, (time: number) => void>();

  const runFrame = (): void => {
    const callbacks = [...queue.values()];
    queue.clear();
    for (const callback of callbacks) callback(time);
  };

  return {
    now: () => time,
    request(callback) {
      const handle = nextHandle++;
      queue.set(handle, callback);
      return handle;
    },
    cancel(handle) {
      queue.delete(handle);
    },
    advance(ms, frameMs = 1000 / 60) {
      let remaining = ms;
      while (remaining > 0) {
        const step = Math.min(frameMs, remaining);
        time += step;
        remaining -= step;
        runFrame();
      }
    },
    pending: () => queue.size,
  };
}
