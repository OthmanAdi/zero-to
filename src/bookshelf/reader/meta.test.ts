import { describe, expect, it } from 'vitest';
import { cleanLang, defaultReaderLabels, estimateMinutes, formatSavedDate, hostnameOf, resolveLabels } from './meta';

describe('estimateMinutes', () => {
  const words = (count: number) => Array.from({ length: count }, () => 'word').join(' ');

  it('is at least 1', () => {
    expect(estimateMinutes('')).toBe(1);
    expect(estimateMinutes('   \n ')).toBe(1);
    expect(estimateMinutes('one two three')).toBe(1);
  });

  it('uses 220 words per minute and rounds up', () => {
    expect(estimateMinutes(words(220))).toBe(1);
    expect(estimateMinutes(words(221))).toBe(2);
    expect(estimateMinutes(words(2200))).toBe(10);
  });
});

describe('labels and helpers', () => {
  it('merges label overrides and ignores undefined values', () => {
    const labels = resolveLabels({ close: 'Zu', cancel: undefined });
    expect(labels.close).toBe('Zu');
    expect(labels.cancel).toBe(defaultReaderLabels.cancel);
  });

  it('has the documented default texts', () => {
    expect(defaultReaderLabels.close).toBe('Back to shelf');
    expect(defaultReaderLabels.emptyTitle).toBe('No text saved yet');
    expect(defaultReaderLabels.emptyBody).toContain('Paste the part of the page you want to read');
    expect(JSON.stringify(Object.values(defaultReaderLabels).filter((v) => typeof v === 'string'))).not.toMatch(
      /[–—]|\s-\s/,
    );
  });

  it('keeps only language tags the platform can use', () => {
    expect(cleanLang(' de ')).toBe('de');
    expect(cleanLang('pt-BR')).toBe('pt-BR');
    expect(cleanLang('zh-Hant-TW')).toBe('zh-Hant-TW');
    expect(cleanLang('english')).toBe('');
    expect(cleanLang('e')).toBe('');
    expect(cleanLang('de_DE')).toBe('');
    expect(cleanLang('a-very-long-tag-here')).toBe('');
    expect(cleanLang(undefined)).toBe('');
  });

  it('strips www from the hostname and tolerates garbage', () => {
    expect(hostnameOf('https://www.example.com/a')).toBe('example.com');
    expect(hostnameOf('not a url')).toBe('');
  });

  it('formats saved dates and rejects invalid ones', () => {
    expect(formatSavedDate('2026-03-04T10:00:00Z', 'en')?.text).toBe('4 Mar 2026');
    expect(formatSavedDate('2026-09-14T10:00:00Z')?.text).toBe('14 Sep 2026');
    expect(formatSavedDate('2026-03-04T10:00:00Z', 'de')?.text).toMatch(/4\. M.*2026/);
    expect(formatSavedDate('nonsense')).toBeNull();
    expect(formatSavedDate(undefined)).toBeNull();
  });
});
