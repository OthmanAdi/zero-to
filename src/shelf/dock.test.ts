import { afterEach, describe, expect, it, vi } from 'vitest';
import { createManualClock, type ManualClock } from '../bookshelf/motion';
import { resourcesFor } from '../roadmap/derive';
import { sampleRoadmap } from '../roadmap/testing';
import type { Roadmap } from '../roadmap/types';
import { createShelfDock } from './dock';
import { fixtureResource, fixtureResources, fixtureRoadmap } from './fixtures';
import { createMemorySession, type MemoryShelfSession } from './memory-session';
import type { ShelfDock, ShelfDockOptions } from './types';

let dock: ShelfDock | null = null;

afterEach(() => {
  dock?.destroy();
  dock = null;
  document.body.replaceChildren();
  document.documentElement.className = '';
  delete document.documentElement.dataset.variant;
});

interface Setup {
  dock: ShelfDock;
  session: MemoryShelfSession;
  clock: ManualClock;
  host: HTMLElement;
  roadmap: Roadmap;
}

function setup(roadmap: Roadmap = fixtureRoadmap(), options: ShelfDockOptions = {}): Setup {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const session = createMemorySession(roadmap);
  const clock = createManualClock();
  dock = createShelfDock(host, session, { ui: 'en', clock, phoneQuery: '(max-width: 1px)', ...options });
  return { dock, session, clock, host, roadmap };
}

const controls = (root: ParentNode): HTMLButtonElement[] => [...root.querySelectorAll<HTMLButtonElement>('button.bb-book__control')];
const control = (root: ParentNode, id: string): HTMLButtonElement =>
  root.querySelector<HTMLButtonElement>(`li.bb-book[data-id="${id}"]:not([aria-hidden]) button.bb-book__control`)!;
const key = (target: Element, name: string): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
};

async function openAndSettle(s: Setup, id: string): Promise<HTMLElement> {
  const opening = s.dock.open(id);
  s.clock.advance(1200);
  await opening;
  return document.querySelector<HTMLElement>('.bb-reader')!;
}

describe('the dock', () => {
  it('stands a stage of three volumes still, one native button each, under a header that counts them', () => {
    const s = setup(sampleRoadmap());
    const entries = resourcesFor(s.roadmap, s.roadmap.stages[0]!.id);
    expect(entries.length).toBe(4);
    s.dock.setEntries(entries.slice(0, 3));
    const shelf = s.host.querySelector('.bb-shelf')!;
    expect(controls(s.host)).toHaveLength(3);
    expect(shelf.getAttribute('data-fixed')).toBe('1');
    expect(shelf.getAttribute('data-loop')).toBe('0');
    expect(s.host.querySelector('.zt-dock__header')!.textContent).toBe('3 sources · opened 2026-11-13');
    expect(s.dock.presented).toBe(entries[0]!.resource.id);
  });

  it('changes the presented volume with Right and Left on the row, and with the arrow buttons', () => {
    const s = setup(sampleRoadmap(), { reducedMotion: true });
    const entries = resourcesFor(s.roadmap, s.roadmap.stages[0]!.id).slice(0, 3);
    s.dock.setEntries(entries);
    const ids = entries.map((entry) => entry.resource.id);
    key(control(s.host, ids[0]!), 'ArrowRight');
    s.clock.advance(50);
    expect(s.dock.presented).toBe(ids[1]);
    key(control(s.host, ids[1]!), 'ArrowRight');
    s.clock.advance(50);
    expect(s.dock.presented).toBe(ids[2]);
    key(control(s.host, ids[2]!), 'ArrowLeft');
    s.clock.advance(50);
    expect(s.dock.presented).toBe(ids[1]);
    s.host.querySelector<HTMLButtonElement>('.zt-dock__arrow--prev')!.click();
    s.clock.advance(50);
    expect(s.dock.presented).toBe(ids[0]);
    expect(s.host.querySelector('.zt-dock__arrow--prev')!.getAttribute('aria-disabled')).toBe('true');
  });

  it('presents the volume it is asked to, and keeps the row when only that changes', () => {
    const s = setup(fixtureRoadmap(), { reducedMotion: true });
    const entries = resourcesFor(s.roadmap, 'fixture-stage');
    s.dock.setEntries(entries, 'fixture-article');
    expect(s.dock.presented).toBe('fixture-article');
    const before = s.host.querySelector('li.bb-book[data-id="fixture-docs"]');
    s.dock.setEntries(entries, 'fixture-tool');
    s.clock.advance(50);
    expect(s.dock.presented).toBe('fixture-tool');
    expect(s.host.querySelector('li.bb-book[data-id="fixture-docs"]')).toBe(before);
  });

  it('writes the caption: title, why and the status line, with the marked state named', () => {
    const s = setup(fixtureRoadmap(), { reducedMotion: true });
    s.dock.setEntries(resourcesFor(s.roadmap, 'fixture-stage'), 'fixture-course');
    const caption = s.host.querySelector('.zt-dock__caption')!;
    expect(caption.querySelector('.zt-dock__title')!.textContent).toBe('Fixture course behind a login');
    expect(caption.querySelector('.zt-dock__why')!.textContent).toContain('made-up course entry');
    const status = caption.querySelector<HTMLElement>('.zt-dock__status')!;
    expect(status.textContent).toBe('behind a login · opened 2026-11-13');
    expect(status.dataset.status).toBe('gated');
    expect(s.host.querySelector('.zt-dock__header')!.textContent).toBe('10 sources · opened 2026-11-13 · 1 gated · 1 unverified');
  });

  it('dims to six tenths of its light and comes back to full', () => {
    const s = setup();
    const root = s.dock.element;
    s.dock.setLit(0);
    expect(root.style.getPropertyValue('--zt-shelf-lit')).toBe('0');
    expect(root.dataset.lit).toBe('dim');
    s.dock.setLit(4);
    expect(root.style.getPropertyValue('--zt-shelf-lit')).toBe('1');
    expect(root.dataset.lit).toBe('full');
  });
});

describe('the reader page of a volume', () => {
  it('shows title, by, why, type, cost and price with the day, the status sentence, the task and the actions', async () => {
    const s = setup(fixtureRoadmap(), { reducedMotion: true });
    s.dock.setEntries(resourcesFor(s.roadmap, 'fixture-stage'), 'fixture-course');
    const reader = await openAndSettle(s, 'fixture-course');
    expect(reader.getAttribute('role')).toBe('dialog');
    expect(reader.dataset.open).toBe('1');
    const text = reader.textContent ?? '';
    expect(reader.querySelector('.bb-reader__title')!.textContent).toBe('Fixture course behind a login');
    expect(reader.querySelector('.bb-reader__byline')!.textContent).toBe('Fixture author');
    expect(reader.querySelector('.bb-reader__note')!.textContent).toContain('made-up course entry');
    expect(text).toContain('Course · Silver level · in English');
    expect(text).toContain('Paid: €29 a month, price seen on 2026-11-12.');
    expect(text).toContain('Reachable on 2026-11-13, but the content sits behind a login or paywall.');
    expect(text).toContain('Fixture step 2');
    expect(text).toContain('read what it prints');
    expect(reader.querySelector('.bb-reader__example')!.textContent).toContain('zero-to wrote this page from the roadmap entry');
    expect(reader.querySelector('code')!.textContent).toBe('fixture --check');

    const original = reader.querySelector<HTMLAnchorElement>('a.bb-reader__open')!;
    expect(original.textContent).toContain('Open original');
    expect(original.getAttribute('href')).toBe('https://example.org/course');
    expect(original.rel.split(' ')).toContain('noopener');
    expect(original.target).toBe('_blank');

    expect(reader.querySelector('.zt-reader__pin')!.textContent).toContain('Pin to notebook');
    expect(reader.querySelector('.bb-reader__done')!.textContent).toBe('Mark as used');
    expect(reader.querySelector('.bb-reader__notes-field')).not.toBeNull();
    expect(reader.closest('.zt-shelf-layer')).not.toBeNull();
    expect(document.documentElement.classList.contains('zt-reading')).toBe(true);
  });

  it('never turns a javascript: address into a link', async () => {
    const resources = [fixtureResource('docs', { url: 'javascript:alert(1)' }), ...fixtureResources().slice(1, 3)];
    const s = setup(fixtureRoadmap(resources), { reducedMotion: true });
    s.dock.setEntries(resourcesFor(s.roadmap, 'fixture-stage'));
    const reader = await openAndSettle(s, 'fixture-docs');
    const original = reader.querySelector('.bb-reader__open')!;
    expect(original.hasAttribute('href')).toBe(false);
    expect(original.getAttribute('aria-disabled')).toBe('true');
    const hrefs = [...document.querySelectorAll('[href]')].map((node) => node.getAttribute('href') ?? '');
    expect(hrefs.some((href) => /^\s*javascript:/i.test(href))).toBe(false);
  });

  it('pins to the notebook, marks as used and keeps the note, all through the session', async () => {
    const s = setup(fixtureRoadmap(), { reducedMotion: true });
    s.dock.setEntries(resourcesFor(s.roadmap, 'fixture-stage'));
    const reader = await openAndSettle(s, 'fixture-docs');

    const pin = reader.querySelector<HTMLButtonElement>('.zt-reader__pin')!;
    expect(pin.getAttribute('aria-pressed')).toBe('false');
    pin.click();
    expect(s.session.isPinned('fixture-docs')).toBe(true);
    expect(s.session.pins[0]).toMatchObject({ kind: 'link', url: 'https://example.org/docs', stageId: 'fixture-stage', waypointId: 'fixture-step-1' });
    expect(pin.getAttribute('aria-pressed')).toBe('true');
    pin.click();
    expect(s.session.isPinned('fixture-docs')).toBe(false);

    reader.querySelector<HTMLButtonElement>('.bb-reader__done')!.click();
    expect(s.session.isUsed('fixture-docs')).toBe(true);
    const name = control(s.host, 'fixture-docs').getAttribute('aria-label') ?? control(s.host, 'fixture-docs').textContent ?? '';
    expect(name).toContain('Marked as read');

    const field = reader.querySelector<HTMLTextAreaElement>('.bb-reader__notes-field')!;
    field.value = 'Chapter 3 was the useful one.';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    const closing = s.dock.close();
    s.clock.advance(1200);
    await closing;
    expect(s.session.note('fixture-docs')).toBe('Chapter 3 was the useful one.');
  });

  it('closes on Escape and gives focus back to the volume that opened it', async () => {
    const s = setup(fixtureRoadmap(), { reducedMotion: true });
    s.dock.setEntries(resourcesFor(s.roadmap, 'fixture-stage'), 'fixture-book');
    const opener = control(s.host, 'fixture-book');
    opener.focus();
    // What Enter or Space on the native button does: a click with no pointer behind it.
    opener.click();
    s.clock.advance(1200);
    await vi.waitFor(() => expect(document.querySelector('.bb-reader')?.getAttribute('data-open')).toBe('1'));
    expect(s.dock.isOpen).toBe(true);
    const reader = document.querySelector<HTMLElement>('.bb-reader')!;
    key(reader, 'Escape');
    s.clock.advance(1200);
    await vi.waitFor(() => expect(document.querySelector('.bb-reader')).toBeNull());
    expect(s.dock.isOpen).toBe(false);
    expect(document.activeElement).toBe(control(s.host, 'fixture-book'));
    expect(document.documentElement.classList.contains('zt-reading')).toBe(false);
  });

  it('opens nothing for an id that is not on the shelf', async () => {
    const s = setup();
    s.dock.setEntries(resourcesFor(s.roadmap, 'fixture-step-1'));
    await s.dock.open('fixture-video');
    expect(document.querySelector('.bb-reader')).toBeNull();
  });
});

describe('the phone sheet', () => {
  it('is a round button named after the count that opens and shuts the sheet, and Escape gives focus back', async () => {
    const s = setup(fixtureRoadmap(), { reducedMotion: true, phoneQuery: '(min-width: 1px)' });
    s.dock.setEntries(resourcesFor(s.roadmap, 'fixture-stage').slice(0, 5));
    const root = s.dock.element;
    expect(root.dataset.mode).toBe('phone');
    const toggle = root.querySelector<HTMLButtonElement>('.zt-dock__toggle')!;
    expect(toggle.hidden).toBe(false);
    expect(toggle.textContent).toContain('Sources (5)');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const panel = root.querySelector<HTMLElement>('.zt-dock__panel')!;
    expect(panel.hasAttribute('inert')).toBe(true);

    toggle.click();
    expect(root.dataset.sheet).toBe('open');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(panel.hasAttribute('inert')).toBe(false);
    expect(controls(panel)).toHaveLength(5);

    key(control(panel, 'fixture-docs'), 'Escape');
    expect(root.dataset.sheet).toBe('closed');
    expect(document.activeElement).toBe(toggle);
  });
});

describe('cleaning up', () => {
  it('removes the dock, the reader layer and the look it put on the page', async () => {
    const s = setup(fixtureRoadmap(), { reducedMotion: true });
    s.dock.setEntries(resourcesFor(s.roadmap, 'fixture-stage'));
    expect(document.documentElement.dataset.variant).toBe('night');
    await openAndSettle(s, 'fixture-docs');
    s.dock.destroy();
    dock = null;
    expect(document.querySelector('.zt-dock')).toBeNull();
    expect(document.querySelector('.zt-shelf-layer')).toBeNull();
    expect(document.documentElement.dataset.variant).toBeUndefined();
  });
});
