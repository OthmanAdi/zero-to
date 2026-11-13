/**
 * Helpers for the command-line tests: a recording Io, a temp folder, a fake network and a teacher roadmap.
 * Tests never touch the real network.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { draft } from '../roadmap/testing';
import type { FetchLike, Io } from './io';

export interface RecordingIo extends Io {
  readonly stdout: string[];
  readonly stderr: string[];
  readonly calls: string[];
  text(): string;
}

export function recordingIo(cwd: string, options: { fetch?: FetchLike; now?: Date; scriptDir?: string } = {}): RecordingIo {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const calls: string[] = [];
  const offline: FetchLike = async (url) => {
    throw new Error(`The test tried to reach the network: ${url}`);
  };
  const inner = options.fetch ?? offline;
  return {
    stdout,
    stderr,
    calls,
    out: (text) => stdout.push(text),
    err: (text) => stderr.push(text),
    cwd,
    scriptDir: options.scriptDir ?? join(cwd, 'skill', 'scripts'),
    fetch: (url, init) => {
      calls.push(url);
      return inner(url, init);
    },
    now: () => options.now ?? new Date(2026, 10, 13, 9, 30),
    text: () => [...stdout, ...stderr].join('\n'),
  };
}

export function tempDir(): { path: string; file: (name: string, content: unknown) => string; cleanup: () => void } {
  const path = mkdtempSync(join(tmpdir(), 'zero-to-cli-'));
  return {
    path,
    file: (name, content) => {
      const target = join(path, name);
      writeFileSync(target, typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`, 'utf8');
      return target;
    },
    cleanup: () => rmSync(path, { recursive: true, force: true }),
  };
}

export interface FakeRoute {
  readonly status?: number;
  readonly body?: string;
  readonly headers?: Record<string, string>;
  /** Throw this instead of answering. */
  readonly error?: unknown;
  /** Never answer; reject only when the signal aborts. */
  readonly hang?: boolean;
}

/** A fetch that answers from a table of addresses. Unknown addresses answer 404. */
export function fakeFetch(routes: Readonly<Record<string, FakeRoute>>): FetchLike {
  return async (url, init) => {
    const route = routes[url] ?? { status: 404, body: '<title>Not here</title>' };
    if (route.hang) {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init.signal;
        signal?.addEventListener('abort', () => reject(signal.reason));
      });
    }
    if (route.error !== undefined) throw route.error;
    const status = route.status ?? 200;
    const nullBody = status === 204 || status === 304 || (status >= 300 && status < 400);
    return new Response(nullBody ? null : (route.body ?? ''), {
      status,
      headers: { 'content-type': 'text/html; charset=utf-8', ...route.headers },
    });
  };
}

export function dnsError(code = 'ENOTFOUND'): Error {
  return Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(`getaddrinfo ${code}`), { code }) });
}

export function htmlPage(title: string, body = '<p>Content.</p>'): string {
  return `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1>${body}</body></html>`;
}

/** The sample roadmap turned into a teacher's file: class sessions, teacher notes and assessed checks. */
export function teacherRoadmap(mode: 'none' | 'pass' | 'graded' | 'test' = 'pass'): any {
  const roadmap = draft();
  roadmap.brief.audience = 'teacher';
  roadmap.stages[0].waypoints[0].teacherNote = 'Most students forget to restart the terminal after installing.';
  roadmap.stages[1].waypoints[0].teacherNote = 'Answer key: the first variable no longer owns the string.';
  roadmap.stages[0].checkpoint.checks = [
    { q: 'Which command builds and runs a project?', kind: 'recall', options: ['cargo new', 'cargo run', 'rustc --run'], correct: 1, answer: 'cargo run compiles and then runs.' },
    { q: 'Explain what Cargo.toml is for.', kind: 'explain', answer: 'It names the package and lists its dependencies.' },
  ];
  roadmap.class = {
    size: 24,
    ages: '16-17',
    sessionsPerWeek: 1,
    sessionMinutes: 90,
    weeks: 6,
    devices: 'each',
    assessment: { mode },
    sessions: [
      { n: 1, date: '2026-11-19', title: 'Install and first program', inClass: ['toolchain'], homework: ['guessing-game'], exit: 'What does cargo run do?' },
      { n: 2, date: '2026-11-26', title: 'Ownership', inClass: ['moves', 'borrowing'], opener: 'Recall: what is a crate?' },
    ],
  };
  return roadmap;
}
