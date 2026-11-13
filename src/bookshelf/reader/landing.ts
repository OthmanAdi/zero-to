import type { ShellRefs } from './shell';
import type { Box } from './types';

export const toBox = ({ x, y, width, height }: DOMRect): Box => ({ x, y, width, height });

/**
 * Where the cover lands: its own place beside the text while that is fully on screen under the bar,
 * otherwise the thumbnail in the bar. Null when neither has a layout.
 */
export function measureFlightTarget(shell: ShellRefs, viewportHeight: number): Box | null {
  const slot = toBox(shell.coverSlot.getBoundingClientRect());
  const barBottom = shell.bar.getBoundingClientRect().bottom;
  const usable = slot.width > 0 && slot.height > 0;
  if (usable && slot.y >= barBottom - 1 && slot.y + slot.height <= viewportHeight + 1) {
    shell.bar.removeAttribute('data-landing');
    return slot;
  }
  // The cover beside the text has scrolled away, or has no layout: land in the bar.
  shell.bar.setAttribute('data-landing', '');
  const thumb = toBox(shell.thumb.getBoundingClientRect());
  if (thumb.width > 0 && thumb.height > 0) return thumb;
  shell.bar.removeAttribute('data-landing');
  return usable ? slot : null;
}
