/**
 * Small DOM helpers of the landing sections. Nothing here sets `innerHTML` from a string that came from a
 * visitor: `rich` builds nodes, and `svg` is only ever given drawings written in this folder.
 */

export type Child = Node | string | null | undefined | false;
export type Attrs = Readonly<Record<string, string | number | boolean | null | undefined>>;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Creates an element. `class` is the class list, a `true` value is an empty attribute, null and false are left out. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    node.setAttribute(name, value === true ? '' : String(value));
  }
  append(node, children);
  return node;
}

export function append(node: Element, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
}

/**
 * Turns the two marks of the strings into nodes: `*word*` becomes `<em>` and `` `code` `` becomes `<code>`.
 * Everything else is text.
 */
export function rich(text: string): DocumentFragment {
  const out = document.createDocumentFragment();
  const pattern = /\*([^*]+)\*|`([^`]+)`/g;
  let last = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match.index > last) out.append(text.slice(last, match.index));
    const node = document.createElement(match[1] !== undefined ? 'em' : 'code');
    node.textContent = match[1] ?? match[2] ?? '';
    out.append(node);
    last = match.index + match[0].length;
  }
  if (last < text.length) out.append(text.slice(last));
  return out;
}

/** The text of a marked string without its marks, for labels and attributes. */
export function plain(text: string): string {
  return text.replace(/\*([^*]+)\*|`([^`]+)`/g, (_whole, em: string | undefined, code: string | undefined) => em ?? code ?? '');
}

/** An SVG element from a drawing written in this folder. Hidden from assistive technology: the art is decoration. */
export function svg(viewBox: string, inner: string, className = ''): SVGSVGElement {
  const node = document.createElementNS(SVG_NS, 'svg');
  node.setAttribute('viewBox', viewBox);
  node.setAttribute('aria-hidden', 'true');
  node.setAttribute('focusable', 'false');
  if (className) node.setAttribute('class', className);
  node.innerHTML = inner;
  return node;
}

export function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    node.setAttribute(name, String(value));
  }
  return node;
}

/** Copies text to the clipboard. Resolves to false when the browser refuses, so the caller can say so. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the old way.
  }
  try {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.cssText = 'position:fixed;left:-999px;top:0;opacity:0';
    document.body.append(field);
    field.select();
    const done = document.execCommand('copy');
    field.remove();
    return done;
  } catch {
    return false;
  }
}
