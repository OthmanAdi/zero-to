/**
 * Where the learner's progress and notebook are kept. The browser's `localStorage` when it lets us, otherwise a
 * map in memory that lasts for this visit, and the state says which, so the page can tell the learner.
 */

/** The part of the Web Storage interface the learning core uses. `localStorage` fits it, and so does a test double. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * `browser`: written to the storage that was given (or `localStorage`).
 * `memory`: kept in this page only. `reason` says why: `none` when there was no storage at all, `refused` when
 * the browser threw on the first write (private mode, blocked site data), `full` when a later write failed.
 */
export interface StorageState {
  readonly kind: 'browser' | 'memory';
  readonly reason: 'none' | 'refused' | 'full' | null;
}

/** A storage that never throws. Every read and write goes through it. */
export interface SafeStore {
  readonly state: StorageState;
  read(key: string): string | null;
  /** False when the write went to memory only. */
  write(key: string, value: string): boolean;
  remove(key: string): void;
  /** Called once when the store falls back to memory after it had worked. */
  onFallback(listener: (state: StorageState) => void): () => void;
}

const PROBE_KEY = 'zero-to:probe';

/** A storage in memory, the same shape as `localStorage`. */
export function memoryStorage(): StorageLike & { readonly size: number; clear(): void } {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, String(value)),
    removeItem: (key) => void map.delete(key),
    clear: () => map.clear(),
    get size() {
      return map.size;
    },
  };
}

function browserStorage(): StorageLike | null {
  try {
    return (globalThis as { localStorage?: StorageLike }).localStorage ?? null;
  } catch {
    // Reading the property itself throws when site data is blocked.
    return null;
  }
}

export function isSafeStore(value: unknown): value is SafeStore {
  return (
    typeof value === 'object' &&
    value !== null &&
    'state' in value &&
    typeof (value as SafeStore).read === 'function' &&
    typeof (value as SafeStore).write === 'function'
  );
}

/**
 * Wraps a storage so it never throws. `undefined` means "use the browser's `localStorage`", `null` means "keep
 * everything in memory". A storage that throws on the first write is replaced by memory at once.
 */
export function safeStore(storage?: StorageLike | SafeStore | null): SafeStore {
  if (isSafeStore(storage)) return storage;
  const target = storage === undefined ? browserStorage() : storage;
  const memory = memoryStorage();
  const removed = new Set<string>();
  const listeners = new Set<(state: StorageState) => void>();
  let state: StorageState;
  // Kept for reads even after writes have failed: what was saved earlier can still be loaded.
  const backend: StorageLike | null = target;

  if (!backend) {
    state = { kind: 'memory', reason: 'none' };
  } else {
    try {
      backend.setItem(PROBE_KEY, '1');
      backend.removeItem(PROBE_KEY);
      state = { kind: 'browser', reason: null };
    } catch {
      state = { kind: 'memory', reason: 'refused' };
    }
  }
  const fallBack = (reason: 'refused' | 'full'): void => {
    state = { kind: 'memory', reason };
    for (const listener of listeners) listener(state);
  };

  return {
    get state() {
      return state;
    },
    read(key) {
      if (removed.has(key)) return null;
      const fromMemory = memory.getItem(key);
      if (fromMemory !== null || !backend) return fromMemory;
      try {
        return backend.getItem(key);
      } catch {
        return null;
      }
    },
    write(key, value) {
      removed.delete(key);
      memory.setItem(key, value);
      if (!backend || state.kind === 'memory') return false;
      try {
        backend.setItem(key, value);
        return true;
      } catch {
        fallBack('full');
        return false;
      }
    },
    remove(key) {
      memory.removeItem(key);
      removed.add(key);
      if (!backend || state.kind === 'memory') return;
      try {
        backend.removeItem(key);
      } catch {
        // The memory copy is gone, and reads now return nothing for this key.
      }
    },
    onFallback(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
