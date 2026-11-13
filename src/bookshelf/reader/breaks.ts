import type { Inline } from './types';

/** Collapses runs of spaces and tabs, which pasted text is full of. */
export const squash = (line: string): string => line.replace(/[ \t]+/g, ' ');

/** Turns the newlines a paragraph kept into explicit line breaks. */
export function withBreaks(inlines: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const node of inlines) {
    if (node.t === 'text' && node.v.includes('\n')) {
      node.v.split('\n').forEach((piece, index) => {
        if (index > 0) out.push({ t: 'br' });
        if (piece) out.push({ t: 'text', v: piece });
      });
    } else if (node.t === 'em' || node.t === 'strong' || node.t === 'link') {
      out.push({ ...node, c: withBreaks(node.c) });
    } else {
      out.push(node);
    }
  }
  return out;
}
