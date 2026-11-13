/**
 * Validation of a roadmap file: the schema (shape, types, unknown fields) first, then the rules a schema cannot
 * express (ids, references, cycles, verified sources, practice share, dates). Errors make the file unusable,
 * warnings are advice. Every message is written for a person, not for a program.
 */
import { daysBetween, parseDay } from './dates';
import { allWaypoints, stageRequires, waypointRequires } from './graph';
import { checkSchema, closest, describePath, pointer } from './schema-check';
import { TIER_NAMES } from '../scene/palette';
import type { Check, Issue, Roadmap } from './types';

export type { Issue } from './types';

export type ValidationResult =
  | { readonly ok: true; readonly roadmap: Roadmap; readonly warnings: Issue[] }
  | { readonly ok: false; readonly errors: Issue[]; readonly warnings: Issue[] };

/** A stage should hold at least this share of hands-on minutes. */
export const MIN_STAGE_PRACTICE = 0.6;
/** The whole roadmap should reach this share. */
export const MIN_TOTAL_PRACTICE = 0.7;
/** Hard cap on resources per roadmap (the resource policy). */
export const MAX_RESOURCES = 45;

export function validateRoadmap(input: unknown): ValidationResult {
  const shape = checkSchema(input);
  if (shape.length > 0) return { ok: false, errors: shape, warnings: [] };

  const roadmap = input as Roadmap;
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  lint(roadmap, errors, warnings);
  if (errors.length > 0) return { ok: false, errors, warnings };
  return { ok: true, roadmap, warnings };
}

function lint(roadmap: Roadmap, errors: Issue[], warnings: Issue[]): void {
  const error = (path: string, text: string): void => {
    errors.push({ path, message: `${describePath(path)} ${text}` });
  };
  const warn = (path: string, text: string): void => {
    warnings.push({ path, message: `${describePath(path)} ${text}` });
  };

  // 1. Ids are unique. Stages and waypoints share one namespace so "show me the shelf for x" is never ambiguous.
  const routeIds = new Map<string, string>();
  const claim = (id: string, path: string): void => {
    const first = routeIds.get(id);
    if (first !== undefined) {
      error(path, `reuses the id "${id}", which ${describePath(first.replace(/\/id$/, ''))} already has. Stage and waypoint ids must all be different.`);
    } else {
      routeIds.set(id, path);
    }
  };
  roadmap.stages.forEach((stage, si) => {
    claim(stage.id, pointer('stages', si, 'id'));
    stage.waypoints.forEach((waypoint, wi) => claim(waypoint.id, pointer('stages', si, 'waypoints', wi, 'id')));
  });

  const resourceIds = new Map<string, string>();
  roadmap.resources.forEach((resource, ri) => {
    const path = pointer('resources', ri, 'id');
    const first = resourceIds.get(resource.id);
    if (first !== undefined) {
      error(path, `reuses the id "${resource.id}", which ${describePath(first.replace(/\/id$/, ''))} already has. Resource ids must be different.`);
    } else {
      resourceIds.set(resource.id, path);
    }
  });

  const stageIds = new Set(roadmap.stages.map((s) => s.id));
  const waypointIds = new Set(allWaypoints(roadmap).map((n) => n.waypoint.id));
  const resourceById = new Map(roadmap.resources.map((r) => [r.id, r]));

  // 2. Every reference resolves.
  const resolves = (id: string, known: ReadonlySet<string>, path: string, noun: string, hint?: (id: string) => string | null): boolean => {
    if (known.has(id)) return true;
    const guess = closest(id, [...known]);
    const extra = hint?.(id) ?? (guess ? ` Did you mean "${guess}"?` : '');
    error(path, `points to "${id}", but there is no ${noun} with that id.${extra}`);
    return false;
  };
  const asStageHint = (id: string): string | null => (stageIds.has(id) ? ' That is a stage id; waypoints can only wait for waypoints.' : null);
  const asWaypointHint = (id: string): string | null => (waypointIds.has(id) ? ' That is a waypoint id; stages can only wait for stages.' : null);

  const checkMisses = (checks: readonly Check[] | undefined, base: string): void => {
    checks?.forEach((check, ci) => {
      if (check.onMiss !== undefined) resolves(check.onMiss, waypointIds, `${base}/checks/${ci}/onMiss`, 'waypoint');
      if (check.options && check.correct !== undefined && check.correct >= check.options.length) {
        error(`${base}/checks/${ci}/correct`, `is ${check.correct}, but there are only ${check.options.length} options (counting from 0).`);
      }
    });
  };

  if (roadmap.brief.entry !== undefined) resolves(roadmap.brief.entry, stageIds, '/brief/entry', 'stage', asWaypointHint);

  const usedResources = new Set<string>();
  roadmap.stages.forEach((stage, si) => {
    stage.requires?.forEach((id, k) => resolves(id, stageIds, pointer('stages', si, 'requires', k), 'stage', asWaypointHint));
    checkMisses(stage.checkpoint.checks, pointer('stages', si, 'checkpoint'));
    stage.waypoints.forEach((waypoint, wi) => {
      const base = pointer('stages', si, 'waypoints', wi);
      waypoint.requires?.forEach((id, k) => resolves(id, waypointIds, `${base}/requires/${k}`, 'waypoint', asStageHint));
      waypoint.resources.forEach((id, k) => {
        if (resolves(id, new Set(resourceById.keys()), `${base}/resources/${k}`, 'resource')) usedResources.add(id);
      });
      checkMisses(waypoint.checks, base);
    });
    stage.project?.resources?.forEach((id, k) => {
      if (resolves(id, new Set(resourceById.keys()), pointer('stages', si, 'project', 'resources', k), 'resource')) usedResources.add(id);
    });
  });
  roadmap.class?.sessions?.forEach((session, ci) => {
    const base = pointer('class', 'sessions', ci);
    session.inClass.forEach((id, k) => resolves(id, waypointIds, `${base}/inClass/${k}`, 'waypoint', asStageHint));
    session.homework?.forEach((id, k) => resolves(id, waypointIds, `${base}/homework/${k}`, 'waypoint', asStageHint));
  });

  // 3. No prerequisite cycles.
  findCycles(roadmap, error);

  // 4. Every resource is used.
  roadmap.resources.forEach((resource, ri) => {
    if (!usedResources.has(resource.id)) {
      error(pointer('resources', ri), `("${resource.id}") sits on the shelf, but no waypoint or project uses it. Use it in a step or remove it.`);
    }
  });

  // 5. Every waypoint rests on a verified resource or says why not.
  roadmap.stages.forEach((stage, si) => {
    stage.waypoints.forEach((waypoint, wi) => {
      const verified = waypoint.resources.some((id) => resourceById.get(id)?.check.status === 'verified');
      if (!verified && !waypoint.gap) {
        error(
          pointer('stages', si, 'waypoints', wi, 'resources'),
          `has no verified source and no "gap" note. Add a resource that was opened and read, or write a "gap" line that says no source could be verified.`,
        );
      }
      if (waypoint.practiceMinutes > waypoint.minutes) {
        error(
          pointer('stages', si, 'waypoints', wi, 'practiceMinutes'),
          `is ${waypoint.practiceMinutes}, more than the whole step (${waypoint.minutes} minutes). Practice time is part of the step's time.`,
        );
      }
    });
  });

  // 6. Practice share: at least 60 percent in each stage, 70 percent overall (advice only).
  let totalMinutes = 0;
  let totalPractice = 0;
  roadmap.stages.forEach((stage, si) => {
    const minutes = stage.waypoints.reduce((sum, w) => sum + w.minutes, 0);
    const practice = stage.waypoints.reduce((sum, w) => sum + Math.min(w.practiceMinutes, w.minutes), 0);
    totalMinutes += minutes;
    totalPractice += practice;
    if (practice < minutes * MIN_STAGE_PRACTICE - 1e-9) {
      warn(
        pointer('stages', si),
        `("${stage.title}") has only ${Math.round((practice / minutes) * 100)} percent hands-on time. Aim for at least ${MIN_STAGE_PRACTICE * 100} percent: more doing, less reading.`,
      );
    }
  });
  if (totalMinutes > 0 && totalPractice < totalMinutes * MIN_TOTAL_PRACTICE - 1e-9) {
    warnings.push({
      path: '/stages',
      message: `Across all stages only ${Math.round((totalPractice / totalMinutes) * 100)} percent of the time is hands-on. Aim for at least ${MIN_TOTAL_PRACTICE * 100} percent.`,
    });
  }

  // 7. Dates.
  const { startDate, deadline } = roadmap.brief;
  if (startDate !== undefined && deadline !== undefined) {
    const start = parseDay(startDate);
    const end = parseDay(deadline);
    if (start !== null && end !== null && end <= start) {
      error('/brief/deadline', `(${deadline}) must be after the start date (${startDate}).`);
    }
  }
  if (roadmap.class?.sessions) {
    const dated = roadmap.class.sessions.map((s, i) => ({ date: s.date, i })).filter((s) => s.date !== undefined);
    for (let k = 1; k < dated.length; k += 1) {
      const before = dated[k - 1];
      const now = dated[k];
      if (before && now && daysBetween(before.date as string, now.date as string) < 0) {
        warn(pointer('class', 'sessions', now.i, 'date'), `(${now.date}) is earlier than the session before it (${before.date}).`);
      }
    }
  }

  // Advice that does not stop the file from working.
  let highest = -1;
  roadmap.stages.forEach((stage, si) => {
    const rank = TIER_NAMES.indexOf(stage.tier);
    if (rank < highest) {
      warn(pointer('stages', si, 'tier'), `is ${stage.tier}, lower than an earlier stage. The route should only climb.`);
    }
    highest = Math.max(highest, rank);
  });
  const topTier = TIER_NAMES[Math.max(highest, 0)];
  if (topTier !== undefined && topTier !== roadmap.brief.targetTier) {
    warn('/brief/targetTier', `is ${roadmap.brief.targetTier}, but the last stage reaches ${topTier}. The summit and the goal should match.`);
  }
  if (roadmap.resources.length > MAX_RESOURCES) {
    warn('/resources', `has ${roadmap.resources.length} entries. More than ${MAX_RESOURCES} is too many to be checked and read.`);
  }
  roadmap.resources.forEach((resource, ri) => {
    const { status, http } = resource.check;
    if (status === 'verified' && (http === null || http < 200 || http > 299)) {
      warn(pointer('resources', ri, 'check', 'http'), `is ${http === null ? 'empty' : http}, but the source is marked verified. Verified means it opened with a success status.`);
    }
    if (resource.cost === 'free' && resource.price !== undefined) {
      warn(pointer('resources', ri, 'price'), 'is given, but the resource is marked free.');
    }
  });
  if (roadmap.brief.audience === 'teacher' && roadmap.class === undefined) {
    warn('/class', 'is missing. A roadmap for a teacher normally describes the class.');
  }
}

interface Edge {
  readonly to: string;
  readonly path: string;
}

/** Depth-first search over the "waits for" graph. Each cycle is reported once, at the entry that closes it. */
function findCycles(roadmap: Roadmap, error: (path: string, text: string) => void): void {
  const stageEdges = new Map<string, Edge[]>();
  roadmap.stages.forEach((stage, si) => {
    const explicit = stage.requires !== undefined;
    const edges = stageRequires(roadmap, si)
      .filter((id) => roadmap.stages.some((s) => s.id === id))
      .map((to, k) => ({ to, path: explicit ? pointer('stages', si, 'requires', k) : pointer('stages', si) }));
    stageEdges.set(stage.id, edges);
  });
  const stageCycles = walk(stageEdges, 'stage', error);

  // A waypoint also waits for every main-route waypoint of the stages its stage waits for.
  const waypointEdges = new Map<string, Edge[]>();
  const mainWaypointsOf = new Map(roadmap.stages.map((s) => [s.id, s.waypoints.filter((w) => !w.optional).map((w) => w.id)]));
  roadmap.stages.forEach((stage, si) => {
    stage.waypoints.forEach((waypoint, wi) => {
      const base = pointer('stages', si, 'waypoints', wi);
      const explicit = waypoint.requires !== undefined;
      const edges: Edge[] = waypointRequires(stage, wi)
        .filter((id) => !roadmap.stages.some((s) => s.id === id))
        .map((to, k) => ({ to, path: explicit ? `${base}/requires/${k}` : base }));
      if (!stageCycles) {
        stageRequires(roadmap, si).forEach((stageId, k) => {
          for (const to of mainWaypointsOf.get(stageId) ?? []) {
            edges.push({ to, path: stage.requires ? pointer('stages', si, 'requires', k) : pointer('stages', si) });
          }
        });
      }
      waypointEdges.set(waypoint.id, edges);
    });
  });
  walk(waypointEdges, 'step', error);
}

function walk(graph: ReadonlyMap<string, readonly Edge[]>, noun: string, error: (path: string, text: string) => void): boolean {
  const state = new Map<string, 'open' | 'done'>();
  const stack: string[] = [];
  const taken: Edge[] = []; // taken[i] is the edge from stack[i] to stack[i + 1]
  let found = false;
  const visit = (id: string): void => {
    state.set(id, 'open');
    stack.push(id);
    for (const edge of graph.get(id) ?? []) {
      const seen = state.get(edge.to);
      if (seen === 'open') {
        found = true;
        const from = stack.indexOf(edge.to);
        const loop = [...stack.slice(from), edge.to].map((x) => `"${x}"`).join(' → ');
        // Point at a prerequisite the author wrote, not at a default, when the circle contains one.
        const around = [...taken.slice(from), edge];
        const culprit = around.find((e) => e.path.includes('/requires/')) ?? edge;
        error(culprit.path, `is part of a circle of ${noun}s that wait for each other: ${loop}. Remove one of the prerequisites so the route has a start.`);
      } else if (seen === undefined) {
        taken.push(edge);
        visit(edge.to);
        taken.pop();
      }
    }
    stack.pop();
    state.set(id, 'done');
  };
  for (const id of graph.keys()) {
    if (!state.has(id)) visit(id);
  }
  return found;
}
