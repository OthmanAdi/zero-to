import { DEFAULT_LAMP, DEFAULT_LIGHT } from './light';
import type { Geometry, Light, Variant, VariantMotion } from './types';

/**
 * Variants change geometry here and look in `variants.css` (scoped by
 * `data-variant` on the shelf root). Adding one means: one entry below, one
 * CSS block, nothing else.
 */

/** Default: one endless row on a paper ground, matte cloth spines, soft contact shadows. */
const paperGeometry: Geometry = {
  spineWidth: 58,
  bookHeight: 340,
  coverWidth: 206,
  gap: 10,
  focusGap: 14,
  // Short of square to the viewer, so the spine still shows as a lit band at the joint and the volume keeps its body.
  focusAngle: 84,
  focusLean: -4.4,
  focusPush: 0,
  focusLift: 0,
  perspective: 2000,
};

/**
 * Every look moves the same way. A step along the row runs on the same spring as a released drag, so a
 * second press carries its speed instead of starting from rest. Opening is one continuous move: the
 * volume stays in view from the shelf to its place beside the page.
 */
const steadyMotion: VariantMotion = {
  travel: null,
  openDuration: 720,
  closeDuration: 520,
  openHold: 0,
  swap: false,
};

/**
 * Night Study's lamp: over the middle of the row and three cover widths in front of it, with the room
 * dim rather than black. The ends of the row fall to about six tenths of the light at the centre, the
 * deepest a spine can go while its title still holds 4.5:1 on Night's cloths.
 */
const nightLamp: Light = { ...DEFAULT_LAMP, z: 3, ambient: 0.58, lamp: { reach: 1.5, floor: 0.7 } };

export const VARIANTS: Record<string, Variant> = {
  paper: {
    name: 'paper',
    label: 'Paper Row',
    summary: 'Cloth-bound volumes on a warm paper ground, the one in front in a printed jacket.',
    geometry: paperGeometry,
    motion: steadyMotion,
    // A window at the upper left, a little in front of the row.
    light: DEFAULT_LIGHT,
    loop: true,
  },
  oak: {
    name: 'oak',
    label: 'Oak Library',
    summary: 'Thick, deep-coloured library bindings standing on a wooden shelf, lettered in gold.',
    geometry: {
      ...paperGeometry,
      spineWidth: 66,
      bookHeight: 300,
      coverWidth: 204,
      gap: 3,
      focusGap: 18,
      focusLean: -2,
      focusPush: 26,
      focusLift: 0,
      perspective: 1500,
    },
    motion: steadyMotion,
    // A reading-room light further to the side, with warm brown shade from the wood around the books.
    light: { x: -0.5, z: 0.87, ambient: 0.38, tint: '#140a02' },
    loop: true,
  },
  night: {
    name: 'night',
    label: 'Night Study',
    summary: 'A dark room with one lamp over the middle of the shelf.',
    geometry: {
      ...paperGeometry,
      gap: 12,
      focusGap: 22,
      focusAngle: 86,
      focusLean: 0,
      // Slid forward along the shelf toward the lamp, never lifted off it.
      focusPush: 70,
      focusLift: 0,
      perspective: 1300,
    },
    motion: steadyMotion,
    light: nightLamp,
    loop: true,
  },
  pocket: {
    name: 'pocket',
    label: 'Pocket Paperbacks',
    summary: 'Thin paperbacks in bright printed colours, packed tightly together.',
    geometry: {
      ...paperGeometry,
      spineWidth: 36,
      bookHeight: 300,
      coverWidth: 190,
      // Paperbacks stand packed tight, nearly touching.
      gap: 2,
      focusGap: 12,
      focusLean: 3,
      perspective: 2400,
    },
    motion: steadyMotion,
    // Flat, even light from nearly in front: paper has little sheen and soft shade.
    light: { x: -0.3, z: 0.95, ambient: 0.55, tint: '#000' },
    loop: true,
  },
};

export const DEFAULT_VARIANT = 'paper';

export function resolveVariant(variant: string | Variant | undefined): Variant {
  if (variant && typeof variant === 'object') return variant;
  return VARIANTS[variant ?? DEFAULT_VARIANT] ?? VARIANTS[DEFAULT_VARIANT]!;
}

export function listVariants(): Variant[] {
  return Object.values(VARIANTS);
}

export const CLOTHS = ['ink', 'bone', 'rust', 'moss', 'plum', 'ochre', 'slate', 'teal'] as const;
export const PATTERNS = ['arcs', 'bars', 'dots', 'rays', 'tiles', 'waves'] as const;

export type ClothName = (typeof CLOTHS)[number];
export type PatternName = (typeof PATTERNS)[number];

export function resolveCloth(name: string | undefined): ClothName {
  return (CLOTHS as readonly string[]).includes(name ?? '') ? (name as ClothName) : CLOTHS[0];
}

export function resolvePattern(name: string | undefined): PatternName {
  return (PATTERNS as readonly string[]).includes(name ?? '') ? (name as PatternName) : PATTERNS[0];
}
