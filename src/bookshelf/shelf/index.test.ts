import { describe, expect, it } from 'vitest';
import * as shelf from './index';
import type { GrabStart, ItemsChange, Pose, ShelfHandle, ShelfItem } from './index';

describe('the shelf module', () => {
  it('offers a host what it needs to describe an item the way the shelf draws it', () => {
    expect(shelf.imprintOf('www.example.org').initial).toBe('E');
    expect(shelf.seriesOf('example.org', 3)).toBe(shelf.seriesOf('example.org', 3));
    expect(shelf.hashText('example')).toBe(shelf.hashText('example'));
    const outline = shelf.outlineOf('# A heading\n\nA paragraph of some length.\n\nA shorter one.');
    expect(outline.length).toBeGreaterThan(0);
    expect(outline.length).toBeLessThanOrEqual(shelf.OUTLINE_LIMIT);
    expect(shelf.COVER_ASPECT).toBeGreaterThan(0);
    expect(shelf.createCover({ id: 'one', title: 'One' }, '01', { aspect: shelf.COVER_ASPECT }).className).toContain('bb-cover');
  });

  it('offers a host what it needs to place and drag a row', () => {
    const geometry = shelf.resolveVariant('paper').geometry;
    expect(shelf.rowStands(geometry, 3, 1280)).toBe(true);
    expect(shelf.fitGeometry(geometry, 0.5).spineWidth).toBeGreaterThan(shelf.scaleGeometry(geometry, 0.5).spineWidth);
    const from = shelf.grabbedX(2, geometry, 6, 0.5);
    expect(shelf.solvePosition(from, geometry, 6, 0.5, 2)).toBeCloseTo(2, 2);
    expect(shelf.computeStandingRow(1, geometry, 4).poses).toHaveLength(4);
  });

  it('names the shapes a host passes in and gets back', () => {
    const items: ShelfItem[] = [{ id: 'one', title: 'One' }];
    const change: ItemsChange = { arrive: ['one'] };
    const start: GrabStart = { x: 0, target: null, position: 0 };
    const pose: Pose = { position: 0, open: 0, velocity: 0 };
    const handle: ShelfHandle = shelf.mountShelf(document.body.appendChild(document.createElement('div')), { items, pose });
    handle.setItems(items, change);
    expect(typeof handle.fixed).toBe('boolean');
    expect(handle.trackFrom(start)?.(10)).toBe(0);
    handle.destroy();
  });
});
