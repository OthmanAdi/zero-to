import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountShelf } from './shelf';
import type { ShelfFrame, ShelfItem } from './types';

function makeItems(count: number): ShelfItem[] {
  return Array.from({ length: count }, (_, index) => ({ id: `id-${index}`, title: `Title ${index}` }));
}

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1280);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500);
  sessionStorage.setItem('bookmark-bookshelf:arrived', '1');
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('shelf frames for a second renderer', () => {
  it('hands a new listener the current frame at once', () => {
    const shelf = mountShelf(host, { items: makeItems(5) });
    const frames: ShelfFrame[] = [];
    shelf.onFrame((frame) => frames.push(frame));
    expect(frames).toHaveLength(1);
    const frame = frames[0]!;
    expect(frame.scene).toBe(shelf.surface);
    expect(frame.width).toBe(1280);
    expect(frame.volumes.length).toBeGreaterThan(0);
    expect(frame.variant).toBe('paper');
  });

  it('reports each volume where the DOM stands it', () => {
    const shelf = mountShelf(host, { items: makeItems(5) });
    let frame: ShelfFrame | null = null;
    shelf.onFrame((next) => (frame = next));
    shelf.setPose({ position: 2, open: 0 });
    const latest = frame as ShelfFrame | null;
    expect(latest).not.toBeNull();
    const centre = latest!.volumes.find((volume) => volume.centre);
    expect(centre?.id).toBe('id-2');
    expect(centre?.angle).toBeGreaterThan(60);
    expect(centre?.element.dataset.id).toBe('id-2');
    const element = centre!.element;
    // The transform the DOM carries is the one the frame describes.
    expect(element.style.transform).toContain(`rotateY(${-centre!.angle}deg)`);
    for (const volume of latest!.volumes) {
      expect(volume.spineWidth).toBeGreaterThan(0);
      expect(volume.bookHeight).toBeGreaterThan(volume.spineWidth);
    }
  });

  it('marks the volume that is being opened as hidden', () => {
    const shelf = mountShelf(host, { items: makeItems(5) });
    let frame: ShelfFrame | null = null;
    shelf.onFrame((next) => (frame = next));
    shelf.setPose({ position: 1, open: 0.5 });
    const opened = (frame as ShelfFrame | null)!.volumes.find((volume) => volume.slot === 1);
    expect(opened?.hidden).toBe(true);
    expect((frame as ShelfFrame | null)!.open).toBe(0.5);
  });

  it('stops calling a listener that left and reports an empty shelf', () => {
    const shelf = mountShelf(host, { items: makeItems(3) });
    const frames: ShelfFrame[] = [];
    const stop = shelf.onFrame((frame) => frames.push(frame));
    shelf.setItems([]);
    expect(frames.at(-1)?.volumes).toEqual([]);
    const seen = frames.length;
    stop();
    shelf.setPose({ position: 0, open: 0 });
    expect(frames).toHaveLength(seen);
  });
});
