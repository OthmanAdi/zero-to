import { THEME, focusTokens, tokensCss, type Theme } from './theme';
import { typeTokens } from './type';

const STYLE_ID = 'zt-tokens';

/** Every custom property of the look as one `:root` rule: colours, font stacks, type sizes and the focus ring. */
export function lookCss(theme: Theme = THEME): string {
  return tokensCss([...typeTokens(), ...focusTokens()], theme);
}

/**
 * Puts the tokens into the document as `--zt-*` custom properties, for example `--zt-night`, `--zt-paper`,
 * `--zt-signal`, `--zt-tier-gold`, `--zt-font-display`, `--zt-focus-halo`. Call it before anything is drawn.
 * Calling it again replaces the rule, so a theme can be swapped.
 *
 * A built page should also carry `lookCss()` in a `<style>` in its head, so the very first paint has the
 * colours before any script runs.
 */
export function injectTokens(doc: Document = document, theme: Theme = THEME): HTMLStyleElement {
  let style = doc.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement('style');
    style.id = STYLE_ID;
    // First in the head, so any later stylesheet can override a token.
    doc.head.insertBefore(style, doc.head.firstChild);
  }
  style.textContent = lookCss(theme);
  return style;
}
