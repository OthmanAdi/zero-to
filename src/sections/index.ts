/**
 * The landing sections: the page under the hero, where a red thread runs from stop to stop.
 *
 * `mountSections(root, options)` builds the eight stops, the index tabs and the footer into `root` and returns
 * `{ update(scrollProgress), setLang, setRoadmap, destroy }` with a few more handles. The page's owner turns its
 * scroll into a progress with `progressAt` and calls `update` once per frame.
 *
 * The stops have two modes. Without a roadmap they explain the skill, as they do under the gallery. With
 * `options.roadmap`, or after `setRoadmap`, they are the trip brief of that roadmap.
 *
 * This file is what a page fetches, so it exports what a page uses and no more. The numbers of the thread and
 * the lists of the stops are imported from `model.ts`, `stops.ts` and `command.ts` by whoever needs them.
 */
export { DEFAULT_LINKS, mountSections, type GalleryExample, type SectionLinks, type Sections, type SectionsOptions } from './mount';
export { STOPS, type StopId, type StopSpec } from './model';
export { loadSectionWords, say as saySections, type SectionKey } from './strings';
export type { BriefAction, BriefOptions } from './brief';
export type { OwnPlan, SourceReceipt } from './brief-model';
export type { StartChoice } from './brief-permit';
