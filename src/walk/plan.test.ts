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
import { FLAG, SPUR, flagAt, hereAt, panelRoutePoints, pathPoint, placeAt, planWalk, progressForAlong, progressForItem, spurOffset, walkPoint, type WalkPlan } from './plan';
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
      // The steps follow each other along the route. A mark on a side trail stands beside its place on the route.
      if (!(mark.on.x > previous)) problems.push(`${label}: the marks are out of order`);
      previous = mark.on.x;
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

describe('side trails', () => {
  /** A roadmap whose every stage has steps of every kind: first, last, two in a row and alone, optional or not. */
  function fixture(): Roadmap {
    const base = sample('rust-for-a-python-dev');
    const optional = new Set(['toolchain', 'borrowing', 'borrowing-examples', 'error-drills', 'traits', 'lifetimes', 'read-real-code']);
    return {
      ...base,
      id: 'side-trail-fixture',
      stages: base.stages.map((stage) => ({ ...stage, waypoints: stage.waypoints.map((waypoint) => ({ ...waypoint, optional: optional.has(waypoint.id) })) })),
    };
  }

  it('gives every optional step of every gallery sample a spur, and no other step', () => {
    let spurs = 0;
    for (const roadmap of SAMPLES) {
      const plan = planWalk(structuredClone(roadmap) as Roadmap, { phone: true });
      for (const panel of plan.panels) {
        for (const mark of panel.marks) {
          expect(mark.spur !== null, `${roadmap.id}/${mark.waypoint.id}`).toBe(mark.waypoint.optional === true);
          if (mark.spur) spurs += 1;
          else expect({ x: mark.x, z: mark.z }).toEqual(mark.on);
        }
      }
    }
    // Five of the six gallery roadmaps have side trails.
    expect(spurs).toBe(12);
  }, 120_000);

  it('leaves the route, reaches the mark and rejoins the route', () => {
    for (const phone of [true, false]) {
      const plan = planWalk(fixture(), { phone });
      let seen = 0;
      for (const panel of plan.panels) {
        for (const mark of panel.marks) {
          const spur = mark.spur;
          if (!spur) continue;
          seen += 1;
          const label = `${mark.waypoint.id}${phone ? ' (phone)' : ''}`;
          const first = spur.points[0]!;
          const last = spur.points.at(-1)!;
          // Both ends lie on the route itself.
          const leave = pathPoint(panel, spur.from);
          const rejoin = pathPoint(panel, spur.to);
          expect(Math.hypot(first.x - leave.x, first.z - leave.z), label).toBeLessThan(1e-9);
          expect(Math.hypot(last.x - rejoin.x, last.z - rejoin.z), label).toBeLessThan(1e-9);
          expect(spur.from, label).toBeLessThan(spur.at);
          expect(spur.to, label).toBeGreaterThan(spur.at);
          // The mark is the far point: off the route by the spur's reach, at the step's own place along it.
          expect(mark.at, label).toBe(spur.at);
          expect(Math.hypot(spur.side.x, spur.side.z), label).toBeCloseTo(1, 12);
          expect(mark.x - mark.on.x, label).toBeCloseTo(spur.side.x * spur.reach, 12);
          expect(mark.z - mark.on.z, label).toBeCloseTo(spur.side.z * spur.reach, 12);
          expect(spur.reach, label).toBeGreaterThanOrEqual(SPUR.minReach);
          expect(spur.reach, label).toBeLessThanOrEqual(SPUR.reach);
          const far = Math.max(
            ...spur.points.map((point, k) => {
              const beside = pathPoint(panel, spur.from + ((spur.to - spur.from) * k) / SPUR.samples);
              return Math.hypot(point.x - beside.x, point.z - beside.z);
            }),
          );
          expect(far, label).toBeCloseTo(spur.reach, 9);
          // It stands off the route where its step is, square to it or leaning by 50 degrees at the most, so it
          // reads as a way off the route and not along it.
          const before = pathPoint(panel, spur.at - 0.012);
          const after = pathPoint(panel, spur.at + 0.012);
          const along = Math.hypot(after.x - before.x, after.z - before.z);
          expect(Math.abs(((after.x - before.x) * spur.side.x + (after.z - before.z) * spur.side.z) / along), label).toBeLessThanOrEqual(Math.sin((50 * Math.PI) / 180) + 1e-9);
          // The mark is clear of the stage board, the signpost and the camp.
          for (const [sign, room] of [[panel.board, SPUR.signs.board], [panel.signpost, SPUR.signs.signpost], [panel.camp, SPUR.signs.camp]] as const) {
            expect(Math.hypot((sign.x - mark.x) / room.across, (sign.z - mark.z) / room.deep), label).toBeGreaterThanOrEqual(1 - 1e-9);
          }
          // The mark is nearer to its own stretch of route than to any other: a spur is never a crossing.
          for (let k = 0; k <= 80; k += 1) {
            const path = k / 80;
            if (path >= spur.from - (spur.at - spur.from) && path <= spur.to + (spur.to - spur.at)) continue;
            const other = pathPoint(panel, path);
            expect(Math.hypot(other.x - mark.x, other.z - mark.z), label).toBeGreaterThanOrEqual(spur.reach * SPUR.clear - 1e-9);
          }
          // It stays on the model, with room for the title beyond the mark.
          for (const point of spur.points) {
            expect(point.x, label).toBeGreaterThan(MODEL.x0);
            expect(point.x, label).toBeLessThan(MODEL.x1);
            expect(point.z, label).toBeGreaterThan(MODEL.z0);
            expect(point.z, label).toBeLessThan(MODEL.z1 - SPUR.front + 1e-9);
          }
          // The route length beside it only grows, so the spur is drawn as the walker comes.
          for (let k = 1; k < spur.points.length; k += 1) expect(spur.points[k]!.s, label).toBeGreaterThanOrEqual(spur.points[k - 1]!.s);
        }
      }
      expect(seen).toBe(7);
    }
  }, 120_000);

  it('keeps two spurs apart and clear of the marks beside them', () => {
    const plan = planWalk(fixture(), { phone: true });
    for (const panel of plan.panels) {
      const marks = panel.marks;
      marks.forEach((mark, index) => {
        if (!mark.spur) return;
        const before = marks[index - 1];
        const after = marks[index + 1];
        // A spur takes at most three tenths of the gap to the mark on either side.
        if (before) expect(mark.spur.from - before.at).toBeGreaterThanOrEqual((mark.at - before.at) * (1 - SPUR.gapShare) - 1e-9);
        if (after) expect(after.at - mark.spur.to).toBeGreaterThanOrEqual((after.at - mark.at) * (1 - SPUR.gapShare) - 1e-9);
        if (before?.spur) expect(before.spur.to).toBeLessThan(mark.spur.from);
        expect(mark.spur.from).toBeGreaterThan(0);
        expect(mark.spur.to).toBeLessThan(1);
      });
    }
  }, 120_000);

  it('rises from the route and comes back to it without a step', () => {
    const spur = { from: 0.2, to: 0.36, at: 0.28, reach: 0.4, side: { x: 0, z: 1 } };
    expect(spurOffset(spur, 0.2)).toBe(0);
    expect(spurOffset(spur, 0.36)).toBe(0);
    expect(spurOffset(spur, 0.1)).toBe(0);
    expect(spurOffset(spur, 0.9)).toBe(0);
    expect(spurOffset(spur, 0.28)).toBeCloseTo(0.4, 12);
    expect(spurOffset(spur, 0.24)).toBeCloseTo(0.2, 12);
    expect(spurOffset(spur, 0.32)).toBeCloseTo(0.2, 12);
    let before = 0;
    for (let k = 1; k <= 400; k += 1) {
      const now = spurOffset(spur, 0.2 + (0.16 * k) / 400);
      expect(Math.abs(now - before)).toBeLessThan(0.004);
      before = now;
    }
    // The rise is a distance: which way it goes is the spur's side.
    const toTheBack = { ...spur, reach: 0.3, side: { x: 0, z: -1 } };
    expect(spurOffset(toTheBack, 0.28)).toBeCloseTo(0.3, 12);
  });

  it('walks the walker out to the optional step and back, while the pin and the flag stay on the route', () => {
    const roadmap = fixture();
    const plan = planWalk(roadmap, { phone: true });
    for (const panel of plan.panels) {
      for (const mark of panel.marks) {
        if (!mark.spur) {
          const there = walkPoint(panel, mark.at);
          expect({ x: there.x, z: there.z }).toEqual(mark.on);
          continue;
        }
        // On the step he stands on its mark.
        const there = walkPoint(panel, mark.at);
        expect(there.x).toBeCloseTo(mark.x, 12);
        expect(there.z).toBeCloseTo(mark.z, 12);
        // Before and after the spur he is on the route.
        for (const path of [mark.spur.from, mark.spur.to, mark.spur.from - 0.004, mark.spur.to + 0.004]) expect(walkPoint(panel, path)).toEqual(pathPoint(panel, path));
        // The length of the route beside him is the route's own, so the ribbon is drawn as far as he has come.
        expect(there.s).toBe(pathPoint(panel, mark.at).s);
        // The walk puts him there when the note shows that step.
        const p = progressForItem(plan, (item) => item.kind === 'waypoint' && item.waypointId === mark.waypoint.id)!;
        const place = placeAt(plan, p);
        expect(place.panel).toBe(panel.index);
        expect(place.point.x).toBeCloseTo(mark.x, 6);
        expect(place.point.z).toBeCloseTo(mark.z, 6);
      }
    }
    // He never jumps: a step of the scroll moves him a little, on the route and on a spur alike.
    let last = placeAt(plan, WALK.stages.from);
    for (let k = 1; k <= 4000; k += 1) {
      const now = placeAt(plan, WALK.stages.from + ((WALK.stages.to - WALK.stages.from) * k) / 4000);
      if (now.panel === last.panel) expect(Math.hypot(now.point.x - last.point.x, now.point.z - last.point.z)).toBeLessThan(0.12);
      expect(now.length).toBeGreaterThanOrEqual(last.length - 1e-9);
      last = now;
    }
    // You-are-here and the class flag are places on the route, wherever a spur is.
    for (let k = 0; k <= 200; k += 1) {
      const along = k / 200;
      const here = hereAt(plan, along);
      expect(here.point).toEqual(pathPoint(plan.panels[here.panel]!, here.path));
      const flag = flagAt(plan, along);
      expect(flag.panel).toBe(here.panel);
      expect(flag.on).toEqual(here.point);
      expect(flag.point.z).toBe(here.point.z);
      expect(flag.point.x - here.point.x).toBeGreaterThanOrEqual(0);
      expect(flag.point.x - here.point.x).toBeLessThanOrEqual(FLAG.aside + 1e-12);
      expect(flag.point.x).toBeLessThanOrEqual(PANEL.width - FLAG.edge + 1e-12);
    }
  }, 120_000);

  it('stands on the front side of the route, and gives up where the steps stand too close for a spur', () => {
    const roadmap = fixture();
    const plan = planWalk(roadmap, { phone: true });
    // The route keeps to a band in the middle of the panel, so the front has room: spurs point that way.
    const sides = plan.panels.flatMap((panel) => panel.marks.flatMap((mark) => (mark.spur ? [mark.spur.side] : [])));
    expect(sides.filter((side) => side.z > 0).length).toBeGreaterThanOrEqual(sides.length - 1);
    // A stage of very many short steps leaves no gap wide enough: those steps stay on the route.
    const crowded: Roadmap = {
      ...roadmap,
      stages: roadmap.stages.map((stage, index) =>
        index === 0
          ? { ...stage, waypoints: Array.from({ length: 40 }, (_, k) => ({ ...stage.waypoints[0]!, id: `tiny-${k}`, title: `Tiny ${k}`, minutes: 5, practiceMinutes: 3, optional: k % 2 === 1, requires: undefined, checks: [] })) }
          : stage,
      ),
    };
    const tight = planWalk(crowded, { phone: true });
    const marks = tight.panels[0]!.marks;
    expect(marks).toHaveLength(40);
    for (const mark of marks) {
      if (mark.spur) {
        expect(mark.spur.to - mark.spur.from).toBeGreaterThan(0.02);
      } else {
        expect({ x: mark.x, z: mark.z }).toEqual(mark.on);
      }
    }
    expect(marks.filter((mark) => mark.waypoint.optional && !mark.spur).length).toBeGreaterThan(0);
  }, 120_000);
});

describe('the words of the walk', () => {
  it('has every key in English and in German', () => {
    expect(missingKeys(WALK_STRINGS)).toEqual([]);
  });
});
