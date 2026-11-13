/**
 * The contract between the resource shelf and the rest of zero-to.
 *
 * The shelf shows the verified resources of one stage as volumes and opens one into a reader page. It writes
 * no progress itself: marking a volume as used, pinning it to the field notebook and the private note go to
 * the learning session (WP5) through `ShelfSession`, which a host implements or adapts.
 */
import type { UiLang } from '../i18n';
import type { ShelfEntry } from '../roadmap/derive';
import type { CheckStatus, ResourceCost, ResourceType, Roadmap } from '../roadmap/types';
import type { Clock } from '../bookshelf/motion';
import type { ShelfItem } from '../bookshelf/shelf';

export type { ShelfEntry, UiLang };

/** What the shelf needs to know about progress to draw a volume: whether the learner marked it as used. */
export interface UsedLookup {
  isUsed(resourceId: string): boolean;
}

/**
 * One pin into the field notebook, in the shape of a WP5 notebook entry without its `id` and `pinnedAt`
 * (the notebook gives those). `url` is only ever an http or https address.
 */
export interface ShelfPin {
  readonly kind: 'link';
  readonly resourceId: string;
  /** "Title: why", at most 500 characters. */
  readonly text: string;
  readonly url?: string;
  readonly stageId: string;
  readonly waypointId?: string;
}

/**
 * Everything the dock asks of the learning session. WP5's `Session` holds the roadmap and is the only writer
 * of progress, so the dock takes these as injected callbacks and never stores anything of its own.
 */
export interface ShelfSession extends UsedLookup {
  readonly roadmap: Roadmap;
  setUsed(resourceId: string, used: boolean): void;
  isPinned(resourceId: string): boolean;
  pin(pin: ShelfPin): void;
  unpin(resourceId: string): void;
  /** The learner's private note on a resource, at most 2,000 characters. Empty when there is none. */
  note(resourceId: string): string;
  setNote(resourceId: string, text: string): void;
  /** Called after any change the session makes, so the dock can redraw ticks and pins. Returns the unsubscribe. */
  subscribe?(listener: () => void): () => void;
}

/** A volume as zero-to draws it: a Bookshelf item plus what the caption and the reader page say about it. */
export interface DockItem extends ShelfItem {
  readonly resourceId: string;
  readonly type: ResourceType;
  readonly cost: ResourceCost;
  readonly status: CheckStatus;
  /** The day the link was opened, YYYY-MM-DD. */
  readonly checkedOn: string;
  /** Why it is on the list (the resource's `why`). Also the item's `note`. */
  readonly why: string;
  /** "Free · about 45 min · opened 2026-11-13", or the short gated or unverified line. */
  readonly statusLine: string;
  /** The full status sentence for the reader page. */
  readonly statusSentence: string;
  /** The waypoint the volume belongs to, or "project". */
  readonly for: string;
  readonly main: boolean;
}

export interface ShelfDockOptions {
  /** Interface language. Defaults to the page's (`uiLang()`). */
  ui?: UiLang;
  /** Reduced motion, read on every move. Defaults to the live media query. `?motion=reduced` hosts pass `true`. */
  reducedMotion?: boolean | (() => boolean);
  /** Where the reader and the travelling cover are mounted. Defaults to a layer appended to `document.body`. */
  readerHost?: HTMLElement;
  /** Elements made inert while a volume is open. */
  background?: readonly HTMLElement[];
  /** Media query under which the dock is a round button that opens a bottom sheet. */
  phoneQuery?: string;
  /** Mirror the shelf's look onto `<html data-variant>`, so a cover outside the shelf matches it. Default true. */
  themeRoot?: boolean;
  /** Called with the resource id when a volume opens, and with null when it closes. */
  onOpenChange?(resourceId: string | null): void;
  /** Called when the presented volume changes, with its resource id or null for an empty shelf. */
  onPresent?(resourceId: string | null): void;
  /** Time source of the motion engine. Tests pass Bookshelf's `createManualClock()`. */
  clock?: Clock;
}

export interface ShelfDock {
  readonly element: HTMLElement;
  /** Puts these volumes on the shelf, in this order, and presents `presentId` (default: the main one, else the first). */
  setEntries(entries: readonly ShelfEntry[], presentId?: string | null): void;
  /** How lit the shelf is, 0 to 1: 0 is six tenths of full light (before the predict question is answered), 1 is full. */
  setLit(amount: number): void;
  /** Opens a volume that is on the shelf into the reader. Resolves once it is open. */
  open(resourceId: string): Promise<void>;
  close(): Promise<void>;
  /** Keyboard focus on the presented volume, or on the round button while the phone sheet is shut. */
  focus(): void;
  /** The resource id of the presented volume. */
  readonly presented: string | null;
  readonly isOpen: boolean;
  destroy(): void;
}
