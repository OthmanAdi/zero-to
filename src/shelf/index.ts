/**
 * The resource shelf: a roadmap stage's verified sources as volumes on a small night shelf, and a reader page
 * for each one. Built on the Bookmark Bookshelf modules in `src/bookshelf/`, which stay unchanged.
 */
export { createShelfDock, DOCK_VARIANT, PHONE_QUERY, SHEET_VARIANT } from './dock';
export {
  costSentence,
  costWord,
  dockHeader,
  dockHeaderParts,
  formatPrice,
  hostOf,
  lookFor,
  pinFor,
  placeOf,
  safeHref,
  statusLine,
  statusSentence,
  toShelfItems,
  TYPE_LOOK,
  typeName,
  type Look,
} from './items';
export { createMemorySession, type MemoryShelfSession } from './memory-session';
export { pageText, prose, readerDoc, readerLabels, taskFor, type StepTask } from './page';
export { say as shelfSay, SHELF_STRINGS, type ShelfKey } from './strings';
export type { DockItem, ShelfDock, ShelfDockOptions, ShelfEntry, ShelfPin, ShelfSession, UiLang, UsedLookup } from './types';
