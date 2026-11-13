import { el } from './dom';
import type { ReaderLabels } from './types';

export const MAX_NOTE_LENGTH = 2000;
export const NOTE_DEBOUNCE_MS = 400;
/** The counter only appears when the limit is near, so it never nags. */
const COUNT_FROM = 1800;

export interface Notes {
  root: HTMLElement;
  /** Replaces the text unless the person is typing in it right now. */
  set(text: string): void;
  /** Places the area before `before`. Call `keepFocus` first when the surroundings are about to be redrawn. */
  attach(before: Element): void;
  /** Remembers whether the field has focus and where the caret is; the returned function puts both back. */
  keepFocus(): () => void;
  /** Reports a pending change at once. */
  flush(): void;
  destroy(): void;
}

export interface NotesInput {
  labels: ReaderLabels;
  fieldId: string;
  initial: string;
  onChange(text: string): void;
}

/** A collapsible area for the person's own notes on this link. It saves as they type, after a short pause. */
export function buildNotes(dom: Document, input: NotesInput): Notes {
  const { labels } = input;
  const root = el(dom, 'details', 'bb-reader__notes');
  const summary = el(dom, 'summary', 'bb-reader__notes-summary', labels.notes);
  const field = el(dom, 'textarea', 'bb-reader__notes-field');
  field.id = input.fieldId;
  field.maxLength = MAX_NOTE_LENGTH;
  field.rows = 4;
  field.autocomplete = 'off';
  field.setAttribute('aria-label', labels.notes);
  const count = el(dom, 'p', 'bb-reader__notes-count');
  count.setAttribute('aria-live', 'polite');
  root.append(summary, field, count);

  const clamp = (text: string): string => text.slice(0, MAX_NOTE_LENGTH);
  let saved = clamp(input.initial);
  let timer: ReturnType<typeof setTimeout> | null = null;
  field.value = saved;

  const showCount = (): void => {
    count.textContent = field.value.length >= COUNT_FROM ? labels.notesCount(field.value.length, MAX_NOTE_LENGTH) : '';
  };
  const flush = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const value = clamp(field.value);
    if (value === saved) return;
    saved = value;
    input.onChange(value);
  };

  field.addEventListener('input', () => {
    showCount();
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, NOTE_DEBOUNCE_MS);
  });
  showCount();

  return {
    root,
    set(text) {
      if (dom.activeElement === field || timer !== null) return;
      saved = clamp(text);
      field.value = saved;
      showCount();
    },
    attach(before) {
      before.before(root);
    },
    keepFocus() {
      if (dom.activeElement !== field) return () => undefined;
      const { selectionStart, selectionEnd } = field;
      return () => {
        field.focus({ preventScroll: true });
        field.setSelectionRange(selectionStart ?? 0, selectionEnd ?? 0);
      };
    },
    flush,
    destroy() {
      flush();
    },
  };
}
