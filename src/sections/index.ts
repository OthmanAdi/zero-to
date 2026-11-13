/**
 * The landing sections: the page under the hero, where a red thread runs from stop to stop.
 *
 * `mountSections(root, options)` builds the eight stops, the index tabs and the footer into `root` and returns
 * `{ update(scrollProgress), setLang, destroy }` with a few more handles. The page's owner turns its scroll
 * into a progress with `progressAt` and calls `update` once per frame.
 */
export { DEFAULT_LINKS, mountSections, type GalleryExample, type SectionLinks, type Sections, type SectionsOptions } from './mount';
export {
  FLOW,
  PHONE_FIRST_GAP,
  STOPS,
  STOP_IDS,
  boxLeg,
  currentStop,
  decorate,
  goDuration,
  holdRange,
  indexAt,
  isUp,
  legPoints,
  linkAge,
  localScroll,
  pieceRange,
  pointAt,
  polyline,
  progressFromScroll,
  stopState,
  threadHead,
  threadLength,
  type Deco,
  type LegShape,
  type LinkAge,
  type PathPoint,
  type Point,
  type Polyline,
  type StopId,
  type StopPhase,
  type StopSpan,
  type StopSpec,
  type StopState,
  type ThreadHead,
  type ThreadPiece,
} from './model';
export { AUDIENCES, HOURS, TOPIC_MAX, cleanTopic, quoteTopic, ticketCommand, ticketReady, type Audience, type TicketChoice } from './command';
export { GROUNDS, INSTALL_PATHS, MAP_THEMES, POSTS, QUESTIONS, SHAPES, SKILLS_COMMAND, TIERS, TRAILS, type InstallPath } from './stops';
export { hasSectionWords, loadSectionWords, say as saySections, type SectionKey } from './strings';
