/**
 * A `ShelfSession` that keeps everything in memory. For tests, the dev page and any host that has no learning
 * session yet; the real one is WP5's `Session`, which stores progress and the notebook.
 */
import type { Roadmap } from '../roadmap/types';
import type { ShelfPin, ShelfSession } from './types';

export interface MemoryShelfSession extends ShelfSession {
  /** Everything pinned so far, in order. */
  readonly pins: readonly ShelfPin[];
}

export function createMemorySession(roadmap: Roadmap): MemoryShelfSession {
  const used = new Set<string>();
  const pins = new Map<string, ShelfPin>();
  const notes = new Map<string, string>();
  const listeners = new Set<() => void>();
  const changed = (): void => {
    for (const listener of [...listeners]) listener();
  };
  return {
    roadmap,
    get pins() {
      return [...pins.values()];
    },
    isUsed: (id) => used.has(id),
    setUsed(id, value) {
      if (value) used.add(id);
      else used.delete(id);
      changed();
    },
    isPinned: (id) => pins.has(id),
    pin(pin) {
      pins.set(pin.resourceId, pin);
      changed();
    },
    unpin(id) {
      pins.delete(id);
      changed();
    },
    note: (id) => notes.get(id) ?? '',
    setNote(id, text) {
      const clipped = text.slice(0, 2000);
      if (clipped) notes.set(id, clipped);
      else notes.delete(id);
      changed();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
