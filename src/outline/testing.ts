/**
 * Test helpers: the gallery samples, validated, and a page parsed from HTML text without innerHTML.
 */
import { validateRoadmap } from '../roadmap/validate';
import type { Roadmap } from '../roadmap/types';

const files = import.meta.glob('../roadmap/samples/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

export function samples(): Roadmap[] {
  return Object.keys(files)
    .sort()
    .map((key) => {
      const result = validateRoadmap(structuredClone(files[key]));
      if (!result.ok) throw new Error(`${key} does not validate`);
      return result.roadmap;
    });
}

export function sample(id: string): Roadmap {
  const found = samples().find((r) => r.id === id);
  if (!found) throw new Error(`no sample ${id}`);
  return found;
}

/** A copy that may be changed, for tests that need odd input. */
export function mutable(id: string): any {
  return structuredClone(sample(id));
}

/** Parses an HTML fragment into a fresh element of the current document. */
export function parseFragment(html: string): HTMLElement {
  const doc = new DOMParser().parseFromString(`<!doctype html><html><body><div id="host">${html}</div></body></html>`, 'text/html');
  const host = doc.getElementById('host') as HTMLElement;
  return document.importNode(host, true) as HTMLElement;
}

/** The heading levels of an element in document order. */
export function headingLevels(root: ParentNode): number[] {
  return [...root.querySelectorAll('h1, h2, h3, h4, h5, h6')]
    .filter((h) => !(h as HTMLElement).closest('[hidden]') && !(h as HTMLElement).closest('.zl-head'))
    .map((h) => Number(h.tagName.slice(1)));
}

/** The first place where a heading level skips, or null. */
export function firstSkip(levels: readonly number[]): string | null {
  let previous = 0;
  for (let i = 0; i < levels.length; i += 1) {
    const level = levels[i] as number;
    if (level > previous + 1) return `heading ${i} is h${level} after h${previous}`;
    previous = level;
  }
  return null;
}
