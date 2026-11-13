import { h } from './dom';
import type { Session } from './session';
import { say } from './strings';

/**
 * The line that says progress is kept for this visit only. Hidden while the browser stores progress. Cards place
 * it near the controls that save something; the toolbar can place its own.
 */
export function storageNotice(session: Session): { readonly root: HTMLParagraphElement; update(): void } {
  const root = h('p', { class: 'zl-notice', role: 'status' });
  const update = (): void => {
    const state = session.storage;
    const show = state.kind === 'memory';
    root.hidden = !show;
    const text = show ? say(state.reason === 'full' ? 'memoryFull' : 'memoryOnly') : '';
    if (root.textContent !== text) root.textContent = text;
  };
  update();
  return { root, update };
}
