import { describe, expect, it } from 'vitest';
import { sampleRoadmap } from '../roadmap/testing';
import type { Roadmap, Stage } from '../roadmap/types';
import {
  PLACE,
  SHARE,
  WALK,
  evenWindows,
  fForMinutes,
  itemAt,
  mapOpenAt,
  minutesShareAt,
  pathAt,
  progressAt,
  railAt,
  sceneAt,
  stageAt,
  stageItems,
  stageWeight,
  stageWindows,
} from './timeline';

function withStages(count: number, waypoints = 4): Roadmap {
  const base = sampleRoadmap();
  const stages = Array.from({ length: count }, (_, index) => {
    const source = base.stages[index % base.stages.length] as Stage;
    return { ...source, id: `stage-${index + 1}`, waypoints: Array.from({ length: waypoints }, (_, k) => ({ ...(source.waypoints[k % source.waypoints.length] as Stage['waypoints'][number]), id: `s${index + 1}-w${k + 1}` })) };
  });
  return { ...base, stages };
}

describe('stageWindows', () => {
  it('shares 0.73 of the walk between the stages, in proportion to their weights', () => {
    for (const roadmap of [sampleRoadmap(), withStages(2), withStages(8, 3), withStages(6, 9)]) {
      const windows = stageWindows(roadmap);
      const widths = windows.stages.map((stage) => stage.to - stage.from);
      expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(0.73, 10);
      expect(windows.stages[0]?.from).toBeCloseTo(WALK.stages.from, 10);
      expect(windows.stages[windows.stages.length - 1]?.to).toBeCloseTo(WALK.stages.to, 10);
      windows.stages.forEach((stage, index) => {
        expect(stage.weight).toBeCloseTo(stageWeight(roadmap.stages[index] as Stage), 10);
        expect(stage.to - stage.from).toBeCloseTo((0.73 * stage.weight) / windows.weight, 10);
        if (index > 0) expect(stage.from).toBeCloseTo(windows.stages[index - 1]?.to as number, 10);
      });
    }
  });

  it('clamps the length of the stretch to 8 and 30 viewports', () => {
    expect(stageWindows(withStages(2, 1)).viewports).toBe(8);
    expect(stageWindows(withStages(8, 9)).viewports).toBe(30);
    const five = stageWindows(withStages(5, 4));
    expect(five.viewports).toBeCloseTo(5 * (0.8 + 0.45 * 5), 10);
    expect(five.viewports).toBeGreaterThan(8);
    expect(five.viewports).toBeLessThan(30);
  });

  it('finds the stage of any progress and inverts it', () => {
    const windows = stageWindows(sampleRoadmap());
    expect(stageAt(0, windows)).toEqual({ stage: 0, f: 0 });
    expect(stageAt(1, windows)).toEqual({ stage: windows.stages.length - 1, f: 1 });
    for (let step = 0; step <= 200; step += 1) {
      const p = WALK.stages.from + ((WALK.stages.to - WALK.stages.from) * step) / 200;
      const place = stageAt(p, windows);
      expect(progressAt(place, windows)).toBeCloseTo(p, 9);
    }
  });
});

describe('railAt', () => {
  it('rests on the shut map, holds on each panel and crosses in the last tenth of a stage', () => {
    for (const n of [2, 5, 8]) {
      const windows = evenWindows(n);
      expect(railAt(0, n, windows)).toBe(0);
      expect(railAt(0.012, n, windows)).toBe(0);
      expect(railAt(1, n, windows)).toBeCloseTo(n + 2, 10);
      windows.stages.forEach((stage, index) => {
        const span = stage.to - stage.from;
        expect(railAt(stage.from + span * 0.5, n, windows)).toBeCloseTo(index + 1, 10);
        expect(railAt(stage.from + span * 0.89, n, windows)).toBeCloseTo(index + 1, 10);
        if (index < n - 1) {
          const crossing = railAt(stage.from + span * 0.95, n, windows);
          expect(crossing).toBeGreaterThan(index + 1);
          expect(crossing).toBeLessThan(index + 2);
        }
      });
      expect(railAt(0.82, n, windows)).toBeCloseTo(n, 10);
      expect(railAt(0.875, n, windows)).toBeCloseTo(n + 1, 10);
      expect(railAt(0.93, n, windows)).toBeCloseTo(n + 1, 10);
    }
  });

  it('never runs backwards', () => {
    for (const n of [2, 3, 5, 8]) {
      let previous = -1;
      for (let step = 0; step <= 2000; step += 1) {
        const rail = railAt(step / 2000, n);
        expect(rail).toBeGreaterThanOrEqual(previous - 1e-9);
        previous = rail;
      }
    }
  });

  it('follows the real windows of a roadmap whose stages differ in length', () => {
    const roadmap = withStages(3, 2);
    const uneven = { ...roadmap, stages: roadmap.stages.map((stage, index) => (index === 1 ? { ...stage, waypoints: [...stage.waypoints, ...stage.waypoints, ...stage.waypoints].map((w, k) => ({ ...w, id: `x${k}` })) } : stage)) };
    const windows = stageWindows(uneven);
    const middle = windows.stages[1] as { from: number; to: number };
    expect(middle.to - middle.from).toBeGreaterThan((windows.stages[0] as { from: number; to: number }).to - (windows.stages[0] as { from: number; to: number }).from);
    expect(railAt((middle.from + middle.to) / 2, 3, windows)).toBeCloseTo(2, 10);
  });
});

describe('the map and its scenes', () => {
  it('opens the map before the stages and shuts it at the end', () => {
    expect(mapOpenAt(0)).toBe(0);
    expect(mapOpenAt(WALK.open.to)).toBe(1);
    expect(mapOpenAt(0.5)).toBe(1);
    expect(mapOpenAt(WALK.shut.from)).toBe(1);
    expect(mapOpenAt(WALK.shut.to)).toBe(0);
    expect(mapOpenAt(1)).toBe(0);
  });

  it('raises a scene as the camera comes, keeps it, ripples all of them up at the finale and folds them down', () => {
    const windows = evenWindows(5);
    const second = windows.stages[1] as { from: number; to: number };
    expect(sceneAt(0.05, 0, windows)).toBe(0);
    expect(sceneAt(0.1, 0, windows)).toBe(1);
    expect(sceneAt(0.1, 1, windows)).toBe(0);
    expect(sceneAt(second.from + 0.01, 1, windows)).toBe(1);
    expect(sceneAt(second.from + 0.01, 0, windows)).toBe(1);
    expect(sceneAt(second.from + 0.01, 4, windows)).toBe(0);
    for (let panel = 0; panel < 5; panel += 1) {
      expect(sceneAt(0.92, panel, windows)).toBe(1);
      expect(sceneAt(0.95, panel, windows)).toBe(0);
    }
  });
});

describe('itemAt', () => {
  it('returns every waypoint, then the signpost, then the camp, with no gap', () => {
    for (const roadmap of [sampleRoadmap(), withStages(2, 1), withStages(3, 9)]) {
      for (const stage of roadmap.stages) {
        const spans = stageItems(stage);
        const kinds = spans.map((span) => span.item.kind);
        const expected = [...stage.waypoints.map(() => 'waypoint'), 'signpost', ...(stage.project ? ['camp'] : [])];
        expect(kinds).toEqual(expected);
        expect(spans[0]?.from).toBe(0);
        expect(spans[spans.length - 1]?.to).toBe(1);
        for (let index = 1; index < spans.length; index += 1) expect(spans[index]?.from).toBe(spans[index - 1]?.to);
        for (const span of spans) expect(span.to).toBeGreaterThan(span.from);

        const seen: string[] = [];
        for (let step = 0; step <= 1000; step += 1) {
          const hit = itemAt(stage, step / 1000);
          const key = hit.item.kind === 'waypoint' ? hit.item.waypointId : hit.item.kind;
          if (seen[seen.length - 1] !== key) seen.push(key);
          expect(hit.local).toBeGreaterThanOrEqual(0);
          expect(hit.local).toBeLessThanOrEqual(1);
        }
        expect(seen).toEqual([...stage.waypoints.map((waypoint) => waypoint.id), 'signpost', ...(stage.project ? ['camp'] : [])]);
      }
    }
  });

  it('gives the waypoints 88 percent, the signpost 7 and the camp 5', () => {
    const stage = sampleRoadmap().stages.find((candidate) => candidate.project) as Stage;
    const spans = stageItems(stage);
    const sign = spans.find((span) => span.item.kind === 'signpost') as { from: number; to: number };
    const camp = spans.find((span) => span.item.kind === 'camp') as { from: number; to: number };
    expect(sign.from).toBeCloseTo(SHARE.waypoints, 10);
    expect(sign.to - sign.from).toBeCloseTo(SHARE.signpost, 10);
    expect(camp.to - camp.from).toBeCloseTo(SHARE.camp, 10);
  });

  it('gives the signpost the camp share too when a stage has no project', () => {
    const stage = { ...(sampleRoadmap().stages[0] as Stage), project: undefined };
    const spans = stageItems(stage);
    expect(spans[spans.length - 1]?.item.kind).toBe('signpost');
    expect(spans[spans.length - 1]?.to).toBe(1);
  });

  it('shares the waypoints half equally and half by minutes, so a short step stays readable', () => {
    const base = sampleRoadmap().stages[0] as Stage;
    const waypoint = base.waypoints[0] as Stage['waypoints'][number];
    const stage: Stage = { ...base, waypoints: [{ ...waypoint, id: 'short', minutes: 5 }, { ...waypoint, id: 'long', minutes: 295 }] };
    const [short, long] = stageItems(stage) as unknown as [{ from: number; to: number }, { from: number; to: number }];
    expect(short.to - short.from).toBeCloseTo(0.88 * (0.25 + 0.5 * (5 / 300)), 10);
    expect(long.to - long.from).toBeCloseTo(0.88 * (0.25 + 0.5 * (295 / 300)), 10);
    expect(short.to - short.from).toBeGreaterThan(0.2);
  });
});

describe('pathAt', () => {
  it('walks forward from crease to crease and is on each item in the middle of its share', () => {
    for (const stage of sampleRoadmap().stages) {
      let previous = -Infinity;
      for (let step = 0; step <= 500; step += 1) {
        const path = pathAt(stage, step / 500, false, false);
        expect(path).toBeGreaterThanOrEqual(previous - 1e-12);
        previous = path;
      }
      expect(pathAt(stage, 0, false, false)).toBe(-1);
      expect(pathAt(stage, 1, false, false)).toBe(2);
      expect(pathAt(stage, 0, true, false)).toBe(0);
      expect(pathAt(stage, 1, false, true)).toBe(1);
      for (const span of stageItems(stage)) {
        // He is on a waypoint in the middle of its share. The signpost and the end of the stage have fixed moments.
        if (span.item.kind === 'waypoint') expect(pathAt(stage, (span.from + span.to) / 2, false, false)).toBeCloseTo(span.at, 10);
      }
      expect(pathAt(stage, SHARE.waypoints + SHARE.signpost / 2, false, false)).toBeCloseTo(PLACE.signpost, 10);
      expect(pathAt(stage, 1 - SHARE.camp / 2, false, false)).toBeCloseTo(PLACE.camp, 10);
      const spans = stageItems(stage);
      const marks = spans.map((span) => span.at);
      expect([...marks].sort((a, b) => a - b)).toEqual(marks);
      expect(marks[marks.length - 1]).toBeLessThanOrEqual(PLACE.camp);
    }
  });

  it('turns minutes into a place on the path and back', () => {
    const stage = sampleRoadmap().stages[1] as Stage;
    for (const share of [0, 0.2, 0.5, 0.83, 1]) {
      const f = fForMinutes(stage, share, false, false);
      expect(minutesShareAt(pathAt(stage, f, false, false))).toBeCloseTo(share, 5);
    }
    expect(minutesShareAt(-1)).toBe(0);
    expect(minutesShareAt(2)).toBe(1);
  });
});
