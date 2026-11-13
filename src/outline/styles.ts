/**
 * The outline's stylesheet as text, so the build can put it into the head of every prerendered page (the page
 * must read well before and without any script) and the browser can add it once when the outline is built
 * there instead.
 */
import css from './outline.css?inline';

export const OUTLINE_STYLE_ID = 'zo-outline-style';
export const OUTLINE_CSS: string = css;

/** Adds the outline's styles to the document once. A prerendered page already has them. */
export function ensureOutlineStyles(doc: Document = document): void {
  if (doc.getElementById(OUTLINE_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = OUTLINE_STYLE_ID;
  style.textContent = OUTLINE_CSS;
  doc.head.append(style);
}
