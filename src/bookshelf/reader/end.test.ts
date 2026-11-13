import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountReader } from './index';
import type { ReaderDoc, ReaderHandle, ReaderOptions } from './index';

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
const query = <T extends Element>(selector: string): T => {
  const found = find<T>(selector);
  if (!found) throw new Error(`missing ${selector}`);
  return found;
};

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  handle?.destroy();
  handle = null;
  host.remove();
});

describe('end of text', () => {
  it('is absent when the host offers neither a mark nor a next link', () => {
    mount();
    expect(find('.bb-reader__end')).toBeNull();
  });

  it('comes after the text and not inside it, so it never counts as a block', () => {
    mount({ onDone: () => undefined });
    const end = query('.bb-reader__end');
    expect(end.previousElementSibling).toBe(query('.bb-reader__body'));
    expect(query('.bb-reader__body').contains(end)).toBe(false);
    expect(end.getAttribute('aria-label')).toBe('End of text');
  });

  it('shows Mark as read as a toggle that starts from the given state', () => {
    mount({ onDone: () => undefined, done: true });
    const toggle = query<HTMLButtonElement>('.bb-reader__done');
    expect(toggle.textContent).toBe('Mark as read');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });

  it('reports each press and keeps its own label', () => {
    const onDone = vi.fn();
    mount({ onDone });
    const toggle = query<HTMLButtonElement>('.bb-reader__done');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    toggle.click();
    expect(onDone).toHaveBeenLastCalledWith(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    toggle.click();
    expect(onDone).toHaveBeenLastCalledWith(false);
    expect(toggle.textContent).toBe('Mark as read');
  });

  it('marks nothing by itself when the end is reached', () => {
    const onDone = vi.fn();
    const reader = mount({ onDone });
    Object.defineProperty(reader.scroller, 'scrollTop', { value: 5000, configurable: true });
    reader.scroller.dispatchEvent(new Event('scroll'));
    expect(onDone).not.toHaveBeenCalled();
    expect(query('.bb-reader__done').getAttribute('aria-pressed')).toBe('false');
  });

  it('names the next link with its time and calls onNext', () => {
    const onNext = vi.fn();
    mount({ next: { title: 'The second essay', minutes: '6 min' }, onNext });
    const next = query<HTMLButtonElement>('.bb-reader__next');
    expect(next.textContent).toBe('Next: The second essay, about 6 min');
    next.click();
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(find('.bb-reader__done')).toBeNull();
  });

  it('leaves the time out when it is not known', () => {
    mount({ next: { title: 'The second essay' } });
    expect(query('.bb-reader__next').textContent).toBe('Next: The second essay');
  });

  it('follows changes made by the host without calling back', () => {
    const onDone = vi.fn();
    const reader = mount({ onDone });
    reader.setDone(true);
    expect(query('.bb-reader__done').getAttribute('aria-pressed')).toBe('true');
    reader.setNext({ title: 'Another' });
    expect(query('.bb-reader__next').textContent).toBe('Next: Another');
    expect(query('.bb-reader__done').getAttribute('aria-pressed')).toBe('true');
    reader.setNext(null);
    expect(find('.bb-reader__next')).toBeNull();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('is not shown for a link with no text or while the text is being edited', () => {
    mount({ doc: { ...doc, text: undefined }, onDone: () => undefined, onSaveText: () => undefined });
    expect(find('.bb-reader__end')).toBeNull();
    handle?.destroy();
    mount({ onDone: () => undefined, onSaveText: () => undefined });
    expect(find('.bb-reader__end')).not.toBeNull();
    query<HTMLButtonElement>('.bb-reader__edit').click();
    expect(find('.bb-reader__end')).toBeNull();
  });
});
