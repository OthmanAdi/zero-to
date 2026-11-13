import { deriveTrek, mapSpec, type MapSpec, type Trek } from '../roadmap/derive';
import { checkpointPassed, emptyProgress, summarise, youAreHere, type Progress } from '../roadmap/progress';
import type { Roadmap, SurfaceKind, TierName } from '../roadmap/types';
import {
  assignSurfaces,
  generateHeightfield,
  levelHeights,
  planTrail,
  traceContours,
  type ContourLevel,
  type Heightfield,
  type TerrainSpec,
  type Trail,
  type TrailSpec,
} from '../terrain';
import { GROW, cardCount, mountainHeight } from './grow';

/** One sheet on the table: a roadmap, what the learner did on it, and whether it is a gallery example. */
export interface SheetSpec {
  readonly roadmap: Roadmap;
  readonly progress?: Progress | null;
  /** True for a gallery example. The cover says so. */
  readonly example?: boolean;
}

/** Everything the table works out from a sheet's roadmap, once. */
export interface SheetData {
  readonly spec: SheetSpec;
  readonly roadmap: Roadmap;
  readonly trek: Trek;
  readonly map: MapSpec;
  /** The tier the roadmap aims for. It picks the cover cloth and the glow of the compass. */
  readonly tier: TierName;
  readonly summitAltitude: number;
  /** Height of the standing model in scene units. */
  readonly height: number;
  readonly cards: number;
  readonly stageCount: number;
  readonly totalMinutes: number;
  /** Finished minutes as a share of all minutes. */
  readonly share: number;
  /** You-are-here as a share of all minutes, 0 at the gate and 1 on the summit. */
  readonly hereMinuteShare: number;
  /** Index of the stage you-are-here lies in; equal to `stageCount` when the route is finished. */
  readonly hereStage: number;
  /** Indexes of the stages whose checkpoint is passed. */
  readonly passed: readonly number[];
  readonly terrain: TerrainSpec;
  readonly trail: TrailSpec;
  readonly surfaces: readonly SurfaceKind[] | 'auto';
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** Heights the trail's stops should have, 0 to 1 of the model: the gate, then every camp, the summit last. */
export function stopHeights(trek: Trek, cards: number): number[] {
  const summit = trek.summitAltitude > 0 ? trek.summitAltitude : 1;
  const foot = 1.5 / Math.max(3, cards);
  const heights = [foot];
  trek.stages.forEach((stage, index) => {
    const wanted = index === trek.stages.length - 1 ? 1 : clamp01(stage.campAltitude / summit);
    // Stops must rise, even when two camps share an altitude.
    heights.push(Math.min(1, Math.max(wanted, (heights[heights.length - 1] as number) + 0.02)));
  });
  return heights;
}

export function deriveSheet(spec: SheetSpec): SheetData {
  const roadmap = spec.roadmap;
  const trek = deriveTrek(roadmap);
  const map = mapSpec(roadmap);
  const progress = spec.progress ?? emptyProgress(roadmap.id, roadmap.checkedOn);
  const summitAltitude = trek.summitAltitude > 0 ? trek.summitAltitude : 0.25;
  const cards = cardCount(summitAltitude);
  const stageCount = roadmap.stages.length;

  // You are here: the start of the first waypoint that is still open.
  let hereMinute = trek.totalMinutes;
  let hereStage = stageCount;
  const here = youAreHere(roadmap, progress);
  if (here) {
    const stageIndex = roadmap.stages.findIndex((stage) => stage.id === here.stageId);
    const stage = roadmap.stages[stageIndex];
    const trekStage = trek.stages[stageIndex];
    if (stage && trekStage) {
      const at = stage.waypoints.findIndex((waypoint) => waypoint.id === here.waypointId);
      const before = stage.waypoints.slice(0, Math.max(0, at)).reduce((sum, waypoint) => sum + waypoint.minutes, 0);
      hereMinute = trekStage.startMinute + before;
      hereStage = stageIndex;
    }
  }

  return {
    spec,
    roadmap,
    trek,
    map,
    tier: roadmap.brief.targetTier,
    summitAltitude,
    height: mountainHeight(summitAltitude),
    cards,
    stageCount,
    totalMinutes: trek.totalMinutes,
    share: summarise(roadmap, progress).share,
    hereMinuteShare: trek.totalMinutes > 0 ? clamp01(hereMinute / trek.totalMinutes) : 0,
    hereStage,
    passed: roadmap.stages.flatMap((stage, index) => (checkpointPassed(roadmap, progress, stage.id) ? [index] : [])),
    terrain: { seed: map.seed, template: map.terrain },
    trail: { seed: map.seed, template: map.trail, stops: Math.min(12, Math.max(2, stageCount + 1)), stopHeights: stopHeights(trek, cards), footHeight: 1.5 / cards },
    surfaces: map.surfaces,
  };
}

/**
 * A share of all minutes turned into a share of the drawn trail. The trail's stops are the camps, so the walk
 * between two camps is spread evenly over the stage's minutes.
 */
export function trailAlong(data: Pick<SheetData, 'trek'>, stopsAlong: readonly number[], minuteShare: number): number {
  const { trek } = data;
  if (trek.totalMinutes <= 0 || stopsAlong.length < 2) return clamp01(minuteShare);
  const minute = clamp01(minuteShare) * trek.totalMinutes;
  for (let index = 0; index < trek.stages.length; index += 1) {
    const stage = trek.stages[index];
    if (!stage) continue;
    if (minute <= stage.endMinute || index === trek.stages.length - 1) {
      const from = stopsAlong[Math.min(index, stopsAlong.length - 1)] as number;
      const to = stopsAlong[Math.min(index + 1, stopsAlong.length - 1)] as number;
      const within = stage.minutes > 0 ? clamp01((minute - stage.startMinute) / stage.minutes) : 0;
      return clamp01(from + (to - from) * within);
    }
  }
  return 1;
}

/** The stage whose altitude band holds a contour card (0 is the bottom card). */
export function stageOfCard(data: Pick<SheetData, 'trek' | 'cards' | 'summitAltitude'>, card: number): number {
  const stages = data.trek.stages;
  if (stages.length === 0) return -1;
  const altitude = ((Math.min(data.cards - 1, Math.max(0, card)) + 0.5) / data.cards) * data.summitAltitude;
  for (let index = 0; index < stages.length; index += 1) {
    if (altitude <= (stages[index]?.campAltitude ?? 0) + 1e-9) return index;
  }
  return stages.length - 1;
}

/** The share of all minutes at which a stage starts. A click on a card goes in there. */
export function stageStartShare(data: Pick<SheetData, 'trek'>, stageIndex: number): number {
  const stage = data.trek.stages[stageIndex];
  return stage && data.trek.totalMinutes > 0 ? clamp01(stage.startMinute / data.trek.totalMinutes) : 0;
}

/** The plain-data mountain of a sheet: what the model is cut from and what the cover prints. */
export interface SheetPrint {
  readonly heightfield: Heightfield;
  readonly levels: readonly ContourLevel[];
  readonly trail: Trail;
  /** The ground of each card, as the model assigns it. */
  readonly surfaces: readonly SurfaceKind[];
  /** Half the side of the paper in scene units: the footprint runs from -1 to 1 over twice this. */
  readonly half: number;
}

/** Half side of the paper of a model mounted on a square of `size`. */
export function paperHalf(size: number = GROW.size): number {
  return size / 2 - size * 0.03;
}

/**
 * Traces the level set the model of this sheet is cut from, with the same grid, the same cut heights and the
 * same trail, so that the cover prints exactly the lines its mountain grows out of.
 */
export function tracePrint(data: SheetData, phone: boolean): SheetPrint {
  const heightfield = generateHeightfield({ ...data.terrain, resolution: phone ? 65 : 129 });
  const levels = traceContours(heightfield, levelHeights(data.cards), { simplify: phone ? 0.005 : 0.003 });
  const trail = planTrail(heightfield, data.trail);
  const surfaces = assignSurfaces(levels, data.surfaces, data.terrain.seed, { template: heightfield.template });
  return { heightfield, levels, trail, surfaces, half: paperHalf() };
}
