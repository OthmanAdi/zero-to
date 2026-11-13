import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetUiLang, setUiLang } from '../i18n';
import { day, hours, keepTogether } from './format';

beforeEach(() => setUiLang('en', false));
afterEach(() => resetUiLang());

describe('keepTogether', () => {
  it('binds numbers to their unit and month, and leaves other spaces alone', () => {
    expect(keepTogether('Saves about 19 h.')).toBe('Saves about 19 h.');
    expect(day('2027-03-17')).toBe('17 Mar 2027');
    expect(hours(90)).toBe('about 1.5 h');
    expect(hours(90, { lang: 'de' })).toBe('ca. 1,5 Std.');
  });
});
