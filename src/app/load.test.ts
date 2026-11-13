import { describe, expect, it } from 'vitest';
import { missingKeys } from '../i18n';
import sample from '../roadmap/samples/photography-basics.json';
import { validateRoadmap } from '../roadmap/validate';
import { issueLines, pickSource, readDebug, readReceipt, readRoadmapText, readRoadmapValue, safeAddress, shareFragment } from './load';
import { APP_STRINGS, say } from './strings';

describe('where the roadmap comes from', () => {
  it('takes the roadmap in the page before anything else', () => {
    const source = pickSource({ inline: ' {"id":"x"} ', hash: '#r=z1.abc', search: '?road=rust-for-a-python-dev' });
    expect(source).toEqual({ kind: 'inline', text: '{"id":"x"}' });
  });

  it('then a share link, then an address, then a gallery example, then the gallery', () => {
    expect(pickSource({ inline: '', hash: '#r=z1.abc', search: '?road=rust&src=https://example.org/a.json' })).toEqual({ kind: 'link', fragment: 'z1.abc' });
    expect(pickSource({ inline: null, hash: '', search: '?road=rust&src=https://example.org/a.json' })).toEqual({ kind: 'address', url: 'https://example.org/a.json' });
    expect(pickSource({ hash: '#stop-start', search: '?road=rust-for-a-python-dev&ui=de' })).toEqual({ kind: 'sample', id: 'rust-for-a-python-dev' });
    expect(pickSource({ hash: '', search: '?ui=de' })).toEqual({ kind: 'gallery' });
    expect(pickSource({})).toEqual({ kind: 'gallery' });
  });

  it('reads the share fragment out of a hash', () => {
    expect(shareFragment('#r=z1.abc')).toBe('z1.abc');
    expect(shareFragment('r=j1.abc')).toBe('j1.abc');
    expect(shareFragment('#top&r=z1.q')).toBe('z1.q');
    expect(shareFragment('#r=')).toBeNull();
    expect(shareFragment('#start')).toBeNull();
    expect(shareFragment(null)).toBeNull();
  });

  it('fetches only http and https addresses without a name and password', () => {
    expect(safeAddress('https://example.org/r.json')).toBe('https://example.org/r.json');
    expect(safeAddress('roadmaps/r.json', 'https://example.org/site/')).toBe('https://example.org/site/roadmaps/r.json');
    expect(safeAddress('javascript:alert(1)')).toBeNull();
    expect(safeAddress('data:application/json,{}')).toBeNull();
    expect(safeAddress('file:///c:/secret.json')).toBeNull();
    expect(safeAddress('https://user:pass@example.org/r.json')).toBeNull();
    expect(safeAddress('  ')).toBeNull();
  });
});

describe('reading a roadmap', () => {
  it('accepts a valid roadmap', () => {
    const result = readRoadmapText(JSON.stringify(sample));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.roadmap.id).toBe('photography-basics');
  });

  it('rejects an invalid roadmap with the issues from validateRoadmap', () => {
    const broken = { ...(sample as Record<string, unknown>), stages: [], title: 7 };
    const expected = validateRoadmap(broken);
    expect(expected.ok).toBe(false);
    const result = readRoadmapValue(broken);
    expect(result.ok).toBe(false);
    if (!result.ok && !expected.ok) {
      expect(result.reason).toBe('invalid');
      expect(result.issues).toEqual(expected.errors);
      expect(result.issues.length).toBeGreaterThan(0);
    }
    const fromText = readRoadmapText(JSON.stringify(broken));
    if (!fromText.ok && !expected.ok) expect(fromText.issues).toEqual(expected.errors);
  });

  it('rejects text that is not JSON, and things that are not roadmaps at all', () => {
    const notJson = readRoadmapText('{"id": ');
    expect(notJson.ok).toBe(false);
    if (!notJson.ok) {
      expect(notJson.reason).toBe('syntax');
      expect(notJson.issues).toHaveLength(1);
    }
    for (const value of [null, 42, 'roadmap', [], {}]) expect(readRoadmapValue(value).ok).toBe(false);
  });

  it('shortens a long list of issues', () => {
    const issues = Array.from({ length: 7 }, (_, index) => ({ path: `/stages/${index}`, message: 'is missing a title' }));
    expect(issueLines(issues)).toEqual(['/stages/0: is missing a title', '/stages/1: is missing a title', '/stages/2: is missing a title', '+ 4']);
    expect(issueLines([{ path: '', message: 'is not an object' }])).toEqual(['is not an object']);
  });

  it('reads the link-check counts of a built file, and nothing from a broken one', () => {
    expect(readReceipt('{"opened":38,"kept":31,"dead":4,"flagged":3,"checkedOn":"2026-11-13"}')).toEqual({ opened: 38, kept: 31, dead: 4, flagged: 3, checkedOn: '2026-11-13' });
    expect(readReceipt('{"opened":3,"kept":3,"checkedOn":"2026-11-13"}')).toEqual({ opened: 3, kept: 3, dead: 0, flagged: 0, checkedOn: '2026-11-13' });
    expect(readReceipt('')).toBeNull();
    expect(readReceipt('{"opened":"many"}')).toBeNull();
    expect(readReceipt('nope')).toBeNull();
  });
});

describe('the debug switches', () => {
  it('reads ?still, ?t=, ?hx=, ?p= and ?hud', () => {
    expect(readDebug('?still&t=2.5&hx=0.6&p=0.3&hud')).toEqual({ still: true, t: 2.5, hx: 0.6, p: 0.3, hud: true, reduced: false, list: false, done: 0 });
    expect(readDebug('')).toEqual({ still: false, t: null, hx: null, p: null, hud: false, reduced: false, list: false, done: 0 });
  });

  it('keeps every number inside its range and ignores what is not a number', () => {
    expect(readDebug('?hx=7&p=-2&t=abc').hx).toBe(1);
    expect(readDebug('?hx=7&p=-2&t=abc').p).toBe(0);
    expect(readDebug('?hx=7&p=-2&t=abc').t).toBeNull();
    expect(readDebug('?still=0').still).toBe(false);
    expect(readDebug('?motion=reduced&view=list&done=2.4')).toMatchObject({ reduced: true, list: true, done: 2 });
  });
});

describe('the words of the page', () => {
  it('has every string in English and German', () => {
    expect(missingKeys(APP_STRINGS)).toEqual([]);
  });

  it('counts stages in both languages', () => {
    expect(say('finaleStages', { count: 1 }, 'en')).toBe('1 stage');
    expect(say('finaleStages', { count: 5 }, 'en')).toBe('5 stages');
    expect(say('finaleStages', { count: 1 }, 'de')).toBe('1 Etappe');
    expect(say('finaleStages', { count: 5 }, 'de')).toBe('5 Etappen');
  });
});
