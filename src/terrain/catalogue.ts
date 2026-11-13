import { resolveTerrainTemplate, type TerrainSpec, type TerrainTemplate } from './heightfield';
import { resolveTrailTemplate, type TrailSpec, type TrailTemplate } from './trail';

export interface TemplateEntry<Id extends string> {
  readonly id: Id;
  /** A short name for a menu. */
  readonly name: string;
  /** One line that tells a person what they will get. */
  readonly description: string;
}

/** The mountain shapes on offer. 'random' is not listed: it means "let the seed pick one of these". */
export const TERRAIN_TEMPLATES: readonly TemplateEntry<TerrainTemplate>[] = [
  { id: 'volcano', name: 'Volcano', description: 'One cone with a crater on top. The summit is the highest point of the rim.' },
  { id: 'ridge', name: 'Ridge', description: 'A long narrow spine with a main summit and two lower tops along the crest.' },
  { id: 'massif', name: 'Massif', description: 'A broad mountain with a main summit and a ring of lower peaks round it.' },
  { id: 'twin-peaks', name: 'Twin peaks', description: 'Two summits joined by a saddle. The trail ends on the higher one.' },
  { id: 'plateau', name: 'Plateau', description: 'A flat-topped table mountain with cliffs all round and a small knoll as its summit.' },
  { id: 'canyon', name: 'Canyon', description: 'A mountain on a raised bench, with a winding river canyon cut through its base.' },
];

/** The ways up on offer. 'random' is not listed: it means "let the seed pick one of these". */
export const TRAIL_TEMPLATES: readonly TemplateEntry<TrailTemplate>[] = [
  { id: 'switchback', name: 'Switchback', description: 'Zigzags straight up the steepest face in tight hairpins.' },
  { id: 'ridge-walk', name: 'Ridge walk', description: 'Gains the longest spur and follows its crest to the top.' },
  { id: 'spiral', name: 'Spiral', description: 'Winds round the whole mountain, so every side is seen on the way up.' },
  { id: 'valley-first', name: 'Valley first', description: 'Walks in along low ground for the first half, then climbs out of the valley.' },
  { id: 'traverse', name: 'Traverse', description: 'Crosses one broad face from side to side in two or three long legs.' },
];

function entryOf<Id extends string>(list: readonly TemplateEntry<Id>[], id: Id): TemplateEntry<Id> {
  const entry = list.find((item) => item.id === id);
  if (!entry) throw new Error(`No catalogue entry for ${id}`);
  return entry;
}

function roughnessWords(roughness: number): string {
  if (roughness < 0.25) return 'Smooth ground.';
  if (roughness < 0.6) return 'Uneven ground.';
  if (roughness < 0.85) return 'Rough ground.';
  return 'Very rough, broken ground.';
}

/** Plain words for the mountain a spec builds, for a caption or a choice list. */
export function describeTerrain(spec: TerrainSpec): string {
  const entry = entryOf(TERRAIN_TEMPLATES, resolveTerrainTemplate(spec));
  const picked = spec.template === 'random' ? ' Picked by the seed.' : '';
  return `${entry.name}. ${entry.description} ${roughnessWords(Math.min(1, Math.max(0, spec.roughness ?? 0.5)))}${picked}`;
}

/** Plain words for the trail a spec plans. */
export function describeTrail(spec: TrailSpec): string {
  const entry = entryOf(TRAIL_TEMPLATES, resolveTrailTemplate(spec));
  const stops = Math.round(Math.min(12, Math.max(2, Number.isFinite(spec.stops) ? spec.stops : 2)));
  const camps = stops - 2;
  const between = camps === 0 ? 'no camps between' : camps === 1 ? '1 camp between' : `${camps} camps between`;
  const picked = spec.template === 'random' ? ' Picked by the seed.' : '';
  return `${entry.name}. ${entry.description} A gate, the summit and ${between}.${picked}`;
}
