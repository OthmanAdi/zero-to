import { describe, expect, it } from 'vitest';
import photography from '../roadmap/samples/photography-basics.json';
import rust from '../roadmap/samples/rust-for-a-python-dev.json';
import type { Roadmap } from '../roadmap/types';
import { GALLERY_IDS, GALLERY_ORDER, galleryOrder, loadGallery } from './gallery';

const own = (id: string): Roadmap => ({ ...(photography as unknown as Roadmap), id });

describe('the gallery', () => {
  it('knows its examples by their file names, and each file holds the roadmap of that id', async () => {
    const samples = await loadGallery();
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.map((sample) => sample.id).sort()).toEqual([...GALLERY_IDS].sort());
  });

  it('lies in its own order', async () => {
    const ids = (await loadGallery()).map((sample) => sample.id);
    const named = GALLERY_ORDER.filter((id) => GALLERY_IDS.includes(id));
    expect(ids.slice(0, named.length)).toEqual(named);
  });

  it('puts examples it does not name after the ones it names, each group in the order it came', () => {
    const sorted = galleryOrder([own('zebra'), rust as unknown as Roadmap, own('aardvark'), photography as unknown as Roadmap]);
    expect(sorted.map((sample) => sample.id)).toEqual(['photography-basics', 'rust-for-a-python-dev', 'zebra', 'aardvark']);
  });
});
