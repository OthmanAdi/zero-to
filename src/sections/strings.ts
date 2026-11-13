import { defineStrings, type StringTable, type Translate, type UiLang } from '../i18n';
import { EN } from './words.en';

/**
 * The words of the landing sections.
 *
 * English is part of the page. German is a second file that is fetched only when a German page asks for it,
 * so a visitor carries one language, not two. Until the German words have arrived, a German lookup answers in
 * English. `loadSectionWords('de')` resolves once they are there. A page that starts in German awaits it before
 * it mounts the sections. `words.en.ts` and `words.de.ts` hold the same keys, and a test fails when they differ.
 */
export type SectionKey = keyof typeof EN;

let table: StringTable<SectionKey> = { en: EN, de: EN };
let lookup: Translate<SectionKey> = defineStrings<SectionKey>('sections', table);
let german: Promise<void> | null = null;

/** True when the words of a language are loaded. English always is. */
export function hasSectionWords(lang: UiLang): boolean {
  return lang === 'en' || table.de !== EN;
}

/** Fetches the words of a language if they are not there yet. Never rejects: on a failure the page stays English. */
export function loadSectionWords(lang: UiLang): Promise<void> {
  if (lang !== 'de') return Promise.resolve();
  german ??= import('./words.de').then(
    ({ DE }) => {
      table = { en: EN, de: DE };
      lookup = defineStrings<SectionKey>('sections', table);
    },
    () => {
      german = null;
    },
  );
  return german;
}

/** Looks up a string of the sections. */
export const say: Translate<SectionKey> = (key, vars, lang) => lookup(key, vars, lang);
