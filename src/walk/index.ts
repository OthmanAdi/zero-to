/**
 * The walk: the folded map of one roadmap, opened panel by panel, with a paper walker on the dashed route.
 *
 * - `createWalk` builds the part. It never moves the camera: it solves the rail and the host applies it.
 * - `foldSchedule`, `stageWindows`, `railAt`, `stripFrame` and `itemAt` are the walk as plain numbers.
 */
export {
  FOLD,
  PANEL,
  clampPanels,
  coverAngle,
  coverHeight,
  coverOpen,
  creaseAngle,
  creaseOpen,
  foldSchedule,
  panelAngles,
  panelLanded,
  restAngle,
  settleAt,
  stackOffset,
  type CreaseSchedule,
  type FoldSchedule,
  type FoldWindow,
} from './fold';
export {
  PLACE,
  SHARE,
  STRETCH,
  WALK,
  evenWindows,
  fForMinutes,
  itemAt,
  itemMiddle,
  mapOpenAt,
  minutesShareAt,
  pathAt,
  pathForMinutes,
  progressAt,
  railAt,
  sceneAt,
  stageAt,
  stageItems,
  stageWeight,
  stageWindows,
  type ItemHit,
  type ItemSpan,
  type StagePlace,
  type StageWindow,
  type StageWindows,
  type WalkItem,
} from './timeline';
export {
  MODEL,
  STRIP,
  mountainUnder,
  stripCards,
  stripFrame,
  stripGround,
  stripPointAt,
  stripRoute,
  type StripCards,
  type StripFrame,
  type StripGround,
  type StripPoint,
  type StripRoute,
} from './strip';
export { LANDING, RAIL, cameraAt, landingPose, panelLeft, panelPoints, railPoses, type LandingInput, type WalkInsets } from './rail';
export {
  hereAt,
  panelRoutePoints,
  pathPoint,
  placeAt,
  planWalk,
  progressForAlong,
  progressForItem,
  type HerePlace,
  type PanelMark,
  type PanelPlan,
  type PanelPoint,
  type PathPoint,
  type PlanOptions,
  type WalkPlace,
  type WalkPlan,
} from './plan';
export { MINI, PRINT, cardTones, miniPixel, miniWindow, paintCardTops, paintLegend, paintMiniMap, paintPanel, panelContours, panelPaper, type ContourLine } from './print';
export { CARDS, createCardModel, type CardModel } from './cards';
export { SCENE, createPanelView, type PanelView, type WalkHit, type WalkHitKind } from './panel';
export {
  WALKER_ON_MAP,
  WALK_LIGHT,
  createWalk,
  type WalkInput,
  type WalkMiniMap,
  type WalkPart,
  type WalkProjection,
  type WalkScreenPoint,
  type WalkTarget,
} from './walk';
export { WALK_STRINGS, say as sayWalk } from './strings';
