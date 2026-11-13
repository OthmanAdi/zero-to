/**
 * One small element tree with two writers: `toHtml` for the build (prerendered pages, print, social images) and
 * `toDom` for the browser. Both read the same tree, so the HTML a crawler reads and the DOM a learner reads say
 * exactly the same thing.
 *
 * Text is always text: `toHtml` escapes it and `toDom` makes text nodes. No writer ever parses markup, so roadmap
 * text from any file can never become markup. Attribute names come from this package's code only.
 */

export type AttrValue = string | number | boolean | null | undefined;
export type Attrs = Readonly<Record<string, AttrValue>>;

export interface ONode {
  readonly tag: string;
  readonly attrs: Attrs;
  readonly kids: readonly OChild[];
  /** SVG elements are created in the SVG namespace by `toDom`. */
  readonly svg?: boolean;
}

export type OChild = ONode | string;
type Kid = OChild | null | undefined | false | readonly Kid[];

function flat(kids: readonly Kid[], out: OChild[] = []): OChild[] {
  for (const kid of kids) {
    if (kid === null || kid === undefined || kid === false) continue;
    if (Array.isArray(kid)) flat(kid as readonly Kid[], out);
    else if (typeof kid === 'string') {
      if (kid !== '') out.push(kid);
    } else out.push(kid as ONode);
  }
  return out;
}

/** An HTML element. Children may be nested arrays; null, undefined, false and empty strings are dropped. */
export function el(tag: string, attrs?: Attrs | null, ...kids: Kid[]): ONode {
  return { tag, attrs: attrs ?? {}, kids: flat(kids) };
}

/** An SVG element (and every element below it, when built with `svgEl`). */
export function svgEl(tag: string, attrs?: Attrs | null, ...kids: Kid[]): ONode {
  return { tag, attrs: attrs ?? {}, kids: flat(kids), svg: true };
}

/** An element that holds roadmap text: marked with the roadmap's language, direction left to the text. */
export function road(tag: string, text: string, lang: string, attrs?: Attrs | null): ONode {
  return el(tag, { ...attrs, lang, dir: 'auto' }, text);
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

export function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttr(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const NAME = /^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/;

function attrText(attrs: Attrs): string {
  let out = '';
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (!NAME.test(name)) throw new Error(`tree: "${name}" is not an attribute name`);
    out += value === true ? ` ${name}` : ` ${name}="${escapeAttr(String(value))}"`;
  }
  return out;
}

/** The tree as HTML text. */
export function toHtml(node: OChild): string {
  if (typeof node === 'string') return escapeText(node);
  if (!NAME.test(node.tag)) throw new Error(`tree: "${node.tag}" is not a tag name`);
  const open = `<${node.tag}${attrText(node.attrs)}`;
  if (!node.svg && VOID.has(node.tag)) return `${open}>`;
  if (node.svg && node.kids.length === 0) return `${open}/>`;
  return `${open}>${node.kids.map(toHtml).join('')}</${node.tag}>`;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The tree as DOM nodes of `doc`. */
export function toDom(node: ONode, doc?: Document): Element;
export function toDom(node: OChild, doc?: Document): Node;
export function toDom(node: OChild, doc: Document = document): Node {
  if (typeof node === 'string') return doc.createTextNode(node);
  const element = node.svg ? doc.createElementNS(SVG_NS, node.tag) : doc.createElement(node.tag);
  for (const [name, value] of Object.entries(node.attrs)) {
    // The namespace is already set by createElementNS; as a plain attribute it is only for the text form.
    if (value === null || value === undefined || value === false || name === 'xmlns') continue;
    element.setAttribute(name, value === true ? '' : String(value));
  }
  for (const kid of node.kids) element.appendChild(toDom(kid, doc));
  return element;
}

/** The text a reader gets from the tree: the same as `textContent` of either writer's output. */
export function textOf(node: OChild): string {
  return typeof node === 'string' ? node : node.kids.map(textOf).join('');
}

const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

/** JSON that is safe inside a `<script>` element: `<` is written as an escape, so no text can close the element. */
export function scriptJson(value: unknown, space?: number): string {
  return JSON.stringify(value, null, space)
    .replace(/</g, '\\u003c')
    .split(LINE_SEPARATOR)
    .join('\\u2028')
    .split(PARAGRAPH_SEPARATOR)
    .join('\\u2029');
}
