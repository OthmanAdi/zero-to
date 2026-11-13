/**
 * Motion module: time, springs and pointer input. It has no idea what is being
 * moved. A renderer subscribes to the state and draws it.
 */
export { browserClock, createManualClock, type Clock, type ManualClock } from './clock';
export { attachDrag, type DragHandlers, type DragOptions, type DragOrigin } from './gesture';
export {
  clamp,
  easeInOutCubic,
  easeOutCubic,
  lerp,
  linear,
  SETTLE_SPRING,
  smoothstep,
  stepSpring,
  wrapIndex,
  type Easing,
  type SpringConfig,
  type SpringState,
} from './spring';
export {
  createShelfMotion,
  DEFAULT_TIMING,
  type AttachOptions,
  type TrackStart,
  type MotionTiming,
  type TravelTiming,
  type ShelfMotion,
  type ShelfMotionOptions,
  type ShelfMotionState,
  type Unsubscribe,
} from './shelf-motion';

/** Live reading of the reduced-motion preference, safe where `matchMedia` is missing. */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
