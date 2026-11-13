/**
 * Interface language and script handling.
 *
 * Two different things live here and must not be mixed up:
 *
 * - The interface language: the words of buttons, labels and hints. It is English or German, chosen by the
 *   visitor, and every package registers its words with `defineStrings`.
 * - The language and script of a roadmap's own text, which can be anything. `scriptOf` and `dirOf` look at that
 *   text so it can be set, measured and printed correctly whatever it is.
 */

export const UI_LANGS = ['en', 'de'] as const;
export type UiLang = (typeof UI_LANGS)[number];

/** One count-dependent string. `other` is required, the rest follow `Intl.PluralRules` for the language. */
export interface PluralForms {
  readonly zero?: string;
  readonly one?: string;
  readonly two?: string;
  readonly few?: string;
  readonly many?: string;
  readonly other: string;
}

export type StringValue = string | PluralForms;
export type StringVars = Readonly<Record<string, string | number>>;

/** The words of one package: the same keys in every interface language. */
export type StringTable<K extends string = string> = { readonly [L in UiLang]: Readonly<Record<K, StringValue>> };

/** A package's own lookup, typed to its keys. */
export type Translate<K extends string> = (key: K, vars?: StringVars, lang?: UiLang) => string;

const registry = new Map<string, StringTable>();
const STORAGE_KEY = 'zero-to:ui';

let chosen: UiLang | null = null;
const listeners = new Set<(lang: UiLang) => void>();

function isUiLang(value: unknown): value is UiLang {
  return typeof value === 'string' && (UI_LANGS as readonly string[]).includes(value);
}

/** Reduces a language tag such as `de-AT` to an interface language, or null when it is neither. */
export function matchUiLang(tag: string | null | undefined): UiLang | null {
  if (!tag) return null;
  const primary = tag.trim().toLowerCase().split(/[-_]/)[0];
  return isUiLang(primary) ? primary : null;
}

/** What `resolveUiLang` looks at, in this order. Passed in so the rule can be tested without a browser. */
export interface UiLangSources {
  /** The page's query string, with or without the leading `?`. */
  readonly search?: string | null;
  /** The choice stored by `setUiLang`. */
  readonly stored?: string | null;
  /** `navigator.languages`. */
  readonly languages?: readonly string[] | null;
}

/** The rule: `?ui=`, then the stored choice, then the browser's languages in order, then English. */
export function resolveUiLang(sources: UiLangSources): UiLang {
  if (sources.search) {
    const fromQuery = matchUiLang(new URLSearchParams(sources.search).get('ui'));
    if (fromQuery) return fromQuery;
  }
  const stored = matchUiLang(sources.stored);
  if (stored) return stored;
  for (const tag of sources.languages ?? []) {
    const match = matchUiLang(tag);
    if (match) return match;
  }
  return 'en';
}

function readStored(): string | null {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

/** The interface language of this page. Resolved once, then kept until `setUiLang` changes it. */
export function uiLang(): UiLang {
  if (chosen) return chosen;
  const nav = typeof navigator === 'undefined' ? null : navigator;
  chosen = resolveUiLang({
    search: typeof location === 'undefined' ? null : location.search,
    stored: readStored(),
    languages: nav?.languages?.length ? nav.languages : nav?.language ? [nav.language] : null,
  });
  return chosen;
}

/** Changes the interface language, remembers it for the next visit and tells every listener. */
export function setUiLang(lang: UiLang, remember = true): void {
  const changed = chosen !== lang;
  chosen = lang;
  if (remember) {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, lang);
    } catch {
      // Private mode or blocked storage: the choice lasts for this page only.
    }
  }
  if (changed) for (const listener of listeners) listener(lang);
}

/** Calls `listener` whenever the interface language changes. Returns the function that stops it. */
export function onUiLang(listener: (lang: UiLang) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Forgets the resolved language so the next `uiLang()` reads the page again. For tests. */
export function resetUiLang(): void {
  chosen = null;
}

function pluralRule(lang: UiLang, count: number): Intl.LDMLPluralRule {
  try {
    return new Intl.PluralRules(lang).select(count);
  } catch {
    return count === 1 ? 'one' : 'other';
  }
}

function render(value: StringValue, vars: StringVars | undefined, lang: UiLang): string {
  let template: string;
  if (typeof value === 'string') {
    template = value;
  } else {
    const count = Number(vars?.count);
    const exact = count === 0 && value.zero !== undefined ? value.zero : undefined;
    template = exact ?? (Number.isFinite(count) ? value[pluralRule(lang, count)] : undefined) ?? value.other;
  }
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

function lookup(ns: string, key: string, lang: UiLang): StringValue | undefined {
  const table = registry.get(ns);
  if (!table) return undefined;
  return table[lang][key] ?? table.en[key];
}

/**
 * Registers the words of one package under a namespace and returns a lookup typed to its keys.
 *
 * ```ts
 * const say = defineStrings('shelf', {
 *   en: { sources: { one: '{count} source', other: '{count} sources' } },
 *   de: { sources: { one: '{count} Quelle', other: '{count} Quellen' } },
 * });
 * say('sources', { count: 5 });   // "5 sources"
 * t('shelf.sources', { count: 1 }) // the same string by its full key
 * ```
 *
 * The type makes a missing German key a compile error. `missingKeys` checks the same at run time for tables
 * that were built dynamically, and every package asserts it in a test.
 */
export function defineStrings<K extends string>(ns: string, table: StringTable<K>): Translate<K> {
  if (!/^[a-z][a-z0-9-]*$/.test(ns)) throw new Error(`defineStrings: "${ns}" is not a valid namespace`);
  registry.set(ns, table);
  return (key, vars, lang) => {
    const active = lang ?? uiLang();
    const value = table[active][key] ?? table.en[key];
    return value === undefined ? `${ns}.${key}` : render(value, vars, active);
  };
}

/**
 * Looks a string up by its full key, `namespace.key`. `{name}` is replaced from `vars`, and a plural entry is
 * chosen by `vars.count`. A key nobody registered comes back as the key itself, so a gap shows on the page
 * without breaking it.
 */
export function t(key: string, vars?: StringVars, lang?: UiLang): string {
  const dot = key.indexOf('.');
  if (dot <= 0) return key;
  const active = lang ?? uiLang();
  const value = lookup(key.slice(0, dot), key.slice(dot + 1), active);
  return value === undefined ? key : render(value, vars, active);
}

/**
 * Every way a table's languages disagree: a key one language lacks, an empty string, a plural entry without
 * `other`, or a placeholder that one language uses and another does not. Empty when the table is sound.
 */
export function missingKeys(table: { readonly [lang: string]: Readonly<Record<string, StringValue>> }): string[] {
  const issues: string[] = [];
  const keys = new Set<string>();
  for (const lang of UI_LANGS) for (const key of Object.keys(table[lang] ?? {})) keys.add(key);
  const placeholders = (value: StringValue): string => {
    const text = typeof value === 'string' ? value : Object.values(value).join(' ');
    return [...new Set(text.match(/\{\w+\}/g) ?? [])].sort().join(',');
  };
  for (const key of [...keys].sort()) {
    const seen: string[] = [];
    for (const lang of UI_LANGS) {
      const value = table[lang]?.[key];
      if (value === undefined) {
        issues.push(`${lang}: "${key}" is missing`);
        continue;
      }
      if (typeof value === 'string' ? value.trim() === '' : !value.other) {
        issues.push(`${lang}: "${key}" is empty`);
        continue;
      }
      seen.push(placeholders(value));
    }
    if (seen.length === UI_LANGS.length && new Set(seen).size > 1) {
      issues.push(`"${key}" uses different placeholders: ${seen.map((entry) => entry || 'none').join(' / ')}`);
    }
  }
  return issues;
}

/** The namespaces registered so far, and the issues of all of them. One test can guard the whole app with it. */
export function stringIssues(): string[] {
  const issues: string[] = [];
  for (const [ns, table] of registry) for (const issue of missingKeys(table)) issues.push(`${ns}: ${issue}`);
  return issues;
}

// ---------------------------------------------------------------------------------------------------------
// Scripts and direction of roadmap text.

export type Script =
  | 'latin'
  | 'greek'
  | 'cyrillic'
  | 'arabic'
  | 'hebrew'
  | 'han'
  | 'kana'
  | 'hangul'
  | 'devanagari'
  | 'thai'
  | 'other';

export type Direction = 'ltr' | 'rtl';

/** Order matters only for speed: the common scripts come first. */
const SCRIPTS: readonly (readonly [Script, RegExp])[] = [
  ['latin', /\p{Script=Latin}/u],
  ['cyrillic', /\p{Script=Cyrillic}/u],
  ['greek', /\p{Script=Greek}/u],
  ['arabic', /\p{Script=Arabic}/u],
  ['hebrew', /\p{Script=Hebrew}/u],
  ['han', /\p{Script=Han}/u],
  ['kana', /[\p{Script=Hiragana}\p{Script=Katakana}]/u],
  ['hangul', /\p{Script=Hangul}/u],
  ['devanagari', /\p{Script=Devanagari}/u],
  ['thai', /\p{Script=Thai}/u],
];

const LETTER = /\p{L}/u;
const RTL = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Adlam}\p{Script=Samaritan}\p{Script=Mandaic}]/u;

function scriptOfLetter(letter: string): Script {
  for (const [script, pattern] of SCRIPTS) if (pattern.test(letter)) return script;
  return 'other';
}

/**
 * The script of the first letter in the text. Digits, spaces and punctuation are skipped, so "2026: Привет"
 * is Cyrillic. Text without any letter counts as Latin, because digits and punctuation are set like Latin.
 */
export function scriptOf(text: string): Script {
  for (const char of text) {
    if (LETTER.test(char)) return scriptOfLetter(char);
  }
  return 'latin';
}

/** The writing direction of the first letter in the text. Text without any letter runs left to right. */
export function dirOf(text: string): Direction {
  for (const char of text) {
    if (LETTER.test(char)) return RTL.test(char) ? 'rtl' : 'ltr';
  }
  return 'ltr';
}

const UNJOINED = /^[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Common}\p{Script=Inherited}]*$/u;

/**
 * True when every character is Latin, Greek, Cyrillic or script-neutral (digits, spaces, punctuation). Only
 * such text may be drawn glyph by glyph: letters of joined or stacked scripts change shape with their
 * neighbours and must be drawn in one piece.
 */
export function isUnjoined(text: string): boolean {
  return UNJOINED.test(text);
}

/**
 * Splits text into the pieces a reader sees as single characters, so an accent stays on its letter and an
 * emoji stays whole.
 */
export function graphemes(text: string, lang?: string): string[] {
  const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Segmenter) {
    try {
      return Array.from(new Segmenter(lang, { granularity: 'grapheme' }).segment(text), (part) => part.segment);
    } catch {
      // An unknown language tag: fall through to code points.
    }
  }
  const parts: string[] = [];
  for (const char of text) {
    if (parts.length > 0 && /^\p{M}$/u.test(char)) parts[parts.length - 1] += char;
    else parts.push(char);
  }
  return parts;
}
