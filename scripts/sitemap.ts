/**
 * Writes sitemap.xml and robots.txt into the built site, listing the root, the gallery and every gallery
 * roadmap. Only when SITE_ORIGIN is an https address (optionally with a path, for a project site): without one
 * nothing is written and any older copy is removed, so a build never points crawlers at a guessed address.
 *
 * Run by `npm run prerender`; on its own: node scripts/sitemap.ts [--out <dir>] (default dist).
 *
 * A limit worth knowing: crawlers read robots.txt only at the root of a host. On a project site
 * (https://user.github.io/zero-to/) the file written here is not read, and the sitemap has to be submitted by
 * hand in the search engine's console. A custom domain removes that limit.
 */
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const index = process.argv.indexOf('--out');
const out = resolve(root, index > 0 ? (process.argv[index + 1] ?? 'dist') : 'dist');

const server = await createServer({
  configFile: false,
  root,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});

try {
  const site = await server.ssrLoadModule('/src/outline/site.ts');
  const { validateRoadmap } = await server.ssrLoadModule('/src/roadmap/validate.ts');
  const base: string | null = site.siteBase(process.env.SITE_ORIGIN);
  const files = [join(out, 'sitemap.xml'), join(out, 'robots.txt')];

  if (!base) {
    for (const file of files) if (existsSync(file)) rmSync(file);
    console.log('sitemap: SITE_ORIGIN is not set to an https address, so no sitemap.xml or robots.txt was written (pages are noindex).');
  } else {
    const folder = join(root, 'src', 'roadmap', 'samples');
    const samples = readdirSync(folder)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => {
        const result = validateRoadmap(JSON.parse(readFileSync(join(folder, name), 'utf8')));
        if (!result.ok) throw new Error(`sitemap: ${name} does not validate`);
        return result.roadmap;
      });
    const pages = site.sitePages(samples);
    writeFileSync(files[0] as string, site.sitemapXml(base, pages));
    writeFileSync(files[1] as string, site.robotsTxt(base));
    console.log(`sitemap: ${pages.length} addresses for ${base} in ${relative(root, files[0] as string)}, and ${relative(root, files[1] as string)}`);
  }
} finally {
  await server.close();
}
