import { describe, expect, it } from 'vitest';
import { parseMarkdownLite } from '../bookshelf/reader';
import { missingKeys } from '../i18n';
import { resourcesFor } from '../roadmap/derive';
import { sampleRoadmap } from '../roadmap/testing';
import { fixtureResource, fixtureRoadmap } from './fixtures';
import { pageText, prose, readerDoc, readerLabels, taskFor } from './page';
import { SHELF_STRINGS } from './strings';

type Block = ReturnType<typeof parseMarkdownLite>[number];

const hasLink = (blocks: Block[]): boolean => JSON.stringify(blocks).includes('"t":"link"');

describe('prose', () => {
  it('keeps inline code and emphasis', () => {
    const blocks = parseMarkdownLite(prose('Run `cargo new hello`, then *read* the output.'));
    expect(blocks).toHaveLength(1);
    expect(JSON.stringify(blocks)).toContain('"t":"code","v":"cargo new hello"');
  });

  it('never lets roadmap text become a link, a heading, a list or a code fence', () => {
    for (const text of [
      'See [this](https://example.org/x) first.',
      '# Not a heading',
      '- not a list',
      '1. not a list either',
      '> not a quote',
      '```',
      '---',
      'two\nlines\n# with a heading inside',
    ]) {
      const blocks = parseMarkdownLite(prose(text));
      expect(blocks, text).toHaveLength(1);
      expect(blocks[0]!.type, text).toBe('paragraph');
      expect(hasLink(blocks), text).toBe(false);
    }
  });
});

describe('the generated reader page', () => {
  const roadmap = fixtureRoadmap();
  const entries = resourcesFor(roadmap, 'fixture-stage');
  const byType = (type: string) => entries.find((entry) => entry.resource.type === type)!;

  it('says what the source is, what it costs, how it was checked and what the step asks', () => {
    const text = pageText(byType('course'), roadmap, 'en');
    expect(text).toContain('## What it is');
    expect(text).toContain('Course · Silver level · in English');
    expect(text).toContain('## What it costs');
    expect(text).toContain('Paid: €29 a month, price seen on 2026-11-12.');
    expect(text).toContain('## How it was checked');
    expect(text).toContain('behind a login or paywall');
    expect(text).toContain('Only the syllabus is public.');
    expect(text).toContain('## Your task at this step');
    expect(text).toContain('### Fixture step 2');
    expect(text).toContain('Run `fixture --check` and read what it prints.');
    expect(text).toContain('About 1 h, 40 min of it hands-on.');
  });

  it('parses into headings and paragraphs only, without a link from the roadmap text', () => {
    const blocks = parseMarkdownLite(pageText(byType('docs'), roadmap, 'en'));
    expect(blocks.every((block) => block.type === 'heading' || block.type === 'paragraph')).toBe(true);
    expect(hasLink(blocks)).toBe(false);
  });

  it('is written in German when the interface is German', () => {
    const text = pageText(byType('docs'), roadmap, 'de');
    expect(text).toContain('## Was sie ist');
    expect(text).toContain('Dokumentation · Stufe Bronze · auf Englisch');
    expect(text).toContain('## Deine Aufgabe bei diesem Schritt');
  });

  it('gives the reader the title, the author, the why as its note, and the address only when it is http or https', () => {
    const doc = readerDoc(byType('docs'), roadmap, 'en');
    expect(doc).toMatchObject({ id: 'fixture-docs', title: 'Fixture docs', url: 'https://example.org/docs', author: 'Fixture author', lang: 'en' });
    expect(doc.note).toBe(byType('docs').resource.why);
    expect(doc.addedAt).toBe('2026-11-13T12:00:00');
    const bad = readerDoc({ resource: fixtureResource('docs', { url: 'javascript:alert(1)' }), main: true, for: 'fixture-step-1' }, roadmap, 'en');
    expect(bad.url).toBe('');
  });

  it('prints the source time, not the time it takes to read this page, and words the check day by status', () => {
    const labels = readerLabels(byType('docs'), 'en');
    expect(labels.minutes?.(1)).toBe('about 45 min');
    expect(labels.saved?.('13 Nov 2026')).toBe('Opened 13 Nov 2026');
    expect(labels.markRead).toBe('Mark as used');
    expect(readerLabels(byType('video'), 'en').saved?.('13 Nov 2026')).toBe('Tried 13 Nov 2026');
    expect(readerLabels(byType('tool'), 'en').minutes?.(3)).toBe('');
  });

  it('finds the camp project for a project volume', () => {
    const sample = sampleRoadmap();
    const stage = sample.stages.find((s) => (s.project?.resources?.length ?? 0) > 0)!;
    const entry = resourcesFor(sample, stage.id).find((e) => e.for === 'project')!;
    const task = taskFor(entry, sample, 'en');
    expect(task?.heading).toBe('Your project at this camp');
    expect(task?.title).toBe(stage.project!.title);
  });
});

describe('strings', () => {
  it('has the same keys and placeholders in English and German', () => {
    expect(missingKeys(SHELF_STRINGS)).toEqual([]);
  });
});
