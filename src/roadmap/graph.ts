/**
 * Who has to be done before whom. Shared by the validator (cycles) and the progress model (you are here).
 *
 * Defaults from the schema: a stage requires the stage before it, a waypoint requires the waypoint before it in
 * the same stage. The first waypoint of a stage is gated by its stage, not by a waypoint.
 */
import type { Roadmap, Stage, Waypoint } from './types';

export interface WaypointNode {
  readonly stage: Stage;
  readonly stageIndex: number;
  readonly waypoint: Waypoint;
  readonly waypointIndex: number;
}

/** Every waypoint in route order. */
export function allWaypoints(roadmap: Roadmap): WaypointNode[] {
  const nodes: WaypointNode[] = [];
  roadmap.stages.forEach((stage, stageIndex) => {
    stage.waypoints.forEach((waypoint, waypointIndex) => {
      nodes.push({ stage, stageIndex, waypoint, waypointIndex });
    });
  });
  return nodes;
}

/** Stage ids a stage waits for. Default: the stage before; the first stage waits for nothing. */
export function stageRequires(roadmap: Roadmap, stageIndex: number): readonly string[] {
  const stage = roadmap.stages[stageIndex];
  if (!stage) return [];
  if (stage.requires) return stage.requires;
  const before = roadmap.stages[stageIndex - 1];
  return before ? [before.id] : [];
}

/** Waypoint ids a waypoint waits for. Default: the waypoint before it in the same stage. */
export function waypointRequires(stage: Stage, waypointIndex: number): readonly string[] {
  const waypoint = stage.waypoints[waypointIndex];
  if (!waypoint) return [];
  if (waypoint.requires) return waypoint.requires;
  const before = stage.waypoints[waypointIndex - 1];
  return before ? [before.id] : [];
}
