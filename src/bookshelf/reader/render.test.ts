import { describe, expect, it } from 'vitest';
import { parseMarkdownLite } from './parse';
import { renderBlocks } from './render';

function render(markdown: string): HTMLElement {
  const host = document.createElement('div');
  host.appendChild(renderBlocks(parseMarkdownLite(markdown), document));
  return host;
}

describe('renderBlocks', () => {
  it('builds each block type with its element', () => {
    const host = render('## H2\n\n### H3\n\npara\n\n> quote\n\n- a\n- b\n\n1. x\n\n---\n\n```\ncode\n```');
    expect(Array.from(host.children).map((child) => child.tagName.toLowerCase())).toEqual([
      'h2', 'h3', 'p', 'blockquote', 'ul', 'ol', 'hr', 'pre',
    ]);
    expect(host.querySelectorAll('ul li')).toHaveLength(2);
    expect(host.querySelector('pre code')?.textContent).toBe('code');
  });

  it('renders inline elements', () => {
    const host = render('**s** *e* `c`');
    expect(host.querySelector('strong')?.textContent).toBe('s');
    expect(host.querySelector('em')?.textContent).toBe('e');
    expect(host.querySelector('code')?.textContent).toBe('c');
  });

  it('gives every top-level block its index in data-block', () => {
    const host = render('# a\n\ntext\n\n- x\n- y\n\n---');
    const indices = Array.from(host.children).map((child) => child.getAttribute('data-block'));
    expect(indices).toEqual(['0', '1', '2', '3']);
    expect(host.querySelector('li')?.hasAttribute('data-block')).toBe(false);
  });

  it('renders a line break inside a paragraph', () => {
    const paragraph = render('one\ntwo').querySelector('p');
    expect(paragraph?.childNodes).toHaveLength(3);
    expect(paragraph?.children[0]?.tagName).toBe('BR');
    expect(paragraph?.textContent).toBe('onetwo');
  });

  it('gives links target and rel', () => {
    const link = render('[site](https://example.com/x)').querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://example.com/x');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('renders unsafe link targets as plain text without an anchor', () => {
    const host = render('[go](javascript:alert(1)) [d](data:text/html,x) [r](/rel)');
    expect(host.querySelector('a')).toBeNull();
    expect(host.textContent).toBe('go d r');
  });

  it('re-checks hand-built link blocks', () => {
    const fragment = renderBlocks(
      [{ type: 'paragraph', inlines: [{ t: 'link', href: 'javascript:alert(1)', c: [{ t: 'text', v: 'x' }] }] }],
      document,
    );
    const host = document.createElement('div');
    host.appendChild(fragment);
    expect(host.querySelector('a')).toBeNull();
    expect(host.textContent).toBe('x');
  });

  it('keeps raw HTML as text and creates no extra elements', () => {
    const host = render('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\nsafe <b>bold</b>');
    expect(host.querySelector('script, img, b')).toBeNull();
    expect(host.querySelectorAll('*')).toHaveLength(3);
    expect(Array.from(host.querySelectorAll('*')).every((node) => node.tagName === 'P')).toBe(true);
    expect(host.textContent).toContain('<script>alert(1)</script>');
    expect(host.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('keeps raw HTML inside code and headings as text', () => {
    const host = render('## <i>x</i>\n\n```\n<script>1</script>\n```');
    expect(host.querySelector('i, script')).toBeNull();
    expect(host.querySelector('h2')?.textContent).toBe('<i>x</i>');
    expect(host.querySelector('pre code')?.textContent).toBe('<script>1</script>');
  });

  it('prints where a link really goes, after its text', () => {
    const host = render('Read [the standard](https://www.w3.org/TR/WCAG22/) first.');
    const note = host.querySelector('.bb-reader__link-host');
    expect(note?.textContent).toBe('w3.org');
    expect(host.querySelector('a')?.nextSibling?.nextSibling).toBe(note);
    expect(host.querySelector('a')?.contains(note ?? null)).toBe(false);
    expect(host.querySelector('.bb-reader__link-host--differs')).toBeNull();
  });

  it('completes the name of a link that opens another tab', () => {
    const link = render('[site](https://example.com/x)').querySelector('a');
    expect(link?.querySelector('.bb-visually-hidden')?.textContent).toBe(' (opens in a new tab)');
  });

  it('leaves out the host when the text already says it', () => {
    expect(render('[example.com](https://example.com/page)').querySelector('.bb-reader__link-host')).toBeNull();
    expect(render('[https://www.example.com/](https://example.com/)').querySelector('.bb-reader__link-host')).toBeNull();
    expect(render('[example.org/docs](https://example.org/docs)').querySelector('.bb-reader__link-host')).toBeNull();
  });

  it('flags a label that names another address than the one it goes to', () => {
    const host = render('[bank.example.com](https://evil.example.org/login)');
    const note = host.querySelector('.bb-reader__link-host--differs');
    expect(note?.textContent).toBe('Goes to evil.example.org');
  });

  it('does not flag ordinary words or a label that matches', () => {
    expect(render('[sign in here](https://example.org/a)').querySelector('.bb-reader__link-host--differs')).toBeNull();
    expect(render('[example.org/docs](https://example.org/other)').querySelector('.bb-reader__link-host--differs')).toBeNull();
  });

  it('takes the words around links from the caller', () => {
    const fragment = renderBlocks(parseMarkdownLite('[a.example.com](https://b.example.org/)'), document, {
      newTab: 'ouvre un nouvel onglet',
      differs: (host) => `Mene vers ${host}`,
    });
    const host = document.createElement('div');
    host.appendChild(fragment);
    expect(host.querySelector('.bb-visually-hidden')?.textContent).toBe(' (ouvre un nouvel onglet)');
    expect(host.querySelector('.bb-reader__link-host')?.textContent).toBe('Mene vers b.example.org');
  });
});
