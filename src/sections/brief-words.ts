import { defineStrings, type StringTable, type Translate, type UiLang } from '../i18n';
import { BRIEF_EN } from './brief.en';

/**
 * The words of roadmap mode. They follow the rule of `strings.ts`: English is part of the code that builds the
 * brief, German is a second file fetched only when a German page asks for it, and until it has arrived a German
 * lookup answers in English. `brief.en.ts` and `brief.de.ts` hold the same keys, and a test fails when they
 * differ.
 */
export type BriefKey = keyof typeof BRIEF_EN;

let table: StringTable<BriefKey> = { en: BRIEF_EN, de: BRIEF_EN };
let lookup: Translate<BriefKey> = defineStrings<BriefKey>('brief', table);
let german: Promise<void> | null = null;

export const isBriefKey = (key: string): key is BriefKey => Object.hasOwn(BRIEF_EN, key);

/** True when the words of a language are loaded. English always is. */
export function hasBriefWords(lang: UiLang): boolean {
  return lang === 'en' || table.de !== BRIEF_EN;
}

/** Fetches the words of a language if they are not there yet. Never rejects: on a failure the brief stays English. */
export function loadBriefWords(lang: UiLang): Promise<void> {
  if (lang !== 'de') return Promise.resolve();
  german ??= import('./brief.de').then(
    ({ BRIEF_DE }) => {
      table = { en: BRIEF_EN, de: BRIEF_DE };
      lookup = defineStrings<BriefKey>('brief', table);
    },
    () => {
      german = null;
    },
  );
  return german;
}

/** Looks up a string of roadmap mode. */
export const sayBrief: Translate<BriefKey> = (key, vars, lang) => lookup(key, vars, lang);
