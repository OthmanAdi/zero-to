import { describe, expect, it } from 'vitest';
import { missingKeys } from '../i18n';
import { LEARN_STRINGS } from './strings';

function values(table: Readonly<Record<string, unknown>>): string[] {
  return Object.values(table).flatMap((value) => (typeof value === 'string' ? [value] : Object.values(value as Record<string, string>)));
}

describe('learn strings', () => {
  it('have the same keys and placeholders in English and German', () => {
    expect(Object.keys(LEARN_STRINGS.de).sort()).toEqual(Object.keys(LEARN_STRINGS.en).sort());
    expect(missingKeys(LEARN_STRINGS)).toEqual([]);
  });

  it('never scold, score or count streaks', () => {
    const banned = /\b(behind|streaks?|badges?|score|failed|wrong|lazy|hinterher|versagt|falsch|Punktzahl)\b/i;
    for (const text of [...values(LEARN_STRINGS.en), ...values(LEARN_STRINGS.de)]) {
      expect(banned.test(text), text).toBe(false);
    }
  });
});
