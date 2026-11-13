export interface Draft {
  value: string;
  /** Whether the field had focus, and where the caret was. */
  caret: [number, number] | null;
}

/** What is typed in the paste field right now, or null when there is no field. */
export function takeDraft(dom: Document, field: HTMLTextAreaElement | null): Draft | null {
  if (!field) return null;
  const typing = dom.activeElement === field;
  return { value: field.value, caret: typing ? [field.selectionStart, field.selectionEnd] : null };
}

/** Puts a draft into a new field, with focus and caret when the old one had them. */
export function restoreDraft(draft: Draft, field: HTMLTextAreaElement): void {
  field.value = draft.value;
  if (!draft.caret) return;
  field.focus({ preventScroll: true });
  field.setSelectionRange(draft.caret[0], draft.caret[1]);
}

/** A draft is worth keeping when it differs from the saved text and is not empty, or the person was editing. */
export function worthKeeping(draft: Draft | null, saved: string | undefined, editing: boolean): draft is Draft {
  return draft !== null && draft.value !== (saved ?? '') && (editing || draft.value.trim() !== '');
}
