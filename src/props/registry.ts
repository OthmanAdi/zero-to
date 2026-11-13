import { SURFACE_KINDS, type SurfaceKind } from '../scene/palette';
import type { PropArt, PropSurface } from './art';
import { FAR_PROPS } from './drawings/far';
import { HIGH_PROPS } from './drawings/high';
import { LOW_PROPS } from './drawings/low';
import { WIDE_PROPS } from './drawings/wide';

/** Every place a prop can belong: the eight ground surfaces, then the sky and the camp. */
export const PROP_SURFACES: readonly PropSurface[] = [...SURFACE_KINDS, 'sky', 'camp'];

const ALL: readonly PropArt[] = [...LOW_PROPS, ...HIGH_PROPS, ...WIDE_PROPS, ...FAR_PROPS];

function bySurface(): Record<PropSurface, readonly PropArt[]> {
  const table = {} as Record<PropSurface, PropArt[]>;
  for (const surface of PROP_SURFACES) table[surface] = [];
  for (const art of ALL) table[art.surface].push(art);
  for (const surface of PROP_SURFACES) Object.freeze(table[surface]);
  return Object.freeze(table);
}

/**
 * The scenery, by the ground it grows on. A roadmap never names a prop: it names surfaces (or lets the
 * mountain choose them), and each surface brings its own drawings.
 */
export const PROPS: Readonly<Record<PropSurface, readonly PropArt[]>> = bySurface();

/** Every drawing in the registry, in a fixed order. */
export function allProps(): readonly PropArt[] {
  return ALL;
}

/** The drawing with this id, for example `forest/spruce`. */
export function propById(id: string): PropArt | undefined {
  return ALL.find((art) => art.id === id);
}

export function isPropSurface(value: unknown): value is PropSurface {
  return typeof value === 'string' && (PROP_SURFACES as readonly string[]).includes(value);
}

/** The props of a surface, or of grass when the name is not a surface. Unknown roadmap values never throw. */
export function propsFor(surface: string): readonly PropArt[] {
  return isPropSurface(surface) ? PROPS[surface] : PROPS.grass;
}

export type { SurfaceKind };
