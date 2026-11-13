/**
 * The learning core: one session per learner and roadmap, the only writer of progress, and the cards every view
 * places. The map view (floating note, signpost, camp, cairn) and the list view use the same components, so the
 * two never show different state.
 */
export {
  createSession,
  findStage,
  findWaypoint,
  NOTE_MAX,
  planKey,
  progressKey,
  type Session,
  type SessionAction,
  type SessionChange,
  type SessionOptions,
  type StartOptions,
} from './session';
export {
  applyPlan,
  paceChoices as paceChoicesFor,
  paceWith,
  REAL_PACE_AFTER,
  topTier,
  type PaceChoice,
  type PaceChoiceKind,
  type Plan,
  type PlanChange,
  type SessionPace,
} from './pace';
export {
  clip,
  createNotebook,
  escapeMarkdown,
  NOTEBOOK_KINDS,
  NOTEBOOK_MAX_ENTRIES,
  NOTEBOOK_MAX_TEXT,
  notebookKey,
  notebookToMarkdown,
  pinId,
  safeUrl,
  unescapeMarkdown,
  type MarkdownOptions,
  type Notebook,
  type NotebookDraft,
  type NotebookEntry,
  type NotebookKind,
} from './notebook';
export { memoryStorage, safeStore, type SafeStore, type StorageLike, type StorageState } from './storage';
export { GO_EVENT, type CardOptions, type GoDetail, type HeadingLevel, type MountedCard } from './dom';
export { waypointCard, predictKey, predictState, predictCheckIndex, type PredictState, type WaypointCard } from './waypoint-card';
export { signpostCard, needToPass } from './signpost-card';
export { campCard } from './camp-card';
export { reviewCard, reviewSitting, nextReviewDay, REVIEW_MINUTES_PER_CHECK, SITTING_MINUTES, type ReviewCardOptions, type Sitting } from './review-card';
export { paceChoices, type PaceChoicesOptions } from './pace-choices';
export { notebookPanel, notebookFileName, type NotebookPanelOptions } from './notebook-panel';
export { storageNotice } from './notice';
export { classPlace, latestSession, type ClassPlace } from './class-flag';
export { ratingName, RATINGS } from './rating';
export { resourceLine, statusSentence, languageName } from './resources';
export { LEARN_STRINGS, say as learnSay, type LearnKey } from './strings';
