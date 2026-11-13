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

export interface PanelMark extends PanelPoint {
  readonly waypoint: Waypoint;
  readonly index: number;
  /** Where the mark is on the panel's path, 0 at the first stop and 1 at the camp. */
  readonly at: number;
  /** Minutes of the whole roadmap that lie behind the walker when he has finished this step. */
  readonly minutesAfter: number;
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

/** A place on a panel's path: -1 the crease he comes in over, 0 the first stop, 1 the camp, 2 the crease he leaves over. */
export function pathPoint(panel: PanelPlan, path: number): PathPoint {
  const lead = panel.first ? 0 : STRIP.margin;
  const q = Math.min(panel.last ? 1 : 2, Math.max(panel.first ? 0 : -1, path));
  if (q < 0) return { x: STRIP.margin * (1 + q), z: STRIP.routeZ, s: STRIP.margin * (1 + q) };
  if (q <= 1) {
    const point = stripPointAt(panel.route, q);
    return { x: point.x, z: point.z, s: lead + point.s };
  }
  return { x: panel.route.frame.x1 + STRIP.margin * (q - 1), z: STRIP.routeZ, s: lead + panel.route.length + STRIP.margin * (q - 1) };
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

    const marks: PanelMark[] = [];
    for (const span of stageItems(stage)) {
      if (span.item.kind !== 'waypoint') continue;
      const waypoint = stage.waypoints[span.item.index] as Waypoint;
      const point = stripPointAt(route, span.at);
      minutes += Math.max(0, waypoint.minutes);
      marks.push({ waypoint, index: span.item.index, at: span.at, x: point.x, z: point.z, minutesAfter: minutes });
    }

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
      board: beside({ route }, PLACE.board, 0.36, 0.34, 0.68),
      signpost: beside({ route }, PLACE.signpost, 0.32, -0.28, 1.15),
      camp: beside({ route }, PLACE.camp, 0.62, -0.5, 0.75),
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
  const point = pathPoint(panel, path);
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
