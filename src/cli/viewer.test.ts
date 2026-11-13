// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sampleRoadmap } from '../roadmap/testing';
import type { Roadmap } from '../roadmap/types';
import { ESCAPED_LT, extractRoadmapJson, injectRoadmap, rawTextElements, RECEIPT_ELEMENT_ID, scriptJson, ViewerTemplateError } from './viewer';

const template = readFileSync(join(import.meta.dirname, 'fixtures', 'viewer.html'), 'utf8');
const receipt = { opened: 24, kept: 22, dead: 1, flagged: 1, checkedOn: '2026-11-13' };

function hostile(): Roadmap {
  const roadmap = structuredClone(sampleRoadmap()) as any;
  roadmap.title = 'Rust </script><script>alert(1)</script> & more';
  roadmap.stages[0].waypoints[0].note = 'Ends a script: </SCRIPT> and <!-- a comment, and $& and $1 stay as typed.';
  return roadmap as Roadmap;
}

describe('scriptJson', () => {
  it('escapes every "<" so nothing can close the script element', () => {
    const text = scriptJson({ a: '</script><b>' });
    expect(text).not.toContain('<');
    expect(text).toContain(`${ESCAPED_LT}/script>`);
    expect(JSON.parse(text)).toEqual({ a: '</script><b>' });
  });

  it('escapes the Unicode line separators', () => {
    const value = { a: `x${String.fromCharCode(0x2028)}y${String.fromCharCode(0x2029)}z` };
    const text = scriptJson(value);
    expect([...text].some((c) => c.charCodeAt(0) === 0x2028 || c.charCodeAt(0) === 0x2029)).toBe(false);
    expect(JSON.parse(text)).toEqual(value);
  });
});

describe('rawTextElements', () => {
  it('skips decoys inside scripts, styles and comments', () => {
    const elements = rawTextElements(template);
    const holders = elements.filter((e) => e.id === 'zero-to-roadmap');
    expect(holders).toHaveLength(1);
    const titles = elements.filter((e) => e.name === 'title');
    expect(titles).toHaveLength(1);
    expect(template.slice(titles[0]!.contentStart, titles[0]!.contentEnd)).toBe('zero-to');
  });
});

describe('injectRoadmap', () => {
  it('writes the roadmap into the element and the title into the head', () => {
    const roadmap = sampleRoadmap();
    const html = injectRoadmap(template, roadmap);
    expect(extractRoadmapJson(html)).toEqual(roadmap);
    expect(html).toContain(`<title>${roadmap.title} · zero-to</title>`);
    expect(html).toContain('decoy');
    expect(html).toContain('<!-- <script type="application/json" id="zero-to-roadmap">commented out</script> -->');
    expect(extractRoadmapJson(html, RECEIPT_ELEMENT_ID)).toBeUndefined();
  });

  it('keeps </script> inside roadmap text from breaking out, and escapes the title', () => {
    const roadmap = hostile();
    const html = injectRoadmap(template, roadmap);
    expect(html).not.toContain('</script><script>alert(1)');
    expect(html).not.toMatch(/<\/SCRIPT>/);
    expect(html).toContain('<title>Rust &lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt; &amp; more · zero-to</title>');
    const elements = rawTextElements(html);
    expect(elements.filter((e) => e.name === 'script')).toHaveLength(4);
    expect(extractRoadmapJson(html)).toEqual(roadmap);
  });

  it('fills the receipt slot, or adds one after the roadmap when the template has none', () => {
    const roadmap = sampleRoadmap();
    const filled = injectRoadmap(template, roadmap, receipt);
    expect(extractRoadmapJson(filled, RECEIPT_ELEMENT_ID)).toEqual(receipt);
    const bare = template.replace('<script type="application/json" id="zero-to-receipt"></script>\n', '');
    const added = injectRoadmap(bare, roadmap, receipt);
    expect(extractRoadmapJson(added, RECEIPT_ELEMENT_ID)).toEqual(receipt);
    expect(added.indexOf('id="zero-to-receipt"')).toBeGreaterThan(added.indexOf('id="zero-to-roadmap"'));
  });

  it('adds a title when the template has none', () => {
    const html = injectRoadmap('<html><head></head><body><script type="application/json" id="zero-to-roadmap"></script></body></html>', sampleRoadmap());
    expect(html).toMatch(/^<html><head><title>Zero to Rust, coming from Python · zero-to<\/title><\/head>/);
  });

  it('refuses a template without the roadmap element', () => {
    expect(() => injectRoadmap('<html><head><title>x</title></head></html>', sampleRoadmap())).toThrow(ViewerTemplateError);
  });
});
