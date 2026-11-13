import type { Roadmap } from '../roadmap/types';

/**
 * The gallery: the example roadmaps of the hosted site. A page fetches this file only when it shows the gallery
 * (nothing was given, `?road=`, or an example's own page), and the single-file viewer is built without it, so a
 * page made for one person's roadmap carries none of the examples.
 */

/** The gallery, in the order its sheets lie on the table. Examples not named here follow in file order. */
export const GALLERY_ORDER: readonly string[] = [
  'photography-basics',
  'rust-for-a-python-dev',
  'deutsch-a1-von-null',
  'music-theory-for-a-class',
  'statistics-for-data-work',
  'langgraph-for-a-python-dev',
];

const files = import.meta.glob<Roadmap>('../roadmap/samples/*.json', { import: 'default' });

const idOf = (path: string): string => path.replace(/^.*\//, '').replace(/\.json$/, '');

/** The ids of the examples, read from their file names, so a page can tell an example before fetching any. */
export const GALLERY_IDS: readonly string[] = Object.keys(files).map(idOf);

/** Puts examples into the gallery's order. */
export function galleryOrder(samples: readonly Roadmap[]): Roadmap[] {
  const rank = (id: string): number => {
    const at = GALLERY_ORDER.indexOf(id);
    return at < 0 ? GALLERY_ORDER.length : at;
  };
  return samples
    .map((sample, index) => ({ sample, index }))
    .sort((a, b) => rank(a.sample.id) - rank(b.sample.id) || a.index - b.index)
    .map((entry) => entry.sample);
}

/** Fetches every example, in the gallery's order. */
export async function loadGallery(): Promise<Roadmap[]> {
  const loaded = await Promise.all(Object.values(files).map((load) => load()));
  const seen = new Set<string>();
  return galleryOrder(loaded.filter((sample) => !seen.has(sample.id) && seen.add(sample.id)));
}
