// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { daysBetween, isRealDay } from './dates';
import type { Roadmap } from './types';
import { validateRoadmap } from './validate';

const folder = join(import.meta.dirname, 'samples');
const files = readdirSync(folder).filter((name) => name.endsWith('.json'));

describe('gallery samples', () => {
  it('has the examples the gallery needs', () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
  });

  it.each(files)('%s validates without errors or warnings', (name) => {
    const result = validateRoadmap(JSON.parse(readFileSync(join(folder, name), 'utf8')));
    if (!result.ok) throw new Error(result.errors.map((issue) => `${issue.path}: ${issue.message}`).join('\n'));
    expect(result.warnings).toEqual([]);
  });

  it.each(files)('%s is named after its id', (name) => {
    const data = JSON.parse(readFileSync(join(folder, name), 'utf8')) as { id: string };
    expect(name).toBe(`${data.id}.json`);
  });

  it('covers the range the site must render: German, two stages, eight stages and a class', () => {
    const roadmaps = files.map((name) => JSON.parse(readFileSync(join(folder, name), 'utf8')) as {
      lang: string;
      stages: unknown[];
      class?: unknown;
    });
    expect(roadmaps.some((r) => r.lang === 'de')).toBe(true);
    expect(roadmaps.some((r) => r.stages.length === 2)).toBe(true);
    expect(roadmaps.some((r) => r.stages.length === 8)).toBe(true);
    expect(roadmaps.some((r) => r.class !== undefined)).toBe(true);
  });

  // The class flag stands at the latest session dated today or earlier, so a class without dates never shows it.
  const classes = files
    .map((name) => [name, JSON.parse(readFileSync(join(folder, name), 'utf8')) as Roadmap] as const)
    .filter(([, roadmap]) => (roadmap.class?.sessions?.length ?? 0) > 0);

  it('has a class whose sessions are dated', () => {
    expect(classes.length).toBeGreaterThan(0);
  });

  it.each(classes)('%s dates every session within its brief, at its sessions a week', (_name, roadmap) => {
    const plan = roadmap.class!;
    const sessions = plan.sessions!;
    const { startDate, deadline } = roadmap.brief;
    expect(startDate).toBeDefined();
    for (const session of sessions) expect(session.date !== undefined && isRealDay(session.date), `session ${session.n}`).toBe(true);
    const days = sessions.map((session) => session.date as string);
    // The first lesson is on the start day and the last one before the deadline.
    expect(days[0]).toBe(startDate);
    if (deadline !== undefined) expect(daysBetween(days[days.length - 1]!, deadline)).toBeGreaterThan(0);
    // One lesson a day, in the order of the list.
    for (let k = 1; k < days.length; k += 1) expect(daysBetween(days[k - 1]!, days[k]!), `session ${sessions[k]!.n}`).toBeGreaterThan(0);
    // No week of the course holds more lessons than the plan has a week.
    const perWeek = new Map<number, number>();
    for (const day of days) {
      const week = Math.floor(daysBetween(startDate!, day) / 7);
      perWeek.set(week, (perWeek.get(week) ?? 0) + 1);
    }
    for (const count of perWeek.values()) expect(count).toBeLessThanOrEqual(Math.ceil(plan.sessionsPerWeek));
    if (plan.weeks !== undefined) expect(Math.max(...perWeek.keys())).toBeLessThan(plan.weeks);
  });
});
