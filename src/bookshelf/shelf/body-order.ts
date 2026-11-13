/**
 * Putting a list in order by moving as few of its members as possible. Moving an element in the document
 * takes keyboard focus off it and starts its animations again, so the row moves only the volumes that
 * really stand in the wrong place.
 */

/** The longest run of rising values in `values[from..to)`, each between `above` and `below`, as indexes. */
function longestRising(values: readonly number[], from: number, to: number, above: number, below: number): number[] {
  const length: number[] = [];
  const before: number[] = [];
  let last = -1;
  for (let index = from; index < to; index++) {
    const value = values[index]!;
    length[index] = 0;
    before[index] = -1;
    if (value <= above || value >= below) continue;
    length[index] = 1;
    for (let earlier = from; earlier < index; earlier++) {
      if (length[earlier]! > 0 && values[earlier]! < value && length[earlier]! + 1 > length[index]!) {
        length[index] = length[earlier]! + 1;
        before[index] = earlier;
      }
    }
    if (last < 0 || length[index]! > length[last]!) last = index;
  }
  const run: number[] = [];
  for (let index = last; index >= 0; index = before[index]!) run.unshift(index);
  return run;
}

/**
 * Which members of a list may stay where they are while the rest are moved to put it in order. `ranks`
 * holds, for each member in its present order, the place it should have. The result marks the largest
 * set that is already in order among itself. With `pivot`, the member at that index always stays and the
 * set is the largest that includes it.
 */
export function stayers(ranks: readonly number[], pivot = -1): boolean[] {
  const stay = ranks.map(() => false);
  const keep = (indexes: number[]): void => {
    for (const index of indexes) stay[index] = true;
  };
  if (pivot < 0 || pivot >= ranks.length) {
    keep(longestRising(ranks, 0, ranks.length, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY));
    return stay;
  }
  const held = ranks[pivot]!;
  stay[pivot] = true;
  keep(longestRising(ranks, 0, pivot, Number.NEGATIVE_INFINITY, held));
  keep(longestRising(ranks, pivot + 1, ranks.length, held, Number.POSITIVE_INFINITY));
  return stay;
}
