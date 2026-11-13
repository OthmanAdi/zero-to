/**
 * The static search pages: where they live, the gallery index, the sitemap and robots.txt, and how one page is
 * written into the built site's HTML shell. Pure functions over strings; the build scripts do the file work.
 */
import { uiLang, type UiLang } from '../i18n';
import { hours as formatHours } from '../learn/format';
import { deriveTrek } from '../roadmap/derive';
import type { Roadmap } from '../roadmap/types';
import { anchor, checkedLine, factsLine, summitTier, tierName } from './outline';
import { say } from './strings';
import { el, escapeAttr, road, scriptJson, type ONode } from './tree';

/** Where a gallery roadmap's page lives, below the site base. */
export const roadmapPath = (id: string): string => `roadmaps/${id}/`;
export const GALLERY_PATH = 'gallery/';
export const HOME_PATH = '';
/** Social images, below the site base. */
export const ogImagePath = (name: string): string => `og/${name}.png`;
export const SITE_IMAGE = 'site';
const SITE_WORD = 'zero-to';

/**
 * The site's base from `SITE_ORIGIN`: an https address, optionally with a path for a project site
 * (`https://example.org/zero-to`). Anything else, or nothing, gives null, and the build then writes noindex
 * pages and no absolute address.
 */
export function siteBase(value: string | null | undefined): string | null {
  if (!value || value.trim() === '') return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.hostname === '') return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

export interface SitemapEntry {
  readonly path: string;
  /** YYYY-MM-DD. */
  readonly lastmod?: string;
}

/** Every indexable page: the root, the gallery and one page per example. */
export function sitePages(samples: readonly Roadmap[]): SitemapEntry[] {
  const latest = samples.map((r) => r.checkedOn).sort().at(-1);
  return [
    { path: HOME_PATH, ...(latest ? { lastmod: latest } : {}) },
    { path: GALLERY_PATH, ...(latest ? { lastmod: latest } : {}) },
    ...samples.map((r) => ({ path: roadmapPath(r.id), lastmod: r.checkedOn })),
  ];
}

const xml = (text: string): string => escapeAttr(text).replace(/'/g, '&apos;');

export function sitemapXml(base: string, entries: readonly SitemapEntry[]): string {
  const urls = entries.map(
    (e) => `  <url>\n    <loc>${xml(`${base}/${e.path}`)}</loc>${e.lastmod ? `\n    <lastmod>${xml(e.lastmod)}</lastmod>` : ''}\n  </url>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

export function robotsTxt(base: string): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`;
}

// ---------------------------------------------------------------------------------------------------------------
// The gallery as real HTML.

export interface GalleryOptions {
  readonly ui?: UiLang;
  /** Prefix that leads from the page to the site root: '' at the root, '../' from gallery/. */
  readonly toRoot: string;
  /** Heading level of each roadmap's title. 2 on the gallery page, 3 on the home page. */
  readonly level: 2 | 3;
  /** Also list the steps of every stage. */
  readonly steps?: boolean;
}

/** The list of example roadmaps, each with its facts, summary, checked date and stages as links. */
export function galleryList(samples: readonly Roadmap[], options: GalleryOptions): ONode {
  const ui = options.ui ?? uiLang();
  return el(
    'ol',
    { class: 'zo-gallery-list' },
    samples.map((r) => {
      const trek = deriveTrek(r);
      const href = `${options.toRoot}${roadmapPath(r.id)}`;
      const titleId = `g-${r.id}`;
      return el(
        'li',
        { class: 'zo-gallery-item', 'data-tier': summitTier(r) },
        el(
          'article',
          { 'aria-labelledby': titleId },
          el('p', { class: 'zo-kicker' }, factsLine(r, trek, ui)),
          el(`h${options.level}`, { class: 'zo-gallery-title', id: titleId }, el('a', { href, lang: r.lang, dir: 'auto' }, r.title)),
          r.summary ? road('p', r.summary, r.lang, { class: 'zo-summary' }) : null,
          el('p', { class: 'zo-checked' }, checkedLine(r, ui)),
          el(
            'ol',
            { class: 'zo-gallery-stages' },
            r.stages.map((stage, i) =>
              el(
                'li',
                { 'data-tier': stage.tier },
                el('a', { href: `${href}#${anchor.stage(stage.id)}`, lang: r.lang, dir: 'auto' }, stage.title),
                ' ',
                el('span', { class: 'zo-toc-meta' }, `${tierName(stage.tier, ui)} · ${formatHours(trek.stages[i]?.minutes ?? 0, { lang: ui })}`),
                options.steps
                  ? el(
                      'ul',
                      { class: 'zo-gallery-steps' },
                      stage.waypoints.map((w) => el('li', null, el('a', { href: `${href}#${anchor.step(w.id)}`, lang: r.lang, dir: 'auto' }, w.title))),
                    )
                  : null,
              ),
            ),
          ),
          el('p', { class: 'zo-gallery-go' }, el('a', { href, class: 'zo-btn' }, say('galleryLink', undefined, ui))),
        ),
      );
    }),
  );
}

/** The gallery page: every example with its stages and steps. */
export function galleryTree(samples: readonly Roadmap[], ui: UiLang = uiLang()): ONode {
  return el(
    'article',
    { class: 'zo-outline zo-gallery', lang: ui, 'data-zo-gallery': '' },
    el(
      'header',
      { class: 'zo-head' },
      el('p', { class: 'zo-kicker' }, el('span', { class: 'zo-kicker-word' }, SITE_WORD)),
      el('h1', { class: 'zo-title' }, say('galleryTitle', undefined, ui)),
      el('p', { class: 'zo-summary' }, say('galleryLede', undefined, ui)),
    ),
    galleryList(samples, { ui, toRoot: '../', level: 2, steps: true }),
  );
}

/** The home page's text under the scene: what zero-to is and the examples. */
export function homeTree(samples: readonly Roadmap[], ui: UiLang = uiLang()): ONode {
  return el(
    'article',
    { class: 'zo-outline zo-home', lang: ui, 'data-zo-home': '' },
    el(
      'header',
      { class: 'zo-head' },
      el('p', { class: 'zo-kicker' }, el('span', { class: 'zo-kicker-word' }, SITE_WORD)),
      el('h1', { class: 'zo-title' }, say('siteHeadline', undefined, ui)),
      el('p', { class: 'zo-summary' }, say('siteLede', undefined, ui)),
    ),
    el(
      'section',
      { class: 'zo-panel', 'aria-labelledby': 'home-gallery-t' },
      el('h2', { class: 'zo-panel-title', id: 'home-gallery-t' }, say('galleryTitle', undefined, ui)),
      galleryList(samples, { ui, toRoot: '', level: 3 }),
      el('p', { class: 'zo-gallery-go' }, el('a', { href: GALLERY_PATH }, say('galleryAll', undefined, ui))),
    ),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Writing a page into the built shell.

export interface ShellPage {
  /** The page's own head tags (from `headTags`). */
  readonly head: string;
  /** The page's body content, as HTML text. */
  readonly body: string;
  /** `lang` of the html element. */
  readonly lang: string;
  /** How the page reaches the site root: './' at the root, '../' from gallery/, '../../' from r/<id>/. */
  readonly toRoot: string;
  /** Extra styles for the first paint (tokens, outline). */
  readonly styles?: readonly { readonly id: string; readonly css: string }[];
  /** The roadmap the app should open, written into the `zero-to-roadmap` element. */
  readonly roadmap?: unknown;
}

const HEAD_TAGS_TO_REPLACE = [
  /<title\b[^>]*>[\s\S]*?<\/title>\s*/gi,
  /<meta\s+name="(?:description|robots|twitter:[^"]*)"[^>]*>\s*/gi,
  /<meta\s+property="og:[^"]*"[^>]*>\s*/gi,
  /<link\s+rel="canonical"[^>]*>\s*/gi,
  /<script\s+type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>\s*/gi,
];

const HEAD_BEGIN = '<!--zo:head-->';
const HEAD_END = '<!--/zo:head-->';
const BODY_BEGIN = '<!--zo:body-->';
const BODY_END = '<!--/zo:body-->';

/** Takes out what an earlier run wrote, so writing into an already prerendered page gives the same result. */
function strip(html: string): string {
  const cut = (text: string, begin: string, end: string): string => {
    let a = text.indexOf(begin);
    const b = text.indexOf(end);
    if (a < 0 || b < a) return text;
    // The line break and indent written before the block go with it.
    while (a > 0 && /[ \t\r\n]/.test(text.charAt(a - 1))) a -= 1;
    return text.slice(0, a) + text.slice(b + end.length);
  };
  return cut(cut(html, HEAD_BEGIN, HEAD_END), BODY_BEGIN, BODY_END);
}

/**
 * Writes one page into the shell of the built site: head tags, first-paint styles, outline and roadmap. Every
 * insert is a function replacement, so a `$` in roadmap text is never read as a replacement pattern.
 */
export function writeIntoShell(shell: string, page: ShellPage): string {
  if (!/<head\b[^>]*>/i.test(shell) || !/<body\b[^>]*>/i.test(shell)) throw new Error('writeIntoShell: the shell has no head or no body');
  let html = strip(shell);

  // Relative asset addresses ("./assets/...") must still point at the root from a deeper folder.
  if (page.toRoot !== './') html = html.replace(/(\s(?:src|href)=["'])\.\//g, (_all, attr: string) => `${attr}${page.toRoot}`);

  const lang = `"${escapeAttr(page.lang)}"`;
  html = /<html\b[^>]*\blang=/i.test(html)
    ? html.replace(/(<html\b[^>]*\blang=)(["'])[^"']*\2/i, (_all, open: string) => `${open}${lang}`)
    : html.replace(/<html\b/i, () => `<html lang=${lang}`);

  for (const pattern of HEAD_TAGS_TO_REPLACE) html = html.replace(pattern, '');
  const styles = (page.styles ?? [])
    .filter((s) => !html.includes(`id="${s.id}"`))
    .map((s) => `<style id="${escapeAttr(s.id)}">${s.css.replace(/<\/style/gi, '<\\/style')}</style>`)
    .join('\n    ');
  const block = `\n    ${HEAD_BEGIN}\n    ${page.head}${styles ? `\n    ${styles}` : ''}\n    ${HEAD_END}`;
  const viewport = /<meta\s+name="viewport"[^>]*>/i.exec(html);
  const charset = /<meta\s+charset=[^>]*>/i.exec(html);
  const after = viewport ?? charset;
  if (after) html = html.slice(0, after.index + after[0].length) + block + html.slice(after.index + after[0].length);
  else html = html.replace(/<head\b[^>]*>/i, (open) => `${open}${block}`);

  const body = `${BODY_BEGIN}${page.body}${BODY_END}`;
  const container = /(<div\s+id="zero-to-outline"[^>]*>)\s*<\/div>/i;
  if (container.test(html)) html = html.replace(container, (_all, open: string) => `${open}${body}</div>`);
  else html = html.replace(/<body\b[^>]*>/i, (open) => `${open}\n    <div id="zero-to-outline">${body}</div>`);

  if (page.roadmap !== undefined) {
    const tag = `<script type="application/json" id="zero-to-roadmap">${scriptJson(page.roadmap)}</script>`;
    const slot = /<script\s+type="application\/json"\s+id="zero-to-roadmap"[^>]*>[\s\S]*?<\/script>/i;
    if (slot.test(html)) html = html.replace(slot, () => tag);
    else html = html.replace(/<\/body>/i, () => `    ${tag}\n  </body>`);
  }
  return html;
}
