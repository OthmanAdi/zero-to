/**
 * The overlay: everything the visitor reads and touches on top of the 3D scene. See `hud.ts` for the whole, and
 * the files beside it for each part.
 */
export { createHud, INTRO, mainVolumes, tableVolumes, walkVolumes, type Hud, type HudAnchors, type HudInsets, type HudOptions, type HudPoint, type HudRect } from './hud';
export { createHudBus, type HudBus, type HudBy, type HudEvent, type HudEventType, type HudMode } from './bus';
export {
  PROFILE,
  alongAt,
  createProfile,
  profileGeometry,
  type Profile,
  type ProfileBand,
  type ProfileCamp,
  type ProfileDue,
  type ProfileGeometry,
  type ProfileMark,
  type ProfileOptions,
  type ProfilePoint,
} from './profile';
export {
  NOTE,
  NOTE_TABS,
  createNote,
  itemKey,
  noteWidth,
  pickNoteSide,
  sideBox,
  type HudItem,
  type MiniMapMark,
  type NoteFrame,
  type NoteOptions,
  type NoteSide,
  type NoteTab,
  type SideBox,
  type WeightedPoint,
} from './note';
export { POP, createHero, popKeyframes, words, type HeroCopy, type HeroText } from './hero';
export { CARD_STAGGER, createSideCard, pinLine, pinStage, type HudRoadmap, type SideCard } from './side-card';
export {
  CREASE,
  ENTER,
  createCounter,
  createCreaseArrow,
  createEnterButton,
  enterLabel,
  enterState,
  type Counter,
  type CreaseArrow,
  type EnterButton,
  type EnterState,
} from './controls';
export {
  createPanel,
  factsList,
  fillOpen,
  fillShare,
  fillShortcuts,
  fragmentOf,
  readFileText,
  readLink,
  roadmapFacts,
  shareUrl,
  shortcutRows,
  type OpenDialog,
  type OpenOptions,
  type Panel,
  type ReadResult,
  type RoadmapFacts,
  type ShareOptions,
} from './dialogs';
export { resourceNoteKey, shelfSessionOf, usedKey } from './shelf-session';
export { HUD_STRINGS, LABEL_BUDGET, say as sayHud, tierKey, type HudKey } from './strings';
