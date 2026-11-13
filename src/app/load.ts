import type { Issue, Roadmap } from '../roadmap/types';
import { validateRoadmap } from '../roadmap/validate';

/**
 * Where the roadmap of a page comes from. The page looks in this order and takes the first that is there:
 *
 * 1. the `zero-to-roadmap` element in the page itself (a prerendered gallery page, a file built by the skill);
 * 2. a share link, `#r=...`;
 * 3. `?src=<address>` of a roadmap file;
 * 4. `?road=<id>` of a gallery example;
 * 5. nothing: the table shows the gallery. The single-file viewer has no gallery and asks for a roadmap instead.
 *
 * A file dropped on the page comes later and goes through the same check. Whatever comes from outside the page
 * is validated, and a share link or a file is shown as a preview before this browser keeps it. A roadmap that
 * was given in any of these ways lies on the table alone, without the examples.
 */
export const ROADMAP_ELEMENT_ID = 'zero-to-roadmap';
export const RECEIPT_ELEMENT_ID = 'zero-to-receipt';

export type SourceKind = 'inline' | 'link' | 'address' | 'sample' | 'gallery';

export type Source =
  | { readonly kind: 'inline'; readonly text: string }
  | { readonly kind: 'link'; readonly fragment: string }
  | { readonly kind: 'address'; readonly url: string }
  | { readonly kind: 'sample'; readonly id: string }
  | { readonly kind: 'gallery' };

export interface SourceInput {
  /** Text of the `zero-to-roadmap` element, or null when the page has none. */
  readonly inline?: string | null;
  /** `location.hash`, with or without the `#`. */
  readonly hash?: string | null;
  /** `location.search`, with or without the `?`. */
  readonly search?: string | null;
}

/** The share fragment in a hash: what follows `r=`. */
export function shareFragment(hash: string | null | undefined): string | null {
  if (!hash) return null;
  const text = hash.startsWith('#') ? hash.slice(1) : hash;
  for (const part of text.split('&')) {
    if (part.startsWith('r=') && part.length > 2) return part.slice(2);
  }
  return null;
}

/** Only http and https addresses are fetched, and never one with a name and password in it. */
export function safeAddress(value: string | null | undefined, base = 'https://zero-to.invalid/'): string | null {
  if (!value || value.trim() === '') return null;
  try {
    const url = new URL(value.trim(), base);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Which source a page has, by the order above. */
export function pickSource(input: SourceInput, base?: string): Source {
  const inline = input.inline?.trim();
  if (inline) return { kind: 'inline', text: inline };
  const fragment = shareFragment(input.hash);
  if (fragment) return { kind: 'link', fragment };
  const params = new URLSearchParams(input.search ?? '');
  const address = safeAddress(params.get('src'), base);
  if (address) return { kind: 'address', url: address };
  const road = params.get('road')?.trim();
  if (road) return { kind: 'sample', id: road };
  return { kind: 'gallery' };
}

export type Loaded =
  | { readonly ok: true; readonly roadmap: Roadmap }
  | { readonly ok: false; readonly reason: 'syntax' | 'invalid' | 'missing' | 'fetch'; readonly issues: readonly Issue[] };

/** Reads roadmap text: it has to be JSON, and it has to pass `validateRoadmap`. The issues are the validator's own. */
export function readRoadmapText(text: string): Loaded {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, reason: 'syntax', issues: [{ path: '', message: error instanceof Error ? error.message : 'This is not JSON.' } as Issue] };
  }
  return readRoadmapValue(parsed);
}

export function readRoadmapValue(value: unknown): Loaded {
  const result = validateRoadmap(value);
  if (!result.ok) return { ok: false, reason: 'invalid', issues: result.errors };
  return { ok: true, roadmap: result.roadmap };
}

/** The link-check counts a built file may carry next to its roadmap. */
export interface Receipt {
  readonly opened: number;
  readonly kept: number;
  readonly dead: number;
  readonly flagged: number;
  readonly checkedOn: string;
}

export function readReceipt(text: string | null | undefined): Receipt | null {
  if (!text || text.trim() === '') return null;
  try {
    const value = JSON.parse(text) as Partial<Record<keyof Receipt, unknown>>;
    const count = (n: unknown): number | null => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.round(n) : null);
    const opened = count(value.opened);
    const kept = count(value.kept);
    if (opened === null || kept === null || typeof value.checkedOn !== 'string') return null;
    return { opened, kept, dead: count(value.dead) ?? 0, flagged: count(value.flagged) ?? 0, checkedOn: value.checkedOn };
  } catch {
    return null;
  }
}

/** The first issues as short lines, for a message on the page. */
export function issueLines(issues: readonly Issue[], most = 3): string[] {
  const lines = issues.slice(0, most).map((issue) => (issue.path ? `${issue.path}: ${issue.message}` : issue.message));
  if (issues.length > most) lines.push(`+ ${issues.length - most}`);
  return lines;
}

/** The debug switches of the address: `?still`, `?t=`, `?hx=`, `?p=`, `?hud`, with `?motion=` and `?view=`. */
export interface DebugParams {
  /** No loop: the page is put into its state, drawn once and then stepped by hand. */
  readonly still: boolean;
  /** Seconds of scene time to start at. */
  readonly t: number | null;
  /** Hold the dive at this hero-exit progress. */
  readonly hx: number | null;
  /** Open in the walk at this progress. */
  readonly p: number | null;
  /** Show the numbers of the page in a corner. */
  readonly hud: boolean;
  readonly reduced: boolean;
  readonly list: boolean;
  /** Steps of the opened roadmap to mark as done before anything is shown (memory only). */
  readonly done: number;
}

export function readDebug(search: string | null | undefined): DebugParams {
  const params = new URLSearchParams(search ?? '');
  const flag = (name: string): boolean => params.has(name) && params.get(name) !== '0';
  const number = (name: string, min: number, max: number): number | null => {
    const raw = params.get(name);
    if (raw === null || raw.trim() === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : null;
  };
  return {
    still: flag('still'),
    t: number('t', 0, 600),
    hx: number('hx', 0, 1),
    p: number('p', 0, 1),
    hud: flag('hud'),
    reduced: params.get('motion') === 'reduced',
    list: params.get('view') === 'list',
    done: Math.round(number('done', 0, 500) ?? 0),
  };
}
