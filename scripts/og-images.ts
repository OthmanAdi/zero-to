/**
 * Renders the 1200 by 630 social images: one per gallery roadmap (`og/<id>.png`) and one for the root and the
 * gallery (`og/site.png`). Each is a small HTML page set in the site's own faces and colours (night room, a
 * paper sheet with the route's profile) and photographed by a headless Chromium through Playwright.
 *
 * Order: npm run build, then npm run og-images, then npm run prerender (which links an image only when its
 * file exists). Options: --out <dir> (default dist). Playwright finds its browsers through
 * PLAYWRIGHT_BROWSERS_PATH when they are not in the default place.
 */
import { mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const index = process.argv.indexOf('--out');
const out = resolve(root, index > 0 ? (process.argv[index + 1] ?? 'dist') : 'dist');
const WIDTH = 1200;
const HEIGHT = 630;

/** The site's faces as @font-face rules with data addresses, so the page loads nothing from outside. */
function fontCss(): string {
  const face = (family: string, file: string, weight: string, style = 'normal'): string => {
    const data = readFileSync(join(root, 'node_modules', file)).toString('base64');
    return `@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${data}) format('woff2')}`;
  };
  return [
    face('Fraunces', '@fontsource-variable/fraunces/files/fraunces-latin-full-normal.woff2', '100 900'),
    face('Fraunces', '@fontsource-variable/fraunces/files/fraunces-latin-full-italic.woff2', '100 900', 'italic'),
    face('Atkinson Hyperlegible Next', '@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-wght-normal.woff2', '200 800'),
    face('IBM Plex Mono', '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2', '400'),
    face('IBM Plex Mono', '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2', '500'),
  ].join('');
}

const server = await createServer({
  configFile: false,
  root,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});

const browser = await chromium.launch();
try {
  const outline = await server.ssrLoadModule('/src/outline/index.ts');
  const { validateRoadmap } = await server.ssrLoadModule('/src/roadmap/validate.ts');
  const { setUiLang } = await server.ssrLoadModule('/src/i18n/index.ts');
  const folder = join(root, 'src', 'roadmap', 'samples');
  const samples = readdirSync(folder)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const result = validateRoadmap(JSON.parse(readFileSync(join(folder, name), 'utf8')));
      if (!result.ok) throw new Error(`og-images: ${name} does not validate`);
      return result.roadmap;
    });

  const fonts = fontCss();
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
  const shoot = async (name: string, html: string): Promise<void> => {
    const file = join(out, outline.ogImagePath(name));
    mkdirSync(dirname(file), { recursive: true });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.screenshot({ path: file, clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
    const kb = Math.round(statSync(file).size / 1024);
    console.log(`  ${relative(root, file)} (${kb} KB)${kb > 1000 ? ' larger than 1 MB' : ''}`);
  };

  console.log('og-images:');
  for (const roadmap of samples) {
    const ui = outline.pageUi(roadmap);
    setUiLang(ui, false);
    await shoot(roadmap.id, outline.ogCardHtml({ kind: 'roadmap', roadmap, ui }, fonts));
  }
  setUiLang('en', false);
  await shoot(outline.SITE_IMAGE, outline.ogCardHtml({ kind: 'site', samples, ui: 'en' }, fonts));
} finally {
  await browser.close();
  await server.close();
}
