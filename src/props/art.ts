import type { SheetSpec } from '../paper/sheet';
import type { Draw2D } from '../paper/silhouette';
import type { SurfaceKind } from '../scene/palette';
import { DESIGN, sheetDrawings, type Drawing } from './brush';

/** Where a prop belongs: one of the eight ground surfaces, the sky over any of them, or a camp. */
export type PropSurface = SurfaceKind | 'sky' | 'camp';

/**
 * How a prop is held on the map. `stand` rises upright on a hinge along its foot. `tip` is a flat thing such
 * as a lake: it lifts its far edge only a little. `hang` is carried above the map on a wire, as clouds are.
 */
export type PropPose = 'stand' | 'tip' | 'hang';

/** How far back a prop belongs. `back` is a skyline behind everything, `front` is small and near the trail. */
export type PropLayer = 'back' | 'mid' | 'front';

export interface PropSize {
  /** Scene units. */
  readonly width: number;
  readonly height: number;
}

/** One cut-out drawing with everything a scene needs to stand it up. */
export interface PropArt {
  /** `forest/spruce`: the surface and the name of the drawing. */
  readonly id: string;
  readonly surface: PropSurface;
  readonly name: string;
  readonly size: PropSize;
  readonly pose: PropPose;
  readonly layer: PropLayer;
  /** Sway when standing, in radians. Light things sway more. */
  readonly sway: number;
  /** Softness of the cut in scene units. Thin stems need a fine cut or they vanish. */
  readonly soft: number;
  /** Strength of the lighter core along the cut. Dark drawings take less, or the edge reads as a pale fringe. */
  readonly rim: number;
  /** How often `sceneryFor` picks this drawing, compared with its neighbours. */
  readonly weight: number;
  /** True when the drawing may be mirrored for variety. */
  readonly mirror: boolean;
  /** The tone under the print: what shows where the tear strays past a piece. */
  readonly paper: string;
  /** The drawing itself, in hundredths of a scene unit. */
  readonly draw: Drawing;
  /** The same drawing as the two canvas passes a sheet takes. */
  readonly outline: Draw2D;
  readonly print: Draw2D;
}

export interface PropInput {
  readonly surface: PropSurface;
  readonly name: string;
  /** Drawing units: hundredths of a scene unit. */
  readonly width: number;
  readonly height: number;
  readonly paper: string;
  readonly draw: Drawing;
  readonly pose?: PropPose;
  readonly layer?: PropLayer;
  readonly sway?: number;
  readonly soft?: number;
  readonly rim?: number;
  readonly weight?: number;
  readonly mirror?: boolean;
}

export function defineProp(input: PropInput): PropArt {
  const { outline, print } = sheetDrawings(input.draw, input.width, input.height);
  return {
    id: `${input.surface}/${input.name}`,
    surface: input.surface,
    name: input.name,
    size: { width: input.width / DESIGN, height: input.height / DESIGN },
    pose: input.pose ?? 'stand',
    layer: input.layer ?? 'front',
    sway: input.sway ?? 0.006,
    soft: input.soft ?? 0.009,
    rim: input.rim ?? 0.42,
    weight: input.weight ?? 1,
    mirror: input.mirror ?? false,
    paper: input.paper,
    draw: input.draw,
    outline,
    print,
  };
}

export interface ArtSheetOptions {
  /** Enlarges or shrinks the drawing. 1 by default. */
  readonly scale?: number;
  /** Mirrors the drawing left to right. */
  readonly flip?: boolean;
  /** True on phones: half the canvas. */
  readonly phone?: boolean;
  readonly seed?: number;
}

function mirrored(draw: Draw2D): Draw2D {
  return (ctx, width, height) => {
    ctx.save();
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
    draw(ctx, width, height);
    ctx.restore();
  };
}

/** Canvas pixels per scene unit for a drawing whose longer side is `longest` scene units. */
export function resolutionFor(longest: number, phone = false): number {
  // Small props are seen from close by when the walker passes them, so they get more pixels per unit.
  const wanted = Math.min(1100, Math.max(280, 380 / Math.max(0.05, longest)));
  return phone ? wanted * 0.6 : wanted;
}

/**
 * How far the cut of a sheet strays, as `buildSheet` takes it: a share of the longer side. Scissors stray by
 * about the same length whatever they cut, so a long thin sheet (a post, an arm, a stick) gets a smaller share,
 * or its edge would be chewed away.
 */
export function deckleFor(width: number, height: number): number {
  const longer = Math.max(width, height, 1e-6);
  const shorter = Math.max(1e-6, Math.min(width, height));
  return Math.min(0.0042, Math.max(0.0012, (0.028 * shorter) / longer, 0.0016 / longer));
}

/** The sheet of a drawing: hand the result to `buildSheet`. */
export function artSheetSpec(
  art: Pick<PropArt, 'size' | 'outline' | 'print' | 'paper' | 'soft' | 'rim' | 'sway' | 'pose'>,
  options: ArtSheetOptions = {},
): SheetSpec {
  const scale = options.scale ?? 1;
  const width = art.size.width * scale;
  const height = art.size.height * scale;
  const flip = options.flip ?? false;
  return {
    width,
    height,
    outline: flip ? mirrored(art.outline) : art.outline,
    print: flip ? mirrored(art.print) : art.print,
    paper: art.paper,
    soft: art.soft * scale,
    rim: art.rim,
    sway: art.sway,
    resolution: resolutionFor(Math.max(width, height), options.phone),
    seed: options.seed ?? 0,
    // A small sheet is stiffer than a large one: the bend is given as a length, so it shrinks with the sheet.
    warp: 0.026 * Math.min(1, Math.max(0.2, height / 1.2)),
    // A lake has no foot to shade.
    ...(art.pose === 'tip' ? { hinge: 0 } : {}),
    // Scissors, not fingers: a prop is cut a little cleaner than a torn map sheet.
    deckle: deckleFor(width, height),
    standing: true,
  };
}
