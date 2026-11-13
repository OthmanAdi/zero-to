import { deriveSheet, tracePrint, type SheetData, type SheetPrint } from '../table/sheet-data';
import type { Progress } from '../roadmap/progress';
import type { TrekStage } from '../roadmap/derive';
import type { Roadmap, Stage, SurfaceKind, Waypoint } from '../roadmap/types';
import { PANEL, clampPanels, foldSchedule, type FoldSchedule } from './fold';
import { MODEL, STRIP, stripCards, stripFrame, stripGround, stripPointAt, stripRoute, type StripCards, type StripGround, type StripRoute } from './strip';
import { PLACE, SHARE, fForMinutes, itemAt, minutesShareAt, pathAt, pathForMinutes, progressAt, stageAt, stageItems, stageWindows, type ItemHit, type StageWindows, type WalkItem } from './timeline';

/**
 * Everything the walk works out from a roadmap before it builds anything: for every stage its panel, the
 * route on it, the ground under it, the cards cut from that ground and where the stage's things stand.
 * All of it is plain data, so it can be tested without a canvas or a renderer.
 */
export interface PanelPoint {
  /** Panel coordinates. */
  readonly x: number;
  readonly z: number;
}

/**
 * A side trail: the dotted spur an optional step stands on. It leaves the route a little before the step, runs
 * out to the step's mark beside the route and comes back to the route a little after it.
 */
export const SPUR = {
  /** How far the mark stands from the route, and the least room that is still worth a spur there. */
  reach: 0.42,
  minReach: 0.2,
  /** Half the stretch of the path a spur spans, and the largest share of the gap to the next mark it may take. */
  half: 0.085,
  gapShare: 0.3,
  /** The mark keeps this far from the edges of the model: more at the front, so that its title fits below it. */
  front: 0.34,
  back: 0.2,
  side: 0.2,
  /** The mark keeps this share of its reach clear of the rest of the route, so a spur never looks like a crossing. */
  clear: 0.75,
  /** Where a spur square to the route has no room, it may lean by these angles, in degrees. */
  lean: [0, 25, -25, 50, -50],
  /** Where the full reach has no room in any of them, a spur is tried shorter, in these shares of it. */
  shorter: [1, 0.8, 0.64, 0.5],
  /**
   * The mark keeps clear of the stage board, the signpost and the camp, which stand beside the route: this far
   * to either side of each, and this far in front of and behind it. They stand two to three times as tall as the
   * walker, so a mark close in front of one would put him against it in the picture.
   */
  signs: { board: { across: 0.7, deep: 0.4 }, signpost: { across: 0.6, deep: 0.36 }, camp: { across: 0.75, deep: 0.45 } },
  /** Points a spur is drawn with. */
  samples: 32,
  /** The spur's own ribbon: narrower than the route, and dots where the route has dashes. */
  width: 0.042,
  period: 0.07,
  ink: 0.44,
} as const;

export interface PanelSpur {
  /** Where the spur leaves the route and where it rejoins it, as places on the panel's path. */
  readonly from: number;
  readonly to: number;
  /** The place on the path its step belongs to: the spur is farthest from the route there. */
  readonly at: number;
  /** How far the mark lies from the route. */
  readonly reach: number;
  /**
   * The way the spur stands off the route, as a unit vector in panel coordinates: square to the route at the
   * step, or leaning where that has no room. It points to the front of the panel wherever it can, because
   * nothing else stands there.
   */
  readonly side: PanelPoint;
  /**
   * The spur from the route and back to it. `s` is the length of the route beside each point, so a spur is
   * revealed together with the stretch of route it leaves.
   */
  readonly points: readonly PathPoint[];
}

export interface PanelMark extends PanelPoint {
  readonly waypoint: Waypoint;
  readonly index: number;
  /** Where the mark is on the panel's path, 0 at the first stop and 1 at the camp. */
  readonly at: number;
  /** Minutes of the whole roadmap that lie behind the walker when he has finished this step. */
  readonly minutesAfter: number;
  /** The point of the route the step belongs to. The mark itself (x, z) lies there, or at the end of its spur. */
  readonly on: PanelPoint;
  /** The side trail of an optional step, or null for a step on the route. */
  readonly spur: PanelSpur | null;
}

export interface PanelPlan {
  readonly index: number;
  readonly stage: Stage;
  readonly trek: TrekStage;
  readonly first: boolean;
  readonly last: boolean;
  readonly route: StripRoute;
  readonly ground: StripGround;
  readonly cards: StripCards;
  /** The ground the stage is walked on, and the ground of every card from the bottom up. */
  readonly surface: SurfaceKind;
  readonly cardSurfaces: readonly SurfaceKind[];
  readonly marks: readonly PanelMark[];
  readonly board: PanelPoint;
  readonly signpost: PanelPoint;
  readonly camp: PanelPoint;
  /** Length of the route on this panel, crease to crease, and the length at which it starts on the whole map. */
  readonly length: number;
  readonly start: number;
  /** Seed of everything that is scattered on this panel. */
  readonly seed: string;
}

export interface WalkPlan {
  readonly data: SheetData;
  readonly print: SheetPrint;
  readonly roadmap: Roadmap;
  readonly panels: readonly PanelPlan[];
  readonly windows: StageWindows;
  readonly schedule: FoldSchedule;
  /** Length of the whole route over all panels. */
  readonly length: number;
}

export interface PathPoint extends PanelPoint {
  /** Length of the route from the left end of the panel's route to this point. */
  readonly s: number;
}

type PanelPath = Pick<PanelPlan, 'first' | 'last' | 'route'>;

/** A place on a panel's path: -1 the crease he comes in over, 0 the first stop, 1 the camp, 2 the crease he leaves over. */
export function pathPoint(panel: PanelPath, path: number): PathPoint {
  const lead = panel.first ? 0 : STRIP.margin;
  const q = Math.min(panel.last ? 1 : 2, Math.max(panel.first ? 0 : -1, path));
  if (q < 0) return { x: STRIP.margin * (1 + q), z: STRIP.routeZ, s: STRIP.margin * (1 + q) };
  if (q <= 1) {
    const point = stripPointAt(panel.route, q);
    return { x: point.x, z: point.z, s: lead + point.s };
  }
  return { x: panel.route.frame.x1 + STRIP.margin * (q - 1), z: STRIP.routeZ, s: lead + panel.route.length + STRIP.margin * (q - 1) };
}

/** How far a spur stands off the route at a place on the path: a smooth rise to the mark and back. */
export function spurOffset(spur: Pick<PanelSpur, 'from' | 'to' | 'at' | 'reach'>, path: number): number {
  if (path <= spur.from || path >= spur.to) return 0;
  const half = path < spur.at ? spur.at - spur.from : spur.to - spur.at;
  if (half <= 0) return 0;
  const lift = Math.cos(((path - spur.at) / half) * (Math.PI / 2));
  return spur.reach * lift * lift;
}

/**
 * Where the walker is at a place on a panel's path. He follows the route, and where an optional step stands
 * on a side trail he takes it: out to the mark and back. `s` stays the length of the route, so the ribbon is
 * drawn as far as he has come whichever way he went.
 */
export function walkPoint(panel: Pick<PanelPlan, 'first' | 'last' | 'route' | 'marks'>, path: number): PathPoint {
  const point = pathPoint(panel, path);
  for (const mark of panel.marks) {
    if (!mark.spur) continue;
    const offset = spurOffset(mark.spur, path);
    if (offset !== 0) return { x: point.x + mark.spur.side.x * offset, z: point.z + mark.spur.side.z * offset, s: point.s };
  }
  return point;
}

/** Something that stands beside the route and that a side trail keeps clear of. */
interface Obstacle extends PanelPoint {
  /** Half its width with a margin, and how far in front of and behind it a mark would be lost. */
  readonly across: number;
  readonly deep: number;
}

/**
 * The side trail of an optional step at `at`, or null when there is no room for one. It takes at most a share
 * of the gap to the marks beside it, so two marks never share a spur. It stands square to the route at the
 * step, on the side that faces the front of the panel, where nothing else stands. Where the route bends round
 * in front of it, or a sign stands in its way, it leans, then takes the other side, and is made shorter
 * before it is given up.
 */
function planSpur(panel: PanelPath, at: number, before: number, after: number, obstacles: readonly Obstacle[] = []): PanelSpur | null {
  const half = Math.min(SPUR.half, SPUR.gapShare * (at - before), SPUR.gapShare * (after - at));
  if (!(half > 0.01)) return null;
  const from = at - half;
  const to = at + half;
  const on = pathPoint(panel, at);
  const a = pathPoint(panel, at - 0.012);
  const b = pathPoint(panel, at + 0.012);
  const length = Math.hypot(b.x - a.x, b.z - a.z);
  if (length < 1e-6) return null;
  // The left of the direction of travel. On a route that runs across the panel that is the front.
  let side = { x: -(b.z - a.z) / length, z: (b.x - a.x) / length };
  if (side.z < -1e-9 || (Math.abs(side.z) <= 1e-9 && side.x < 0)) side = { x: -side.x, z: -side.z };

  /** How far a mark can stand off the route on a side before it comes too near an edge of the model. */
  const room = (way: PanelPoint): number => {
    let reach: number = SPUR.reach;
    if (way.x > 1e-9) reach = Math.min(reach, (MODEL.x1 - SPUR.side - on.x) / way.x);
    if (way.x < -1e-9) reach = Math.min(reach, (on.x - MODEL.x0 - SPUR.side) / -way.x);
    if (way.z > 1e-9) reach = Math.min(reach, (MODEL.z1 - SPUR.front - on.z) / way.z);
    if (way.z < -1e-9) reach = Math.min(reach, (on.z - MODEL.z0 - SPUR.back) / -way.z);
    return reach;
  };
  /** How near the rest of the route comes to a mark that stands `reach` off it on a side. */
  const others: PathPoint[] = [];
  for (let k = 0; k <= 80; k += 1) {
    const path = k / 80;
    if (path < from - half || path > to + half) others.push(pathPoint(panel, path));
  }
  const clearance = (way: PanelPoint, reach: number): number => {
    let nearest = Infinity;
    for (const other of others) nearest = Math.min(nearest, Math.hypot(other.x - on.x - way.x * reach, other.z - on.z - way.z * reach));
    return nearest;
  };

  /** True when a mark that stands `reach` off the route on a side is clear of everything that stands there. */
  const free = (way: PanelPoint, reach: number): boolean =>
    obstacles.every((thing) => Math.hypot((thing.x - on.x - way.x * reach) / thing.across, (thing.z - on.z - way.z * reach) / thing.deep) >= 1);

  // Every way a spur may stand: square to the route and leaning, the front before the back.
  const ways: PanelPoint[] = [];
  for (const base of [side, { x: -side.x, z: -side.z }]) {
    for (const degrees of SPUR.lean) {
      const angle = (degrees * Math.PI) / 180;
      ways.push({ x: base.x * Math.cos(angle) - base.z * Math.sin(angle), z: base.x * Math.sin(angle) + base.z * Math.cos(angle) });
    }
  }
  // The longest spur that fits. A mark with no clear place at all has no spur: it stays on the route, where a
  // dotted ring still tells it from the steps of the route.
  let best: { way: PanelPoint; reach: number } | null = null;
  for (const share of SPUR.shorter) {
    for (const way of ways) {
      const reach = Math.min(SPUR.reach * share, room(way));
      if (reach < SPUR.minReach || clearance(way, reach) < SPUR.clear * reach || !free(way, reach)) continue;
      best = { way, reach };
      break;
    }
    if (best) break;
  }
  if (!best) return null;

  const spur = { from, to, at, reach: best.reach, side: best.way };
  const points: PathPoint[] = [];
  for (let k = 0; k <= SPUR.samples; k += 1) {
    const path = from + ((to - from) * k) / SPUR.samples;
    const point = pathPoint(panel, path);
    const offset = spurOffset(spur, path);
    points.push({ x: point.x + best.way.x * offset, z: point.z + best.way.z * offset, s: point.s });
  }
  return { ...spur, points };
}

/** A cairn stands behind its step's mark and to its right, this far from it. It is 0.36 wide and 0.30 tall. */
export const CAIRN = { aside: 0.13, back: 0.2, half: 0.18, height: 0.3 } as const;

/** Where the cairn of a step that has something to review stands. */
export function cairnSpot(mark: PanelPoint): PanelPoint {
  return { x: mark.x + CAIRN.aside, z: Math.max(MODEL.z0 + 0.1, mark.z - CAIRN.back) };
}

/** The route of a panel as points from crease to crease, for the ribbon and the print. */
export function panelRoutePoints(panel: PanelPlan): PathPoint[] {
  const lead = panel.first ? 0 : STRIP.margin;
  const points: PathPoint[] = [];
  if (!panel.first) {
    for (let k = 0; k < 6; k += 1) points.push({ x: (STRIP.margin * k) / 6, z: STRIP.routeZ, s: (STRIP.margin * k) / 6 });
  }
  for (const point of panel.route.points) points.push({ x: point.x, z: point.z, s: lead + point.s });
  if (!panel.last) {
    for (let k = 1; k <= 6; k += 1) {
      points.push({ x: panel.route.frame.x1 + (STRIP.margin * k) / 6, z: STRIP.routeZ, s: lead + panel.route.length + (STRIP.margin * k) / 6 });
    }
  }
  return points;
}

function surfaceAt(print: SheetPrint, height: number): SurfaceKind {
  const count = print.surfaces.length;
  if (count === 0) return 'grass';
  return print.surfaces[Math.min(count - 1, Math.max(0, Math.floor(height * count)))] as SurfaceKind;
}

/** A point just behind the route at a place on the path, where a sign can stand without hiding the walker. */
function beside(panel: { route: StripRoute }, at: number, back: number, along = 0, edge = 0.3): PanelPoint {
  const point = stripPointAt(panel.route, at);
  const x = Math.min(PANEL.width - edge, Math.max(edge, point.x + along));
  // Behind the route where the thing stands, not where the walker is when he reaches it.
  let z = point.z;
  for (const other of panel.route.points) {
    if (Math.abs(other.x - x) < 0.5) z = Math.min(z, other.z);
  }
  return { x, z: Math.max(MODEL.z0 + 0.12, z - back) };
}

export interface PlanOptions {
  readonly progress?: Progress | null;
  readonly phone?: boolean;
}

/** Plans the whole walk of a roadmap. The same roadmap always gives the same plan. */
export function planWalk(roadmap: Roadmap, options: PlanOptions = {}): WalkPlan {
  const phone = options.phone ?? false;
  const data = deriveSheet({ roadmap, progress: options.progress ?? null });
  const print = tracePrint(data, phone);
  const count = clampPanels(roadmap.stages.length);
  const panels: PanelPlan[] = [];
  let start = 0;
  let minutes = 0;
  for (let index = 0; index < Math.min(count, roadmap.stages.length); index += 1) {
    const stage = roadmap.stages[index] as Stage;
    const trek = data.trek.stages[index] as TrekStage;
    const first = index === 0;
    const last = index === roadmap.stages.length - 1 || index === count - 1;
    const route = stripRoute(print.trail, index, stripFrame(print.trail, index));
    const ground = stripGround(print.heightfield, route, phone);
    const cards = stripCards(ground, phone);

    const heights = route.points.map((point) => point.h).sort((a, b) => a - b);
    const surface = surfaceAt(print, heights[Math.floor(heights.length / 2)] ?? 0);
    const cardSurfaces = cards.heights.map((height) => surfaceAt(print, height + cards.step / 2));

    // The signs stand where the route says, so they are placed first and the side trails keep clear of them.
    const board = beside({ route }, PLACE.board, 0.36, 0.34, 0.68);
    const signpost = beside({ route }, PLACE.signpost, 0.32, -0.28, 1.15);
    const camp = beside({ route }, PLACE.camp, 0.62, -0.5, 0.75);
    const signs: Obstacle[] = [
      { ...board, ...SPUR.signs.board },
      { ...signpost, ...SPUR.signs.signpost },
      { ...camp, ...SPUR.signs.camp },
    ];

    const marks: PanelMark[] = [];
    const steps = stageItems(stage).filter((span) => span.item.kind === 'waypoint');
    steps.forEach((span, order) => {
      if (span.item.kind !== 'waypoint') return;
      const waypoint = stage.waypoints[span.item.index] as Waypoint;
      const point = stripPointAt(route, span.at);
      const on = { x: point.x, z: point.z };
      minutes += Math.max(0, waypoint.minutes);
      // An optional step stands off the route, at the far point of its own spur.
      const spur = waypoint.optional === true ? planSpur({ first, last, route }, span.at, steps[order - 1]?.at ?? 0, steps[order + 1]?.at ?? PLACE.signpost, signs) : null;
      const off = spur ? { x: spur.side.x * spur.reach, z: spur.side.z * spur.reach } : { x: 0, z: 0 };
      marks.push({ waypoint, index: span.item.index, at: span.at, x: on.x + off.x, z: on.z + off.z, minutesAfter: minutes, on, spur });
    });

    const length = (first ? 0 : STRIP.margin) + route.length + (last ? 0 : STRIP.margin);
    panels.push({
      index,
      stage,
      trek,
      first,
      last,
      route,
      ground,
      cards,
      surface,
      cardSurfaces,
      marks,
      board,
      signpost,
      camp,
      length,
      start,
      seed: `${data.map.seed}/panel-${index}`,
    });
    start += length;
  }
  return { data, print, roadmap, panels, windows: stageWindows(roadmap), schedule: foldSchedule(count), length: start };
}

export interface WalkPlace {
  /** Index of the panel the walker is on. */
  readonly panel: number;
  /** Share of the stage's window, 0 to 1. */
  readonly f: number;
  /** Place on the panel's path, -1 to 2. */
  readonly path: number;
  /** Where he stands: on the route, or on the side trail of an optional step. */
  readonly point: PathPoint;
  /** Length of the route walked on the whole map. */
  readonly length: number;
  /** Share of the roadmap's minutes that lie behind the walker. */
  readonly along: number;
  readonly item: ItemHit;
}

/** Where the walker is at walk progress `p`. */
export function placeAt(plan: WalkPlan, p: number): WalkPlace {
  const { stage, f } = stageAt(p, plan.windows);
  const panel = plan.panels[Math.min(plan.panels.length - 1, stage)] as PanelPlan;
  const path = pathAt(panel.stage, f, panel.first, panel.last);
  const point = walkPoint(panel, path);
  const total = plan.data.trek.totalMinutes;
  const minute = panel.trek.startMinute + panel.trek.minutes * minutesShareAt(path);
  return { panel: panel.index, f, path, point, length: panel.start + point.s, along: total > 0 ? Math.min(1, Math.max(0, minute / total)) : 0, item: itemAt(panel.stage, f) };
}

export interface HerePlace {
  readonly panel: number;
  readonly path: number;
  readonly point: PathPoint;
  readonly length: number;
}

/** Where a share of the roadmap's minutes lies on the map: the place of the pin. 1 is the summit camp. */
export function hereAt(plan: WalkPlan, along: number): HerePlace {
  const total = plan.data.trek.totalMinutes;
  const share = Math.min(1, Math.max(0, along));
  const lastPanel = plan.panels[plan.panels.length - 1] as PanelPlan;
  if (share >= 1 - 1e-9 || total <= 0) {
    const path = total <= 0 ? 0 : 1;
    const panel = total <= 0 ? (plan.panels[0] as PanelPlan) : lastPanel;
    const point = pathPoint(panel, path);
    return { panel: panel.index, path, point, length: panel.start + point.s };
  }
  const minute = share * total;
  let panel = lastPanel;
  for (const candidate of plan.panels) {
    if (minute < candidate.trek.endMinute - 1e-9) {
      panel = candidate;
      break;
    }
  }
  const within = panel.trek.minutes > 0 ? (minute - panel.trek.startMinute) / panel.trek.minutes : 0;
  const path = pathForMinutes(within);
  const point = pathPoint(panel, path);
  return { panel: panel.index, path, point, length: panel.start + point.s };
}

/** The class flag stands this far along from its place on the route, and never nearer than `edge` to a crease. */
export const FLAG = { aside: 0.07, edge: 0.1 } as const;

export interface FlagPlace {
  readonly panel: number;
  /** The place on the route the flag belongs to. */
  readonly on: PathPoint;
  /** Where it stands: a little along from that place, so a pin at the same place is not hidden by it. */
  readonly point: PanelPoint;
}

/**
 * Where the class flag stands for a share of the roadmap's minutes. It is always on the route, never on a side
 * trail: a class walks the route together.
 */
export function flagAt(plan: WalkPlan, along: number): FlagPlace {
  const here = hereAt(plan, along);
  return { panel: here.panel, on: here.point, point: { x: Math.min(PANEL.width - FLAG.edge, here.point.x + FLAG.aside), z: here.point.z } };
}

/** Walk progress at which the walker has a share of the roadmap's minutes behind him. */
export function progressForAlong(plan: WalkPlan, along: number): number {
  const total = plan.data.trek.totalMinutes;
  const minute = Math.min(1, Math.max(0, along)) * total;
  let panel = plan.panels[plan.panels.length - 1] as PanelPlan;
  for (const candidate of plan.panels) {
    if (minute < candidate.trek.endMinute - 1e-9) {
      panel = candidate;
      break;
    }
  }
  const within = panel.trek.minutes > 0 ? Math.min(1, Math.max(0, (minute - panel.trek.startMinute) / panel.trek.minutes)) : 0;
  return progressAt({ stage: panel.index, f: fForMinutes(panel.stage, within, panel.first, panel.last) }, plan.windows);
}

/** Walk progress at which the walker stands on an item: the middle of its share of the stage. */
export function progressForItem(plan: WalkPlan, match: (item: WalkItem) => boolean): number | null {
  for (const panel of plan.panels) {
    for (const span of stageItems(panel.stage)) {
      if (!match(span.item)) continue;
      // The moment he stands there: the middle of a waypoint's share, and the fixed moments of the signpost and the camp.
      const f = span.item.kind === 'waypoint' ? (span.from + span.to) / 2 : span.item.kind === 'signpost' ? SHARE.waypoints + SHARE.signpost / 2 : 1 - SHARE.camp / 2;
      return progressAt({ stage: panel.index, f }, plan.windows);
    }
  }
  return null;
}
