import { describe, expect, it } from 'vitest';
import { memoryStorage, type StorageLike } from '../learn/storage';
import photography from '../roadmap/samples/photography-basics.json';
import rust from '../roadmap/samples/rust-for-a-python-dev.json';
import statistics from '../roadmap/samples/statistics-for-data-work.json';
import type { Roadmap } from '../roadmap/types';
import { LIBRARY_KEY, LIBRARY_MAX, createLibrary, parseLibrary, serialiseLibrary, tableEntries } from './library';
import { createBuildQueue } from './queue';

const samples = [photography, rust, statistics] as unknown as Roadmap[];
const own = (id: string, title = `Roadmap ${id}`): Roadmap => ({ ...(photography as unknown as Roadmap), id, title });

describe('the library of opened roadmaps', () => {
  it('keeps what was opened, newest first, across page loads', () => {
    const storage = memoryStorage();
    const library = createLibrary(storage);
    expect(library.list()).toEqual([]);
    expect(library.add(own('first'), '2026-11-12T10:00:00.000Z')).toBe(true);
    expect(library.add(own('second'), '2026-11-13T10:00:00.000Z')).toBe(true);
    expect(library.list().map((entry) => entry.id)).toEqual(['second', 'first']);
    expect(library.has('first')).toBe(true);

    const again = createLibrary(storage);
    expect(again.list().map((entry) => entry.id)).toEqual(['second', 'first']);
    expect(again.list()[0]?.openedAt).toBe('2026-11-13T10:00:00.000Z');
  });

  it('puts a roadmap that is opened again first, once', () => {
    const library = createLibrary(memoryStorage());
    library.add(own('a'));
    library.add(own('b'));
    library.add(own('a', 'A, checked again'));
    expect(library.list().map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(library.list()[0]?.title).toBe('A, checked again');
  });

  it('keeps at most eight roadmaps and lets the oldest go', () => {
    const library = createLibrary(memoryStorage());
    for (let index = 0; index < LIBRARY_MAX + 3; index += 1) library.add(own(`r${index}`));
    expect(library.list()).toHaveLength(LIBRARY_MAX);
    expect(library.list()[0]?.id).toBe(`r${LIBRARY_MAX + 2}`);
    expect(library.has('r0')).toBe(false);
  });

  it('removes a roadmap and clears its key when nothing is left', () => {
    const storage = memoryStorage();
    const library = createLibrary(storage);
    library.add(own('a'));
    library.remove('a');
    expect(library.list()).toEqual([]);
    expect(storage.getItem(LIBRARY_KEY)).toBeNull();
  });

  it('leaves out anything stored that is not a valid roadmap any more', () => {
    const good = { id: 'good', openedAt: '2026-11-13T10:00:00.000Z', roadmap: own('good') };
    const text = JSON.stringify({ version: 1, items: [{ id: 'bad', roadmap: { id: 'bad' } }, good, good, null] });
    expect(parseLibrary(text).map((entry) => entry.id)).toEqual(['good']);
    expect(parseLibrary('not json')).toEqual([]);
    expect(parseLibrary(JSON.stringify({ version: 99, items: [good] }))).toEqual([]);
    expect(parseLibrary(null)).toEqual([]);
    expect(parseLibrary(serialiseLibrary(parseLibrary(text)))).toEqual(parseLibrary(text));
  });

  it('lets go of the oldest roadmaps when the browser has no room', () => {
    const map = new Map<string, string>();
    const tight: StorageLike = {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => {
        if (key === LIBRARY_KEY && value.length > 70_000) throw new Error('QuotaExceededError');
        map.set(key, value);
      },
      removeItem: (key) => void map.delete(key),
    };
    const library = createLibrary(tight);
    for (const id of ['a', 'b', 'c', 'd', 'e']) library.add(own(id));
    const kept = library.list().map((entry) => entry.id);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(5);
    expect(kept[0]).toBe('e');
  });

  it('works for this visit when there is no storage at all', () => {
    const library = createLibrary(null);
    library.add(own('a'));
    expect(library.list().map((entry) => entry.id)).toEqual(['a']);
  });
});

describe('what lies on the table', () => {
  it('is the gallery alone when nothing is open', () => {
    const entries = tableEntries({ kind: 'gallery' }, samples, 5);
    expect(entries.map((entry) => entry.roadmap.id)).toEqual(samples.map((sample) => sample.id));
    expect(entries.every((entry) => entry.example)).toBe(true);
  });

  it('is a given roadmap alone: no examples and nothing opened before beside it', () => {
    const library = createLibrary(memoryStorage());
    library.add(own('older'));
    library.add(own('mine'));
    const entries = tableEntries({ kind: 'given', roadmap: own('mine') }, samples, 5);
    expect(entries.map((entry) => `${entry.roadmap.id}:${entry.example}`)).toEqual(['mine:false']);
  });

  it('is a given roadmap alone also when it carries the id of an example', () => {
    const entries = tableEntries({ kind: 'given', roadmap: samples[1] as Roadmap }, samples, 5);
    expect(entries.map((entry) => `${entry.roadmap.id}:${entry.example}`)).toEqual(['rust-for-a-python-dev:false']);
  });

  it('puts the example a page was opened for first, never shows one twice and never more than the table holds', () => {
    const entries = tableEntries({ kind: 'gallery', first: samples[1] as Roadmap }, samples, 2);
    expect(entries.map((entry) => `${entry.roadmap.id}:${entry.example}`)).toEqual(['rust-for-a-python-dev:false', 'photography-basics:true']);
  });
});

describe('the build queue', () => {
  it('spends at most its budget per frame and carries on in the next', () => {
    let clock = 0;
    let slices = 0;
    const queue = createBuildQueue({ budget: 10, now: () => clock });
    queue.add('panels', () => {
      slices += 1;
      clock += 4;
      return slices >= 10;
    });
    queue.run();
    expect(slices).toBe(3);
    expect(queue.idle).toBe(false);
    queue.run();
    queue.run();
    queue.run();
    expect(slices).toBe(10);
    expect(queue.idle).toBe(true);
  });

  it('runs jobs in the order they were added, one at a time', () => {
    const order: string[] = [];
    const queue = createBuildQueue({ now: () => 0 });
    queue.add('first', () => order.push('first') >= 0);
    queue.add('second', () => order.push('second') >= 0);
    expect(queue.waiting).toEqual(['first', 'second']);
    queue.flush();
    expect(order).toEqual(['first', 'second']);
    expect(queue.waiting).toEqual([]);
  });

  it('always makes progress, even with no budget', () => {
    let done = 0;
    const queue = createBuildQueue({ budget: 0, now: () => 0 });
    queue.add('job', () => {
      done += 1;
      return done >= 3;
    });
    queue.run();
    expect(done).toBe(1);
  });

  it('replaces a waiting job of the same name and can cancel one', () => {
    const ran: string[] = [];
    const queue = createBuildQueue({ now: () => 0 });
    queue.add('walk', () => ran.push('old') >= 0);
    queue.add('walk', () => ran.push('new') >= 0);
    queue.add('other', () => ran.push('other') >= 0);
    expect(queue.cancel('other')).toBe(true);
    expect(queue.cancel('other')).toBe(false);
    queue.flush();
    expect(ran).toEqual(['new']);
  });

  it('drops a job that throws and carries on with the next', () => {
    const failed: string[] = [];
    let ok = false;
    const queue = createBuildQueue({ now: () => 0, onError: (name) => failed.push(name) });
    queue.add('broken', () => {
      throw new Error('no');
    });
    queue.add('fine', () => {
      ok = true;
      return true;
    });
    queue.flush();
    expect(failed).toEqual(['broken']);
    expect(ok).toBe(true);
  });
});
