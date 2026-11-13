/**
 * Prerenders the search pages into the built site, so every page reads as real HTML before any script runs:
 *
 * - `roadmaps/<id>/index.html` for every gallery roadmap: its full outline in the body, its head tags (title,
 *   description, Open Graph, JSON-LD) and the roadmap itself in the `zero-to-roadmap` element for the app;
 * - `gallery/index.html`: every example with its stages and steps as links;
 * - `index.html` (the root): what zero-to is and the examples, under the scene;
 * - `sitemap.xml` and `robots.txt`, through scripts/sitemap.ts, only when SITE_ORIGIN is an https address.
 *
 * Without SITE_ORIGIN every page is marked noindex and no absolute address is written (fail closed).
 *
 * Order: npm run build, then npm run og-images (social images, optional), then npm run prerender.
 * Options: --dist <dir> (default dist), --shell <file> (default <dist>/index.html), --out <dir> (default <dist>).
 * Run through npm (node --experimental-strip-types), which works on every Node version the package supports.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
}

const dist = resolve(root, option('dist') ?? 'dist');
const out = resolve(root, option('out') ?? dist);
const shellFile = resolve(root, option('shell') ?? join(dist, 'index.html'));

if (!existsSync(shellFile)) {
  console.error(`prerender: ${relative(root, shellFile)} is missing. Run npm run build first, or pass --shell <file>.`);
  process.exit(1);
}

const server = await createServer({
  configFile: false,
  root,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});

try {
  const outline = await server.ssrLoadModule('/src/outline/index.ts');
  const tree = await server.ssrLoadModule('/src/outline/tree.ts');
  const { validateRoadmap } = await server.ssrLoadModule('/src/roadmap/validate.ts');
  const { lookCss } = await server.ssrLoadModule('/src/look/tokens.ts');
  const { setUiLang } = await server.ssrLoadModule('/src/i18n/index.ts');

  const folder = join(root, 'src', 'roadmap', 'samples');
  const samples = readdirSync(folder)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const result = validateRoadmap(JSON.parse(readFileSync(join(folder, name), 'utf8')));
      if (!result.ok) throw new Error(`prerender: ${name} does not validate: ${result.errors.map((e: { message: string }) => e.message).join('; ')}`);
      return result.roadmap;
    });

  const base: string | null = outline.siteBase(process.env.SITE_ORIGIN);
  if (process.env.SITE_ORIGIN && !base) console.warn(`prerender: SITE_ORIGIN "${process.env.SITE_ORIGIN}" is not an https address; pages stay noindex.`);
  const shell = readFileSync(shellFile, 'utf8');
  const styles = [
    { id: 'zt-tokens', css: lookCss() },
    { id: outline.OUTLINE_STYLE_ID, css: outline.OUTLINE_CSS },
  ];
  const image = (name: string): string | null => (existsSync(join(out, outline.ogImagePath(name))) ? outline.ogImagePath(name) : null);
  const written: string[] = [];
  const write = (path: string, html: string): void => {
    const file = join(out, path, 'index.html');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, html);
    written.push(`${relative(root, file)} (${Math.round(Buffer.byteLength(html) / 1024)} KB)`);
  };

  for (const roadmap of samples) {
    const ui = outline.pageUi(roadmap);
    setUiLang(ui, false);
    const path = outline.roadmapPath(roadmap.id);
    const head = outline.headTags({ kind: 'roadmap', path, base, roadmap, image: image(roadmap.id), ui });
    const body = outline.outlineHtml(roadmap, { ui });
    write(path, outline.writeIntoShell(shell, { head, body, lang: roadmap.lang, toRoot: '../../', styles, roadmap }));
  }

  setUiLang('en', false);
  const site = image(outline.SITE_IMAGE);
  write(
    outline.GALLERY_PATH,
    outline.writeIntoShell(shell, {
      head: outline.headTags({ kind: 'gallery', path: outline.GALLERY_PATH, base, samples, image: site, ui: 'en' }),
      body: tree.toHtml(outline.galleryTree(samples, 'en')),
      lang: 'en',
      toRoot: '../',
      styles,
    }),
  );
  write(
    '',
    outline.writeIntoShell(shell, {
      head: outline.headTags({ kind: 'home', path: '', base, samples, image: site, ui: 'en' }),
      body: tree.toHtml(outline.homeTree(samples, 'en')),
      lang: 'en',
      toRoot: './',
      styles,
    }),
  );

  console.log(`prerender: ${written.length} pages${base ? ` for ${base}` : ', noindex (SITE_ORIGIN not set)'}`);
  for (const line of written) console.log(`  ${line}`);
} finally {
  await server.close();
}

const sitemap = spawnSync(process.execPath, [...process.execArgv, join(root, 'scripts', 'sitemap.ts'), '--out', out], { stdio: 'inherit', env: process.env });
if (sitemap.status !== 0) process.exit(sitemap.status ?? 1);
