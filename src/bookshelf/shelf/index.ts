/**
 * Shelf module: draws volumes for a pose and reports intents.
 * It has no gestures and no storage, and keeps time only while volumes find
 * their places after the items change.
 */
export { mountShelf } from './shelf';
export { COVER_ASPECT, createCover, createCoverArt, type CoverOptions } from './cover-art';
// What a host needs to describe an item the way the shelf will draw it: the imprint a link's site gives
// its volumes, the series they fall into, and the shape of a saved text for the plate of its cover.
export { hashText, imprintOf, seriesOf, type Imprint } from './imprint';
export { outlineOf, OUTLINE_LIMIT } from './cover-outline';
export { DEFAULT_LAMP, DEFAULT_LIGHT, faceShades, lampReach, sheenOf, sweepOf, type FaceShades } from './light';
export {
  computeRow,
  computeStandingRow,
  fitGeometry,
  focusWeight,
  gapWeight,
  grabbedX,
  LOOP_FILL,
  pitchAt,
  restLength,
  restPitch,
  rowLoops,
  rowStands,
  scaleGeometry,
  slotAdvance,
  solvePosition,
  turnedWidth,
  visibleRange,
  volumeSize,
  type SizeOf,
  type SlotPose,
  type StandingRow,
  type VolumeSize,
} from './layout';
export {
  CLOTHS,
  DEFAULT_VARIANT,
  listVariants,
  PATTERNS,
  resolveCloth,
  resolvePattern,
  resolveVariant,
  VARIANTS,
  type ClothName,
  type PatternName,
} from './variants';
export type {
  Box,
  CoverPlacement,
  Geometry,
  GrabStart,
  ItemsChange,
  Light,
  Pose,
  ShelfHandle,
  ShelfIntent,
  ShelfItem,
  ShelfOptions,
  Unsubscribe,
  Variant,
  VariantMotion,
} from './types';
