import { describe, expect, it } from 'vitest';

/** The package's own source, read as text. */
const sources = import.meta.glob(['./*.ts', '!./*.test.ts', '!./testing.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('source rules', () => {
  it('reads every source file', () => {
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(12);
  });

  it.each(Object.entries(sources))('%s never writes markup from text', (_file, text) => {
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/\.(innerHTML|outerHTML)\s*=/);
    expect(code).not.toMatch(/insertAdjacentHTML|createContextualFragment|document\.write|new DOMParser|\beval\(|new Function\(/);
  });
});
