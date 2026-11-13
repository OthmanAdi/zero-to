// @vitest-environment node
import { describe, expect, it } from 'vitest';
import schema from '../roadmap/roadmap.schema.json';
import { TERRAIN_KINDS, TRAIL_KINDS } from '../roadmap/types';
import { SURFACE_KINDS } from '../scene/palette';
import { DEFAULT_SIGNPOST, MAP_THEMES, mapCatalogue, SIGNPOST_KEYS } from './catalogue';

const ids = (list: readonly { id: string }[]): string[] => list.map((o) => o.id);

/** Keys out of whatever shape a catalogue export has: a list of keys, a list of entries, or a record. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item: unknown) => {
      if (typeof item === 'string') return item;
      const entry = item as { id?: unknown; key?: unknown };
      return String(entry.id ?? entry.key);
    });
  }
  if (value instanceof Map) return [...value.keys()].map(String);
  if (value !== null && typeof value === 'object') return Object.keys(value);
  return [];
}

// Source text of the scene modules, to find where the signpost and theme catalogues are defined once they exist.
const sources = import.meta.glob(['../props/**/*.ts', '../look/**/*.ts', '!../**/*.test.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const loaders = import.meta.glob(['../props/**/*.ts', '../look/**/*.ts', '!../**/*.test.ts']);

async function findExport(names: readonly string[]): Promise<{ file: string; name: string; value: unknown } | null> {
  for (const name of names) {
    const definition = new RegExp(`export\\s+const\\s+${name}\\b`);
    const file = Object.keys(sources).find((path) => definition.test(sources[path] ?? ''));
    const load = file === undefined ? undefined : loaders[file];
    if (file !== undefined && load !== undefined) {
      const module = (await load()) as Record<string, unknown>;
      return { file, name, value: module[name] };
    }
  }
  return null;
}

describe('mapCatalogue', () => {
  const catalogue = mapCatalogue();
  const map = (schema as any).$defs.map.properties;

  it('offers exactly the terrain and trail templates the schema accepts', () => {
    expect(ids(catalogue.terrain.options)).toEqual([...TERRAIN_KINDS]);
    expect(ids(catalogue.trail.options)).toEqual([...TRAIL_KINDS]);
    expect([...ids(catalogue.terrain.options), 'random']).toEqual(map.terrain.enum);
    expect([...ids(catalogue.trail.options), 'random']).toEqual(map.trail.enum);
    expect(catalogue.terrain.options.every((o) => typeof o.description === 'string' && o.description.length > 10)).toBe(true);
  });

  it('offers exactly the surfaces of the palette and the schema', () => {
    expect(ids(catalogue.surfaces.options)).toEqual([...SURFACE_KINDS]);
    expect(ids(catalogue.surfaces.options)).toEqual(map.surfaces.anyOf[1].items.enum);
  });

  it('lists the signposts and themes of the build specification, with timber as the default', () => {
    // The keys the build specification gives WP4, in its order.
    expect(ids(catalogue.signposts.options)).toEqual(['timber', 'cairn', 'trig-pillar', 'blaze-post', 'snow-pole', 'buoy', 'summit-flag']);
    expect(ids(catalogue.signposts.options)).toEqual([...SIGNPOST_KEYS]);
    expect(catalogue.signposts.options.every((o) => typeof o.description === 'string' && o.description.length > 10)).toBe(true);
    expect(catalogue.signposts.default).toBe(DEFAULT_SIGNPOST);
    expect(map.signpost.default).toBe(DEFAULT_SIGNPOST);
    expect(ids(catalogue.themes.options)).toEqual([...MAP_THEMES]);
  });

  it('matches the signpost catalogue of src/props once it exists', async (context) => {
    const found = await findExport(['SIGNPOST_CATALOGUE', 'SIGNPOSTS']);
    if (found === null) {
      context.skip('src/props does not export SIGNPOST_CATALOGUE or SIGNPOSTS yet');
      return;
    }
    expect(new Set(keysOf(found.value)), `${found.name} in ${found.file}`).toEqual(new Set(SIGNPOST_KEYS));
  });

  it('matches the theme list of the scene once it exists', async (context) => {
    const found = await findExport(['MAP_THEMES', 'THEME_KEYS', 'THEMES']);
    if (found === null) {
      context.skip('no scene module exports MAP_THEMES, THEME_KEYS or THEMES yet');
      return;
    }
    expect(new Set(keysOf(found.value)), `${found.name} in ${found.file}`).toEqual(new Set(MAP_THEMES));
  });
});
