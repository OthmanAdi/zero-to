/**
 * Helpers for the learning tests: the sample roadmap, storages that misbehave, and the accessible name and
 * keyboard order of what a card renders.
 */
import { sampleRoadmap } from '../roadmap/testing';
import type { Roadmap } from '../roadmap/types';
import { memoryStorage, type StorageLike } from './storage';

export { sampleRoadmap };

/** A mutable copy of the sample, for tests that change it. */
export function sampleDraft(): { -readonly [K in keyof Roadmap]: any } {
  return structuredClone(sampleRoadmap()) as never;
}

/** Storage that refuses every write, like a browser with site data blocked. Reads return nothing. */
export function throwingStorage(): StorageLike {
  return {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
    removeItem: () => {
      throw new Error('blocked');
    },
  };
}

/** Storage that works until `fill()` is called, then throws on every write, like a full quota. */
export function fillingStorage(): StorageLike & { fill(): void } {
  const inner = memoryStorage();
  let full = false;
  return {
    getItem: (key) => inner.getItem(key),
    setItem: (key, value) => {
      if (full) throw new Error('QuotaExceededError');
      inner.setItem(key, value);
    },
    removeItem: (key) => inner.removeItem(key),
    fill: () => {
      full = true;
    },
  };
}

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]';

function isHidden(el: Element, root: Element): boolean {
  for (let node: Element | null = el; node && node !== root.parentElement; node = node.parentElement) {
    if (node.hasAttribute('hidden')) return true;
  }
  return false;
}

/** What Tab reaches inside a root, in order: not hidden, not disabled, no negative tabindex. */
export function tabOrder(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
    if (isHidden(el, root)) return false;
    if ((el as HTMLButtonElement).disabled) return false;
    const tabindex = el.getAttribute('tabindex');
    return tabindex === null || Number(tabindex) >= 0;
  });
}

function text(el: Element | null): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** A small accessible-name computation: aria-labelledby, aria-label, a label, then the element's own text. */
export function accessibleName(el: Element): string {
  const labelledby = el.getAttribute('aria-labelledby');
  if (labelledby) {
    const name = labelledby
      .split(/\s+/)
      .map((id) => text(el.ownerDocument.getElementById(id)))
      .join(' ')
      .trim();
    if (name) return name;
  }
  const label = el.getAttribute('aria-label');
  if (label?.trim()) return label.trim();
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea') {
    const id = el.getAttribute('id');
    const forLabel = id ? el.ownerDocument.querySelector(`label[for="${id}"]`) : null;
    const wrapping = el.closest('label');
    return text(forLabel) || text(wrapping);
  }
  return text(el);
}

/** Native interactive elements only: the cards never make a div into a button. */
export function isNativeControl(el: Element): boolean {
  return ['a', 'button', 'input', 'select', 'textarea'].includes(el.tagName.toLowerCase());
}
