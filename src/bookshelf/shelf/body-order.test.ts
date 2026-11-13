import { describe, expect, it } from 'vitest';
import { stayers } from './body-order';

/** How many members have to be moved to put the list in order. */
function moves(ranks: number[], pivot?: number): number {
  return stayers(ranks, pivot).filter((kept) => !kept).length;
}

describe('stayers', () => {
  it('moves nothing in a list that is in order', () => {
    expect(stayers([0, 1, 2, 3])).toEqual([true, true, true, true]);
    expect(stayers([])).toEqual([]);
    expect(stayers([7])).toEqual([true]);
  });

  it('moves only the one member that stands in the wrong place', () => {
    // One member that belongs at the end stands in the middle: the others must not be moved around it.
    expect(stayers([0, 1, 9, 2, 3, 4])).toEqual([true, true, false, true, true, true]);
    // A new first member stands at the end.
    expect(stayers([1, 2, 3, 4, 0])).toEqual([true, true, true, true, false]);
  });

  it('keeps the largest set that is in order among itself', () => {
    const ranks = [3, 0, 1, 2, 7, 4, 5, 6];
    const stay = stayers(ranks);
    expect(stay.filter(Boolean)).toHaveLength(6);
    const kept = ranks.filter((_, index) => stay[index]);
    expect(kept).toEqual([...kept].sort((one, other) => one - other));
  });

  it('never moves the pivot, and keeps what is in order around it', () => {
    const ranks = [1, 2, 3, 4, 0];
    const stay = stayers(ranks, 4);
    // The member that belongs first is held where it is, so everything before it has to move after it.
    expect(stay).toEqual([false, false, false, false, true]);
    expect(stayers([0, 5, 1, 2, 3, 4], 1)).toEqual([true, true, false, false, false, false]);
    expect(stayers([0, 1, 2, 3], 2)).toEqual([true, true, true, true]);
  });

  it('keeps kept members in order on either side of the pivot', () => {
    const ranks = [4, 0, 6, 1, 3, 2, 5, 8, 7];
    for (let pivot = 0; pivot < ranks.length; pivot++) {
      const stay = stayers(ranks, pivot);
      expect(stay[pivot]).toBe(true);
      const kept = ranks.filter((_, index) => stay[index]);
      expect(kept).toEqual([...kept].sort((one, other) => one - other));
    }
  });

  it('ignores a pivot that is not in the list', () => {
    expect(stayers([1, 0, 2], 9)).toEqual(stayers([1, 0, 2]));
    expect(moves([2, 0, 1])).toBe(1);
    expect(moves([2, 0, 1], 0)).toBe(2);
  });
});
