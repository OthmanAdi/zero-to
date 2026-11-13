import { describe, expect, it } from 'vitest';
import { carriedTurn, leanShare, stepFollower, stepRock, waveAt, waveDelay, type Sprung, type WaveSample } from './weight';

const FRAME = 16;

/** Runs a follower behind a lead that goes evenly from 0 to 1 over `rise` ms and then stands, for `total` ms. */
function follow(rise: number, total: number, stiffness = 170, ratio = 0.78): Array<{ time: number; lead: number; value: number }> {
  const body: Sprung = { value: 0, speed: 0 };
  const leadAt = (time: number): number => Math.min(1, Math.max(0, time / rise));
  const run = [];
  for (let time = FRAME; time <= total; time += FRAME) {
    stepFollower(body, leadAt(time - FRAME), leadAt(time), FRAME, stiffness, ratio);
    run.push({ time, lead: leadAt(time), value: body.value });
  }
  return run;
}

describe('a turn carried by a follower', () => {
  it('stays where it is while the lead stands', () => {
    const body: Sprung = { value: 1, speed: 0 };
    for (let frame = 0; frame < 60; frame++) stepFollower(body, 1, 1, FRAME, 170, 0.78);
    expect(body.value).toBe(1);
    expect(body.speed).toBe(0);
  });

  it('goes with a lead that moves steadily', () => {
    const body: Sprung = { value: 0, speed: 0 };
    let lead = 0;
    for (let frame = 0; frame < 120; frame++) {
      stepFollower(body, lead, lead + 0.05, FRAME, 170, 0.78);
      lead += 0.05;
    }
    expect(body.value).toBeCloseTo(lead, 3);
    expect(body.speed).toBeCloseTo((0.05 / FRAME) * 1000, 2);
  });

  it('falls behind a lead that starts, keeps its speed when the lead stops, and comes back', () => {
    const run = follow(160, 1200);
    const early = run.find((sample) => sample.time >= 80)!;
    expect(early.value).toBeLessThan(early.lead);
    const peak = Math.max(...run.map((sample) => sample.value));
    expect(peak).toBeGreaterThan(1.02);
    expect(peak).toBeLessThan(1.3);
    // Past the stop once: what swings back under it afterwards is a small part of that.
    const last = run.findIndex((sample) => sample.value === peak);
    const under = 1 - Math.min(...run.slice(last).map((sample) => sample.value));
    expect(under).toBeGreaterThanOrEqual(0);
    expect(under).toBeLessThan((peak - 1) / 4);
    for (const sample of run) if (sample.time > 900) expect(Math.abs(sample.value - 1)).toBeLessThan(0.0025);
    expect(run[run.length - 1]!.value).toBeCloseTo(1, 4);
  });

  it('swings past less the more it is damped', () => {
    const peakOf = (ratio: number): number => Math.max(...follow(160, 1200, 170, ratio).map((sample) => sample.value));
    expect(peakOf(0.5)).toBeGreaterThan(peakOf(0.78));
    expect(peakOf(0.78)).toBeGreaterThan(peakOf(1.2));
  });

  it('is not thrown by a frame that comes late, and ignores a frame that takes no time', () => {
    const body: Sprung = { value: 0, speed: 0 };
    stepFollower(body, 0, 1, 0, 170, 0.78);
    expect(body).toEqual({ value: 0, speed: 0 });
    stepFollower(body, 0, 1, 5000, 170, 0.78);
    expect(body.value).toBeGreaterThan(0);
    expect(body.value).toBeLessThan(1.2);
    expect(Number.isFinite(body.speed)).toBe(true);
  });

  it('adds a share of what the follower is ahead to the turn, within none and the most allowed', () => {
    expect(carriedTurn(1, 1, 0.2, 1.03)).toBe(1);
    expect(carriedTurn(1, 1.1, 0.2, 1.03)).toBeCloseTo(1.02, 12);
    expect(carriedTurn(1, 0.9, 0.2, 1.03)).toBeCloseTo(0.98, 12);
    // A volume passing at speed cannot be thrown past the most.
    expect(carriedTurn(1, 3, 0.2, 1.03)).toBe(1.03);
    expect(carriedTurn(0.2, -40, 0.2, 1.03)).toBe(0);
    expect(carriedTurn(0.5, 0.5, 0.2, 1.03)).toBe(0.5);
  });

  it('carries less the less a volume is turned, and nothing once it is not turned at all', () => {
    expect(carriedTurn(0.1, 0.6, 0.2, 1.03)).toBeCloseTo(0.11, 12);
    expect(carriedTurn(0, 0.6, 0.2, 1.03)).toBe(0);
    expect(carriedTurn(-0.1, 0.6, 0.2, 1.03)).toBe(0);
    let previous = 0;
    for (let step = 0; step <= 100; step++) {
      const turn = carriedTurn(step / 100, 1.15, 0.2, 1.03);
      expect(turn).toBeGreaterThanOrEqual(previous);
      previous = turn;
    }
  });
});

describe('the lean of standing volumes', () => {
  /** The lean over `total` ms when the row wants `wanted` degrees for the first `held` ms and none after. */
  function rock(wanted: number, held: number, total: number): Array<{ time: number; value: number }> {
    const body: Sprung = { value: 0, speed: 0 };
    const run = [];
    for (let time = FRAME; time <= total; time += FRAME) {
      stepRock(body, time <= held ? wanted : 0, FRAME, 180, 15);
      run.push({ time, value: body.value });
    }
    return run;
  }

  it('comes on without a step and settles on what the speed of the row asks for', () => {
    const run = rock(1.2, 4000, 2000);
    expect(run[0]!.value).toBeGreaterThan(0);
    expect(run[0]!.value).toBeLessThan(0.1);
    expect(run[run.length - 1]!.value).toBeCloseTo(1.2, 3);
    expect(Math.max(...run.map((sample) => sample.value))).toBeLessThan(1.2 * 1.2);
  });

  it('rocks back past upright once when the row stops, softly, and is then still', () => {
    const run = rock(1.2, 480, 1600).filter((sample) => sample.time > 480);
    const counter = Math.min(...run.map((sample) => sample.value));
    expect(counter).toBeLessThan(-0.02);
    expect(counter).toBeGreaterThan(-0.25);
    // After the counter-rock nothing comes back that could be seen.
    const turned = run.findIndex((sample) => sample.value === counter);
    expect(Math.max(...run.slice(turned).map((sample) => sample.value))).toBeLessThan(0.03);
    for (const sample of run) if (sample.time > 480 + 800) expect(Math.abs(sample.value)).toBeLessThan(0.01);
  });

  it('leans the other way when the row goes the other way', () => {
    const one = rock(1.2, 300, 600);
    const other = rock(-1.2, 300, 600);
    for (let index = 0; index < one.length; index++) expect(other[index]!.value).toBeCloseTo(-one[index]!.value, 12);
  });

  it('reads the lean as it was a moment ago, between the samples kept', () => {
    const samples: WaveSample[] = [
      { time: 100, value: 0 },
      { time: 116, value: 0.4 },
      { time: 132, value: 1 },
    ];
    expect(waveAt([], 120)).toBe(0);
    // Before the row began to move nothing leaned.
    expect(waveAt(samples, 99)).toBe(0);
    expect(waveAt(samples, 100)).toBe(0);
    expect(waveAt(samples, 108)).toBeCloseTo(0.2, 12);
    expect(waveAt(samples, 116)).toBeCloseTo(0.4, 12);
    expect(waveAt(samples, 124)).toBeCloseTo(0.7, 12);
    expect(waveAt(samples, 132)).toBe(1);
    expect(waveAt(samples, 500)).toBe(1);
    expect(waveAt([{ time: 100, value: 0.3 }, { time: 100, value: 0.5 }], 100)).toBe(0.5);
  });

  it('reaches each volume a little later than the one before it, so a wave runs down the row', () => {
    expect(waveDelay(0, 18, 216)).toBe(0);
    expect(waveDelay(1, 18, 216)).toBe(18);
    expect(waveDelay(-3, 18, 216)).toBe(54);
    expect(waveDelay(2.5, 18, 216)).toBe(45);
    expect(waveDelay(40, 18, 216)).toBe(216);
    expect(waveDelay(Number.NaN, 18, 216)).toBe(0);
    // The same lean, read by a volume three places further out, is the lean of 54 ms earlier.
    const samples: WaveSample[] = [];
    for (let time = 0; time <= 320; time += 16) samples.push({ time, value: Math.sin(time / 100) });
    expect(waveAt(samples, 320 - waveDelay(5, 18, 216))).toBeCloseTo(waveAt(samples, 320 - 54 - waveDelay(2, 18, 216)), 12);
    expect(waveAt(samples, 100 - waveDelay(5, 18, 216))).toBeLessThan(waveAt(samples, 100 - waveDelay(2, 18, 216)));
  });

  it('gives a thick volume less of the lean and a thin one a little more, within limits', () => {
    expect(leanShare(60)).toBe(1);
    expect(leanShare(80)).toBeCloseTo(0.75, 12);
    expect(leanShare(48)).toBeCloseTo(1.2, 12);
    expect(leanShare(200)).toBe(0.6);
    expect(leanShare(20)).toBe(1.2);
    expect(leanShare(0)).toBe(1);
    expect(leanShare(Number.NaN)).toBe(1);
    let previous = Infinity;
    for (let width = 20; width <= 200; width += 4) {
      const share = leanShare(width);
      expect(share).toBeLessThanOrEqual(previous);
      previous = share;
    }
  });
});
