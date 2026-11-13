/**
 * A calendar file (iCalendar, RFC 5545) with a learner's dates: the next review of every finished step, the
 * class sessions, the goal date and the planned arrival. All-day events only, because a roadmap stores days and
 * no times, so nothing depends on a time zone.
 */
import { uiLang, type UiLang } from '../i18n';
import type { Session } from '../learn/session';
import { addDays, daysBetween } from '../roadmap/dates';
import type { Progress } from '../roadmap/progress';
import type { Roadmap } from '../roadmap/types';
import { say } from './strings';

export interface IcsEvent {
  /** Stable across exports, so a calendar that imports the file twice updates instead of doubling. */
  readonly uid: string;
  /** YYYY-MM-DD. */
  readonly day: string;
  readonly summary: string;
  readonly description?: string;
}

export interface IcsDates {
  readonly today: string;
  readonly deadline?: string | null;
  /** The planned arrival; left out when the route is already walked. */
  readonly arrival?: string | null;
  readonly ui?: UiLang;
}

/** The events of one learner: next reviews (an overdue one is moved to today), sessions, goal date, arrival. */
export function icsEvents(roadmap: Roadmap, progress: Progress, dates: IcsDates): IcsEvent[] {
  const ui = dates.ui ?? uiLang();
  const events: IcsEvent[] = [];
  for (const stage of roadmap.stages) {
    for (const w of stage.waypoints) {
      const due = progress.waypoints[w.id]?.due;
      if (typeof due !== 'string') continue;
      const day = daysBetween(dates.today, due) < 0 ? dates.today : due;
      events.push({ uid: `${roadmap.id}.review.${w.id}`, day, summary: say('icsReview', { title: w.title }, ui), description: say('icsReviewDesc', undefined, ui) });
    }
  }
  for (const s of roadmap.class?.sessions ?? []) {
    if (!s.date) continue;
    const parts = [s.opener, s.exit].filter((p): p is string => typeof p === 'string');
    events.push({
      uid: `${roadmap.id}.session.${s.n}`,
      day: s.date,
      summary: say('icsSession', { n: s.n, title: s.title }, ui),
      ...(parts.length > 0 ? { description: parts.join('\n') } : {}),
    });
  }
  if (dates.deadline) events.push({ uid: `${roadmap.id}.deadline`, day: dates.deadline, summary: say('icsDeadline', { title: roadmap.title }, ui) });
  if (dates.arrival) {
    events.push({ uid: `${roadmap.id}.arrival`, day: dates.arrival, summary: say('icsArrival', { title: roadmap.title }, ui), description: say('icsArrivalDesc', undefined, ui) });
  }
  return events.sort((a, b) => daysBetween(b.day, a.day) || a.uid.localeCompare(b.uid));
}

/** Text escaping of RFC 5545 section 3.3.11. */
export function icsText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

const encoder = new TextEncoder();

/** Folds a content line at 75 octets without splitting a character (RFC 5545 section 3.1). */
export function foldLine(line: string): string {
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let size = 0;
  let limit = 75;
  for (const char of line) {
    const n = encoder.encode(char).length;
    if (size + n > limit) {
      parts.push(current);
      current = '';
      size = 0;
      limit = 74; // the leading space of a continuation line counts
    }
    current += char;
    size += n;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

const compact = (day: string): string => day.replace(/-/g, '');

/** The events as an iCalendar file with CRLF line ends. `now` is the ISO time written as DTSTAMP. */
export function toIcs(events: readonly IcsEvent[], calendar: { readonly name: string; readonly now: string }): string {
  const stamp = `${calendar.now.slice(0, 19).replace(/[-:]/g, '')}Z`;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//zero-to//learning roadmap//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${icsText(calendar.name)}`];
  for (const event of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${icsText(event.uid)}@zero-to`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(event.day)}`,
      `DTEND;VALUE=DATE:${compact(addDays(event.day, 1))}`,
      `SUMMARY:${icsText(event.summary)}`,
      ...(event.description ? [`DESCRIPTION:${icsText(event.description)}`] : []),
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

/** The calendar file of a session: reviews, sessions, the goal date and the planned arrival. */
export function calendarIcs(session: Session, options: { readonly ui?: UiLang } = {}): string {
  const today = session.today();
  const pace = session.pace(today);
  const events = icsEvents(session.roadmap, session.progress, {
    today,
    deadline: pace.deadline,
    arrival: pace.remainingMinutes > 0 ? pace.arrival : null,
    ...(options.ui ? { ui: options.ui } : {}),
  });
  return toIcs(events, { name: session.roadmap.title, now: session.now() });
}
