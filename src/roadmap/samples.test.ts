// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
});
