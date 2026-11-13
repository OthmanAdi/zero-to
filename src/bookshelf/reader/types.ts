/**
 * Reader contract. Renders a saved reading copy as text nodes only, tracks the
 * reading position and reports it. It never fetches a URL and never parses HTML.
 */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'em'; c: Inline[] }
  | { t: 'strong'; c: Inline[] }
  | { t: 'code'; v: string }
  /** A line break the writer put inside a paragraph. */
  | { t: 'br' }
  | { t: 'link'; href: string; c: Inline[] };

export type Block =
  | { type: 'heading'; level: 2 | 3; inlines: Inline[] }
  | { type: 'paragraph'; inlines: Inline[] }
  | { type: 'quote'; inlines: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'code'; text: string }
  | { type: 'rule' };

export interface ReaderDoc {
  id: string;
  title: string;
  /** Absolute http(s) URL of the original. Only ever used as a link target. */
  url: string;
  author?: string;
  /** ISO date the item was saved. */
  addedAt?: string;
  note?: string;
  tags?: string[];
  /** Reading copy in markdown-lite. Missing or empty shows the paste panel. */
  text?: string;
  /** BCP 47 language of the text, for example `de`. It sets hyphenation and the format of the saved date. */
  lang?: string;
}

/** Same shape as the store's progress without the timestamp, so the two modules stay independent. */
export interface ReaderProgress {
  block: number;
  ratio: number;
  percent: number;
}

/** The link that follows this one on the open shelf. `minutes` is ready to print, for example "6 min". */
export interface NextLink {
  title: string;
  minutes?: string;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ReaderLabels {
  /** The bar button that returns to the shelf. */
  close: string;
  openOriginal: string;
  editCopy: string;
  saveCopy: string;
  cancel: string;
  pasteLabel: string;
  emptyTitle: string;
  /** Shown under the title of an example link. */
  exampleNote: string;
  emptyBody: string;
  progress: (percent: number) => string;
  /** Names of the two bar buttons that step the text size, and of the group they sit in. */
  smaller: string;
  larger: string;
  textSize: string;
  /** Hidden words that finish the name of a link that opens another tab, for example "opens in a new tab". */
  newTab: string;
  /** Printed after a link whose text looks like an address that is not where the link goes. */
  linkDiffers: (host: string) => string;
  /** The summary of the private notes area, and the counter shown near its limit. */
  notes: string;
  notesCount: (used: number, max: number) => string;
  /** Names the block after the last paragraph, and the toggle in it. */
  endOfText: string;
  markRead: string;
  /** The button to the following link, for example "Next: Title, about 6 min". `minutes` may be missing. */
  next: (title: string, minutes?: string) => string;
  /** Reading time, for example "6 min". */
  minutes: (minutes: number) => string;
  /** The saved date as a sentence start, for example "Saved 14 Sep 2026". It receives the formatted date. */
  saved: (date: string) => string;
}

export interface ReaderOptions {
  doc: ReaderDoc;
  /** Position to restore after mounting. */
  progress?: ReaderProgress;
  /** Any element to show as the volume's cover. The reader only places and sizes it. */
  cover?: HTMLElement | null;
  /** Cover width divided by height. Defaults to 0.62. */
  coverAspect?: number;
  onProgress?: (progress: ReaderProgress) => void;
  onClose?: () => void;
  /** The link is one of the examples that came with the app. Its title is followed by a line saying so. */
  example?: boolean;
  /** The person's private note on this link, at most 2,000 characters. */
  myNote?: string;
  /** Called with the note after the person pauses typing, and at once when the reader closes. */
  onMyNote?: (text: string) => void;
  /** Whether the link is marked as read. Shown as the state of the "Mark as read" button. */
  done?: boolean;
  /** Called when the person presses "Mark as read". Without it the button is not shown. */
  onDone?: (done: boolean) => void;
  /** The link that follows this one. Without it the end of the text offers no next link. */
  next?: NextLink;
  /** Called when the person chooses the next link. The reader does not close or change itself. */
  onNext?: () => void;
  /** Body size as a step from 0 to 4 (17, 19, 21, 24 and 28 px). Without it the size follows the screen. */
  textScale?: number;
  /** Called with the new step when the person changes the text size. */
  onTextScale?: (scale: number) => void;
  /** Called with the new reading copy when the person saves the paste panel. */
  onSaveText?: (text: string) => void;
  labels?: Partial<ReaderLabels>;
}

export interface ReaderHandle {
  /** Root element, `role="dialog"`. */
  readonly element: HTMLElement;
  /** Scroll container that holds the document. */
  readonly scroller: HTMLElement;
  /** Where the cover sits in the open layout, in viewport coordinates. Null without a cover. */
  coverSlotRect(): Box | null;
  /**
   * Drives the open transition with linear time: 0 is closed (nothing visible), 1 is fully open.
   * The sheet fades in between 0.17 and 0.60 and the text enters after 0.54; closing plays the same
   * window backwards. `from` is accepted for older callers and ignored.
   */
  setReveal(progress: number, from?: Box | null): void;
  /**
   * Where the cover lands, in viewport coordinates and always on screen: the cover's own place when it is
   * in view, otherwise a thumbnail in the bar. Measured when called, so call it after the position is
   * restored. Null without a cover or before the reader has a layout.
   */
  flightTarget(): Box | null;
  /** Replaces the note, unless the person is typing in it. Does not call `onMyNote`. */
  setMyNote(text: string): void;
  /** Changes the state of the "Mark as read" button without calling `onDone`. */
  setDone(done: boolean): void;
  /** Replaces the next link, or removes it with null. */
  setNext(next: NextLink | null): void;
  /** Shows or hides the reader's own cover, for a hand-off with a flying book. */
  setCoverVisible(visible: boolean): void;
  /**
   * Handles Escape (closes) and Tab (stays inside) for the host, which can route keys here while the
   * reader is still opening. Returns true when it acted on the key and prevented its default.
   */
  handleKey(event: KeyboardEvent): boolean;
  /** Moves focus to the close button. */
  focus(): void;
  /** Replaces the document, keeping the reader mounted. */
  update(doc: ReaderDoc): void;
  progress(): ReaderProgress;
  destroy(): void;
}
