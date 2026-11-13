import { el } from './dom';
import { safeHttpUrl } from './parse';
import { hostnameOf } from './meta';
import type { Block, Inline } from './types';

/** The words the renderer adds around links. */
export interface RenderText {
  /** Hidden text that completes the name of a link that opens another tab, for example "opens in a new tab". */
  newTab: string;
  /** Printed after a link whose text looks like an address that is not where it goes. */
  differs: (host: string) => string;
}

export const defaultRenderText: RenderText = {
  newTab: 'opens in a new tab',
  differs: (host) => `Goes to ${host}`,
};

const ADDRESS = /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/?#]\S*)?$/i;

/** The host a link label claims to be, or an empty string when the label does not look like an address. */
function claimedHost(label: string): string {
  const text = label.trim();
  if (!ADDRESS.test(text)) return '';
  return hostnameOf(/^https?:/i.test(text) ? text : `https://${text}`);
}

const plainText = (inlines: Inline[]): string =>
  inlines
    .map((inline) => {
      if (inline.t === 'text' || inline.t === 'code') return inline.v;
      return inline.t === 'br' ? ' ' : plainText(inline.c);
    })
    .join('');

function appendInlines(parent: Node, inlines: Inline[], dom: Document, text: RenderText): void {
  for (const inline of inlines) parent.appendChild(renderInline(inline, dom, text));
}

function wrapped(tag: 'em' | 'strong', inlines: Inline[], dom: Document, text: RenderText): HTMLElement {
  const node = el(dom, tag);
  appendInlines(node, inlines, dom, text);
  return node;
}

function renderInline(inline: Inline, dom: Document, text: RenderText): Node {
  switch (inline.t) {
    case 'text':
      return dom.createTextNode(inline.v);
    case 'em':
      return wrapped('em', inline.c, dom, text);
    case 'strong':
      return wrapped('strong', inline.c, dom, text);
    case 'code':
      return el(dom, 'code', undefined, inline.v);
    case 'br':
      return el(dom, 'br');
    case 'link': {
      // Blocks can be built by hand, so the target is checked again here.
      const href = safeHttpUrl(inline.href);
      if (!href) {
        const plain = dom.createDocumentFragment();
        appendInlines(plain, inline.c, dom, text);
        return plain;
      }
      const link = el(dom, 'a');
      link.setAttribute('href', href);
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
      appendInlines(link, inline.c, dom, text);
      link.appendChild(el(dom, 'span', 'bb-visually-hidden', ` (${text.newTab})`));
      return withHost(dom, link, href, plainText(inline.c), text);
    }
  }
}

/** The link followed by where it really goes, in small type. A label that names another address is flagged. */
function withHost(dom: Document, link: HTMLElement, href: string, label: string, text: RenderText): Node {
  const host = hostnameOf(href);
  if (!host) return link;
  const claimed = claimedHost(label);
  const differs = claimed !== '' && claimed !== host;
  // A label that already starts with the host says it all.
  if (!differs && label.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').toLowerCase().startsWith(host)) return link;
  const wrap = dom.createDocumentFragment();
  const note = el(dom, 'span', differs ? 'bb-reader__link-host bb-reader__link-host--differs' : 'bb-reader__link-host', differs ? text.differs(host) : host);
  wrap.append(link, ' ', note);
  return wrap;
}

function renderBlock(block: Block, dom: Document, text: RenderText): HTMLElement {
  switch (block.type) {
    case 'heading': {
      const heading = el(dom, block.level === 2 ? 'h2' : 'h3');
      appendInlines(heading, block.inlines, dom, text);
      return heading;
    }
    case 'paragraph': {
      const paragraph = el(dom, 'p');
      appendInlines(paragraph, block.inlines, dom, text);
      return paragraph;
    }
    case 'quote': {
      const quote = el(dom, 'blockquote');
      appendInlines(quote, block.inlines, dom, text);
      return quote;
    }
    case 'list': {
      const list = el(dom, block.ordered ? 'ol' : 'ul');
      for (const item of block.items) {
        const entry = el(dom, 'li');
        appendInlines(entry, item, dom, text);
        list.appendChild(entry);
      }
      return list;
    }
    case 'code': {
      const pre = el(dom, 'pre');
      pre.appendChild(el(dom, 'code', undefined, block.text));
      return pre;
    }
    case 'rule':
      return el(dom, 'hr');
  }
}

/** Builds DOM for the blocks with createElement and text nodes only. Each block carries its index. */
export function renderBlocks(blocks: Block[], dom: Document = document, text: RenderText = defaultRenderText): DocumentFragment {
  const fragment = dom.createDocumentFragment();
  blocks.forEach((block, index) => {
    const node = renderBlock(block, dom, text);
    node.setAttribute('data-block', String(index));
    fragment.appendChild(node);
  });
  return fragment;
}
