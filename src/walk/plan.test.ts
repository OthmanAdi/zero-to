import { describe, expect, it } from 'vitest';
import { missingKeys } from '../i18n';
import { emptyProgress, markDone } from '../roadmap/progress';
import german from '../roadmap/samples/deutsch-a1-von-null.json';
import langgraph from '../roadmap/samples/langgraph-for-a-python-dev.json';
import music from '../roadmap/samples/music-theory-for-a-class.json';
import photography from '../roadmap/samples/photography-basics.json';
import rust from '../roadmap/samples/rust-for-a-python-dev.json';
import statistics from '../roadmap/samples/statistics-for-data-work.json';
import { TERRAIN_KINDS, TRAIL_KINDS, type Roadmap, type Stage } from '../roadmap/types';
import { PANEL } from './fold';
import { hereAt, panelRoutePoints, pathPoint, placeAt, planWalk, progressForAlong, progressForItem, type WalkPlan } from './plan';
import { WALK_STRINGS } from './strings';
import { MODEL, STRIP } from './strip';
import { WALK, itemAt, stageAt } from './timeline';

const SAMPLES = [rust, german, photography, langgraph, music, statistics] as unknown as Roadmap[];
const sample = (id: string): Roadmap => structuredClone(SAMPLES.find((entry) => entry.id === id)) as Roadmap;

function withStages(roadmap: Roadmap, count: number): Roadmap {
  const stages = Array.from({ length: count }, (_, index) => {
    const source = roadmap.stages[index % roadmap.stages.length] as Stage;
    if (index < roadmap.stages.length) return source;
    return { ...source, id: `${source.id}-${index}`, waypoints: source.waypoints.map((waypoint) => ({ ...waypoint, id: `${waypoint.id}-${index}` })) };
  });
  return { ...roadmap, stages };
}

/** Everything a plan must hold for the walk to be drawable. Returns the problems it finds. */
function problemsOf(plan: WalkPlan): string[] {
  const problems: string[] = [];
  let start = 0;
  plan.panels.forEach((panel, index) => {
    const label = `panel ${index}`;
    if (Math.abs(panel.start - start) > 1e-9) problems.push(`${label}: starts at ${panel.start}, not ${start}`);
    start += panel.length;
    const points = panel.route.points;
    for (let k = 1; k < points.length; k += 1) {
      const a = points[k - 1] as { x: number };
      const b = points[k] as { x: number; z: number };
      if (!(b.x > a.x)) problems.push(`${label}: the route turns back at point ${k}`);
      if (Math.abs(b.z - STRIP.routeZ) > STRIP.band / 2 + 1e-9) problems.push(`${label}: the route leaves its band at point ${k}`);
    }
    if (panel.cards.count < MODEL.minCards || panel.cards.count > MODEL.maxCards) problems.push(`${label}: ${panel.cards.count} cards`);
    if (panel.cardSurfaces.length !== panel.cards.count) problems.push(`${label}: a card has no ground`);
    if (panel.marks.length !== panel.stage.waypoints.length) problems.push(`${label}: ${panel.marks.length} marks for ${panel.stage.waypoints.length} waypoints`);
    let previous = -Infinity;
    for (const mark of panel.marks) {
      if (!(mark.x > previous)) problems.push(`${label}: the marks are out of order`);
      previous = mark.x;
      if (mark.x < MODEL.x0 || mark.x > MODEL.x1 || mark.z < MODEL.z0 || mark.z > MODEL.z1) problems.push(`${label}: a mark lies off the model`);
    }
    for (const [name, point] of [['board', panel.board], ['signpost', panel.signpost], ['camp', panel.camp]] as const) {
      if (point.x < 0.25 || point.x > PANEL.width - 0.25 || point.z < MODEL.z0 || point.z > MODEL.z1) problems.push(`${label}: the ${name} stands off the panel`);
    }
    const ribbon = panelRoutePoints(panel);
    if (Math.abs((ribbon[ribbon.length - 1] as { s: number }).s - panel.length) > 1e-6) problems.push(`${label}: the ribbon is not as long as the panel's route`);
    if (!panel.first && (ribbon[0] as { x: number }).x !== 0) problems.push(`${label}: the route does not start on the crease`);
    if (!panel.last && Math.abs((ribbon[ribbon.length - 1] as { x: number }).x - PANEL.width) > 1e-9) problems.push(`${label}: the route does not end on the crease`);
  });
  if (Math.abs(plan.length - start) > 1e-9) problems.push('the lengths do not add up');
  return problems;
}

describe('planWalk', () => {
  it('builds a roadmap with 2 stages and one with 8', () => {
    const two = planWalk(sample('photography-basics'), { phone: true });
    expect(two.panels).toHaveLength(2);
    expect(two.schedule.creases).toHaveLength(1);
    expect(problemsOf(two)).toEqual([]);
    expect(two.panels[0]?.first).toBe(true);
    expect(two.panels[1]?.last).toBe(true);

    const eight = planWalk(sample('deutsch-a1-von-null'), { phone: true });
    expect(eight.panels).toHaveLength(8);
    expect(eight.schedule.creases).toHaveLength(7);
    expect(problemsOf(eight)).toEqual([]);
    expect(eight.windows.stages).toHaveLength(8);
  }, 120_000);

  it('plans every gallery sample', () => {
    for (const roadmap of SAMPLES) {
      const plan = planWalk(structuredClone(roadmap) as Roadmap, { phone: true });
      expect(plan.panels).toHaveLength(roadmap.stages.length);
      expect(problemsOf(plan), roadmap.id).toEqual([]);
    }
  }, 120_000);

  it('keeps the route inside every panel for every terrain and trail, with 2, 5 and 8 stages', () => {
    const base = sample('rust-for-a-python-dev');
    for (const terrain of TERRAIN_KINDS) {
      for (const trail of TRAIL_KINDS) {
        for (const count of [2, 5, 8]) {
          const roadmap: Roadmap = { ...withStages(base, count), map: { terrain, trail, seed: `${terrain}/${trail}/${count}`, surfaces: 'auto' } };
          const plan = planWalk(roadmap, { phone: true });
          expect(plan.panels, `${terrain}/${trail}/${count}`).toHaveLength(count);
          expect(problemsOf(plan), `${terrain}/${trail}/${count}`).toEqual([]);
        }
      }
    }
  }, 300_000);

  it('is the same plan for the same roadmap', () => {
    const a = planWalk(sample('photography-basics'), { phone: true });
    const b = planWalk(sample('photography-basics'), { phone: true });
    expect(a.panels.map((panel) => panel.route.points)).toEqual(b.panels.map((panel) => panel.route.points));
    expect(a.panels.map((panel) => panel.cardSurfaces)).toEqual(b.panels.map((panel) => panel.cardSurfaces));
  }, 120_000);
});

describe('the walker on the plan', () => {
  const plan = planWalk(sample('rust-for-a-python-dev'), { phone: true });

  it('walks forward the whole way and crosses every crease without a jump', () => {
    let previous = placeAt(plan, 0);
    expect(previous.length).toBe(0);
    expect(previous.panel).toBe(0);
    for (let step = 1; step <= 3000; step += 1) {
      const place = placeAt(plan, step / 3000);
      expect(place.length).toBeGreaterThanOrEqual(previous.length - 1e-9);
      expect(place.length - previous.length).toBeLessThan(0.12);
      expect(place.along).toBeGreaterThanOrEqual(previous.along - 1e-9);
      previous = place;
    }
    expect(previous.length).toBeCloseTo(plan.length, 6);
    expect(previous.along).toBe(1);
    expect(previous.panel).toBe(plan.panels.length - 1);
  });

  it('is at the same length on both sides of a crease', () => {
    for (let index = 0; index < plan.panels.length - 1; index += 1) {
      const left = plan.panels[index] as (typeof plan.panels)[number];
      const right = plan.panels[index + 1] as (typeof plan.panels)[number];
      const out = pathPoint(left, 2);
      const into = pathPoint(right, -1);
      expect(out.x).toBeCloseTo(PANEL.width, 9);
      expect(into.x).toBe(0);
      expect(out.z).toBeCloseTo(into.z, 9);
      expect(left.start + out.s).toBeCloseTo(right.start + into.s, 9);
    }
  });

  it('puts the pin at the gate, at the start of an open stage and on the summit', () => {
    const gate = hereAt(plan, 0);
    expect(gate.panel).toBe(0);
    expect(gate.length).toBe(0);
    expect(gate.point.x).toBeCloseTo(STRIP.margin, 9);
    const summit = hereAt(plan, 1);
    expect(summit.panel).toBe(plan.panels.length - 1);
    expect(summit.length).toBeCloseTo(plan.length, 9);
    // The end of one stage is the start of the next: the pin stands on the next panel.
    const second = plan.panels[1] as (typeof plan.panels)[number];
    const boundary = hereAt(plan, second.trek.startMinute / plan.data.trek.totalMinutes);
    expect(boundary.panel).toBe(1);
    expect(boundary.path).toBeCloseTo(0, 9);
    let previous = -1;
    for (let step = 0; step <= 200; step += 1) {
      const here = hereAt(plan, step / 200);
      expect(here.length).toBeGreaterThanOrEqual(previous);
      previous = here.length;
    }
  });

  it('moves the pin with the progress it is given', () => {
    const roadmap = sample('rust-for-a-python-dev');
    let progress = emptyProgress(roadmap.id, roadmap.checkedOn);
    const first = roadmap.stages[0] as Stage;
    for (const waypoint of first.waypoints) progress = markDone(progress, roadmap, waypoint.id, '2026-11-13T09:00:00Z');
    const moved = planWalk(roadmap, { phone: true, progress });
    expect(moved.data.hereStage).toBe(1);
    expect(hereAt(moved, moved.data.hereMinuteShare).panel).toBe(1);
  });

  it('finds the progress for a share of the minutes, for a waypoint, a signpost and a camp', () => {
    for (const share of [0, 0.1, 0.33, 0.5, 0.77, 0.95]) {
      expect(placeAt(plan, progressForAlong(plan, share)).along).toBeCloseTo(share, 3);
    }
    for (const stage of plan.roadmap.stages) {
      for (const waypoint of stage.waypoints) {
        const p = progressForItem(plan, (item) => item.kind === 'waypoint' && item.waypointId === waypoint.id);
        expect(p).not.toBeNull();
        const place = stageAt(p as number, plan.windows);
        const hit = itemAt(plan.roadmap.stages[place.stage] as Stage, place.f);
        expect(hit.item).toMatchObject({ kind: 'waypoint', waypointId: waypoint.id });
        expect(p as number).toBeGreaterThan(WALK.stages.from);
        expect(p as number).toBeLessThan(WALK.stages.to);
      }
      const sign = progressForItem(plan, (item) => item.kind === 'signpost' && item.stageId === stage.id);
      expect(sign).not.toBeNull();
      const camp = progressForItem(plan, (item) => item.kind === 'camp' && item.stageId === stage.id);
      expect(camp === null).toBe(!stage.project);
    }
    expect(progressForItem(plan, () => false)).toBeNull();
  });
});

describe('the words of the walk', () => {
  it('has every key in English and in German', () => {
    expect(missingKeys(WALK_STRINGS)).toEqual([]);
  });
});
