import { describe, expect, it } from 'vitest';
import { emptyProgress, markDone } from '../roadmap/progress';
import { draft, sampleRoadmap } from '../roadmap/testing';
import type { Roadmap } from '../roadmap/types';
import { TERRAIN_TEMPLATES, TRAIL_TEMPLATES } from '../terrain';
import { readoutFor } from './readout';
import { deriveSheet, stageOfCard, stageStartShare, stopHeights, tracePrint, trailAlong } from './sheet-data';

describe('deriveSheet', () => {
  it('reads the sample: five stages to gold, twenty cards', () => {
    const data = deriveSheet({ roadmap: sampleRoadmap() });
    expect(data.stageCount).toBe(5);
    expect(data.tier).toBe('gold');
    expect(data.summitAltitude).toBeCloseTo(0.75);
    expect(data.cards).toBe(20);
    expect(data.height).toBeCloseTo(1.4 * (0.35 + 0.65 * 0.75));
    expect(data.totalMinutes).toBe(2505);
    expect(data.trail.stops).toBe(6);
    expect(data.terrain.template).toBe('massif');
    expect(data.trail.template).toBe('switchback');
  });

  it('puts the pin at the gate before any progress and moves it with every finished step', () => {
    const roadmap = sampleRoadmap();
    const fresh = deriveSheet({ roadmap });
    expect(fresh.hereMinuteShare).toBe(0);
    expect(fresh.hereStage).toBe(0);
    expect(fresh.share).toBe(0);

    const first = roadmap.stages[0]?.waypoints[0];
    if (!first) throw new Error('the sample has no waypoint');
    const progress = markDone(emptyProgress(roadmap.id), roadmap, first.id, '2026-11-13T10:00:00Z');
    const walked = deriveSheet({ roadmap, progress });
    expect(walked.hereMinuteShare).toBeCloseTo(first.minutes / 2505);
    expect(walked.share).toBeCloseTo(first.minutes / 2505);
  });

  it('starts the pin at the entry stage when the brief names one', () => {
    const roadmap = draft();
    roadmap.brief.entry = 'shaping-data';
    const data = deriveSheet({ roadmap: roadmap as Roadmap });
    expect(data.hereStage).toBe(2);
    expect(data.hereMinuteShare).toBeCloseTo((315 + 510) / 2505);
  });

  it('builds for a roadmap of two stages and for one of eight', () => {
    for (const count of [2, 8]) {
      const roadmap = draft();
      const stage = roadmap.stages[0];
      roadmap.stages = Array.from({ length: count }, (_, index) => ({ ...structuredClone(stage), id: `s${index}`, tier: index < count / 2 ? 'bronze' : 'silver' }));
      const data = deriveSheet({ roadmap: roadmap as Roadmap });
      expect(data.stageCount).toBe(count);
      expect(data.trail.stops).toBe(count + 1);
      expect(data.trail.stopHeights?.length).toBe(count + 1);
    }
  });
});

describe('stopHeights', () => {
  it('rises from the gate to the summit, one stop per camp', () => {
    const data = deriveSheet({ roadmap: sampleRoadmap() });
    const heights = stopHeights(data.trek, data.cards);
    expect(heights.length).toBe(6);
    for (let i = 1; i < heights.length; i += 1) expect(heights[i]).toBeGreaterThan(heights[i - 1] as number);
    expect(heights[heights.length - 1]).toBe(1);
    // The first camp is the top of bronze: a third of the way up a mountain that ends at gold.
    expect(heights[1]).toBeCloseTo(0.25 / 0.75);
  });
});

describe('trailAlong', () => {
  const data = deriveSheet({ roadmap: sampleRoadmap() });
  const stops = [0, 0.1, 0.3, 0.5, 0.8, 1];

  it('maps the gate, every camp and the summit onto the stops of the trail', () => {
    expect(trailAlong(data, stops, 0)).toBe(0);
    expect(trailAlong(data, stops, 1)).toBe(1);
    expect(trailAlong(data, stops, 315 / 2505)).toBeCloseTo(0.1);
    expect(trailAlong(data, stops, (315 + 510) / 2505)).toBeCloseTo(0.3);
  });

  it('is monotonic', () => {
    let previous = -1;
    for (let step = 0; step <= 100; step += 1) {
      const value = trailAlong(data, stops, step / 100);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });
});

describe('stageOfCard', () => {
  const data = deriveSheet({ roadmap: sampleRoadmap() });

  it('gives the bottom cards to the first stage and the top card to the last', () => {
    expect(stageOfCard(data, 0)).toBe(0);
    expect(stageOfCard(data, data.cards - 1)).toBe(4);
  });

  it('never goes down as the cards go up, and reaches every stage', () => {
    const stages = Array.from({ length: data.cards }, (_, card) => stageOfCard(data, card));
    for (let i = 1; i < stages.length; i += 1) expect(stages[i]).toBeGreaterThanOrEqual(stages[i - 1] as number);
    expect(new Set(stages).size).toBe(5);
  });

  it('enters a stage at its first minute', () => {
    expect(stageStartShare(data, 0)).toBe(0);
    expect(stageStartShare(data, 1)).toBeCloseTo(315 / 2505);
  });
});

describe('tracePrint', { timeout: 60_000 }, () => {
  it('traces one level per card and a trail with one stop per camp, for every mountain and every way up', () => {
    for (const terrain of TERRAIN_TEMPLATES) {
      for (const trail of TRAIL_TEMPLATES) {
        const roadmap = draft();
        roadmap.map = { terrain: terrain.id, trail: trail.id, seed: `${terrain.id}-${trail.id}` };
        const data = deriveSheet({ roadmap: roadmap as Roadmap });
        // The phone grid is enough to check the shape and keeps the test quick.
        const print = tracePrint(data, true);
        expect(print.levels.length).toBe(data.cards);
        expect(print.trail.stops.length).toBe(data.stageCount + 1);
        expect(print.trail.stops[0]?.along).toBe(0);
        expect(print.trail.stops[data.stageCount]?.along).toBe(1);
      }
    }
  });
});

/** Durations are set with no-break spaces; the tests compare the words. */
const plain = (text: string): string => text.replace(/\s/gu, ' ');

describe('readoutFor', () => {
  const data = deriveSheet({ roadmap: sampleRoadmap() });

  it('counts the hours up with the growth of the mountain', () => {
    expect(readoutFor(0, data, 0, -1, 'en').hours).toBe(0);
    expect(readoutFor(0, data, 1, -1, 'en').hours).toBe(42);
    expect(readoutFor(0, data, 1, -1, 'en').hoursText).toBe('42');
    const half = readoutFor(0, data, 0.5, -1, 'en').hours;
    expect(half).toBeGreaterThan(15);
    expect(half).toBeLessThan(27);
  });

  it('sums the roadmap up while nothing is under the pointer', () => {
    const parts = readoutFor(0, data, 1, -1, 'en');
    expect(parts.line).toBe('20 cards · 5 stages · to Gold');
    expect(parts.title).toBe('Zero to Rust, coming from Python');
    expect(parts.card).toBeNull();
    expect(parts.stage).toBeNull();
  });

  it('names the stage whose altitude band holds the card under the pointer', () => {
    const parts = readoutFor(0, data, 1, 8, 'en');
    expect(parts.card).toBe(9);
    expect(parts.cards).toBe(20);
    expect(parts.stage).toBe(2);
    expect(parts.tier).toBe('silver');
    expect(plain(parts.line)).toBe('Card 9 of 20 · Stage 2 · Silver · about 8.5 h');
    expect(parts.title).toBe(data.trek.stages[1]?.title);
    expect(parts.lang).toBe('en');
  });

  it('speaks German', () => {
    expect(plain(readoutFor(0, data, 1, 8, 'de').line)).toBe('Karte 9 von 20 · Etappe 2 · Silber · ca. 8,5 Std.');
    expect(readoutFor(0, data, 1, -1, 'de').line).toBe('20 Karten · 5 Etappen · bis Gold');
  });

  it('changes its key only when something visible changes', () => {
    const a = readoutFor(0, data, 0.5, -1, 'en');
    const b = readoutFor(0, data, 0.5004, -1, 'en');
    const c = readoutFor(0, data, 0.9, -1, 'en');
    const d = readoutFor(0, data, 0.5, 3, 'en');
    expect(b.key).toBe(a.key);
    expect(c.key).not.toBe(a.key);
    expect(d.key).not.toBe(a.key);
  });
});
