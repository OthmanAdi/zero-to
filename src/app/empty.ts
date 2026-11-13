import { readFileText, readLink } from '../hud';
import type { Roadmap } from '../roadmap/types';
import type { LibraryEntry } from './library';
import { issueLines } from './load';
import { say } from './strings';

/** What the visitor chose, and from where. */
export interface Chosen {
  readonly roadmap: Roadmap;
  readonly source: 'link' | 'file' | 'kept';
}

export interface Chooser {
  readonly element: HTMLElement;
  /** Settles once a roadmap has passed the check. */
  readonly chosen: Promise<Chosen>;
  destroy(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  node.append(...children);
  return node;
}

/**
 * A page that holds no roadmap and has no gallery to fall back on (the single-file viewer opened as it is, or
 * with a roadmap that could not be read) asks for one: a file chosen or dropped, a pasted share link, or a
 * roadmap this browser opened before. What comes from outside goes through the same check as everywhere else.
 * The page then goes on as if it had been given that roadmap.
 */
export function createChooser(host: HTMLElement, kept: readonly LibraryEntry[], problem: { readonly text: string; readonly lines: readonly string[] } | null = null): Chooser {
  let settle: (value: Chosen) => void = () => {};
  const chosen = new Promise<Chosen>((resolve) => {
    settle = resolve;
  });

  const title = el('h1', { class: 'zt-empty-title', id: 'zt-empty-title', tabindex: '-1' }, say('emptyTitle'));
  const lede = el('p', { class: 'zt-empty-lede' }, say('emptyLede'));
  const fileInput = el('input', { type: 'file', id: 'zt-empty-file', class: 'zt-empty-sr', accept: '.json,application/json' });
  const fileLabel = el('label', { class: 'zt-chip', for: 'zt-empty-file', 'data-kind': 'go' }, say('emptyFile'));
  const field = el('input', { type: 'text', id: 'zt-empty-link', class: 'zt-empty-field', spellcheck: 'false', autocomplete: 'off', inputmode: 'url' });
  const read = el('button', { type: 'submit', class: 'zt-chip', 'data-plain': '' }, say('emptyRead'));
  const form = el('form', { class: 'zt-empty-form', novalidate: '' }, el('label', { class: 'zt-empty-label', for: 'zt-empty-link' }, say('emptyLink')), el('div', { class: 'zt-empty-row' }, field, read));
  const error = el('div', { class: 'zt-empty-error', role: 'alert', tabindex: '-1', hidden: '' });
  const parts: HTMLElement[] = [title, lede, el('div', { class: 'zt-empty-row' }, fileInput, fileLabel), form, error];
  if (kept.length > 0) {
    const items = kept.map((entry) => {
      const button = el('button', { type: 'button', class: 'zt-empty-kept', lang: entry.roadmap.lang, dir: 'auto' }, entry.title);
      button.addEventListener('click', () => settle({ roadmap: entry.roadmap, source: 'kept' }));
      return el('li', {}, button);
    });
    parts.push(el('section', { class: 'zt-empty-list', 'aria-labelledby': 'zt-empty-kept' }, el('h2', { class: 'zt-empty-label', id: 'zt-empty-kept' }, say('emptyKept')), el('ul', {}, ...items)));
  }
  const element = el('main', { class: 'zt-empty', 'aria-labelledby': 'zt-empty-title' }, ...parts);
  host.append(element);

  const show = (text: string, lines: readonly string[]): void => {
    error.replaceChildren(el('p', {}, text), ...(lines.length > 0 ? [el('ul', { lang: 'en' }, ...lines.map((line) => el('li', {}, line)))] : []));
    error.hidden = false;
  };
  const fail = (text: string, lines: readonly string[]): void => {
    show(text, lines);
    error.focus();
  };
  // What went wrong before the page asked: a roadmap in it that could not be read, an example it does not hold.
  if (problem) show(problem.text, problem.lines);
  const take = (result: Awaited<ReturnType<typeof readLink>>): void => {
    if (result.ok) settle({ roadmap: result.roadmap, source: result.source });
    else fail(result.error, issueLines(result.issues));
  };
  const readFile = (file: File): void => {
    file.text().then(
      (text) => take(readFileText(text, file.name)),
      () => fail(say('fileUnreadable'), []),
    );
  };

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) readFile(file);
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void readLink(field.value).then(take);
  });
  const hasFile = (event: DragEvent): boolean => [...(event.dataTransfer?.types ?? [])].includes('Files');
  const over = (event: DragEvent): void => {
    if (hasFile(event)) event.preventDefault();
  };
  const dropped = (event: DragEvent): void => {
    if (!hasFile(event)) return;
    event.preventDefault();
    const files = event.dataTransfer?.files;
    if (!files || files.length !== 1) fail(say('dropMany'), []);
    else readFile(files[0] as File);
  };
  window.addEventListener('dragover', over);
  window.addEventListener('drop', dropped);

  return {
    element,
    chosen,
    destroy() {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', dropped);
      element.remove();
    },
  };
}
