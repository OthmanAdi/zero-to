import './reader.css';
import './reader-text.css';
import { buildArticleParts, fillBody, sameDocument, type ArticleHandlers } from './article';
import { cleanLang, resolveLabels } from './meta';
import { takeDraft, restoreDraft, worthKeeping } from './draft';
import { buildEnd, type End } from './end';
import { buildNotes } from './notes';
import { START, createProgressTracker, measureBlocks } from './progress';
import { trapTab } from './focus-trap';
import { measureFlightTarget, toBox } from './landing';
import { lastInputWasPointer } from './modality';
import { createRevealer } from './reveal';
import { TEXT_SIZES, normaliseScale, stepScale } from './text-size';
import { buildShell, showPlace } from './shell';
import { createTitleWatch } from './title-watch';
import type { NextLink, ReaderDoc, ReaderHandle, ReaderOptions } from './types';

let instanceCounter = 0;

export function mountReader(host: HTMLElement, options: ReaderOptions): ReaderHandle {
  const dom = host.ownerDocument;
  const labels = resolveLabels(options.labels);
  const uid = `bb-reader-${++instanceCounter}`;
  const titleId = `${uid}-title`;
  const canEdit = typeof options.onSaveText === 'function';
  const cover = options.cover ?? null;
  const shell = buildShell(dom, { titleId, labels, cover, coverAspect: options.coverAspect });
  const { root, sheet, bar } = shell;

  let source: ReaderDoc = options.doc;
  let editing = false;
  let body: HTMLElement = dom.createElement('div');
  let editButton: HTMLButtonElement | null = null;
  let destroyed = false;
  let scale = normaliseScale(options.textScale);
  let done = options.done === true;
  let next: NextLink | null = options.next ?? null;
  let end: End | null = null;
  let pasteField: HTMLTextAreaElement | null = null;
  const notesOn = typeof options.onMyNote === 'function' || options.myNote !== undefined;
  const notes = buildNotes(dom, {
    labels,
    fieldId: `${uid}-notes`,
    initial: options.myNote ?? '',
    onChange: (text) => options.onMyNote?.(text),
  });

  // The empty state and the paste panel scroll too, when the field takes focus, but that is not reading.
  const reading = (): boolean => !editing && Boolean(source.text?.trim());

  const tracker = createProgressTracker({
    scroller: sheet,
    measure: () => measureBlocks(sheet, body),
    topInset: () => bar.offsetHeight,
    onChange: (position, silent) => {
      // Once the person moves, the bar thumbnail goes back to following the cover beside the text.
      if (!silent) bar.removeAttribute('data-landing');
      if (!reading()) return;
      showProgress();
      if (!silent) options.onProgress?.(position);
    },
  });

  function applyScale(): void {
    if (scale === null) root.style.removeProperty('--bb-reader-size');
    else root.style.setProperty('--bb-reader-size', `${TEXT_SIZES[scale]}px`);
    shell.sizeDown.toggleAttribute('aria-disabled', scale === 0);
    shell.sizeUp.toggleAttribute('aria-disabled', scale === TEXT_SIZES.length - 1);
  }

  // The same words stay at the top of the screen: the position is put back once the lines have reflowed.
  function stepText(delta: -1 | 1): void {
    const measured = Number.parseFloat(dom.defaultView?.getComputedStyle(body).fontSize ?? '') || TEXT_SIZES[0];
    const next = stepScale(scale, delta, measured);
    if (next === scale) return;
    const here = tracker.current();
    scale = next;
    applyScale();
    tracker.restore({ block: here.block, ratio: here.ratio, percent: here.percent });
    options.onTextScale?.(next);
  }

  const showProgress = (): void => showPlace(shell, labels, reading() ? tracker.current().percent : null);

  const handlers: ArticleHandlers = {
    edit() {
      editing = true;
      render('field');
    },
    save(text) {
      options.onSaveText?.(text);
      source = { ...source, text };
      editing = false;
      render('edit', false);
      // A text that was just saved has not been read: it is shown from its top, and its place starts there.
      tracker.restore(START);
      options.onProgress?.({ ...START });
    },
    cancel() {
      editing = false;
      render('edit');
    },
  };

  const titleWatch = createTitleWatch(sheet, bar, (gone) => bar.toggleAttribute('data-away', gone));

  // The closing block belongs to a text that is being read, not to the empty state or the paste panel.
  function renderEnd(): void {
    end?.root.remove();
    end = null;
    if (!source.text?.trim() || editing) return;
    end = buildEnd(dom, {
      labels,
      done,
      canMark: typeof options.onDone === 'function',
      next,
      onDone: (value) => {
        done = value;
        options.onDone?.(value);
      },
      onNext: () => options.onNext?.(),
    });
    if (end) shell.article.appendChild(end.root);
  }

  function render(focusTarget: 'field' | 'edit' | null = null, relayout = true): void {
    const restoreNote = notesOn ? notes.keepFocus() : null;
    const parts = buildArticleParts(dom, { source, labels, titleId, canEdit, editing, example: options.example === true, handlers });
    shell.article.replaceChildren(...parts.nodes);
    body = parts.body;
    const lang = cleanLang(source.lang);
    if (lang) shell.article.lang = lang;
    else shell.article.removeAttribute('lang');
    editButton = parts.editButton;
    shell.barText.textContent = source.title;
    pasteField = fillBody({ dom, body, source, labels, fieldId: `${uid}-paste`, canEdit, editing, handlers });
    if (notesOn) notes.attach(body);
    restoreNote?.();
    renderEnd();
    // Watching measures the page. Measured while the text was still out, the page was short and the sheet fell back to its top.
    titleWatch.watch(shell.article.querySelector('h1'));
    Array.from(shell.article.children).forEach((child, index) => {
      child.classList.add('bb-reader__enter');
      (child as HTMLElement).style.setProperty('--bb-enter-index', String(Math.min(index, 4)));
    });
    if (focusTarget === 'field') pasteField?.focus({ preventScroll: true });
    if (focusTarget === 'edit') (editButton ?? sheet).focus({ preventScroll: true });
    if (relayout) tracker.settle();
    showProgress();
  }

  // Also offered to the host, so Escape works from the first frame of the opening, before any event reaches the dialog.
  function handleKey(event: KeyboardEvent): boolean {
    if (destroyed || event.defaultPrevented) return false;
    root.removeAttribute('data-pointer');
    if (event.key === 'Escape') {
      event.preventDefault();
      requestClose();
      return true;
    }
    if (event.key === 'Tab' && root.dataset.open === '1') trapTab(event, root, sheet);
    return event.defaultPrevented;
  }

  const onKeydown = (event: KeyboardEvent): void => void handleKey(event);

  const applyReveal = createRevealer(root, sheet);

  const requestClose = (): void => {
    notes.flush();
    options.onClose?.();
  };
  shell.closeButton.addEventListener('click', requestClose);
  root.addEventListener('keydown', onKeydown);
  shell.sizeDown.addEventListener('click', () => stepText(-1));
  shell.sizeUp.addEventListener('click', () => stepText(1));
  applyScale();

  host.appendChild(root);
  render(null, false);
  tracker.sync(true);
  if (options.progress) tracker.restore(options.progress);
  // Focus is inside from the first moment, so Escape and Tab work while the page is still arriving.
  if (lastInputWasPointer()) root.dataset.pointer = '1';
  shell.closeButton.focus({ preventScroll: true });

  const settle = (): void => {
    if (!destroyed) tracker.settle();
  };
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(settle) : null;
  observer?.observe(shell.layout);
  void dom.fonts?.ready.then(settle, () => undefined);

  return {
    element: root,
    scroller: sheet,
    setMyNote: (text) => notes.set(text),
    setDone(value) {
      done = value;
      end?.setDone(value);
    },
    setNext(value) {
      next = value;
      renderEnd();
      tracker.settle();
    },
    flightTarget() {
      return cover ? measureFlightTarget(shell, root.clientHeight || dom.defaultView?.innerHeight || 0) : null;
    },
    coverSlotRect() {
      return cover ? toBox(shell.coverSlot.getBoundingClientRect()) : null;
    },
    setReveal: applyReveal,
    handleKey,
    setCoverVisible(visible) {
      if (cover) cover.style.visibility = visible ? '' : 'hidden';
      shell.thumb.toggleAttribute('data-cover-hidden', !visible);
      shell.coverSlot.toggleAttribute('data-cover-hidden', !visible);
    },
    focus() {
      shell.closeButton.focus({ preventScroll: true });
    },
    update(doc) {
      if (destroyed) return;
      // Marking a link as read or saving a note sends the same document again: the text keeps its place and the button its focus.
      if (!editing && sameDocument(source, doc)) return;
      // Whatever is being typed in the paste field survives a change made elsewhere, such as another tab.
      const typed = takeDraft(dom, pasteField);
      source = doc;
      const keep = worthKeeping(typed, doc.text, editing);
      editing = keep;
      tracker.restore(null);
      render();
      if (keep && pasteField) restoreDraft(typed, pasteField);
    },
    progress: () => (reading() ? tracker.current() : { ...START }),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      notes.destroy();
      tracker.destroy();
      observer?.disconnect();
      titleWatch.destroy();
      shell.closeButton.removeEventListener('click', requestClose);
      root.removeEventListener('keydown', onKeydown);
      root.remove();
    },
  };
}
