import { afterEach, describe, expect, it } from 'vitest';
import {
  defineStrings,
  dirOf,
  graphemes,
  isUnjoined,
  matchUiLang,
  missingKeys,
  onUiLang,
  resetUiLang,
  resolveUiLang,
  scriptOf,
  setUiLang,
  stringIssues,
  t,
  uiLang,
} from './index';

afterEach(() => {
  resetUiLang();
  try {
    localStorage.clear();
  } catch {
    // No storage in this environment.
  }
});

describe('scriptOf and dirOf', () => {
  const samples = [
    { text: 'Rust from zero', script: 'latin', dir: 'ltr' },
    { text: 'Größenwahn für Anfänger', script: 'latin', dir: 'ltr' },
    { text: 'Основы статистики', script: 'cyrillic', dir: 'ltr' },
    { text: 'Εισαγωγή στη φιλοσοφία', script: 'greek', dir: 'ltr' },
    { text: 'تعلم الخط العربي', script: 'arabic', dir: 'rtl' },
    { text: 'ללמוד עברית מאפס', script: 'hebrew', dir: 'rtl' },
    { text: '书法入门', script: 'han', dir: 'ltr' },
    { text: 'はじめての将棋', script: 'kana', dir: 'ltr' },
    { text: '한국어 첫걸음', script: 'hangul', dir: 'ltr' },
    { text: 'हिंदी व्याकरण', script: 'devanagari', dir: 'ltr' },
    { text: 'ภาษาไทยเบื้องต้น', script: 'thai', dir: 'ltr' },
  ] as const;

  for (const sample of samples) {
    it(`${sample.script}: ${sample.text}`, () => {
      expect(scriptOf(sample.text)).toBe(sample.script);
      expect(dirOf(sample.text)).toBe(sample.dir);
    });
  }

  it('skips digits and punctuation to the first letter', () => {
    expect(scriptOf('2026: Привет')).toBe('cyrillic');
    expect(dirOf('101 — مقدمة')).toBe('rtl');
    expect(scriptOf('3 + 4 = 7')).toBe('latin');
    expect(dirOf('')).toBe('ltr');
    expect(scriptOf('ᚠᚢᚦ')).toBe('other');
  });

  it('allows glyph-by-glyph drawing only for Latin, Greek and Cyrillic', () => {
    expect(isUnjoined('STAGE 2 OF 5 · about 6 h')).toBe(true);
    expect(isUnjoined('Größe: 4,5 Std.')).toBe(true);
    expect(isUnjoined('Основы και βάση')).toBe(true);
    expect(isUnjoined('تعلم')).toBe(false);
    expect(isUnjoined('Rust 入门')).toBe(false);
    expect(isUnjoined('हिंदी')).toBe(false);
  });

  it('keeps an accent on its letter', () => {
    expect(graphemes('éa')).toEqual(['é', 'a']);
    expect(graphemes('abc')).toHaveLength(3);
  });
});

describe('the interface language', () => {
  it('prefers the query, then the stored choice, then the browser, then English', () => {
    expect(resolveUiLang({ search: '?ui=de', stored: 'en', languages: ['en-US'] })).toBe('de');
    expect(resolveUiLang({ search: '?ui=fr', stored: 'de', languages: ['en-US'] })).toBe('de');
    expect(resolveUiLang({ search: '', stored: null, languages: ['fr-FR', 'de-AT', 'en'] })).toBe('de');
    expect(resolveUiLang({ search: '?road=rust', stored: 'xx', languages: ['ja'] })).toBe('en');
    expect(resolveUiLang({})).toBe('en');
  });

  it('reduces tags', () => {
    expect(matchUiLang('de-CH')).toBe('de');
    expect(matchUiLang('EN_us')).toBe('en');
    expect(matchUiLang('nl')).toBeNull();
    expect(matchUiLang(null)).toBeNull();
  });

  it('remembers a choice and tells listeners once', () => {
    const heard: string[] = [];
    const stop = onUiLang((lang) => heard.push(lang));
    setUiLang('de');
    setUiLang('de');
    expect(uiLang()).toBe('de');
    expect(heard).toEqual(['de']);
    resetUiLang();
    expect(uiLang()).toBe('de');
    stop();
    setUiLang('en');
    expect(heard).toEqual(['de']);
  });
});

describe('defineStrings and t', () => {
  const say = defineStrings('test-kit', {
    en: {
      hello: 'Hello, {name}',
      stages: { one: '{count} stage', other: '{count} stages' },
      none: { zero: 'Nothing pinned yet', one: '{count} pin', other: '{count} pins' },
    },
    de: {
      hello: 'Hallo, {name}',
      stages: { one: '{count} Etappe', other: '{count} Etappen' },
      none: { zero: 'Noch nichts angeheftet', one: '{count} Notiz', other: '{count} Notizen' },
    },
  });

  it('fills placeholders in both languages', () => {
    expect(say('hello', { name: 'Ada' }, 'en')).toBe('Hello, Ada');
    expect(say('hello', { name: 'Ada' }, 'de')).toBe('Hallo, Ada');
    expect(t('test-kit.hello', { name: 'Ada' }, 'de')).toBe('Hallo, Ada');
  });

  it('chooses the plural form by count', () => {
    expect(say('stages', { count: 1 }, 'en')).toBe('1 stage');
    expect(say('stages', { count: 5 }, 'en')).toBe('5 stages');
    expect(say('stages', { count: 1 }, 'de')).toBe('1 Etappe');
    expect(say('stages', { count: 0 }, 'de')).toBe('0 Etappen');
    expect(say('none', { count: 0 }, 'en')).toBe('Nothing pinned yet');
    expect(say('none', { count: 2 }, 'de')).toBe('2 Notizen');
  });

  it('follows the interface language when none is given', () => {
    setUiLang('de', false);
    expect(say('hello', { name: 'Ada' })).toBe('Hallo, Ada');
    expect(t('test-kit.stages', { count: 3 })).toBe('3 Etappen');
  });

  it('shows the key where a string is missing and leaves unknown placeholders alone', () => {
    expect(t('test-kit.nope')).toBe('test-kit.nope');
    expect(t('nowhere.key')).toBe('nowhere.key');
    expect(t('plain')).toBe('plain');
    expect(say('hello', {}, 'en')).toBe('Hello, {name}');
  });

  it('rejects a namespace that could not be a key prefix', () => {
    expect(() => defineStrings('Bad Name', { en: {}, de: {} })).toThrow();
  });
});

describe('missingKeys', () => {
  it('is empty for a sound table', () => {
    expect(missingKeys({ en: { a: 'A {n}', b: { other: 'B' } }, de: { a: 'A {n}', b: { other: 'B' } } })).toEqual([]);
  });

  it('names a missing key, an empty string and a placeholder that differs', () => {
    const issues = missingKeys({
      en: { a: 'A', b: 'B {count}', c: 'C' },
      de: { b: 'B {anzahl}', c: '  ' },
    });
    expect(issues).toHaveLength(3);
    expect(issues.join('\n')).toContain('de: "a" is missing');
    expect(issues.join('\n')).toContain('"b" uses different placeholders');
    expect(issues.join('\n')).toContain('de: "c" is empty');
  });

  it('finds nothing wrong with any registered namespace', () => {
    expect(stringIssues()).toEqual([]);
  });
});
