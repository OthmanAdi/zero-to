import { describe, expect, it } from 'vitest';
import { TIER_NAMES } from '../scene/palette';
import { campAlong, deriveTrek, mapSpec, OVERSHOOT_OFFER, paceFor, resourcesFor, reviewDue, reviewGaps, TIER_BAND } from './derive';
import { emptyProgress, markDone } from './progress';
import { draft, sampleRoadmap } from './testing';
import type { Roadmap } from './types';

describe('deriveTrek', () => {
  const roadmap = sampleRoadmap();
  const trek = deriveTrek(roadmap);

  it('adds up minutes and hours from the waypoints', () => {
    const minutes = roadmap.stages.flatMap((s) => s.waypoints).reduce((sum, w) => sum + w.minutes, 0);
    expect(trek.totalMinutes).toBe(minutes);
    expect(trek.totalMinutes).toBe(2505);
    expect(trek.totalHours).toBeCloseTo(41.75, 6);
    expect(trek.stages.map((s) => s.minutes).reduce((a, b) => a + b, 0)).toBe(minutes);
    expect(trek.practiceMinutes).toBeGreaterThan(0.7 * minutes);
  });

  it('lets altitude rise from stage to stage and from camp to camp', () => {
    let previous = 0;
    for (const stage of trek.stages) {
      expect(stage.startAltitude).toBeCloseTo(previous, 9);
      expect(stage.campAltitude).toBeGreaterThan(stage.startAltitude);
      expect(stage.campAltitude).toBeLessThanOrEqual(1);
      previous = stage.campAltitude;
    }
    expect(trek.stages[0]?.startAltitude).toBe(0);
  });

  it('gives each tier a quarter and shares it by minutes', () => {
    trek.stages.forEach((stage) => {
      const index = TIER_NAMES.indexOf(stage.tier);
      expect(stage.campAltitude).toBeGreaterThan(index * TIER_BAND);
      expect(stage.campAltitude).toBeLessThanOrEqual((index + 1) * TIER_BAND + 1e-9);
    });
    const [first, second, third, fourth, fifth] = trek.stages;
    expect(first?.campAltitude).toBeCloseTo(0.25, 9); // alone in bronze: the whole quarter
    expect(second?.campAltitude).toBeCloseTo(0.25 + 0.25 * (510 / 1080), 9); // silver, shared with stage 3
    expect(third?.campAltitude).toBeCloseTo(0.5, 9);
    expect(fourth?.campAltitude).toBeCloseTo(0.5 + 0.25 * (660 / 1110), 9);
    expect(fifth?.campAltitude).toBeCloseTo(0.75, 9);
  });

  it('ends lower when the roadmap stops below diamond', () => {
    expect(trek.summitAltitude).toBeCloseTo(0.75, 9);
    const diamond = draft();
    diamond.stages[4].tier = 'diamond';
    expect(deriveTrek(diamond as Roadmap).summitAltitude).toBeCloseTo(1, 9);
    const short = draft();
    short.stages = short.stages.slice(0, 2);
    expect(deriveTrek(short as Roadmap).summitAltitude).toBeCloseTo(0.5, 9);
  });

  it('keeps the route from ever going downhill when tiers are listed out of order', () => {
    const odd = draft();
    odd.stages[3].tier = 'bronze';
    const t = deriveTrek(odd as Roadmap);
    for (let i = 1; i < t.stages.length; i += 1) {
      expect(t.stages[i]?.campAltitude).toBeGreaterThanOrEqual(t.stages[i - 1]?.campAltitude as number);
    }
  });

  it('puts every waypoint along the route in order, inside 0..1', () => {
    let previous = -1;
    for (const wp of trek.waypoints) {
      expect(wp.along).toBeGreaterThan(0);
      expect(wp.along).toBeLessThan(1);
      expect(wp.along).toBeGreaterThan(previous);
      previous = wp.along;
      expect(wp.altitude).toBeGreaterThanOrEqual(0);
      expect(wp.altitude).toBeLessThanOrEqual(1);
    }
    expect(trek.waypoints).toHaveLength(roadmap.stages.flatMap((s) => s.waypoints).length);
  });

  it('keeps waypoint altitude between the stage start and its camp', () => {
    for (const wp of trek.waypoints) {
      const stage = trek.stages.find((s) => s.id === wp.stageId);
      expect(wp.altitude).toBeGreaterThanOrEqual(stage?.startAltitude as number);
      expect(wp.altitude).toBeLessThanOrEqual(stage?.campAltitude as number);
    }
    const toolchain = trek.waypoints[0];
    expect(toolchain?.along).toBeCloseTo(22.5 / 2505, 9);
  });

  it('places camps at the end of their stage', () => {
    expect(campAlong(trek, 'finish-the-tool')).toBeCloseTo(1, 9);
    expect(campAlong(trek, 'first-binary')).toBeCloseTo(315 / 2505, 9);
    expect(campAlong(trek, 'unknown')).toBe(0);
    for (const stage of trek.stages) {
      const last = trek.waypoints.filter((w) => w.stageId === stage.id).at(-1);
      expect(last?.along).toBeLessThan(campAlong(trek, stage.id));
    }
  });

  it('reports each stage minutes and span', () => {
    expect(trek.stages[0]).toMatchObject({ id: 'first-binary', tier: 'bronze', minutes: 315, practiceMinutes: 275, startMinute: 0, endMinute: 315 });
    expect(trek.stages[1]).toMatchObject({ startMinute: 315, endMinute: 825 });
  });
});

describe('paceFor', () => {
  const roadmap = sampleRoadmap();

  it('is at the start before the start date', () => {
    const pace = paceFor(roadmap, '2026-11-13');
    expect(pace.expectedAlong).toBe(0);
    expect(pace.status).toBe('before-start');
    expect(pace.startDate).toBe('2026-11-16');
  });

  it('projects the arrival date from the hours per week', () => {
    const pace = paceFor(roadmap, '2026-11-16');
    expect(pace.minutesPerDay).toBeCloseTo(300 / 7, 9);
    expect(pace.daysNeeded).toBe(59);
    expect(pace.projectedArrival).toBe('2027-01-14');
    expect(pace.daysPastDeadline).toBe(-31);
    expect(pace.overshoot).toBeLessThan(0);
    expect(pace.status).toBe('under-way');
  });

  it('spreads the climb evenly towards the deadline', () => {
    expect(paceFor(roadmap, '2026-12-31').expectedAlong).toBeCloseTo(0.5, 9);
    expect(paceFor(roadmap, '2027-02-14').expectedAlong).toBe(1);
    expect(paceFor(roadmap, '2028-01-01').expectedAlong).toBe(1);
    expect(paceFor(roadmap, '2028-01-01').status).toBe('after-plan');
    expect(paceFor(roadmap, '2026-12-31').expectedMinute).toBeCloseTo(1252.5, 6);
  });

  it('uses hours per week for the plan when there is no deadline', () => {
    const open = draft();
    delete open.brief.deadline;
    const pace = paceFor(open as Roadmap, '2026-12-16');
    expect(pace.deadline).toBeNull();
    expect(pace.daysPastDeadline).toBeNull();
    expect(pace.overshoot).toBeNull();
    expect(pace.expectedAlong).toBeCloseTo((30 * (300 / 7)) / 2505, 9);
  });

  it('flags a deadline the hours cannot reach', () => {
    const tight = draft();
    tight.brief.hoursPerWeek = 2;
    tight.brief.deadline = '2027-01-15';
    const pace = paceFor(tight as Roadmap, '2026-11-20');
    expect(pace.daysPastDeadline).toBeGreaterThan(0);
    expect(pace.overshoot).toBeGreaterThan(OVERSHOOT_OFFER);
  });

  it('starts today when the brief has no start date, and accepts a Date', () => {
    const none = draft();
    delete none.brief.startDate;
    const pace = paceFor(none as Roadmap, new Date('2026-11-13T18:30:00Z'));
    expect(pace.today).toBe('2026-11-13');
    expect(pace.startDate).toBe('2026-11-13');
    expect(pace.expectedAlong).toBe(0);
    expect(pace.projectedArrival).toBe('2027-01-11');
  });
});

describe('reviewGaps and reviewDue', () => {
  const roadmap = sampleRoadmap();

  it('uses the default series and halves the first gaps for a low rating', () => {
    expect(reviewGaps(undefined)).toEqual([2, 7, 21, 60]);
    expect(reviewGaps([2, 7, 21, 60], 3)).toEqual([2, 7, 21, 60]);
    expect(reviewGaps([2, 7, 21, 60], 1)).toEqual([1, 4, 21, 60]);
    expect(reviewGaps([1, 3], 2)).toEqual([1, 2]);
    expect(reviewGaps([], undefined)).toEqual([2, 7, 21, 60]);
  });

  it('lists finished waypoints with checks once their day has come', () => {
    let progress = emptyProgress(roadmap.id);
    progress = markDone(progress, roadmap, 'moves', '2026-11-20T09:00:00Z');
    progress = markDone(progress, roadmap, 'toolchain', '2026-11-20T09:00:00Z'); // no checks: never reviewed
    expect(reviewDue(progress, roadmap, '2026-11-21')).toEqual([]);
    const due = reviewDue(progress, roadmap, '2026-11-24');
    expect(due).toEqual([{ waypointId: 'moves', stageId: 'ownership', title: 'Who owns the value', due: '2026-11-22', daysOverdue: 2 }]);
  });

  it('orders by how overdue they are and skips a finished series', () => {
    let progress = emptyProgress(roadmap.id);
    progress = markDone(progress, roadmap, 'moves', '2026-11-20T09:00:00Z');
    progress = markDone(progress, roadmap, 'guessing-game', '2026-11-10T09:00:00Z');
    const items = reviewDue(progress, roadmap, '2026-11-30');
    expect(items.map((i) => i.waypointId)).toEqual(['guessing-game', 'moves']);
    const finished = {
      ...progress,
      waypoints: { ...progress.waypoints, moves: { ...progress.waypoints.moves!, due: null } },
    };
    expect(reviewDue(finished, roadmap, '2026-11-30').map((i) => i.waypointId)).toEqual(['guessing-game']);
  });

  it('works out the first day itself for progress that has none', () => {
    const progress = {
      ...emptyProgress(roadmap.id),
      waypoints: { moves: { done: true, doneOn: '2026-11-01', reviews: [] }, borrowing: { done: true, reviews: [] } },
    };
    expect(reviewDue(progress, roadmap, '2026-11-05').map((i) => i.waypointId)).toEqual(['moves']);
  });
});

describe('resourcesFor', () => {
  const roadmap = sampleRoadmap();

  it('gives a waypoint its resources in order, main one first', () => {
    const shelf = resourcesFor(roadmap, 'moves');
    expect(shelf.map((e) => e.resource.id)).toEqual(['book-ownership', 'book-ownership-de']);
    expect(shelf.map((e) => e.main)).toEqual([true, false]);
    expect(shelf.every((e) => e.for === 'moves')).toBe(true);
  });

  it('gives a stage the shelves of its waypoints, then its project, without repeats', () => {
    const shelf = resourcesFor(roadmap, 'first-binary');
    expect(shelf.map((e) => e.resource.id)).toEqual(['rust-install', 'book-guessing-game', 'rustlings', 'cli-book']);
    expect(shelf.at(-1)).toMatchObject({ for: 'project', main: false });
    const trait = resourcesFor(roadmap, 'collections-traits').map((e) => e.resource.id);
    expect(new Set(trait).size).toBe(trait.length);
    expect(trait).toContain('rustlings');
  });

  it('is empty for an unknown id and for a gap waypoint', () => {
    expect(resourcesFor(roadmap, 'nope')).toEqual([]);
    expect(resourcesFor(roadmap, 'read-real-code')).toEqual([]);
  });
});

describe('mapSpec', () => {
  it('keeps what the sample asks for and fills the rest', () => {
    const spec = mapSpec(sampleRoadmap());
    expect(spec).toEqual({
      terrain: 'massif',
      trail: 'switchback',
      terrainWasRandom: false,
      trailWasRandom: false,
      seed: 'rust-for-a-python-dev',
      surfaces: 'auto',
      signpost: 'timber',
      theme: 'classic-topo',
    });
  });

  it('defaults everything when there is no map, with the id as seed', () => {
    const r = draft();
    delete r.map;
    delete r.brief.theme;
    const spec = mapSpec(r as Roadmap);
    expect(spec.seed).toBe(r.id);
    expect(spec.surfaces).toBe('auto');
    expect(spec.signpost).toBe('timber');
    expect(spec.theme).toBeNull();
    expect(spec.terrainWasRandom && spec.trailWasRandom).toBe(true);
  });

  it('chooses random terrain and trail from the seed, the same way every time', () => {
    const a = draft();
    a.map = { seed: 'alpha' };
    const again = mapSpec(a as Roadmap);
    expect(mapSpec(a as Roadmap)).toEqual(again);
    const seen = new Set<string>();
    for (let i = 0; i < 40; i += 1) {
      const r = draft();
      r.map = { terrain: 'random', trail: 'random', seed: `seed-${i}` };
      const spec = mapSpec(r as Roadmap);
      seen.add(`${spec.terrain}/${spec.trail}`);
      expect(['volcano', 'ridge', 'massif', 'twin-peaks', 'plateau', 'canyon']).toContain(spec.terrain);
      expect(['switchback', 'ridge-walk', 'spiral', 'valley-first', 'traverse']).toContain(spec.trail);
    }
    expect(seen.size).toBeGreaterThan(5);
  });

  it('passes explicit surfaces, signpost, seed and theme through', () => {
    const r = draft();
    r.map = { terrain: 'canyon', trail: 'spiral', seed: 'x', surfaces: ['sand', 'rock', 'snow'], signpost: 'iron', theme: 'night' };
    expect(mapSpec(r as Roadmap)).toMatchObject({ terrain: 'canyon', trail: 'spiral', seed: 'x', surfaces: ['sand', 'rock', 'snow'], signpost: 'iron', theme: 'night' });
  });
});
