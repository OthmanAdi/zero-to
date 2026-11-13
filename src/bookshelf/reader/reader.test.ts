import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountReader } from './index';
import type { ReaderDoc, ReaderHandle, ReaderOptions } from './index';

const doc: ReaderDoc = {
  id: 'a',
  title: 'A quiet essay',
  url: 'https://www.example.com/essay',
  author: 'Jo Writer',
  note: 'Read on the train',
  addedAt: '2026-03-04T10:00:00Z',
  text: '# Heading\n\nFirst paragraph with a [link](https://example.org/x).\n\n- one\n- two',
};

let host: HTMLElement;
let handle: ReaderHandle | null = null;

function mount(options: Partial<ReaderOptions> = {}): ReaderHandle {
  handle = mountReader(host, { doc, ...options });
  return handle;
}

const query = <T extends Element>(selector: string): T => {
  const found = host.querySelector<T>(selector);
  if (!found) throw new Error(`missing ${selector}`);
  return found;
};

const keydown = (target: EventTarget, key: string, init: KeyboardEventInit = {}) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  handle?.destroy();
  handle = null;
  host.remove();
});

describe('structure', () => {
  it('builds the dialog frame', () => {
    const reader = mount();
    const root = reader.element;
    expect(root.getAttribute('role')).toBe('dialog');
    expect(root.getAttribute('aria-modal')).toBe('true');
    const title = query<HTMLElement>('h1');
    expect(root.getAttribute('aria-labelledby')).toBe(title.id);
    expect(title.textContent).toBe('A quiet essay');
    expect(root.getAttribute('data-open')).toBe('0');
    expect(reader.scroller.classList.contains('bb-reader__sheet')).toBe(true);
    expect(query('.bb-reader__window').contains(reader.scroller)).toBe(true);
    expect(query('.bb-reader__sheet').contains(query('.bb-reader__bar'))).toBe(true);
    expect(query('.bb-reader__layout').contains(query('.bb-reader__doc'))).toBe(true);
    expect(query('.bb-reader__layout').contains(query('.bb-reader__cover'))).toBe(true);
  });

  it('has a visible button back to the shelf', () => {
    mount();
    const close = query<HTMLButtonElement>('.bb-reader__close');
    expect(close.textContent).toBe('Back to shelf');
    expect(close.type).toBe('button');
  });

  it('shows one saved line, byline, note and the readout, and names the host only on the button', () => {
    mount();
    expect(query('.bb-reader__saved').textContent).toBe('Saved 4 Mar 2026, 1 min');
    expect(query('.bb-reader__saved time').getAttribute('datetime')).toContain('2026-03-04');
    expect(query('.bb-reader__byline').textContent).toBe('Jo Writer');
    expect(query('.bb-reader__note').textContent).toBe('Read on the train');
    expect(query('.bb-reader__readout').getAttribute('aria-live')).toBe('off');
    expect(query('.bb-reader__readout').textContent).toBe('100% read');
    const article = query('.bb-reader__doc').textContent ?? '';
    expect(article.match(/example\.com/g)).toHaveLength(1);
    expect(query('.bb-reader__open').textContent).toContain('example.com');
    expect(host.querySelector('.bb-reader__host-label, .bb-reader__time, .bb-reader__kicker')).toBeNull();
  });

  it('puts the saved line before the title and leaves it out when there is nothing to say', () => {
    mount();
    expect(query('.bb-reader__saved').nextElementSibling).toBe(query('h1'));
    handle?.destroy();
    mount({ doc: { ...doc, addedAt: undefined, text: undefined } });
    expect(host.querySelector('.bb-reader__saved')).toBeNull();
  });

  it('keeps a copy of the title in the bar, hidden from assistive technology', () => {
    mount();
    expect(query('.bb-reader__bar-title').getAttribute('aria-hidden')).toBe('true');
    expect(query('.bb-reader__bar-text').textContent).toBe('A quiet essay');
    handle?.update({ ...doc, title: 'Another' });
    expect(query('.bb-reader__bar-text').textContent).toBe('Another');
  });

  it('links to the original safely', () => {
    mount();
    const open = query<HTMLAnchorElement>('.bb-reader__open');
    expect(open.getAttribute('href')).toBe(doc.url);
    expect(open.getAttribute('target')).toBe('_blank');
    expect(open.getAttribute('rel')).toBe('noopener noreferrer');
    expect(open.textContent).toBe('Open originalexample.com (opens in a new tab)');
    expect(open.querySelector('.bb-visually-hidden')?.textContent).toBe(' (opens in a new tab)');
  });

  it('keeps the whole name of a long site in the text of the link, where a narrow screen shortens it', () => {
    mount({ doc: { ...doc, url: 'https://a-long-subdomain.reading-room.example.org/essay' } });
    const open = query('.bb-reader__open');
    expect(query('.bb-reader__open-host').textContent).toBe('a-long-subdomain.reading-room.example.org');
    expect(open.textContent).toBe('Open originala-long-subdomain.reading-room.example.org (opens in a new tab)');
    // The name is read from the text, so nothing may stand in for it.
    expect(open.hasAttribute('aria-label')).toBe(false);
    expect(open.querySelector('[aria-hidden]')).toBeNull();
  });

  it('renders the original action disabled for a non-http url', () => {
    mount({ doc: { ...doc, url: 'javascript:alert(1)' } });
    const open = query('.bb-reader__open');
    expect(open.hasAttribute('href')).toBe(false);
    expect(open.getAttribute('aria-disabled')).toBe('true');
  });

  it('renders the reading copy with block indices', () => {
    mount();
    const body = query('.bb-reader__body');
    expect(Array.from(body.children).map((c) => c.getAttribute('data-block'))).toEqual(['0', '1', '2']);
    expect(body.querySelector('a')?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('places the cover in a slot with the given aspect ratio', () => {
    const cover = document.createElement('div');
    const reader = mount({ cover, coverAspect: 0.5 });
    const slot = query<HTMLElement>('.bb-reader__cover-slot');
    expect(slot.contains(cover)).toBe(true);
    expect(slot.style.getPropertyValue('--bb-reader-cover-aspect-given').startsWith('0.5')).toBe(true);
    expect(reader.coverSlotRect()).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('has no slot rect without a cover', () => {
    expect(mount().coverSlotRect()).toBeNull();
  });

  it('toggles visibility on the cover element only', () => {
    const cover = document.createElement('div');
    const reader = mount({ cover });
    reader.setCoverVisible(false);
    expect(cover.style.visibility).toBe('hidden');
    reader.setCoverVisible(true);
    expect(cover.style.visibility).toBe('');
  });
});

describe('flight target', () => {
  const rect = (x: number, y: number, width: number, height: number) => () =>
    ({ x, y, width, height, top: y, left: x, right: x + width, bottom: y + height, toJSON: () => ({}) }) as DOMRect;

  function laidOut(reader: ReaderHandle, slot: DOMRect | (() => DOMRect), bar = rect(0, 0, 390, 56)) {
    Object.defineProperty(reader.element, 'clientHeight', { value: 844, configurable: true });
    query('.bb-reader__cover-slot').getBoundingClientRect = typeof slot === 'function' ? slot : () => slot;
    query('.bb-reader__bar').getBoundingClientRect = bar;
    query('.bb-reader__thumb').getBoundingClientRect = rect(60, 8, 27, 40);
  }

  it('is null without a cover or a layout', () => {
    expect(mount().flightTarget()).toBeNull();
    handle?.destroy();
    expect(mount({ cover: document.createElement('div') }).flightTarget()).toBeNull();
  });

  it('is the cover place while that is on screen', () => {
    const reader = mount({ cover: document.createElement('div') });
    laidOut(reader, rect(16, 120, 80, 130));
    expect(reader.flightTarget()).toEqual({ x: 16, y: 120, width: 80, height: 130 });
    expect(query('.bb-reader__bar').hasAttribute('data-landing')).toBe(false);
  });

  it('is the bar thumbnail once the cover place has scrolled away', () => {
    const reader = mount({ cover: document.createElement('div') });
    laidOut(reader, rect(16, -900, 80, 130));
    expect(reader.flightTarget()).toEqual({ x: 60, y: 8, width: 27, height: 40 });
    expect(query('.bb-reader__bar').hasAttribute('data-landing')).toBe(true);
  });

  it('keeps the thumbnail out of assistive technology and holds its own copy of the cover', () => {
    const cover = document.createElement('div');
    cover.id = 'cover-a';
    mount({ cover });
    const thumb = query('.bb-reader__thumb');
    expect(thumb.getAttribute('aria-hidden')).toBe('true');
    expect(thumb.contains(cover)).toBe(false);
    expect(thumb.querySelector('[id]')).toBeNull();
    expect(thumb.querySelector('[inert]')).not.toBeNull();
  });

  it('hides the thumbnail copy together with the cover', () => {
    const reader = mount({ cover: document.createElement('div') });
    reader.setCoverVisible(false);
    expect(query('.bb-reader__thumb').hasAttribute('data-cover-hidden')).toBe(true);
    reader.setCoverVisible(true);
    expect(query('.bb-reader__thumb').hasAttribute('data-cover-hidden')).toBe(false);
  });
});

describe('example links', () => {
  it('says under the title that the text is an example, once', () => {
    mount({ example: true });
    const note = query('.bb-reader__example');
    expect(note.textContent).toBe('Example text written for this app. It is not the linked page.');
    expect(note.previousElementSibling).toBe(query('h1'));
    expect(host.querySelectorAll('.bb-reader__example')).toHaveLength(1);
  });

  it('says nothing for an ordinary link', () => {
    mount();
    expect(host.querySelector('.bb-reader__example')).toBeNull();
  });
});

describe('language', () => {
  it('sets the language of the text on the article only', () => {
    mount({ doc: { ...doc, lang: 'de' } });
    expect(query('.bb-reader__doc').getAttribute('lang')).toBe('de');
    expect(query('.bb-reader').hasAttribute('lang')).toBe(false);
  });

  it('inherits the page language without one, and ignores anything that is not a language tag', () => {
    mount();
    expect(query('.bb-reader__doc').hasAttribute('lang')).toBe(false);
    handle?.update({ ...doc, lang: 'not a tag <b>' });
    expect(query('.bb-reader__doc').hasAttribute('lang')).toBe(false);
    handle?.update({ ...doc, lang: 'pt-BR' });
    expect(query('.bb-reader__doc').getAttribute('lang')).toBe('pt-BR');
    handle?.update(doc);
    expect(query('.bb-reader__doc').hasAttribute('lang')).toBe(false);
  });

  it('formats the saved date in that language', () => {
    mount({ doc: { ...doc, lang: 'de' } });
    expect(query('.bb-reader__saved time').textContent).toMatch(/^4\. M\S+ 2026$/);
    handle?.update({ ...doc, lang: 'en' });
    expect(query('.bb-reader__saved time').textContent).toBe('4 Mar 2026');
  });
});

describe('focus and keys', () => {
  it('has focus inside as soon as it is mounted, before it is shown', () => {
    const reader = mount();
    expect(reader.element.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(query('.bb-reader__close'));
    expect(reader.element.getAttribute('data-open')).toBe('0');
  });

  it('closes on Escape while it is still opening', () => {
    const onClose = vi.fn();
    const reader = mount({ onClose });
    reader.setReveal(0.3);
    keydown(query('.bb-reader__body'), 'Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('lets the host route a key to it, and says whether it acted', () => {
    const onClose = vi.fn();
    const reader = mount({ onClose });
    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    expect(reader.handleKey(escape)).toBe(true);
    expect(escape.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(reader.handleKey(new KeyboardEvent('keydown', { key: 'a', cancelable: true }))).toBe(false);
  });

  it('acts once when a key reaches both the host and the dialog', () => {
    const onClose = vi.fn();
    const reader = mount({ onClose });
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    reader.handleKey(event);
    reader.element.dispatchEvent(event);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores keys after it is destroyed', () => {
    const reader = mount();
    reader.destroy();
    expect(reader.handleKey(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))).toBe(false);
  });

  it('wraps Tab through handleKey once open', () => {
    const reader = mount({ onSaveText: () => undefined });
    reader.setReveal(1);
    const stops = Array.from(reader.element.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), textarea'));
    stops[stops.length - 1]?.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
    expect(reader.handleKey(tab)).toBe(true);
    expect(document.activeElement).toBe(stops[0]);
  });

  it('keeps the cover beside the text out of the reading order', () => {
    mount({ cover: document.createElement('div') });
    const cover = query('.bb-reader__cover');
    expect(cover.getAttribute('aria-hidden')).toBe('true');
    expect(cover.tagName).toBe('DIV');
    expect(host.querySelector('aside')).toBeNull();
  });

  it('shows no ring after a pointer opens it, until a key is pressed', () => {
    document.dispatchEvent(new Event('pointerdown'));
    const reader = mount();
    expect(reader.element.hasAttribute('data-pointer')).toBe(true);
    keydown(reader.element, 'Tab');
    expect(reader.element.hasAttribute('data-pointer')).toBe(false);
  });

  it('shows the ring when a key opened it', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(mount().element.hasAttribute('data-pointer')).toBe(false);
  });
});

describe('a change made elsewhere while typing', () => {
  const empty: ReaderDoc = { ...doc, text: undefined };

  it('keeps what is typed in the field of a link with no text when text arrives', () => {
    const reader = mount({ doc: empty, onSaveText: () => undefined });
    const field = query<HTMLTextAreaElement>('.bb-reader__paste-field');
    field.focus();
    field.value = 'half pasted';
    field.setSelectionRange(4, 4);
    reader.update({ ...doc, text: 'Text saved in another tab.' });
    const kept = query<HTMLTextAreaElement>('.bb-reader__paste-field');
    expect(kept.value).toBe('half pasted');
    expect(document.activeElement).toBe(kept);
    expect(kept.selectionStart).toBe(4);
  });

  it('keeps an edit in progress when the title changes', () => {
    const reader = mount({ onSaveText: () => undefined });
    query<HTMLButtonElement>('.bb-reader__edit').click();
    query<HTMLTextAreaElement>('.bb-reader__paste-field').value = 'my edit';
    reader.update({ ...doc, title: 'Renamed' });
    expect(query('h1').textContent).toBe('Renamed');
    expect(query<HTMLTextAreaElement>('.bb-reader__paste-field').value).toBe('my edit');
  });

  it('shows the new text when nothing was typed', () => {
    const reader = mount({ doc: empty, onSaveText: () => undefined });
    reader.update({ ...doc, text: 'Arrived from elsewhere.' });
    expect(host.querySelector('.bb-reader__paste')).toBeNull();
    expect(query('.bb-reader__body p').textContent).toBe('Arrived from elsewhere.');
  });

  it('closes the edit field when the document is replaced by an identical text', () => {
    const reader = mount({ onSaveText: () => undefined });
    query<HTMLButtonElement>('.bb-reader__edit').click();
    reader.update(doc);
    expect(host.querySelector('.bb-reader__paste')).toBeNull();
  });
});

describe('keyboard and close', () => {
  it('calls onClose for Escape and for the close button', () => {
    const onClose = vi.fn();
    const reader = mount({ onClose });
    reader.setReveal(1);
    keydown(query('.bb-reader__body'), 'Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
    query<HTMLButtonElement>('.bb-reader__close').click();
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('does not remove itself on close', () => {
    const reader = mount({ onClose: () => undefined });
    query<HTMLButtonElement>('.bb-reader__close').click();
    expect(host.contains(reader.element)).toBe(true);
  });

  it('moves focus to the close button', () => {
    const reader = mount();
    reader.setReveal(1);
    reader.focus();
    expect(document.activeElement).toBe(query('.bb-reader__close'));
  });

  it('traps Tab inside the open dialog', () => {
    const reader = mount({ onSaveText: () => undefined });
    reader.setReveal(1);
    const stops = Array.from(
      reader.element.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), textarea:not([disabled])'),
    );
    const first = stops[0];
    const last = stops[stops.length - 1];
    expect(first).toBe(query('.bb-reader__close'));
    last?.focus();
    const forward = keydown(reader.element, 'Tab');
    expect(forward).toBe(false);
    expect(document.activeElement).toBe(first);
    first?.focus();
    keydown(reader.element, 'Tab', { shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('leaves Tab alone while closed', () => {
    const reader = mount();
    expect(keydown(reader.element, 'Tab')).toBe(true);
  });
});

describe('empty state and the paste panel', () => {
  const empty: ReaderDoc = { ...doc, text: undefined };

  it('shows the explanation and the panel when there is no text', () => {
    mount({ doc: empty, onSaveText: () => undefined });
    expect(query('.bb-reader__empty-title').textContent).toBe('No text saved yet');
    expect(query('.bb-reader__empty-body').textContent).toContain('Paste the part of the page you want to read');
    const label = query<HTMLLabelElement>('.bb-reader__paste label');
    const field = query<HTMLTextAreaElement>('.bb-reader__paste textarea');
    expect(label.getAttribute('for')).toBe(field.id);
    expect(label.textContent).toBe('Text to read');
    expect(query('.bb-reader__save').textContent).toBe('Save text');
    expect(host.querySelector('.bb-reader__edit')).toBeNull();
    expect(query('.bb-reader__cancel').textContent).toBe('Cancel');
    expect(query('.bb-reader__saved').textContent).toBe('Saved 4 Mar 2026');
  });

  it('hides the panel and the edit button without onSaveText', () => {
    mount({ doc: empty });
    expect(host.querySelector('.bb-reader__paste')).toBeNull();
    expect(host.querySelector('.bb-reader__edit')).toBeNull();
    expect(query('.bb-reader__empty-title')).toBeTruthy();
  });

  it('saves through onSaveText and renders the text', () => {
    const onSaveText = vi.fn();
    mount({ doc: empty, onSaveText });
    query<HTMLTextAreaElement>('.bb-reader__paste textarea').value = '## Pasted\n\nHello <b>there</b>';
    query<HTMLButtonElement>('.bb-reader__save').click();
    expect(onSaveText).toHaveBeenCalledWith('## Pasted\n\nHello <b>there</b>');
    expect(host.querySelector('.bb-reader__paste')).toBeNull();
    expect(query('.bb-reader__body h2').textContent).toBe('Pasted');
    expect(query('.bb-reader__body p').textContent).toBe('Hello <b>there</b>');
    expect(host.querySelector('.bb-reader__body b')).toBeNull();
    expect(query('.bb-reader__saved').textContent).toBe('Saved 4 Mar 2026, 1 min');
  });

  it('reopens the panel pre-filled from Edit text, which then gives way to the field, and Cancel returns to the text', () => {
    const onSaveText = vi.fn();
    mount({ onSaveText });
    expect(host.querySelector('.bb-reader__paste')).toBeNull();
    expect(query('.bb-reader__edit').textContent).toBe('Edit text');
    query<HTMLButtonElement>('.bb-reader__edit').click();
    expect(host.querySelector('.bb-reader__edit')).toBeNull();
    expect(query<HTMLTextAreaElement>('.bb-reader__paste textarea').value).toBe(doc.text);
    query<HTMLButtonElement>('.bb-reader__cancel').click();
    expect(host.querySelector('.bb-reader__paste')).toBeNull();
    expect(host.querySelector('.bb-reader__edit')).not.toBeNull();
    expect(query('.bb-reader__body h2').textContent).toBe('Heading');
    expect(onSaveText).not.toHaveBeenCalled();
  });
});

describe('reveal', () => {
  it('hides at 0 and shows at 1', () => {
    const reader = mount();
    reader.setReveal(1);
    expect(reader.element.getAttribute('data-open')).toBe('1');
    expect(reader.element.getAttribute('data-closed')).toBe('0');
    reader.setReveal(0);
    expect(reader.element.getAttribute('data-open')).toBe('0');
    expect(reader.element.getAttribute('data-closed')).toBe('1');
    expect(reader.scroller.style.opacity).toBe('0');
  });

  it('fades the sheet in the middle of the opening and never moves the window', () => {
    const reader = mount();
    const windowEl = query<HTMLElement>('.bb-reader__window');
    reader.setReveal(0.1);
    expect(reader.scroller.style.opacity).toBe('0');
    reader.setReveal(0.385);
    expect(Number(reader.scroller.style.opacity)).toBeCloseTo(0.5, 2);
    expect(windowEl.style.transform).toBe('');
    expect(reader.scroller.style.transform).toBe('');
    expect(reader.element.getAttribute('data-open')).toBe('0');
    expect(reader.element.getAttribute('data-closed')).toBe('0');
    reader.setReveal(1);
    expect(reader.scroller.style.opacity).toBe('');
  });

  it('ignores the old second argument', () => {
    const reader = mount();
    reader.setReveal(0.5, { x: 100, y: 50, width: 200, height: 300 });
    expect(query<HTMLElement>('.bb-reader__window').style.transform).toBe('');
    expect(reader.scroller.style.transform).toBe('');
  });

  it('lets the text enter after the sheet and leave again on the way back', () => {
    const reader = mount();
    reader.setReveal(0.4);
    expect(reader.element.dataset.content).toBe('0');
    reader.setReveal(0.6);
    expect(reader.element.dataset.content).toBe('1');
    expect(reader.element.dataset.enter).toBeUndefined();
    reader.setReveal(0.3);
    expect(reader.element.dataset.content).toBe('0');
  });

  it('shows the text at once when the reader opens without a transition', () => {
    const reader = mount();
    reader.setReveal(1);
    expect(reader.element.dataset.content).toBe('1');
    expect(reader.element.dataset.enter).toBe('instant');
  });

  it('gives each part of the document its place in the entrance', () => {
    mount();
    const indices = Array.from(host.querySelectorAll<HTMLElement>('.bb-reader__doc > .bb-reader__enter')).map((node) =>
      node.style.getPropertyValue('--bb-enter-index'),
    );
    expect(indices[0]).toBe('0');
    expect(indices.length).toBeGreaterThan(3);
    expect(Math.max(...indices.map(Number))).toBeLessThanOrEqual(4);
  });
});

describe('update and destroy', () => {
  it('swaps the document in place', () => {
    const reader = mount();
    const root = reader.element;
    reader.update({ ...doc, title: 'Another title', text: 'just text', author: undefined });
    expect(reader.element).toBe(root);
    expect(query('h1').textContent).toBe('Another title');
    expect(root.getAttribute('aria-labelledby')).toBe(query('h1').id);
    expect(host.querySelector('.bb-reader__byline')).toBeNull();
    expect(query('.bb-reader__body p').textContent).toBe('just text');
  });

  it('changes nothing on the page when a host answers "Mark as read" by sending the same document', () => {
    const onProgress = vi.fn();
    // Like a host that stores the mark and then, as after any change of its data, hands the document back.
    const reader: ReaderHandle = mount({ onProgress, onDone: () => reader.update({ ...doc }) });
    const title = query('h1');
    const done = query<HTMLButtonElement>('.bb-reader__done');
    reader.scroller.scrollTop = 800;
    done.focus();
    done.click();
    expect(done.getAttribute('aria-pressed')).toBe('true');
    done.click();
    expect(done.getAttribute('aria-pressed')).toBe('false');
    expect(query('.bb-reader__done')).toBe(done);
    expect(query('h1')).toBe(title);
    expect(document.activeElement).toBe(done);
    expect(reader.scroller.scrollTop).toBe(800);
    expect(onProgress).not.toHaveBeenCalled();
  });

  it('measures the page only once a changed document is drawn in full', () => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe(): void {}
        disconnect(): void {}
      },
    );
    const reader = mount();
    const bar = query<HTMLElement>('.bb-reader__bar');
    const measure = bar.getBoundingClientRect.bind(bar);
    const blocksOnThePage: number[] = [];
    bar.getBoundingClientRect = () => {
      blocksOnThePage.push(host.querySelectorAll('.bb-reader__body > [data-block]').length);
      return measure();
    };
    // A page measured while its text is out is shorter than the screen, and a browser then moves the sheet to its top.
    reader.update({ ...doc, title: 'Renamed' });
    vi.unstubAllGlobals();
    expect(query('h1').textContent).toBe('Renamed');
    expect(blocksOnThePage.length).toBeGreaterThan(0);
    expect(blocksOnThePage.every((count) => count === 3)).toBe(true);
  });

  it('removes the root and ignores later calls', () => {
    const reader = mount();
    reader.destroy();
    expect(host.contains(reader.element)).toBe(false);
    expect(() => {
      reader.destroy();
      reader.update(doc);
    }).not.toThrow();
  });
});

describe('text size', () => {
  const sizeOf = (reader: ReaderHandle): string => reader.element.style.getPropertyValue('--bb-reader-size');
  const press = (name: 'down' | 'up'): void => query<HTMLButtonElement>(`.bb-reader__size--${name}`).click();

  it('has two named buttons in a group in the bar', () => {
    mount();
    const group = query('.bb-reader__bar .bb-reader__sizes');
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toBe('Text size');
    expect(query('.bb-reader__size--down').getAttribute('aria-label')).toBe('Smaller text');
    expect(query('.bb-reader__size--up').getAttribute('aria-label')).toBe('Larger text');
  });

  it('leaves the size to the screen until a step is given', () => {
    expect(sizeOf(mount())).toBe('');
  });

  it('applies the given step and marks the ends', () => {
    const reader = mount({ textScale: 4 });
    expect(sizeOf(reader)).toBe('28px');
    expect(query('.bb-reader__size--up').hasAttribute('aria-disabled')).toBe(true);
    expect(query('.bb-reader__size--down').hasAttribute('aria-disabled')).toBe(false);
  });

  it('clamps a step outside 0 to 4', () => {
    expect(sizeOf(mount({ textScale: 12 }))).toBe('28px');
    handle?.destroy();
    expect(sizeOf(mount({ textScale: -1 }))).toBe('17px');
  });

  it('steps through the sizes and reports each change once', () => {
    const onTextScale = vi.fn();
    const reader = mount({ textScale: 1, onTextScale });
    press('up');
    expect(sizeOf(reader)).toBe('21px');
    expect(onTextScale).toHaveBeenLastCalledWith(2);
    press('down');
    press('down');
    expect(sizeOf(reader)).toBe('17px');
    expect(onTextScale).toHaveBeenCalledTimes(3);
    press('down');
    expect(onTextScale).toHaveBeenCalledTimes(3);
  });

  it('keeps the words at the top of the screen when the lines reflow', () => {
    // Every block is ten times the body size tall, so a larger size moves each block down and makes it taller.
    const size = (): number => Number.parseFloat(host.querySelector<HTMLElement>('.bb-reader')?.style.getPropertyValue('--bb-reader-size') ?? '17');
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const index = this.getAttribute('data-block');
      const height = index === null ? 0 : size() * 10;
      // Content moves up as the sheet scrolls, like a real layout.
      const scrolled = host.querySelector<HTMLElement>('.bb-reader__sheet')?.scrollTop ?? 0;
      const top = index === null ? 0 : Number(index) * height - scrolled;
      return { x: 0, y: top, width: 0, height, top, left: 0, right: 0, bottom: top + height, toJSON: () => ({}) } as DOMRect;
    });
    vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(100000);
    const reader = mount({
      doc: { ...doc, text: 'one\n\ntwo\n\nthree' },
      textScale: 0,
      progress: { block: 1, ratio: 0.5, percent: 0.4 },
    });
    expect(reader.scroller.scrollTop).toBeCloseTo(170 + 0.5 * 170, 0);
    press('up');
    // Block 1 is still half read: the same fraction of its new height sits at the reading edge.
    expect(reader.scroller.scrollTop).toBeCloseTo(190 + 0.5 * 190, 0);
    expect(reader.progress()).toMatchObject({ block: 1, ratio: 0.5 });
  });
});

describe('progress', () => {
  it('does not report at mount and offers the last position', () => {
    const onProgress = vi.fn();
    const reader = mount({ onProgress });
    expect(onProgress).not.toHaveBeenCalled();
    expect(reader.progress()).toMatchObject({ block: expect.any(Number), percent: 1 });
  });

  it('restores a saved position without reporting it as a change', () => {
    const onProgress = vi.fn();
    const reader = mount({ onProgress, progress: { block: 1, ratio: 0.5, percent: 0.4 } });
    expect(onProgress).not.toHaveBeenCalled();
    expect(typeof reader.progress().block).toBe('number');
  });

  it('stops listening after destroy', () => {
    const onProgress = vi.fn();
    const reader = mount({ onProgress });
    const scroller = reader.scroller;
    reader.destroy();
    scroller.dispatchEvent(new Event('scroll'));
    expect(onProgress).not.toHaveBeenCalled();
  });
});

describe('a reading place needs a text', () => {
  const empty: ReaderDoc = { ...doc, text: undefined };
  const start = { block: 0, ratio: 0, percent: 0 };
  let frames: (() => void)[] = [];

  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => frames.push(callback));
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    // A tall page, so that every scroll offset would count as a place somewhere in it.
    vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(5000);
  });

  afterEach(() => vi.unstubAllGlobals());

  const nextFrame = (): void => frames.splice(0).forEach((callback) => callback());
  const scrollTo = (reader: ReaderHandle, top: number): void => {
    reader.scroller.scrollTop = top;
    reader.scroller.dispatchEvent(new Event('scroll'));
    nextFrame();
  };
  const readout = (): string => query('.bb-reader__readout').textContent ?? '';

  it('keeps no place for a link with no text, however far the sheet scrolls', () => {
    const onProgress = vi.fn();
    const reader = mount({ doc: empty, onProgress, onSaveText: () => undefined });
    expect(readout()).toBe('');
    scrollTo(reader, 1200);
    expect(onProgress).not.toHaveBeenCalled();
    expect(reader.progress()).toEqual(start);
    expect(readout()).toBe('');
    expect(query<HTMLElement>('.bb-reader__line-fill').style.transform).toBe('scaleX(0)');
  });

  it('starts a text that was just saved at its top, wherever the sheet stood', () => {
    const onProgress = vi.fn();
    const reader = mount({ doc: empty, onProgress, onSaveText: () => undefined });
    scrollTo(reader, 1200);
    // One more scroll whose frame is still waiting when the text is saved.
    reader.scroller.scrollTop = 1400;
    reader.scroller.dispatchEvent(new Event('scroll'));
    query<HTMLTextAreaElement>('.bb-reader__paste-field').value = 'one\n\ntwo\n\nthree';
    query<HTMLButtonElement>('.bb-reader__save').click();
    expect(reader.scroller.scrollTop).toBe(0);
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenLastCalledWith(start);
    nextFrame();
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(reader.progress().percent).toBe(0);
    expect(readout()).toBe('0% read');
  });

  it('follows the reading again once the saved text is scrolled', () => {
    const onProgress = vi.fn();
    const reader = mount({ doc: empty, onProgress, onSaveText: () => undefined });
    query<HTMLTextAreaElement>('.bb-reader__paste-field').value = 'one\n\ntwo\n\nthree';
    query<HTMLButtonElement>('.bb-reader__save').click();
    scrollTo(reader, 2500);
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ percent: 0.5 }));
    expect(readout()).toBe('50% read');
  });

  it('puts the place back to the start when an edited text is saved', () => {
    const onProgress = vi.fn();
    const reader = mount({ onProgress, onSaveText: () => undefined });
    scrollTo(reader, 2500);
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ percent: 0.5 }));
    query<HTMLButtonElement>('.bb-reader__edit').click();
    query<HTMLButtonElement>('.bb-reader__save').click();
    expect(reader.scroller.scrollTop).toBe(0);
    expect(onProgress).toHaveBeenLastCalledWith(start);
  });

  it('reports nothing while a text is being edited and shows the place again after Cancel', () => {
    const onProgress = vi.fn();
    const reader = mount({ onProgress, onSaveText: () => undefined });
    scrollTo(reader, 1000);
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(readout()).toBe('20% read');
    query<HTMLButtonElement>('.bb-reader__edit').click();
    expect(readout()).toBe('');
    scrollTo(reader, 3000);
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(reader.progress()).toEqual(start);
    query<HTMLButtonElement>('.bb-reader__cancel').click();
    expect(readout()).toBe('60% read');
  });
});
