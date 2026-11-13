import { fork, range } from '../core/random';
import { SURFACE_KINDS, type SurfaceKind } from '../scene/palette';
import type { TerrainTemplate } from './heightfield';

export interface SurfaceOptions {
  /** The shape of the mountain. 'auto' uses it to choose what lies at the foot. */
  readonly template?: TerrainTemplate;
}

/** What 'auto' puts on the bare sheet round each kind of mountain. */
const BASE_SURFACE: Record<TerrainTemplate, SurfaceKind> = {
  volcano: 'water',
  canyon: 'water',
  plateau: 'sand',
  ridge: 'grass',
  massif: 'grass',
  'twin-peaks': 'grass',
};

/** The belts of a mountain from the foot upward, with the height at which each one ends. */
const BELTS: readonly { readonly kind: SurfaceKind; readonly until: number }[] = [
  { kind: 'grass', until: 0.2 },
  { kind: 'forest', until: 0.42 },
  { kind: 'dirt', until: 0.52 },
  { kind: 'scree', until: 0.64 },
  { kind: 'rock', until: 0.83 },
  { kind: 'snow', until: Infinity },
];

export function isSurfaceKind(value: unknown): value is SurfaceKind {
  return typeof value === 'string' && (SURFACE_KINDS as readonly string[]).includes(value);
}

/**
 * Decides the ground of every contour band, from the lowest level up.
 *
 * With a list, the bands are shared out over the listed surfaces in the order given, so `['grass', 'rock', 'snow']`
 * puts grass on the lower third, rock on the middle and snow on top. With 'auto' the mountain gets a believable
 * order by height: water or sand on the sheet round it when the shape suits that, then grass, forest, dirt, scree,
 * rock and snow. The seed moves the borders between belts a little, so two mountains do not share a snow line.
 */
export function assignSurfaces(
  levels: readonly { readonly height: number }[],
  choice: readonly SurfaceKind[] | 'auto',
  seed: number | string,
  options: SurfaceOptions = {},
): SurfaceKind[] {
  const count = levels.length;
  if (count === 0) return [];

  if (choice !== 'auto') {
    const kinds = choice.filter(isSurfaceKind);
    if (kinds.length > 0) {
      return levels.map((_, index) => kinds[Math.min(kinds.length - 1, Math.floor((index * kinds.length) / count))] as SurfaceKind);
    }
  }

  const random = fork(seed, 'terrain/surfaces');
  const shift = range(random, -0.035, 0.035);
  const stretch = range(random, 0.94, 1.08);
  const base = options.template ? BASE_SURFACE[options.template] : 'grass';

  return levels.map((level, index) => {
    if (index === 0 && count > 1) return base;
    for (const belt of BELTS) {
      if (level.height < belt.until * stretch + shift) return belt.kind;
    }
    return 'snow';
  });
}
