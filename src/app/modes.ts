/**
 * The mode machine of the page: which view is on screen and which view may follow it.
 *
 *   boot -> table -> dive -> cut -> landing -> walk <-> finish -> return -> table
 *
 * The walk is never shown by a plain switch. It is reached through the red cut of the dive, or, with reduced
 * motion, through the short fade that stands in for the dive. The list view remembers where it was opened
 * from and goes back only there.
 */
export type Mode = 'boot' | 'table' | 'dive' | 'cut' | 'landing' | 'fade' | 'walk' | 'finish' | 'return' | 'list';

export const MODES: readonly Mode[] = ['boot', 'table', 'dive', 'cut', 'landing', 'fade', 'walk', 'finish', 'return', 'list'];

/** What the overlay shows in a mode: the table's interface, the walk's, or the list view's. */
export type View = 'table' | 'walk' | 'list';

export function viewOf(mode: Mode, back: Mode = 'table'): View {
  if (mode === 'list') return 'list';
  if (mode === 'walk' || mode === 'finish' || mode === 'landing' || mode === 'cut') return 'walk';
  if (mode === 'fade') return back === 'table' ? 'table' : 'walk';
  return 'table';
}

/** True while the visitor must not scroll or pick: the page is moving by itself. */
export function isLocked(mode: Mode): boolean {
  return mode === 'boot' || mode === 'dive' || mode === 'cut' || mode === 'landing' || mode === 'fade' || mode === 'return';
}

export interface ModeMachine {
  readonly mode: Mode;
  /** The mode the current one was entered from. The list view and the fade go back by it. */
  readonly from: Mode;
  /** Every mode the page has been in, oldest first. */
  readonly history: readonly Mode[];
  can(next: Mode): boolean;
  /** Changes the mode. Returns false, and changes nothing, when that step is not allowed. */
  go(next: Mode): boolean;
  onChange(listener: (mode: Mode, previous: Mode) => void): () => void;
}

const inWalk = (mode: Mode): boolean => mode === 'walk' || mode === 'finish';

/** The steps a mode allows, given where it was entered from. */
export function nextModes(mode: Mode, from: Mode): readonly Mode[] {
  switch (mode) {
    case 'boot':
      return ['table', 'list'];
    case 'table':
      return ['dive', 'fade', 'list'];
    case 'dive':
      return ['cut'];
    case 'cut':
      return ['landing'];
    case 'landing':
      return ['walk'];
    case 'fade':
      // The fade leads across: from the table into the walk, from the walk back to the table.
      return from === 'table' ? ['walk'] : ['table'];
    case 'walk':
      return ['finish', 'return', 'fade', 'list'];
    case 'finish':
      return ['walk', 'return', 'fade', 'list'];
    case 'return':
      return ['table'];
    case 'list':
      // Back to where it was opened. A page that booted into the list view has only the table behind it.
      return [inWalk(from) ? from : 'table'];
  }
}

export function createModeMachine(start: Mode = 'boot'): ModeMachine {
  let mode: Mode = start;
  let from: Mode = start;
  const history: Mode[] = [start];
  const listeners = new Set<(mode: Mode, previous: Mode) => void>();
  return {
    get mode() {
      return mode;
    },
    get from() {
      return from;
    },
    get history() {
      return history;
    },
    can(next) {
      return nextModes(mode, from).includes(next);
    },
    go(next) {
      if (!nextModes(mode, from).includes(next)) return false;
      const previous = mode;
      // Walk and finish are one place: stepping between them keeps where that place was entered from.
      if (!(inWalk(previous) && inWalk(next))) from = previous;
      mode = next;
      history.push(next);
      for (const listener of [...listeners]) listener(next, previous);
      return true;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
