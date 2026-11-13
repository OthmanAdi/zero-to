import type { SurfaceKind } from '../scene/palette';

/**
 * Map themes. A theme decides three things a roadmap leaves open: the ground order when `map.surfaces` is
 * "auto", the signpost style when neither the checkpoint nor the map names one, and the colour of the lamp.
 * This list is the single source for the site, the skill's catalogue and the skill's documentation.
 */
export interface MapTheme {
  readonly id: ThemeId;
  readonly name: string;
  readonly surfaces: readonly SurfaceKind[];
  readonly signpost: string;
  /** Lamp colour temperature in kelvin. Lower is warmer. */
  readonly lampKelvin: number;
}

export type ThemeId = 'classic-topo' | 'alpine-winter' | 'desert-expedition' | 'coastal-survey';

export const DEFAULT_THEME: ThemeId = 'classic-topo';

export const THEMES: readonly MapTheme[] = [
  { id: 'classic-topo', name: 'Classic topo', surfaces: ['grass', 'forest', 'rock', 'snow'], signpost: 'timber', lampKelvin: 2900 },
  { id: 'alpine-winter', name: 'Alpine winter', surfaces: ['forest', 'scree', 'rock', 'snow'], signpost: 'snow-pole', lampKelvin: 4200 },
  { id: 'desert-expedition', name: 'Desert expedition', surfaces: ['sand', 'dirt', 'rock'], signpost: 'cairn', lampKelvin: 2500 },
  { id: 'coastal-survey', name: 'Coastal survey', surfaces: ['water', 'sand', 'grass', 'rock'], signpost: 'buoy', lampKelvin: 3600 },
];

/** The theme for a key, or the default theme for a missing or unknown key. */
export function resolveTheme(id: string | undefined): MapTheme {
  return THEMES.find((theme) => theme.id === id) ?? (THEMES[0] as MapTheme);
}

/** The signpost a checkpoint shows: its own key, then the map's, then the theme's. */
export function signpostFor(checkpointKey: string | undefined, mapKey: string | undefined, themeId: string | undefined): string {
  return checkpointKey ?? mapKey ?? resolveTheme(themeId).signpost;
}

/** The ground bands for a map: the roadmap's own list, or the theme's when it says "auto" or nothing. */
export function surfacesFor(surfaces: readonly SurfaceKind[] | 'auto' | undefined, themeId: string | undefined): readonly SurfaceKind[] {
  return Array.isArray(surfaces) && surfaces.length > 0 ? surfaces : resolveTheme(themeId).surfaces;
}

/** An sRGB hex colour for a lamp temperature, from a standard blackbody fit, for the range 1000 K to 12000 K. */
export function kelvinToHex(kelvin: number): string {
  const t = Math.min(12000, Math.max(1000, kelvin)) / 100;
  const red = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  const green = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492;
  const blue = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const channel = (value: number) => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, '0');
  return `#${channel(red)}${channel(green)}${channel(blue)}`;
}
