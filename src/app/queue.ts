/**
 * The build queue. Printing a map's panels and cutting its cards takes far longer than one frame, so that work
 * is done in slices: every frame the queue spends at most its budget (10 ms) and carries on in the next one.
 * Jobs run in the order they were added, one at a time, so the frame that is on screen always stays smooth.
 */
export const BUILD_BUDGET_MS = 10;

/** One slice of a job. It does a little work and returns true when the job is finished. */
export type BuildStep = () => boolean;

export interface BuildQueue {
  /** Adds a job. A job with the name of a waiting job replaces it. */
  add(name: string, step: BuildStep): void;
  /** Takes a waiting job out. Returns true when there was one. */
  cancel(name: string): boolean;
  /** Spends up to the budget on the first job. Returns the milliseconds spent. */
  run(budget?: number): number;
  /** Runs every job to its end, for stills and tests. */
  flush(): void;
  /** Names of the jobs that wait, in order. */
  readonly waiting: readonly string[];
  readonly idle: boolean;
}

export interface BuildQueueOptions {
  readonly budget?: number;
  /** The clock, in milliseconds. Default: `performance.now()`. */
  readonly now?: () => number;
  /** Called when a job throws. The job is dropped and the queue carries on. */
  readonly onError?: (name: string, error: unknown) => void;
}

/** The most slices one `flush` gives a job, so a job that never finishes cannot hang the page. */
const FLUSH_LIMIT = 100_000;

export function createBuildQueue(options: BuildQueueOptions = {}): BuildQueue {
  const defaultBudget = options.budget ?? BUILD_BUDGET_MS;
  const now = options.now ?? (() => performance.now());
  const jobs: { name: string; step: BuildStep }[] = [];

  /** Runs one slice of the first job. Returns false when nothing is left. */
  const slice = (): boolean => {
    const job = jobs[0];
    if (!job) return false;
    let finished = true;
    try {
      finished = job.step();
    } catch (error) {
      options.onError?.(job.name, error);
    }
    if (finished && jobs[0] === job) jobs.shift();
    return true;
  };

  return {
    add(name, step) {
      const at = jobs.findIndex((job) => job.name === name);
      if (at >= 0) jobs[at] = { name, step };
      else jobs.push({ name, step });
    },
    cancel(name) {
      const at = jobs.findIndex((job) => job.name === name);
      if (at < 0) return false;
      jobs.splice(at, 1);
      return true;
    },
    run(budget = defaultBudget) {
      const start = now();
      let spent = 0;
      // The first slice always runs, so a budget of nothing still makes progress.
      while (slice()) {
        spent = now() - start;
        if (spent >= budget) break;
      }
      return spent;
    },
    flush() {
      let guard = 0;
      while (slice() && guard < FLUSH_LIMIT) guard += 1;
    },
    get waiting() {
      return jobs.map((job) => job.name);
    },
    get idle() {
      return jobs.length === 0;
    },
  };
}
