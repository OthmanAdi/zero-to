import { el } from './dom';
import { cleanLang, estimateMinutes, formatSavedDate, hostnameOf } from './meta';
import { parseMarkdownLite, safeHttpUrl } from './parse';
import { renderBlocks } from './render';
import type { ReaderDoc, ReaderLabels } from './types';

export interface ArticleHandlers {
  edit(): void;
  save(text: string): void;
  cancel(): void;
}

export interface ArticleParts {
  nodes: Node[];
  body: HTMLElement;
  editButton: HTMLButtonElement | null;
}

export interface ArticleInput {
  source: ReaderDoc;
  labels: ReaderLabels;
  titleId: string;
  canEdit: boolean;
  /** The paste field is open, so there is nothing left for an edit button to open. */
  editing: boolean;
  example: boolean;
  handlers: ArticleHandlers;
}

/** True when both documents would be drawn the same, so there is nothing to draw again. */
export function sameDocument(a: ReaderDoc, b: ReaderDoc): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof ReaderDoc>;
  return [...keys].every((key) => String(a[key] ?? '') === String(b[key] ?? ''));
}

/** One sentence-case line: when it was saved and how long it takes to read. */
function buildSavedLine(dom: Document, source: ReaderDoc, labels: ReaderLabels): HTMLElement | null {
  const saved = formatSavedDate(source.addedAt, cleanLang(source.lang) || dom.documentElement.lang);
  const minutes = source.text?.trim() ? labels.minutes(estimateMinutes(source.text)) : '';
  if (!saved && !minutes) return null;
  const line = el(dom, 'p', 'bb-reader__saved');
  if (saved) {
    const sentence = labels.saved(saved.text);
    const at = sentence.indexOf(saved.text);
    const time = el(dom, 'time', undefined, saved.text);
    time.setAttribute('datetime', saved.iso);
    if (at < 0) line.append(sentence, ' ', time);
    else line.append(sentence.slice(0, at), time, sentence.slice(at + saved.text.length));
  }
  if (saved && minutes) line.append(', ');
  if (minutes) line.append(minutes);
  return line;
}

function buildOpenOriginal(dom: Document, source: ReaderDoc, labels: ReaderLabels): HTMLElement {
  const link = el(dom, 'a', 'bb-reader__open bb-button', labels.openOriginal);
  const href = safeHttpUrl(source.url);
  if (href) {
    link.setAttribute('href', href);
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
    const host = hostnameOf(href);
    if (host) link.appendChild(el(dom, 'span', 'bb-reader__open-host', host));
    link.appendChild(el(dom, 'span', 'bb-visually-hidden', ` (${labels.newTab})`));
  } else {
    link.setAttribute('aria-disabled', 'true');
  }
  return link;
}

/** Everything inside the article: saved line, title, byline, note, actions and the body shell. */
export function buildArticleParts(dom: Document, input: ArticleInput): ArticleParts {
  const { source, labels } = input;
  const nodes: Node[] = [];
  const savedLine = buildSavedLine(dom, source, labels);
  if (savedLine) nodes.push(savedLine);
  const title = el(dom, 'h1', 'bb-reader__title', source.title);
  title.id = input.titleId;
  nodes.push(title);
  if (input.example) nodes.push(el(dom, 'p', 'bb-reader__example', labels.exampleNote));
  if (source.author) nodes.push(el(dom, 'p', 'bb-reader__byline', source.author));
  if (source.note) nodes.push(el(dom, 'p', 'bb-reader__note', source.note));

  const actions = el(dom, 'div', 'bb-reader__actions');
  actions.appendChild(buildOpenOriginal(dom, source, labels));
  let editButton: HTMLButtonElement | null = null;
  if (input.canEdit && !input.editing && source.text?.trim()) {
    editButton = el(dom, 'button', 'bb-reader__edit bb-button', labels.editCopy);
    editButton.type = 'button';
    editButton.addEventListener('click', () => input.handlers.edit());
    actions.appendChild(editButton);
  }
  const body = el(dom, 'div', 'bb-reader__body');
  nodes.push(actions, body);
  return { nodes, body, editButton };
}

export interface PastePanel {
  panel: HTMLElement;
  textarea: HTMLTextAreaElement;
}

export function buildPastePanel(
  dom: Document,
  labels: ReaderLabels,
  fieldId: string,
  initial: string,
  handlers: ArticleHandlers,
): PastePanel {
  const panel = el(dom, 'div', 'bb-reader__paste');
  const label = el(dom, 'label', 'bb-reader__paste-label', labels.pasteLabel);
  label.setAttribute('for', fieldId);
  const textarea = el(dom, 'textarea', 'bb-reader__paste-field');
  textarea.id = fieldId;
  textarea.rows = 12;
  textarea.value = initial;
  textarea.autocomplete = 'off';

  const save = el(dom, 'button', 'bb-reader__save bb-button bb-button--solid', labels.saveCopy);
  save.type = 'button';
  save.addEventListener('click', () => handlers.save(textarea.value));
  const cancel = el(dom, 'button', 'bb-reader__cancel bb-button', labels.cancel);
  cancel.type = 'button';
  cancel.addEventListener('click', () => {
    textarea.value = initial;
    handlers.cancel();
  });
  const actions = el(dom, 'div', 'bb-reader__paste-actions');
  actions.append(save, cancel);
  panel.append(label, textarea, actions);
  return { panel, textarea };
}

export interface BodyInput {
  dom: Document;
  body: HTMLElement;
  source: ReaderDoc;
  labels: ReaderLabels;
  fieldId: string;
  canEdit: boolean;
  editing: boolean;
  handlers: ArticleHandlers;
}

/** Fills the body with the reading copy, the empty state, or the paste panel. Returns the textarea if one is shown. */
export function fillBody(input: BodyInput): HTMLTextAreaElement | null {
  const { dom, body, source, labels } = input;
  const text = source.text ?? '';
  const hasText = text.trim().length > 0;
  body.replaceChildren();
  if (hasText && !input.editing) {
    body.appendChild(renderBlocks(parseMarkdownLite(text), dom, { newTab: labels.newTab, differs: labels.linkDiffers }));
    return null;
  }
  if (!hasText) {
    body.append(
      el(dom, 'h2', 'bb-reader__empty-title', labels.emptyTitle),
      el(dom, 'p', 'bb-reader__empty-body', labels.emptyBody),
    );
  }
  if (!input.canEdit) return null;
  const { panel, textarea } = buildPastePanel(dom, labels, input.fieldId, text, input.handlers);
  body.appendChild(panel);
  return textarea;
}
