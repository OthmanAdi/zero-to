import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCover } from './cover-art';
import { computeStandingRow, extentOf, scaleGeometry } from './layout';
import { DEFAULT_LIGHT, faceShades } from './light';
import { mountShelf } from './shelf';
import type { ShelfHandle, ShelfIntent, ShelfItem, ShelfOptions } from './types';

function makeItems(count: number): ShelfItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `id-${index}`,
    title: `Title ${index}`,
    source: `site${index}.example`,
  }));
}

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  // A real browser measures the scene. happy-dom reports 0, so give it a size.
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1280);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500);
  // A shelf has been seen in this session already, so rows are simply there unless a test says otherwise.
  sessionStorage.setItem('bookmark-bookshelf:arrived', '1');
});

afterEach(() => {
  document.body.innerHTML = '';
});

function mount(options: Partial<ShelfOptions> = {}): { shelf: ShelfHandle; intents: ShelfIntent[] } {
  const shelf = mountShelf(host, { items: makeItems(5), variant: 'paper', ...options });
  const intents: ShelfIntent[] = [];
  shelf.on((intent) => intents.push(intent));
  return { shelf, intents };
}

/** The volumes of the row. One that is on its way out no longer counts. */
const books = (shelf: ShelfHandle): HTMLElement[] => [
  ...shelf.element.querySelectorAll<HTMLElement>('.bb-book:not(.is-leaving)'),
];
const controls = (shelf: ShelfHandle): HTMLButtonElement[] => [
  ...shelf.element.querySelectorAll<HTMLButtonElement>('.bb-book__control'),
];
const bySlot = (shelf: ShelfHandle, slot: number): HTMLElement => {
  const book = shelf.element.querySelector<HTMLElement>(`.bb-book[data-slot="${slot}"]`);
  if (!book) throw new Error(`no book in slot ${slot}`);
  return book;
};
const click = (target: Element): void => {
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
};
const press = (shelf: ShelfHandle, key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  shelf.element.querySelector('.bb-shelf__row')?.dispatchEvent(event);
  return event;
};

describe('mountShelf rendering', () => {
  it('mounts a labelled region into the host', () => {
    const { shelf } = mount({ label: 'My links' });
    expect(host.contains(shelf.element)).toBe(true);
    expect(shelf.element.getAttribute('aria-label')).toBe('My links');
    expect(shelf.element.dataset.variant).toBe('paper');
    expect(shelf.surface.classList.contains('bb-shelf__scene')).toBe(true);
  });

  it('loops a row longer than the scene, and never shows one volume twice', () => {
    const { shelf } = mount({ items: makeItems(40) });
    expect(shelf.loop).toBe(true);
    const indexes = books(shelf).map((book) => book.dataset.index);
    expect(new Set(indexes).size).toBe(indexes.length);
    expect(controls(shelf)).toHaveLength(indexes.length);
    expect(books(shelf).some((book) => Number(book.dataset.slot) < 0)).toBe(true);
  });

  it('gives a short row two ends with a bookend at each, even in a look that loops', () => {
    const { shelf } = mount();
    expect(shelf.variant.loop).toBe(true);
    expect(shelf.loop).toBe(false);
    expect(books(shelf)).toHaveLength(5);
    const ends = [...shelf.element.querySelectorAll<HTMLElement>('.bb-shelf__bookend')];
    expect(ends).toHaveLength(2);
    for (const end of ends) {
      expect(end.hidden).toBe(false);
      expect(end.getAttribute('aria-hidden')).toBe('true');
    }
    const first = Number(/translate3d\(([-\d.e]+)px/.exec(bySlot(shelf, 0).style.transform)?.[1]);
    const start = Number(/translate3d\(([-\d.e]+)px/.exec(ends[0]!.style.transform)?.[1]);
    expect(start).toBeLessThan(first);
  });

  it('stands a short row still in the middle of the scene, whichever volume is presented', () => {
    const { shelf } = mount();
    expect(shelf.fixed).toBe(true);
    expect(shelf.element.dataset.fixed).toBe('1');
    const xOf = (element: HTMLElement): number => Number(/translate3d\(([-\d.e]+)px/.exec(element.style.transform)?.[1]);
    const ends = [...shelf.element.querySelectorAll<HTMLElement>('.bb-shelf__bookend')];
    const resting = xOf(bySlot(shelf, 4));
    for (const position of [1, 2, 2.5, 3, 4]) {
      shelf.setPose({ position, open: 0 });
      expect(Math.abs(xOf(ends[0]!) + xOf(ends[1]!))).toBeLessThan(1);
    }
    // The last volume was standing at rest at the far end and stays there while the focus moves up to it.
    shelf.setPose({ position: 2, open: 0 });
    expect(Math.abs(xOf(bySlot(shelf, 4)) - resting)).toBeLessThan(shelf.pitch() / 4);
    expect(xOf(bySlot(shelf, 2))).toBeGreaterThan(xOf(bySlot(shelf, 1)));
  });

  it('rests a first volume that leans outward on the top corner of its bookend', () => {
    const { shelf } = mount();
    const xOf = (element: HTMLElement): number => Number(/translate3d\(([-\d.e]+)px/.exec(element.style.transform)?.[1]);
    const start = shelf.element.querySelector<HTMLElement>('.bb-shelf__bookend--start')!;
    const geometry = shelf.variant.geometry;
    const scale = shelf.coverSize().height / geometry.bookHeight;
    const tall = parseFloat(shelf.element.style.getPropertyValue('--bb-bookend-h'));
    expect(tall).toBeCloseTo(geometry.bookHeight * scale * 0.62, 6);
    // Paper leans left: the first volume, presented, reaches toward the bookend, further at its head than at the bookend's top.
    const pose = computeStandingRow(0, scaleGeometry(geometry, scale), 5).poses[0]!;
    const size = { spineWidth: geometry.spineWidth * scale, bookHeight: geometry.bookHeight * scale, coverWidth: geometry.coverWidth * scale };
    const atTop = extentOf(pose, size, tall)[0];
    const atHead = extentOf(pose, size)[0];
    expect(atTop).toBeGreaterThan(atHead + 5);
    const half = parseFloat(shelf.element.style.getPropertyValue('--bb-bookend-w')) / 2;
    expect(xOf(start) + half).toBeGreaterThan(atTop - 2);
    expect(xOf(start) + half).toBeLessThan(atTop);
  });

  it('stands a lamp over the presented volume of a standing row and says where', () => {
    const { shelf } = mount({ variant: 'night' });
    const front = (slot: number): number =>
      Number(bySlot(shelf, slot).querySelector<HTMLElement>('.bb-book__board--front .bb-book__shade')!.style.opacity);
    const lamp = (): number => parseFloat(shelf.element.style.getPropertyValue('--bb-lamp-x'));
    const first = front(0);
    expect(lamp()).toBeLessThan(-20);
    shelf.setPose({ position: 4, open: 0 });
    expect(lamp()).toBeGreaterThan(20);
    // Whichever volume is presented stands under the lamp, as it does in a row that travels.
    expect(front(4)).toBeCloseTo(first, 2);
    const travelling = mountShelf(document.body.appendChild(document.createElement('div')), { items: makeItems(40), variant: 'night' });
    expect(travelling.element.style.getPropertyValue('--bb-lamp-x')).toBe('');
    expect(Number(travelling.element.querySelector<HTMLElement>('.bb-book.is-centre .bb-book__board--front .bb-book__shade')!.style.opacity)).toBeCloseTo(first, 2);
  });

  it('presents the end volume of a standing row for a position past that end', () => {
    const { shelf } = mount();
    shelf.setPose({ position: 9.7, open: 0 });
    expect(shelf.element.dataset.focus).toBe('4');
    expect(bySlot(shelf, 4).classList.contains('is-turned')).toBe(true);
    shelf.setPose({ position: -3, open: 0 });
    expect(shelf.element.dataset.focus).toBe('0');
    expect(bySlot(shelf, 0).classList.contains('is-turned')).toBe(true);
  });

  it('starts looping when the row grows past the scene, tells the host, and hides the bookends', () => {
    const changes: boolean[] = [];
    const { shelf } = mount({ onLoopChange: (loop) => changes.push(loop) });
    expect(changes).toEqual([]);
    shelf.setItems(makeItems(40));
    expect(changes).toEqual([true]);
    expect(shelf.loop).toBe(true);
    expect(shelf.fixed).toBe(false);
    expect(shelf.element.dataset.fixed).toBe('0');
    for (const end of shelf.element.querySelectorAll<HTMLElement>('.bb-shelf__bookend')) expect(end.hidden).toBe(true);
    shelf.setItems(makeItems(3));
    expect(changes).toEqual([true, false]);
    expect(shelf.fixed).toBe(true);
  });

  it('lets a host that asks for no loop keep a long row with two ends that travels', () => {
    const { shelf } = mount({ items: makeItems(40), loop: false });
    expect(shelf.loop).toBe(false);
    expect(shelf.fixed).toBe(false);
    shelf.setPose({ position: 39, open: 0 });
    expect(shelf.element.dataset.focus).toBe('39');
    expect(shelf.element.querySelector<HTMLElement>('.bb-shelf__bookend--end')?.hidden).toBe(false);
    expect(shelf.element.querySelector<HTMLElement>('.bb-shelf__bookend--start')?.hidden).toBe(true);
  });

  it('keeps keyboard focus in the row when it starts looping', () => {
    const { shelf } = mount();
    controls(shelf).find((control) => control.tabIndex === 0)?.focus();
    shelf.setItems(makeItems(40));
    expect(document.activeElement?.classList.contains('bb-book__control')).toBe(true);
  });

  it('keeps one control for every link in shelf order where the row goes round on a narrow screen', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(412);
    const { shelf } = mount({ items: makeItems(15) });
    expect(shelf.loop).toBe(true);
    const labels = (): string[] => controls(shelf).map((control) => control.getAttribute('aria-label') ?? '');
    for (const position of [0, 1, 5, 14, 15, -4]) {
      shelf.setPose({ position, open: 0 });
      expect(controls(shelf)).toHaveLength(15);
      expect(labels().map((label) => Number(/Volume (\d+) of 15/.exec(label)?.[1]))).toEqual(Array.from({ length: 15 }, (_, index) => index + 1));
      expect(controls(shelf).filter((control) => control.tabIndex === 0)).toHaveLength(1);
    }
    // The ones out of view are there for their controls and are not drawn.
    const away = books(shelf).filter((book) => book.classList.contains('is-away'));
    expect(away.length).toBeGreaterThan(0);
    for (const book of away) expect(book.querySelector('.bb-book__control')).not.toBeNull();
    expect(books(shelf).filter((book) => !book.classList.contains('is-away')).length).toBeGreaterThan(4);
  });

  it('keeps a control for every link of a long shelf, and takes a volume round instead of building it again', () => {
    const { shelf } = mount({ items: makeItems(120) });
    expect(controls(shelf)).toHaveLength(120);
    const far = shelf.element.querySelector<HTMLElement>('.bb-book[data-id="id-60"]')!;
    expect(far.classList.contains('is-away')).toBe(true);
    shelf.setPose({ position: 1, open: 0 });
    shelf.setPose({ position: 2, open: 0 });
    expect(shelf.element.querySelector('.bb-book[data-id="id-60"]')).toBe(far);
    expect(controls(shelf)).toHaveLength(120);
    shelf.setPose({ position: 60, open: 0 });
    expect(far.classList.contains('is-away')).toBe(false);
    expect(far.classList.contains('is-centre')).toBe(true);
  });

  it('stands a shelf of four or five on a narrow screen instead of showing a volume at both edges', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(412);
    for (const count of [4, 5]) {
      // Slim volumes, as links with little or no text are.
      const { shelf } = mount({ items: makeItems(count).map((item) => ({ ...item, thickness: 0.1, stature: 1 })) });
      expect(shelf.loop).toBe(false);
      expect(shelf.fixed).toBe(true);
      expect(books(shelf)).toHaveLength(count);
      // Whichever volume is presented stands inside the scene.
      for (let position = 0; position < count; position++) {
        shelf.setPose({ position, open: 0 });
        const x = Number(/translate3d\(([-\d.e]+)px/.exec(bySlot(shelf, position).style.transform)?.[1]);
        expect(x).toBeGreaterThan(-206);
        expect(x + shelf.coverSize().width).toBeLessThan(206);
      }
    }
  });

  it('marks repeated copies aria-hidden and the real ones not', () => {
    const { shelf } = mount();
    const hidden = books(shelf).filter((book) => book.getAttribute('aria-hidden') === 'true');
    const real = books(shelf).filter((book) => book.getAttribute('aria-hidden') === null);
    expect(real).toHaveLength(5);
    expect(hidden.length).toBe(books(shelf).length - 5);
    for (const book of hidden) expect(book.querySelector('.bb-book__control')).toBeNull();
    for (const book of real) expect(book.querySelector('.bb-book__control')).not.toBeNull();
  });

  it('gives exactly one control tabIndex 0, the centred one', () => {
    const { shelf } = mount();
    const stops = controls(shelf).filter((control) => control.tabIndex === 0);
    expect(stops).toHaveLength(1);
    const book = stops[0]?.closest<HTMLElement>('.bb-book');
    expect(book?.dataset.slot).toBe('0');
    expect(book?.classList.contains('is-centre')).toBe(true);
  });

  it('tells how to use the row with every volume', () => {
    const { shelf } = mount();
    const hint = shelf.element.querySelector<HTMLElement>('.bb-shelf__hint');
    expect(hint?.textContent).toBe('Arrow keys move along the shelf, Enter opens.');
    expect(hint?.id).toMatch(/^bb-shelf-hint-\d+$/);
    for (const control of controls(shelf)) expect(control.getAttribute('aria-describedby')).toBe(hint?.id);
    const other = mountShelf(document.body.appendChild(document.createElement('div')), { items: makeItems(2) });
    expect(other.element.querySelector('.bb-shelf__hint')?.id).not.toBe(hint?.id);
  });

  it('gives each volume a focus ring on its spine and on its cover', () => {
    const { shelf } = mount();
    const centre = bySlot(shelf, 0);
    expect(centre.querySelector('.bb-book__body > .bb-book__ring--spine')).not.toBeNull();
    expect(centre.querySelector('.bb-book__body > .bb-book__ring--cover')).not.toBeNull();
  });

  it('labels each control with the title and its place in the row', () => {
    const { shelf } = mount();
    for (const control of controls(shelf)) {
      const index = Number(control.closest<HTMLElement>('.bb-book')?.dataset.index);
      const label = control.getAttribute('aria-label') ?? '';
      expect(label).toContain(`Title ${index}`);
      expect(label).toContain(`Volume ${index + 1} of 5`);
    }
  });

  it('dresses the spines of one site alike and marks each with the site initial', () => {
    const items = makeItems(9).map((item, index) => ({ ...item, source: index % 3 === 0 ? 'docs.example.org' : item.source }));
    const { shelf } = mount({ items });
    const spine = (slot: number): HTMLElement => bySlot(shelf, slot).querySelector<HTMLElement>('.bb-book__spine')!;
    expect(spine(0).dataset.treatment).toBe(spine(3).dataset.treatment);
    expect(spine(3).dataset.treatment).toBe(spine(6).dataset.treatment);
    const device = (slot: number) => bySlot(shelf, slot).querySelector<HTMLElement>('.bb-spine__device')!;
    expect(device(0).dataset.shape).toBe(device(3).dataset.shape);
    expect(device(0).textContent).toBe('E');
    expect(shelf.element.querySelector('.bb-spine__sigil')).toBeNull();
  });

  it('pastes a label holding the title on spines dressed with one', () => {
    const items = Array.from({ length: 30 }, (_, index) => ({ id: `id-${index}`, title: `Title ${index}`, source: `site${index}.example` }));
    const { shelf } = mount({ items });
    const labelled = [...shelf.element.querySelectorAll<HTMLElement>('.bb-book__spine[data-treatment="label"]')];
    expect(labelled.length).toBeGreaterThan(0);
    for (const spine of labelled) {
      expect(spine.querySelector('.bb-spine__title > .bb-spine__label')?.textContent).toMatch(/^Title \d+$/);
    }
  });

  it('stands a reading slip in a volume in progress, placed by how far the reading got', () => {
    const items = makeItems(4).map((item, index) => ({ ...item, progress: [0, 0.34, 1, 0.5][index], done: index === 3 }));
    const { shelf } = mount({ items, variant: 'oak' });
    const slip = (slot: number) => bySlot(shelf, slot).querySelector<HTMLElement>('.bb-book__slip');
    expect(slip(0)).toBeNull();
    expect(slip(1)?.style.getPropertyValue('--bb-slip')).toBe('0.340');
    expect(slip(2)?.style.getPropertyValue('--bb-slip')).toBe('1.000');
    // A volume marked as read shows its check instead, and says so to a screen reader.
    expect(slip(3)).toBeNull();
    expect(bySlot(shelf, 3).classList.contains('is-done')).toBe(true);
    expect(bySlot(shelf, 3).querySelector('.bb-book__control')?.getAttribute('aria-label')).toContain('Marked as read');
    expect(shelf.element.querySelector('.bb-book__ribbon')).toBeNull();
  });

  it('leaves the number off the head of spines unless the look asks for it', () => {
    const { shelf } = mount();
    expect(shelf.element.dataset.mark).toBe('0');
  });

  it('gives every volume a front and a back board', () => {
    const { shelf } = mount({ items: makeItems(40) });
    for (const book of books(shelf)) {
      expect(book.querySelector('.bb-book__board--front')).not.toBeNull();
      expect(book.querySelector('.bb-book__board--back')).not.toBeNull();
    }
  });

  it('puts no sticker on the presented cover', () => {
    const { shelf } = mount();
    expect(shelf.element.querySelector('.bb-book__seal')).toBeNull();
    expect(shelf.element.textContent).not.toContain('Open');
  });

  it('prints covers for the volumes near the centre only', () => {
    const { shelf } = mount({ items: makeItems(40) });
    expect(bySlot(shelf, 0).querySelector('.bb-book__cover .bb-cover')).not.toBeNull();
    expect(bySlot(shelf, 1).querySelector('.bb-book__cover .bb-cover')).not.toBeNull();
    expect(bySlot(shelf, 2).querySelector('.bb-cover')).toBeNull();
    expect(bySlot(shelf, -3).querySelector('.bb-cover')).toBeNull();
  });

  it('composes the printed cover for the proportion of the look', () => {
    const { shelf } = mount({ variant: 'oak' });
    const { coverWidth, bookHeight } = shelf.variant.geometry;
    const item = makeItems(1)[0]!;
    const printed = bySlot(shelf, 0).querySelector('.bb-book__cover .bb-cover svg')?.getAttribute('viewBox');
    expect(printed).toBe(createCover(item, '01', { aspect: coverWidth / bookHeight }).querySelector('svg')?.getAttribute('viewBox'));
    expect(printed).not.toBe(createCover(item, '01').querySelector('svg')?.getAttribute('viewBox'));
  });

  it('keeps a print until the volume is well past the centre, then drops it', () => {
    const { shelf } = mount({ items: makeItems(40) });
    shelf.setPose({ position: 2, open: 0 });
    expect(bySlot(shelf, 0).querySelector('.bb-cover')).not.toBeNull();
    shelf.setPose({ position: 2.6, open: 0 });
    expect(bySlot(shelf, 0).querySelector('.bb-cover')).toBeNull();
  });

  it('shades faces from one light and rewrites a shade only when it changes', () => {
    const { shelf } = mount({ items: makeItems(40) });
    const film = (slot: number, face: string): HTMLElement =>
      bySlot(shelf, slot).querySelector<HTMLElement>(`${face} .bb-book__shade`)!;
    const turned = faceShades(DEFAULT_LIGHT, shelf.variant.geometry.focusAngle);
    expect(Number(film(0, '.bb-book__board--front').style.opacity)).toBeCloseTo(turned.front, 2);
    expect(Number(film(0, '.bb-book__spine').style.opacity)).toBeCloseTo(turned.spine, 2);
    expect(Number(film(4, '.bb-book__board--front').style.opacity)).toBeCloseTo(0.56, 2);
    expect(Number(film(4, '.bb-book__spine').style.opacity)).toBeCloseTo(0, 2);
    film(4, '.bb-book__spine').style.opacity = '0.5';
    shelf.setPose({ position: 0.1, open: 0 });
    expect(film(4, '.bb-book__spine').style.opacity).toBe('0.5');
    expect(shelf.element.style.getPropertyValue('--bb-light-tint')).toBe('#000');
  });

  it('writes the turn on turning volumes and clears it once they rest', () => {
    const { shelf } = mount({ items: makeItems(40) });
    const turn = Math.sin((shelf.variant.geometry.focusAngle * Math.PI) / 180);
    expect(Number(bySlot(shelf, 0).style.getPropertyValue('--bb-turn'))).toBeCloseTo(turn, 9);
    expect(bySlot(shelf, 3).style.getPropertyValue('--bb-turn')).toBe('');
    shelf.setPose({ position: 1, open: 0 });
    expect(bySlot(shelf, 0).style.getPropertyValue('--bb-turn')).toBe('0');
  });

  it('shows the caption of the centred item', () => {
    const { shelf } = mount();
    expect(shelf.element.querySelector('.bb-shelf__title')?.textContent).toBe('Title 0');
    expect(shelf.element.querySelector('.bb-shelf__meta')?.textContent).toBe('site0.example');
    expect(shelf.element.querySelector('.bb-shelf__meta')?.classList.contains('is-note')).toBe(false);
  });

  it('shows the note in the caption when there is one, and no counter', () => {
    const items = makeItems(5).map((item, index) => (index === 1 ? { ...item, note: 'For the essay on archives.' } : item));
    const { shelf } = mount({ items });
    shelf.setPose({ position: 1, open: 0, reduced: true });
    const meta = shelf.element.querySelector('.bb-shelf__meta');
    expect(meta?.textContent).toBe('For the essay on archives.');
    expect(meta?.classList.contains('is-note')).toBe(true);
    expect(shelf.element.querySelector('.bb-shelf__caption')?.textContent).not.toMatch(/\d+ \/ \d+/);
  });

  it('fades the old caption out before the new one comes in, landing on the latest', () => {
    const fades: Array<{ onfinish: (() => void) | null; cancel: () => void }> = [];
    const spy = vi.spyOn(HTMLElement.prototype, 'animate').mockImplementation(() => {
      const fade = { onfinish: null as (() => void) | null, cancel: vi.fn() };
      fades.push(fade);
      return fade as unknown as Animation;
    });
    const { shelf } = mount();
    const title = (): string | null | undefined => shelf.element.querySelector('.bb-shelf__title')?.textContent;
    shelf.setPose({ position: 1, open: 0 });
    shelf.setPose({ position: 2, open: 0 });
    expect(title()).toBe('Title 0');
    expect(shelf.element.dataset.focusId).toBe('id-2');
    expect(fades).toHaveLength(1);
    fades[0]?.onfinish?.();
    expect(title()).toBe('Title 2');
    expect(fades).toHaveLength(2);
    spy.mockRestore();
  });

  it('places the presented cover with its size, lean and turn', () => {
    const { shelf } = mount();
    const placement = shelf.coverPlacement();
    const size = shelf.coverSize();
    expect(placement).not.toBeNull();
    expect(placement?.width).toBe(size.width);
    expect(placement?.height).toBe(size.height);
    expect(placement?.lean).toBe(shelf.variant.geometry.focusLean);
    expect(placement?.yaw).toBeCloseTo(90 - shelf.variant.geometry.focusAngle, 9);
    expect(placement?.scale).toBeGreaterThanOrEqual(1);
    // Half way to the next volume the cover is still turned part of the way.
    shelf.setPose({ position: 0.3, open: 0 });
    const moving = shelf.coverPlacement();
    expect(moving?.yaw).toBeGreaterThan(0);
    expect(Math.abs(moving?.lean ?? 0)).toBeLessThan(Math.abs(shelf.variant.geometry.focusLean));
  });

  it('has no cover placement on an empty shelf', () => {
    const { shelf } = mount({ items: [] });
    expect(shelf.coverPlacement()).toBeNull();
  });

  it('sizes each volume from its thickness and stature', () => {
    const items = makeItems(6).map((item, index) => ({ ...item, thickness: index / 5, stature: index % 2 }));
    const { shelf } = mount({ items });
    const width = (slot: number): number => parseFloat(bySlot(shelf, slot).style.getPropertyValue('--bb-spine-w'));
    const height = (slot: number): number => parseFloat(bySlot(shelf, slot).style.getPropertyValue('--bb-book-h'));
    expect(width(5)).toBeGreaterThan(width(1));
    expect(height(1)).toBeGreaterThan(height(2));
    const placement = shelf.coverPlacement();
    expect(placement?.height).toBeCloseTo(height(0), 6);
    expect(shelf.pitchAt(0.5)).toBeGreaterThan(0);
    expect(shelf.pitch()).not.toBeCloseTo(shelf.pitchAt(0.5), 3);
  });

  it('keeps spines wide enough to read on a small scene by making the volumes shorter, not narrower', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(360);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(250);
    const { shelf } = mount({ items: makeItems(12) });
    const spine = (): number => parseFloat(shelf.element.style.getPropertyValue('--bb-spine-w'));
    const height = (): number => parseFloat(shelf.element.style.getPropertyValue('--bb-book-h'));
    expect(height()).toBeLessThan(200);
    expect(spine()).toBe(44);
    // A title that would not fit on one line at a readable size is set on two.
    const long = mountShelf(document.body.appendChild(document.createElement('div')), {
      items: [{ id: 'long', title: 'A Short History of the Footnote in Print' }, ...makeItems(11)],
    });
    const title = long.element.querySelector<HTMLElement>('.bb-book[data-id="long"] .bb-spine__title');
    expect(parseFloat(title?.style.fontSize ?? '0')).toBeGreaterThanOrEqual(10);
    // A look whose spines are thinner than that at full size keeps its own width.
    shelf.setVariant('pocket');
    expect(spine()).toBe(36);
  });

  it('leaves volumes of a shelf without sizes at the look size', () => {
    const { shelf } = mount();
    expect(bySlot(shelf, 1).style.getPropertyValue('--bb-spine-w')).toBe('');
    expect(shelf.pitchAt(1.5)).toBeCloseTo(shelf.pitch(), 9);
  });

  it('pitch is positive', () => {
    expect(mount().shelf.pitch()).toBeGreaterThan(0);
  });
});

describe('mountShelf pose', () => {
  it('setPose updates data-focus and data-focus-id', () => {
    const { shelf } = mount();
    shelf.setPose({ position: 2, open: 0 });
    expect(shelf.element.dataset.focus).toBe('2');
    expect(shelf.element.dataset.focusId).toBe('id-2');
    expect(controls(shelf).filter((control) => control.tabIndex === 0)).toHaveLength(1);
    expect(bySlot(shelf, 2).querySelector('.bb-book__control')?.getAttribute('tabindex')).toBe('0');
  });

  it('wraps a looping position past the end', () => {
    const { shelf } = mount({ items: makeItems(40) });
    shelf.setPose({ position: 47, open: 0 });
    expect(shelf.element.dataset.focus).toBe('7');
    shelf.setPose({ position: -1, open: 0 });
    expect(shelf.element.dataset.focus).toBe('39');
    expect(controls(shelf).filter((control) => control.tabIndex === 0)).toHaveLength(1);
  });

  it('reports data-open as 0, moving and 1', () => {
    const { shelf } = mount();
    expect(shelf.element.dataset.open).toBe('0');
    shelf.setPose({ position: 0, open: 0.5 });
    expect(shelf.element.dataset.open).toBe('moving');
    shelf.setPose({ position: 0, open: 1 });
    expect(shelf.element.dataset.open).toBe('1');
    shelf.setPose({ position: 0, open: 0 });
    expect(shelf.element.dataset.open).toBe('0');
  });

  it('leaves the opening volume in place but hidden, and parts its near neighbours', () => {
    const { shelf } = mount({ items: makeItems(40) });
    const xOf = (slot: number): number => Number(/translate3d\(([-\d.e]+)px/.exec(bySlot(shelf, slot).style.transform)?.[1]);
    const before = [-5, -4, -1, 0, 1, 4, 5].map(xOf);
    shelf.setPose({ position: 0, open: 1 });
    const after = [-5, -4, -1, 0, 1, 4, 5].map(xOf);
    expect(bySlot(shelf, 0).style.visibility).toBe('hidden');
    expect(after[3]).toBeCloseTo(before[3]!, 6);
    // Nearest neighbours move furthest, outward, and slots beyond four stay put.
    expect(before[2]! - after[2]!).toBeCloseTo(28 * (4 / 5) * (shelf.pitch() / 68), 6);
    expect(after[4]! - before[4]!).toBeCloseTo(before[2]! - after[2]!, 6);
    expect(after[5]! - before[5]!).toBeCloseTo(28 * (1 / 5) * (shelf.pitch() / 68), 6);
    expect(after[1]! - before[1]!).toBeLessThan(0);
    expect(after[0]).toBeCloseTo(before[0]!, 6);
    expect(after[6]).toBeCloseTo(before[6]!, 6);
    for (const slot of [-1, 1, 4]) expect(bySlot(shelf, slot).style.visibility).toBe('');
  });

  it('shows the volume again and closes the gap once it is back', () => {
    const { shelf } = mount();
    const resting = bySlot(shelf, 1).style.transform;
    shelf.setPose({ position: 0, open: 0.5 });
    expect(bySlot(shelf, 1).style.transform).not.toBe(resting);
    shelf.setPose({ position: 0, open: 0 });
    expect(bySlot(shelf, 0).style.visibility).toBe('');
    expect(bySlot(shelf, 1).style.transform).toBe(resting);
  });

  it('moves nothing and hides nothing while opening under reduced motion', () => {
    const { shelf } = mount();
    const resting = books(shelf).map((book) => book.style.transform);
    shelf.setPose({ position: 0, open: 0.6, reduced: true });
    expect(books(shelf).map((book) => book.style.transform)).toEqual(resting);
    expect(books(shelf).every((book) => book.style.visibility === '')).toBe(true);
    expect(shelf.surface.style.opacity).toBe('');
  });

  it('writes nothing at all for a frame that changes nothing', () => {
    const { shelf } = mount({ items: makeItems(40) });
    shelf.setPose({ position: 3, open: 0 });
    const watch = new MutationObserver(() => undefined);
    watch.observe(shelf.element, { attributes: true, childList: true, characterData: true, subtree: true });
    shelf.setPose({ position: 3, open: 0 });
    shelf.setPose({ position: 3, open: 0 });
    expect(watch.takeRecords()).toEqual([]);
    watch.disconnect();
  });

  it('writes only to the volumes that make room while one opens', () => {
    const { shelf } = mount({ items: makeItems(40) });
    shelf.setPose({ position: 0, open: 0.4 });
    const watch = new MutationObserver(() => undefined);
    watch.observe(shelf.element, { attributes: true, childList: true, characterData: true, subtree: true });
    shelf.setPose({ position: 0, open: 0.5 });
    const touched = new Set(watch.takeRecords().map((record) => (record.target as Element).closest?.('.bb-book')));
    watch.disconnect();
    // Four volumes each side step aside a little further; the rest of the row is left alone.
    expect(touched.has(bySlot(shelf, 1))).toBe(true);
    expect(touched.has(bySlot(shelf, -4))).toBe(true);
    expect(touched.has(bySlot(shelf, 0))).toBe(false);
    expect(touched.has(bySlot(shelf, 5))).toBe(false);
    expect(touched.has(bySlot(shelf, -7))).toBe(false);
    expect(touched.size).toBe(8);
  });

  it('turns the centred volume and leaves the others', () => {
    const { shelf } = mount();
    shelf.setPose({ position: 1, open: 0 });
    expect(bySlot(shelf, 1).classList.contains('is-turned')).toBe(true);
    expect(bySlot(shelf, 0).classList.contains('is-turned')).toBe(false);
  });

  it('moves focus to the new centre when focus was inside the row', () => {
    const { shelf } = mount();
    controls(shelf).find((control) => control.tabIndex === 0)?.focus();
    shelf.setPose({ position: 1, open: 0 });
    expect(document.activeElement).toBe(bySlot(shelf, 1).querySelector('.bb-book__control'));
  });

  it('focusCurrent focuses the centred control', () => {
    const { shelf } = mount();
    shelf.setPose({ position: 3, open: 0 });
    shelf.focusCurrent();
    expect(document.activeElement).toBe(bySlot(shelf, 3).querySelector('.bb-book__control'));
  });
});

describe('mountShelf intents', () => {
  it('emits open when the centred book is clicked', () => {
    const { shelf, intents } = mount();
    click(bySlot(shelf, 0).querySelector('.bb-book__body')!);
    expect(intents).toEqual([{ type: 'open', id: 'id-0', index: 0 }]);
  });

  it('emits focus with the slot when another book is clicked', () => {
    const { shelf, intents } = mount();
    click(bySlot(shelf, 1).querySelector('.bb-book__body')!);
    expect(intents).toEqual([{ type: 'focus', id: 'id-1', index: 1, slot: 1 }]);
  });

  it('emits focus with the unwrapped slot for a volume across the seam of a looping row', () => {
    const { shelf, intents } = mount({ items: makeItems(40) });
    click(bySlot(shelf, -2).querySelector('.bb-book__body')!);
    expect(intents).toEqual([{ type: 'focus', id: 'id-38', index: 38, slot: -2 }]);
  });

  it('emits focus instead of open while the centre is still travelling', () => {
    const { shelf, intents } = mount();
    shelf.setPose({ position: 0.4, open: 0 });
    click(bySlot(shelf, 0).querySelector('.bb-book__body')!);
    expect(intents[0]?.type).toBe('focus');
  });

  it('emits nothing while a book is open', () => {
    const { shelf, intents } = mount();
    shelf.setPose({ position: 0, open: 1 });
    click(bySlot(shelf, 0).querySelector('.bb-book__body')!);
    press(shelf, 'ArrowRight');
    expect(intents).toEqual([]);
  });

  it.each([
    ['ArrowRight', { type: 'step', direction: 1 }],
    ['ArrowLeft', { type: 'step', direction: -1 }],
    ['Home', { type: 'jump', to: 'first' }],
    ['End', { type: 'jump', to: 'last' }],
  ] satisfies Array<[string, ShelfIntent]>)('maps %s to an intent and prevents the default', (key, expected) => {
    const { shelf, intents } = mount();
    const event = press(shelf, key);
    expect(event.defaultPrevented).toBe(true);
    expect(intents).toEqual([expected]);
  });

  it('ignores other keys and modified arrows', () => {
    const { shelf, intents } = mount();
    expect(press(shelf, 'a').defaultPrevented).toBe(false);
    expect(press(shelf, 'ArrowRight', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(press(shelf, 'ArrowLeft', { altKey: true }).defaultPrevented).toBe(false);
    expect(intents).toEqual([]);
  });

  it('emits step from the arrow buttons', () => {
    const { shelf, intents } = mount({ items: makeItems(40) });
    click(shelf.element.querySelector('.bb-shelf__arrow--next')!);
    click(shelf.element.querySelector('.bb-shelf__arrow--prev')!);
    expect(intents).toEqual([
      { type: 'step', direction: 1 },
      { type: 'step', direction: -1 },
    ]);
  });

  it('spends the arrow that points past an end of the row, and leaves it where the keyboard can find it', () => {
    const { shelf, intents } = mount();
    const previous = shelf.element.querySelector<HTMLButtonElement>('.bb-shelf__arrow--prev')!;
    const next = shelf.element.querySelector<HTMLButtonElement>('.bb-shelf__arrow--next')!;
    expect(previous.getAttribute('aria-disabled')).toBe('true');
    expect(next.hasAttribute('aria-disabled')).toBe(false);
    expect(previous.disabled).toBe(false);
    click(previous);
    expect(intents).toEqual([]);
    shelf.setPose({ position: 2, open: 0 });
    expect(previous.hasAttribute('aria-disabled')).toBe(false);
    expect(next.hasAttribute('aria-disabled')).toBe(false);
    shelf.setPose({ position: 4, open: 0 });
    expect(next.getAttribute('aria-disabled')).toBe('true');
    click(next);
    expect(intents).toEqual([]);
    // One volume alone: there is nowhere to go either way.
    shelf.setItems(makeItems(1));
    expect(previous.getAttribute('aria-disabled')).toBe('true');
    expect(next.getAttribute('aria-disabled')).toBe('true');
  });

  it('never spends an arrow of a row that goes round', () => {
    const { shelf } = mount({ items: makeItems(40) });
    for (const position of [0, 39, -1]) {
      shelf.setPose({ position, open: 0 });
      expect(shelf.element.querySelector('.bb-shelf__arrow[aria-disabled]')).toBeNull();
    }
  });

  it('says where the row came to rest after one of its own arrows moved it, and not otherwise', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { shelf } = mount();
    const status = shelf.element.querySelector<HTMLElement>('.bb-shelf__status')!;
    expect(status.getAttribute('aria-live')).toBe('polite');
    shelf.setPose({ position: 1, open: 0 });
    vi.advanceTimersByTime(1000);
    expect(status.textContent).toBe('');
    click(shelf.element.querySelector('.bb-shelf__arrow--next')!);
    shelf.setPose({ position: 2, open: 0 });
    vi.advanceTimersByTime(200);
    // Pressed again before the row came to rest: only the volume it stops on is said.
    click(shelf.element.querySelector('.bb-shelf__arrow--next')!);
    shelf.setPose({ position: 3, open: 0 });
    vi.advanceTimersByTime(300);
    expect(status.textContent).toBe('');
    vi.advanceTimersByTime(100);
    expect(status.textContent).toBe('Title 3, 4 of 5');
    vi.useRealTimers();
  });

  it('hides the arrows and caption when asked', () => {
    const { shelf } = mount({ arrows: false, caption: false });
    expect(shelf.element.querySelector<HTMLElement>('.bb-shelf__nav')?.hidden).toBe(true);
    expect(shelf.element.querySelector<HTMLElement>('.bb-shelf__caption')?.hidden).toBe(true);
  });

  it('on() returns a working unsubscribe', () => {
    const { shelf } = mount();
    const listener = vi.fn();
    const off = shelf.on(listener);
    press(shelf, 'ArrowRight');
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    press(shelf, 'ArrowRight');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('mountShelf changing the items', () => {
  const byId = (shelf: ShelfHandle): Map<string, HTMLElement> =>
    new Map(books(shelf).map((book) => [book.dataset.id ?? '', book]));

  it('keeps the volume of every item that stays, and its printed cover', () => {
    // Each item carries its own mark, as a host with a catalogue gives it, so moving it changes nothing printed.
    const items = makeItems(5).map((item, index) => ({ ...item, mark: String(index + 10) }));
    const { shelf } = mount({ items });
    const before = byId(shelf);
    const print = bySlot(shelf, 0).querySelector('.bb-cover');
    // One leaves, one arrives and the rest change places.
    shelf.setItems([items[3]!, items[0]!, { id: 'new', title: 'New' }, items[4]!, items[2]!]);
    const after = byId(shelf);
    for (const id of ['id-0', 'id-2', 'id-3', 'id-4']) expect(after.get(id)).toBe(before.get(id));
    expect(after.has('id-1')).toBe(false);
    expect(after.get('new')).toBeDefined();
    expect(after.get('id-0')?.querySelector('.bb-cover')).toBe(print);
    expect(after.get('id-3')?.dataset.slot).toBe('0');
    expect(after.get('id-3')?.dataset.index).toBe('0');
  });

  it('goes on presenting the volume that was presented, wherever it now stands', () => {
    const { shelf } = mount();
    const items = makeItems(5);
    shelf.setPose({ position: 2, open: 0 });
    shelf.setItems([items[4]!, items[3]!, items[1]!, items[0]!, items[2]!]);
    expect(shelf.element.dataset.focusId).toBe('id-2');
    expect(shelf.element.dataset.focus).toBe('4');
    expect(shelf.element.querySelector('.bb-book.is-centre')?.getAttribute('data-id')).toBe('id-2');
  });

  it('presents the volume that takes the place of one that left', () => {
    const { shelf } = mount();
    const items = makeItems(5);
    shelf.setPose({ position: 2, open: 0 });
    shelf.setItems(items.filter((item) => item.id !== 'id-2'));
    expect(shelf.element.dataset.focusId).toBe('id-3');
    shelf.setPose({ position: 3, open: 0 });
    shelf.setItems(items.filter((item) => item.id !== 'id-2' && item.id !== 'id-4'));
    expect(shelf.element.dataset.focusId).toBe('id-3');
  });

  it('keeps the volumes in the order of the shelf in the document', () => {
    const { shelf } = mount();
    const items = makeItems(5);
    const order = [items[4]!, items[2]!, items[0]!, items[3]!, items[1]!];
    shelf.setItems(order);
    expect(books(shelf).map((book) => book.dataset.id)).toEqual(order.map((item) => item.id));
  });

  it('keeps the real volumes of a looping row in shelf order while it travels', () => {
    const { shelf } = mount({ items: makeItems(40) });
    const realOrder = (): number[] =>
      books(shelf)
        .filter((book) => book.getAttribute('aria-hidden') === null)
        .map((book) => Number(book.dataset.index));
    for (const position of [0, 1, 2, 3, 17, 39, 40, -3]) {
      shelf.setPose({ position, open: 0 });
      const order = realOrder();
      expect(order).toEqual([...order].sort((one, other) => one - other));
      expect(new Set(order).size).toBe(order.length);
    }
  });

  it('moves only the volumes that changed places in the document when a looping row takes a step', () => {
    const { shelf } = mount({ items: makeItems(40) });
    const row = shelf.element.querySelector('.bb-shelf__row')!;
    const moves = vi.spyOn(row, 'insertBefore');
    shelf.setPose({ position: 1, open: 0 });
    shelf.setPose({ position: 2, open: 0 });
    shelf.setPose({ position: 3, open: 0 });
    // One volume comes into view at the far end with each step; nothing else is touched.
    expect(moves.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('leaves keyboard focus on the same control when its volume stays', () => {
    const { shelf } = mount();
    const items = makeItems(5);
    shelf.setPose({ position: 1, open: 0 });
    shelf.focusCurrent();
    const control = document.activeElement;
    expect(control?.classList.contains('bb-book__control')).toBe(true);
    shelf.setItems([items[3]!, items[4]!, items[1]!, items[0]!]);
    expect(document.activeElement).toBe(control);
    expect(control?.closest<HTMLElement>('.bb-book')?.dataset.id).toBe('id-1');
    expect((control as HTMLButtonElement).tabIndex).toBe(0);
  });

  it('moves keyboard focus to the neighbour when the focused volume leaves', () => {
    const { shelf } = mount();
    shelf.setPose({ position: 1, open: 0 });
    shelf.focusCurrent();
    shelf.setItems(makeItems(5).filter((item) => item.id !== 'id-1'));
    expect(document.activeElement?.closest<HTMLElement>('.bb-book')?.dataset.id).toBe('id-2');
  });

  it('letters a volume again in place when its item reads differently', () => {
    const { shelf } = mount();
    const book = bySlot(shelf, 1);
    const control = book.querySelector('.bb-book__control');
    const faces = book.querySelector('.bb-book__body');
    const items = makeItems(5);
    shelf.setItems(items.map((item) => (item.id === 'id-1' ? { ...item, title: 'Another name', cloth: 'moss' } : item)));
    expect(bySlot(shelf, 1)).toBe(book);
    expect(book.querySelector('.bb-book__control')).toBe(control);
    expect(book.querySelector('.bb-book__body')).not.toBe(faces);
    expect(book.querySelector('.bb-spine__title')?.textContent).toContain('Another');
    expect(book.classList.contains('bb-cloth--moss')).toBe(true);
    expect(control?.getAttribute('aria-label')).toContain('Another name');
  });

  it('moves the reading slip without making the faces again', () => {
    const { shelf } = mount();
    const book = bySlot(shelf, 0);
    const faces = book.querySelector('.bb-book__body');
    const print = book.querySelector('.bb-cover');
    const items = makeItems(5);
    shelf.setItems(items.map((item) => (item.id === 'id-0' ? { ...item, progress: 0.5 } : item)));
    expect(book.querySelector('.bb-book__body')).toBe(faces);
    expect(book.querySelector('.bb-cover')).toBe(print);
    expect(book.querySelector<HTMLElement>('.bb-book__slip')?.style.getPropertyValue('--bb-slip')).toBe('0.500');
    expect(book.querySelector('.bb-book__control')?.getAttribute('aria-label')).toContain('50 percent read');
    shelf.setItems(items.map((item) => (item.id === 'id-0' ? { ...item, progress: 1, done: true } : item)));
    expect(book.querySelector('.bb-book__slip')).toBeNull();
    expect(book.classList.contains('is-done')).toBe(true);
    // The printed cover carries the mark of a link that was read, so it is printed again.
    expect(book.querySelector('.bb-cover')).not.toBe(print);
    expect(book.querySelector('.bb-cover')?.hasAttribute('data-done')).toBe(true);
  });

  it('says the place of each volume again when the row gets longer', () => {
    const { shelf } = mount();
    shelf.setItems([{ id: 'first', title: 'First' }, ...makeItems(5)]);
    const label = (id: string): string =>
      shelf.element.querySelector(`.bb-book[data-id="${id}"] .bb-book__control`)?.getAttribute('aria-label') ?? '';
    expect(label('id-0')).toContain('Volume 2 of 6');
    expect(label('first')).toContain('Volume 1 of 6');
  });

  it('keeps every volume and the focus when the row starts to loop', () => {
    const { shelf } = mount();
    const before = byId(shelf);
    shelf.focusCurrent();
    const control = document.activeElement;
    shelf.setItems(makeItems(40));
    expect(shelf.loop).toBe(true);
    const kept = books(shelf).filter((book) => before.get(book.dataset.id ?? '') === book);
    expect(kept).toHaveLength(5);
    expect(document.activeElement).toBe(control);
  });

  it('keeps every volume and the focus when the look changes, and prints the cover for the new look', () => {
    const { shelf } = mount();
    const before = books(shelf);
    const print = bySlot(shelf, 0).querySelector('.bb-cover');
    shelf.focusCurrent();
    const control = document.activeElement;
    shelf.setVariant('oak');
    expect(books(shelf)).toEqual(before);
    expect(document.activeElement).toBe(control);
    expect(bySlot(shelf, 0).querySelector('.bb-cover')).not.toBeNull();
    expect(bySlot(shelf, 0).querySelector('.bb-cover')).not.toBe(print);
  });
});

describe('mountShelf volumes that travel, arrive and leave', () => {
  let now = 0;
  let frames: FrameRequestCallback[] = [];
  /** Lets `ms` pass and draws the frame that was asked for. */
  const step = (ms: number): void => {
    now += ms;
    const due = frames;
    frames = [];
    for (const run of due) run(now);
  };
  const xOf = (shelf: ShelfHandle, id: string): number =>
    Number(/translate3d\(([-\d.e]+)px/.exec(shelf.element.querySelector<HTMLElement>(`.bb-book[data-id="${id}"]`)?.style.transform ?? '')?.[1]);

  beforeEach(() => {
    now = 1000;
    frames = [];
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => frames.push(run));
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('starts a volume that stays from where it stood and brings it to its new place', () => {
    const { shelf } = mount();
    const items = makeItems(5);
    const order = [items[4]!, items[0]!, items[1]!, items[2]!, items[3]!];
    const before = xOf(shelf, 'id-4');
    shelf.setItems(order);
    expect(xOf(shelf, 'id-4')).toBeCloseTo(before, 6);
    expect(frames).toHaveLength(1);
    step(180);
    const half = xOf(shelf, 'id-4');
    expect(half).toBeLessThan(before - 20);
    step(200);
    const arrived = xOf(shelf, 'id-4');
    expect(arrived).toBeLessThan(half - 20);
    // Once every volume has arrived the shelf asks for no more frames.
    expect(frames).toHaveLength(0);
    const settled = mountShelf(document.body.appendChild(document.createElement('div')), {
      items: order,
      pose: { position: 1, open: 0, reduced: true },
    });
    expect(arrived).toBeCloseTo(xOf(settled, 'id-4'), 6);
  });

  it('turns a volume that stops being presented back to its spine on the way', () => {
    const { shelf } = mount();
    const book = bySlot(shelf, 0);
    const turn = (): number => Number(book.style.getPropertyValue('--bb-turn'));
    const full = turn();
    shelf.setItems(makeItems(5));
    shelf.setPose({ position: 3, open: 0 });
    expect(turn()).toBeCloseTo(full, 6);
    expect(book.querySelector('.bb-cover')).not.toBeNull();
    // The host has just set a pose, so the shelf lets one frame go by before it draws frames of its own.
    step(16);
    step(164);
    expect(turn()).toBeGreaterThan(0.1);
    expect(turn()).toBeLessThan(full - 0.1);
    step(200);
    expect(turn()).toBe(0);
  });

  it('carries on from where a volume is when the items change again on the way', () => {
    const { shelf } = mount();
    const items = makeItems(5);
    shelf.setItems([items[4]!, items[0]!, items[1]!, items[2]!, items[3]!]);
    step(180);
    const half = xOf(shelf, 'id-4');
    shelf.setItems(items);
    expect(xOf(shelf, 'id-4')).toBeCloseTo(half, 6);
  });

  it('draws every change at once under reduced motion', () => {
    const items = makeItems(5);
    const { shelf } = mount({ pose: { position: 0, open: 0, reduced: true } });
    const order = [items[4]!, items[0]!, { id: 'new', title: 'New' }, items[2]!];
    shelf.setItems(order, { arrive: ['new'] });
    expect(frames).toHaveLength(0);
    expect(shelf.element.querySelector('.is-leaving, .is-rising, .is-arriving, .is-arrived')).toBeNull();
    expect(shelf.element.querySelectorAll('.bb-book')).toHaveLength(4);
    const settled = mountShelf(document.body.appendChild(document.createElement('div')), {
      items: order,
      pose: { position: 1, open: 0, reduced: true },
    });
    expect(xOf(shelf, 'id-4')).toBeCloseTo(xOf(settled, 'id-4'), 6);
  });

  it('lifts a volume whose item left out of the row and then takes it away', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { shelf } = mount();
    const gone = bySlot(shelf, 3);
    const place = gone.style.transform;
    shelf.setItems(makeItems(5).filter((item) => item.id !== 'id-3'));
    expect(gone.isConnected).toBe(true);
    expect(gone.classList.contains('is-leaving')).toBe(true);
    expect(gone.style.transform).toBe(place);
    // It is no volume any more to someone who cannot see it go.
    expect(gone.getAttribute('aria-hidden')).toBe('true');
    expect(gone.querySelector('.bb-book__control')).toBeNull();
    expect(gone.parentElement?.lastElementChild).toBe(gone);
    expect(controls(shelf)).toHaveLength(4);
    vi.advanceTimersByTime(219);
    expect(gone.isConnected).toBe(true);
    vi.advanceTimersByTime(2);
    expect(gone.isConnected).toBe(false);
  });

  it('raises a new volume in and drops in one the person has just added', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { shelf } = mount();
    const items = makeItems(5);
    shelf.setItems([...items, { id: 'shown', title: 'Shown' }, { id: 'added', title: 'Added' }], { arrive: ['added'] });
    const shown = shelf.element.querySelector<HTMLElement>('.bb-book[data-id="shown"]')!;
    const added = shelf.element.querySelector<HTMLElement>('.bb-book[data-id="added"]')!;
    expect([...shown.classList]).toContain('is-rising');
    expect(shown.style.getPropertyValue('--bb-delay')).toBe('');
    expect([...added.classList]).toEqual(expect.arrayContaining(['is-arriving', 'is-arrived']));
    // It waits until its neighbours have made room.
    expect(added.style.getPropertyValue('--bb-delay')).toBe('140ms');
    expect(bySlot(shelf, 1).classList.contains('is-rising')).toBe(false);
    vi.advanceTimersByTime(900);
    expect(shown.classList.contains('is-rising')).toBe(false);
    expect(added.classList.contains('is-arriving')).toBe(false);
    expect(added.style.getPropertyValue('--bb-delay')).toBe('');
    expect(added.classList.contains('is-arrived')).toBe(true);
    vi.advanceTimersByTime(300);
    expect(added.classList.contains('is-arrived')).toBe(false);
  });

  it('brings a whole new row in from the centre outward while the old one goes', () => {
    const { shelf } = mount();
    const old = books(shelf);
    shelf.setItems(Array.from({ length: 5 }, (_, index) => ({ id: `other-${index}`, title: `Other ${index}` })));
    for (const book of old) expect(book.classList.contains('is-leaving')).toBe(true);
    const delay = (slot: number): string => bySlot(shelf, slot).style.getPropertyValue('--bb-delay');
    expect(bySlot(shelf, 0).classList.contains('is-rising')).toBe(true);
    expect(delay(0)).toBe('');
    expect(delay(1)).toBe('22ms');
    expect(delay(4)).toBe('88ms');
  });

  it('takes a bookend to the new end of the row instead of jumping it there', () => {
    const { shelf } = mount();
    const end = shelf.element.querySelector<HTMLElement>('.bb-shelf__bookend--end')!;
    const x = (): number => Number(/translate3d\(([-\d.e]+)px/.exec(end.style.transform)?.[1]);
    const before = x();
    shelf.setItems(makeItems(8));
    expect(x()).toBeCloseTo(before, 6);
    step(180);
    expect(x()).toBeGreaterThan(before + 10);
    const half = x();
    step(200);
    expect(x()).toBeGreaterThan(half + 10);
  });

  it('raises the first row of a session into place from the centre outward, and no row after it', () => {
    sessionStorage.removeItem('bookmark-bookshelf:arrived');
    const { shelf } = mount({ pose: { position: 2, open: 0 } });
    const delay = (slot: number): string => bySlot(shelf, slot).style.getPropertyValue('--bb-delay');
    for (const book of books(shelf)) expect(book.classList.contains('is-rising')).toBe(true);
    expect(delay(2)).toBe('');
    expect(delay(1)).toBe('22ms');
    expect(delay(3)).toBe('22ms');
    expect(delay(0)).toBe('44ms');
    expect(delay(4)).toBe('44ms');
    for (const end of shelf.element.querySelectorAll('.bb-shelf__bookend')) expect(end.classList.contains('is-rising')).toBe(true);
    expect(sessionStorage.getItem('bookmark-bookshelf:arrived')).toBe('1');
    const later = mountShelf(document.body.appendChild(document.createElement('div')), { items: makeItems(5) });
    expect(later.element.querySelector('.is-rising')).toBeNull();
  });

  it('lets the first row simply be there under reduced motion, or where the session cannot be written', () => {
    sessionStorage.removeItem('bookmark-bookshelf:arrived');
    const still = mount({ pose: { position: 0, open: 0, reduced: true } });
    expect(still.shelf.element.querySelector('.is-rising')).toBeNull();
    // That mount did not use up the session's one arrival.
    expect(sessionStorage.getItem('bookmark-bookshelf:arrived')).toBeNull();
    const refuse = (): never => {
      throw new Error('blocked');
    };
    vi.stubGlobal('sessionStorage', { getItem: refuse, setItem: refuse });
    const shut = mountShelf(document.body.appendChild(document.createElement('div')), { items: makeItems(5) });
    expect(shut.element.querySelector('.is-rising')).toBeNull();
  });

  it('leans the standing volumes behind the travel and straightens them when the row stops', () => {
    const { shelf } = mount({ items: makeItems(40) });
    const leanOf = (slot: number): number => Number(/rotateZ\(([-\d.]+)deg\) rotateY/.exec(bySlot(shelf, slot).style.transform)?.[1] ?? 0);
    expect(leanOf(5)).toBe(0);
    // Travelling up the row at six volumes a second for a while.
    for (let frame = 0; frame < 30; frame++) {
      now += 16;
      shelf.setPose({ position: 0, open: 0, velocity: 6 });
    }
    expect(leanOf(5)).toBeGreaterThan(1.2);
    expect(leanOf(5)).toBeLessThanOrEqual(1.8);
    expect(leanOf(-5)).toBeCloseTo(leanOf(5), 6);
    // The presented volume and the one beside it hold still.
    expect(leanOf(0)).toBe(0);
    expect(leanOf(1)).toBeLessThan(leanOf(5) / 4);
    // However fast the row goes, the lean has a limit.
    for (let frame = 0; frame < 40; frame++) {
      now += 16;
      shelf.setPose({ position: 0, open: 0, velocity: -90 });
    }
    expect(leanOf(5)).toBeLessThan(-3);
    expect(leanOf(5)).toBeGreaterThanOrEqual(-3.2);
    // The row stops: the volumes straighten on frames of the shelf's own, and then it asks for no more.
    shelf.setPose({ position: 0, open: 0, velocity: 0 });
    const stopping = leanOf(5);
    for (let frame = 0; frame < 12; frame++) step(16);
    expect(Math.abs(leanOf(5))).toBeLessThan(Math.abs(stopping));
    expect(Math.abs(leanOf(5))).toBeGreaterThan(0);
    // They rock back past upright once, by a small part of the lean they had, before they stand.
    let counter = 0;
    for (let frame = 0; frame < 110; frame++) {
      step(16);
      counter = Math.max(counter, leanOf(5));
    }
    expect(counter).toBeGreaterThan(0.02);
    expect(counter).toBeLessThan(Math.abs(stopping) / 4);
    expect(leanOf(5)).toBe(0);
    expect(bySlot(shelf, 5).style.transform).not.toContain('rotateZ');
    expect(frames).toHaveLength(0);
  });

  it('passes the lean down the row as a wave: a volume further from the middle takes it up later', () => {
    const { shelf } = mount({ items: makeItems(40) });
    const leanOf = (slot: number): number => Number(/rotateZ\(([-\d.]+)deg\) rotateY/.exec(bySlot(shelf, slot).style.transform)?.[1] ?? 0);
    for (let frame = 0; frame < 6; frame++) {
      now += 16;
      shelf.setPose({ position: 0, open: 0, velocity: 6 });
    }
    expect(leanOf(3)).toBeGreaterThan(0);
    expect(leanOf(9)).toBe(0);
    expect(leanOf(-3)).toBeCloseTo(leanOf(3), 6);
    for (let frame = 0; frame < 8; frame++) {
      now += 16;
      shelf.setPose({ position: 0, open: 0, velocity: 6 });
    }
    expect(leanOf(9)).toBeGreaterThan(0);
    expect(leanOf(9)).toBeLessThan(leanOf(3));
  });

  it('carries the turn of the arriving volume a little past its place, and lets it come back to exactly there', () => {
    const { shelf } = mount({ items: makeItems(40) });
    const turnOf = (slot: number): number => Math.abs(Number(/rotateY\(([-\d.]+)deg\)/.exec(bySlot(shelf, slot).style.transform)?.[1] ?? 0));
    const full = turnOf(0);
    expect(full).toBeGreaterThan(60);
    // The row runs one place up in 160 ms and stops there.
    for (let frame = 1; frame <= 10; frame++) {
      now += 16;
      shelf.setPose({ position: frame / 10, open: 0, velocity: frame < 10 ? 6.25 : 0 });
    }
    let most = turnOf(1);
    for (let frame = 0; frame < 120; frame++) {
      step(16);
      most = Math.max(most, turnOf(1));
    }
    expect(most).toBeGreaterThan(full * 1.005);
    expect(most).toBeLessThanOrEqual(full * 1.03 + 0.001);
    expect(turnOf(1)).toBe(full);
    // The volume that left stands as the layout says, and the shelf asks for no more frames.
    expect(turnOf(0)).toBe(0);
    expect(frames).toHaveLength(0);
  });

  it('carries nothing under a hand or through a jump', () => {
    const { shelf } = mount({ items: makeItems(40) });
    const turnOf = (slot: number): number => Math.abs(Number(/rotateY\(([-\d.]+)deg\)/.exec(bySlot(shelf, slot).style.transform)?.[1] ?? 0));
    const full = turnOf(0);
    // Held: positions come with no speed of the row's own.
    for (let frame = 1; frame <= 10; frame++) {
      now += 16;
      shelf.setPose({ position: frame / 10, open: 0 });
    }
    expect(turnOf(1)).toBe(full);
    expect(frames).toHaveLength(0);
    // A jump of several places is drawn at once.
    now += 16;
    shelf.setPose({ position: 6, open: 0, velocity: 3 });
    expect(turnOf(6)).toBe(full);
  });

  it('carries nothing under reduced motion: every pose is drawn as the layout says, whatever the speed', () => {
    const { shelf } = mount({ items: makeItems(40), pose: { position: 0, open: 0, reduced: true } });
    const turnOf = (slot: number): number => Math.abs(Number(/rotateY\(([-\d.]+)deg\)/.exec(bySlot(shelf, slot).style.transform)?.[1] ?? 0));
    const full = turnOf(0);
    for (let frame = 1; frame <= 10; frame++) {
      now += 16;
      shelf.setPose({ position: frame / 10, open: 0, velocity: 6.25, reduced: true });
      expect(turnOf(1)).toBeLessThanOrEqual(full);
    }
    expect(turnOf(1)).toBe(full);
    expect(turnOf(0)).toBe(0);
    expect(frames).toHaveLength(0);
  });

  it('stands every volume straight under reduced motion, whatever the speed', () => {
    const { shelf } = mount({ items: makeItems(40) });
    for (let frame = 0; frame < 10; frame++) {
      now += 16;
      shelf.setPose({ position: 0, open: 0, velocity: 12, reduced: true });
    }
    expect(bySlot(shelf, 5).style.transform).not.toContain('rotateZ');
    expect(frames).toHaveLength(0);
  });

  it('stops asking for frames once it is destroyed', () => {
    const { shelf } = mount();
    shelf.setItems(makeItems(5).reverse());
    shelf.destroy();
    expect(() => step(100)).not.toThrow();
    expect(frames).toHaveLength(0);
  });
});

describe('mountShelf taps and touches', () => {
  interface Touch {
    id?: number;
    x?: number;
    y?: number;
    time?: number;
    kind?: string;
    primary?: boolean;
  }
  /** A pointer event as a touch screen sends it, at a chosen moment. */
  const pointer = (type: string, target: Element, touch: Touch = {}): void => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: touch.x ?? 300, clientY: touch.y ?? 200 });
    Object.defineProperties(event, {
      pointerId: { value: touch.id ?? 1 },
      pointerType: { value: touch.kind ?? 'touch' },
      isPrimary: { value: touch.primary ?? true },
      timeStamp: { value: touch.time ?? 0 },
    });
    target.dispatchEvent(event);
  };
  const clickAt = (target: Element, time: number): void => {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 });
    Object.defineProperty(event, 'timeStamp', { value: time });
    target.dispatchEvent(event);
  };
  const faceOf = (shelf: ShelfHandle, slot: number): Element => bySlot(shelf, slot).querySelector('.bb-book__body')!;

  it('opens the centred volume while the row is still settling onto it', () => {
    const { shelf, intents } = mount();
    shelf.setPose({ position: 0.55, open: 0 });
    shelf.setPose({ position: 0.7, open: 0 });
    click(faceOf(shelf, 1));
    expect(intents).toEqual([{ type: 'open', id: 'id-1', index: 1 }]);
  });

  it('brings back a centred volume that the row is leaving instead of opening it', () => {
    const { shelf, intents } = mount();
    shelf.setPose({ position: 1, open: 0 });
    shelf.setPose({ position: 1.3, open: 0 });
    click(faceOf(shelf, 1));
    expect(intents).toEqual([{ type: 'focus', id: 'id-1', index: 1, slot: 1 }]);
  });

  it('takes a touch tap once, whatever click the browser sends after it', () => {
    const { shelf, intents } = mount();
    pointer('pointerdown', faceOf(shelf, 0), { time: 1000 });
    pointer('pointerup', faceOf(shelf, 0), { time: 1090 });
    clickAt(faceOf(shelf, 0), 1100);
    expect(intents).toEqual([{ type: 'open', id: 'id-0', index: 0 }]);
  });

  it('does not open a volume a thumb rested on, and takes the next tap as usual', () => {
    const { shelf, intents } = mount();
    pointer('pointerdown', faceOf(shelf, 0), { time: 1000 });
    pointer('pointerup', faceOf(shelf, 0), { time: 2200 });
    clickAt(faceOf(shelf, 0), 2210);
    expect(intents).toEqual([]);
    clickAt(faceOf(shelf, 0), 3000);
    expect(intents).toEqual([{ type: 'open', id: 'id-0', index: 0 }]);
  });

  it('takes nothing for a tap while a second finger is on the shelf', () => {
    const { shelf, intents } = mount();
    pointer('pointerdown', faceOf(shelf, 1), { id: 1, time: 1000 });
    pointer('pointerdown', faceOf(shelf, 3), { id: 2, time: 1040, primary: false });
    pointer('pointerup', faceOf(shelf, 1), { id: 1, time: 1100 });
    pointer('pointerup', faceOf(shelf, 3), { id: 2, time: 1120 });
    expect(intents).toEqual([]);
    // One finger again: a tap is a tap.
    pointer('pointerdown', faceOf(shelf, 1), { id: 3, time: 2000 });
    pointer('pointerup', faceOf(shelf, 1), { id: 3, time: 2080 });
    expect(intents).toEqual([{ type: 'focus', id: 'id-1', index: 1, slot: 1 }]);
  });

  it('holds a travelling row still while a second finger is down', () => {
    const { shelf } = mount({ items: makeItems(40) });
    pointer('pointerdown', faceOf(shelf, 3), { id: 1, x: 500 });
    const track = shelf.trackFrom({ x: 500, target: faceOf(shelf, 3), position: 0 });
    const before = track?.(480) ?? Number.NaN;
    expect(before).toBeGreaterThan(0.1);
    pointer('pointerdown', faceOf(shelf, 5), { id: 2, x: 700, primary: false });
    expect(track?.(300)).toBe(before);
    pointer('pointerup', faceOf(shelf, 5), { id: 2, x: 700 });
    expect(track?.(300)).toBeGreaterThan(before + 1);
  });

  it('leaves the row alone for a swipe that comes in from the side of the window', () => {
    const { shelf } = mount({ items: makeItems(40) });
    pointer('pointerdown', shelf.surface, { x: 6 });
    const track = shelf.trackFrom({ x: 6, target: shelf.surface, position: 4 });
    expect(track?.(6)).toBe(4);
    expect(track?.(240)).toBe(4);
    pointer('pointerup', shelf.surface, { x: 240 });
    // The same press with a mouse, or a touch further in, moves the row as usual.
    pointer('pointerdown', shelf.surface, { x: 6, kind: 'mouse' });
    expect(shelf.trackFrom({ x: 6, target: shelf.surface, position: 4 })?.(240)).toBeLessThan(3);
    pointer('pointerdown', shelf.surface, { x: 120 });
    expect(shelf.trackFrom({ x: 120, target: shelf.surface, position: 4 })?.(360)).toBeLessThan(3);
  });
});

describe('mountShelf and a mouse crossing the row', () => {
  /** A mouse move over the scene at a chosen place and moment. */
  const move = (shelf: ShelfHandle, x: number, time: number, kind = 'mouse'): void => {
    const event = new MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: 200 });
    Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: kind }, timeStamp: { value: time } });
    shelf.surface.dispatchEvent(event);
  };
  const passing = (shelf: ShelfHandle): boolean => shelf.element.dataset.passing === '1';

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks a mouse that sweeps along the row as passing, and no longer once it has slowed down or stopped', () => {
    const { shelf } = mount();
    expect(passing(shelf)).toBe(false);
    // One spine width every frame: about a px a ms.
    for (let frame = 0; frame <= 6; frame++) {
      move(shelf, 200 + frame * 16, frame * 16);
      vi.advanceTimersByTime(16);
    }
    expect(passing(shelf)).toBe(true);
    // It stops on a volume: after a moment it is no longer passing, and the style sheet may raise the spine.
    vi.advanceTimersByTime(40);
    expect(passing(shelf)).toBe(true);
    vi.advanceTimersByTime(30);
    expect(passing(shelf)).toBe(false);
    // Sweeping on and then creeping: the slow moves do not keep it passing.
    for (let frame = 0; frame <= 4; frame++) {
      move(shelf, 400 + frame * 16, 1000 + frame * 16);
      vi.advanceTimersByTime(16);
    }
    expect(passing(shelf)).toBe(true);
    for (let frame = 1; frame <= 5; frame++) {
      move(shelf, 464 + frame * 2, 1064 + frame * 16);
      vi.advanceTimersByTime(16);
    }
    expect(passing(shelf)).toBe(false);
  });

  it('never marks a slow mouse, a touch, or a mouse that only starts off again after a rest', () => {
    const { shelf } = mount();
    // A fifth of a px a ms.
    for (let frame = 0; frame <= 10; frame++) move(shelf, 200 + frame * 3, frame * 16);
    expect(passing(shelf)).toBe(false);
    for (let frame = 0; frame <= 6; frame++) move(shelf, 200 + frame * 16, 2000 + frame * 16, 'touch');
    expect(passing(shelf)).toBe(false);
    // Two moves a long time apart say nothing about speed, however far apart they are.
    move(shelf, 100, 5000);
    move(shelf, 700, 5400);
    expect(passing(shelf)).toBe(false);
  });

  it('forgets the wait when the shelf is destroyed', () => {
    const { shelf } = mount();
    move(shelf, 200, 0);
    move(shelf, 240, 20);
    expect(passing(shelf)).toBe(true);
    shelf.destroy();
    expect(() => vi.advanceTimersByTime(200)).not.toThrow();
  });
});

describe('mountShelf under a dragging hand', () => {
  let now = 0;
  let frames: FrameRequestCallback[] = [];
  const step = (ms: number): void => {
    now += ms;
    const due = frames;
    frames = [];
    for (const run of due) run(now);
  };
  const given = (shelf: ShelfHandle): number =>
    Number(/translate3d\(([-\d.e]+)px/.exec(shelf.element.querySelector<HTMLElement>('.bb-shelf__row')?.style.transform ?? '')?.[1] ?? 0);
  const release = (shelf: ShelfHandle, type = 'pointerup'): void => {
    shelf.surface.dispatchEvent(new MouseEvent(type, { bubbles: true }));
  };

  beforeEach(() => {
    now = 1000;
    frames = [];
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => frames.push(run));
    vi.stubGlobal('cancelAnimationFrame', () => {
      frames = [];
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('has nothing to track on an empty shelf', () => {
    const { shelf } = mount({ items: [] });
    expect(shelf.trackFrom({ x: 100, target: shelf.surface, position: 0 })).toBeNull();
  });

  it('keeps the grabbed volume of a travelling row under the pointer', () => {
    const { shelf } = mount({ items: makeItems(40) });
    const pitch = shelf.pitch();
    const track = shelf.trackFrom({ x: 500, target: bySlot(shelf, 4).querySelector('.bb-book__spine'), position: 0 });
    expect(track).not.toBeNull();
    expect(track?.(500)).toBeCloseTo(0, 2);
    // A volume well away from the centre moves with the row as one strip: a pitch of travel is one volume.
    expect(track?.(500 + pitch)).toBeCloseTo(-1, 1);
    expect(track?.(500 - 2 * pitch)).toBeCloseTo(2, 1);
    expect(track?.(500 - 2 * pitch + 1)).toBeLessThan(2);
  });

  it('holds the nearest volume when the press lands beside the volumes', () => {
    const { shelf } = mount({ items: makeItems(40) });
    const track = shelf.trackFrom({ x: 37, target: shelf.surface, position: 3 });
    expect(track?.(37)).toBeCloseTo(3, 2);
    expect(track?.(37 - shelf.pitch())).toBeGreaterThan(3.5);
  });

  it('moves the position of a standing row with the hand, a volume for each pitch of travel', () => {
    const { shelf, intents } = mount();
    expect(shelf.fixed).toBe(true);
    const pitch = shelf.pitch();
    const track = shelf.trackFrom({ x: 400, target: shelf.surface, position: 2 });
    expect(track?.(400)).toBe(2);
    // Pulled left, the row is taken up it, as a travelling row is.
    expect(track?.(400 - pitch / 2)).toBeCloseTo(2.5, 6);
    expect(track?.(400 - pitch)).toBeCloseTo(3, 6);
    expect(track?.(400 + pitch)).toBeCloseTo(1, 6);
    expect(track?.(400 + 1.5 * pitch)).toBeCloseTo(0.5, 6);
    // Inside the row nothing is drawn aside: the volumes turn where they stand.
    expect(given(shelf)).toBe(0);
    release(shelf);
    vi.advanceTimersByTime(10);
    // The release is settled by whoever follows the drag: the shelf asks for no step of its own.
    expect(intents).toEqual([]);
    expect(frames).toHaveLength(0);
  });

  it('turns the volumes of a standing row under the hand as the position it returns is drawn', () => {
    const { shelf } = mount();
    const turnOf = (slot: number): number => Number(/rotateY\(([-\d.]+)deg\)/.exec(bySlot(shelf, slot).style.transform)?.[1] ?? 0);
    const track = shelf.trackFrom({ x: 400, target: shelf.surface, position: 2 });
    shelf.setPose({ position: 2, open: 0 });
    const shown = turnOf(2);
    expect(Math.abs(shown)).toBeGreaterThan(60);
    expect(turnOf(3)).toBeCloseTo(0, 6);
    shelf.setPose({ position: track?.(400 - shelf.pitch() / 2) ?? Number.NaN, open: 0 });
    // Half a pitch on, the volume that was presented is turning back and the next one is coming round.
    expect(Math.abs(turnOf(2))).toBeLessThan(Math.abs(shown));
    expect(Math.abs(turnOf(2))).toBeGreaterThan(1);
    expect(Math.abs(turnOf(3))).toBeGreaterThan(1);
    expect(Math.abs(turnOf(3))).toBeCloseTo(Math.abs(turnOf(2)), 3);
  });

  it('lets a standing row give when it is pulled past an end, never further than its limit, and settle back', () => {
    const { shelf, intents } = mount();
    const pitch = shelf.pitch();
    const track = shelf.trackFrom({ x: 300, target: shelf.surface, position: 1 });
    // Down to the first volume the position follows and the row stands.
    now += 30;
    expect(track?.(300 + pitch)).toBeCloseTo(0, 6);
    expect(given(shelf)).toBe(0);
    // Further than that there is no volume to go to: the position stays and the row gives.
    now += 30;
    expect(track?.(300 + pitch + 40)).toBe(0);
    const little = given(shelf);
    expect(little).toBeGreaterThan(5);
    expect(little).toBeLessThan(40);
    now += 300;
    expect(track?.(300 + pitch + 900)).toBe(0);
    // However far the hand goes, the row gives no more than about 28 px.
    expect(given(shelf)).toBeGreaterThan(27);
    expect(given(shelf)).toBeLessThanOrEqual(28);
    now += 300;
    release(shelf);
    vi.advanceTimersByTime(10);
    expect(intents).toEqual([]);
    step(100);
    const back = given(shelf);
    expect(back).toBeLessThan(27);
    expect(back).toBeGreaterThan(0);
    for (let frame = 0; frame < 60; frame++) step(16);
    expect(given(shelf)).toBe(0);
    expect(frames).toHaveLength(0);
    // Past the last volume it gives the other way, and comes back as the hand does.
    const other = shelf.trackFrom({ x: 300, target: shelf.surface, position: 4 });
    expect(other?.(200)).toBe(4);
    expect(given(shelf)).toBeLessThan(-10);
    expect(other?.(300)).toBe(4);
    expect(given(shelf)).toBe(0);
    expect(other?.(300 + pitch)).toBeCloseTo(3, 6);
    expect(given(shelf)).toBe(0);
  });

  it('carries on from as far as a standing row still gives when it is caught on its way back', () => {
    const { shelf } = mount();
    const track = shelf.trackFrom({ x: 300, target: shelf.surface, position: 0 });
    now += 30;
    track?.(420);
    now += 200;
    release(shelf);
    step(40);
    const caught = given(shelf);
    expect(caught).toBeGreaterThan(1);
    const again = shelf.trackFrom({ x: 500, target: shelf.surface, position: 0 });
    // Held where it was caught, it neither jumps back to rest nor out to the limit.
    expect(again?.(500)).toBe(0);
    expect(given(shelf)).toBeCloseTo(caught, 1);
    expect(again?.(540)).toBe(0);
    expect(given(shelf)).toBeGreaterThan(caught);
    expect(frames).toHaveLength(0);
  });

  it('asks for no step of its own when a standing row is let go at speed: the position it returned carries the swipe', () => {
    const { shelf, intents } = mount();
    const pitch = shelf.pitch();
    const swipe = (to: number): number => {
      const track = shelf.trackFrom({ x: 400, target: shelf.surface, position: 2 });
      let at = 2;
      for (let index = 1; index <= 5; index++) {
        now += 10;
        at = track?.(400 + ((to - 400) * index) / 5) ?? Number.NaN;
      }
      release(shelf);
      vi.advanceTimersByTime(5);
      return at;
    };
    // A swipe left has taken the position up the row by its travel, and one right down it.
    expect(swipe(320)).toBeCloseTo(2 + 80 / pitch, 6);
    expect(swipe(480)).toBeCloseTo(2 - 80 / pitch, 6);
    expect(intents).toEqual([]);
  });

  it('holds a standing row where it is while a second finger is down, and drops the pull when it is cancelled', () => {
    const { shelf, intents } = mount();
    const scene = shelf.surface;
    const touch = (type: string, id: number, primary: boolean): void => {
      const event = new MouseEvent(type, { bubbles: true, clientX: 400, clientY: 100 });
      Object.defineProperties(event, { pointerId: { value: id }, pointerType: { value: 'touch' }, isPrimary: { value: primary } });
      scene.dispatchEvent(event);
    };
    touch('pointerdown', 1, true);
    const track = shelf.trackFrom({ x: 400, target: scene, position: 2 });
    const before = track?.(400 - shelf.pitch() / 2) ?? Number.NaN;
    expect(before).toBeCloseTo(2.5, 6);
    touch('pointerdown', 2, false);
    expect(track?.(100)).toBe(before);
    touch('pointercancel', 2, false);
    touch('pointercancel', 1, true);
    vi.advanceTimersByTime(5);
    expect(intents).toEqual([]);
    expect(given(shelf)).toBe(0);
  });

  it('moves nothing of a standing row under the hand under reduced motion, and steps on a swipe', () => {
    const { shelf, intents } = mount({ pose: { position: 2, open: 0, reduced: true } });
    const swipe = (to: number, type = 'pointerup', wait = 0): void => {
      const track = shelf.trackFrom({ x: 400, target: shelf.surface, position: 2 });
      for (let index = 1; index <= 5; index++) {
        now += 10;
        // Neither along the row nor aside: the position stays and the row does not give, even past an end.
        expect(track?.(400 + ((to - 400) * index) / 5)).toBe(2);
        expect(given(shelf)).toBe(0);
      }
      now += wait;
      release(shelf, type);
    };
    swipe(300);
    // The step is asked for once the release has been dealt with, not in the middle of it.
    expect(intents).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(intents).toEqual([{ type: 'step', direction: 1 }]);
    swipe(480);
    vi.advanceTimersByTime(1);
    expect(intents).toEqual([
      { type: 'step', direction: 1 },
      { type: 'step', direction: -1 },
    ]);
    // A pull that is short, cancelled, or still when it is let go is no swipe.
    swipe(385);
    swipe(300, 'pointercancel');
    swipe(300, 'pointerup', 200);
    vi.advanceTimersByTime(5);
    expect(intents).toHaveLength(2);
    expect(frames).toHaveLength(0);
  });
});

describe('mountShelf items, variants and teardown', () => {
  it('setItems([]) shows the empty message and sets data-empty', () => {
    const { shelf } = mount();
    expect(shelf.element.dataset.empty).toBe('0');
    shelf.setItems([]);
    const empty = shelf.element.querySelector<HTMLElement>('.bb-shelf__empty');
    expect(empty?.hidden).toBe(false);
    expect(empty?.textContent).toBe('This shelf is empty.');
    expect(shelf.element.dataset.empty).toBe('1');
    expect(books(shelf)).toHaveLength(0);
    expect(shelf.coverBox()).toBeNull();
  });

  // Defect: render() returns early for an empty shelf, so data-focus-id keeps naming a removed item.
  it('setItems([]) clears data-focus-id', () => {
    const { shelf } = mount();
    shelf.setItems([]);
    expect(shelf.element.dataset.focusId ?? '').toBe('');
  });

  it('shows books again after items come back', () => {
    const { shelf } = mount({ items: [] });
    expect(shelf.element.dataset.empty).toBe('1');
    shelf.setItems(makeItems(3));
    expect(shelf.element.dataset.empty).toBe('0');
    expect(controls(shelf)).toHaveLength(3);
    expect(shelf.element.querySelector<HTMLElement>('.bb-shelf__empty')?.hidden).toBe(true);
  });

  it('setVariant("oak") sets data-variant and turns looping off', () => {
    const { shelf } = mount();
    shelf.setVariant('oak');
    expect(shelf.element.dataset.variant).toBe('oak');
    expect(shelf.variant.name).toBe('oak');
    expect(shelf.loop).toBe(false);
    expect(controls(shelf)).toHaveLength(5);
    expect(books(shelf)).toHaveLength(5);
    expect(books(shelf).some((book) => book.getAttribute('aria-hidden') === 'true')).toBe(false);
  });

  it('an explicit loop option overrides the variant', () => {
    const { shelf } = mount({ variant: 'oak', loop: true, items: makeItems(40) });
    expect(shelf.loop).toBe(true);
    expect(books(shelf).some((book) => Number(book.dataset.slot) < 0)).toBe(true);
  });

  it('does not render slots past the ends when the row has two ends', () => {
    const { shelf } = mount({ variant: 'oak' });
    shelf.setPose({ position: 4, open: 0 });
    expect(books(shelf).map((book) => book.dataset.slot)).toEqual(['0', '1', '2', '3', '4']);
  });

  it('destroy removes the root and stops intents', () => {
    const { shelf, intents } = mount();
    const row = shelf.element.querySelector('.bb-shelf__row')!;
    shelf.destroy();
    expect(host.contains(shelf.element)).toBe(false);
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    expect(intents).toEqual([]);
  });
});
