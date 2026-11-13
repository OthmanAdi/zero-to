import { memoryStorage, type StorageLike } from '../learn/storage';
import type { Roadmap } from '../roadmap/types';
import { validateRoadmap } from '../roadmap/validate';

/**
 * The roadmaps this browser has opened: from a share link, a file, or a page built by the skill. A link that
 * was opened here before goes onto the table without a preview, and a page that holds no roadmap offers them
 * to open again. Kept in `localStorage` under `zero-to:library`. Progress is not kept here: it has its own key
 * per roadmap, written by the session.
 */
export const LIBRARY_KEY = 'zero-to:library';
export const LIBRARY_VERSION = 1;
/** The most roadmaps kept, and the most characters one may take. */
export const LIBRARY_MAX = 8;
export const LIBRARY_MAX_CHARS = 600_000;

export interface LibraryEntry {
  readonly id: string;
  readonly title: string;
  /** When it was opened last, ISO. */
  readonly openedAt: string;
  readonly roadmap: Roadmap;
}

export interface Library {
  /** Newest first. */
  list(): LibraryEntry[];
  /** Puts a roadmap first. An older copy with the same id is replaced. Returns false when it could not be kept. */
  add(roadmap: Roadmap, now?: string): boolean;
  remove(id: string): void;
  has(id: string): boolean;
}

interface Stored {
  readonly version: number;
  readonly items: readonly { readonly id?: unknown; readonly openedAt?: unknown; readonly roadmap?: unknown }[];
}

/** Reads what is stored. Anything that is not a valid roadmap any more is left out, never shown broken. */
export function parseLibrary(text: string | null | undefined): LibraryEntry[] {
  if (!text) return [];
  let stored: Stored;
  try {
    stored = JSON.parse(text) as Stored;
  } catch {
    return [];
  }
  if (!stored || stored.version !== LIBRARY_VERSION || !Array.isArray(stored.items)) return [];
  const entries: LibraryEntry[] = [];
  const seen = new Set<string>();
  for (const item of stored.items) {
    const result = validateRoadmap(item?.roadmap);
    if (!result.ok || seen.has(result.roadmap.id)) continue;
    seen.add(result.roadmap.id);
    entries.push({
      id: result.roadmap.id,
      title: result.roadmap.title,
      openedAt: typeof item.openedAt === 'string' ? item.openedAt : '',
      roadmap: result.roadmap,
    });
    if (entries.length >= LIBRARY_MAX) break;
  }
  return entries;
}

export function serialiseLibrary(entries: readonly LibraryEntry[]): string {
  return JSON.stringify({ version: LIBRARY_VERSION, items: entries.map((entry) => ({ id: entry.id, openedAt: entry.openedAt, roadmap: entry.roadmap })) });
}

function browserStorage(): StorageLike | null {
  try {
    return (globalThis as { localStorage?: StorageLike }).localStorage ?? null;
  } catch {
    // Reading the property itself throws when site data is blocked.
    return null;
  }
}

/**
 * `storage`: `undefined` uses the browser's `localStorage`, `null` keeps the library for this visit only. A
 * browser that has no room keeps as many of the newest roadmaps as fit.
 */
export function createLibrary(storage?: StorageLike | null): Library {
  const backend: StorageLike = (storage === undefined ? browserStorage() : storage) ?? memoryStorage();
  const read = (): string | null => {
    try {
      return backend.getItem(LIBRARY_KEY);
    } catch {
      return null;
    }
  };
  const write = (text: string | null): boolean => {
    try {
      if (text === null) backend.removeItem(LIBRARY_KEY);
      else backend.setItem(LIBRARY_KEY, text);
      return true;
    } catch {
      return false;
    }
  };
  let entries = parseLibrary(read());

  /** Writes the list. When the browser has no room, the oldest roadmaps go first. Returns how many were written. */
  const save = (): number => {
    for (let keep = entries.length; keep > 0; keep -= 1) {
      if (write(serialiseLibrary(entries.slice(0, keep)))) {
        entries = entries.slice(0, keep);
        return keep;
      }
    }
    write(null);
    return 0;
  };

  return {
    list: () => [...entries],
    has: (id) => entries.some((entry) => entry.id === id),
    add(roadmap, now = new Date().toISOString()) {
      let size: number;
      try {
        size = JSON.stringify(roadmap).length;
      } catch {
        return false;
      }
      if (size > LIBRARY_MAX_CHARS) return false;
      const next = [{ id: roadmap.id, title: roadmap.title, openedAt: now, roadmap }, ...entries.filter((entry) => entry.id !== roadmap.id)].slice(0, LIBRARY_MAX);
      entries = next;
      if (save() > 0) return true;
      // Nothing could be written: the roadmap stays for this visit.
      entries = next;
      return false;
    },
    remove(id) {
      entries = entries.filter((entry) => entry.id !== id);
      if (entries.length === 0) write(null);
      else save();
    },
  };
}

/** One roadmap on the table. */
export interface TableEntry {
  readonly roadmap: Roadmap;
  /** True for a gallery example. */
  readonly example: boolean;
}

/** Whose roadmaps lie on the table. */
export type TableShows =
  /** A roadmap that was given: a page built for it, a share link, an address, a file. It lies there alone. */
  | { readonly kind: 'given'; readonly roadmap: Roadmap }
  /** The gallery of examples, with the one that was asked for (`?road=`, an example's own page) in slot 0. */
  | { readonly kind: 'gallery'; readonly first?: Roadmap | null };

/**
 * What lies on the table. A given roadmap lies there alone: no examples beside it, nothing to turn to, and no
 * other roadmap this browser opened before. Without one the table shows the gallery, up to `count` sheets.
 */
export function tableEntries(shows: TableShows, samples: readonly Roadmap[], count = 5): TableEntry[] {
  if (shows.kind === 'given') return [{ roadmap: shows.roadmap, example: false }];
  const out: TableEntry[] = [];
  const seen = new Set<string>();
  const put = (roadmap: Roadmap, example: boolean): void => {
    if (out.length >= count || seen.has(roadmap.id)) return;
    seen.add(roadmap.id);
    out.push({ roadmap, example });
  };
  // The example a page was opened for is named as its own, as it always was: the headline is its title.
  if (shows.first) put(shows.first, false);
  for (const sample of samples) put(sample, true);
  return out;
}
