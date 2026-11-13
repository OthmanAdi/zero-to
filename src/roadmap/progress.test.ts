import { describe, expect, it } from 'vitest';
import {
  checkKey,
  checkpointPassed,
  emptyProgress,
  loadProgressOrEmpty,
  markDone,
  markNotDone,
  parseProgress,
  PROGRESS_VERSION,
  recordAnswer,
  recordReview,
  serialiseProgress,
  setEntry,
  setNote,
  setRating,
  setRung,
  setShow,
  summarise,
  youAreHere,
  type Progress,
} from './progress';
import { draft, sampleRoadmap } from './testing';
import type { Roadmap } from './types';

const roadmap = sampleRoadmap();
const T = '2026-11-20T09:00:00.000Z';

function finish(progress: Progress, r: Roadmap, ids: readonly string[]): Progress {
  return ids.reduce((p, id) => markDone(p, r, id, T), progress);
}

describe('emptyProgress', () => {
  it('is versioned, empty and tied to a roadmap', () => {
    const p = emptyProgress('abc', '2026-11-13');
    expect(p).toEqual({
      version: PROGRESS_VERSION,
      roadmap: 'abc',
      checkedOn: '2026-11-13',
      entry: null,
      startedAt: null,
      updatedAt: null,
      waypoints: {},
      shows: {},
      rungs: {},
      notes: {},
      answers: {},
    });
  });
});

describe('updates', () => {
  it('marks a waypoint done and schedules the first review when it has checks', () => {
    const p = markDone(emptyProgress(roadmap.id), roadmap, 'moves', T);
    expect(p.waypoints.moves).toEqual({ done: true, doneOn: '2026-11-20', due: '2026-11-22', reviews: [] });
    expect(p.startedAt).toBe(T);
    expect(p.updatedAt).toBe(T);
  });

  it('schedules nothing for a waypoint without checks', () => {
    const p = markDone(emptyProgress(roadmap.id), roadmap, 'toolchain', T);
    expect(p.waypoints.toolchain?.due).toBeNull();
  });

  it('does not change the old object and ignores unknown ids and repeats', () => {
    const start = emptyProgress(roadmap.id);
    const once = markDone(start, roadmap, 'moves', T);
    expect(start.waypoints).toEqual({});
    expect(markDone(start, roadmap, 'unknown', T)).toBe(start);
    expect(markDone(once, roadmap, 'moves', '2026-12-01T00:00:00Z')).toBe(once);
  });

  it('undoes a waypoint but keeps rating and note', () => {
    let p = markDone(emptyProgress(roadmap.id), roadmap, 'moves', T);
    p = setRating(p, 'moves', 3, T);
    p = setNote(p, 'moves', 'ownership = one owner', T);
    p = markNotDone(p, 'moves', T);
    expect(p.waypoints.moves).toEqual({ done: false, rating: 3, reviews: [] });
    expect(p.notes.moves).toBe('ownership = one owner');
    expect(markNotDone(p, 'moves', T)).toBe(p);
  });

  it('sets and clears a rating, and halves the first review gaps for a low one', () => {
    let p = setRating(emptyProgress(roadmap.id), 'moves', 1, T);
    expect(p.waypoints.moves?.rating).toBe(1);
    p = markDone(p, roadmap, 'moves', T);
    expect(p.waypoints.moves?.due).toBe('2026-11-21');
    p = setRating(p, 'moves', null, T);
    expect(p.waypoints.moves?.rating).toBeUndefined();
  });

  it('stores notes and removes blank ones', () => {
    let p = setNote(emptyProgress(roadmap.id), 'moves', 'hello', T);
    expect(p.notes).toEqual({ moves: 'hello' });
    p = setNote(p, 'moves', '   ', T);
    expect(p.notes).toEqual({});
  });

  it('records check answers under a key', () => {
    expect(checkKey('waypoint', 'moves', 0)).toBe('w:moves:0');
    expect(checkKey('checkpoint', 'ownership', 2)).toBe('s:ownership:2');
    const p = recordAnswer(emptyProgress(roadmap.id), 'w:guessing-game:0', { choice: 1, correct: true }, T);
    expect(p.answers['w:guessing-game:0']).toEqual({ at: T, choice: 1, correct: true });
  });

  it('ticks checkpoint items, growing the row as needed', () => {
    let p = setShow(emptyProgress(roadmap.id), 'ownership', 1, true, T);
    expect(p.shows.ownership).toEqual([false, true]);
    p = setShow(p, 'ownership', 0, true, T);
    p = setShow(p, 'ownership', 1, false, T);
    expect(p.shows.ownership).toEqual([true, false]);
    expect(setShow(p, 'ownership', -1, true, T)).toBe(p);
    expect(setShow(p, 'ownership', 99, true, T)).toBe(p);
  });

  it('counts project rungs within 0 to 3', () => {
    let p = setRung(emptyProgress(roadmap.id), 'ownership', 2, T);
    expect(p.rungs).toEqual({ ownership: 2 });
    expect(setRung(p, 'ownership', 4, T)).toBe(p);
    p = setEntry(p, 'shaping-data', T);
    expect(p.entry).toBe('shaping-data');
    expect(setEntry(p, null, T).entry).toBeNull();
  });
});

describe('recordReview', () => {
  it('walks up the series on hits and ends it with null', () => {
    let p = markDone(emptyProgress(roadmap.id), roadmap, 'moves', '2026-11-20T09:00:00Z');
    p = recordReview(p, roadmap, 'moves', true, '2026-11-22T09:00:00Z');
    expect(p.waypoints.moves?.due).toBe('2026-11-29'); // +7
    p = recordReview(p, roadmap, 'moves', true, '2026-11-29T09:00:00Z');
    expect(p.waypoints.moves?.due).toBe('2026-12-20'); // +21
    p = recordReview(p, roadmap, 'moves', true, '2026-12-20T09:00:00Z');
    expect(p.waypoints.moves?.due).toBe('2027-02-18'); // +60
    p = recordReview(p, roadmap, 'moves', true, '2027-02-18T09:00:00Z');
    expect(p.waypoints.moves?.due).toBeNull();
    expect(p.waypoints.moves?.reviews).toHaveLength(4);
  });

  it('restarts the series after a miss', () => {
    let p = markDone(emptyProgress(roadmap.id), roadmap, 'moves', '2026-11-20T09:00:00Z');
    p = recordReview(p, roadmap, 'moves', true, '2026-11-22T09:00:00Z');
    p = recordReview(p, roadmap, 'moves', false, '2026-11-29T09:00:00Z');
    expect(p.waypoints.moves?.due).toBe('2026-12-01'); // back to +2
    p = recordReview(p, roadmap, 'moves', true, '2026-12-01T09:00:00Z');
    expect(p.waypoints.moves?.due).toBe('2026-12-08'); // +7 again
    expect(p.waypoints.moves?.reviews.map((r) => r.ok)).toEqual([true, false, true]);
  });

  it('ignores a review for something not finished or unknown', () => {
    const p = emptyProgress(roadmap.id);
    expect(recordReview(p, roadmap, 'moves', true, T)).toBe(p);
    expect(recordReview(p, roadmap, 'nope', true, T)).toBe(p);
  });
});

describe('youAreHere', () => {
  it('starts at the first waypoint', () => {
    expect(youAreHere(roadmap, emptyProgress(roadmap.id))).toEqual({ stageId: 'first-binary', waypointId: 'toolchain' });
  });

  it('follows the route and skips side trails', () => {
    let p = finish(emptyProgress(roadmap.id), roadmap, ['toolchain', 'guessing-game']);
    expect(youAreHere(roadmap, p)).toEqual({ stageId: 'first-binary', waypointId: 'first-drills' });
    p = finish(p, roadmap, ['first-drills', 'moves', 'borrowing']);
    // borrowing-examples is optional, so the walker goes on to the drills.
    expect(youAreHere(roadmap, p)).toEqual({ stageId: 'ownership', waypointId: 'ownership-drills' });
    p = finish(p, roadmap, ['ownership-drills']);
    expect(youAreHere(roadmap, p)).toEqual({ stageId: 'shaping-data', waypointId: 'structs' });
  });

  it('puts the walker at the red pin and treats earlier stages as known', () => {
    const pinned = setEntry(emptyProgress(roadmap.id), 'collections-traits', T);
    expect(youAreHere(roadmap, pinned)).toEqual({ stageId: 'collections-traits', waypointId: 'collections' });
  });

  it('uses the roadmap entry when the learner has not moved the pin', () => {
    const r = draft();
    r.brief.entry = 'ownership';
    expect(youAreHere(r as Roadmap, emptyProgress(r.id))).toEqual({ stageId: 'ownership', waypointId: 'moves' });
  });

  it('waits for explicit requirements', () => {
    const r = draft();
    r.stages[1].waypoints[3].requires = ['moves']; // drills only need moves
    const p = finish(emptyProgress(r.id), r as Roadmap, ['toolchain', 'guessing-game', 'first-drills', 'moves']);
    expect(youAreHere(r as Roadmap, p)).toEqual({ stageId: 'ownership', waypointId: 'borrowing' });
  });

  it('is null once the route is finished', () => {
    const ids = roadmap.stages.flatMap((s) => s.waypoints.filter((w) => !w.optional).map((w) => w.id));
    expect(youAreHere(roadmap, finish(emptyProgress(roadmap.id), roadmap, ids))).toBeNull();
  });

  it('keeps a stage closed until the stages it requires are finished', () => {
    const r = draft();
    r.stages[2].requires = ['first-binary']; // stage 3 only needs stage 1
    const p = finish(emptyProgress(r.id), r as Roadmap, ['toolchain', 'guessing-game', 'first-drills']);
    // Both stage 2 and stage 3 are open, and stage 2 comes first on the route.
    expect(youAreHere(r as Roadmap, p)).toEqual({ stageId: 'ownership', waypointId: 'moves' });
  });
});

describe('checkpointPassed and summarise', () => {
  it('needs the checkpoint share of show items, 0.8 by default', () => {
    let p = emptyProgress(roadmap.id);
    expect(checkpointPassed(roadmap, p, 'ownership')).toBe(false);
    p = setShow(p, 'ownership', 0, true, T);
    expect(checkpointPassed(roadmap, p, 'ownership')).toBe(false); // 1 of 2, needs ceil(1.6) = 2
    p = setShow(p, 'ownership', 1, true, T);
    expect(checkpointPassed(roadmap, p, 'ownership')).toBe(true);
    // Types camp passes at 0.66 of 3 items: two are enough.
    p = setShow(setShow(p, 'shaping-data', 0, true, T), 'shaping-data', 2, true, T);
    expect(checkpointPassed(roadmap, p, 'shaping-data')).toBe(true);
    expect(checkpointPassed(roadmap, p, 'unknown')).toBe(false);
  });

  it('summarises finished minutes and complete stages', () => {
    const p = finish(emptyProgress(roadmap.id), roadmap, ['toolchain', 'guessing-game', 'first-drills']);
    const summary = summarise(roadmap, p);
    expect(summary.doneWaypoints).toBe(3);
    expect(summary.doneMinutes).toBe(315);
    expect(summary.totalMinutes).toBe(2505);
    expect(summary.share).toBeCloseTo(315 / 2505, 9);
    expect(summary.stagesComplete).toEqual(['first-binary']);
  });
});

describe('serialise and parse', () => {
  it('round-trips a busy progress', () => {
    let p = emptyProgress(roadmap.id, roadmap.checkedOn);
    p = finish(p, roadmap, ['toolchain', 'moves']);
    p = setRating(p, 'moves', 4, T);
    p = setNote(p, 'moves', 'ä ö ü "quotes"', T);
    p = setShow(p, 'first-binary', 0, true, T);
    p = setRung(p, 'first-binary', 1, T);
    p = recordAnswer(p, 'w:moves:0', { text: 'copied', correct: true }, T);
    p = recordReview(p, roadmap, 'moves', true, '2026-11-22T10:00:00Z');
    p = setEntry(p, 'ownership', T);
    const text = serialiseProgress(p);
    const back = parseProgress(text, roadmap.id);
    expect(back).toEqual({ ok: true, progress: p, dropped: 0 });
  });

  it('refuses text that is not JSON or not a progress object', () => {
    for (const text of ['', 'not json', '{', 'null', '[]', '42', '"x"']) {
      const result = parseProgress(text);
      expect(result.ok).toBe(false);
    }
  });

  it('refuses a missing, unsupported or newer version', () => {
    expect(parseProgress(JSON.stringify({ roadmap: 'a' }))).toMatchObject({ ok: false });
    expect(parseProgress(JSON.stringify({ version: 0, roadmap: 'a' }))).toMatchObject({ ok: false });
    const newer = parseProgress(JSON.stringify({ version: 2, roadmap: 'a' }));
    expect(newer.ok).toBe(false);
    if (!newer.ok) expect(newer.reason).toContain('newer version');
  });

  it('refuses progress that belongs to another roadmap or names none', () => {
    const other = parseProgress(serialiseProgress(emptyProgress('other')), 'rust');
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.reason).toContain('"other"');
    expect(parseProgress(JSON.stringify({ version: 1, roadmap: '' })).ok).toBe(false);
    expect(parseProgress(JSON.stringify({ version: 1 })).ok).toBe(false);
    expect(parseProgress(serialiseProgress(emptyProgress('a'))).ok).toBe(true);
  });

  it('keeps what is good and counts what it drops', () => {
    const text = JSON.stringify({
      version: 1,
      roadmap: 'rust',
      checkedOn: 'yesterday',
      waypoints: {
        ok: { done: true, doneOn: '2026-11-20', rating: 3, reviews: [{ on: '2026-11-22', ok: true }, { on: 'x', ok: true }, 5], due: '2026-11-29' },
        weird: { done: 'yes', doneOn: 'soon', rating: 9, due: 7 },
        broken: 'text',
      },
      shows: { a: [true, false], b: 'x', c: [1, 2] },
      rungs: { a: 2, b: 99, c: 'x' },
      notes: { a: 'fine', b: 5 },
      answers: { good: { at: T, choice: 1, correct: false }, bad: { choice: 1 } },
      entry: 7,
    });
    const result = parseProgress(text, 'rust');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const p = result.progress;
    expect(p.checkedOn).toBeNull();
    expect(p.entry).toBeNull();
    expect(p.waypoints.ok).toEqual({ done: true, doneOn: '2026-11-20', rating: 3, reviews: [{ on: '2026-11-22', ok: true }], due: '2026-11-29' });
    expect(p.waypoints.weird).toEqual({ done: false, reviews: [] });
    expect(p.waypoints.broken).toBeUndefined();
    expect(p.shows).toEqual({ a: [true, false] });
    expect(p.rungs).toEqual({ a: 2 });
    expect(p.notes).toEqual({ a: 'fine' });
    expect(Object.keys(p.answers)).toEqual(['good']);
    expect(result.dropped).toBe(12);
  });

  it('does not let a __proto__ key poison anything', () => {
    const text = '{"version":1,"roadmap":"r","waypoints":{"__proto__":{"done":true,"reviews":[]},"x":{"done":true,"reviews":[]}},"notes":{"__proto__":"x"}}';
    const result = parseProgress(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.progress.waypoints)).toEqual(['x']);
    expect(({} as Record<string, unknown>).done).toBeUndefined();
    expect(Object.getPrototypeOf(result.progress.waypoints)).toBe(Object.prototype);
  });

  it('falls back to a fresh progress when stored text is unusable', () => {
    expect(loadProgressOrEmpty(null, 'r')).toEqual(emptyProgress('r'));
    expect(loadProgressOrEmpty('garbage', 'r', '2026-11-13')).toEqual(emptyProgress('r', '2026-11-13'));
    expect(loadProgressOrEmpty(serialiseProgress(emptyProgress('other')), 'r')).toEqual(emptyProgress('r'));
    const kept = setNote(emptyProgress('r'), 'x', 'hi', T);
    expect(loadProgressOrEmpty(serialiseProgress(kept), 'r')).toEqual(kept);
  });
});
