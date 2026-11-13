/**
 * Builds the single-file viewer: `.agents/skills/zero-to/viewer/zero-to.html`. It is the whole site in one HTML
 * file, with every script, style and font inside it, so a roadmap built by the skill opens from a folder with
 * no network and no server.
 *
 * The file keeps an empty `<script type="application/json" id="zero-to-roadmap">` element. The skill's tool
 * writes a roadmap into it (`zero-to.mjs build`), and the page reads it before anything else.
 *
 * Run: npm run build:viewer (Node 22.18 or later strips the types of this file by itself).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const VIEWER_FILE = join(root, '.agents', 'skills', 'zero-to', 'viewer', 'zero-to.html');
/** The file is copied with the skill and opened from disk. Past this size something that should not be in it is. */
export const MAX_VIEWER_BYTES = 6 * 1024 * 1024;

export interface BuildViewerOptions {
  /** Where the file is written. Default: the skill's viewer folder. */
  readonly out?: string;
  readonly quiet?: boolean;
}

export interface BuildViewerResult {
  readonly file: string;
  readonly bytes: number;
  readonly scripts: number;
  readonly styles: number;
}

/** A script body that cannot close its own element or open a comment in the page. */
export function inlineScript(code: string): string {
  return code.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
}

/** A style sheet that cannot close its own element. */
export function inlineStyle(css: string): string {
  return css.replace(/<\/(style)/gi, '<\\/$1');
}

/** Addresses the page still asks the network or the disk for: anything in `src` or `href`, and `url()` in styles. */
export function outsideReferences(html: string): string[] {
  const found = new Set<string>();
  // A fragment, also when it is written inside a data address (%23 is #), points into the page itself.
  const local = /^(?:data:|#|%23|about:|blob:)/i;
  // Markup only: the bodies of scripts and styles are code and text, where a link is not a request.
  const markup = html
    .replace(/(<script\b[^>]*>)[\s\S]*?<\/script>/gi, (_all, open: string) => `${open}</script>`)
    .replace(/(<style\b[^>]*>)[\s\S]*?<\/style>/gi, (_all, open: string) => `${open}</style>`);
  for (const match of markup.matchAll(/<(?:script|link|img|source|iframe|video|audio)\b[^>]*?\s(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    const address = match[1];
    if (address !== undefined && !local.test(address)) found.add(address);
  }
  for (const style of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const match of (style[1] ?? '').matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
      const address = match[1];
      if (address !== undefined && !local.test(address)) found.add(address);
    }
  }
  return [...found];
}

/** The licence files whose code or fonts end up inside the viewer, in the order the notice lists them. */
export const VIEWER_LICENCES: readonly { readonly name: string; readonly file: string }[] = [
  { name: 'three.js (MIT License)', file: 'three.js-MIT.txt' },
  { name: 'Vite module preload helper (MIT License)', file: 'Vite-MIT.txt' },
  { name: 'Fraunces (SIL Open Font License 1.1)', file: 'Fraunces-OFL-1.1.txt' },
  { name: 'Atkinson Hyperlegible Next (SIL Open Font License 1.1)', file: 'Atkinson-Hyperlegible-Next-OFL-1.1.txt' },
  { name: 'IBM Plex Mono (SIL Open Font License 1.1)', file: 'IBM-Plex-Mono-OFL-1.1.txt' },
];

/**
 * The comment at the top of the viewer. The file travels alone (with the skill, and as every page the skill
 * builds), so the notices of the code and fonts inside it travel in it too.
 */
export function licenceComment(notice: string, licences: readonly { readonly name: string; readonly text: string }[]): string {
  // A comment ends at the first "-->" or "--!>"; neither may appear inside it.
  const safe = (text: string): string => text.replace(/\r\n?/g, '\n').replace(/--!?>/g, '- ->').trim();
  const parts = [
    safe(notice),
    'Licensed under the Apache License, Version 2.0: https://www.apache.org/licenses/LICENSE-2.0',
    'Source: https://github.com/OthmanAdi/zero-to',
    'This file contains third-party code and fonts under their own licences. Their notices and licence texts follow.',
    ...licences.map((licence) => `==== ${licence.name} ====\n\n${safe(licence.text)}`),
  ];
  return `<!--\n${parts.join('\n\n')}\n-->`;
}

/** Puts the comment right after the doctype, so the page stays in standards mode. */
export function withLicenceComment(html: string, comment: string): string {
  const doctype = /^\s*<!doctype html>/i.exec(html);
  return doctype ? `${doctype[0]}\n${comment}${html.slice(doctype[0].length)}` : `${comment}\n${html}`;
}

/**
 * Puts the built script and style files into the page. `read` returns the text of a file of the build by the
 * address the page uses for it.
 */
export function inlineAssets(html: string, read: (address: string) => string | null): { html: string; scripts: number; styles: number } {
  let scripts = 0;
  let styles = 0;
  let out = html.replace(/<script\b([^>]*?)\ssrc=["']([^"']+)["']([^>]*)><\/script>/gi, (all, before: string, address: string, after: string) => {
    const code = read(address);
    if (code === null) return all;
    scripts += 1;
    const attrs = `${before}${after}`.replace(/\scrossorigin(?:=["'][^"']*["'])?/gi, '');
    return `<script${attrs}>${inlineScript(code)}</script>`;
  });
  out = out.replace(/<link\b[^>]*?rel=["']stylesheet["'][^>]*>/gi, (all) => {
    const address = /\shref=["']([^"']+)["']/i.exec(all)?.[1];
    const css = address === undefined ? null : read(address);
    if (css === null) return all;
    styles += 1;
    return `<style>${inlineStyle(css)}</style>`;
  });
  // Hints to fetch files that are now in the page.
  out = out.replace(/\s*<link\b[^>]*?rel=["']modulepreload["'][^>]*>/gi, '');
  return { html: out, scripts, styles };
}

export async function buildViewer(options: BuildViewerOptions = {}): Promise<BuildViewerResult> {
  const out = options.out ?? VIEWER_FILE;
  const work = mkdtempSync(join(tmpdir(), 'zero-to-viewer-'));
  try {
    await build({
      configFile: false,
      root,
      base: './',
      publicDir: false,
      logLevel: options.quiet ? 'silent' : 'warn',
      build: {
        outDir: work,
        emptyOutDir: true,
        target: 'es2022',
        // One script, one style sheet, and every font and image inside them.
        cssCodeSplit: false,
        assetsInlineLimit: Number.MAX_SAFE_INTEGER,
        modulePreload: false,
        sourcemap: false,
        reportCompressedSize: false,
        chunkSizeWarningLimit: 100_000,
        rolldownOptions: {
          input: resolve(root, 'index.html'),
          output: { codeSplitting: false },
        },
      },
    });

    const page = join(work, 'index.html');
    if (!existsSync(page)) throw new Error('build-viewer: the build wrote no index.html');
    const read = (address: string): string | null => {
      const file = join(work, address.replace(/^\.?\//, ''));
      return existsSync(file) && statSync(file).isFile() ? readFileSync(file, 'utf8') : null;
    };
    const inlined = inlineAssets(readFileSync(page, 'utf8'), read);
    let html = inlined.html;

    // The icon travels inside the file. The manifest and the touch icon belong to the hosted site.
    const icon = join(root, 'public', 'favicon.svg');
    const iconTag = existsSync(icon) ? `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(readFileSync(icon, 'utf8'))}" type="image/svg+xml" />` : '';
    html = html
      .replace(/\s*<link\b[^>]*?rel=["'](?:manifest|apple-touch-icon)["'][^>]*>/gi, '')
      .replace(/\s*<link\b[^>]*?rel=["']icon["'][^>]*?type=["']image\/png["'][^>]*>/gi, '')
      .replace(/<link\b[^>]*?rel=["']icon["'][^>]*>/i, () => iconTag);

    const licences = VIEWER_LICENCES.map((licence) => ({
      name: licence.name,
      text: readFileSync(join(root, 'public', 'licenses', licence.file), 'utf8'),
    }));
    // The first paragraph of NOTICE names the product and its copyright; the rest points to files the viewer
    // does not travel with, so the comment says it in its own words instead.
    const notice = readFileSync(join(root, 'NOTICE'), 'utf8').split(/\r?\n\s*\r?\n/)[0] ?? 'zero-to';
    html = withLicenceComment(html, licenceComment(notice, licences));

    const outside = outsideReferences(html);
    if (outside.length > 0) throw new Error(`build-viewer: the viewer still refers to files outside itself: ${outside.slice(0, 8).join(', ')}`);
    if (!/<script\s+type="application\/json"\s+id="zero-to-roadmap"[^>]*>\s*<\/script>/i.test(html)) {
      throw new Error('build-viewer: the page has no empty zero-to-roadmap element for the skill to fill');
    }
    const assets = join(work, 'assets');
    const left = existsSync(assets) ? readdirSync(assets, { recursive: true }).filter((name) => !/\.(?:js|css)$/.test(String(name))) : [];
    if (left.length > 0) throw new Error(`build-viewer: files were left outside the page: ${left.slice(0, 8).join(', ')}`);

    const bytes = Buffer.byteLength(html, 'utf8');
    if (bytes > MAX_VIEWER_BYTES) throw new Error(`build-viewer: the viewer is ${(bytes / 1024 / 1024).toFixed(2)} MB, over the ${MAX_VIEWER_BYTES / 1024 / 1024} MB limit`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, html, 'utf8');
    return { file: out, bytes, scripts: inlined.scripts, styles: inlined.styles };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const result = await buildViewer();
  process.stdout.write(`Built ${result.file} (${(result.bytes / 1024).toFixed(0)} KB, ${result.scripts} script and ${result.styles} style sheet inlined).\n`);
}
