/**
 * Small DOM helpers of the overlay. Text always goes in as text nodes, so roadmap text can never become markup.
 */
import { uiLang } from '../i18n';

export type Child = Node | string | null | undefined | false;
type AttrValue = string | number | boolean | null | undefined;
export type Props = Readonly<Record<string, AttrValue | ((event: never) => void)>>;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Creates an element. A prop that starts with `on` and holds a function becomes a listener. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props) {
    for (const [name, value] of Object.entries(props)) {
      if (typeof value === 'function') node.addEventListener(name.slice(2).toLowerCase(), value as EventListener);
      else if (value === true) node.setAttribute(name, '');
      else if (value !== false && value !== null && value !== undefined) node.setAttribute(name, String(value));
    }
  }
  add(node, ...children);
  return node;
}

export function add(node: Element, ...children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

/** Replaces what an element holds. Missing children are skipped. */
export function fill(node: Element, ...children: Child[]): void {
  node.replaceChildren();
  add(node, ...children);
}

/** An SVG element with attributes. */
export function svg(tag: string, attrs: Readonly<Record<string, string | number>> = {}, ...children: Element[]): SVGElement {
  const node = document.createElementNS(SVG_NS, tag) as SVGElement;
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  node.append(...children);
  return node;
}

/** An element that holds roadmap text: set as text, in the roadmap's language, direction left to the text. */
export function roadText<K extends keyof HTMLElementTagNameMap>(tag: K, text: string, lang: string, props?: Props | null): HTMLElementTagNameMap[K] {
  const node = el(tag, { ...props, lang, dir: 'auto' });
  node.textContent = text;
  return node;
}

/** Writes roadmap text into an element that already exists. Returns true when the text changed. */
export function setRoadText(node: HTMLElement, text: string, lang: string): boolean {
  if (node.getAttribute('lang') !== lang) node.setAttribute('lang', lang);
  if (!node.hasAttribute('dir')) node.setAttribute('dir', 'auto');
  if (node.textContent === text) return false;
  node.textContent = text;
  return true;
}

/** Writes text only when it differs, so a line that is set every frame touches the document only on a change. */
export function setText(node: Element, text: string): boolean {
  if (node.textContent === text) return false;
  node.textContent = text;
  return true;
}

/** Hidden on screen, read by screen readers. */
export function srOnly(text: string): HTMLSpanElement {
  return el('span', { class: 'zh-sr', lang: uiLang() }, text);
}

let counter = 0;
export function uid(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter.toString(36)}`;
}

/** Reduced motion: forced by `?motion=reduced` (the host passes it), or read live from the media query. */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ---------------------------------------------------------------------------------------------------------
// Icons: our own drawings on a 20 px grid, stroked in the current colour.

const ICONS = {
  /** Three lines with their bullets: the outline. */
  list: 'M4 5.5h.01M4 10h.01M4 14.5h.01M7.5 5.5H16M7.5 10H16M7.5 14.5H16',
  /** A folded map with its two creases. */
  map: 'M3.5 5.2 7.8 3.6l4.4 1.8 4.3-1.6v11l-4.3 1.6-4.4-1.8-4.3 1.6zM7.8 3.6v11M12.2 5.4v11',
  /** A field notebook with its elastic band. */
  notebook: 'M5.5 3.5h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-9zM5.5 3.5v13M4 6.5h1.5M4 10h1.5M4 13.5h1.5M12.5 3.5v13',
  /** A sheet leaving its sleeve. */
  share: 'M10 12V3.5M6.8 6.4 10 3.2l3.2 3.2M5 9.5H4v7h12v-7h-1',
  /** A sheet going into a sleeve. */
  open: 'M10 3.5V12M6.8 9.1 10 12.3l3.2-3.2M5 9.5H4v7h12v-7h-1',
  /** The class flag. */
  teacher: 'M5.5 17V3.5M5.5 4.5h9l-2.2 3 2.2 3h-9',
  /** A map closing into its zig-zag. */
  fold: 'M3.5 6.5 7 4.5l3 2 3-2 3.5 2v9L13 13.5l-3 2-3-2-3.5 2zM7 4.5v9M13 4.5v9M10 6.5v9',
  /** A cross. */
  close: 'M5 5l10 10M15 5 5 15',
  /** A chevron pointing up. */
  up: 'M5.5 12.5 10 8l4.5 4.5',
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName): SVGElement {
  const root = svg('svg', { viewBox: '0 0 20 20', width: 20, height: 20, 'aria-hidden': 'true', focusable: 'false', class: 'zh-icon' });
  root.append(
    svg('path', {
      d: ICONS[name],
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.5,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    }),
  );
  return root;
}

/** A round tool button: an icon, a name for screen readers and a tooltip, and an optional count. */
export function toolButton(name: IconName | 'help', label: string, onClick: () => void): HTMLButtonElement {
  const button = el('button', { type: 'button', class: 'zh-tool', 'aria-label': label, title: label, 'data-tool': name });
  if (name === 'help') button.append(el('span', { class: 'zh-tool-glyph', 'aria-hidden': 'true' }, '?'));
  else button.append(icon(name));
  button.addEventListener('click', onClick);
  return button;
}

/** True when a key press belongs to a field, a reader or a dialog and must not act as a shortcut. */
export function typingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], .bb-reader')) return true;
  return false;
}

/**
 * Keeps a title inside `maxLines` lines: it shrinks in steps from 100 to 56 percent of its size, and what still
 * does not fit ends in an ellipsis. The element's font size must be `calc(<size> * var(--zh-fit))`. Without
 * layout (a test, a hidden element) it does nothing.
 */
export function fitLines(node: HTMLElement, maxLines = 3, minScale = 0.56): void {
  node.style.removeProperty('--zh-fit');
  node.classList.remove('is-clamped');
  if (typeof getComputedStyle !== 'function') return;
  const lines = (): number => {
    const lineHeight = Number.parseFloat(getComputedStyle(node).lineHeight);
    return lineHeight > 0 ? Math.round((node.scrollHeight - 2) / lineHeight) : 0;
  };
  let scale = 1;
  while (lines() > maxLines && scale > minScale + 1e-6) {
    scale = Math.max(minScale, scale - 0.08);
    node.style.setProperty('--zh-fit', scale.toFixed(2));
  }
  if (lines() > maxLines) node.classList.add('is-clamped');
}
