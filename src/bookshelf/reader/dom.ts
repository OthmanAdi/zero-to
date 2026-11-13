/** Small element factory. Text always goes in through textContent. */
export function el<K extends keyof HTMLElementTagNameMap>(
  dom: Document,
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = dom.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
