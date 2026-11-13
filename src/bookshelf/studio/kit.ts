import type { WebGLRenderer } from 'three';
import type { FrameVolume } from '../shelf/types';
import { type DressKit, styleOf } from './dress';
import { createMaterialKit, resolveBinding, resolveStamp } from './materials';
import { paintVolume } from './paint';
import { isStamp, type Binding, type Stamp } from './types';

/**
 * The kit Studio dresses volumes with: faces painted by the painter, lit by the generated materials.
 * The binding and stamp of an item are its own when it names known ones, else they follow from its
 * seed, so a shelf is mixed but the same on every visit.
 */

/** Relative luminance of a `#rgb` or `#rrggbb` colour, 0 to 1. Anything else counts as mid grey. */
export function luminance(color: string): number {
  const hex = color.trim().replace('#', '');
  const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return 0.2;
  const channel = (at: number): number => {
    const value = parseInt(full.slice(at, at + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/**
 * How each foil reads on a resting spine, on average over what it mirrors: the colour to test its
 * legibility with. Sampled from spine titles painted in the four looks, the letters' brightest twenty-fifth.
 */
export const FOIL_READS: Record<'gold' | 'silver' | 'copper' | 'holo', string> = { gold: '#e4c06a', silver: '#e4e1db', copper: '#d49a78', holo: '#dcdce0' };
/** A spine title is how a link is found, so a stamp chosen for the person must stand at least this far off its cloth. */
export const LEGIBLE = 4.5;
/** Foil letters smaller than this, in CSS px, break up into glints: such a title is printed. */
export const FOIL_TITLE_SIZE = 14;

/** What else decides a stamp besides the cloth. */
export interface StampNeeds {
  /** The colour the look prints on this cloth. Given it, a foil is kept in the last resort only if it reads better than ink. */
  ink?: string;
  /** Size of the spine title in CSS px. */
  titleSize?: number;
  /** The person asked their system for more contrast. */
  contrastMore?: boolean;
}

/**
 * The stamp a volume gets when its item names none: the binder's first choice if its title can be read
 * on this cloth, else the first foil that can, else printed ink, which every look pairs with its cloth.
 * A small spine title and a person who asked for more contrast always get ink. Blind stamping is never
 * chosen for anyone: a title pressed without colour cannot be read from a spine.
 */
export function legibleStamp(first: Stamp, cloth: string, needs: StampNeeds = {}): Stamp {
  if (needs.contrastMore || (needs.titleSize !== undefined && needs.titleSize < FOIL_TITLE_SIZE)) return 'ink';
  const reads = (stamp: Stamp): number => (stamp === 'ink' || stamp === 'blind' ? 0 : contrast(FOIL_READS[stamp], cloth));
  if (first === 'ink' || reads(first) >= LEGIBLE) return first;
  const foils = ['gold', 'silver', 'copper'] as const;
  for (const stamp of foils) if (reads(stamp) >= LEGIBLE) return stamp;
  if (needs.ink === undefined) return 'ink';
  // Nothing reaches the mark. Ink still wins unless a foil clearly reads better than this look's ink does.
  let best: Stamp = 'ink';
  let most = contrast(needs.ink, cloth);
  if (most >= LEGIBLE) return 'ink';
  for (const stamp of foils) if (reads(stamp) > most) [best, most] = [stamp, reads(stamp)];
  return best;
}

export function bindingFor(item: FrameVolume['item'], cloth?: string, needs: StampNeeds & { look?: string } = {}): { binding: Binding; stamp: Stamp } {
  const seed = Math.abs(Math.floor(item.seed ?? 0));
  const binding = resolveBinding(item.binding, seed, needs.look);
  const stamp = resolveStamp(item.stamp, binding, seed);
  // What the person chose stands as chosen, readable or not.
  if (isStamp(item.stamp)) return { binding, stamp };
  // A board of metal or holographic foil is bright whatever its cloth colour: its title is printed, and
  // the material lays that print down in a dark ink.
  if (binding === 'foil' || binding === 'holo') return { binding, stamp: 'ink' };
  return { binding, stamp: cloth === undefined ? stamp : legibleStamp(stamp, cloth, needs) };
}

/** Size of the spine title the shelf has set for a volume, in CSS px, or nothing when the spine carries a label. */
function titleSizeOf(element: HTMLElement): number | undefined {
  const title = element.querySelector('.bb-spine__title');
  if (!title) return undefined;
  const size = parseFloat(getComputedStyle(title).fontSize);
  return Number.isFinite(size) && size > 0 ? size : undefined;
}

/**
 * A volume that says how near it is shown: 0 standing in the row, 1 shown large (the Showcase). The
 * shelf's own volumes leave it out; their spines count as far off and their boards as taken in the hand.
 */
export type ShownVolume = FrameVolume & { presented?: number };

/** Half-size textures where memory is short or the screen is small: a phone shows no more detail anyway. */
export function qualityFor(): 'high' | 'low' {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const small = Math.min(window.innerWidth, window.innerHeight) < 500;
  return small || (memory !== undefined && memory <= 4) ? 'low' : 'high';
}

/**
 * The real spine is bowed a little in the mesh already; the material adds the rest of the roundness
 * to its normals, so the highlight runs down the spine as a soft line.
 */
const SPINE_ROUND = 0.22;

export function createKit(renderer: WebGLRenderer, quality: 'high' | 'low' = qualityFor()): DressKit {
  const materials = createMaterialKit(renderer, { quality });
  // Asked for every volume in every frame, so the cloth is read from the page once per volume and look.
  const chosen = new Map<string, { binding: Binding; stamp: Stamp }>();
  const contrastMore = typeof matchMedia === 'function' ? matchMedia('(prefers-contrast: more)') : null;
  return {
    bindingOf(volume, variant = '') {
      const item = volume.item;
      const more = contrastMore?.matches ?? false;
      // The title is set to fit the spine, so its size can change with the spine's width.
      const key = `${item.id}|${variant}|${item.cloth ?? ''}|${item.binding ?? ''}|${item.stamp ?? ''}|${item.seed ?? 0}|${Math.round(volume.spineWidth)}|${more ? 1 : 0}`;
      let choice = chosen.get(key);
      if (!choice) {
        if (chosen.size > 600) chosen.clear();
        const style = styleOf(volume.element);
        choice = bindingFor(item, style.cloth, { look: variant, ink: style.ink, titleSize: titleSizeOf(volume.element), contrastMore: more });
        chosen.set(key, choice);
      }
      return choice;
    },
    paint: ({ volume, size, binding, stamp, density }) =>
      paintVolume({ item: volume.item, source: volume.element, size, binding, stamp, density }),
    materials: (volume, style, binding, stamp, faces) =>
      materials.volume(
        {
          binding,
          stamp,
          cloth: style.cloth,
          ink: style.ink,
          seed: Math.abs(Math.floor(volume.item.seed ?? 0)),
          size: { spineWidth: volume.spineWidth, bookHeight: volume.bookHeight, coverWidth: volume.coverWidth },
          spineRound: SPINE_ROUND,
          presented: (volume as ShownVolume).presented,
          handled: volume.item.handled,
          age: volume.item.age,
        },
        faces,
      ),
    get environment() {
      return materials.environment;
    },
    floor: (variant, size) => materials.floor(variant, size),
    dispose: () => materials.dispose(),
  };
}
