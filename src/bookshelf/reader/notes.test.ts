import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountReader } from './index';
import type { ReaderDoc, ReaderHandle, ReaderOptions } from './index';
import { MAX_NOTE_LENGTH, NOTE_DEBOUNCE_MS } from './notes';

const doc: ReaderDoc = {
  id: 'a',
  title: 'A quiet essay',
  url: 'https://www.example.com/essay',
  text: 'First paragraph.\n\nSecond paragraph.',
};

let host: HTMLElement;
let handle: ReaderHandle | null = null;

function mount(options: Partial<ReaderOptions> = {}): ReaderHandle {
  handle = mountReader(host, { doc, ...options });
  return handle;
}

const find = <T extends Element>(selector: string): T | null => host.querySelector<T>(selector);
const field = (): HTMLTextAreaElement => {
  const found = find<HTMLTextAreaElement>('.bb-reader__notes-field');
  if (!found) throw new Error('missing notes field');
  return found;
};

function type(text: string): void {
  const input = field();
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  handle?.destroy();
  handle = null;
  host.remove();
  vi.useRealTimers();
});

describe('my notes', () => {
  it('is left out when the host neither gives a note nor listens for one', () => {
    mount();
    expect(find('.bb-reader__notes')).toBeNull();
  });

  it('is a collapsed area before the text, named for what it is', () => {
    mount({ onMyNote: () => undefined });
    const notes = find<HTMLDetailsElement>('.bb-reader__notes');
    expect(notes?.open).toBe(false);
    expect(notes?.querySelector('summary')?.textContent).toBe('My notes (they stay in this browser)');
    expect(notes?.nextElementSibling).toBe(find('.bb-reader__body'));
    expect(field().getAttribute('aria-label')).toBe('My notes (they stay in this browser)');
  });

  it('shows the note it was given', () => {
    mount({ myNote: 'Ask about chapter two.' });
    expect(field().value).toBe('Ask about chapter two.');
  });

  it('saves after a pause in typing, once', () => {
    const onMyNote = vi.fn();
    mount({ onMyNote });
    type('a');
    type('ab');
    vi.advanceTimersByTime(NOTE_DEBOUNCE_MS - 1);
    expect(onMyNote).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onMyNote).toHaveBeenCalledTimes(1);
    expect(onMyNote).toHaveBeenCalledWith('ab');
  });

  it('reports a pending note at once when the reader is closed from its button or with Escape', () => {
    const onMyNote = vi.fn();
    const onClose = vi.fn();
    const reader = mount({ onMyNote, onClose });
    type('first');
    find<HTMLButtonElement>('.bb-reader__close')?.click();
    expect(onMyNote).toHaveBeenCalledWith('first');
    expect(onClose).toHaveBeenCalled();
    type('second');
    reader.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(onMyNote).toHaveBeenLastCalledWith('second');
    vi.advanceTimersByTime(NOTE_DEBOUNCE_MS * 2);
    expect(onMyNote).toHaveBeenCalledTimes(2);
  });

  it('reports a pending note when the reader is destroyed', () => {
    const onMyNote = vi.fn();
    const reader = mount({ onMyNote });
    type('kept');
    reader.destroy();
    expect(onMyNote).toHaveBeenCalledWith('kept');
  });

  it('does not report a note that did not change', () => {
    const onMyNote = vi.fn();
    mount({ onMyNote, myNote: 'same' });
    type('same');
    vi.advanceTimersByTime(NOTE_DEBOUNCE_MS);
    expect(onMyNote).not.toHaveBeenCalled();
  });

  it('limits a note to 2,000 characters', () => {
    const onMyNote = vi.fn();
    mount({ onMyNote });
    expect(field().maxLength).toBe(MAX_NOTE_LENGTH);
    type('x'.repeat(MAX_NOTE_LENGTH + 50));
    vi.advanceTimersByTime(NOTE_DEBOUNCE_MS);
    expect(onMyNote.mock.calls[0]?.[0]).toHaveLength(MAX_NOTE_LENGTH);
    handle?.destroy();
    mount({ myNote: 'y'.repeat(3000) });
    expect(field().value).toHaveLength(MAX_NOTE_LENGTH);
  });

  it('counts characters only near the limit', () => {
    mount({ onMyNote: () => undefined });
    type('short');
    expect(find('.bb-reader__notes-count')?.textContent).toBe('');
    type('x'.repeat(1900));
    expect(find('.bb-reader__notes-count')?.textContent).toBe('1900 of 2000 characters');
  });

  it('keeps what is being typed when the document is replaced or the host sends another note', () => {
    const reader = mount({ onMyNote: () => undefined });
    find<HTMLDetailsElement>('.bb-reader__notes')!.open = true;
    field().focus();
    type('half a thought');
    reader.update({ ...doc, title: 'Renamed' });
    expect(field().value).toBe('half a thought');
    expect(find<HTMLDetailsElement>('.bb-reader__notes')?.open).toBe(true);
    expect(document.activeElement).toBe(field());
    reader.setMyNote('from another tab');
    expect(field().value).toBe('half a thought');
  });

  it('takes a note from the host while nobody is typing', () => {
    const reader = mount({ onMyNote: () => undefined, myNote: 'old' });
    reader.setMyNote('new');
    expect(field().value).toBe('new');
  });
});
