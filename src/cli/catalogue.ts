/**
 * The map options an agent can pick from when it writes `map` (and `checkpoint.signpost`) in a roadmap.
 *
 * Terrain and trail templates come from `src/terrain/catalogue.ts`, the surfaces from the scene palette and the
 * signposts from `src/props/signposts.ts` and the themes from `src/roadmap/themes.ts`. None of these pull in the 3D code.
 */
import { THEMES } from '../roadmap/themes';
import { DEFAULT_SIGNPOST, SIGNPOST_CATALOGUE, SIGNPOST_KEYS } from '../props/signposts';
import { SURFACE_KINDS } from '../scene/palette';
import { TERRAIN_TEMPLATES, TRAIL_TEMPLATES } from '../terrain/catalogue';

export { DEFAULT_SIGNPOST, SIGNPOST_KEYS };

export interface Option {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  /** Ground a signpost looks most at home on. A hint, not a rule. */
  readonly surfaces?: readonly string[];
}

export interface OptionGroup {
  /** The roadmap field this group fills. */
  readonly field: string;
  readonly default: string | null;
  readonly note: string;
  readonly options: readonly Option[];
}

export const MAP_THEMES = THEMES.map((theme) => theme.id);

function nameOf(id: string): string {
  const words = id.split('-').join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function mapCatalogue(): Readonly<Record<'terrain' | 'trail' | 'surfaces' | 'signposts' | 'themes', OptionGroup>> {
  return {
    terrain: {
      field: 'map.terrain',
      default: 'random',
      note: 'The shape of the mountain. "random" lets the seed pick one of these.',
      options: TERRAIN_TEMPLATES.map(({ id, name, description }) => ({ id, name, description })),
    },
    trail: {
      field: 'map.trail',
      default: 'random',
      note: 'How the route winds up. "random" lets the seed pick one of these.',
      options: TRAIL_TEMPLATES.map(({ id, name, description }) => ({ id, name, description })),
    },
    surfaces: {
      field: 'map.surfaces',
      default: 'auto',
      note: 'A list of these ground types from the bottom of the mountain to the top, or "auto" to let the theme decide.',
      options: SURFACE_KINDS.map((id) => ({ id, name: nameOf(id) })),
    },
    signposts: {
      field: 'map.signpost, stages[].checkpoint.signpost',
      default: DEFAULT_SIGNPOST,
      note: 'The signpost at the end of each stage. Order of choice: the checkpoint, the map, the theme, then the default.',
      options: SIGNPOST_CATALOGUE.map((entry) => ({ id: entry.key, name: entry.name.en, description: entry.description.en, surfaces: [...entry.surfaces] })),
    },
    themes: {
      field: 'map.theme',
      default: null,
      note: 'A theme sets the surface order for "auto", a default signpost and the lamp colour.',
      options: THEMES.map((theme) => ({
        id: theme.id,
        name: theme.name,
        description: `Ground ${theme.surfaces.join(', ')}. Signposts ${theme.signpost}. Lamp ${theme.lampKelvin} K.`,
      })),
    },
  };
}
