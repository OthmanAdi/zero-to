import { describe, expect, it } from 'vitest';
import { CLOTHS, hashText, PATTERNS } from '../bookshelf/shelf';
import { resourcesFor } from '../roadmap/derive';
import { sampleRoadmap } from '../roadmap/testing';
import type { ResourceType } from '../roadmap/types';
import { fixtureResource, fixtureResources, fixtureRoadmap } from './fixtures';
/** Formatters keep a number and its unit together with a no-break space; compare as plain text. */
const plain = (value: unknown): string => String(value).replace(/ /g, ' ');

import {
  costSentence,
  dockHeader,
  lookFor,
  pinFor,
  placeOf,
  safeHref,
  statusLine,
  statusSentence,
  toShelfItems,
  TYPE_LOOK,
} from './items';

const ALL_TYPES: ResourceType[] = ['docs', 'reference', 'book', 'course', 'video', 'article', 'interactive', 'exercises', 'tool', 'community'];

describe('the look of a resource type', () => {
  it('gives each of the ten types a cloth and a pattern the shelf knows', () => {
    for (const type of ALL_TYPES) {
      const look = lookFor(type);
      expect(CLOTHS).toContain(look.cloth);
      expect(PATTERNS).toContain(look.pattern);
    }
    expect(Object.keys(TYPE_LOOK).sort()).toEqual([...ALL_TYPES].sort());
  });

  it('follows the table of the specification', () => {
    expect(TYPE_LOOK).toEqual({
      docs: { cloth: 'slate', pattern: 'tiles' },
      reference: { cloth: 'slate', pattern: 'bars' },
      book: { cloth: 'rust', pattern: 'arcs' },
      course: { cloth: 'plum', pattern: 'rays' },
      video: { cloth: 'teal', pattern: 'waves' },
      article: { cloth: 'bone', pattern: 'bars' },
      interactive: { cloth: 'ochre', pattern: 'dots' },
      exercises: { cloth: 'moss', pattern: 'tiles' },
      tool: { cloth: 'ink', pattern: 'rays' },
      community: { cloth: 'ochre', pattern: 'waves' },
    });
  });

  it('falls back to the first cloth and the first pattern for a type it does not know', () => {
    expect(lookFor('podcast')).toEqual({ cloth: CLOTHS[0], pattern: PATTERNS[0] });
    expect(lookFor('toString')).toEqual({ cloth: CLOTHS[0], pattern: PATTERNS[0] });
  });
});

describe('toShelfItems', () => {
  const roadmap = fixtureRoadmap();
  const entries = resourcesFor(roadmap, 'fixture-stage');

  it('makes one volume per entry, in order, with the resource id as its id', () => {
    const items = toShelfItems(entries, null, 'en');
    expect(items.map((item) => item.id)).toEqual(entries.map((entry) => entry.resource.id));
    expect(items).toHaveLength(10);
  });

  it('maps host, author, thickness, stature, seed, note, language and type look', () => {
    const items = toShelfItems(entries, null, 'en');
    const book = items.find((item) => item.type === 'book')!;
    expect(book.source).toBe('example.org');
    expect(book.author).toBe('Fixture author');
    expect(book.thickness).toBe(1); // 240 minutes
    expect(book.stature).toBeCloseTo(0.5 + 3 / 6); // diamond
    expect(book.seed).toBe(hashText('fixture-book'));
    expect(book.note).toBe(book.why);
    expect(book.lang).toBe('en');
    expect(book.cloth).toBe('rust');
    expect(book.pattern).toBe('arcs');
    const docs = items.find((item) => item.type === 'docs')!;
    expect(docs.thickness).toBeCloseTo(45 / 240);
    expect(docs.stature).toBe(0.5);
    const tool = items.find((item) => item.type === 'tool')!;
    expect(tool.thickness).toBeUndefined(); // no minutes: the look's own width
    expect(tool.stature).toBeCloseTo(0.5 + 2 / 6);
    const course = items.find((item) => item.type === 'course')!;
    expect(course.thickness).toBe(1); // 600 minutes, clamped
  });

  it('carries the check status, the cost and the why into what the caption and reader print', () => {
    const items = toShelfItems(entries, null, 'en');
    const course = items.find((item) => item.type === 'course')!;
    expect(course.status).toBe('gated');
    expect(course.cost).toBe('paid');
    expect(course.statusLine).toBe('behind a login · opened 2026-11-13');
    expect(course.statusSentence).toContain('behind a login or paywall');
    expect(course.statusSentence).toContain('Only the syllabus is public.');
    const video = items.find((item) => item.type === 'video')!;
    expect(video.statusLine).toBe('not opened on 2026-11-13 (HTTP 403) · check it yourself');
    expect(video.statusSentence).toBe(
      'Could not be opened on 2026-11-13 (HTTP 403). Open it yourself before relying on it. Automated access was refused.',
    );
    const docs = items.find((item) => item.type === 'docs')!;
    expect(plain(docs.statusLine)).toBe('Free · about 45 min · opened 2026-11-13');
    expect(docs.why).toContain('made-up docs entry');
  });

  it('marks a volume done when the learner marked it as used, and only then', () => {
    const used = new Set(['fixture-article']);
    const items = toShelfItems(entries, { isUsed: (id) => used.has(id) }, 'en');
    expect(items.filter((item) => item.done).map((item) => item.id)).toEqual(['fixture-article']);
    expect(toShelfItems(entries, undefined, 'en').some((item) => item.done)).toBe(false);
  });

  it('gives an address that is not http or https no imprint', () => {
    const [item] = toShelfItems([{ resource: fixtureResource('docs', { url: 'javascript:alert(1)' }), main: true, for: 'x' }], null, 'en');
    expect(item!.source).toBe('');
  });

  it('works on the real sample roadmap', () => {
    const roadmap = sampleRoadmap();
    const stageEntries = resourcesFor(roadmap, roadmap.stages[0]!.id);
    const items = toShelfItems(stageEntries, null, 'en');
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(plain(items[0]!.statusLine)).toMatch(/^Free · about \d+ min · opened 2026-11-13$/);
  });
});

describe('status and cost words', () => {
  it('prints a verified free volume as cost, time and the day it was opened', () => {
    expect(plain(statusLine(fixtureResource('docs'), 'en'))).toBe('Free · about 45 min · opened 2026-11-13');
    expect(plain(statusLine(fixtureResource('docs', { minutes: 90 }), 'en'))).toBe('Free · about 1.5 h · opened 2026-11-13');
    expect(plain(statusLine(fixtureResource('docs'), 'de'))).toBe('Kostenlos · ca. 45 Min. · geöffnet 2026-11-13');
  });

  it('prints the price of a paid volume, and the day the price was seen in the reader', () => {
    const paid = fixtureResource('course', { cost: 'paid', price: { amount: 29, currency: 'EUR', per: 'month', seenOn: '2026-11-12' } });
    expect(plain(statusLine(paid, 'en'))).toBe('€29 a month · about 45 min · opened 2026-11-13');
    expect(plain(costSentence(paid, 'en'))).toBe('Paid: €29 a month, price seen on 2026-11-12.');
    expect(costSentence(fixtureResource('docs'), 'en')).toBe('Free.');
    expect(costSentence(fixtureResource('tool', { cost: 'freemium' }), 'de')).toBe('Kostenlos, mit Bezahlteilen.');
  });

  it('says an unverified source without an HTTP status could not be opened', () => {
    const resource = fixtureResource('video', { check: { status: 'unverified', on: '2026-11-13', http: null, note: 'Timed out.' } });
    expect(statusSentence(resource, 'en')).toBe('Could not be opened on 2026-11-13. Open it yourself before relying on it. Timed out.');
    expect(statusLine(resource, 'en')).toBe('not opened on 2026-11-13 · check it yourself');
  });

  it('says a verified source was opened and read', () => {
    expect(statusSentence(fixtureResource('docs'), 'en')).toBe('Opened on 2026-11-13. The page was read and is the source this entry names.');
  });
});

describe('dockHeader', () => {
  it('counts the sources, the day they were opened and the gated ones', () => {
    const resources = fixtureResources().filter((r) => r.type !== 'video').slice(0, 5);
    const entries = resources.map((resource, i) => ({ resource, main: i === 0, for: 'x' }));
    expect(dockHeader(entries, 'en')).toBe('5 sources · opened 2026-11-13 · 1 gated');
    expect(dockHeader(entries, 'de')).toBe('5 Quellen · geöffnet 2026-11-13 · 1 hinter Login');
  });

  it('names one source in the singular, shows a range of days and counts unverified ones', () => {
    const one = [{ resource: fixtureResource('docs'), main: true, for: 'x' }];
    expect(dockHeader(one, 'en')).toBe('1 source · opened 2026-11-13');
    const two = [
      { resource: fixtureResource('docs', { check: { status: 'verified', on: '2026-11-02', http: 200 } }), main: true, for: 'x' },
      { resource: fixtureResource('video', { check: { status: 'unverified', on: '2026-11-13', http: 429, note: 'Rate limited.' } }), main: false, for: 'x' },
    ];
    expect(dockHeader(two, 'en')).toBe('2 sources · opened 2026-11-02 to 2026-11-13 · 1 unverified');
    expect(dockHeader([], 'en')).toBe('No sources for this step.');
  });
});

describe('links', () => {
  it('lets only absolute http and https addresses become links', () => {
    expect(safeHref('https://doc.rust-lang.org/book/')).toBe('https://doc.rust-lang.org/book/');
    expect(safeHref(' http://example.org/a ')).toBe('http://example.org/a');
    for (const bad of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,<b>x</b>', 'vbscript:x', '/relative', 'example.org', 'https://exa mple.org', '', undefined]) {
      expect(safeHref(bad)).toBeNull();
    }
  });

  it('pins a volume with its title, why and address, and never a javascript: address', () => {
    const roadmap = fixtureRoadmap();
    const [entry] = resourcesFor(roadmap, 'fixture-step-1');
    const place = placeOf(entry!, roadmap);
    expect(place).toEqual({ stageId: 'fixture-stage', waypointId: 'fixture-step-1' });
    const pin = pinFor(entry!, place!.stageId, place!.waypointId);
    expect(pin).toEqual({
      kind: 'link',
      resourceId: 'fixture-docs',
      text: `Fixture docs: ${entry!.resource.why}`,
      url: 'https://example.org/docs',
      stageId: 'fixture-stage',
      waypointId: 'fixture-step-1',
    });
    const bad = pinFor({ resource: fixtureResource('docs', { url: 'javascript:alert(1)', why: 'x'.repeat(600) }), main: true, for: 'w' }, 's');
    expect(bad.url).toBeUndefined();
    expect(bad.text.length).toBeLessThanOrEqual(500);
  });

  it('places a project volume at its stage without a waypoint', () => {
    const roadmap = sampleRoadmap();
    const stage = roadmap.stages.find((s) => (s.project?.resources?.length ?? 0) > 0)!;
    const entry = resourcesFor(roadmap, stage.id).find((e) => e.for === 'project')!;
    expect(placeOf(entry, roadmap)).toEqual({ stageId: stage.id });
  });
});
