import { Group, type Raycaster } from 'three';
import { fork, range, type Random } from '../core/random';
import type { FrameTime, ScenePart } from '../scene/contract';
import type { PropArt } from './art';
import { createProp, type PropPart } from './prop';
import { PROPS, propsFor } from './registry';

/**
 * Scenery for one panel of the map, from its ground surface and a seed.
 *
 * The scenery follows the surface and nothing else: the same surface and seed always give the same props in
 * the same places, whatever the roadmap is about. A panel gets one skyline at the back when its surface has
 * one, then a spread of middle and front props, and a cloud or two above.
 */
export type SceneryTrigger =
  /** Stands up when the scene has unfolded this far (0 to 1). */
  | { readonly kind: 'fraction'; readonly at: number }
  /** Stands up when the walker comes within `lead` scene units of it. */
  | { readonly kind: 'near'; readonly lead: number }
  /** Stands up when the walker reaches the end of the panel. */
  | { readonly kind: 'end' };

export interface SceneryItem {
  readonly art: PropArt;
  /** Across the panel, 0 at the left edge to 1 at the right. */
  readonly x: number;
  /** Into the scenery band, 0 at the back to 1 at the front, next to the trail. */
  readonly z: number;
  readonly scale: number;
  readonly flip: boolean;
  /** Seed of the sheet: its bend, its tear and its sway. */
  readonly seed: number;
  readonly trigger: SceneryTrigger;
}

/** How near the walker has to come before a prop by the trail stands up, in scene units. */
export const NEAR_LEAD = 0.76;
/** From this width on a drawing counts as wide, and a panel gets it once. */
const WIDE = 1;
/** The most props one panel is given. */
export const MAX_SCENERY = 24;

function weighted(random: Random, arts: readonly PropArt[]): PropArt {
  const total = arts.reduce((sum, art) => sum + art.weight, 0);
  let at = random() * total;
  for (const art of arts) {
    at -= art.weight;
    if (at <= 0) return art;
  }
  return arts[arts.length - 1] as PropArt;
}

/**
 * Chooses and places `count` props for a panel whose ground is `surface`. An unknown surface gets grass.
 * The result is the same for the same surface, seed and count.
 */
export function sceneryFor(surface: string, seed: number | string, count: number): SceneryItem[] {
  const wanted = Math.min(MAX_SCENERY, Math.max(0, Math.floor(Number.isFinite(count) ? count : 0)));
  if (wanted === 0) return [];
  const arts = propsFor(surface);
  const random = fork(seed, `props/scenery/${surface}`);
  const chosen: PropArt[] = [];

  // One skyline, when the surface has one and there is room for more than it.
  const skylines = arts.filter((art) => art.layer === 'back');
  if (skylines.length > 0 && wanted >= 3) chosen.push(weighted(random, skylines));
  // One thing in the sky for every five props, from four props up.
  const sky = wanted >= 4 ? Math.max(1, Math.floor(wanted / 5)) : 0;
  for (let i = 0; i < sky && chosen.length < wanted; i += 1) chosen.push(weighted(random, PROPS.sky));
  // The rest stands on the ground. No drawing more than twice in a row.
  const ground = arts.filter((art) => art.layer !== 'back');
  const pool = ground.length > 0 ? ground : arts;
  let last: PropArt | null = null;
  let run = 0;
  const wideUsed = new Set<PropArt>();
  while (chosen.length < wanted) {
    // A wide drawing (a lake, a dune, a bank) stands once on a panel, or two of them would pile up.
    const narrow = pool.filter((art) => !wideUsed.has(art));
    const from = narrow.length > 0 ? narrow : pool;
    let art = weighted(random, from);
    if (art === last && run >= 2 && from.length > 1) art = weighted(random, from.filter((other) => other !== last));
    run = art === last ? run + 1 : 1;
    last = art;
    if (art.size.width >= WIDE) wideUsed.add(art);
    chosen.push(art);
  }

  // Spread across the panel: every prop gets a slot of its own, then moves a little inside it.
  const slots = chosen.map((_, index) => index);
  for (let i = slots.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [slots[i], slots[j]] = [slots[j] as number, slots[i] as number];
  }
  const items = chosen.map((art, index): SceneryItem => {
    const slot = slots[index] as number;
    const x = (slot + range(random, 0.2, 0.8)) / chosen.length;
    const hang = art.pose === 'hang';
    const z = art.layer === 'back' ? range(random, 0, hang ? 0.3 : 0.12) : art.layer === 'mid' ? range(random, 0.22, 0.6) : range(random, 0.5, 1);
    const roll = random();
    const trigger: SceneryTrigger =
      art.layer === 'back' ? { kind: 'fraction', at: range(random, 0, 0.1) } : roll < 0.12 ? { kind: 'end' } : art.layer === 'mid' ? { kind: 'fraction', at: 0.1 + 0.5 * x } : { kind: 'near', lead: NEAR_LEAD };
    return {
      art,
      x: art.layer === 'back' && !hang ? 0.3 + 0.4 * x : x,
      z,
      scale: Math.round(range(random, 0.86, 1.14) * 100) / 100,
      flip: art.mirror && random() < 0.5,
      seed: Math.floor(random() * 0xffff),
      trigger,
    };
  });
  // Back to front, so whoever stands them up can rank them as they come.
  return items.sort((a, b) => a.z - b.z || a.x - b.x);
}

export interface SceneryOptions {
  /** Width and depth of the band the scenery stands in, in scene units. */
  readonly width: number;
  readonly depth: number;
  readonly phone?: boolean;
  /** Height of the wires that carry the sky. */
  readonly wire?: number;
}

export interface SceneryPart extends ScenePart<Group> {
  readonly items: readonly SceneryItem[];
  readonly props: readonly PropPart[];
  /** How far the scene has unfolded, 0 to 1. Skylines and middle props stand up as it grows. */
  setFold(fold: number): void;
  /** Where the walker is across the band, in scene units from its middle. Props by the trail stand up as he nears. */
  setWalker(x: number | null): void;
  /** True once the walker has reached the end of the panel. */
  setEnd(end: boolean): void;
  /** Stands everything up or lays everything down at once, with no motion. */
  settle(): void;
  /** Wobbles the prop under the ray and returns it, or null. */
  tap(raycaster: Raycaster): PropPart | null;
}

/** Builds the props of `sceneryFor` and stands them up by their triggers. The band is centred on the origin. */
export function createScenery(items: readonly SceneryItem[], options: SceneryOptions): SceneryPart {
  const object = new Group();
  const props = items.map((item, index) => {
    const prop = createProp(item.art, { scale: item.scale, flip: item.flip, seed: item.seed, phone: options.phone, wire: (options.wire ?? 0.7) + (item.seed % 5) * 0.06 });
    // A hair of height per rank, so sheets lying on each other never share a depth.
    prop.object.position.set((item.x - 0.5) * options.width, index * 0.0012, (item.z - 0.5) * options.depth);
    object.add(prop.object);
    return prop;
  });
  let fold = 0;
  let walker: number | null = null;
  let end = false;

  const wants = (item: SceneryItem): boolean => {
    switch (item.trigger.kind) {
      case 'fraction':
        return fold > item.trigger.at + 0.08;
      case 'near': {
        if (fold <= 0.35 || walker === null) return false;
        return (item.x - 0.5) * options.width - walker < item.trigger.lead;
      }
      case 'end':
        return fold > 0.35 && end;
    }
  };
  const retarget = () => {
    items.forEach((item, index) => {
      const prop = props[index] as PropPart;
      const up = wants(item);
      if (prop.standing !== up) prop.setUp(up);
    });
  };

  return {
    object,
    items,
    props,
    setFold(next) {
      fold = Math.min(1, Math.max(0, next));
      retarget();
    },
    setWalker(x) {
      walker = x;
      retarget();
    },
    setEnd(next) {
      end = next;
      retarget();
    },
    settle() {
      items.forEach((item, index) => (props[index] as PropPart).setUp(wants(item), true));
    },
    tap(raycaster) {
      let best: PropPart | null = null;
      let nearest = Infinity;
      for (const prop of props) {
        const distance = prop.hit(raycaster);
        if (distance !== null && distance < nearest) {
          best = prop;
          nearest = distance;
        }
      }
      best?.tap();
      return best;
    },
    update(frame: FrameTime) {
      for (const prop of props) prop.update(frame);
    },
    dispose() {
      for (const prop of props) prop.dispose();
    },
  };
}
