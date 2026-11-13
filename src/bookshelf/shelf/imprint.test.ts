import { describe, expect, it } from 'vitest';
import { hashText, imprintOf, seriesOf } from './imprint';

describe('imprintOf', () => {
  it('drops subdomains and names the site', () => {
    expect(imprintOf('en.wikipedia.org')).toEqual({ key: 'wikipedia.org', name: 'Wikipedia', initial: 'W' });
    expect(imprintOf('developer.mozilla.org')).toEqual({ key: 'mozilla.org', name: 'Mozilla', initial: 'M' });
    expect(imprintOf('example.org')).toEqual({ key: 'example.org', name: 'Example', initial: 'E' });
  });

  it('keeps one more label under a two-part ending', () => {
    expect(imprintOf('www.bbc.co.uk').key).toBe('bbc.co.uk');
    expect(imprintOf('news.example.com.au').name).toBe('Example');
  });

  it('reads a hyphenated name as words', () => {
    expect(imprintOf('www.rfc-editor.org')).toEqual({ key: 'rfc-editor.org', name: 'Rfc editor', initial: 'R' });
  });

  it('accepts a full address and upper case', () => {
    expect(imprintOf('HTTPS://En.Wikipedia.org/wiki/Tsundoku?x=1').key).toBe('wikipedia.org');
  });

  it('has no imprint for something that is not a site', () => {
    for (const source of [undefined, '', '   ', 'localhost', '192.168.0.1', 'reader notes']) {
      expect(imprintOf(source)).toEqual({ key: '', name: '', initial: '' });
    }
  });
});

describe('seriesOf', () => {
  it('gives every page of one site the same treatment', () => {
    expect(seriesOf('en.wikipedia.org', 4)).toBe(seriesOf('de.wikipedia.org', 4));
  });

  it('stays inside the number of treatments', () => {
    for (const source of ['example.org', 'mozilla.org', 'w3.org', 'archive.org', 'web.dev']) {
      const series = seriesOf(source, 3);
      expect(series).toBeGreaterThanOrEqual(0);
      expect(series).toBeLessThan(3);
    }
  });

  it('falls back to the first treatment without an imprint', () => {
    expect(seriesOf(undefined, 4)).toBe(0);
    expect(seriesOf('localhost', 4)).toBe(0);
    expect(seriesOf('example.org', 0)).toBe(0);
  });
});

describe('hashText', () => {
  it('is stable and spreads different text', () => {
    expect(hashText('wikipedia.org')).toBe(hashText('wikipedia.org'));
    expect(hashText('wikipedia.org')).not.toBe(hashText('mozilla.org'));
    expect(Number.isInteger(hashText(''))).toBe(true);
  });
});
