/**
 * The field notebook: what a learner pinned to take away. Key points, links, tasks, model answers and lines of
 * their own, in the order the learner keeps them. It lives in one browser and is never part of a share link.
 */
import { formatDay } from '../look/format';
import type { UiLang } from '../i18n';
import type { Roadmap } from '../roadmap/types';
import { safeStore, type SafeStore, type StorageLike, type StorageState } from './storage';
import { say } from './strings';

export type NotebookKind = 'point' | 'link' | 'task' | 'answer' | 'own';
export const NOTEBOOK_KINDS: readonly NotebookKind[] = ['point', 'link', 'task', 'answer', 'own'];

export interface NotebookEntry {
  readonly id: string;
  readonly kind: NotebookKind;
  readonly text: string;
  /** Only for links, and only http or https. */
  readonly url?: string;
  readonly stageId: string;
  readonly waypointId?: string;
  /** ISO timestamp. */
  readonly pinnedAt: string;
}

/** What a caller hands to `add`. Without an id, one is made; pins from the cards pass an id from `pinId`. */
export interface NotebookDraft {
  readonly id?: string;
  readonly kind: NotebookKind;
  readonly text: string;
  readonly url?: string;
  readonly stageId: string;
  readonly waypointId?: string;
}

export const NOTEBOOK_MAX_ENTRIES = 400;
export const NOTEBOOK_MAX_TEXT = 500;
const NOTEBOOK_VERSION = 1;

export const notebookKey = (roadmapId: string): string => `zero-to:notebook:${roadmapId}`;

/**
 * A stable id for something pinned from a card, so the same key point is never pinned twice and the card can show
 * whether it is pinned: `pinId('point', 'moves', 2)` is `point:moves:2`.
 */
export function pinId(kind: Exclude<NotebookKind, 'own'>, ...parts: readonly (string | number)[]): string {
  return [kind, ...parts].join(':');
}

export interface Notebook {
  readonly roadmapId: string;
  readonly entries: readonly NotebookEntry[];
  readonly size: number;
  readonly full: boolean;
  readonly storage: StorageState;
  has(id: string): boolean;
  get(id: string): NotebookEntry | undefined;
  /** Adds an entry, or returns the one with the same id. Null when the notebook is full or the text is empty. */
  add(draft: NotebookDraft): NotebookEntry | null;
  remove(id: string): boolean;
  /** Moves an entry to a new place in the list. */
  move(id: string, toIndex: number): boolean;
  clear(): void;
  subscribe(listener: (notebook: Notebook) => void): () => void;
}

export interface NotebookOptions {
  /** ISO timestamp for `pinnedAt`. Default: the real time. */
  readonly now?: () => string;
}

const KINDS = new Set<string>(NOTEBOOK_KINDS);

/** Cuts text to at most `max` characters without splitting a character in two. */
export function clip(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join('');
}

/** An address that may become a link: http or https only. Anything else gives null. */
export function safeUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

function readEntry(raw: unknown): NotebookEntry | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== 'string' || value.id === '' || typeof value.kind !== 'string' || !KINDS.has(value.kind)) return null;
  if (typeof value.text !== 'string' || typeof value.stageId !== 'string' || typeof value.pinnedAt !== 'string') return null;
  const entry: { -readonly [K in keyof NotebookEntry]: NotebookEntry[K] } = {
    id: value.id,
    kind: value.kind as NotebookKind,
    text: clip(value.text, NOTEBOOK_MAX_TEXT),
    stageId: value.stageId,
    pinnedAt: value.pinnedAt,
  };
  const url = safeUrl(value.url);
  if (url) entry.url = url;
  if (typeof value.waypointId === 'string' && value.waypointId !== '') entry.waypointId = value.waypointId;
  return entry;
}

function parseEntries(text: string | null, roadmapId: string): NotebookEntry[] {
  if (!text) return [];
  try {
    const raw = JSON.parse(text) as { roadmap?: unknown; entries?: unknown };
    if (raw.roadmap !== roadmapId || !Array.isArray(raw.entries)) return [];
    const seen = new Set<string>();
    const entries: NotebookEntry[] = [];
    for (const item of raw.entries) {
      const entry = readEntry(item);
      if (!entry || seen.has(entry.id)) continue;
      seen.add(entry.id);
      entries.push(entry);
      if (entries.length >= NOTEBOOK_MAX_ENTRIES) break;
    }
    return entries;
  } catch {
    return [];
  }
}

let ownCounter = 0;

/**
 * The notebook of one roadmap, stored under `zero-to:notebook:<roadmap id>`. Storage that is missing or throws is
 * replaced by memory, and `storage` says so.
 */
export function createNotebook(
  storage: StorageLike | SafeStore | null | undefined,
  roadmapId: string,
  options: NotebookOptions = {},
): Notebook {
  const store = safeStore(storage);
  const now = options.now ?? (() => new Date().toISOString());
  const key = notebookKey(roadmapId);
  let entries: NotebookEntry[] = parseEntries(store.read(key), roadmapId);
  const listeners = new Set<(notebook: Notebook) => void>();

  const save = (): void => {
    store.write(key, JSON.stringify({ version: NOTEBOOK_VERSION, roadmap: roadmapId, entries }));
  };
  const changed = (): void => {
    save();
    for (const listener of [...listeners]) listener(notebook);
  };

  const notebook: Notebook = {
    roadmapId,
    get entries() {
      return entries;
    },
    get size() {
      return entries.length;
    },
    get full() {
      return entries.length >= NOTEBOOK_MAX_ENTRIES;
    },
    get storage() {
      return store.state;
    },
    has: (id) => entries.some((e) => e.id === id),
    get: (id) => entries.find((e) => e.id === id),
    add(draft) {
      if (draft.id !== undefined) {
        const existing = entries.find((e) => e.id === draft.id);
        if (existing) return existing;
      }
      const text = clip(draft.text.trim(), NOTEBOOK_MAX_TEXT);
      if (text === '' || !KINDS.has(draft.kind) || entries.length >= NOTEBOOK_MAX_ENTRIES) return null;
      const at = now();
      ownCounter += 1;
      const entry: { -readonly [K in keyof NotebookEntry]: NotebookEntry[K] } = {
        id: draft.id ?? `${draft.kind}:${Date.parse(at).toString(36)}${ownCounter.toString(36)}`,
        kind: draft.kind,
        text,
        stageId: draft.stageId,
        pinnedAt: at,
      };
      const url = safeUrl(draft.url);
      if (url) entry.url = url;
      if (draft.waypointId) entry.waypointId = draft.waypointId;
      entries = [...entries, entry];
      changed();
      return entry;
    },
    remove(id) {
      const next = entries.filter((e) => e.id !== id);
      if (next.length === entries.length) return false;
      entries = next;
      changed();
      return true;
    },
    move(id, toIndex) {
      const from = entries.findIndex((e) => e.id === id);
      if (from < 0) return false;
      const to = Math.max(0, Math.min(entries.length - 1, Math.round(toIndex)));
      if (to === from) return false;
      const next = [...entries];
      const [entry] = next.splice(from, 1);
      next.splice(to, 0, entry as NotebookEntry);
      entries = next;
      changed();
      return true;
    },
    clear() {
      if (entries.length === 0) return;
      entries = [];
      changed();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return notebook;
}

// ---------------------------------------------------------------------------------------------------------------
// Markdown

/**
 * Escapes text so Markdown shows it exactly as written. Only ASCII punctuation gets a backslash, which CommonMark
 * turns back into the character itself, so a title with pipes, brackets or stars survives the trip. Line breaks
 * become spaces, because every entry is one line.
 */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/\s*[\r\n]+\s*/g, ' ')
    .replace(/[\\`*_[\]<>|#~&!]/g, (char) => `\\${char}`)
    .replace(/^(\d+)([.)])/, '$1\\$2')
    .replace(/^([-+=])/, '\\$1');
}

/** The CommonMark rule for backslash escapes, for tests and for reading an exported file back. */
export function unescapeMarkdown(text: string): string {
  return text.replace(/\\([!-/:-@[-`{-~])/g, '$1');
}

function linkTarget(url: string): string {
  return url.replace(/[<>\s]/g, (char) => encodeURIComponent(char));
}

interface Place {
  readonly key: string;
  readonly stage?: string;
  readonly sub?: string;
}

function placeOf(entry: NotebookEntry, roadmap: Roadmap, lang: UiLang | undefined): Place {
  const stageIndex = roadmap.stages.findIndex((s) => s.id === entry.stageId);
  const stage = roadmap.stages[stageIndex];
  if (!stage) return { key: `?:${entry.stageId}`, stage: say('otherPlace', undefined, lang) };
  const stageLine = say('mdStage', { n: stageIndex + 1, title: escapeMarkdown(stage.title) }, lang);
  const waypoint = entry.waypointId ? stage.waypoints.find((w) => w.id === entry.waypointId) : undefined;
  if (waypoint) return { key: `${stage.id}:${waypoint.id}`, stage: stageLine, sub: escapeMarkdown(waypoint.title) };
  const sub = stage.project ? say('mdCamp', { title: escapeMarkdown(stage.project.title) }, lang) : say('mdStageNotes', undefined, lang);
  return { key: `${stage.id}:`, stage: stageLine, sub };
}

function whyFor(entry: NotebookEntry, roadmap: Roadmap): string | null {
  if (entry.kind !== 'link' || !entry.url) return null;
  const resource = roadmap.resources.find((r) => safeUrl(r.url) === entry.url);
  return resource ? resource.why : null;
}

export interface MarkdownOptions {
  readonly lang?: UiLang;
  /** The export day, YYYY-MM-DD. Default: today. */
  readonly today?: string;
}

/**
 * The notebook as Markdown, in the learner's own order. A stage heading and a step heading are written whenever
 * the place changes from the entry before, so a reordered notebook keeps its context.
 */
export function notebookToMarkdown(entries: readonly NotebookEntry[], roadmap: Roadmap, options: MarkdownOptions = {}): string {
  const ui = options.lang;
  const day = options.today ?? new Date().toISOString().slice(0, 10);
  const lines: string[] = [];
  lines.push(`# ${say('mdTitle', { title: escapeMarkdown(roadmap.title) }, ui)}`, '');
  lines.push(say('mdExported', { day: formatDay(day, ui ? { lang: ui } : {}), count: entries.length }, ui), '');

  const places = entries.map((entry) => placeOf(entry, roadmap, ui));
  let lastStage: string | undefined;
  let lastKey: string | undefined;
  entries.forEach((entry, index) => {
    const place = places[index] as Place;
    if (place.key !== lastKey) {
      if (place.stage !== lastStage) lines.push(`## ${place.stage}`, '');
      if (place.sub) lines.push(`### ${place.sub}`, '');
      lastStage = place.stage;
      lastKey = place.key;
    }
    const label = `**${say(`kind.${entry.kind}`, undefined, ui)}:**`;
    if (entry.kind === 'link' && entry.url) {
      const why = whyFor(entry, roadmap);
      lines.push(`- ${label} [${escapeMarkdown(entry.text)}](<${linkTarget(entry.url)}>)${why ? ` ${escapeMarkdown(why)}` : ''}`);
    } else if (entry.kind === 'answer' && entry.text.includes('\n')) {
      const [question, ...rest] = entry.text.split('\n');
      lines.push(`- **${say('mdCheck', undefined, ui)}:** ${escapeMarkdown(question ?? '')}`);
      lines.push(`  ${label} ${escapeMarkdown(rest.join(' '))}`);
    } else {
      lines.push(`- ${label} ${escapeMarkdown(entry.text)}`);
    }
    if (places[index + 1]?.key !== place.key) lines.push('');
  });
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}
