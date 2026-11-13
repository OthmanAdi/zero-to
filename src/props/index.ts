/**
 * Props, signposts and stations: everything that stands on the paper map as a cut-out.
 *
 * - `PROPS` is the scenery by ground surface, and `sceneryFor` lays it out for one panel from a seed.
 * - `SIGNPOSTS` are the checkpoint signposts a roadmap can choose, described in `SIGNPOST_CATALOGUE`.
 * - `createSignpost`, `createStageBoard`, `createCamp`, `createCairn`, `createClassFlag`, `createWalker` and
 *   `createStation` build the pieces that carry a learning action.
 *
 * Every piece is a `ScenePart`: add `object` to the scene, call `update` once per frame, `dispose` at the end.
 * Every piece starts lying on the map (the walker starts standing) and stands up with `setUp(true)`.
 */
export { DESIGN, playDrawing, sheetDrawings, type Brush, type Drawing, type Path } from './brush';
export {
  artSheetSpec,
  deckleFor,
  defineProp,
  resolutionFor,
  type ArtSheetOptions,
  type PropArt,
  type PropInput,
  type PropLayer,
  type PropPose,
  type PropSize,
  type PropSurface,
} from './art';
export { PROPS, PROP_SURFACES, allProps, isPropSurface, propById, propsFor } from './registry';
export { TIP_RISE, createProp, type PropOptions, type PropPart } from './prop';
export { STAND, createStand, hitSheet, wobbleAmplitude, wobbleAngle, wobbleRate, type Stand, type StandOptions } from './stand';
export {
  MAX_SCENERY,
  NEAR_LEAD,
  createScenery,
  sceneryFor,
  type SceneryItem,
  type SceneryOptions,
  type SceneryPart,
  type SceneryTrigger,
} from './scenery';
export {
  DEFAULT_SIGNPOST,
  MAX_ARMS,
  SIGNPOSTS,
  SIGNPOST_CATALOGUE,
  SIGNPOST_KEYS,
  THEME_SIGNPOSTS,
  isSignpostKey,
  resolveSignpost,
  signpostStyle,
  type ArmAnchor,
  type ArmLook,
  type ArmShape,
  type SignpostCatalogueEntry,
  type SignpostKey,
  type SignpostStyle,
} from './signposts';
export { ARM_TEXT, breakPieces, layoutArmText, type ArmText, type ArmTextBox, type Measure } from './arm-text';
export { ARM, armLength, armSwingAt, createSignpost, type SignpostOptions, type SignpostPart } from './signpost';
export {
  BOARD,
  createStageBoard,
  stageBoardText,
  type StageBoardFacts,
  type StageBoardOptions,
  type StageBoardPart,
  type StageBoardText,
} from './board';
export {
  CAMP,
  DUE_RING,
  MAX_RUNGS,
  createCairn,
  createCamp,
  type CairnOptions,
  type CairnPart,
  type CampOptions,
  type CampPart,
} from './camp';
export { CLASS_FLAG, createClassFlag, type ClassFlagOptions, type ClassFlagPart } from './class-flag';
export { WALKER, createWalker, walkCycle, type WalkPose, type WalkerOptions, type WalkerPart } from './walker';
export {
  CARRIES,
  STATION,
  createStation,
  type CarryKind,
  type StationKind,
  type StationOptions,
  type StationPart,
} from './station';
export { PROPS_STRINGS } from './strings';
