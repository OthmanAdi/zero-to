import { describe, expect, it } from 'vitest';
import { deriveTrek } from '../roadmap/derive';
import music from '../roadmap/samples/music-theory-for-a-class.json';
import type { ClassSession, Roadmap } from '../roadmap/types';
import { classPlace, latestSession } from './class-flag';

/** A session that a test may still change. */
type DraftSession = { -readonly [K in keyof ClassSession]: ClassSession[K] extends readonly string[] | undefined ? string[] : ClassSession[K] };

/**
 * The gallery roadmap for a class with a date on each of its sessions: Monday and Thursday from 12 October 2026.
 * `change` may alter the sessions before the roadmap is used.
 */
function dated(change?: (sessions: DraftSession[]) => void): Roadmap {
  const copy = structuredClone(music) as unknown as { class: { sessions: DraftSession[] } };
  let day = Date.UTC(2026, 9, 12);
  copy.class.sessions.forEach((session, index) => {
    session.date = new Date(day).toISOString().slice(0, 10);
    day += (index % 2 === 0 ? 3 : 4) * 86_400_000;
  });
  change?.(copy.class.sessions);
  return copy as unknown as Roadmap;
}

const stepEnd = (roadmap: Roadmap, id: string): number => {
  const trek = deriveTrek(roadmap);
  const minutes = roadmap.stages.flatMap((stage) => stage.waypoints).find((waypoint) => waypoint.id === id)!.minutes;
  return trek.waypoints.find((waypoint) => waypoint.id === id)!.along + minutes / 2 / trek.totalMinutes;
};

describe('the class flag', () => {
  it('has no place while no session carries a date', () => {
    // The gallery class is dated, so the undated case is the gallery roadmap with its dates taken out.
    const undated = structuredClone(music) as unknown as { class: { sessions: { date?: string }[] } };
    for (const session of undated.class.sessions) delete session.date;
    const roadmap = undated as unknown as Roadmap;
    expect(roadmap.class!.sessions!.length).toBeGreaterThan(0);
    expect(roadmap.class!.sessions!.every((session) => session.date === undefined)).toBe(true);
    const trek = deriveTrek(roadmap);
    for (const day of ['2026-11-13', '2027-01-11', '2027-02-10', '2030-01-01']) {
      expect(latestSession(roadmap, day)).toBeNull();
      expect(classPlace(roadmap, trek, day)).toBeNull();
    }
  });

  it('has no place before the first dated session, and none in a roadmap without a class', () => {
    const roadmap = dated();
    const trek = deriveTrek(roadmap);
    expect(classPlace(roadmap, trek, '2026-10-11')).toBeNull();
    const alone = { ...roadmap, class: undefined } as unknown as Roadmap;
    expect(classPlace(alone, trek, '2026-11-13')).toBeNull();
  });

  it('stands at the end of the step the latest session dated today or earlier did in class', () => {
    const roadmap = dated();
    const trek = deriveTrek(roadmap);
    // On the day of a session the class has done it.
    const first = classPlace(roadmap, trek, '2026-10-12')!;
    expect(first.session.n).toBe(1);
    expect(first.waypointId).toBe('pulse');
    expect(first.along).toBeCloseTo(stepEnd(roadmap, 'pulse'), 12);
    // Session 10 was on 12 November, session 11 is on the 16th.
    const tenth = classPlace(roadmap, trek, '2026-11-13')!;
    expect(tenth.session.n).toBe(10);
    expect(tenth.waypointId).toBe('minor-scale');
    expect(tenth.along).toBeCloseTo(stepEnd(roadmap, 'minor-scale'), 12);
    expect(classPlace(roadmap, trek, '2026-11-15')!.session.n).toBe(10);
    expect(classPlace(roadmap, trek, '2026-11-16')!.session.n).toBe(11);
  });

  it('moves on with the date and never back, and stays at the last session once the course is over', () => {
    const roadmap = dated();
    const trek = deriveTrek(roadmap);
    let before = 0;
    for (let day = Date.UTC(2026, 9, 12); day <= Date.UTC(2026, 11, 20); day += 86_400_000) {
      const place = classPlace(roadmap, trek, new Date(day).toISOString().slice(0, 10))!;
      expect(place.along).toBeGreaterThanOrEqual(before);
      expect(place.along).toBeGreaterThan(0);
      expect(place.along).toBeLessThanOrEqual(1);
      before = place.along;
    }
    const last = roadmap.class!.sessions!.at(-1)!;
    expect(classPlace(roadmap, trek, '2027-06-01')!.session.n).toBe(last.n);
  });

  it('takes the later of two sessions on one day, and the furthest step of a session with several', () => {
    const roadmap = dated((sessions) => {
      sessions[1]!.date = sessions[0]!.date;
      sessions[1]!.inClass = ['note-values', 'pulse', 'bars-meter'];
    });
    const trek = deriveTrek(roadmap);
    const place = classPlace(roadmap, trek, '2026-10-12')!;
    expect(place.session.n).toBe(2);
    expect(place.waypointId).toBe('bars-meter');
    expect(place.along).toBeCloseTo(stepEnd(roadmap, 'bars-meter'), 12);
  });

  it('skips a session whose date is not a day, a step that is not in the roadmap and a day that is not one', () => {
    const roadmap = dated((sessions) => {
      sessions[3]!.date = 'next week';
      sessions[2]!.inClass = ['no-such-step'];
    });
    const trek = deriveTrek(roadmap);
    // Session 4 has no usable date, so on its day session 3 is the latest, and it names no step of this roadmap.
    expect(latestSession(roadmap, '2026-10-22')!.n).toBe(3);
    expect(classPlace(roadmap, trek, '2026-10-22')).toBeNull();
    expect(classPlace(roadmap, trek, 'today')).toBeNull();
  });
});
