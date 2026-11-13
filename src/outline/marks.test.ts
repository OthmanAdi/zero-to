import { describe, expect, it } from 'vitest';
import { classPlace } from '../learn/class-flag';
import { deriveTrek } from '../roadmap/derive';
import { emptyProgress } from '../roadmap/progress';
import type { Roadmap } from '../roadmap/types';
import { marksFor } from './marks';
import { profileGeometry, profileSvg } from './profile';
import { mutable, parseFragment, sample } from './testing';

/** The gallery roadmap for a class with a date on each session: Monday and Thursday from 12 October 2026. */
function datedClass(): Roadmap {
  const copy = mutable('music-theory-for-a-class');
  let day = Date.UTC(2026, 9, 12);
  copy.class.sessions.forEach((session: { date?: string }, index: number) => {
    session.date = new Date(day).toISOString().slice(0, 10);
    day += (index % 2 === 0 ? 3 : 4) * 86_400_000;
  });
  return copy as Roadmap;
}

const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

describe('the class flag of the profile', () => {
  it('stands where the class flag of the strip and the walk stands, every day of the course and after it', () => {
    const roadmap = datedClass();
    const trek = deriveTrek(roadmap);
    const progress = emptyProgress(roadmap.id);
    let seen = 0;
    for (let day = Date.UTC(2026, 9, 5); day <= Date.UTC(2027, 0, 10); day += 86_400_000) {
      const today = dayOf(day);
      const place = classPlace(roadmap, trek, today);
      const marks = marksFor(roadmap, trek, progress, { today });
      expect(marks.classAt, today).toBe(place ? place.along : null);
      if (place) seen += 1;
    }
    // Before 12 October there is no flag, from then on there always is one.
    expect(seen).toBe(91);
  });

  it('has no flag for a class whose sessions carry no date, and none for a roadmap without a class', () => {
    const undated = mutable('music-theory-for-a-class');
    for (const session of undated.class.sessions) delete session.date;
    for (const roadmap of [undated as Roadmap, sample('rust-for-a-python-dev')]) {
      const trek = deriveTrek(roadmap);
      for (const today of ['2026-11-13', '2027-02-10', '2030-01-01']) {
        expect(marksFor(roadmap, trek, emptyProgress(roadmap.id), { today }).classAt, `${roadmap.id} on ${today}`).toBeNull();
      }
    }
  });

  it('is drawn on the route at the end of the last step the class did', () => {
    const roadmap = datedClass();
    const trek = deriveTrek(roadmap);
    const marks = marksFor(roadmap, trek, emptyProgress(roadmap.id), { today: '2026-11-13' });
    const place = classPlace(roadmap, trek, '2026-11-13')!;
    expect(place.waypointId).toBe('minor-scale');
    const flag = parseFragment(profileSvg(trek, marks, { ui: 'en' })).querySelector('[data-zo-mark="class"]');
    const [x, y] = (flag?.getAttribute('transform') ?? '').match(/-?[\d.]+/g)!.map(Number);
    const g = profileGeometry(trek);
    expect(x).toBeCloseTo(g.x(place.along), 1);
    expect(y).toBeCloseTo(g.yAt(g.x(place.along)), 1);
  });
});
