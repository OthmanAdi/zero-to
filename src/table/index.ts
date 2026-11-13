/**
 * The hero: a round walnut turntable under one lamp, the compass floating over its middle, and the roadmaps
 * lying round it as shut pocket maps. The sheet in the light grows its paper mountain out of its own printed
 * contours.
 */
export {
  AUTO_TURN,
  EXIT,
  HOVER,
  INTRO,
  createTable,
  type ScreenPoint,
  type TableAnchor,
  type TableEnter,
  type TableHit,
  type TableHitKind,
  type TableOptions,
  type TablePart,
} from './table';
export {
  DIM_FLOOR,
  DIM_OVER,
  TURN,
  clampSheetCount,
  createTurntable,
  sheetScale,
  shortestSteps,
  slotPose,
  wrapDegrees,
  type PickBy,
  type SlotPose,
  type Turntable,
} from './turntable';
export {
  GROW,
  cardCount,
  cardShape,
  countUp,
  createGrowthClock,
  growCard,
  mountainHeight,
  tierSummit,
  type CardShape,
  type GrowthClock,
} from './grow';
export { estimateTextWidth, layoutTitle, titleChunks, type TitleBox, type TitleLayout } from './title';
export {
  COVER,
  FIELD_OFFSET,
  coverLayout,
  paintCover,
  titleMeasure,
  type CoverLayout,
  type CoverPrint,
  type CoverRect,
  type CoverSpec,
  type CoverText,
} from './cover';
export {
  deriveSheet,
  paperHalf,
  stageOfCard,
  stageStartShare,
  stopHeights,
  tracePrint,
  trailAlong,
  type SheetData,
  type SheetPrint,
  type SheetSpec,
} from './sheet-data';
export { readoutFor, type ReadoutParts } from './readout';
export { HERO_CAMERA, createHeroCamera, heroPose, heroShot, introPush, isNarrow, type HeroCamera, type HeroCameraInput, type HeroPoseOptions, type HeroShot } from './camera';
export { createMountain, type Mountain } from './mountain-port';
export { PIN, createPin, type Pin } from './pin';
export { LAMP_RIG, createLamp, type LampRig, type LampState } from './lamp';
export { ROOM, ROOM_ENV, createCloth, createTableTop } from './room';
export { SHEET, bodyGeometry, createTableSheet, sheetThickness, type TableSheet } from './sheet';
export { TABLE_STRINGS, say as sayTable } from './strings';
