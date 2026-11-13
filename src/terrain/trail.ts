import { fork, pick, range } from '../core/random';
import type { Heightfield } from './heightfield';

/** The ways a trail can climb its mountain. */
export const TRAIL_TEMPLATE_IDS = ['switchback', 'ridge-walk', 'spiral', 'valley-first', 'traverse'] as const;
export type TrailTemplate = (typeof TRAIL_TEMPLATE_IDS)[number];

export interface TrailSpec {
  /** The same seed on the same mountain always gives the same trail. */
  readonly seed: number | string;
  /** Camps on the trail, counting the gate at the foot and the summit. 2 to 12. */
  readonly stops: number;
  /** A prepared way up, or 'random' to let the seed choose one. */
  readonly template: TrailTemplate | 'random';
  /**
   * Wanted height per stop, 0..1, rising. The first is the gate. The last stop is always the summit, whatever
   * height is given for it.
   */
  readonly stopHeights?: readonly number[];
  /** Height of the gate when `stopHeights` is not given. Default 0.09. */
  readonly footHeight?: number;
}

export interface TrailPoint {
  readonly x: number;
  readonly z: number;
  /** Ground height at the point, 0..1. */
  readonly h: number;
  /** Share of the whole trail walked to reach this point, 0 at the gate and 1 at the summit. */
  readonly along: number;
}

export interface TrailStop extends TrailPoint {
  /** 0 is the gate, the last one is the summit. */
  readonly index: number;
}

export interface Trail {
  /** The way up that was planned. Never 'random'. */
  readonly template: TrailTemplate;
  /** The smoothed route, evenly spaced, from the gate to the summit. */
  readonly points: TrailPoint[];
  readonly stops: TrailStop[];
  /** Length on the map, in footprint units (the footprint is 2 wide). Height is not counted. */
  readonly length: number;
}

const TAU = Math.PI * 2;
/** How tall the mountain is next to its footprint. Slopes are judged with this, so they match what is drawn. */
const VERTICAL = 0.6;
const ROUTE_GRID = 65;
const SECTORS = 48;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

function angleBetween(a: number, b: number): number {
  const d = Math.abs(a - b) % TAU;
  return d > Math.PI ? TAU - d : d;
}

/** The sixteen steps a route may take from a cell, in order round the compass. */
const STEPS: readonly (readonly [number, number])[] = [
  [1, 0],
  [2, 1],
  [1, 1],
  [1, 2],
  [0, 1],
  [-1, 2],
  [-1, 1],
  [-2, 1],
  [-1, 0],
  [-2, -1],
  [-1, -1],
  [-1, -2],
  [0, -1],
  [1, -2],
  [1, -1],
  [2, -1],
];
const NO_DIRECTION = STEPS.length;

interface RouteGrid {
  readonly size: number;
  readonly cell: number;
  readonly height: Float32Array;
  /** Steepness of the ground, as rise over run in drawn proportions. */
  readonly grade: Float32Array;
  /** -1 on a sharp crest, +1 in a sharp gully, 0 on even ground. */
  readonly hollow: Float32Array;
  /**
   * For every cell, the lowest ground that has to be crossed on the best way from there to the summit. A cell whose
   * own height is about this value lies on the summit's own flank: from there the way up never has to go down.
   */
  readonly pass: Float32Array;
  readonly centreX: number;
  readonly centreZ: number;
  readonly summitCell: number;
}

function buildRouteGrid(field: Heightfield): RouteGrid {
  const size = Math.min(ROUTE_GRID, field.resolution);
  const cell = 2 / (size - 1);
  const height = new Float32Array(size * size);
  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) height[j * size + i] = field.sample(-1 + i * cell, -1 + j * cell);
  }
  const read = (i: number, j: number): number =>
    height[clamp(j, 0, size - 1) * size + clamp(i, 0, size - 1)] as number;

  const grade = new Float32Array(size * size);
  const hollow = new Float32Array(size * size);
  let weight = 0;
  let centreX = 0;
  let centreZ = 0;
  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      const index = j * size + i;
      const h = height[index] as number;
      const gx = (read(i + 1, j) - read(i - 1, j)) / (2 * cell);
      const gz = (read(i, j + 1) - read(i, j - 1)) / (2 * cell);
      grade[index] = Math.hypot(gx, gz) * VERTICAL;
      const around =
        (read(i + 2, j) + read(i - 2, j) + read(i, j + 2) + read(i, j - 2) + read(i + 1, j + 1) + read(i - 1, j - 1) + read(i + 1, j - 1) + read(i - 1, j + 1)) / 8;
      hollow[index] = clamp((around - h) / 0.02, -1, 1);
      const w = h * h * h;
      weight += w;
      centreX += w * (-1 + i * cell);
      centreZ += w * (-1 + j * cell);
    }
  }
  const summitI = clamp(Math.round((field.summit.x + 1) / cell), 0, size - 1);
  const summitJ = clamp(Math.round((field.summit.z + 1) / cell), 0, size - 1);
  const summitCell = summitJ * size + summitI;

  // Flood down from the summit, always continuing from the highest ground reached so far.
  const pass = new Float32Array(size * size).fill(-1);
  const frontier = new Frontier();
  pass[summitCell] = height[summitCell] as number;
  frontier.push(-(height[summitCell] as number), summitCell);
  while (frontier.size > 0) {
    const index = frontier.pop();
    const i = index % size;
    const j = (index - i) / size;
    for (let dj = -1; dj <= 1; dj += 1) {
      for (let di = -1; di <= 1; di += 1) {
        const ni = i + di;
        const nj = j + dj;
        if ((di === 0 && dj === 0) || ni < 0 || nj < 0 || ni >= size || nj >= size) continue;
        const near = nj * size + ni;
        const through = Math.min(pass[index] as number, height[near] as number);
        if (through > (pass[near] as number)) {
          pass[near] = through;
          frontier.push(-through, near);
        }
      }
    }
  }

  return {
    size,
    cell,
    height,
    grade,
    hollow,
    pass,
    centreX: weight > 0 ? centreX / weight : 0,
    centreZ: weight > 0 ? centreZ / weight : 0,
    summitCell,
  };
}

interface Faces {
  /** Direction of the shortest way from the top to the foot. */
  readonly steep: number;
  /** Direction of the longest spur. */
  readonly gentle: number;
  /** Direction of the deepest gully. */
  readonly valley: number;
  /** Direction of a broad face. */
  readonly broad: number;
}

/** Looks outward from the middle of the mountain in every direction and notes how far the ground reaches. */
function surveyFaces(field: Heightfield, grid: RouteGrid, foot: number, choose: <T>(list: readonly T[]) => T): Faces {
  const sectors: { angle: number; run: number; hollow: number }[] = [];
  for (let s = 0; s < SECTORS; s += 1) {
    const angle = (s / SECTORS) * TAU;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    let run = 0;
    let hollowSum = 0;
    let hollowCount = 0;
    for (let r = grid.cell; r < 2.9; r += grid.cell * 0.5) {
      const x = grid.centreX + dx * r;
      const z = grid.centreZ + dz * r;
      if (Math.abs(x) > 0.97 || Math.abs(z) > 0.97) break;
      const h = field.sample(x, z);
      if (h >= foot) run = r;
      if (h >= foot && h <= 0.8) {
        const i = clamp(Math.round((x + 1) / grid.cell), 0, grid.size - 1);
        const j = clamp(Math.round((z + 1) / grid.cell), 0, grid.size - 1);
        hollowSum += grid.hollow[j * grid.size + i] as number;
        hollowCount += 1;
      }
    }
    sectors.push({ angle, run, hollow: hollowCount > 0 ? hollowSum / hollowCount : 0 });
  }
  const real = sectors.filter((sector) => sector.run > 0.15);
  const pool = real.length >= 6 ? real : sectors;
  const best = (score: (sector: (typeof sectors)[number]) => number): number => {
    const sorted = [...pool].sort((a, b) => score(b) - score(a) || a.angle - b.angle);
    return choose(sorted.slice(0, 3)).angle;
  };
  const byRun = [...pool].sort((a, b) => a.run - b.run || a.angle - b.angle);
  const upperHalf = byRun.slice(Math.floor(byRun.length / 2));
  return {
    steep: best((sector) => -sector.run),
    gentle: best((sector) => sector.run),
    valley: best((sector) => sector.hollow),
    broad: choose(upperHalf).angle,
  };
}

/** What a template asks of the planner. */
interface Recipe {
  /** Direction from the middle of the mountain in which stop k should lie. u runs 0..1 over the stops. */
  azimuth(k: number, u: number): number;
  /** How strictly a stop keeps to its direction. */
  readonly keepDirection: number;
  /** Shapes the default stop heights: 1 is even, above 1 stays low for longer. */
  readonly heightCurve: number;
  /** The grade a walker finds comfortable. Steeper ground makes the route zigzag. */
  readonly comfort: number;
  /** Extra cost for walking in gullies (a ridge walk) or on crests (a valley walk). */
  readonly avoidHollows: number;
  readonly avoidCrests: number;
  /** Stops prefer crests (negative) or gullies (positive). */
  readonly stopHollow: number;
  /** Cost of a sharp turn, in cells. */
  readonly turn: number;
}

function recipeFor(template: TrailTemplate, faces: Faces, stops: number, seed: number | string): Recipe {
  const random = fork(seed, `trail/recipe/${template}`);
  const hand = random() < 0.5 ? 1 : -1;
  switch (template) {
    case 'switchback':
      return {
        azimuth: (k, u) => faces.steep + (k % 2 === 0 ? -1 : 1) * hand * 0.1 * (1 - u),
        keepDirection: 6,
        heightCurve: 1,
        comfort: 0.16,
        avoidHollows: 0,
        avoidCrests: 0,
        stopHollow: 0,
        turn: 1.1,
      };
    case 'ridge-walk':
      return {
        azimuth: () => faces.gentle,
        keepDirection: 3.5,
        heightCurve: 0.9,
        comfort: 0.34,
        avoidHollows: 2.2,
        avoidCrests: 0,
        stopHollow: 1.6,
        turn: 0.5,
      };
    case 'spiral': {
      const turns = clamp(0.5 + 0.11 * stops, 0.8, 1.6);
      const start = range(random, 0, TAU);
      return {
        azimuth: (_k, u) => start + hand * TAU * turns * u,
        keepDirection: 7,
        heightCurve: 1,
        comfort: 0.3,
        avoidHollows: 0,
        avoidCrests: 0,
        stopHollow: 0,
        turn: 0.5,
      };
    }
    case 'valley-first': {
      const sweep = range(random, 1.9, 2.5);
      return {
        azimuth: (_k, u) => faces.valley + hand * sweep * Math.max(0, 1 - u / 0.55),
        keepDirection: 5,
        heightCurve: 2,
        comfort: 0.3,
        avoidHollows: 0,
        avoidCrests: 1.6,
        stopHollow: -1,
        turn: 0.5,
      };
    }
    case 'traverse': {
      const legs = stops >= 7 ? 3 : 2;
      const swing = range(random, 0.85, 1.05);
      return {
        azimuth: (_k, u) => {
          const phase = u * legs;
          const wave = 1 - Math.abs((phase % 2) - 1);
          return faces.broad + hand * swing * (wave * 2 - 1);
        },
        keepDirection: 7,
        heightCurve: 1,
        comfort: 0.3,
        avoidHollows: 0,
        avoidCrests: 0,
        stopHollow: 0,
        turn: 0.6,
      };
    }
  }
}

/** The height each stop aims for. Always rising, the last one is the summit. */
function stopTargets(spec: TrailSpec, count: number, foot: number, curve: number): number[] {
  const given = spec.stopHeights;
  const targets: number[] = [];
  if (given && given.length === count && given.every((value) => Number.isFinite(value))) {
    for (const value of given) targets.push(clamp(value, 0.03, 1));
  } else {
    for (let k = 0; k < count; k += 1) targets.push(foot + (1 - foot) * (count > 1 ? k / (count - 1) : 1) ** curve);
  }
  targets[count - 1] = 1;
  // Keep a little room between neighbours, working down from the summit.
  const room = Math.min(0.02, 0.5 / count);
  for (let k = count - 2; k >= 0; k -= 1) {
    targets[k] = Math.min(targets[k] as number, (targets[k + 1] as number) - room);
  }
  targets[0] = Math.max(0.02, targets[0] as number);
  for (let k = 1; k < count - 1; k += 1) targets[k] = Math.max(targets[k] as number, (targets[k - 1] as number) + room * 0.5);
  return targets;
}

/** Chooses a cell for every stop but the summit. Each one is higher than the one before. */
function placeStops(grid: RouteGrid, recipe: Recipe, targets: readonly number[]): number[] {
  const { size, cell, height, grade, hollow, pass } = grid;
  const count = targets.length;
  const summitHeight = height[grid.summitCell] as number;
  const cells: number[] = [];
  const minGap = clamp(1.6 / count, 0.1, 0.3);

  for (let k = 0; k < count - 1; k += 1) {
    const target = targets[k] as number;
    const u = count > 1 ? k / (count - 1) : 0;
    const azimuth = recipe.azimuth(k, u);
    const previous = k > 0 ? (height[cells[k - 1] as number] as number) : -1;
    const step = k > 0 ? target - (targets[k - 1] as number) : 0;
    const upper = Math.min(summitHeight - 0.004, target + 0.45 * ((targets[k + 1] as number) - target));

    const search = (low: number, high: number, margin: number, onFlank: boolean): number => {
      let best = -1;
      let bestScore = Infinity;
      for (let j = margin; j < size - margin; j += 1) {
        for (let i = margin; i < size - margin; i += 1) {
          const index = j * size + i;
          if (index === grid.summitCell) continue;
          const h = height[index] as number;
          if (h < low || h > high) continue;
          // A camp on a neighbouring top would force the trail down again to reach the summit.
          if (onFlank && (pass[index] as number) < h - 0.02) continue;
          const x = -1 + i * cell;
          const z = -1 + j * cell;
          const fromCentre = Math.hypot(x - grid.centreX, z - grid.centreZ);
          let score = Math.abs(h - target) / 0.025;
          if (fromCentre > 0.04) {
            score += (recipe.keepDirection * angleBetween(Math.atan2(z - grid.centreZ, x - grid.centreX), azimuth)) / Math.PI;
          }
          score += (grade[index] as number) * 0.9 + recipe.stopHollow * (hollow[index] as number);
          for (const other of cells) {
            const d = Math.hypot(x - (-1 + (other % size) * cell), z - (-1 + Math.floor(other / size) * cell));
            if (d < minGap) score += (1 - d / minGap) * 4;
          }
          if (score < bestScore) {
            bestScore = score;
            best = index;
          }
        }
      }
      return best;
    };

    let chosen = search(k === 0 ? target * 0.85 : previous + 0.35 * step, upper, 3, true);
    if (chosen < 0) chosen = search(previous + 1e-4, summitHeight - 1e-4, 2, true);
    if (chosen < 0) chosen = search(previous + 1e-4, summitHeight - 1e-4, 2, false);
    if (chosen < 0) chosen = search(previous + 1e-6, Infinity, 1, false);
    if (chosen < 0) chosen = grid.summitCell;
    cells.push(chosen);
  }
  cells.push(grid.summitCell);
  return cells;
}

/** A small binary heap of (cost, state) pairs. */
class Frontier {
  private readonly costs: number[] = [];
  private readonly states: number[] = [];

  get size(): number {
    return this.costs.length;
  }

  push(cost: number, state: number): void {
    const { costs, states } = this;
    let i = costs.length;
    costs.push(cost);
    states.push(state);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((costs[parent] as number) <= cost) break;
      costs[i] = costs[parent] as number;
      states[i] = states[parent] as number;
      i = parent;
    }
    costs[i] = cost;
    states[i] = state;
  }

  pop(): number {
    const { costs, states } = this;
    const top = states[0] as number;
    const cost = costs.pop() as number;
    const state = states.pop() as number;
    const length = costs.length;
    if (length > 0) {
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= length) break;
        if (child + 1 < length && (costs[child + 1] as number) < (costs[child] as number)) child += 1;
        if ((costs[child] as number) >= cost) break;
        costs[i] = costs[child] as number;
        states[i] = states[child] as number;
        i = child;
      }
      costs[i] = cost;
      states[i] = state;
    }
    return top;
  }
}

/**
 * A* from one stop to the next. A state is a cell and the direction it was entered from, so sharp turns can cost
 * something: that is what turns a jittering climb into long legs joined by hairpins. Steepness costs by its square,
 * so on a steep face a longer, flatter line wins and the route starts to zigzag.
 */
function findLeg(grid: RouteGrid, recipe: Recipe, from: number, to: number, used: Float32Array, lowGround: number): number[] {
  if (from === to) return [from];
  const { size, cell, height, hollow } = grid;
  const perCell = NO_DIRECTION + 1;
  const total = size * size * perCell;
  const cost = new Float32Array(total).fill(Infinity);
  const parent = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);
  const frontier = new Frontier();
  const goalI = to % size;
  const goalJ = Math.floor(to / size);
  const estimate = (i: number, j: number): number => Math.hypot(i - goalI, j - goalJ) * cell;

  const startState = from * perCell + NO_DIRECTION;
  cost[startState] = 0;
  frontier.push(estimate(from % size, Math.floor(from / size)), startState);
  let goalState = -1;

  while (frontier.size > 0) {
    const state = frontier.pop();
    if (closed[state] === 1) continue;
    closed[state] = 1;
    const index = Math.floor(state / perCell);
    const arrived = state - index * perCell;
    if (index === to) {
      goalState = state;
      break;
    }
    const i = index % size;
    const j = (index - i) / size;
    const here = height[index] as number;
    const soFar = cost[state] as number;

    for (let d = 0; d < STEPS.length; d += 1) {
      const step = STEPS[d] as readonly [number, number];
      const ni = i + step[0];
      const nj = j + step[1];
      if (ni < 0 || nj < 0 || ni >= size || nj >= size) continue;
      const nextIndex = nj * size + ni;
      const nextState = nextIndex * perCell + d;
      if (closed[nextState] === 1) continue;
      const length = Math.hypot(step[0], step[1]) * cell;
      const there = height[nextIndex] as number;
      const rise = there - here;
      const steepness = (Math.abs(rise) * VERTICAL) / length / recipe.comfort;
      const squared = steepness * steepness;
      let move = length * (1 + squared + 0.35 * squared * squared);
      // Height given away has to be climbed again.
      if (rise < 0) move -= rise * 3;
      // Water, the canyon floor and the bare sheet round the mountain are not ground to walk on.
      if (there < lowGround) move += length * 6;
      if (ni < 2 || nj < 2 || ni > size - 3 || nj > size - 3) move += length * 4;
      // Do not walk the same ground twice.
      move += length * 2.5 * (used[nextIndex] as number);
      const lie = hollow[nextIndex] as number;
      move += length * (recipe.avoidHollows * Math.max(0, lie) + recipe.avoidCrests * Math.max(0, -lie));
      if (arrived !== NO_DIRECTION) {
        const raw = Math.abs(d - arrived);
        const turn = Math.min(raw, STEPS.length - raw);
        if (turn > 1) move += recipe.turn * cell * (turn - 1);
      }
      const reached = soFar + move;
      if (reached < (cost[nextState] as number)) {
        cost[nextState] = reached;
        parent[nextState] = state;
        frontier.push(reached + estimate(ni, nj), nextState);
      }
    }
  }

  if (goalState < 0) return [from, to];
  const path: number[] = [];
  for (let state = goalState; state >= 0; state = parent[state] as number) path.push(Math.floor(state / perCell));
  return path.reverse();
}

interface Xz {
  x: number;
  z: number;
}

/** Rounds a grid path into a walked line. The two ends stay where they are. */
function smoothLeg(points: readonly Xz[]): Xz[] {
  let line = points.map((p) => ({ x: p.x, z: p.z }));
  for (let pass = 0; pass < 3; pass += 1) {
    const next = line.map((p) => ({ x: p.x, z: p.z }));
    for (let i = 1; i < line.length - 1; i += 1) {
      const a = line[i - 1] as Xz;
      const b = line[i] as Xz;
      const c = line[i + 1] as Xz;
      (next[i] as Xz).x = b.x * 0.5 + (a.x + c.x) * 0.25;
      (next[i] as Xz).z = b.z * 0.5 + (a.z + c.z) * 0.25;
    }
    line = next;
  }
  for (let pass = 0; pass < 2 && line.length > 2; pass += 1) {
    const next: Xz[] = [line[0] as Xz];
    for (let i = 0; i < line.length - 1; i += 1) {
      const a = line[i] as Xz;
      const b = line[i + 1] as Xz;
      next.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
    }
    next.push(line[line.length - 1] as Xz);
    line = next;
  }
  return line;
}

/** Points at even spacing along a line, both ends included. */
function resample(line: readonly Xz[], spacing: number): Xz[] {
  let total = 0;
  for (let i = 1; i < line.length; i += 1) {
    total += Math.hypot((line[i] as Xz).x - (line[i - 1] as Xz).x, (line[i] as Xz).z - (line[i - 1] as Xz).z);
  }
  const first = line[0] as Xz;
  const lastPoint = line[line.length - 1] as Xz;
  if (total <= 0) return [{ x: first.x, z: first.z }];
  const pieces = Math.max(1, Math.round(total / spacing));
  const out: Xz[] = [{ x: first.x, z: first.z }];
  let segment = 1;
  let before = 0;
  for (let k = 1; k < pieces; k += 1) {
    const wanted = (total * k) / pieces;
    for (;;) {
      const a = line[segment - 1] as Xz;
      const b = line[segment] as Xz;
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      if (before + length >= wanted || segment >= line.length - 1) {
        const t = length > 0 ? clamp((wanted - before) / length, 0, 1) : 0;
        out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
        break;
      }
      before += length;
      segment += 1;
    }
  }
  out.push({ x: lastPoint.x, z: lastPoint.z });
  return out;
}

/** The template a spec ends up with: its own, or the one the seed picks for 'random'. */
export function resolveTrailTemplate(spec: Pick<TrailSpec, 'seed' | 'template'>): TrailTemplate {
  if (spec.template !== 'random') {
    if (!TRAIL_TEMPLATE_IDS.includes(spec.template)) throw new Error(`Unknown trail template: ${String(spec.template)}`);
    return spec.template;
  }
  return pick(fork(spec.seed, 'trail/template'), TRAIL_TEMPLATE_IDS);
}

/**
 * Plans the trail: a gate at the foot, camps near their wanted heights in the directions the template prescribes,
 * the summit as the last stop, and a walkable route between them.
 */
export function planTrail(field: Heightfield, spec: TrailSpec): Trail {
  const count = Math.round(clamp(Number.isFinite(spec.stops) ? spec.stops : 2, 2, 12));
  const template = resolveTrailTemplate(spec);
  const foot = clamp(spec.footHeight ?? 0.09, 0.03, 0.3);
  const grid = buildRouteGrid(field);
  const choose = fork(spec.seed, `trail/faces/${template}`);
  const faces = surveyFaces(field, grid, foot, (list) => pick(choose, list));
  const recipe = recipeFor(template, faces, count, spec.seed);
  const targets = stopTargets(spec, count, foot, recipe.heightCurve);
  const cells = placeStops(grid, recipe, targets);

  const { size, cell } = grid;
  const positionOf = (index: number): Xz => ({ x: -1 + (index % size) * cell, z: -1 + Math.floor(index / size) * cell });
  const used = new Float32Array(size * size);
  const lowGround = Math.min(foot, targets[0] as number) * 0.7;

  const points: { x: number; z: number; h: number; walked: number }[] = [];
  const stopAt: number[] = [];
  let walked = 0;

  for (let leg = 0; leg < count - 1; leg += 1) {
    const path = findLeg(grid, recipe, cells[leg] as number, cells[leg + 1] as number, used, lowGround);
    // Mark the ground of this leg, but leave the far end open: the next leg has to start there.
    for (let k = 0; k < path.length - 2; k += 1) {
      const index = path[k] as number;
      const i = index % size;
      const j = (index - i) / size;
      for (let dj = -1; dj <= 1; dj += 1) {
        for (let di = -1; di <= 1; di += 1) {
          const ni = i + di;
          const nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= size || nj >= size) continue;
          const near = nj * size + ni;
          used[near] = Math.max(used[near] as number, di === 0 && dj === 0 ? 1 : 0.5);
        }
      }
    }

    const line = path.map(positionOf);
    // The last leg ends on the true summit, which may lie between two cells of the route grid.
    if (leg === count - 2) line[line.length - 1] = { x: field.summit.x, z: field.summit.z };
    const even = resample(smoothLeg(line), 0.01);

    for (let k = 0; k < even.length; k += 1) {
      const p = even[k] as Xz;
      const previous = points[points.length - 1];
      if (k === 0 && previous) continue;
      if (previous) walked += Math.hypot(p.x - previous.x, p.z - previous.z);
      points.push({ x: p.x, z: p.z, h: field.sample(p.x, p.z), walked });
    }
    if (leg === 0) stopAt.push(0);
    stopAt.push(points.length - 1);
  }

  const length = walked;
  const finished: TrailPoint[] = points.map((p) => ({ x: p.x, z: p.z, h: p.h, along: length > 0 ? p.walked / length : 0 }));
  const lastIndex = finished.length - 1;
  finished[lastIndex] = { ...(finished[lastIndex] as TrailPoint), h: field.summit.h, along: 1 };
  const stops: TrailStop[] = stopAt.map((pointIndex, index) => ({ ...(finished[pointIndex] as TrailPoint), index }));

  return { template, points: finished, stops, length };
}

/** The point at a share of the trail, 0 at the gate and 1 at the summit. */
export function trailPointAt(trail: Trail, along: number): TrailPoint {
  const points = trail.points;
  const target = clamp(along, 0, 1);
  let low = 0;
  let high = points.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if ((points[middle] as TrailPoint).along <= target) low = middle;
    else high = middle;
  }
  const a = points[low] as TrailPoint;
  const b = points[high] as TrailPoint;
  const span = b.along - a.along;
  const t = span > 0 ? clamp((target - a.along) / span, 0, 1) : 0;
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, h: a.h + (b.h - a.h) * t, along: target };
}

/** One printed mark of the route: a dash of the line, or a dot. */
export interface TrailMark {
  readonly kind: 'dash' | 'dot';
  /** A dash has two or more points, a dot has one. */
  readonly points: TrailPoint[];
}

export interface TrailMarkOptions {
  /** Length of a dash, in footprint units. Default 0.036. */
  readonly dash?: number;
  /** Gap between marks. Default 0.024. */
  readonly gap?: number;
  /** Every n-th mark is a dot instead of a dash. 0 turns dots off. Default 4. */
  readonly dotEvery?: number;
}

/**
 * Breaks the route into the marks a map prints: dashes, and a dot in place of every n-th dash. Marks start and stop
 * cleanly at the gate and the summit.
 */
export function markTrail(trail: Trail, options: TrailMarkOptions = {}): TrailMark[] {
  const dash = Math.max(0.004, options.dash ?? 0.036);
  const gap = Math.max(0.002, options.gap ?? 0.024);
  const dotEvery = Math.max(0, Math.round(options.dotEvery ?? 4));
  const marks: TrailMark[] = [];
  const total = trail.length;
  if (total <= 0 || trail.points.length < 2) return marks;
  const step = Math.min(0.006, dash / 4);
  let position = gap * 0.5;
  let counter = 0;
  while (position < total) {
    counter += 1;
    if (dotEvery > 0 && counter % dotEvery === 0) {
      marks.push({ kind: 'dot', points: [trailPointAt(trail, position / total)] });
      position += gap * 1.6;
      continue;
    }
    const end = Math.min(total, position + dash);
    const pieces = Math.max(1, Math.ceil((end - position) / step));
    const points: TrailPoint[] = [];
    for (let k = 0; k <= pieces; k += 1) points.push(trailPointAt(trail, (position + ((end - position) * k) / pieces) / total));
    marks.push({ kind: 'dash', points });
    position = end + gap;
  }
  return marks;
}
