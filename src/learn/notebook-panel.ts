/**
 * The field notebook as a panel: everything pinned, in the learner's order, with a way to move and remove
 * entries, add a line of their own, download it as Markdown and print it as a handout.
 */
import { formatNumber } from '../look/format';
import { cardRoot, h, headingTag, roadText, uid, type CardOptions, type MountedCard } from './dom';
import { mount } from './mount';
import { NOTEBOOK_MAX_ENTRIES, NOTEBOOK_MAX_TEXT, notebookToMarkdown, type NotebookEntry } from './notebook';
import { storageNotice } from './notice';
import { findWaypoint, type Session } from './session';
import { say } from './strings';
import { uiLang } from '../i18n';

export interface NotebookPanelOptions extends CardOptions {
  /** Where a line of the learner's own belongs. Default: the step the learner is at. */
  readonly place?: () => { readonly stageId: string; readonly waypointId?: string };
  /** Replaces the browser's print dialog, for example with the handout print of the outline. */
  readonly onPrint?: () => void;
}

export function notebookFileName(roadmapId: string): string {
  return `${roadmapId}-notebook.md`;
}

function download(name: string, text: string): void {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function notebookPanel(session: Session, options: NotebookPanelOptions = {}): MountedCard {
  const level = options.headingLevel ?? 2;
  const root = cardRoot('section', 'zl-notebook');
  const { roadmap, notebook } = session;
  const lang = roadmap.lang;

  const placeFor = (): { stageId: string; waypointId?: string } => {
    if (options.place) return options.place();
    const here = session.here();
    if (here) return { stageId: here.stageId, waypointId: here.waypointId };
    const last = roadmap.stages[roadmap.stages.length - 1];
    return { stageId: last?.id ?? '' };
  };

  const build = () => {
    const titleId = uid('zl-title');
    root.setAttribute('aria-labelledby', titleId);
    const count = h('p', { class: 'zl-meta zl-count-line' });
    const notice = storageNotice(session);
    const list = h('ol', { class: 'zl-entries' });
    const empty = h('p', { class: 'zl-hint zl-empty' }, say('notebookEmpty'));
    const full = h('p', { class: 'zl-notice', role: 'status' }, say('notebookFull', { max: formatNumber(NOTEBOOK_MAX_ENTRIES) }));

    const ownId = uid('zl-own');
    const ownInput = h('input', { type: 'text', id: ownId, class: 'zl-field', maxlength: NOTEBOOK_MAX_TEXT, dir: 'auto' });
    const form = h(
      'form',
      { class: 'zl-own' },
      h('label', { class: 'zl-field-label', for: ownId }, say('addOwn')),
      h('div', { class: 'zl-field-row' }, ownInput, h('button', { type: 'submit', class: 'zl-btn' }, say('add'))),
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (session.pin({ kind: 'own', text: ownInput.value, ...placeFor() })) ownInput.value = '';
    });

    const downloadButton = h('button', { type: 'button', class: 'zl-btn' }, say('download'));
    downloadButton.addEventListener('click', () => {
      download(notebookFileName(roadmap.id), notebookToMarkdown(notebook.entries, roadmap, { lang: uiLang(), today: session.today() }));
    });
    const printButton = h('button', { type: 'button', class: 'zl-btn zl-btn-quiet' }, say('print'));
    printButton.addEventListener('click', () => (options.onPrint ? options.onPrint() : window.print()));

    root.append(
      h(
        'header',
        { class: 'zl-head' },
        h(headingTag(level), { class: 'zl-title', id: titleId }, say('notebookTitle')),
        count,
        h('p', { class: 'zl-hint' }, say('notebookPrivate')),
      ),
      notice.root,
      empty,
      list,
      full,
      form,
      h('div', { class: 'zl-row zl-export' }, downloadButton, printButton),
    );

    const placeLabel = (entry: NotebookEntry): string | null => {
      const stageIndex = roadmap.stages.findIndex((s) => s.id === entry.stageId);
      const stage = roadmap.stages[stageIndex];
      if (!stage) return null;
      const node = entry.waypointId ? findWaypoint(roadmap, entry.waypointId) : undefined;
      return node ? node.waypoint.title : stage.project ? stage.project.title : stage.title;
    };

    const renderEntry = (entry: NotebookEntry, index: number, total: number): HTMLLIElement => {
      const n = index + 1;
      const up = h('button', { type: 'button', class: 'zl-btn zl-btn-small', 'aria-label': say('moveUpName', { n }), 'data-act': 'up' }, say('moveUp'));
      const down = h('button', { type: 'button', class: 'zl-btn zl-btn-small', 'aria-label': say('moveDownName', { n }), 'data-act': 'down' }, say('moveDown'));
      const remove = h('button', { type: 'button', class: 'zl-btn zl-btn-small zl-btn-quiet', 'aria-label': say('removeName', { n }), 'data-act': 'remove' }, say('remove'));
      up.disabled = index === 0;
      down.disabled = index === total - 1;
      const refocus = (act: string, at: number): void => {
        const row = list.children[Math.max(0, Math.min(list.children.length - 1, at))];
        const target = (row?.querySelector(`[data-act="${act}"]:not(:disabled)`) ?? row?.querySelector('button:not(:disabled)')) as HTMLElement | null;
        (target ?? (list.children.length === 0 ? ownInput : null))?.focus({ preventScroll: true });
      };
      up.addEventListener('click', () => {
        notebook.move(entry.id, index - 1);
        refocus('up', index - 1);
      });
      down.addEventListener('click', () => {
        notebook.move(entry.id, index + 1);
        refocus('down', index + 1);
      });
      remove.addEventListener('click', () => {
        notebook.remove(entry.id);
        refocus('remove', index);
      });

      const place = placeLabel(entry);
      // Pinned roadmap text keeps the roadmap's language. A learner's own line has no known language.
      const text =
        entry.kind === 'link' && entry.url
          ? h('p', { class: 'zl-entry-text' }, roadText('a', entry.text, lang, { href: entry.url, target: '_blank', rel: 'noopener noreferrer' }))
          : entry.kind === 'own'
            ? h('p', { class: 'zl-entry-text', dir: 'auto' }, entry.text)
            : roadText('p', entry.text.replace('\n', ' · '), lang, { class: 'zl-entry-text' });
      return h(
        'li',
        { class: 'zl-entry', 'data-kind': entry.kind, 'data-id': entry.id },
        h('p', { class: 'zl-label zl-entry-kind' }, say(`kind.${entry.kind}`), place ? ' · ' : '', place ? roadText('span', place, lang, { class: 'zl-entry-place' }) : null),
        text,
        h('div', { class: 'zl-row zl-entry-actions' }, up, down, remove),
      );
    };

    let shown = '';
    const update = (): void => {
      const entries = notebook.entries;
      const signature = entries.map((e) => e.id).join('|');
      count.textContent = say('entries', { count: entries.length });
      empty.hidden = entries.length > 0;
      list.hidden = entries.length === 0;
      full.hidden = !notebook.full;
      notice.update();
      downloadButton.disabled = entries.length === 0;
      if (signature === shown) return;
      shown = signature;
      // Rebuilding the rows is cheap at 400 entries; the move and remove buttons put focus back themselves.
      list.replaceChildren(...entries.map((entry, i) => renderEntry(entry, i, entries.length)));
    };
    update();
    return { update };
  };

  return mount(session, root, build);
}
