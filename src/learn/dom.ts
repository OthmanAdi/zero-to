/**
 * Small DOM helpers for the cards. Text always goes in as text nodes, never as HTML, so roadmap text from any file
 * can never become markup.
 */
import { uiLang } from '../i18n';
import './learn.css';

export type Child = Node | string | null | undefined | false;
type AttrValue = string | number | boolean | null | undefined;
export type Props = Readonly<Record<string, AttrValue | ((event: Event) => void)>>;

/** Creates an element. Props starting with `on` and holding a function become listeners; `true` sets an empty attribute. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [name, value] of Object.entries(props)) {
      if (typeof value === 'function') {
        el.addEventListener(name.slice(2).toLowerCase(), value as EventListener);
      } else if (value === true) {
        el.setAttribute(name, '');
      } else if (value !== false && value !== null && value !== undefined) {
        el.setAttribute(name, String(value));
      }
    }
  }
  append(el, ...children);
  return el;
}

export function append(el: Element, ...children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

/** An element holding roadmap text: set as text, marked with the roadmap's language, direction left to the text. */
export function roadText<K extends keyof HTMLElementTagNameMap>(tag: K, text: string, lang: string, props?: Props | null): HTMLElementTagNameMap[K] {
  const el = h(tag, { ...props, lang, dir: 'auto' });
  el.textContent = text;
  return el;
}

let counter = 0;
/** An id unique in this page. */
export function uid(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter.toString(36)}`;
}

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export function headingTag(level: number): 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' {
  const clamped = Math.max(1, Math.min(6, Math.round(level)));
  return `h${clamped}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
}

/** Hidden on screen, read by screen readers. */
export function srOnly(text: string): HTMLSpanElement {
  return h('span', { class: 'zl-sr', lang: uiLang() }, text);
}

/** What a card asks its host to do. The card never moves anything itself. */
export interface GoDetail {
  readonly waypointId?: string;
  readonly stageId?: string;
}

/** Bubbles from a card when the learner asks to go somewhere: `detail` is a `GoDetail`. */
export const GO_EVENT = 'zt:go';

export function requestGo(from: Element, detail: GoDetail, onGo?: (detail: GoDetail) => void): void {
  from.dispatchEvent(new CustomEvent<GoDetail>(GO_EVENT, { bubbles: true, detail }));
  onGo?.(detail);
}

/** A mounted card: its element, a way to refresh it from the session, and a way to stop listening. */
export interface MountedCard {
  readonly root: HTMLElement;
  update(): void;
  destroy(): void;
}

export interface CardOptions {
  /** Heading level of the card's title. Default 3, so a card sits under a stage heading in the outline. */
  readonly headingLevel?: HeadingLevel;
  /** Called with the target when the learner asks to go to a step or a stage. A `zt:go` event bubbles as well. */
  readonly onGo?: (detail: GoDetail) => void;
}

/** Marks the card root with the interface language, so screen readers read the labels in the right voice. */
export function cardRoot(tag: 'article' | 'section', className: string, props?: Props): HTMLElement {
  return h(tag, { ...props, class: `zl-card ${className}`, lang: uiLang() });
}

/** Keeps a textarea or input value while the card is rebuilt or updated. */
export function setValueIfIdle(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  if (document.activeElement === el) return;
  if (el.value !== value) el.value = value;
}

/** A pin toggle: a native button with `aria-pressed`, a pin drawn hollow or filled, and the word next to it. */
export function pinButton(label: string, name: string): HTMLButtonElement {
  const button = h(
    'button',
    { type: 'button', class: 'zl-pin', 'aria-pressed': 'false', 'aria-label': name },
    h('span', { class: 'zl-pin-icon', 'aria-hidden': 'true' }),
    h('span', { class: 'zl-pin-word' }, label),
  );
  return button;
}

export function setPressed(button: HTMLButtonElement, pressed: boolean): void {
  button.setAttribute('aria-pressed', pressed ? 'true' : 'false');
}
