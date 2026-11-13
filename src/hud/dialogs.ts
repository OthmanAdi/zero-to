/**
 * The panels that open over the map: the shortcut list, the share dialog, the open dialog with its preview, and
 * the shell that the notebook and the pace choices are shown in.
 *
 * Every panel is a native `<dialog>` opened as a modal, so focus stays inside, Escape closes it and focus goes
 * back to the control that opened it. A roadmap from outside is validated and previewed first. Nothing is
 * applied until the visitor confirms.
 */
import { uiLang } from '../i18n';
import { formatDay, formatHours } from '../look/format';
import { deriveTrek } from '../roadmap/derive';
import { MAX_JSON_BYTES, ShareTooLargeError, decodeRoadmap, encodeRoadmap } from '../roadmap/share';
import type { Issue, Roadmap } from '../roadmap/types';
import { validateRoadmap } from '../roadmap/validate';
import { el, fill, icon, roadText, setText, uid, type Child } from './dom';
import { say, tierKey } from './strings';

export interface Panel {
  readonly element: HTMLDialogElement;
  readonly body: HTMLElement;
  readonly isOpen: boolean;
  open(opener?: HTMLElement | null): void;
  close(): void;
  setTitle(text: string): void;
  onClose(listener: () => void): void;
  destroy(): void;
}

export type PanelKind = 'sheet' | 'drawer';

/**
 * A paper panel. `sheet` sits in the middle of the window, `drawer` hangs at its right edge over the full height
 * (the notebook).
 */
export function createPanel(host: HTMLElement, kind: PanelKind, name: string): Panel {
  const titleId = uid('zh-panel-title');
  const title = el('h2', { class: 'zh-panel-title zt-title', id: titleId });
  const close = el('button', { type: 'button', class: 'zh-panel-close zh-tool zt-on-paper' }, icon('close'));
  const body = el('div', { class: 'zh-panel-body' });
  const dialog = el('dialog', { class: `zh-panel zh-panel-${kind} zt-on-paper`, 'aria-labelledby': titleId, 'data-panel': name }, el('header', { class: 'zh-panel-head' }, title, close), body);
  const closers = new Set<() => void>();
  let opener: HTMLElement | null = null;

  const doClose = (): void => {
    if (!dialog.open) return;
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  };
  close.addEventListener('click', doClose);
  // A press on the dimmed room beside the paper closes the panel.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) doClose();
  });
  dialog.addEventListener('close', () => {
    for (const listener of [...closers]) listener();
    const back = opener;
    opener = null;
    if (back && back.isConnected) back.focus();
  });
  // Shortcuts of the page must not act while a panel is open.
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') event.stopPropagation();
  });
  host.append(dialog);

  return {
    element: dialog,
    body,
    get isOpen() {
      return dialog.open;
    },
    open(from) {
      if (dialog.open) return;
      opener = from ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      close.setAttribute('aria-label', say('close'));
      close.title = say('close');
      dialog.lang = uiLang();
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      // Focus starts on the panel's first field or main action when it has one, else on the close button.
      (body.querySelector<HTMLElement>('[data-first]') ?? close).focus();
    },
    close: doClose,
    setTitle(text) {
      setText(title, text);
    },
    onClose(listener) {
      closers.add(listener);
    },
    destroy() {
      closers.clear();
      dialog.remove();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// Shortcut list

export type ShortcutRow = readonly [keys: string, what: string];

/** The shortcuts by view, as the list shows them. */
export function shortcutRows(): { readonly table: readonly ShortcutRow[]; readonly walk: readonly ShortcutRow[] } {
  return {
    table: [
      [say('keyLeftRight'), say('keyTurn')],
      [say('keyEnterSpace'), say('keyEnter')],
      [say('keyEscape'), say('keyEscapeTable')],
      ['L', say('keyList')],
      ['N', say('keyNotebook')],
      ['B', say('keyShelf')],
      ['?', say('keyHelp')],
    ],
    walk: [
      [say('keyLeftRight'), say('keyStep')],
      ['D', say('keyDone')],
      [say('keyEscape'), say('keyEscapeWalk')],
      ['L', say('keyList')],
      ['N', say('keyNotebook')],
      ['B', say('keyShelf')],
      ['?', say('keyHelp')],
    ],
  };
}

export function fillShortcuts(panel: Panel): void {
  panel.setTitle(say('shortcutsTitle'));
  const rows = shortcutRows();
  const table = (caption: string, list: readonly ShortcutRow[]): HTMLElement =>
    el(
      'table',
      { class: 'zh-keys' },
      el('caption', { class: 'zt-label' }, caption),
      el(
        'tbody',
        null,
        ...list.map(([keys, what]) =>
          el(
            'tr',
            null,
            el('th', { scope: 'row' }, ...keys.split(', ').flatMap((key, i): Child[] => [i > 0 ? ' ' : null, el('kbd', { class: 'zh-kbd' }, key)])),
            el('td', null, what),
          ),
        ),
      ),
    );
  panel.body.replaceChildren(el('div', { class: 'zh-keys-grid' }, table(say('keysTable'), rows.table), table(say('keysWalk'), rows.walk)));
}

// ---------------------------------------------------------------------------------------------------------
// What a roadmap holds, for the preview

export interface RoadmapFacts {
  readonly title: string;
  readonly lang: string;
  readonly summary: string;
  readonly stages: number;
  readonly steps: number;
  readonly minutes: number;
  readonly sources: number;
  /** Sources that are gated or unverified. */
  readonly marked: number;
  readonly checkedOn: string;
  readonly tier: Roadmap['brief']['targetTier'];
  readonly teacher: boolean;
}

export function roadmapFacts(roadmap: Roadmap): RoadmapFacts {
  const trek = deriveTrek(roadmap);
  return {
    title: roadmap.title,
    lang: roadmap.lang,
    summary: roadmap.summary ?? '',
    stages: roadmap.stages.length,
    steps: roadmap.stages.reduce((sum, stage) => sum + stage.waypoints.length, 0),
    minutes: trek.totalMinutes,
    sources: roadmap.resources.length,
    marked: roadmap.resources.filter((r) => r.check.status !== 'verified').length,
    checkedOn: roadmap.checkedOn,
    tier: roadmap.brief.targetTier,
    teacher: roadmap.class !== undefined || roadmap.stages.some((stage) => stage.waypoints.some((w) => w.teacherNote !== undefined)),
  };
}

/** The counts of a roadmap as a description list: what the visitor sees before anything is applied. */
export function factsList(facts: RoadmapFacts): HTMLElement {
  const row = (label: string, value: string): HTMLElement => el('div', { class: 'zh-fact' }, el('dt', { class: 'zt-label' }, label), el('dd', { class: 'zt-data' }, value));
  return el(
    'dl',
    { class: 'zh-facts' },
    row(say('previewStages'), String(facts.stages)),
    row(say('previewSteps'), String(facts.steps)),
    row(say('previewHours'), formatHours(facts.minutes)),
    row(say('previewSources'), String(facts.sources)),
    row(say('previewChecked'), formatDay(facts.checkedOn)),
    row(say('previewTier'), say(tierKey(facts.tier))),
    row(say('previewLang'), facts.lang.toUpperCase()),
  );
}

// ---------------------------------------------------------------------------------------------------------
// Share

/** The address of this page with a roadmap in its fragment. */
export function shareUrl(fragment: string, base?: string): string {
  const here = base ?? (typeof location === 'undefined' ? '' : `${location.origin}${location.pathname}${location.search}`);
  return `${here}#r=${fragment}`;
}

export interface ShareOptions {
  readonly onDownload?: (roadmap: Roadmap) => void;
  /** The address links are built on. Default: this page. */
  readonly base?: string;
}

/** Fills the share panel for a roadmap. Resolves when the link is built or has failed. */
export async function fillShare(panel: Panel, roadmap: Roadmap, options: ShareOptions = {}): Promise<void> {
  panel.setTitle(say('shareTitle'));
  const facts = roadmapFacts(roadmap);
  const fieldId = uid('zh-share');
  const field = el('input', { type: 'text', id: fieldId, class: 'zh-field zt-data', readonly: true, spellcheck: 'false' });
  const copy = el('button', { type: 'button', class: 'zh-btn zh-btn-strong', disabled: true, 'data-first': true }, say('shareCopy'));
  const status = el('p', { class: 'zh-panel-status zt-small', role: 'status' }, say('shareBuilding'));
  const download = el('button', { type: 'button', class: 'zh-btn', hidden: true }, say('shareDownload'));
  download.addEventListener('click', () => options.onDownload?.(roadmap));
  field.addEventListener('focus', () => field.select());
  copy.addEventListener('click', () => {
    const done = (ok: boolean): void => {
      setText(status, say(ok ? 'shareCopied' : 'shareCopyFailed'));
    };
    const clip = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (!clip?.writeText) {
      field.select();
      done(false);
      return;
    }
    clip.writeText(field.value).then(
      () => done(true),
      () => {
        field.select();
        done(false);
      },
    );
  });

  fill(
    panel.body,
    roadText('p', roadmap.title, roadmap.lang, { class: 'zh-panel-road zt-title' }),
    el('p', { class: 'zt-small' }, say('shareIntro')),
    el('div', { class: 'zh-field-block' }, el('label', { class: 'zt-label', for: fieldId }, say('shareLink')), el('div', { class: 'zh-field-row' }, field, copy)),
    status,
    download,
    el('p', { class: 'zh-panel-note zt-small' }, say('sharePrivate')),
    facts.teacher ? el('p', { class: 'zh-panel-note zt-small' }, say('shareTeacher')) : null,
  );

  try {
    const fragment = await encodeRoadmap(roadmap);
    field.value = shareUrl(fragment, options.base);
    copy.disabled = false;
    setText(status, '');
  } catch (cause) {
    setText(status, cause instanceof ShareTooLargeError ? say('shareTooLarge') : String((cause as Error)?.message ?? cause));
    field.hidden = true;
    copy.hidden = true;
    download.hidden = false;
  }
}

// ---------------------------------------------------------------------------------------------------------
// Open, with the preview

export type ReadResult =
  | { readonly ok: true; readonly roadmap: Roadmap; readonly source: 'link' | 'file'; readonly name: string }
  | { readonly ok: false; readonly error: string; readonly issues: readonly Issue[]; readonly lang: 'ui' | 'en' };

/** The roadmap fragment of a pasted link: what follows `#r=`. A bare fragment is taken as it is. */
export function fragmentOf(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const marker = trimmed.indexOf('#r=');
  if (marker >= 0) return trimmed.slice(marker + 3);
  if (trimmed.startsWith('r=')) return trimmed.slice(2);
  if (/^[zj]1\.[A-Za-z0-9_-]+$/.test(trimmed)) return trimmed;
  return null;
}

/** Reads a pasted link. Never throws. Messages from the roadmap package are in English and marked as such. */
export async function readLink(text: string): Promise<ReadResult> {
  if (text.trim() === '') return { ok: false, error: say('openEmpty'), issues: [], lang: 'ui' };
  const fragment = fragmentOf(text);
  if (fragment === null) return { ok: false, error: say('openNotLink'), issues: [], lang: 'ui' };
  const result = await decodeRoadmap(fragment);
  if (!result.ok) return { ok: false, error: result.error, issues: result.errors, lang: 'en' };
  return { ok: true, roadmap: result.roadmap, source: 'link', name: '' };
}

/** Reads the text of a roadmap file. Never throws. */
export function readFileText(text: string, name: string): ReadResult {
  if (text.length > MAX_JSON_BYTES) return { ok: false, error: say('openTooBig'), issues: [], lang: 'ui' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: say('openBadFile'), issues: [], lang: 'ui' };
  }
  const result = validateRoadmap(parsed);
  if (!result.ok) return { ok: false, error: say('openInvalid'), issues: result.errors, lang: 'ui' };
  return { ok: true, roadmap: result.roadmap, source: 'file', name };
}

export interface OpenOptions {
  /** Called once, when the visitor confirms the preview. Nothing is applied before that. */
  readonly onApply: (roadmap: Roadmap, source: 'link' | 'file') => void;
}

export interface OpenDialog {
  /** Shows the first page: paste a link or choose a file. */
  showForm(): void;
  /** Shows the preview of a roadmap that was already read, for example from the page's own address. */
  showPreview(roadmap: Roadmap, source: 'link' | 'file', name?: string): void;
  /** Shows why something could not be read. */
  showError(result: Extract<ReadResult, { ok: false }>): void;
}

const MAX_ISSUES = 5;

export function fillOpen(panel: Panel, options: OpenOptions): OpenDialog {
  const linkId = uid('zh-open');
  const fileId = uid('zh-file');

  const showError = (result: Extract<ReadResult, { ok: false }>): void => {
    showForm();
    const box = panel.body.querySelector<HTMLElement>('.zh-panel-error');
    if (!box) return;
    const lang = result.lang === 'en' ? 'en' : uiLang();
    const shown = result.issues.slice(0, MAX_ISSUES);
    fill(
      box,
      el('p', { class: 'zt-small', lang }, result.error),
      shown.length > 0
        ? el('ul', { class: 'zh-issues', lang: 'en' }, ...shown.map((issue) => el('li', { class: 'zt-small' }, el('code', { class: 'zt-data' }, issue.path || '/'), ' ', issue.message)))
        : null,
      result.issues.length > shown.length ? el('p', { class: 'zt-small' }, say('openMore', { count: result.issues.length - shown.length })) : null,
    );
    box.hidden = false;
    box.focus();
  };

  const handle = (result: ReadResult): void => {
    if (result.ok) showPreview(result.roadmap, result.source, result.name);
    else showError(result);
  };

  const readFile = (file: File): void => {
    if (file.size > MAX_JSON_BYTES) {
      handle({ ok: false, error: say('openTooBig'), issues: [], lang: 'ui' });
      return;
    }
    file.text().then(
      (text) => handle(readFileText(text, file.name)),
      () => handle({ ok: false, error: say('openBadFile'), issues: [], lang: 'ui' }),
    );
  };

  function showForm(): void {
    panel.setTitle(say('openTitle'));
    const field = el('input', { type: 'text', id: linkId, class: 'zh-field zt-data', spellcheck: 'false', autocomplete: 'off', inputmode: 'url', 'data-first': true });
    const read = el('button', { type: 'submit', class: 'zh-btn zh-btn-strong' }, say('openRead'));
    const status = el('p', { class: 'zh-panel-status zt-small', role: 'status' });
    const form = el('form', { class: 'zh-field-block', novalidate: true }, el('label', { class: 'zt-label', for: linkId }, say('openLink')), el('div', { class: 'zh-field-row' }, field, read));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      setText(status, say('openReading'));
      void readLink(field.value).then((result) => {
        setText(status, '');
        handle(result);
      });
    });
    const file = el('input', { type: 'file', id: fileId, class: 'zh-sr', accept: '.json,application/json' });
    file.addEventListener('change', () => {
      const picked = file.files?.[0];
      if (picked) readFile(picked);
    });
    const drop = el('div', { class: 'zh-drop' }, file, el('label', { class: 'zh-btn', for: fileId }, say('openFile')), el('span', { class: 'zt-small' }, say('openDrop')));
    drop.addEventListener('dragover', (event) => {
      event.preventDefault();
      drop.classList.add('is-over');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
    drop.addEventListener('drop', (event) => {
      event.preventDefault();
      drop.classList.remove('is-over');
      const dropped = (event as DragEvent).dataTransfer?.files?.[0];
      if (dropped) readFile(dropped);
    });
    const error = el('div', { class: 'zh-panel-error', role: 'alert', tabindex: -1, hidden: true });
    panel.body.replaceChildren(el('p', { class: 'zt-small' }, say('openIntro')), form, status, drop, error);
  }

  function showPreview(roadmap: Roadmap, source: 'link' | 'file', name = ''): void {
    panel.setTitle(say('previewTitle'));
    const facts = roadmapFacts(roadmap);
    const from = say('previewFrom', { source: source === 'link' ? say('previewFromLink') : say('previewFromFile', { name }) });
    const apply = el('button', { type: 'button', class: 'zh-btn zh-btn-strong', 'data-action': 'apply', 'data-first': true }, say('previewApply'));
    const back = el('button', { type: 'button', class: 'zh-btn', 'data-action': 'back' }, say('previewBack'));
    apply.addEventListener('click', () => {
      // The one place where a roadmap from outside is handed on.
      options.onApply(roadmap, source);
      panel.close();
    });
    back.addEventListener('click', showForm);
    fill(
      panel.body,
      el('p', { class: 'zt-label zh-panel-from' }, from),
      roadText('p', facts.title, facts.lang, { class: 'zh-panel-road zt-title' }),
      facts.summary ? roadText('p', facts.summary, facts.lang, { class: 'zt-small' }) : null,
      factsList(facts),
      facts.marked > 0 ? el('p', { class: 'zh-panel-note zt-small' }, say('previewMarked', { count: facts.marked })) : null,
      el('p', { class: 'zh-panel-note zt-small' }, say('previewKeeps')),
      el('div', { class: 'zh-panel-actions' }, apply, back),
    );
    if (panel.isOpen) apply.focus();
  }

  showForm();
  return { showForm, showPreview, showError };
}
