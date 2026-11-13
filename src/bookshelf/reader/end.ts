import { el } from './dom';
import type { NextLink, ReaderLabels } from './types';

export interface EndInput {
  labels: ReaderLabels;
  done: boolean;
  /** Without a handler for the mark there is nothing to toggle, so the button is left out. */
  canMark: boolean;
  next: NextLink | null;
  onDone(done: boolean): void;
  onNext(): void;
}

export interface End {
  root: HTMLElement;
  setDone(done: boolean): void;
}

/**
 * The block after the last paragraph: a "Mark as read" toggle and, when there is one, the next link.
 * Arriving here marks nothing; only the button does.
 */
export function buildEnd(dom: Document, input: EndInput): End | null {
  const { labels } = input;
  if (!input.canMark && !input.next) return null;
  const root = el(dom, 'div', 'bb-reader__end');
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', labels.endOfText);
  let done = input.done;

  const toggle = el(dom, 'button', 'bb-reader__done bb-button', labels.markRead);
  toggle.type = 'button';
  const setDone = (value: boolean): void => {
    done = value;
    toggle.setAttribute('aria-pressed', String(value));
  };
  setDone(done);
  toggle.addEventListener('click', () => {
    setDone(!done);
    input.onDone(done);
  });
  if (input.canMark) root.appendChild(toggle);

  if (input.next) {
    const next = el(dom, 'button', 'bb-reader__next bb-button', labels.next(input.next.title, input.next.minutes));
    next.type = 'button';
    next.addEventListener('click', () => input.onNext());
    root.appendChild(next);
  }
  return { root, setDone };
}
