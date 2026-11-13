import { describe, expect, it } from 'vitest';
import { createSession } from '../learn/session';
import { memoryStorage } from '../learn/storage';
import { unescapeMarkdown } from '../learn/notebook';
import { emptyProgress, markDone } from '../roadmap/progress';
import { calendarIcs, foldLine, icsEvents, icsText, toIcs } from './ics';
import { roadmapToMarkdown } from './markdown';
import { mutable, sample, samples } from './testing';

describe('roadmapToMarkdown', () => {
  it.each(samples().map((r) => [r.id, r] as const))('%s: title, every stage and step, and links in angle brackets', (_id, roadmap) => {
    const md = roadmapToMarkdown(roadmap, { ui: 'en' });
    expect(md.startsWith(`# ${roadmap.title.replace(/[\\`*_[\]<>|#~&!]/g, (c) => `\\${c}`)}`)).toBe(true);
    for (const stage of roadmap.stages) expect(unescapeMarkdown(md)).toContain(stage.title);
    for (const w of roadmap.stages.flatMap((s) => s.waypoints)) expect(unescapeMarkdown(md)).toContain(w.title);
    const links = [...md.matchAll(/\]\(<([^>]+)>\)/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link).toMatch(/^https?:\/\//);
    expect(md.endsWith('\n')).toBe(true);
  });

  it('escapes pipes and brackets, and never links another scheme', () => {
    const roadmap = mutable('photography-basics');
    roadmap.stages[0].title = 'A | B [c] *d*';
    roadmap.resources[0].url = 'javascript:alert(1)';
    const md = roadmapToMarkdown(roadmap, { ui: 'en' });
    expect(md).toContain('A \\| B \\[c\\] \\*d\\*');
    expect(md).not.toContain('javascript:');
  });

  it('writes teacher notes only when asked', () => {
    const music = sample('music-theory-for-a-class');
    const note = music.stages.flatMap((s) => s.waypoints).find((w) => w.teacherNote)!.teacherNote!;
    expect(unescapeMarkdown(roadmapToMarkdown(music, { ui: 'en' }))).not.toContain(note);
    expect(unescapeMarkdown(roadmapToMarkdown(music, { ui: 'en', teacher: true }))).toContain(note);
  });

  it('writes German labels for a German interface', () => {
    const md = roadmapToMarkdown(sample('deutsch-a1-von-null'), { ui: 'de' });
    expect(md).toContain('Etappe 1 von 8');
    expect(md).toContain('Zeiten sind Schätzungen.');
  });
});

describe('calendar', () => {
  it('escapes text and folds long lines at 75 octets without splitting a character', () => {
    expect(icsText('a;b,c\\d\ne')).toBe('a\\;b\\,c\\\\d\\ne');
    const long = `SUMMARY:${'Überprüfung '.repeat(20)}`;
    const folded = foldLine(long);
    for (const line of folded.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(folded.split('\r\n').map((l, i) => (i === 0 ? l : l.slice(1))).join('')).toBe(long);
  });

  it('lists the next review of finished steps, the class sessions and the dates, as all-day events', () => {
    const music = sample('music-theory-for-a-class');
    const withChecks = music.stages.flatMap((s) => s.waypoints).find((w) => (w.checks?.length ?? 0) > 0)!;
    const progress = markDone(emptyProgress(music.id), music, withChecks.id, '2026-11-20T10:00:00.000Z');
    const events = icsEvents(music, progress, { today: '2026-11-20', deadline: '2027-03-05', arrival: '2027-02-01', ui: 'en' });
    const review = events.find((e) => e.uid.includes('.review.'));
    expect(review?.summary).toContain(withChecks.title);
    expect(review?.day).toBe(progress.waypoints[withChecks.id]!.due);
    const dated = music.class!.sessions!.filter((s) => s.date).length;
    expect(events.filter((e) => e.uid.includes('.session.'))).toHaveLength(dated);
    expect(events.some((e) => e.uid.endsWith('.deadline'))).toBe(true);
    const text = toIcs(events, { name: music.title, now: '2026-11-20T10:00:00.000Z' });
    expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(text).not.toMatch(/[^\r]\n/);
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(events.length);
    expect(text).toMatch(/DTSTART;VALUE=DATE:\d{8}\r\nDTEND;VALUE=DATE:\d{8}/);
    expect(text).toContain('DTSTAMP:20261120T100000Z');
  });

  it('moves an overdue review to today', () => {
    const roadmap = sample('rust-for-a-python-dev');
    const w = roadmap.stages.flatMap((s) => s.waypoints).find((p) => (p.checks?.length ?? 0) > 0)!;
    const progress = markDone(emptyProgress(roadmap.id), roadmap, w.id, '2026-11-01T10:00:00.000Z');
    const [event] = icsEvents(roadmap, progress, { today: '2026-11-30', ui: 'en' });
    expect(event?.day).toBe('2026-11-30');
  });

  it('builds the file of a session', () => {
    const session = createSession(sample('rust-for-a-python-dev'), memoryStorage(), { clock: () => '2026-11-20', saveOnPageHide: false });
    const text = calendarIcs(session, { ui: 'en' });
    expect(text).toContain('X-WR-CALNAME:Zero to Rust\\, coming from Python');
    expect(text).toContain('Planned arrival');
    session.destroy();
  });
});
