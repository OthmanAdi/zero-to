import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setUiLang, resetUiLang } from '../i18n';
import { addDays } from '../roadmap/dates';
import type { Roadmap } from '../roadmap/types';
import { createSession, NOTE_MAX, progressKey, type Session, type SessionChange } from './session';
import { needToPass } from './signpost-card';
import { memoryStorage } from './storage';
import { fillingStorage, sampleDraft, sampleRoadmap, throwingStorage } from './testing';

const DAY = '2026-11-16';

function clockAt(start: string) {
  let day = start;
  return {
    clock: () => `${day}T10:00:00.000Z`,
    set: (next: string) => {
      day = next;
    },
  };
}

let open: Session[] = [];
function session(roadmap: Roadmap = sampleRoadmap(), storage: Parameters<typeof createSession>[1] = memoryStorage(), clock = clockAt(DAY).clock) {
  const s = createSession(roadmap, storage, { clock, saveOnPageHide: false });
  open.push(s);
  return s;
}

beforeEach(() => setUiLang('en', false));
afterEach(() => {
  for (const s of open) s.destroy();
  open = [];
  resetUiLang();
});

describe('you are here', () => {
  it('starts at the first step and moves on when a step is marked done', () => {
    const s = session();
    expect(s.here()).toEqual({ stageId: 'first-binary', waypointId: 'toolchain' });
    s.done('toolchain');
    expect(s.here()).toEqual({ stageId: 'first-binary', waypointId: 'guessing-game' });
    s.done('toolchain', false);
    expect(s.here()?.waypointId).toBe('toolchain');
  });

  it('skips side trails and follows the declared requirements', () => {
    const s = session();
    for (const id of ['toolchain', 'guessing-game', 'first-drills', 'moves', 'borrowing']) s.done(id);
    // borrowing-examples is a side trail, so the next step on the route is ownership-drills.
    expect(s.here()?.waypointId).toBe('ownership-drills');
  });

  it('ignores ids the roadmap does not have', () => {
    const s = session();
    const before = s.progress;
    s.done('no-such-step');
    s.rate('no-such-step', 3);
    s.show('no-such-stage', 0, true);
    s.rung('no-such-stage', 1);
    expect(s.progress).toBe(before);
  });
});

describe('saving', () => {
  it('writes every change under zero-to:progress:<id> and reads it back', () => {
    const storage = memoryStorage();
    const a = session(sampleRoadmap(), storage);
    a.done('toolchain');
    a.rate('toolchain', 3);
    expect(storage.getItem(progressKey('rust-for-a-python-dev'))).toContain('"toolchain"');
    const b = session(sampleRoadmap(), storage);
    expect(b.progress.waypoints.toolchain?.done).toBe(true);
    expect(b.progress.waypoints.toolchain?.rating).toBe(3);
    expect(b.storage).toEqual({ kind: 'browser', reason: null });
  });

  it('falls back to memory when the storage throws, and says so', () => {
    const s = session(sampleRoadmap(), throwingStorage());
    expect(s.storage).toEqual({ kind: 'memory', reason: 'refused' });
    s.done('toolchain');
    expect(s.here()?.waypointId).toBe('guessing-game');
    expect(s.pin({ kind: 'own', text: 'still works', stageId: 'first-binary' })).not.toBeNull();
    expect(s.notebook.storage.kind).toBe('memory');
  });

  it('keeps everything in memory when there is no storage at all', () => {
    const s = session(sampleRoadmap(), null);
    expect(s.storage).toEqual({ kind: 'memory', reason: 'none' });
    s.done('toolchain');
    expect(s.progress.waypoints.toolchain?.done).toBe(true);
  });

  it('announces a storage that fills up later, and keeps working in memory', () => {
    const storage = fillingStorage();
    const s = session(sampleRoadmap(), storage);
    const changes: SessionChange[] = [];
    s.subscribe((change) => changes.push(change));
    storage.fill();
    s.done('toolchain');
    expect(s.storage).toEqual({ kind: 'memory', reason: 'full' });
    expect(changes.some((c) => c.type === 'storage')).toBe(true);
    s.done('guessing-game');
    expect(s.progress.waypoints['guessing-game']?.done).toBe(true);
  });

  it('sets unreadable progress aside instead of overwriting it', () => {
    const storage = memoryStorage();
    storage.setItem(progressKey('rust-for-a-python-dev'), '{not json');
    const s = session(sampleRoadmap(), storage);
    expect(s.progress.waypoints).toEqual({});
    expect(storage.getItem(`${progressKey('rust-for-a-python-dev')}:unreadable`)).toBe('{not json');
  });

  it('tells subscribers what changed', () => {
    const s = session();
    const changes: SessionChange[] = [];
    const stop = s.subscribe((change) => changes.push(change));
    s.done('toolchain');
    s.pin({ kind: 'own', text: 'a line', stageId: 'first-binary' });
    stop();
    s.done('guessing-game');
    expect(changes).toEqual([{ type: 'progress', action: 'done', id: 'toolchain' }, { type: 'notebook' }]);
  });
});

describe('checkpoints pass at their share', () => {
  function withCheckpoint(showCount: number, pass: number): Roadmap {
    const draft = sampleDraft();
    draft.stages[0].checkpoint = {
      title: 'Test camp',
      show: Array.from({ length: showCount }, (_, i) => `Item ${i + 1}`),
      pass,
    };
    return draft as Roadmap;
  }

  for (const [count, pass, need] of [
    [2, 1, 2],
    [5, 0.8, 4],
    [4, 0.5, 2],
  ] as const) {
    it(`pass ${pass} with ${count} items needs ${need} ticks, one fewer does not pass`, () => {
      expect(needToPass(count, pass)).toBe(need);
      const s = session(withCheckpoint(count, pass));
      for (let i = 0; i < need - 1; i += 1) s.show('first-binary', i, true);
      expect(s.passed('first-binary')).toBe(false);
      s.show('first-binary', need - 1, true);
      expect(s.passed('first-binary')).toBe(true);
      s.show('first-binary', 0, false);
      expect(s.passed('first-binary')).toBe(false);
    });
  }

  it('uses 0.8 when the checkpoint names no share', () => {
    expect(needToPass(5)).toBe(4);
    expect(needToPass(2)).toBe(2);
  });
});

describe('spaced review', () => {
  it('schedules the first review on the first gap and moves along the series', () => {
    const time = clockAt(DAY);
    const s = session(sampleRoadmap(), memoryStorage(), time.clock);
    s.done('guessing-game');
    const first = addDays(DAY, 2);
    expect(s.progress.waypoints['guessing-game']?.due).toBe(first);
    expect(s.due(addDays(DAY, 1))).toEqual([]);
    expect(s.due(first).map((i) => i.waypointId)).toEqual(['guessing-game']);

    time.set(first);
    s.review('guessing-game', true);
    expect(s.progress.waypoints['guessing-game']?.due).toBe(addDays(first, 7));
  });

  it('brings a missed review back on the first gap', () => {
    const time = clockAt(DAY);
    const s = session(sampleRoadmap(), memoryStorage(), time.clock);
    s.done('guessing-game');
    time.set(addDays(DAY, 2));
    s.review('guessing-game', true);
    const later = addDays(DAY, 9);
    time.set(later);
    s.review('guessing-game', false);
    expect(s.progress.waypoints['guessing-game']?.due).toBe(addDays(later, 2));
    expect(s.due(addDays(later, 2)).map((i) => i.waypointId)).toEqual(['guessing-game']);
  });

  it('brings a shaky step back sooner when it is rated after Done', () => {
    const s = session();
    s.done('guessing-game');
    s.rate('guessing-game', 1);
    expect(s.progress.waypoints['guessing-game']?.due).toBe(addDays(DAY, 1));
    s.rate('guessing-game', 4);
    expect(s.progress.waypoints['guessing-game']?.due).toBe(addDays(DAY, 2));
  });
});

describe('notes, answers, rungs and start', () => {
  it('caps a private note at 2000 characters and removes a blank one', () => {
    const s = session();
    s.note('toolchain', 'x'.repeat(NOTE_MAX + 50));
    expect(s.progress.notes.toolchain).toHaveLength(NOTE_MAX);
    s.note('toolchain', '   ');
    expect(s.progress.notes.toolchain).toBeUndefined();
  });

  it('stores answers and rungs, and clamps rungs to the ladder', () => {
    const s = session();
    s.answer('w:guessing-game:0', { choice: 1, correct: true });
    expect(s.progress.answers['w:guessing-game:0']).toMatchObject({ choice: 1, correct: true });
    s.rung('ownership', 5);
    expect(s.progress.rungs.ownership).toBe(2);
  });

  it('start sets the start day and the hours, and pace uses them', () => {
    const s = session();
    s.start({ on: '2026-12-01', hoursPerWeek: 10 });
    expect(s.progress.startedAt).toBe('2026-12-01T00:00:00.000Z');
    expect(s.plan).toEqual({ startDay: '2026-12-01', hoursPerWeek: 10 });
    const pace = s.pace('2026-11-20');
    expect(pace.startDate).toBe('2026-12-01');
    expect(pace.hoursPerWeek).toBe(10);
  });
});

describe('pace', () => {
  it('fits the sample plan at 5 hours a week', () => {
    const s = session();
    const pace = s.pace(DAY);
    expect(pace.totalMinutes).toBe(2505);
    expect(pace.offer).toBe(false);
    expect(s.choices(DAY).length).toBeGreaterThan(0); // a later date is always possible, the card only shows them on an offer
  });

  it('offers four choices when the arrival runs well past the date, and each one fits better', () => {
    const s = session();
    s.replan({ hoursPerWeek: 2 });
    const pace = s.pace(DAY);
    expect(pace.offer).toBe(true);
    expect(pace.overshoot).toBeGreaterThan(0.15);
    const choices = s.choices(DAY);
    expect(choices.map((c) => c.kind)).toEqual(['hours', 'date', 'summit', 'side-trails']);
    const hours = choices.find((c) => c.kind === 'hours');
    expect(hours?.hoursPerWeek).toBe(3.5);
    expect(choices.find((c) => c.kind === 'summit')?.summit).toBe('silver');
    expect(choices.find((c) => c.kind === 'side-trails')?.savedMinutes).toBe(150);
    for (const choice of choices) expect(choice.arrival <= pace.arrival).toBe(true);

    s.replan(hours?.change ?? null);
    expect(s.pace(DAY).offer).toBe(false);
    s.replan(null);
    expect(s.plan).toEqual({});
  });

  it('counts finished steps out of the remaining time', () => {
    const s = session();
    const before = s.pace(DAY).remainingMinutes;
    s.done('toolchain');
    expect(s.pace(DAY).remainingMinutes).toBe(before - 45);
  });
});
