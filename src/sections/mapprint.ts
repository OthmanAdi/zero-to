import { resolveTheme } from '../roadmap/themes';
import type { SurfaceKind } from '../roadmap/types';
import { assignSurfaces, generateHeightfield, levelHeights, planTrail, traceContours, type Ring, type TerrainTemplate, type TrailTemplate } from '../terrain';

/**
 * The print of the folded sheet at the map stop: a real contour map from the generator the site uses, for the
 * mountain shape, trail and theme that are chosen. It is loaded on demand, because the terrain code is only
 * needed once a visitor reaches that stop. Until then, and without it, the sheet shows a plain print.
 */

export interface MapChoice {
  readonly shape: TerrainTemplate;
  readonly trail: TrailTemplate;
  readonly theme: string;
  readonly seed: string;
  /** Ground bands from the foot to the summit, for a roadmap that lists its own. Default: the theme's. */
  readonly surfaces?: readonly SurfaceKind[];
}

export const PRINT = { width: 600, height: 400, levels: 11, stops: 5 } as const;

const ringPath = (ring: Ring, x: (value: number) => string, y: (value: number) => string): string =>
  `${ring.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point.x)} ${y(point.z)}`).join('')}Z`;

/** The inside of an SVG with the view box `0 0 PRINT.width PRINT.height`. The same choice always gives the same print. */
export function mapPrint(choice: MapChoice): string {
  const field = generateHeightfield({ seed: choice.seed, template: choice.shape, resolution: 65 });
  const levels = traceContours(field, levelHeights(PRINT.levels), { simplify: 0.006 });
  const surfaces = assignSurfaces(levels, choice.surfaces ?? resolveTheme(choice.theme).surfaces, choice.seed, { template: field.template });
  const trail = planTrail(field, { seed: choice.seed, template: choice.trail, stops: PRINT.stops });

  // The footprint is a square from -1 to 1. It sits in the middle of the sheet, a little wider than tall.
  const half = PRINT.height * 0.47;
  const x = (value: number) => (PRINT.width / 2 + value * half * 1.22).toFixed(1);
  const y = (value: number) => (PRINT.height / 2 + value * half).toFixed(1);

  let out = '';
  levels.forEach((level, index) => {
    if (index === 0) return;
    const d = level.polygons.map((polygon) => ringPath(polygon.outer, x, y) + polygon.holes.map((hole) => ringPath(hole, x, y)).join('')).join('');
    if (!d) return;
    out += `<path d="${d}" fill="var(--zt-surface-${surfaces[index] ?? 'grass'})" fill-opacity=".5" fill-rule="evenodd" stroke="var(--zt-ink)" stroke-opacity="${index % 5 === 0 ? 0.42 : 0.2}" stroke-width="${index % 5 === 0 ? 1.2 : 0.8}" stroke-linejoin="round"/>`;
  });

  const route = trail.points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point.x)} ${y(point.z)}`).join('');
  out += `<path d="${route}" fill="none" stroke="var(--zt-paper-hi)" stroke-width="5" stroke-linejoin="round" stroke-linecap="round" opacity=".7"/>`;
  out += `<path d="${route}" fill="none" stroke="var(--zt-signal)" stroke-width="2.6" stroke-dasharray="7 5" stroke-linejoin="round"/>`;
  trail.stops.forEach((stop, index) => {
    const cx = x(stop.x);
    const cy = y(stop.z);
    if (index === 0) {
      out += `<circle cx="${cx}" cy="${cy}" r="6.5" fill="none" stroke="var(--zt-signal)" stroke-width="2"/><circle cx="${cx}" cy="${cy}" r="2.6" fill="var(--zt-signal)"/>`;
    } else if (index === trail.stops.length - 1) {
      out += `<path d="M${cx} ${cy}v-20" stroke="var(--zt-ink)" stroke-width="1.6"/><path d="M${cx} ${(Number(cy) - 20).toFixed(1)}l14 4.5-14 4.5Z" fill="var(--zt-signal)"/>`;
    } else {
      out += `<path d="M${(Number(cx) - 6).toFixed(1)} ${(Number(cy) + 4).toFixed(1)}l6-10 6 10Z" fill="var(--zt-ink)"/>`;
    }
  });
  return out;
}
