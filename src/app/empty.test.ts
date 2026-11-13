import { afterEach, describe, expect, it } from 'vitest';
import rust from '../roadmap/samples/rust-for-a-python-dev.json';
import type { Roadmap } from '../roadmap/types';
import { createChooser } from './empty';

const roadmap = { ...(rust as unknown as Roadmap), id: 'rust-on-weeknights', title: 'Rust on weeknights' };

afterEach(() => {
  document.body.replaceChildren();
});

describe('a page with no roadmap', () => {
  it('asks for one, says what went wrong before it asked, and offers what this browser kept', async () => {
    const chooser = createChooser(document.body, [{ id: roadmap.id, title: roadmap.title, openedAt: '2026-11-12T10:00:00.000Z', roadmap }], {
      text: 'The roadmap in this page could not be read.',
      lines: ['stages: missing'],
    });
    expect(document.querySelector('.zt-empty h1')?.textContent).toBe('Open a roadmap');
    const error = document.querySelector<HTMLElement>('.zt-empty-error');
    expect(error?.hidden).toBe(false);
    expect(error?.textContent).toContain('could not be read');
    expect(error?.querySelector('li')?.textContent).toBe('stages: missing');

    const kept = document.querySelector<HTMLButtonElement>('.zt-empty-kept');
    expect(kept?.textContent).toBe('Rust on weeknights');
    kept?.click();
    await expect(chooser.chosen).resolves.toMatchObject({ source: 'kept', roadmap: { id: 'rust-on-weeknights' } });
    chooser.destroy();
    expect(document.querySelector('.zt-empty')).toBeNull();
  });

  it('refuses a pasted link that holds no roadmap, in words, and settles on nothing', async () => {
    const chooser = createChooser(document.body, []);
    let settled = false;
    void chooser.chosen.then(() => {
      settled = true;
    });
    expect(document.querySelector('.zt-empty-list')).toBeNull();
    const field = document.querySelector<HTMLInputElement>('#zt-empty-link') as HTMLInputElement;
    field.value = 'this is no link';
    document.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const error = document.querySelector<HTMLElement>('.zt-empty-error');
    expect(error?.hidden).toBe(false);
    expect(error?.textContent?.length).toBeGreaterThan(0);
    expect(settled).toBe(false);
    chooser.destroy();
  });
});
