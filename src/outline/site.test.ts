import { describe, expect, it } from 'vitest';
import { headTags, isoDuration, jsonLd, pageMeta } from './head';
import { galleryTree, homeTree, robotsTxt, roadmapPath, siteBase, sitemapXml, sitePages, writeIntoShell } from './site';
import { toHtml } from './tree';
import { firstSkip, headingLevels, parseFragment, sample, samples } from './testing';

const all = samples();
const BASE = 'https://example.org/zero-to';

function ldOf(tags: string): unknown {
  const match = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(tags);
  if (!match) throw new Error('no JSON-LD');
  return JSON.parse(match[1] as string);
}

const keys = (value: unknown, out = new Set<string>()): Set<string> => {
  if (Array.isArray(value)) value.forEach((v) => keys(v, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) (out.add(k), keys(v, out));
  return out;
};

describe('siteBase', () => {
  it('accepts an https origin, with or without a path, and fails closed on anything else', () => {
    expect(siteBase('https://example.org')).toBe('https://example.org');
    expect(siteBase('https://example.org/zero-to/')).toBe('https://example.org/zero-to');
    for (const bad of [undefined, '', '  ', 'http://example.org', 'example.org', 'https://example.org/?a=1', 'https://user:pw@example.org', 'javascript:alert(1)']) {
      expect(siteBase(bad)).toBeNull();
    }
  });
});

describe('sitemap and robots', () => {
  it('lists the root, the gallery and every example with its checked day', () => {
    const xml = sitemapXml(BASE, sitePages(all));
    expect(xml).toContain(`<loc>${BASE}/</loc>`);
    expect(xml).toContain(`<loc>${BASE}/gallery/</loc>`);
    for (const r of all) expect(xml).toContain(`<loc>${BASE}/${roadmapPath(r.id)}</loc>\n    <lastmod>${r.checkedOn}</lastmod>`);
    expect(xml.match(/<url>/g)).toHaveLength(all.length + 2);
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
  });

  it('robots.txt allows everything and names the sitemap', () => {
    expect(robotsTxt(BASE)).toBe(`User-agent: *\nAllow: /\n\nSitemap: ${BASE}/sitemap.xml\n`);
  });
});

describe('headTags', () => {
  it.each(all.map((r) => [r.id, r] as const))('%s: title, description, canonical, Open Graph, card and parseable JSON-LD', (_id, roadmap) => {
    const tags = headTags({ kind: 'roadmap', path: roadmapPath(roadmap.id), base: BASE, roadmap, image: `og/${roadmap.id}.png`, ui: 'en' });
    const head = parseFragment(tags);
    expect(head.querySelector('title')?.textContent).toContain(roadmap.title);
    const description = head.querySelector('meta[name="description"]')?.getAttribute('content') ?? '';
    expect(description.length).toBeGreaterThan(50);
    expect(description.length).toBeLessThanOrEqual(160);
    expect(head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(`${BASE}/r/${roadmap.id}/`);
    expect(head.querySelector('meta[name="robots"]')).toBeNull();
    expect(head.querySelector('meta[property="og:image"]')?.getAttribute('content')).toBe(`${BASE}/og/${roadmap.id}.png`);
    expect(head.querySelector('meta[property="og:image:width"]')?.getAttribute('content')).toBe('1200');
    expect(head.querySelector('meta[name="twitter:card"]')?.getAttribute('content')).toBe('summary_large_image');
    const ld = ldOf(tags) as { '@graph': { '@type': string; hasPart?: unknown[]; timeRequired?: string }[] };
    const resource = ld['@graph'].find((n) => n['@type'] === 'LearningResource');
    expect(resource?.hasPart).toHaveLength(roadmap.stages.length);
    expect(resource?.timeRequired).toMatch(/^PT\d+H/);
    expect(ld['@graph'].some((n) => n['@type'] === 'ItemList')).toBe(true);
    expect(ld['@graph'].some((n) => n['@type'] === 'BreadcrumbList')).toBe(true);
    const used = keys(ld);
    for (const banned of ['aggregateRating', 'review', 'reviewRating', 'offers', 'ratingValue']) expect(used.has(banned)).toBe(false);
  });

  it('fails closed without a base: noindex and no absolute address anywhere', () => {
    const roadmap = sample('rust-for-a-python-dev');
    for (const page of [
      { kind: 'roadmap' as const, path: roadmapPath(roadmap.id), base: null, roadmap, image: 'og/x.png', ui: 'en' as const },
      { kind: 'gallery' as const, path: 'gallery/', base: null, samples: all, ui: 'en' as const },
      { kind: 'home' as const, path: '', base: null, samples: all, ui: 'en' as const },
    ]) {
      const tags = headTags(page);
      const head = parseFragment(tags);
      expect(head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex');
      expect(head.querySelector('link[rel="canonical"], meta[property="og:url"], meta[property="og:image"]')).toBeNull();
      // The only address left is the author's public profile, never one of the site's pages.
      expect(JSON.stringify(ldOf(tags))).not.toMatch(/"(?:url|item|image|@id)":"https?:(?!\/\/github\.com\/OthmanAdi")/);
      expect(tags).not.toContain('og/x.png');
    }
  });

  it('home is a WebApplication and the gallery a CollectionPage, without ratings', () => {
    const home = ldOf(headTags({ kind: 'home', path: '', base: BASE, samples: all, ui: 'en' })) as Record<string, unknown>;
    expect(home['@type']).toBe('WebApplication');
    expect(home.applicationCategory).toBe('EducationalApplication');
    const gallery = ldOf(headTags({ kind: 'gallery', path: 'gallery/', base: BASE, samples: all, ui: 'en' })) as { mainEntity: { itemListElement: unknown[] } };
    expect(gallery.mainEntity.itemListElement).toHaveLength(all.length);
  });

  it('escapes roadmap text in tags and inside the JSON-LD script', () => {
    const roadmap = { ...sample('photography-basics'), title: '</script><script>alert(1)</script> "x"' };
    const tags = headTags({ kind: 'roadmap', path: 'roadmaps/x/', base: null, roadmap, ui: 'en' });
    expect(tags).not.toContain('</script><script>');
    const head = parseFragment(tags);
    expect(head.querySelectorAll('script')).toHaveLength(1);
    expect(head.querySelector('title')?.textContent).toContain(roadmap.title);
    expect(JSON.stringify(ldOf(tags))).toContain('alert(1)');
  });

  it('writes German titles for a German roadmap page', () => {
    const roadmap = sample('deutsch-a1-von-null');
    expect(pageMeta({ kind: 'roadmap', path: '', base: null, roadmap, ui: 'de' }).title).toBe(`${roadmap.title}: Lernpfad von null an`);
  });

  it('isoDuration', () => {
    expect(isoDuration(2505)).toBe('PT41H45M');
    expect(isoDuration(120)).toBe('PT2H');
    expect(isoDuration(0)).toBe('PT0M');
  });

  it('jsonLd for a roadmap names what it teaches and its levels', () => {
    const roadmap = sample('rust-for-a-python-dev');
    const ld = jsonLd({ kind: 'roadmap', path: roadmapPath(roadmap.id), base: BASE, roadmap, ui: 'en' }) as { '@graph': Record<string, unknown>[] };
    const resource = ld['@graph'][0] as Record<string, unknown>;
    expect(resource.teaches).toBeTruthy();
    expect(resource.inLanguage).toBe(roadmap.lang);
    expect(resource.isAccessibleForFree).toBe(true);
  });
});

describe('gallery and home pages', () => {
  it('the gallery body is real HTML with every example, its stages and its steps as links', () => {
    const page = parseFragment(toHtml(galleryTree(all, 'en')));
    expect(firstSkip(headingLevels(page))).toBeNull();
    const hrefs = [...page.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    for (const r of all) {
      expect(hrefs).toContain(`../r/${r.id}/`);
      for (const s of r.stages) expect(hrefs).toContain(`../r/${r.id}/#s-${s.id}`);
      for (const w of r.stages.flatMap((s) => s.waypoints)) expect(hrefs).toContain(`../r/${r.id}/#w-${w.id}`);
    }
  });

  it('the home page says what zero-to is and links every example', () => {
    const page = parseFragment(toHtml(homeTree(all, 'en')));
    expect(page.querySelector('h1')?.textContent).toBeTruthy();
    expect(firstSkip(headingLevels(page))).toBeNull();
    for (const r of all) expect(page.querySelector(`a[href="${roadmapPath(r.id)}"]`)).not.toBeNull();
  });
});

describe('writeIntoShell', () => {
  const shell = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>old</title>
    <meta name="description" content="old" />
    <script type="module" crossorigin src="./assets/home-abc.js"></script>
    <link rel="icon" href="./assets/home-abc.svg">
  </head>
  <body>
    <main id="app"></main>
  </body>
</html>`;

  it('writes the head, the styles, the outline and the roadmap, and keeps the assets reachable from a deeper folder', () => {
    const html = writeIntoShell(shell, {
      head: '<title>new</title>',
      body: '<article class="zo-outline">x</article>',
      lang: 'de',
      toRoot: '../../',
      styles: [{ id: 'zo-outline-style', css: '.a{}</style><b>' }],
      roadmap: { title: '</script><script>alert(1)</script>' },
    });
    expect(html).toContain('<html lang="de">');
    expect(html).not.toContain('<title>old</title>');
    expect(html).not.toContain('content="old"');
    expect(html).toContain('<title>new</title>');
    expect(html).toContain('src="../../assets/home-abc.js"');
    expect(html).toContain('href="../../assets/home-abc.svg"');
    expect(html).toContain('<div id="zero-to-outline"><!--zo:body--><article class="zo-outline">x</article><!--/zo:body--></div>');
    expect(html).not.toContain('</style><b>');
    expect(html).not.toContain('</script><script>alert');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(JSON.parse(doc.getElementById('zero-to-roadmap')?.textContent ?? '')).toEqual({ title: '</script><script>alert(1)</script>' });
    // The head block comes after the viewport tag, so the charset stays first.
    expect(html.indexOf('<meta charset')).toBeLessThan(html.indexOf('<title>new'));
  });

  it('gives the same page when it writes into a page it wrote before, and keeps dollar signs as text', () => {
    const page = { head: '<title>$& $1</title>', body: '<p>$& and $$</p>', lang: 'en', toRoot: './', styles: [{ id: 's', css: '.a{}' }], roadmap: { t: '$&' } };
    const once = writeIntoShell(shell, page);
    expect(writeIntoShell(once, page)).toBe(once);
    expect(once).toContain('<title>$& $1</title>');
    expect(once).toContain('<p>$& and $$</p>');
    expect(once).toContain('{"t":"$&"}');
  });

  it('fills an empty outline container and roadmap slot when the shell has them', () => {
    const withSlots = shell.replace('<main id="app"></main>', '<div id="zero-to-outline"></div><script type="application/json" id="zero-to-roadmap"></script>');
    const html = writeIntoShell(withSlots, { head: '', body: '<p>x</p>', lang: 'en', toRoot: './', roadmap: { a: 1 } });
    expect(html).toContain('<div id="zero-to-outline"><!--zo:body--><p>x</p><!--/zo:body--></div>');
    expect(html).toContain('<script type="application/json" id="zero-to-roadmap">{"a":1}</script>');
    expect(html.match(/zero-to-roadmap/g)).toHaveLength(1);
    expect(html).toContain('src="./assets/home-abc.js"');
  });
});
