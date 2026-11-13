import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Roadmaps the specs put on a page as a person's own file. Each one starts as a copy of a gallery roadmap, so
 * every link in it is one the gallery already checked, and gets its own id, title and plan. Statuses, notes and
 * gap lines changed here are test data: they say nothing about the real pages behind the links.
 */

/** The shape the fixtures touch. Everything else is carried over from the gallery file as it is. */
export interface FixtureRoadmap {
  id: string;
  title: string;
  topic: string;
  lang: string;
  checkedOn: string;
  brief: { hoursPerWeek: number; startDate?: string; deadline?: string; [key: string]: unknown };
  stages: { id: string; title: string; waypoints: { id: string; title: string; minutes: number; optional?: boolean; gap?: string }[] }[];
  resources: { id: string; check: { status: string; on: string; http?: number | null; note?: string } }[];
  class?: { sessions: { n: number; date?: string; title: string; inClass: string[] }[] };
  [key: string]: unknown;
}

/** A gallery roadmap, read from disk, as a fresh copy. */
export function sample(id: string): FixtureRoadmap {
  const file = fileURLToPath(new URL(`../../src/roadmap/samples/${id}.json`, import.meta.url));
  return JSON.parse(readFileSync(file, 'utf8')) as FixtureRoadmap;
}

const DAY_MS = 86_400_000;

/** A day moved by a number of days, both as YYYY-MM-DD. */
export function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * A teacher's own copy of the class roadmap, with its sixteen dated sessions moved 13 weeks earlier: two a
 * week, Monday and Thursday, from Monday 12 October 2026. On Friday 13 November 2026 the latest session that
 * has taken place is session 10, held the day before.
 */
export function datedClass(): FixtureRoadmap {
  const roadmap = sample('music-theory-for-a-class');
  const shift = -91;
  roadmap.id = 'music-theory-class-8b';
  roadmap.title = 'Music theory for class 8b';
  roadmap.topic = 'music theory for my class 8b';
  const sessions = roadmap.class?.sessions ?? [];
  for (const session of sessions) {
    if (!session.date) throw new Error(`session ${session.n} of the gallery file has no date to move`);
    session.date = shiftDay(session.date, shift);
  }
  if (roadmap.brief.startDate) roadmap.brief.startDate = shiftDay(roadmap.brief.startDate, shift);
  if (roadmap.brief.deadline) roadmap.brief.deadline = shiftDay(roadmap.brief.deadline, shift);
  return roadmap;
}

/** The latest session dated on or before `today`, by the dates in the file. */
export function latestSession(roadmap: FixtureRoadmap, today: string): { n: number; title: string; inClass: string[] } | null {
  let latest: { n: number; date: string; title: string; inClass: string[] } | null = null;
  for (const session of roadmap.class?.sessions ?? []) {
    if (!session.date || session.date > today) continue;
    if (!latest || session.date >= latest.date) latest = { ...session, date: session.date };
  }
  return latest;
}

/**
 * A self-learner's own Rust roadmap: four hours a week from 2 November 2026 to 28 February 2027, one gated and
 * two unverified sources, and two more gap lines. The title has angle brackets, as a title about code can.
 */
export function ownRust(): FixtureRoadmap {
  const roadmap = sample('rust-for-a-python-dev');
  roadmap.id = 'rust-on-weeknights';
  roadmap.title = 'Rust on weeknights: Vec<T> and friends';
  roadmap.topic = 'Rust for a Python dev, weeknights only';
  roadmap.brief = { ...roadmap.brief, hoursPerWeek: 4, startDate: '2026-11-02', deadline: '2027-02-28' };
  const mark = (id: string, status: string, http: number | null, note: string): void => {
    const resource = roadmap.resources.find((entry) => entry.id === id);
    if (!resource) throw new Error(`no source ${id} in the gallery file`);
    resource.check = { ...resource.check, status, http, note };
  };
  mark('exercism-rust', 'gated', 200, 'Test data: the exercises ask for an account.');
  mark('clap-docs', 'unverified', 403, 'Test data: the page refused the automated client.');
  mark('cli-testing', 'unverified', null, 'Test data: the request timed out twice.');
  const step = (id: string) => {
    const found = roadmap.stages.flatMap((stage) => stage.waypoints).find((waypoint) => waypoint.id === id);
    if (!found) throw new Error(`no step ${id} in the gallery file`);
    return found;
  };
  step('error-drills').gap = 'Test data: the only exercise track found asks for an account.';
  step('lifetimes').gap = 'Test data: no checked source with worked lifetime exercises was found.';
  return roadmap;
}

/** The link-check counts a built file carries next to its roadmap. */
export function receiptFor(roadmap: FixtureRoadmap): { opened: number; kept: number; dead: number; flagged: number; checkedOn: string } {
  const kept = roadmap.resources.length;
  return { opened: kept + 9, kept, dead: 6, flagged: roadmap.resources.filter((entry) => entry.check.status !== 'verified').length, checkedOn: roadmap.checkedOn };
}

/** A German learner's own roadmap, read in German. */
export function ownDeutsch(): FixtureRoadmap {
  const roadmap = sample('deutsch-a1-von-null');
  roadmap.id = 'deutsch-a1-abends';
  roadmap.title = 'Deutsch A1 am Abend';
  roadmap.topic = 'Deutsch A1 von null, abends nach der Arbeit';
  roadmap.brief = { ...roadmap.brief, hoursPerWeek: 5, startDate: '2026-11-09', deadline: '2027-02-14' };
  return roadmap;
}

/**
 * An init script that writes a roadmap, and the link-check receipt when there is one, into the page's own
 * `zero-to-roadmap` and `zero-to-receipt` elements as the page is parsed, before any of its scripts run: the
 * way a file built by the skill carries them. Use it as `page.addInitScript(fillInline, { roadmap, receipt })`
 * with both as JSON text. It is serialised into the page, so it uses nothing from outside its own body.
 */
export function fillInline(texts: { roadmap: string; receipt: string | null }): void {
  const wanted: [string, string][] = [['zero-to-roadmap', texts.roadmap]];
  if (texts.receipt !== null) wanted.push(['zero-to-receipt', texts.receipt]);
  const fill = (): boolean => {
    for (const [id, text] of wanted) {
      const slot = document.getElementById(id);
      if (slot && slot.textContent !== text) slot.textContent = text;
    }
    return wanted.every(([id]) => document.getElementById(id) !== null);
  };
  if (fill()) return;
  const watcher = new MutationObserver(() => {
    if (fill()) watcher.disconnect();
  });
  watcher.observe(document, { childList: true, subtree: true });
}
