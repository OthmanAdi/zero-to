// @vitest-environment node
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VIEWER_LICENCES, inlineAssets, inlineScript, inlineStyle, licenceComment, outsideReferences, withLicenceComment } from './build-viewer';

describe('the single-file viewer', () => {
  it('writes a script so it cannot close its own element or open a comment', () => {
    const code = 'const a = "</script><script>alert(1)</script>"; const b = "<!-- x -->"; const c = `</SCRIPT>`;';
    const safe = inlineScript(code);
    expect(safe).not.toMatch(/<\/script/i);
    expect(safe).not.toContain('<!--');
    // The escapes read back as the same characters in a string.
    expect(new Function(`${safe} return a + b + c;`)()).toBe('</script><script>alert(1)</script><!-- x --></SCRIPT>');
  });

  it('writes a style sheet so it cannot close its own element', () => {
    expect(inlineStyle('a::after{content:"</style><b>"}')).not.toMatch(/<\/style/i);
  });

  it('puts the built script and style sheet into the page and drops the preload hints', () => {
    const html =
      '<head><link rel="modulepreload" crossorigin href="./assets/vendor.js">' +
      '<script type="module" crossorigin src="./assets/home.js"></script>' +
      '<link rel="stylesheet" crossorigin href="./assets/home.css"></head>' +
      '<body><script type="application/json" id="zero-to-roadmap"></script></body>';
    const files: Record<string, string> = { './assets/home.js': 'console.log("$& $1 </script>")', './assets/home.css': 'body{margin:0}' };
    const result = inlineAssets(html, (address) => files[address] ?? null);
    expect(result.scripts).toBe(1);
    expect(result.styles).toBe(1);
    expect(result.html).toContain('<script type="module">console.log("$& $1 <\\/script>")</script>');
    expect(result.html).toContain('<style>body{margin:0}</style>');
    expect(result.html).not.toContain('modulepreload');
    expect(result.html).toContain('<script type="application/json" id="zero-to-roadmap"></script>');
    expect(outsideReferences(result.html)).toEqual([]);
  });

  it('leaves a file it cannot read where it is, and says so', () => {
    const html = '<script type="module" src="./assets/missing.js"></script><link rel="icon" href="./favicon.svg">';
    const result = inlineAssets(html, () => null);
    expect(result.scripts).toBe(0);
    expect(outsideReferences(result.html).sort()).toEqual(['./assets/missing.js', './favicon.svg']);
  });

  it('carries the notices of everything inside it in one comment after the doctype', () => {
    const comment = licenceComment('zero-to\nCopyright 2026 Someone', [
      { name: 'three.js (MIT License)', text: 'The MIT License\r\n\r\nCopyright three.js authors' },
      { name: 'A font (SIL Open Font License 1.1)', text: 'Text with --> and --!> inside' },
    ]);
    expect(comment.startsWith('<!--\nzero-to\nCopyright 2026 Someone')).toBe(true);
    expect(comment).toContain('==== three.js (MIT License) ====\n\nThe MIT License\n\nCopyright three.js authors');
    // The comment cannot be closed early by a licence text.
    expect(comment.slice(4, -3)).not.toMatch(/--!?>/);
    expect(comment.endsWith('\n-->')).toBe(true);
    const html = withLicenceComment('<!doctype html>\n<html><head></head></html>', comment);
    expect(html.startsWith(`<!doctype html>\n${comment}\n<html>`)).toBe(true);
  });

  it('names a licence file for every third-party part of the build, and each one exists', () => {
    for (const licence of VIEWER_LICENCES) {
      expect(existsSync(join(import.meta.dirname, '..', 'public', 'licenses', licence.file)), licence.file).toBe(true);
    }
    expect(VIEWER_LICENCES.map((licence) => licence.file)).toEqual(
      expect.arrayContaining(['three.js-MIT.txt', 'Vite-MIT.txt', 'Fraunces-OFL-1.1.txt', 'Atkinson-Hyperlegible-Next-OFL-1.1.txt', 'IBM-Plex-Mono-OFL-1.1.txt']),
    );
  });

  it('finds addresses in styles, and takes data addresses and links in code as harmless', () => {
    const html =
      '<style>@font-face{src:url(data:font/woff2;base64,AAAA)}.a{background:url("./paper.png")}</style>' +
      '<link rel="icon" href="data:image/svg+xml,%3Csvg%3E">' +
      '<script type="module">const link = \'<a href="https://example.org/">x</a>\'; fetch;</script>';
    expect(outsideReferences(html)).toEqual(['./paper.png']);
  });
});
