/**
 * The default colours of the zero-to scene. Parts take colours as options and fall back to these, so a theme is
 * one object, not edits in many files. Values are sRGB hex.
 */
export const PALETTE = {
  /** The room: deep blue-black, warmer near the lamp. */
  night: '#0b0f17',
  nightSoft: '#141b27',
  lamp: '#ffd9a0',

  /** Paper of the map sheets, the notes and the terrain layers. */
  paper: '#f3ece0',
  paperHi: '#fbf8f1',
  paperShade: '#d9cdb8',
  ink: '#1f2a3d',
  inkSoft: '#5a6577',

  /** The route, the pin and every "you are here". */
  signal: '#e2492f',
  signalDeep: '#b8341f',

  /** Compass metals and glass. */
  brass: '#c9a15b',
  brassDeep: '#8a6a32',
  steel: '#9aa3ad',
  glass: '#dfe9f2',

  /** Ground surfaces a roadmap can choose for its terrain bands. */
  surface: {
    water: '#7fb0c4',
    sand: '#e4cf9e',
    grass: '#9fbf86',
    forest: '#5f806b',
    dirt: '#b58a5a',
    scree: '#a8a296',
    rock: '#8e8a80',
    snow: '#f6f4ee',
  },

  /** Tier colours, from the first camp to the summit. */
  tier: {
    bronze: '#b8794a',
    silver: '#aeb6c0',
    gold: '#e0b44c',
    platinum: '#9fd0cf',
    diamond: '#b9c8ff',
  },
} as const;

export type SurfaceKind = keyof typeof PALETTE.surface;
export type TierName = keyof typeof PALETTE.tier;

export const SURFACE_KINDS = Object.keys(PALETTE.surface) as SurfaceKind[];
export const TIER_NAMES = Object.keys(PALETTE.tier) as TierName[];
