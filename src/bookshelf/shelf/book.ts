import { createCover } from './cover-art';
import { imprintOf, seriesOf } from './imprint';
import type { SlotPose } from './layout';
import type { TitleFit } from './title-fit';
import { resolveCloth } from './variants';
import type { ShelfItem } from './types';

/**
 * One volume: a list item holding three faces that always exist (the spine, the front board on its right
 * and the back board on its left), the printed cover laid on the front board only near the centre and,
 * for the real (non-repeated) copy of an item, one native button that keyboard and screen-reader users
 * operate. Pointer taps land on the faces and are handled by the shelf through delegation.
 */
export interface BookNode {
  element: HTMLLIElement;
  slot: number;
  index: number;
  item: ShelfItem;
  /** Everything of the volume that can be seen: its faces, rings and slip. */
  body: HTMLElement;
  /** How many places from the presented volume it stood when it was last taken out of its slot. */
  offset: number;
  /** The pose it was last drawn in. Null until it has been drawn. */
  drawn: SlotPose | null;
  /** Where it travels from after the row changed around it, and when that began. Null once it has arrived. */
  from: SlotPose | null;
  fromAt: number;
  /** The lettering on the spine; the shelf fits it to the spine's size. */
  title: HTMLElement;
  /** Where the title's text goes: the title itself, or the paper label pasted on it. */
  words: HTMLElement;
  treatment: SpineTreatment;
  spineShade: HTMLElement;
  /** The front board. The printed cover is laid on it. */
  cover: HTMLElement;
  coverShade: HTMLElement;
  back: HTMLElement;
  backShade: HTMLElement;
  print: HTMLElement | null;
  /** Last `--bb-turn` written, so a volume at rest is not written again on every frame. */
  turn: number;
  /** What else was last written on the list item, for the same reason. */
  wrote: { transform: string; out: boolean; raised: boolean; turned: boolean; away: boolean; sheen: string; sweep: string };
  /** Last shade written on the spine, the front board and the back board. */
  shades: [number, number, number];
  control: HTMLButtonElement | null;
}

/**
 * How a spine is dressed, the same for every volume from one site so that a site's volumes read as a
 * series: a band at head and tail, a paper label pasted on, or plain cloth with only the imprint.
 */
export type SpineTreatment = 'bands' | 'label' | 'plain';
const TREATMENTS: readonly SpineTreatment[] = ['bands', 'label', 'plain'];
/** Shapes of the imprint device at the tail of a spine, one per site. */
const DEVICES = ['circle', 'square', 'lozenge', 'shield'] as const;

function span(className: string, text?: string): HTMLSpanElement {
  const element = document.createElement('span');
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

export function markFor(item: ShelfItem, index: number): string {
  return item.mark ?? String(index + 1).padStart(2, '0');
}

/** The parts of a volume that are made from its item and made again when the item looks different. */
type Dress = Pick<
  BookNode,
  'body' | 'title' | 'words' | 'treatment' | 'spineShade' | 'cover' | 'coverShade' | 'back' | 'backShade'
>;

function dress(item: ShelfItem, index: number): Dress {
  const body = span('bb-book__body');
  body.setAttribute('aria-hidden', 'true');

  const treatment = TREATMENTS[seriesOf(item.source, TREATMENTS.length)] ?? 'bands';
  const spine = span('bb-book__spine');
  spine.dataset.treatment = treatment;
  // Every spine keeps room for the check, so marking a link read never changes where its title sits.
  spine.appendChild(span('bb-spine__done'));
  spine.appendChild(span('bb-spine__mark', markFor(item, index)));
  spine.appendChild(span('bb-spine__rule'));
  const title = span('bb-spine__title');
  if (item.lang) title.lang = item.lang;
  const words = treatment === 'label' ? span('bb-spine__label') : title;
  if (words !== title) title.appendChild(words);
  words.textContent = item.title;
  spine.appendChild(title);
  spine.appendChild(span('bb-spine__rule'));
  // The publisher's device in place of an ornament: the site's initial in the site's own shape.
  const device = span('bb-spine__device');
  device.dataset.shape = DEVICES[seriesOf(item.source, DEVICES.length)] ?? 'circle';
  device.appendChild(span('bb-spine__initial', imprintOf(item.source).initial));
  spine.appendChild(device);
  const spineShade = span('bb-book__shade');
  spine.appendChild(spineShade);
  body.appendChild(spine);
  // Focus rings are drawn in the plane of a face, around it, so the 3D turn can never cut them off.
  // The spine clips its own lettering, so its ring stands beside it in the same plane.
  body.appendChild(span('bb-book__ring bb-book__ring--spine'));

  // Both boards are plain cloth, so they cost two spans and no decision about when to show them: the
  // browser culls whichever faces away. Only the printed cover is built on demand.
  const cover = span('bb-book__cover bb-book__board bb-book__board--front');
  const coverShade = span('bb-book__shade');
  cover.appendChild(coverShade);
  const back = span('bb-book__board bb-book__board--back');
  const backShade = span('bb-book__shade');
  back.appendChild(backShade);
  body.append(cover, back);
  // A face drops whatever its children paint outside its own box, so the cover's ring is a plane of its own.
  body.appendChild(span('bb-book__ring bb-book__ring--cover'));
  return { body, title, words, treatment, spineShade, cover, coverShade, back, backShade };
}

/** How far the reading of an item has got, 0 to 1; 0 once it is marked as read, which shows a check instead. */
function slipOf(item: ShelfItem): number {
  return item.done ? 0 : Math.min(1, Math.max(0, item.progress ?? 0));
}

/** Shows what is known about the reading of the item: a check for a volume marked as read, a slip for one in progress. */
function markReading(node: BookNode): void {
  node.element.classList.toggle('is-done', node.item.done === true);
  const progress = slipOf(node.item);
  let slip = [...node.body.children].find((part): part is HTMLElement => part.classList.contains('bb-book__slip'));
  if (progress <= 0) {
    slip?.remove();
    return;
  }
  if (!slip) {
    // A slip of card standing in the pages: how far it sits from the front board is how far the reading got.
    slip = span('bb-book__slip');
    node.body.insertBefore(slip, node.cover);
  }
  slip.style.setProperty('--bb-slip', progress.toFixed(3));
}

export function createBook(item: ShelfItem, index: number, slot: number): BookNode {
  const element = document.createElement('li');
  element.className = `bb-book bb-cloth--${resolveCloth(item.cloth)}`;
  element.dataset.slot = String(slot);
  element.dataset.index = String(index);
  element.dataset.id = item.id;
  const parts = dress(item, index);
  element.appendChild(parts.body);
  const node: BookNode = {
    element,
    slot,
    index,
    item,
    ...parts,
    offset: 0,
    drawn: null,
    from: null,
    fromAt: 0,
    print: null,
    turn: 0,
    wrote: { transform: '', out: false, raised: false, turned: false, away: false, sheen: '', sweep: '' },
    shades: [-1, -1, -1],
    control: null,
  };
  markReading(node);
  return node;
}

function sameOutline(one: readonly number[] | undefined, other: readonly number[] | undefined): boolean {
  if (one === other) return true;
  if (!one || !other || one.length !== other.length) return false;
  return one.every((value, index) => value === other[index]);
}

/** Whether two items, each at its place in the row, are lettered and printed alike. */
function sameFaces(one: ShelfItem, oneIndex: number, other: ShelfItem, otherIndex: number): boolean {
  return (
    one.title === other.title &&
    one.source === other.source &&
    one.author === other.author &&
    one.cloth === other.cloth &&
    one.pattern === other.pattern &&
    one.seed === other.seed &&
    one.lang === other.lang &&
    markFor(one, oneIndex) === markFor(other, otherIndex) &&
    sameOutline(one.outline, other.outline)
  );
}

/**
 * Gives a volume that stays in the row its item as it is now, and its new place. The list item, its
 * control and whatever keyboard focus it holds are kept. Faces are made again only when the item is
 * lettered or printed differently; otherwise they stay, the printed cover included.
 */
export function redress(node: BookNode, item: ShelfItem, index: number, slot: number): void {
  const previous = node.item;
  const alike = sameFaces(previous, node.index, item, index);
  node.item = item;
  node.index = index;
  node.slot = slot;
  node.element.dataset.slot = String(slot);
  node.element.dataset.index = String(index);
  node.element.dataset.id = item.id;
  if (!alike) {
    const parts = dress(item, index);
    node.body.replaceWith(parts.body);
    Object.assign(node, parts);
    node.print = null;
    node.shades = [-1, -1, -1];
    node.element.className = node.element.className.replace(/\bbb-cloth--\S+/, `bb-cloth--${resolveCloth(item.cloth)}`);
  } else if (previous.done !== item.done) {
    // The printed cover says whether the link has been read.
    dropPrint(node);
  }
  markReading(node);
}

/** A bookend at one end of a row that does not loop: a thin plate standing across the row. */
export interface BookendNode {
  element: HTMLLIElement;
  /** Where it was last drawn along the row, and where it travels from after the row changed. */
  x: number | null;
  from: number | null;
  fromAt: number;
  edgeShade: HTMLElement;
  frontShade: HTMLElement;
  backShade: HTMLElement;
  shades: [number, number, number];
}

export function createBookend(side: 'start' | 'end'): BookendNode {
  const element = document.createElement('li');
  element.className = `bb-shelf__bookend bb-shelf__bookend--${side}`;
  element.setAttribute('aria-hidden', 'true');
  const face = (className: string): [HTMLSpanElement, HTMLSpanElement] => {
    const part = span(className);
    const shade = span('bb-book__shade');
    part.appendChild(shade);
    element.appendChild(part);
    return [part, shade];
  };
  const [, edgeShade] = face('bb-bookend__edge');
  const [, frontShade] = face('bb-bookend__face bb-bookend__face--front');
  const [, backShade] = face('bb-bookend__face bb-bookend__face--back');
  return { element, x: null, from: null, fromAt: 0, edgeShade, frontShade, backShade, shades: [-1, -1, -1] };
}

/**
 * Lays the printed cover on the front board. The print only shows as the volume turns toward the viewer,
 * so a volume that is still at rest looks the same with or without it. `aspect` is the cover's width over
 * its height in the current look, so the plate is composed for the board it is printed on.
 */
export function ensurePrint(node: BookNode, aspect?: number): void {
  if (node.print) return;
  const print = createCover(node.item, markFor(node.item, node.index), { aspect });
  node.cover.insertBefore(print, node.coverShade);
  node.cover.insertBefore(span('bb-book__sheen'), node.coverShade.nextSibling);
  node.print = print;
}

export function dropPrint(node: BookNode): void {
  if (!node.print) return;
  node.print.remove();
  node.cover.querySelector('.bb-book__sheen')?.remove();
  node.print = null;
}

export function describe(item: ShelfItem, index: number, count: number): string {
  const parts = [item.title];
  if (item.source) parts.push(item.source);
  parts.push(`Volume ${index + 1} of ${count}`);
  const progress = item.progress ?? 0;
  if (item.done) parts.push('Marked as read');
  else if (progress > 0) parts.push(`${Math.round(progress * 100)} percent read`);
  return parts.join('. ');
}

/** Letters the spine with a fitted title: its size, and a line break when it is set on two lines. */
export function letterSpine(node: BookNode, fit: TitleFit): void {
  const text = fit.lines.join('\n');
  if (node.words.textContent !== text) node.words.textContent = text;
  node.title.style.fontSize = `${fit.size.toFixed(2)}px`;
  node.title.dataset.lines = String(fit.lines.length);
  node.title.classList.toggle('is-clipped', fit.clipped);
}

/**
 * Adds or removes the single operable control, depending on whether this copy is the real one.
 * `hint` is the id of the text that tells how to use the row.
 */
export function setReal(node: BookNode, real: boolean, count: number, hint?: string): void {
  if (real && !node.control) {
    const control = document.createElement('button');
    control.type = 'button';
    control.className = 'bb-book__control';
    control.tabIndex = -1;
    control.setAttribute('aria-label', describe(node.item, node.index, count));
    if (hint) control.setAttribute('aria-describedby', hint);
    node.element.prepend(control);
    node.control = control;
    node.element.removeAttribute('aria-hidden');
  } else if (!real && node.control) {
    node.control.remove();
    node.control = null;
  }
  if (!real) node.element.setAttribute('aria-hidden', 'true');
}

/** Says the volume's name again after its item, its place or the length of the row has changed. */
export function relabel(node: BookNode, count: number): void {
  if (!node.control) return;
  const label = describe(node.item, node.index, count);
  if (node.control.getAttribute('aria-label') !== label) node.control.setAttribute('aria-label', label);
}
