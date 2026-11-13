/**
 * How each binding and each stamp answers light, as plain numbers. The kit reads these to build
 * materials; keeping them apart from three.js lets them be read, compared and tested on their own.
 */
import type { Binding, Stamp } from '../types';

export type TileName = 'cloth' | 'linen' | 'leather' | 'paper' | 'gloss' | 'velvet' | 'brushed' | 'flake';

/** A linear RGB colour, each channel 0 to 1. */
export type Rgb = readonly [number, number, number];

export interface BindingRecipe {
  /** The repeating surface the binding is made of. */
  tile: TileName;
  /**
   * CSS px one repeat of the tile covers on a volume 340 px tall. The kit scales it with the height of the
   * volume, so the detail keeps its size against the book: a taller drawing of the same book shows the
   * same number of threads.
   */
  span: number;
  normalScale: number;
  /** Roughness where the tile keeps all of it; the tile lowers it on polished parts. */
  roughness: number;
  metalness: number;
  /** Strength of the soft glow that fabric shows at grazing angles, and how it is tuned. */
  sheen: number;
  /** How far the sheen colour is lifted from the cloth colour toward white, 0 to 1. */
  sheenLift: number;
  sheenRoughness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  /** Stretch of the highlight across the scratches of a brushed metal. */
  anisotropy: number;
  /** Thin film colour over the whole board (holographic foil). */
  iridescence: number;
  /** How far the film colour runs with the angle of the light, in nanometres of film. */
  filmShift: number;
  /** How strongly the tile's shade (hollows, single threads) is printed into the colour, 0 to 1. */
  shade: number;
  /** Exponent applied to the brightness of the print: below 1 lifts a dark colour so it can work as a metal. */
  lift: number;
  /** How far the print is paled toward silver, 0 to 1. Holographic foil is pastel whatever its colour. */
  pastel: number;
  /**
   * Rubbed edges on a volume fresh from the binder: width in CSS px and how they show. Positive is
   * burnished darker and smoother (leather), negative rubbed pale toward the thread or the card (cloth,
   * paper). Both grow with handling, see `rubOf`.
   */
  wear: readonly [number, number];
  /** Turn of the covering over the board edge: width in CSS px and how far the surface leans there. */
  bevel: readonly [number, number];
  /** Depth of the joint, the groove where the board hinges on the spine. */
  joint: number;
  /**
   * How flat a hot die irons the binding, 0 to 1. Leather and velvet come out smooth, so foil lies in a
   * flat bed; cloth and linen keep a trace of the weave, which breathes through the foil.
   */
  pressed: number;
}

const cloth: BindingRecipe = {
  tile: 'cloth',
  // Buckram runs to 11 or 12 threads to the centimetre. Drawn a little coarser, 64 threads to 100 px, it
  // still resolves on an ordinary screen.
  span: 100,
  normalScale: 1,
  // Low enough that the light draws a soft band down a board as it turns.
  roughness: 0.78,
  metalness: 0,
  sheen: 0.7,
  sheenLift: 0.38,
  sheenRoughness: 0.5,
  clearcoat: 0,
  clearcoatRoughness: 0,
  anisotropy: 0,
  iridescence: 0,
  filmShift: 0,
  // The weave is relief for the light to find. Printed into the colour it stays put when the light moves
  // and beats against the pixels of a resting spine, so only a little of it is.
  shade: 0.35,
  lift: 1,
  pastel: 0,
  wear: [5, -0.2],
  bevel: [2.2, 0.55],
  joint: 0.9,
  pressed: 0.65,
};

export const BINDING_RECIPES: Record<Binding, BindingRecipe> = {
  cloth,
  // Linen book cloth is finer than buckram: 56 threads to 76 px, with slubs and threads of uneven colour.
  linen: { ...cloth, tile: 'linen', span: 76, normalScale: 0.9, roughness: 0.93, sheen: 0.32, sheenLift: 0.3, sheenRoughness: 0.7, shade: 0.3, wear: [5, -0.18], pressed: 0.55 },
  leather: {
    ...cloth,
    tile: 'leather',
    // Goatskin: a pebble of 0.6 to 1 mm, which on an octavo 340 px tall is about a pixel and a half.
    span: 60,
    normalScale: 0.6,
    // Waxed, not varnished: a broad soft highlight and only a trace of a coat.
    roughness: 0.7,
    sheen: 0,
    clearcoat: 0.1,
    clearcoatRoughness: 0.4,
    shade: 0.25,
    wear: [6, 0.26],
    bevel: [3, 0.7],
    joint: 1.1,
    pressed: 0.97,
  },
  paper: { ...cloth, tile: 'paper', span: 96, normalScale: 0.4, roughness: 0.72, sheen: 0, shade: 0.4, wear: [3, -0.22], bevel: [1.6, 0.45], joint: 0.7, pressed: 0.9 },
  gloss: {
    ...cloth,
    tile: 'gloss',
    span: 220,
    normalScale: 0.12,
    // A matt print under a clear film: the film alone mirrors the lamps, as a window with an edge. A
    // full, perfectly smooth coat over a half-polished print lays a milky veil over the whole board.
    roughness: 0.58,
    sheen: 0,
    clearcoat: 0.75,
    clearcoatRoughness: 0.08,
    shade: 0,
    wear: [0, 0],
    bevel: [1.6, 0.5],
    joint: 0.8,
    pressed: 0.9,
  },
  velvet: { ...cloth, tile: 'velvet', span: 150, normalScale: 0.3, roughness: 1, sheen: 1, sheenLift: 0.7, sheenRoughness: 0.5, shade: 1, wear: [6, 0.14], bevel: [3.2, 0.6], joint: 0.6, pressed: 0.95 },
  foil: {
    ...cloth,
    tile: 'brushed',
    span: 150,
    normalScale: 0.16,
    roughness: 0.27,
    metalness: 1,
    sheen: 0,
    anisotropy: 0.4,
    shade: 0.5,
    lift: 0.36,
    wear: [0, 0],
    bevel: [1.6, 0.5],
    joint: 0.8,
    pressed: 0.9,
  },
  holo: {
    ...cloth,
    tile: 'flake',
    // A flake of about a pixel and a half: glitter, not confetti.
    span: 80,
    normalScale: 0.35,
    roughness: 0.26,
    metalness: 0.95,
    sheen: 0,
    // A pale film, not an oil slick: the film colours a little over half of what the foil mirrors, and
    // a tilt of 7 degrees turns the mirrored direction by 14, which moves the film by about 41 nm, a
    // quarter of the 170 nm one full run of colours takes at this index.
    iridescence: 0.6,
    filmShift: 170,
    shade: 0.5,
    lift: 0.28,
    pastel: 0.8,
    wear: [0, 0],
    bevel: [1.6, 0.5],
    joint: 0.8,
    pressed: 0.9,
  },
};

/**
 * How near a volume is drawn: 0 at shelf distance, 1 on a cover shown large or held in the hand. It
 * follows from the height the volume is drawn at unless the caller says how `presented` it is.
 */
export function nearness(bookHeight: number, presented?: number): number {
  if (presented !== undefined && Number.isFinite(presented)) return Math.min(1, Math.max(0, presented));
  const t = Math.min(1, Math.max(0, (bookHeight - 520) / 380));
  return t * t * (3 - 2 * t);
}

/**
 * Share of a binding's relief and printed shade a volume shows. On a spine at shelf distance a thread or
 * a pebble is about a pixel wide; drawn at full strength there it shimmers, so it is quieter the
 * further off the volume stands and whole on a cover shown large.
 */
export function reliefAt(near: number): number {
  return 0.45 + 0.55 * Math.min(1, Math.max(0, near));
}

/** Index of refraction and thickness range, in nanometres, of the film on holographic foil. */
export const FILM = { ior: 1.6, thickness: [430, 580] as const, span: 260 };
/** The film of a holographic stamp: how far it runs with the angle, in nm, and how much of it shows. */
export const STAMP_FILM = { shift: 170, strength: 0.7 };

export interface StampRecipe {
  /** Colour laid over the print inside the mask: a metal, the ink (taken from the look), or nothing. */
  color: Rgb | 'ink' | null;
  /** Share of the print replaced by `color`. */
  tint: number;
  /** What is left of the colour inside the mask: pressed cloth is a little darker. */
  shade: number;
  /** Share of the binding's `pressed` this stamp reaches: all of it under a hot die, little under printed ink. */
  flatten: number;
  /** Lean of the wall at the edge of the pressed bed: a hairline for foil, a real step for a blind stamp. */
  deboss: number;
  /** How much darker the foot of that wall is, where no light reaches. */
  wall: number;
  /**
   * Roughness inside the mask is `[a, b]`: a + b times the binding's roughness. This is the stamp at shelf
   * distance, where a title has to be read: a foil scatters broadly there and holds one even tone.
   */
  roughness: readonly [number, number];
  /** The same on a cover shown large, where foil may be sharp and flash as the book turns. */
  roughnessNear: readonly [number, number];
  /** Metalness inside the mask, written the same way, at shelf distance and shown large. */
  metalness: readonly [number, number];
  metalnessNear: readonly [number, number];
  /**
   * How much more of the room a foil mirrors than the environment map holds, at shelf distance and shown
   * large. The map is a dark studio with a few lamps; a real foil also mirrors pale walls and a ceiling,
   * which is what keeps gold yellow and silver white instead of olive and brown.
   */
  gain: readonly [number, number];
  /** Share of the binding's sheen and clearcoat left inside the mask. */
  sheen: number;
  clearcoat: number;
  /** Thin film inside the mask: 1 shows it, 0 hides it, null leaves what the binding has. */
  iridescence: number | null;
}

const metal = {
  tint: 1,
  shade: 1,
  flatten: 1,
  deboss: 0.45,
  wall: 0.3,
  metalness: [0.8, 0] as const,
  metalnessNear: [0.94, 0] as const,
  gain: [2, 1.25] as const,
  sheen: 0,
  clearcoat: 0,
  iridescence: 0,
};

export const STAMP_RECIPES: Record<Stamp, StampRecipe> = {
  gold: { ...metal, color: [1, 0.74, 0.3], roughness: [0.36, 0.06], roughnessNear: [0.1, 0.04] },
  silver: { ...metal, color: [0.93, 0.94, 0.95], roughness: [0.32, 0.06], roughnessNear: [0.12, 0.04] },
  copper: { ...metal, color: [0.97, 0.58, 0.4], roughness: [0.36, 0.06], roughnessNear: [0.16, 0.04] },
  holo: { ...metal, color: [0.93, 0.93, 0.95], roughness: [0.3, 0.04], roughnessNear: [0.12, 0.04], iridescence: STAMP_FILM.strength },
  blind: {
    color: null,
    tint: 0,
    shade: 0.8,
    flatten: 1,
    deboss: 1.7,
    wall: 0.45,
    roughness: [0, 0.8],
    roughnessNear: [0, 0.8],
    metalness: [0, 1],
    metalnessNear: [0, 1],
    gain: [1, 1],
    sheen: 0.35,
    clearcoat: 1,
    iridescence: null,
  },
  ink: {
    color: 'ink',
    tint: 1,
    shade: 1,
    flatten: 0.2,
    deboss: 0.2,
    wall: 0,
    roughness: [0.3, 0.55],
    roughnessNear: [0.3, 0.55],
    metalness: [0, 0],
    metalnessNear: [0, 0],
    gain: [1, 1],
    sheen: 0.4,
    clearcoat: 1,
    iridescence: 0,
  },
};

/** What time and hands have done to a volume, each 0 (new, untouched) to 1. */
export interface Use {
  /** How far the spine has faded and yellowed in the light. The boards, shut between their neighbours, stay fresh. */
  sun: number;
  /** How far edges and corners are rubbed. */
  rub: number;
  /** How dull the foil has gone at the head of the spine, where a finger hooks the volume out. */
  dull: number;
}

/**
 * Wear from `handled` (0 never opened to 1 read through and returned to) and `age` (days since the link
 * was saved). A new, unread link is crisp: all three are 0. Sun follows 1 - exp(-days / 540): about half
 * after a year, and it never quite finishes.
 */
export function useOf(handled?: number, age?: number): Use {
  const hands = handled !== undefined && Number.isFinite(handled) ? Math.min(1, Math.max(0, handled)) : 0;
  const days = age !== undefined && Number.isFinite(age) ? Math.max(0, age) : 0;
  return { sun: 1 - Math.exp(-days / 540), rub: hands, dull: hands };
}

/** Rubbed edges reach this far at most, in CSS px. */
export const RUB_REACH = 14;

/** Width of the rubbed edge in px and how strongly it shows, for a binding's own `wear` after this much use. */
export function rubOf(wear: readonly [number, number], rub: number): { reach: number; amount: number } {
  return { reach: Math.min(RUB_REACH, wear[0] * (1 + 1.6 * rub)), amount: wear[1] * (0.25 + 0.75 * rub) };
}

/**
 * How much a sunned spine may lighten, as a share of its colour. A faded cloth is paler, which helps a
 * dark title and would cost a light one some of its contrast: under a light title the spine only loses
 * colour and keeps its depth.
 */
export function sunLift(sun: number, titleLuminance: number, clothLuminance: number): number {
  return titleLuminance < clothLuminance ? 0.07 * Math.min(1, Math.max(0, sun)) : 0;
}

/** A stamp as it is pressed into one binding and seen from one distance. */
export interface Pressed {
  flatten: number;
  deboss: number;
  wall: number;
  roughness: readonly [number, number];
  metalness: readonly [number, number];
  gain: number;
}

/**
 * What a stamp does on `binding` at `near` (0 shelf distance, 1 shown large). Shown large, each binding
 * is ironed as flat as a die leaves it, so the weave still breathes through foil on cloth. Far off a
 * thread inside a letter is only noise, so there every bed is nearly flat.
 */
export function stampAt(stamp: StampRecipe, binding: BindingRecipe, near: number): Pressed {
  const t = Math.min(1, Math.max(0, near));
  const mix = (far: number, close: number): number => far + (close - far) * t;
  const die = mix(Math.max(binding.pressed, 0.9), binding.pressed);
  return {
    flatten: stamp.flatten * die,
    deboss: stamp.deboss,
    wall: stamp.wall,
    roughness: [mix(stamp.roughness[0], stamp.roughnessNear[0]), mix(stamp.roughness[1], stamp.roughnessNear[1])],
    metalness: [mix(stamp.metalness[0], stamp.metalnessNear[0]), mix(stamp.metalness[1], stamp.metalnessNear[1])],
    gain: mix(stamp.gain[0], stamp.gain[1]),
  };
}
