import { describe, expect, it } from 'vitest';
import {
  blendPose,
  computeRow,
  computeStandingRow,
  easeTravel,
  extentOf,
  fitGeometry,
  focusWeight,
  gapWeight,
  giveOf,
  grabbedX,
  LOOP_FILL,
  pitchAt,
  presentedReach,
  pullOf,
  READABLE_SPINE_PX,
  restLength,
  restPitch,
  rowLoops,
  rowStands,
  samePose,
  scaleGeometry,
  settleOf,
  solvePosition,
  swayOf,
  swayShare,
  visibleRange,
  volumeSize,
  type SizeOf,
} from './layout';
import { VARIANTS } from './variants';
import type { Geometry } from './types';

const paper = VARIANTS.paper!.geometry;
const night = VARIANTS.night!.geometry;
const WIDTH = 1280;

function xs(position: number, geometry: Geometry, reach = 6): number[] {
  const base = Math.round(position);
  return computeRow(position, geometry, base - reach, base + reach).map((pose) => pose.x);
}

function poseAt(position: number, geometry: Geometry, slot: number) {
  const pose = computeRow(position, geometry, slot, slot)[0];
  if (!pose) throw new Error(`no pose for slot ${slot}`);
  return pose;
}

describe('focusWeight', () => {
  it('is 1 at the slot and 0 one slot away or further', () => {
    expect(focusWeight(4, 4)).toBe(1);
    expect(focusWeight(4, 5)).toBe(0);
    expect(focusWeight(4, 3)).toBe(0);
    expect(focusWeight(4, 9)).toBe(0);
  });

  it('is symmetric around the slot', () => {
    for (const offset of [0.1, 0.25, 0.5, 0.9]) {
      expect(focusWeight(4 + offset, 4)).toBeCloseTo(focusWeight(4 - offset, 4), 12);
    }
  });

  it('is the same for both slots half way between them, and less than half', () => {
    expect(focusWeight(2.5, 2)).toBe(focusWeight(2.5, 3));
    expect(focusWeight(2.5, 2)).toBeGreaterThan(0);
    expect(focusWeight(2.5, 2)).toBeLessThan(0.5);
  });

  it('finishes the turn before the next slot is reached', () => {
    expect(focusWeight(4.78, 4)).toBe(0);
    expect(focusWeight(4.77, 4)).toBeGreaterThan(0);
  });
});

describe('gapWeight', () => {
  it('starts making room before the turn starts', () => {
    expect(gapWeight(4.8, 4)).toBeGreaterThan(0);
    expect(focusWeight(4.8, 4)).toBe(0);
    expect(gapWeight(4.9, 4)).toBe(0);
    expect(gapWeight(4, 4)).toBe(1);
  });
});

describe('computeRow', () => {
  it.each([
    ['paper', paper],
    ['night', night],
  ])('centres the turned volume on 0 at an integer position (%s)', (_name, geometry) => {
    const centre = poseAt(3, geometry, 3);
    expect(centre.weight).toBe(1);
    expect(centre.angle).toBe(geometry.focusAngle);
    const drawn = corners(centre, geometry);
    const xs = [drawn.leftFoot.x, drawn.rightFoot.x, drawn.leftHead.x, drawn.rightHead.x];
    // Within a pixel: a leaning volume is a hair narrower at its foot than the room it is given.
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(0, 0);
  });

  it('leaves volumes away from the centre unturned, unleaned and unlifted', () => {
    const resting = poseAt(3, paper, 6);
    expect(resting.weight).toBe(0);
    expect(resting.angle).toBe(0);
    expect(resting.lean).toBeCloseTo(0, 12);
    expect(resting.lift).toBe(0);
    expect(resting.z).toBe(0);
  });

  it('keeps x strictly increasing along the row at any position', () => {
    for (const position of [0, 0.2, 0.5, 0.77, 3, 3.5, -2.3, 41.9]) {
      const row = xs(position, paper);
      for (let index = 1; index < row.length; index++) {
        expect(row[index]!).toBeGreaterThan(row[index - 1]!);
      }
    }
  });

  it('spaces neighbours by restPitch away from the centre', () => {
    const row = computeRow(5, paper, 0, 10);
    const pitch = restPitch(paper);
    for (let slot = 7; slot < 10; slot++) {
      expect(row[slot + 1]!.x - row[slot]!.x).toBeCloseTo(pitch, 9);
    }
    for (let slot = 3; slot > 0; slot--) {
      expect(row[slot]!.x - row[slot - 1]!.x).toBeCloseTo(pitch, 9);
    }
  });

  it('gives both slots equal weight and angle half way between them', () => {
    const left = poseAt(2.5, paper, 2);
    const right = poseAt(2.5, paper, 3);
    expect(left.weight).toBe(right.weight);
    expect(left.angle).toBe(right.angle);
    expect(left.lean).toBe(right.lean);
  });

  it.each(Object.entries(VARIANTS))(
    'keeps the far row rigid while a volume passes the centre (%s)',
    (_name, variant) => {
      const geometry = variant.geometry;
      const pitch = restPitch(geometry);
      for (const offset of [4, -4]) {
        const start = poseAt(3, geometry, 3 + offset).x;
        let previous = start;
        let backwards = 0;
        let worst = 0;
        for (let step = 1; step <= 200; step++) {
          const position = 3 + step / 200;
          const x = poseAt(position, geometry, 3 + offset).x;
          backwards = Math.max(backwards, x - previous);
          worst = Math.max(worst, Math.abs(x - (start - pitch * (position - 3))));
          previous = x;
        }
        // It only ever moves against the travel, as one rigid strip with the position.
        expect(backwards).toBeLessThanOrEqual(1e-9);
        expect(worst).toBeLessThan(0.5);
      }
    },
  );

  it('moves smoothly: a tiny change in position gives a tiny change in every x', () => {
    const epsilon = 1e-6;
    const positions = [0, 0.25, 0.5, 0.999999, 1, 1.5, 1.999999, 2.000001, 7.3];
    for (const position of positions) {
      const before = computeRow(position, paper, -4, 12);
      const after = computeRow(position + epsilon, paper, -4, 12);
      for (let index = 0; index < before.length; index++) {
        expect(Math.abs(after[index]!.x - before[index]!.x)).toBeLessThan(0.01);
        expect(Math.abs(after[index]!.angle - before[index]!.angle)).toBeLessThan(0.01);
      }
    }
  });

  it('returns one pose per slot in the requested range', () => {
    const row = computeRow(0, paper, -2, 4);
    expect(row.map((pose) => pose.slot)).toEqual([-2, -1, 0, 1, 2, 3, 4]);
  });

  it('applies lift and push in proportion to weight', () => {
    const centre = poseAt(1, night, 1);
    expect(centre.lift).toBe(night.focusLift);
    expect(centre.z).toBe(night.focusPush);
    const part = poseAt(1.3, night, 1);
    expect(part.lift).toBeCloseTo(night.focusLift * part.weight, 9);
    expect(part.z).toBeCloseTo(night.focusPush * part.weight, 9);
  });
});

/** Screen corners of a volume drawn as the shelf draws it, without perspective. Up is negative y. */
function corners(pose: ReturnType<typeof poseAt>, geometry: Geometry) {
  const a = (pose.angle * Math.PI) / 180;
  const t = (pose.lean * Math.PI) / 180;
  const leftFoot = -(geometry.spineWidth / 2) * Math.cos(a);
  const rightFoot = (geometry.spineWidth / 2) * Math.cos(a) + geometry.coverWidth * Math.sin(a);
  const place = (u: number, v: number) => {
    const du = u - pose.corner;
    return { x: pose.x + pose.corner + du * Math.cos(t) - v * Math.sin(t), y: du * Math.sin(t) + v * Math.cos(t) };
  };
  return {
    leftFoot: place(leftFoot, 0),
    rightFoot: place(rightFoot, 0),
    leftHead: place(leftFoot, -geometry.bookHeight),
    rightHead: place(rightFoot, -geometry.bookHeight),
  };
}

describe('the presented pose', () => {
  it.each([-5, -4.4, -2, 3, 5])('keeps both feet on or above the floor at a lean of %s degrees', (lean) => {
    for (const focusAngle of [84, 90]) {
      const geometry = { ...paper, focusLean: lean, focusAngle };
      for (const position of [3, 3.1, 3.3, 3.5]) {
        const feet = corners(poseAt(position, geometry, 3), geometry);
        expect(feet.leftFoot.y).toBeLessThanOrEqual(1e-9);
        expect(feet.rightFoot.y).toBeLessThanOrEqual(1e-9);
        expect(Math.max(feet.leftFoot.y, feet.rightFoot.y)).toBeGreaterThan(-1e-9);
      }
    }
  });

  it.each([
    ['paper', -4.4],
    ['oak', -2],
    ['pocket', 3],
  ])('rests the head of the presented volume on its neighbour (%s)', (name, lean) => {
    const geometry = { ...VARIANTS[name]!.geometry, focusLean: lean, focusAngle: 84 };
    const centre = corners(poseAt(5, geometry, 5), geometry);
    if (lean < 0) {
      const neighbour = poseAt(5, geometry, 4);
      expect(Math.abs(centre.leftHead.x - (neighbour.x + geometry.spineWidth / 2))).toBeLessThan(1);
    } else {
      const neighbour = poseAt(5, geometry, 6);
      expect(Math.abs(centre.rightHead.x - (neighbour.x - geometry.spineWidth / 2))).toBeLessThan(1);
    }
  });

  it('never lets two volumes overlap while one passes the centre', () => {
    for (const name of Object.keys(VARIANTS)) {
      const geometry = { ...VARIANTS[name]!.geometry, focusAngle: 84 };
      for (let step = 0; step <= 40; step++) {
        const position = 2 + step / 40;
        const row = computeRow(position, geometry, 0, 5).map((pose) => corners(pose, geometry));
        for (let index = 1; index < row.length; index++) {
          const before = row[index - 1]!;
          const after = row[index]!;
          // Compare at the foot and at the head, where a lean brings two volumes closest.
          expect(Math.min(after.leftFoot.x, after.leftHead.x)).toBeGreaterThan(
            Math.max(before.rightFoot.x, before.rightHead.x) - 1,
          );
        }
      }
    }
  });
});

describe('volumeSize', () => {
  it('keeps the look size when an item carries no size', () => {
    expect(volumeSize(paper)).toEqual({ spineWidth: 58, bookHeight: 340, coverWidth: 206 });
  });

  it('makes a bare link a slim pamphlet and a long text a thick book', () => {
    expect(volumeSize(paper, 0).spineWidth).toBeCloseTo(58 * 0.62, 9);
    expect(volumeSize(paper, 1).spineWidth).toBeCloseTo(58 * 1.22, 9);
  });

  it('never lets a spine get narrower than 30 px', () => {
    expect(volumeSize(scaleGeometry(paper, 0.5), 0).spineWidth).toBe(30);
  });

  it('keeps one cover aspect for every height', () => {
    const short = volumeSize(paper, undefined, 0);
    expect(short.bookHeight).toBeCloseTo(306, 9);
    expect(short.coverWidth / short.bookHeight).toBeCloseTo(paper.coverWidth / paper.bookHeight, 12);
  });
});

describe('computeRow with mixed sizes', () => {
  const mixed = (slot: number) =>
    volumeSize(paper, [0, 0.9, 0.3, 1, 0.1][((slot % 5) + 5) % 5], [1, 0, 0.5][((slot % 3) + 3) % 3]);

  it('draws the same row as before when every size is the look size', () => {
    const plain = computeRow(2.37, paper, -4, 9);
    const sized = computeRow(2.37, paper, -4, 9, () => volumeSize(paper));
    expect(sized).toEqual(plain);
  });

  it('centres the presented volume on 0 with its own size', () => {
    const size = mixed(3);
    const centre = computeRow(3, paper, 3, 3, mixed)[0]!;
    const drawn = corners(centre, { ...paper, ...size });
    const xs = [drawn.leftFoot.x, drawn.rightFoot.x, drawn.leftHead.x, drawn.rightHead.x];
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(0, 0);
  });

  it('keeps volumes in order and each far strip rigid, moving at the local pitch on average', () => {
    for (const start of [0, 3, -2]) {
      const first = computeRow(start, paper, start - 6, start + 7, mixed);
      const last = computeRow(start + 1, paper, start - 6, start + 7, mixed);
      const ends = [0, first.length - 1];
      const travel = ends.map((index) => first[index]!.x - last[index]!.x);
      expect((travel[0]! + travel[1]!) / 2).toBeCloseTo(pitchAt(start + 0.5, paper, mixed), 6);
      for (let step = 1; step < 50; step++) {
        const position = start + step / 50;
        const row = computeRow(position, paper, start - 6, start + 7, mixed);
        for (let index = 1; index < row.length; index++) expect(row[index]!.x).toBeGreaterThan(row[index - 1]!.x);
        ends.forEach((index, end) => {
          expect(row[index]!.x).toBeCloseTo(first[index]!.x - travel[end]! * (position - start), 6);
        });
      }
    }
  });

  it('gives the rest pitch for one size and a local pitch for mixed sizes', () => {
    expect(pitchAt(4.2, paper)).toBeCloseTo(restPitch(paper), 9);
    expect(pitchAt(4.2, paper, mixed)).not.toBeCloseTo(restPitch(paper), 3);
  });
});

describe('a row that stands still', () => {
  const mixedFor =
    (geometry: Geometry): SizeOf =>
    (slot) =>
      volumeSize(geometry, [0, 0.9, 0.3, 1, 0.1][((slot % 5) + 5) % 5], [1, 0, 0.5][((slot % 3) + 3) % 3]);
  const mixed = mixedFor(paper);
  const looks = Object.entries(VARIANTS).map(([name, variant]) => [name, variant.geometry] as const);

  /** Leftmost and rightmost drawn point of every volume in a standing row. */
  function drawn(position: number, geometry: Geometry, count: number, sizeOf?: SizeOf): Array<[number, number]> {
    return computeStandingRow(position, geometry, count, sizeOf).poses.map((pose) => {
      const at = corners(pose, { ...geometry, ...sizeOf?.(pose.slot) });
      const xs = [at.leftFoot.x, at.rightFoot.x, at.leftHead.x, at.rightHead.x];
      return [Math.min(...xs), Math.max(...xs)];
    });
  }

  it.each(looks)('keeps its two ends the same distance from the centre wherever the focus is (%s)', (_name, geometry) => {
    for (const count of [1, 2, 3, 6, 15]) {
      for (const sizeOf of [undefined, mixedFor(geometry)]) {
        for (let step = 0; step <= (count - 1) * 20; step++) {
          const row = drawn(step / 20, geometry, count, sizeOf);
          expect(Math.abs(row[0]![0] + row[count - 1]![1])).toBeLessThan(2);
        }
      }
    }
  });

  it('reports the ends it centred', () => {
    const row = computeStandingRow(2.3, paper, 6, mixed);
    expect(row.left).toBeCloseTo(-row.right, 9);
    expect(row.poses.map((pose) => pose.slot)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(computeStandingRow(0, paper, 0)).toEqual({ poses: [], left: 0, right: 0, origin: 0 });
  });

  it('says where the presented volume stands, moving evenly along the row with the focus', () => {
    let previous = Number.NEGATIVE_INFINITY;
    for (let step = 0; step <= 100; step++) {
      const position = step / 20;
      const { origin } = computeStandingRow(position, paper, 6, mixed);
      expect(origin).toBeGreaterThan(previous);
      previous = origin;
      if (Number.isInteger(position)) {
        const [left, right] = drawn(position, paper, 6, mixed)[position]!;
        expect((left + right) / 2).toBeCloseTo(origin, 0);
      }
    }
  });

  it('measures how far a leaning volume reaches below a given height', () => {
    const pose = computeStandingRow(0, paper, 4).poses[0]!;
    expect(pose.lean).toBeLessThan(0);
    const [headLeft, right] = extentOf(pose, paper);
    const [lowLeft, lowRight] = extentOf(pose, paper, paper.bookHeight * 0.5);
    // Leaning left, it reaches about half as far at half its height, and its right side is its foot either way.
    expect(lowLeft - headLeft).toBeCloseTo((paper.bookHeight * Math.sin((4.4 * Math.PI) / 180)) / 2, 0);
    expect(lowRight).toBe(right);
    expect(extentOf(pose, paper, 0)[0]).toBeGreaterThan(lowLeft);
    expect(extentOf(pose, paper, paper.bookHeight * 3)[0]).toBe(headLeft);
  });

  it('turns the presented volume where it stands: the far volumes hardly move', () => {
    const before = computeStandingRow(2, paper, 7).poses;
    for (let step = 0; step <= 20; step++) {
      const row = computeStandingRow(2 + step / 20, paper, 7).poses;
      for (const slot of [0, 1, 4, 5, 6]) expect(Math.abs(row[slot]!.x - before[slot]!.x)).toBeLessThanOrEqual(paper.gap);
    }
  });

  it('stays where it is for a position past either end', () => {
    expect(computeStandingRow(-0.4, paper, 5).poses).toEqual(computeStandingRow(0, paper, 5).poses);
    expect(computeStandingRow(9, paper, 5).poses).toEqual(computeStandingRow(4, paper, 5).poses);
  });

  it.each(looks)('never lets a volume leave the scene, presented or not (%s)', (_name, base) => {
    let standing = 0;
    for (const width of [320, 390, 768, 1280, 1920]) {
      for (const factor of [0.5, 1, 1.5]) {
        const geometry = scaleGeometry(base, factor);
        for (const sizeOf of [undefined, mixedFor(geometry)]) {
          for (const count of [1, 2, 3, 4, 6, 9, 13, 18, 24, 31, 40]) {
            if (!rowStands(geometry, count, width, sizeOf)) continue;
            standing++;
            expect(restLength(geometry, count, sizeOf)).toBeLessThan(LOOP_FILL * width);
            let reach = 0;
            for (let step = 0; step <= (count - 1) * 4; step++) {
              for (const [left, right] of drawn(step / 4, geometry, count, sizeOf)) reach = Math.max(reach, -left, right);
            }
            expect(reach).toBeLessThanOrEqual(width / 2);
          }
        }
      }
    }
    expect(standing).toBeGreaterThan(20);
  });

  it('travels instead once its volumes at rest fill four fifths of the scene', () => {
    const pitch = restPitch(paper);
    expect(rowStands(paper, Math.ceil((0.8 * 1280) / pitch), 1280)).toBe(false);
    expect(rowStands(paper, Math.ceil((0.8 * 1280) / pitch) - 4, 1280)).toBe(true);
    expect(rowStands(paper, 3, 1280)).toBe(true);
    expect(rowStands(paper, 400, 1280)).toBe(false);
  });

  it('travels when the row would not fit with one volume presented, or with the room asked for at its ends', () => {
    // Three resting spines fit a narrow scene; the turned cover does not fit beside them.
    expect(restLength(paper, 3)).toBeLessThan(0.8 * 300);
    expect(rowStands(paper, 3, 300)).toBe(false);
    expect(rowStands(paper, 6, 640)).toBe(true);
    expect(rowStands(paper, 6, 640, undefined, 60)).toBe(false);
  });

  it('counts an empty row as standing', () => {
    expect(rowStands(paper, 0, 1280)).toBe(true);
  });
});

describe('dragging the row by a volume', () => {
  const looks = Object.entries(VARIANTS).map(([name, variant]) => [name, variant.geometry] as const);
  const mixedFor =
    (geometry: Geometry): SizeOf =>
    (slot) =>
      volumeSize(geometry, [0, 0.9, 0.3, 1, 0.1][((slot % 5) + 5) % 5], [1, 0, 0.5][((slot % 3) + 3) % 3]);

  it.each(looks)('keeps the grabbed volume under the pointer to within a pixel (%s)', (_name, geometry) => {
    const pitch = restPitch(geometry);
    let worst = 0;
    for (const sizeOf of [undefined, mixedFor(geometry)]) {
      for (const start of [3, 3.3, 3.5, 7.9, -2.4]) {
        // Any volume: the presented one, its neighbours and ones far along the row.
        for (const offset of [-5, -2, -1, 0, 1, 2, 5]) {
          const slot = Math.round(start) + offset;
          for (const share of [0, 0.3, 0.5, 1]) {
            const from = grabbedX(start, geometry, slot, share, sizeOf);
            for (let step = -10; step <= 10; step++) {
              const pointer = from + (step / 5) * pitch;
              const position = solvePosition(pointer, geometry, slot, share, start, sizeOf);
              worst = Math.max(worst, Math.abs(grabbedX(position, geometry, slot, share, sizeOf) - pointer));
            }
          }
        }
      }
    }
    expect(worst).toBeLessThan(1);
  });

  it('leaves the row where it is for a pointer that has not moved', () => {
    for (const start of [3, 3.4, 8.75]) {
      const from = grabbedX(start, paper, 5, 0.5);
      expect(solvePosition(from, paper, 5, 0.5, start)).toBeCloseTo(start, 2);
    }
  });

  it('moves the row with the hand: pulling right brings earlier volumes to the centre', () => {
    const from = grabbedX(4, paper, 8, 0.5);
    expect(solvePosition(from + restPitch(paper), paper, 8, 0.5, 4)).toBeCloseTo(3, 1);
    expect(solvePosition(from - 2 * restPitch(paper), paper, 8, 0.5, 4)).toBeCloseTo(6, 1);
  });

  it('follows a slow hand without a jump, even through the turn of the grabbed volume', () => {
    for (const [, geometry] of looks) {
      for (const slot of [3, 4]) {
        const from = grabbedX(3, geometry, slot, 0.4);
        let previous = 3;
        for (let travel = 2; travel <= 300; travel += 2) {
          const position = solvePosition(from - travel, geometry, slot, 0.4, previous);
          expect(position).toBeGreaterThan(previous - 1e-6);
          expect(position - previous).toBeLessThan(0.12);
          previous = position;
        }
      }
    }
  });

  it('finds the answer from a poor first guess', () => {
    const from = grabbedX(20, paper, 22, 0.5);
    expect(solvePosition(from, paper, 22, 0.5, 3)).toBeCloseTo(20, 1);
    expect(solvePosition(from, paper, 22, 0.5, 41)).toBeCloseTo(20, 1);
  });
});

describe('a standing row under a pull', () => {
  it('follows the hand at first, then less and less, and never past its limit', () => {
    expect(giveOf(0, 28, 90)).toBe(0);
    expect(giveOf(9, 28, 90)).toBeCloseTo(9 * (28 / 90), 0);
    let previous = 0;
    for (let travel = 10; travel <= 2000; travel += 10) {
      const give = giveOf(travel, 28, 90);
      expect(give).toBeGreaterThan(previous);
      expect(give - previous).toBeLessThan(10 * (28 / 90));
      expect(give).toBeLessThanOrEqual(28);
      previous = give;
    }
    expect(giveOf(2000, 28, 90)).toBeCloseTo(28, 3);
  });

  it('gives the same either way', () => {
    for (const travel of [3, 40, 250]) expect(giveOf(-travel, 28, 90)).toBeCloseTo(-giveOf(travel, 28, 90), 12);
  });

  it('knows the pull that made it give so far', () => {
    for (const travel of [-300, -40, -2, 0, 5, 90, 200]) {
      expect(pullOf(giveOf(travel, 28, 90), 28, 90)).toBeCloseTo(travel, 6);
    }
    expect(Number.isFinite(pullOf(28, 28, 90))).toBe(true);
  });

  it('comes back to rest without swinging past it', () => {
    expect(settleOf(28, 0, 0)).toBe(28);
    let previous = 28;
    for (let ms = 10; ms <= 1000; ms += 10) {
      const value = settleOf(28, 0, ms / 1000);
      expect(value).toBeLessThan(previous);
      expect(value).toBeGreaterThan(0);
      previous = value;
    }
    // The same pace as a row settling on a volume: about a twentieth is left after a third of a second.
    expect(settleOf(28, 0, 0.34) / 28).toBeCloseTo(0.05, 1);
    expect(settleOf(28, 0, 1)).toBeLessThan(0.01);
    expect(settleOf(-12, 0, 0.1)).toBeCloseTo(-settleOf(12, 0, 0.1), 12);
  });

  it('carries on a little the way it was going before it comes back', () => {
    expect(settleOf(10, 60, 0.02)).toBeGreaterThan(10);
    expect(settleOf(10, 60, 0.6)).toBeLessThan(0.5);
  });
});

describe('standing volumes behind the travel', () => {
  it('lean with the speed of the row, up to a limit, the other way when it goes the other way', () => {
    expect(swayOf(0, 0.1, 1.5)).toBe(0);
    expect(swayOf(5, 0.1, 1.5)).toBeCloseTo(0.5, 12);
    expect(swayOf(-5, 0.1, 1.5)).toBeCloseTo(-0.5, 12);
    expect(swayOf(400, 0.1, 1.5)).toBe(1.5);
    expect(swayOf(-400, 0.1, 1.5)).toBe(-1.5);
    expect(swayOf(Number.NaN, 0.1, 1.5)).toBe(0);
  });

  it('leave out every volume that is turned at all, and take in the rest by degrees', () => {
    for (const distance of [0, 0.3, 0.5, 0.78]) {
      expect(swayShare(distance)).toBe(0);
      expect(focusWeight(distance, 0)).toBeGreaterThanOrEqual(0);
    }
    // Wherever a volume is turned, however slightly, it does not lean with the travel.
    for (let step = 0; step <= 100; step++) {
      const distance = step / 50;
      if (focusWeight(distance, 0) > 0) expect(swayShare(distance)).toBe(0);
    }
    expect(swayShare(1)).toBeGreaterThan(0);
    expect(swayShare(1)).toBeLessThan(0.3);
    expect(swayShare(1.7)).toBe(1);
    expect(swayShare(-1.7)).toBe(1);
    let previous = 0;
    for (let step = 40; step <= 90; step++) {
      const share = swayShare(step / 50);
      expect(share).toBeGreaterThanOrEqual(previous);
      expect(share - previous).toBeLessThan(0.05);
      previous = share;
    }
  });
});

describe('a volume travelling to a new place', () => {
  const from = poseAt(3, paper, 3);
  const to = poseAt(3, paper, 6);

  it('starts in the pose it had and ends in the pose it belongs in', () => {
    // A lean of minus nothing is no lean.
    const plain = (pose: typeof from) => Object.fromEntries(Object.entries(pose).map(([key, value]) => [key, value + 0]));
    expect(plain(blendPose(from, to, 0))).toEqual(plain({ ...from, slot: to.slot }));
    expect(plain(blendPose(from, to, 1))).toEqual(plain(to));
    expect(plain(blendPose(from, to, -2))).toEqual(plain({ ...from, slot: to.slot }));
    expect(plain(blendPose(from, to, 7))).toEqual(plain(to));
  });

  it('moves and turns evenly in between', () => {
    const half = blendPose(from, to, 0.5);
    expect(half.x).toBeCloseTo((from.x + to.x) / 2, 9);
    expect(half.angle).toBeCloseTo(from.angle / 2, 9);
    expect(half.lean).toBeCloseTo(from.lean / 2, 9);
    expect(half.weight).toBeCloseTo(0.5, 9);
    let previous = from.x;
    for (let step = 1; step <= 20; step++) {
      const x = blendPose(from, to, step / 20).x;
      expect(x).toBeGreaterThan(previous);
      previous = x;
    }
  });

  it('tells poses that would be drawn alike from poses that would not', () => {
    expect(samePose(from, { ...from, slot: 9, x: from.x + 0.1 })).toBe(true);
    expect(samePose(from, { ...from, x: from.x + 1 })).toBe(false);
    expect(samePose(from, { ...from, angle: from.angle - 0.2 })).toBe(false);
    expect(samePose(from, to)).toBe(false);
  });

  it('gathers speed, then slows into its place', () => {
    expect(easeTravel(0)).toBe(0);
    expect(easeTravel(1)).toBe(1);
    expect(easeTravel(0.5)).toBeCloseTo(0.5, 12);
    expect(easeTravel(0.1)).toBeLessThan(0.05);
    expect(easeTravel(0.9)).toBeGreaterThan(0.95);
    expect(easeTravel(-1)).toBe(0);
    expect(easeTravel(3)).toBe(1);
    for (let step = 1; step <= 50; step++) expect(easeTravel(step / 50)).toBeGreaterThan(easeTravel((step - 1) / 50));
  });
});

describe('a row that goes round', () => {
  const mixedFor =
    (geometry: Geometry): SizeOf =>
    (slot) =>
      volumeSize(geometry, [0, 0.9, 0.3, 1, 0.1][((slot % 5) + 5) % 5], [1, 0, 0.5][((slot % 3) + 3) % 3]);

  it('does so only where no volume could be seen twice', () => {
    // On a phone a shelf of four or five slim volumes would show the same one at both edges: it stands instead.
    const slim: SizeOf = () => volumeSize(paper, 0.2, 0.5);
    for (const count of [1, 3, 4, 5]) expect(rowLoops(paper, count, 412, slim)).toBe(false);
    for (const count of [1, 3, 4]) expect(rowLoops(paper, count, 412)).toBe(false);
    expect(rowLoops(paper, 15, 412, slim)).toBe(true);
    expect(rowLoops(paper, 15, 412)).toBe(true);
    // On a wide screen the row has to be longer than the scene by more than a volume.
    expect(rowLoops(paper, 17, 1280)).toBe(false);
    expect(rowLoops(paper, 24, 1280)).toBe(true);
    expect(rowLoops(paper, 0, 1280)).toBe(false);
  });

  it.each(Object.entries(VARIANTS))('never has the same resting volume in view at both edges (%s)', (_name, variant) => {
    for (const width of [320, 412, 768, 1280, 1920]) {
      for (const factor of [0.5, 1, 1.5]) {
        const geometry = fitGeometry(variant.geometry, factor);
        for (const mixed of [undefined, mixedFor(geometry)]) {
          for (let count = 4; count <= 60; count++) {
            // The sizes go round with the row: the volume after the last is the first again.
            const sizeOf = mixed ? (slot: number) => mixed(((slot % count) + count) % count) : undefined;
            if (!rowLoops(geometry, count, width, sizeOf)) continue;
            expect(restLength(geometry, count, sizeOf)).toBeGreaterThanOrEqual(LOOP_FILL * width);
            // Two copies of a volume stand one whole round apart: further than the scene and the volume together.
            const middle = Math.floor(count / 2);
            for (const position of [middle, middle + 0.5]) {
              const row = computeRow(position, geometry, 0, count, sizeOf);
              const round = row[count]!.x - row[0]!.x;
              const widest = Math.max(...Array.from({ length: count }, (_, slot) => (sizeOf?.(slot) ?? geometry).spineWidth));
              expect(round).toBeGreaterThanOrEqual(width + widest - 1);
            }
          }
        }
      }
    }
  });
});

describe('a standing row wider than its scene', () => {
  it('is moved just far enough to keep the presented volume in view', () => {
    const count = 6;
    const width = 412;
    const within = width / 2 - presentedReach(paper, count);
    expect(rowStands(paper, count, width)).toBe(false);
    let previous = Number.NEGATIVE_INFINITY;
    for (let step = 0; step <= (count - 1) * 20; step++) {
      const row = computeStandingRow(step / 20, paper, count, undefined, within);
      expect(Math.abs(row.origin)).toBeLessThanOrEqual(within + 1e-9);
      // It never jumps: a small change of focus moves it a little or not at all.
      expect(Math.abs(row.origin - previous) < 12 || step === 0).toBe(true);
      previous = row.origin;
    }
    const first = computeStandingRow(0, paper, count, undefined, within);
    const last = computeStandingRow(count - 1, paper, count, undefined, within);
    expect(first.origin).toBeCloseTo(-within, 6);
    expect(last.origin).toBeCloseTo(within, 6);
  });

  it('leaves a row that fits its scene in the middle', () => {
    const within = 1280 / 2 - presentedReach(paper, 6);
    for (const position of [0, 2.5, 5]) {
      expect(computeStandingRow(position, paper, 6, undefined, within)).toEqual(computeStandingRow(position, paper, 6));
    }
  });
});

describe('visibleRange', () => {
  it('reaches further along a row of thin volumes', () => {
    const thin = visibleRange(0, paper, WIDTH, 100, true, 2, () => volumeSize(paper, 0));
    const thick = visibleRange(0, paper, WIDTH, 100, true, 2, () => volumeSize(paper, 1));
    expect(thin.to - thin.from).toBeGreaterThan(thick.to - thick.from);
    expect((thin.to - thin.from) / 2 - 2).toBeGreaterThanOrEqual(WIDTH / 2 / (58 * 0.62 + paper.gap));
  });

  it('returns an empty range for count 0', () => {
    const range = visibleRange(0, paper, WIDTH, 0, true);
    expect(range.to).toBeLessThan(range.from);
    expect(visibleRange(0, paper, WIDTH, 0, false).to).toBeLessThan(0);
  });

  it('does not clamp when looping', () => {
    const range = visibleRange(-3, paper, WIDTH, 5, true);
    expect(range.from).toBeLessThan(0);
    expect(range.to).toBeGreaterThan(5);
  });

  it('clamps to 0..count-1 when not looping', () => {
    expect(visibleRange(0, paper, WIDTH, 5, false)).toEqual({ from: 0, to: 4 });
    expect(visibleRange(40, paper, WIDTH, 100, false).from).toBeGreaterThan(0);
    expect(visibleRange(99, paper, WIDTH, 100, false).to).toBe(99);
  });

  it('is centred on the rounded position and covers half the width on each side', () => {
    const range = visibleRange(10.4, paper, WIDTH, 100, true);
    expect(range.from + range.to).toBe(20);
    expect((range.to - range.from) / 2).toBeGreaterThanOrEqual(WIDTH / 2 / restPitch(paper));
  });

  it('widens with the margin', () => {
    const narrow = visibleRange(0, paper, WIDTH, 100, true, 0);
    const wide = visibleRange(0, paper, WIDTH, 100, true, 5);
    expect(wide.to - wide.from).toBe(narrow.to - narrow.from + 10);
  });
});

describe('fitGeometry', () => {
  it('is the look scaled, wherever its spines stay readable', () => {
    expect(fitGeometry(paper, 1)).toEqual(scaleGeometry(paper, 1));
    expect(fitGeometry(paper, 1.5)).toEqual(scaleGeometry(paper, 1.5));
    expect(fitGeometry(paper, 0.8)).toEqual(scaleGeometry(paper, 0.8));
  });

  it('makes the volumes of a small scene shorter but leaves their spines wide enough to read', () => {
    const small = fitGeometry(paper, 0.5);
    expect(small.spineWidth).toBe(READABLE_SPINE_PX);
    expect(small.bookHeight).toBe(paper.bookHeight / 2);
    expect(small.coverWidth).toBe(paper.coverWidth / 2);
    expect(small.gap).toBe(paper.gap / 2);
    // Fewer of them fit in view than if they had been made narrower.
    expect(restPitch(small)).toBeGreaterThan(restPitch(scaleGeometry(paper, 0.5)));
  });

  it('never makes a spine wider than the look has it at full size', () => {
    const pocket = VARIANTS.pocket!.geometry;
    expect(pocket.spineWidth).toBeLessThan(READABLE_SPINE_PX);
    expect(fitGeometry(pocket, 0.5).spineWidth).toBe(pocket.spineWidth);
    expect(fitGeometry(pocket, 1.2).spineWidth).toBeCloseTo(pocket.spineWidth * 1.2, 9);
  });

  it('does not change the look it is given', () => {
    const copy = { ...paper };
    fitGeometry(paper, 0.4);
    expect(paper).toEqual(copy);
  });
});

describe('scaleGeometry', () => {
  it('scales lengths and keeps angles', () => {
    const scaled = scaleGeometry(paper, 2);
    expect(scaled.spineWidth).toBe(paper.spineWidth * 2);
    expect(scaled.bookHeight).toBe(paper.bookHeight * 2);
    expect(scaled.coverWidth).toBe(paper.coverWidth * 2);
    expect(scaled.gap).toBe(paper.gap * 2);
    expect(scaled.focusGap).toBe(paper.focusGap * 2);
    expect(scaled.focusPush).toBe(paper.focusPush * 2);
    expect(scaled.focusAngle).toBe(paper.focusAngle);
    expect(scaled.focusLean).toBe(paper.focusLean);
  });

  it('scales lift and push on a variant that has them', () => {
    const scaled = scaleGeometry(night, 0.5);
    expect(scaled.focusLift).toBe(night.focusLift / 2);
    expect(scaled.focusPush).toBe(night.focusPush / 2);
  });

  it('does not change the input', () => {
    const copy = { ...paper };
    scaleGeometry(paper, 3);
    expect(paper).toEqual(copy);
  });

  it('scales restPitch by the same factor', () => {
    expect(restPitch(scaleGeometry(paper, 1.5))).toBeCloseTo(restPitch(paper) * 1.5, 9);
  });
});
