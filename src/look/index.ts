/**
 * The look: colour tokens, type, formatting, the brand mark and the DOM overlays. Scene code that needs only
 * colours or fonts can import the single file it needs (`look/theme`, `look/type`) and stay free of the DOM.
 */
export {
  FOCUS,
  FOCUS_PAIRS,
  TEXT_PAIRS,
  THEME,
  TOKEN_PREFIX,
  contrast,
  focusTokens,
  hexToRgb,
  luminance,
  mix,
  rgbToHex,
  tokenEntries,
  tokenName,
  tokenVar,
  tokensCss,
  withAlpha,
  type Rgb,
  type Theme,
} from './theme';
export { injectTokens, lookCss } from './tokens';
export {
  FONTS,
  FONT_ROLES,
  MAX_ROADMAP_TRACKING,
  TYPE,
  canvasFont,
  drawText,
  loadFonts,
  measureTextWidth,
  typeTokens,
  type DrawTextOptions,
  type FontReport,
  type FontRole,
  type LoadFontsOptions,
  type TextContext,
  type TypeStyle,
} from './type';
export { NBSP, formatDay, formatHours, formatNumber, roundHours, type DayOptions, type FormatOptions, type HoursOptions } from './format';
export {
  MARK_GRID,
  SMALL_CUT_MAX,
  WORDMARK_DASH,
  brandMark,
  brandMarkDataUrl,
  createBrand,
  createBrandMark,
  createWordmark,
  drawBrandMark,
  drawWordmark,
  markGeometry,
  type BrandMarkOptions,
  type BrandOptions,
  type MarkGeometry,
  type WordmarkOptions,
} from './brand';
export { createRoomOverlays, ensurePaperEdge, grainUrl, paperGrainUrl, type OverlayOptions } from './dom';
export { LAMP } from './lamp';
