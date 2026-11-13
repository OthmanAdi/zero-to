/**
 * Which binding and stamp a volume gets when its item names none. The answer follows from the item's
 * seed alone, so a volume keeps its binding from one visit to the next. No three.js, no DOM.
 */
import { isBinding, isStamp, type Binding, type Stamp } from '../types';
import { hash1 } from './noise';

type Weighted<T> = readonly (readonly [T, number])[];

/**
 * A shelf is mostly cloth and linen, with some leather and paper and a few laminates. A whole board of
 * metal or holographic foil is a showpiece: about one volume in fifty. Holographic foil mostly comes as
 * a stamp, on cloth or on gloss, where it has a matt ground to stand against.
 */
export const BINDING_WEIGHTS: Weighted<Binding> = [
  ['cloth', 38],
  ['linen', 22],
  ['leather', 13],
  ['paper', 13],
  ['gloss', 9],
  ['velvet', 3],
  ['foil', 1.2],
  ['holo', 0.8],
];

/**
 * What a look binds its volumes in when it is not the mixed shelf above. Pocket Paperbacks are printed
 * card, matt or laminated: no cloth, no leather, no velvet.
 */
export const LOOK_BINDING_WEIGHTS: Readonly<Record<string, Weighted<Binding>>> = {
  pocket: [
    ['paper', 62],
    ['gloss', 38],
  ],
};

/** What a binder would put on each binding. A stamp that cannot be seen on a binding is left out. */
export const STAMP_WEIGHTS: Record<Binding, Weighted<Stamp>> = {
  cloth: [['gold', 34], ['ink', 24], ['blind', 13], ['silver', 12], ['copper', 10], ['holo', 7]],
  linen: [['ink', 34], ['blind', 22], ['gold', 20], ['copper', 14], ['silver', 10]],
  leather: [['gold', 55], ['blind', 25], ['silver', 10], ['copper', 10]],
  paper: [['ink', 68], ['blind', 14], ['gold', 10], ['copper', 8]],
  gloss: [['ink', 52], ['holo', 20], ['silver', 14], ['gold', 14]],
  velvet: [['gold', 60], ['silver', 25], ['copper', 15]],
  foil: [['ink', 55], ['blind', 45]],
  holo: [['ink', 60], ['blind', 40]],
};

function pick<T>(weights: Weighted<T>, at: number): T {
  let total = 0;
  for (const [, weight] of weights) total += weight;
  let rest = at * total;
  for (const [value, weight] of weights) {
    rest -= weight;
    if (rest < 0) return value;
  }
  return weights[weights.length - 1]![0];
}

/**
 * Deterministic choice when an item names no binding. Same seed and look, same answer. A binding the
 * item names stands in every look.
 */
export function resolveBinding(binding: string | undefined, seed: number, look?: string): Binding {
  if (isBinding(binding)) return binding;
  const weights = look !== undefined && Object.hasOwn(LOOK_BINDING_WEIGHTS, look) ? LOOK_BINDING_WEIGHTS[look]! : BINDING_WEIGHTS;
  return pick(weights, hash1(seed, 1));
}

/** Deterministic choice of stamp for a binding when an item names none. Same seed, same answer. */
export function resolveStamp(stamp: string | undefined, binding: Binding, seed: number): Stamp {
  if (isStamp(stamp)) return stamp;
  return pick(STAMP_WEIGHTS[binding], hash1(seed, 2));
}
