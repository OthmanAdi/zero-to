import { el } from './dom';
import type { ReaderLabels } from './types';

export const DEFAULT_COVER_ASPECT = 0.62;

export interface ShellRefs {
  root: HTMLElement;
  windowEl: HTMLElement;
  sheet: HTMLElement;
  bar: HTMLElement;
  closeButton: HTMLButtonElement;
  /** Holds the thumbnail and the title; it appears once the title has scrolled under the bar. */
  barTitle: HTMLElement;
  barText: HTMLElement;
  /** Small copy of the cover in the bar, where the cover lands when the one beside the text has scrolled away. */
  thumb: HTMLElement;
  sizeDown: HTMLButtonElement;
  sizeUp: HTMLButtonElement;
  readout: HTMLElement;
  lineFill: HTMLElement;
  layout: HTMLElement;
  article: HTMLElement;
  coverSlot: HTMLElement;
}

export interface ShellInput {
  titleId: string;
  labels: ReaderLabels;
  cover: HTMLElement | null;
  coverAspect: number | undefined;
}

function buildThumb(dom: Document, cover: HTMLElement | null, ratio: string): HTMLElement {
  const thumb = el(dom, 'div', 'bb-reader__thumb');
  thumb.setAttribute('aria-hidden', 'true');
  thumb.style.setProperty('--bb-reader-cover-aspect-given', ratio);
  const face = el(dom, 'div', 'bb-reader__thumb-face');
  if (cover) {
    // A scaled copy, so the thumbnail is the same cover at a smaller size and the copy takes no part in navigation.
    const copy = cover.cloneNode(true) as HTMLElement;
    copy.removeAttribute('id');
    copy.removeAttribute('tabindex');
    copy.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
    copy.setAttribute('inert', '');
    face.appendChild(copy);
  }
  thumb.appendChild(face);
  return thumb;
}

function buildSizeButton(dom: Document, className: string, label: string): HTMLButtonElement {
  const button = el(dom, 'button', `bb-reader__size ${className} bb-button`);
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.title = label;
  button.appendChild(el(dom, 'span', 'bb-reader__size-glyph', 'A'));
  return button;
}

function buildBar(dom: Document, labels: ReaderLabels, cover: HTMLElement | null, ratio: string) {
  const bar = el(dom, 'header', 'bb-reader__bar');
  const closeButton = el(dom, 'button', 'bb-reader__close bb-button', labels.close);
  closeButton.type = 'button';
  const readout = el(dom, 'span', 'bb-reader__readout bb-label');
  readout.setAttribute('aria-live', 'off');
  const thumb = buildThumb(dom, cover, ratio);
  const barTitle = el(dom, 'div', 'bb-reader__bar-title');
  // The title is already the dialog's name and the page's heading, so this copy stays out of the reading order.
  barTitle.setAttribute('aria-hidden', 'true');
  const barText = el(dom, 'span', 'bb-reader__bar-text');
  barTitle.append(thumb, barText);
  const sizes = el(dom, 'div', 'bb-reader__sizes');
  sizes.setAttribute('role', 'group');
  sizes.setAttribute('aria-label', labels.textSize);
  const sizeDown = buildSizeButton(dom, 'bb-reader__size--down', labels.smaller);
  const sizeUp = buildSizeButton(dom, 'bb-reader__size--up', labels.larger);
  sizes.append(sizeDown, sizeUp);
  const line = el(dom, 'div', 'bb-reader__line');
  line.setAttribute('aria-hidden', 'true');
  const lineFill = el(dom, 'div', 'bb-reader__line-fill');
  line.appendChild(lineFill);
  bar.append(closeButton, barTitle, sizes, readout, line);
  return { bar, closeButton, barTitle, barText, thumb, sizeDown, sizeUp, readout, lineFill };
}

function coverRatio(aspect: number | undefined): string {
  return String(aspect && Number.isFinite(aspect) && aspect > 0 ? aspect : DEFAULT_COVER_ASPECT);
}

function buildCover(dom: Document, cover: HTMLElement | null, ratio: string) {
  // The cover repeats the title and author that the document already gives, so it is left out of the reading order.
  const aside = el(dom, 'div', 'bb-reader__cover');
  aside.setAttribute('aria-hidden', 'true');
  const slot = el(dom, 'div', 'bb-reader__cover-slot');
  // A custom property instead of a direct style, so a look can override the proportion with a token.
  slot.style.setProperty('--bb-reader-cover-aspect-given', ratio);
  if (cover) slot.appendChild(cover);
  aside.appendChild(slot);
  return { aside, slot };
}

/** Writes the reading place into the bar. Null means there is no text on the page to have a place in. */
export function showPlace(shell: ShellRefs, labels: ReaderLabels, percent: number | null): void {
  shell.readout.textContent = percent === null ? '' : labels.progress(Math.round(percent * 100));
  shell.lineFill.style.transform = `scaleX(${percent ?? 0})`;
}

/** Builds the static frame of the dialog. The article is filled separately. */
export function buildShell(dom: Document, input: ShellInput): ShellRefs {
  const root = el(dom, 'div', 'bb-reader');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', input.titleId);
  root.setAttribute('data-open', '0');
  root.setAttribute('data-content', '0');
  root.setAttribute('data-closed', '1');

  const windowEl = el(dom, 'div', 'bb-reader__window');
  const sheet = el(dom, 'div', 'bb-reader__sheet');
  sheet.style.opacity = '0';
  sheet.tabIndex = -1; // clicks inside land here, so Escape and Tab keep working
  const ratio = coverRatio(input.coverAspect);
  const { bar, closeButton, barTitle, barText, thumb, sizeDown, sizeUp, readout, lineFill } = buildBar(dom, input.labels, input.cover, ratio);
  const layout = el(dom, 'div', 'bb-reader__layout');
  if (!input.cover) layout.classList.add('bb-reader__layout--bare');
  const article = el(dom, 'article', 'bb-reader__doc');
  const { aside, slot } = buildCover(dom, input.cover, ratio);

  layout.append(article, aside);
  sheet.append(bar, layout);
  windowEl.appendChild(sheet);
  root.appendChild(windowEl);
  return { root, windowEl, sheet, bar, closeButton, barTitle, barText, thumb, sizeDown, sizeUp, readout, lineFill, layout, article, coverSlot: slot };
}
