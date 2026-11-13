import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const folder = import.meta.dirname;
const sources = readdirSync(folder).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));

const FORBIDDEN = [
  'innerHTML',
  'outerHTML',
  'insertAdjacentHTML',
  'document.write',
  'eval(',
  'new Function',
  'DOMParser',
  'fetch(',
  'XMLHttpRequest',
];

describe('reader sources', () => {
  it('finds the module files', () => {
    expect(sources).toEqual(expect.arrayContaining(['parse.ts', 'render.ts', 'reader.ts', 'progress.ts', 'index.ts']));
  });

  it.each(FORBIDDEN)('never uses %s', (token) => {
    const offenders = sources.filter((name) => readFileSync(join(folder, name), 'utf8').includes(token));
    expect(offenders).toEqual([]);
  });

  it('keeps each file under 250 lines', () => {
    for (const name of [...sources, 'reader.css']) {
      const lines = readFileSync(join(folder, name), 'utf8').split('\n').length;
      expect(lines, name).toBeLessThanOrEqual(name === 'reader.css' ? 400 : 250);
    }
  });
});
