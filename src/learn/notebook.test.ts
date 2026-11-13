import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetUiLang, setUiLang } from '../i18n';
import type { Roadmap } from '../roadmap/types';
import {
  createNotebook,
  escapeMarkdown,
  NOTEBOOK_MAX_ENTRIES,
  NOTEBOOK_MAX_TEXT,
  notebookKey,
  notebookToMarkdown,
  pinId,
  unescapeMarkdown,
  type NotebookEntry,
} from './notebook';
import { memoryStorage } from './storage';
import { sampleDraft, sampleRoadmap, throwingStorage } from './testing';

const ID = 'rust-for-a-python-dev';
let tick = 0;
const now = () => new Date(Date.UTC(2026, 10, 13, 9, 0, tick++)).toISOString();

beforeEach(() => setUiLang('en', false));
afterEach(() => resetUiLang());

describe('createNotebook', () => {
  it('adds, keeps order, moves and removes, and stores under zero-to:notebook:<id>', () => {
    const storage = memoryStorage();
    const book = createNotebook(storage, ID, { now });
    const a = book.add({ id: pinId('point', 'moves', 0), kind: 'point', text: 'one owner', stageId: 'ownership', waypointId: 'moves' });
    const b = book.add({ kind: 'own', text: 'my own line', stageId: 'ownership' });
    const c = book.add({ id: pinId('task', 'moves'), kind: 'task', text: 'write three lines', stageId: 'ownership', waypointId: 'moves' });
    expect(book.entries.map((e) => e.id)).toEqual([a?.id, b?.id, c?.id]);
    expect(book.move(c?.id ?? '', 0)).toBe(true);
    expect(book.entries[0]?.id).toBe(c?.id);
    expect(book.remove(b?.id ?? '')).toBe(true);
    expect(book.size).toBe(2);

    const raw = JSON.parse(storage.getItem(notebookKey(ID)) ?? '{}');
    expect(raw.roadmap).toBe(ID);
    expect(raw.entries.map((e: NotebookEntry) => e.id)).toEqual([c?.id, a?.id]);
    expect(createNotebook(storage, ID).entries.map((e) => e.id)).toEqual([c?.id, a?.id]);
  });

  it('never pins the same thing twice', () => {
    const book = createNotebook(memoryStorage(), ID, { now });
    const draft = { id: pinId('point', 'moves', 1), kind: 'point' as const, text: 'moved', stageId: 'ownership' };
    const first = book.add(draft);
    expect(book.add(draft)).toBe(first);
    expect(book.size).toBe(1);
    expect(book.has(draft.id)).toBe(true);
  });

  it('holds at most 400 entries of at most 500 characters', () => {
    const book = createNotebook(memoryStorage(), ID, { now });
    const long = book.add({ kind: 'own', text: 'é'.repeat(NOTEBOOK_MAX_TEXT + 20), stageId: 'ownership' });
    expect(Array.from(long?.text ?? '')).toHaveLength(NOTEBOOK_MAX_TEXT);
    for (let i = 1; i < NOTEBOOK_MAX_ENTRIES; i += 1) book.add({ kind: 'own', text: `line ${i}`, stageId: 'ownership' });
    expect(book.size).toBe(NOTEBOOK_MAX_ENTRIES);
    expect(book.full).toBe(true);
    expect(book.add({ kind: 'own', text: 'one too many', stageId: 'ownership' })).toBeNull();
    expect(book.size).toBe(NOTEBOOK_MAX_ENTRIES);
  });

  it('refuses empty text and addresses that are not http or https', () => {
    const book = createNotebook(memoryStorage(), ID, { now });
    expect(book.add({ kind: 'own', text: '   ', stageId: 'ownership' })).toBeNull();
    const link = book.add({ kind: 'link', text: 'bad', url: 'javascript:alert(1)', stageId: 'ownership' });
    expect(link?.url).toBeUndefined();
    const good = book.add({ kind: 'link', text: 'good', url: 'https://doc.rust-lang.org/book/', stageId: 'ownership' });
    expect(good?.url).toBe('https://doc.rust-lang.org/book/');
  });

  it('reads damaged storage as an empty notebook and keeps working when storage throws', () => {
    const storage = memoryStorage();
    storage.setItem(notebookKey(ID), '{"roadmap":"rust-for-a-python-dev","entries":[{"id":1},"x",{"id":"ok","kind":"own","text":"kept","stageId":"s","pinnedAt":"t"}]}');
    expect(createNotebook(storage, ID).entries.map((e) => e.text)).toEqual(['kept']);
    storage.setItem(notebookKey(ID), 'not json');
    expect(createNotebook(storage, ID).size).toBe(0);

    const blocked = createNotebook(throwingStorage(), ID, { now });
    expect(blocked.storage).toEqual({ kind: 'memory', reason: 'refused' });
    expect(blocked.add({ kind: 'own', text: 'in memory', stageId: 's' })).not.toBeNull();
  });
});

describe('Markdown', () => {
  const tricky = {
    stage: 'Pipes | and [brackets] (parens) *stars* _under_ `ticks` #1 <tag> & ~ !',
    waypoint: 'שלום עולם | [סוגריים] (עברית)',
    arabic: 'مرحبا [بالعالم] | *نص*',
    entry: '1. a | b [c](d) <e> & #f \\ back',
  };

  function trickyRoadmap(): Roadmap {
    const draft = sampleDraft();
    draft.title = `Notebook ${tricky.stage}`;
    draft.stages[0].title = tricky.stage;
    draft.stages[0].waypoints[0].title = tricky.waypoint;
    return draft as Roadmap;
  }

  const entry = (over: Partial<NotebookEntry>): NotebookEntry => ({
    id: over.id ?? `own:${Math.random()}`,
    kind: 'own',
    text: 'x',
    stageId: 'first-binary',
    waypointId: 'toolchain',
    pinnedAt: '2026-11-13T09:00:00.000Z',
    ...over,
  });

  it('escapes only so that CommonMark gives the original text back', () => {
    for (const text of Object.values(tricky)) {
      expect(unescapeMarkdown(escapeMarkdown(text))).toBe(text);
    }
    expect(escapeMarkdown('a | b')).toBe('a \\| b');
    expect(escapeMarkdown('two\nlines')).toBe('two lines');
  });

  it('round-trips titles with pipes, brackets and right-to-left text', () => {
    const roadmap = trickyRoadmap();
    const md = notebookToMarkdown(
      [
        entry({ kind: 'point', text: tricky.arabic }),
        entry({ kind: 'own', text: tricky.entry }),
      ],
      roadmap,
      { lang: 'en', today: '2026-11-13' },
    );
    const lines = md.split('\n');
    const title = lines.find((l) => l.startsWith('# '))?.slice('# Field notebook: '.length);
    expect(unescapeMarkdown(title ?? '')).toBe(roadmap.title);
    const stage = lines.find((l) => l.startsWith('## '))?.slice('## Stage 1: '.length);
    expect(unescapeMarkdown(stage ?? '')).toBe(tricky.stage);
    const step = lines.find((l) => l.startsWith('### '))?.slice(4);
    expect(unescapeMarkdown(step ?? '')).toBe(tricky.waypoint);
    const point = lines.find((l) => l.startsWith('- **Key point:** '))?.slice('- **Key point:** '.length);
    expect(unescapeMarkdown(point ?? '')).toBe(tricky.arabic);
    const own = lines.find((l) => l.startsWith('- **My line:** '))?.slice('- **My line:** '.length);
    expect(unescapeMarkdown(own ?? '')).toBe(tricky.entry);
    // No unescaped pipe could start a table, no unescaped bracket a link.
    expect(md).not.toMatch(/(^|[^\\])\|/m);
    expect(md).not.toMatch(/(^|[^\\])\[(?!Install)/m);
  });

  it('keeps the learner order and writes a heading whenever the place changes', () => {
    const roadmap = sampleRoadmap();
    const md = notebookToMarkdown(
      [
        entry({ kind: 'point', text: 'A', waypointId: 'toolchain' }),
        entry({ kind: 'task', text: 'B', stageId: 'ownership', waypointId: 'moves' }),
        entry({ kind: 'own', text: 'C', waypointId: 'toolchain' }),
        entry({ kind: 'link', text: 'Install Rust', url: 'https://rust-lang.org/tools/install/', waypointId: 'toolchain' }),
        entry({ kind: 'answer', text: 'Why?\nBecause.', stageId: 'ownership', waypointId: 'moves' }),
        entry({ kind: 'task', text: 'Camp task', stageId: 'first-binary', waypointId: undefined }),
      ],
      roadmap,
      { lang: 'en', today: '2026-11-13' },
    );
    expect(md).toContain('# Field notebook: Zero to Rust, coming from Python');
    expect(md).toContain('Exported on 13 Nov 2026 from zero-to. 6 entries.');
    const headings = md.split('\n').filter((l) => l.startsWith('#'));
    expect(headings).toEqual([
      '# Field notebook: Zero to Rust, coming from Python',
      '## Stage 1: First binary',
      '### Install and run',
      '## Stage 2: Ownership and borrowing',
      '### Who owns the value',
      '## Stage 1: First binary',
      '### Install and run',
      '## Stage 2: Ownership and borrowing',
      '### Who owns the value',
      '## Stage 1: First binary',
      '### Camp: Build the guided tool',
    ]);
    expect(md).toContain('- **Link:** [Install Rust](<https://rust-lang.org/tools/install/>) The official install page. It installs through rustup, which also brings cargo.');
    expect(md).toContain('- **Question:** Why?\n  **Answer:** Because.');
  });

  it('writes German labels for a German interface', () => {
    const md = notebookToMarkdown([entry({ kind: 'point', text: 'A' })], sampleRoadmap(), { lang: 'de', today: '2026-11-13' });
    expect(md).toContain('# Feldnotizbuch:');
    expect(md).toContain('## Etappe 1: First binary');
    expect(md).toContain('- **Kernpunkt:** A');
  });
});
