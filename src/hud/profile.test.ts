import { afterEach, describe, expect, it } from 'vitest';
import { resetUiLang, setUiLang } from '../i18n';
import { TIER_BAND, deriveTrek } from '../roadmap/derive';
import deutsch from '../roadmap/samples/deutsch-a1-von-null.json';
import photo from '../roadmap/samples/photography-basics.json';
import { sampleRoadmap } from '../roadmap/testing';
import type { Roadmap } from '../roadmap/types';
import { TIER_NAMES } from '../scene/palette';
import { PROFILE, alongAt, createProfile, profileGeometry, type Profile } from './profile';

const roadmaps: Roadmap[] = [sampleRoadmap(), deutsch as unknown as Roadmap, photo as unknown as Roadmap];
let made: Profile[] = [];

afterEach(() => {
  for (const profile of made) profile.destroy();
  made = [];
  document.body.replaceChildren();
  resetUiLang();
});

function strip(roadmap: Roadmap = sampleRoadmap(), options: Parameters<typeof createProfile>[2] = {}): Profile {
  const profile = createProfile(document.body, deriveTrek(roadmap), options);
  made.push(profile);
  return profile;
}

describe('profile geometry', () => {
  it('is linear in minutes: a minute is the same width anywhere on the strip', () => {
    for (const roadmap of roadmaps) {
      const trek = deriveTrek(roadmap);
      const g = profileGeometry(trek);
      const perMinute = PROFILE.width / trek.totalMinutes;
      for (const stage of trek.stages) {
        expect(g.x(g.alongOfMinute(stage.startMinute))).toBeCloseTo(stage.startMinute * perMinute, 6);
        expect(g.x(g.alongOfMinute(stage.endMinute))).toBeCloseTo(stage.endMinute * perMinute, 6);
      }
      // Any three evenly spaced minutes are evenly spaced on the strip.
      for (const minute of [10, 133, trek.totalMinutes / 3]) {
        const a = g.x(g.alongOfMinute(minute));
        const b = g.x(g.alongOfMinute(minute + 30));
        const c = g.x(g.alongOfMinute(minute + 60));
        expect(b - a).toBeCloseTo(c - b, 6);
      }
      expect(g.x(0)).toBe(0);
      expect(g.x(1)).toBe(PROFILE.width);
    }
  });

  it('puts every waypoint at the middle of its minutes and on the line', () => {
    const trek = deriveTrek(sampleRoadmap());
    const g = profileGeometry(trek);
    expect(g.waypoints).toHaveLength(trek.waypoints.length);
    g.waypoints.forEach((mark, i) => {
      const wp = trek.waypoints[i]!;
      expect(mark.x).toBeCloseTo(wp.along * PROFILE.width, 1);
      expect(mark.y).toBeCloseTo(g.y(g.altitudeAt(wp.along)), 1);
    });
    const xs = g.waypoints.map((mark) => mark.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });

  it('puts the last camp of every tier on the upper edge of that tier band', () => {
    for (const roadmap of roadmaps) {
      const trek = deriveTrek(roadmap);
      const g = profileGeometry(trek);
      expect(g.camps).toHaveLength(trek.stages.length);
      trek.stages.forEach((stage, i) => {
        const camp = g.camps[i]!;
        expect(camp.altitude).toBeCloseTo(stage.campAltitude, 9);
        expect(camp.x).toBeCloseTo((stage.endMinute / trek.totalMinutes) * PROFILE.width, 1);
        const lastOfTier = trek.stages[i + 1]?.tier !== stage.tier;
        if (!lastOfTier) return;
        const band = g.bands.find((b) => b.tier === stage.tier)!;
        expect(camp.y).toBeCloseTo(band.y0, 1);
        expect(camp.altitude).toBeCloseTo((TIER_NAMES.indexOf(stage.tier) + 1) * TIER_BAND, 9);
      });
    }
  });

  it('has four bands of equal height, and marks the ones above the summit', () => {
    const g = profileGeometry(deriveTrek(photo as unknown as Roadmap));
    expect(g.bands.map((b) => b.tier)).toEqual([...TIER_NAMES]);
    const heights = g.bands.map((b) => b.y1 - b.y0);
    for (const height of heights) expect(height).toBeCloseTo(heights[0]!, 1);
    // The photography sample ends at silver.
    expect(g.bands.map((b) => b.reached)).toEqual([true, true, false, false]);
  });

  it('never goes downhill and keeps the line inside the plot', () => {
    for (const roadmap of roadmaps) {
      const g = profileGeometry(deriveTrek(roadmap));
      for (let i = 1; i < g.line.length; i++) {
        expect(g.line[i]!.x).toBeGreaterThanOrEqual(g.line[i - 1]!.x);
        expect(g.line[i]!.y).toBeLessThanOrEqual(g.line[i - 1]!.y + 1e-6);
        expect(g.line[i]!.y).toBeGreaterThanOrEqual(PROFILE.top - 1e-6);
        expect(g.line[i]!.y).toBeLessThanOrEqual(PROFILE.bottom + 1e-6);
      }
    }
  });
});

describe('seek', () => {
  it('returns the share of the route under the pointer within half a percent', () => {
    const box = { left: 102, width: 954 };
    for (const along of [0, 0.013, 0.25, 0.5, 0.731, 0.999, 1]) {
      const clientX = box.left + along * box.width;
      expect(Math.abs(alongAt(clientX, box) - along)).toBeLessThan(0.005);
    }
    // A whole pixel of error stays under half a percent on the narrowest strip a phone shows.
    const phone = { left: 18, width: 340 };
    expect(Math.abs(alongAt(phone.left + 0.4 * phone.width + 1, phone) - 0.4)).toBeLessThan(0.005);
    expect(alongAt(-50, box)).toBe(0);
    expect(alongAt(5000, box)).toBe(1);
    expect(alongAt(10, { left: 0, width: 0 })).toBe(0);
  });

  it('tells listeners where a press on the plot is', () => {
    const profile = strip();
    const plot = profile.element.querySelector<HTMLElement>('.zh-profile-plot')!;
    plot.getBoundingClientRect = () => ({ left: 100, top: 0, width: 800, height: 60, right: 900, bottom: 60, x: 100, y: 0, toJSON: () => ({}) });
    const heard: number[] = [];
    const stop = profile.onSeek((along) => heard.push(along));
    plot.dispatchEvent(new MouseEvent('pointerdown', { clientX: 300, button: 0, bubbles: true }));
    expect(heard).toHaveLength(1);
    expect(Math.abs(heard[0]! - 0.25)).toBeLessThan(0.005);
    stop();
    plot.dispatchEvent(new MouseEvent('pointerdown', { clientX: 500, button: 0, bubbles: true }));
    expect(heard).toHaveLength(1);
  });

  it('gives the keyboard the same seek through a slider', () => {
    const profile = strip();
    const slider = profile.element.querySelector<HTMLInputElement>('input[type="range"]')!;
    expect(slider.getAttribute('aria-label')).toBe('Position on the route');
    const heard: number[] = [];
    profile.onSeek((along) => heard.push(along));
    slider.value = '400';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(heard).toEqual([0.4]);
  });

  it('seeks to a step when its dot is pressed, and says which step', () => {
    const roadmap = sampleRoadmap();
    const trek = deriveTrek(roadmap);
    const went: unknown[] = [];
    const profile = strip(roadmap, { titles: { [trek.waypoints[2]!.id]: 'Third step' }, onGo: (target) => went.push(target) });
    const heard: number[] = [];
    profile.onSeek((along) => heard.push(along));
    const dot = profile.element.querySelector<HTMLButtonElement>(`button[data-waypoint="${trek.waypoints[2]!.id}"]`)!;
    expect(dot.getAttribute('aria-label')).toBe('Step: Third step');
    dot.click();
    expect(heard).toEqual([trek.waypoints[2]!.along]);
    expect(went).toEqual([{ waypointId: trek.waypoints[2]!.id, stageId: trek.waypoints[2]!.stageId }]);
  });
});

describe('the strip', () => {
  it('lays a real button over every step and every camp', () => {
    const roadmap = sampleRoadmap();
    const trek = deriveTrek(roadmap);
    const profile = strip(roadmap);
    expect(profile.element.querySelectorAll('button.zh-mark-step')).toHaveLength(trek.waypoints.length);
    expect(profile.element.querySelectorAll('button.zh-mark-camp')).toHaveLength(trek.stages.length);
    for (const button of profile.element.querySelectorAll('button.zh-mark')) {
      expect(button.getAttribute('aria-label')).toBeTruthy();
    }
  });

  it('writes the readout only when the walker has moved enough to change it', () => {
    const profile = strip();
    profile.setWalker(0.3);
    const writes = profile.writes;
    const text = profile.readout;
    expect(text).toMatch(/^Hour [\d.]+ of 42 · Stage 2 · Silver$/);
    // A move of a hundredth of an hour is under the step.
    profile.setWalker(0.3 + 0.01 / 42);
    profile.setWalker(0.3);
    expect(profile.writes).toBe(writes);
    expect(profile.readout).toBe(text);
    profile.setWalker(0.9);
    expect(profile.writes).toBe(writes + 1);
    expect(profile.readout).toContain('Stage 5');
  });

  it('shows you-are-here, the plan for today, the arrival, due cairns and the class flag', () => {
    const roadmap = sampleRoadmap();
    const trek = deriveTrek(roadmap);
    const profile = strip(roadmap);
    const mark = (name: string): HTMLElement => profile.element.querySelector<HTMLElement>(`.zh-mark-${name}`)!;
    expect(mark('here').hidden).toBe(true);
    expect(mark('pace').hidden).toBe(true);
    expect(mark('class').hidden).toBe(true);

    profile.setHere(0.25);
    profile.setPace(0.4, '2027-02-14');
    profile.setClass(0.1);
    expect(mark('here').hidden).toBe(false);
    expect(mark('here').style.left).toBe('25%');
    expect(mark('pace').style.left).toBe('40%');
    expect(mark('class').style.left).toBe('10%');
    expect(profile.element.querySelector('.zh-profile-arrival')!.textContent).toBe('Arrival 14 Feb 2027');

    const due = trek.waypoints[1]!;
    profile.setDue([{ waypointId: due.id, title: 'Who owns the value' }]);
    const cairn = profile.element.querySelector<HTMLElement>(`button[data-waypoint="${due.id}"]`)!;
    expect(cairn.classList.contains('is-due')).toBe(true);
    expect(cairn.getAttribute('aria-label')).toBe('Review due: Who owns the value');
    profile.setDue([]);
    expect(cairn.classList.contains('is-due')).toBe(false);

    profile.setHere(null);
    profile.setPace(null, null);
    expect(mark('here').hidden).toBe(true);
    expect(mark('pace').hidden).toBe(true);
    expect(profile.element.querySelector<HTMLElement>('.zh-profile-arrival')!.hidden).toBe(true);
  });

  it('turns the walked part of the line solid up to the walker', () => {
    const profile = strip();
    profile.setWalker(0.5);
    const clip = profile.element.querySelector('clipPath rect')!;
    expect(Number(clip.getAttribute('width'))).toBeCloseTo(PROFILE.width / 2, 1);
  });

  it('offers the four choices only when asked to, and never calls it being behind', () => {
    let opened = 0;
    const profile = strip(sampleRoadmap(), { onPaceOffer: () => (opened += 1) });
    const offer = profile.element.querySelector<HTMLButtonElement>('.zh-profile-offer')!;
    expect(offer.hidden).toBe(true);
    profile.setOffer(true);
    expect(offer.hidden).toBe(false);
    expect(offer.textContent).toBe('The plan runs past its date');
    expect(profile.element.textContent ?? '').not.toMatch(/behind|late|hinten|zu spät/i);
    offer.click();
    expect(opened).toBe(1);
  });

  it('speaks German after the language changes', () => {
    const profile = strip();
    profile.setWalker(0.3);
    setUiLang('de', false);
    profile.relabel();
    expect(profile.readout).toMatch(/^Stunde [\d,]+ von 42 · Etappe 2 · Silber$/);
    expect(profile.element.getAttribute('aria-label')).toBe('Routenprofil');
  });
});
