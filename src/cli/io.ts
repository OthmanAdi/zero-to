/**
 * Everything the command-line tool needs from the outside world, in one object, so tests can hand in their own
 * output sinks, clock and network. Files are read and written with `node:fs` directly; tests use temp folders.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** The subset of `fetch` the link checker uses. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface Io {
  /** One block of text for standard output. A newline is added. */
  readonly out: (text: string) => void;
  /** One block of text for standard error. A newline is added. */
  readonly err: (text: string) => void;
  /** Folder that relative paths on the command line start from. */
  readonly cwd: string;
  /** Folder of the running `zero-to.mjs`, for the default viewer template. */
  readonly scriptDir: string;
  readonly fetch: FetchLike;
  readonly now: () => Date;
}

export function nodeIo(scriptDir: string): Io {
  return {
    out: (text) => process.stdout.write(`${text}\n`),
    err: (text) => process.stderr.write(`${text}\n`),
    cwd: process.cwd(),
    scriptDir,
    fetch: (url, init) => fetch(url, init),
    now: () => new Date(),
  };
}

/** A problem the tool reports in plain words, with the exit code it should end with. */
export class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode: number) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

/** Exit codes: 0 done, 1 the roadmap (or a link) has a problem, 2 the command could not run. */
export const EXIT_OK = 0;
export const EXIT_PROBLEM = 1;
export const EXIT_USAGE = 2;

export function resolvePath(io: Io, path: string): string {
  return resolve(io.cwd, path);
}

/** Reads and parses a JSON file. A missing file is a usage problem (2), broken JSON a file problem (1). */
export function readJsonFile(path: string, what = 'file'): unknown {
  if (!existsSync(path)) throw new CliError(`Cannot find the ${what} ${path}.`, EXIT_USAGE);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (cause) {
    throw new CliError(`Cannot read the ${what} ${path}: ${cause instanceof Error ? cause.message : String(cause)}`, EXIT_USAGE);
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new CliError(`The ${what} ${path} is not valid JSON: ${detail}`, EXIT_PROBLEM);
  }
}

/** JSON as the roadmap files are written: two-space indent and a final newline. */
export function toJsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** The local calendar day of a date, as YYYY-MM-DD. */
export function localDay(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
