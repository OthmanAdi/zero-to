/**
 * The outline package: the roadmap as a crawlable, printable, keyboard-only page, its handouts and exports, and
 * the search pages built from the gallery.
 */
export { anchor, outlineHtml, outlineTree, renderOutline, type OutlineOptions } from './outline';
export { hydrateOutline, findOutline, type HydrateOptions, type HydratedOutline } from './hydrate';
export { profileSvg, profileTree, type ProfileMarks, type ProfileOptions } from './profile';
export { marksFor, hereAlong } from './marks';
export { roadmapToMarkdown, type RoadmapMarkdownOptions } from './markdown';
export { studentCopy, hasTeacherParts, type StudentCopyReport } from './student';
export { calendarIcs, icsEvents, toIcs, type IcsEvent } from './ics';
export {
  notebookHandoutTree,
  preparePrint,
  printView,
  renderTrailCard,
  sessionPagesTree,
  trailCardHtml,
  trailCardTree,
  PRINT_KINDS,
  type PrintKind,
  type TrailCardInput,
} from './print';
export { headTags, jsonLd, pageMeta, pageUi, setNoindex, type HeadPage, type PageKind } from './head';
export {
  GALLERY_PATH,
  galleryTree,
  homeTree,
  ogImagePath,
  robotsTxt,
  roadmapPath,
  siteBase,
  sitemapXml,
  sitePages,
  SITE_IMAGE,
  writeIntoShell,
  type ShellPage,
  type SitemapEntry,
} from './site';
export { ogCardHtml, type OgInput } from './og';
export { ensureOutlineStyles, OUTLINE_CSS, OUTLINE_STYLE_ID } from './styles';
export { OUTLINE_STRINGS, say as outlineSay, type OutlineKey } from './strings';
