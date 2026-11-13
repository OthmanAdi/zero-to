import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetUiLang, setUiLang } from '../i18n';
import { TIER_BAND, deriveTrek } from '../roadmap/derive';
import deutsch from '../roadmap/samples/deutsch-a1-von-null.json';
import langgraph from '../roadmap/samples/langgraph-for-a-python-dev.json';
import music from '../roadmap/samples/music-theory-for-a-class.json';
import photo from '../roadmap/samples/photography-basics.json';
import statistics from '../roadmap/samples/statistics-for-data-work.json';
import { sampleRoadmap } from '../roadmap/testing';
import type { Roadmap } from '../roadmap/types';
import { TIER_NAMES } from '../scene/palette';
import { PROFILE, alongAt, createProfile, profileGeometry, spacedMarks, type Profile } from './profile';

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

  it('puts every waypoint at the middle of its minutes, a step on the line and an optional one off it', () => {
    const trek = deriveTrek(sampleRoadmap());
    const g = profileGeometry(trek);
    expect(g.waypoints).toHaveLength(trek.waypoints.length);
    g.waypoints.forEach((mark, i) => {
      const wp = trek.waypoints[i]!;
      expect(mark.x).toBeCloseTo(wp.along * PROFILE.width, 1);
      expect(mark.on.x).toBe(mark.x);
      expect(mark.on.y).toBeCloseTo(g.y(g.altitudeAt(wp.along)), 1);
      if (wp.optional) expect(Math.abs(mark.y - mark.on.y)).toBeCloseTo(PROFILE.spur.rise, 1);
      else expect(mark.y).toBe(mark.on.y);
    });
    const xs = g.waypoints.map((mark) => mark.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });

  it('draws a dotted spur for every optional step: off the line before it, to its mark and back after it', () => {
    const samples: Roadmap[] = [...roadmaps, langgraph as unknown as Roadmap, music as unknown as Roadmap, statistics as unknown as Roadmap];
    let seen = 0;
    for (const roadmap of samples) {
      const trek = deriveTrek(roadmap);
      const g = profileGeometry(trek);
      const optional = trek.waypoints.filter((wp) => wp.optional);
      expect(g.spurs.map((spur) => spur.id), roadmap.id).toEqual(optional.map((wp) => wp.id));
      for (const spur of g.spurs) {
        seen += 1;
        const index = trek.waypoints.findIndex((wp) => wp.id === spur.id);
        const wp = trek.waypoints[index]!;
        const mark = g.waypoints[index]!;
        expect(spur.from).toBeLessThan(wp.along);
        expect(spur.to).toBeGreaterThan(wp.along);
        // It never reaches the steps beside it.
        const before = trek.waypoints[index - 1];
        const after = trek.waypoints[index + 1];
        if (before) expect(spur.from - before.along).toBeGreaterThan((wp.along - before.along) * 0.69);
        if (after) expect(after.along - spur.to).toBeGreaterThan((after.along - wp.along) * 0.69);
        // The path starts and ends on the line and passes through the mark.
        const numbers = spur.d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
        expect(numbers).toHaveLength(10);
        expect(numbers[0]).toBeCloseTo(g.x(spur.from), 1);
        expect(numbers[1]).toBeCloseTo(g.y(g.altitudeAt(spur.from)), 1);
        expect(numbers[4]).toBe(mark.x);
        expect(numbers[5]).toBe(mark.y);
        expect(numbers[8]).toBeCloseTo(g.x(spur.to), 1);
        expect(numbers[9]).toBeCloseTo(g.y(g.altitudeAt(spur.to)), 1);
        // Above the line where there is room, below it under the top edge. Always inside the plot.
        expect(spur.up).toBe(mark.y < mark.on.y);
        expect(mark.y).toBeGreaterThanOrEqual(PROFILE.spur.room);
        expect(mark.y).toBeLessThanOrEqual(PROFILE.height - PROFILE.spur.room);
      }
    }
    expect(seen).toBe(12);
    // No optional steps, no spurs.
    expect(profileGeometry(deriveTrek(deutsch as unknown as Roadmap)).spurs).toEqual([]);
  });

  it('turns a spur downward where the line runs along the top of the plot', () => {
    const base = sampleRoadmap();
    // A route that is at the top of Diamond from its first stage on, with an optional step up there.
    const high: Roadmap = {
      ...base,
      stages: base.stages.map((stage, index) => ({
        ...stage,
        tier: index === 0 ? 'bronze' : 'diamond',
        waypoints: stage.waypoints.map((waypoint) => ({ ...waypoint, optional: waypoint.id === 'read-real-code' })),
      })),
    };
    const g = profileGeometry(deriveTrek(high));
    expect(g.spurs).toHaveLength(1);
    const spur = g.spurs[0]!;
    const mark = g.waypoints.find((wp) => wp.id === 'read-real-code')!;
    expect(mark.on.y - PROFILE.spur.rise).toBeLessThan(PROFILE.spur.room);
    expect(spur.up).toBe(false);
    expect(mark.y).toBeGreaterThan(mark.on.y);
    expect(mark.y).toBeLessThanOrEqual(PROFILE.height - PROFILE.spur.room);
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

describe('spacing of the buttons', () => {
  it('keeps marks in the order given, each one at least the pitch from the ones kept before it', () => {
    const marks = [
      { id: 'summit', along: 1 },
      { id: 'a', along: 0 },
      { id: 'b', along: 0.01 },
      { id: 'c', along: 0.05 },
      { id: 'd', along: 0.1 },
      { id: 'e', along: 0.97 },
    ];
    // 300 px: x = 300, 0, 3, 15, 30, 291.
    expect([...spacedMarks(marks, 300, 24)]).toEqual(['summit', 'a', 'd']);
    expect([...spacedMarks(marks, 3000, 24)]).toEqual(['summit', 'a', 'b', 'c', 'd', 'e']);
    // While the width is not known every mark stays.
    expect(spacedMarks(marks, 0, 24).size).toBe(marks.length);
  });

  it('leaves only marks that a press can tell apart on a narrow strip, you-are-here and the camps first', () => {
    const roadmap = deutsch as unknown as Roadmap;
    const trek = deriveTrek(roadmap);
    const profile = strip(roadmap);
    const plot = profile.element.querySelector<HTMLElement>('.zh-profile-plot')!;
    const all = (): HTMLButtonElement[] => [...profile.element.querySelectorAll<HTMLButtonElement>('button.zh-mark')];
    expect(all().every((button) => !button.inert)).toBe(true);

    // A phone: the plot is about 300 px wide.
    vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 760, width: 300, height: 40, right: 310, bottom: 800, x: 10, y: 760, toJSON: () => ({}) } as DOMRect);
    const here = trek.waypoints[9]!;
    profile.setHere(here.along);
    window.dispatchEvent(new Event('resize'));

    const live = all().filter((button) => !button.inert);
    expect(live.length).toBeLessThan(trek.waypoints.length + trek.stages.length);
    const xs = live.map((button) => parseFloat(button.style.left) * 3).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(PROFILE.pitch.fine - 1e-6);
    // You-are-here and the summit are among them.
    expect(profile.element.querySelector<HTMLButtonElement>('.zh-mark-camp.is-summit')!.inert).toBe(false);
    expect(profile.element.querySelector<HTMLButtonElement>(`[data-waypoint="${here.id}"]`)!.inert).toBe(false);
    // A mark that is not a button any more is still drawn, and the slider still reaches every place.
    const quiet = all().filter((button) => button.inert);
    expect(quiet.length).toBeGreaterThan(0);
    expect(quiet.every((button) => button.querySelector('.zh-mark-dot, .zh-mark-tent') !== null)).toBe(true);
    expect(profile.element.querySelector('input[type="range"]')).not.toBeNull();

    // A wide window again: every mark is a button.
    vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 3000, height: 40, right: 3000, bottom: 40, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    window.dispatchEvent(new Event('resize'));
    expect(all().every((button) => !button.inert)).toBe(true);
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
    // A move under the step is still written when it is the one that changes the hour: the walker comes to
    // rest at the camp a hundredth of an hour after the last text, and the readout must not stay behind.
    const trek = deriveTrek(sampleRoadmap());
    const camp = trek.stages[0]!.endMinute / trek.totalMinutes;
    profile.setWalker(camp - 0.012 / 42);
    expect(profile.readout).toBe('Hour 5 of 42 · Stage 1 · Bronze');
    const before = profile.writes;
    profile.setWalker(camp);
    expect(profile.readout).toBe('Hour 5.5 of 42 · Stage 2 · Silver');
    expect(profile.writes).toBe(before + 1);
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

  it('puts an optional step and its dotted spur on the strip, and its button at the far point of the spur', () => {
    const roadmap = sampleRoadmap();
    const trek = deriveTrek(roadmap);
    const profile = strip(roadmap);
    const g = profile.geometry;
    const paths = [...profile.element.querySelectorAll<SVGPathElement>('path.zh-profile-spur')];
    expect(paths.map((path) => path.getAttribute('data-waypoint'))).toEqual(['borrowing-examples', 'read-real-code']);
    expect(paths.map((path) => path.getAttribute('d'))).toEqual(g.spurs.map((spur) => spur.d));
    // The spurs lie under the line, so the line closes them.
    const drawing = profile.element.querySelector('.zh-profile-svg')!;
    const order = [...drawing.children].map((node) => node.getAttribute('class') ?? node.tagName);
    expect(order.indexOf('zh-profile-spurs')).toBeLessThan(order.indexOf('zh-profile-line is-ahead'));
    for (const spur of g.spurs) {
      const mark = g.waypoints.find((wp) => wp.id === spur.id)!;
      const button = profile.element.querySelector<HTMLButtonElement>(`button[data-waypoint="${spur.id}"]`)!;
      expect(button.classList.contains('is-side')).toBe(true);
      expect(parseFloat(button.style.left)).toBeCloseTo((mark.x / PROFILE.width) * 100, 1);
      expect(parseFloat(button.style.top)).toBeCloseTo((mark.y / PROFILE.height) * 100, 1);
      expect(parseFloat(button.style.top)).not.toBeCloseTo((mark.on.y / PROFILE.height) * 100, 0);
    }
    // A step on the route keeps its button on the line.
    const plain = trek.waypoints.find((wp) => !wp.optional)!;
    const onLine = profile.element.querySelector<HTMLButtonElement>(`button[data-waypoint="${plain.id}"]`)!;
    expect(onLine.classList.contains('is-side')).toBe(false);
    expect(parseFloat(onLine.style.top)).toBeCloseTo((g.y(g.altitudeAt(plain.along)) / PROFILE.height) * 100, 1);
    // Pressing the mark of a side trail still walks to that step.
    const heard: number[] = [];
    profile.onSeek((along) => heard.push(along));
    profile.element.querySelector<HTMLButtonElement>('button[data-waypoint="borrowing-examples"]')!.click();
    expect(heard).toEqual([trek.waypoints.find((wp) => wp.id === 'borrowing-examples')!.along]);
  });

  it('names the session on the class flag, turns it back at the right edge and takes it away again', () => {
    const profile = strip();
    const flag = profile.element.querySelector<HTMLElement>('.zh-mark-class')!;
    expect(flag.hidden).toBe(true);
    profile.setClass(0.42, 'session 10, The minor scale');
    expect(flag.hidden).toBe(false);
    expect(flag.style.left).toBe('42%');
    expect(flag.getAttribute('role')).toBe('img');
    expect(flag.getAttribute('aria-label')).toBe('The class is here: session 10, The minor scale');
    expect(flag.title).toBe('The class is here: session 10, The minor scale');
    expect(flag.classList.contains('is-back')).toBe(false);
    profile.setClass(0.99);
    expect(flag.getAttribute('aria-label')).toBe('The class is here');
    expect(flag.classList.contains('is-back')).toBe(true);
    setUiLang('de', false);
    profile.relabel();
    expect(flag.getAttribute('aria-label')).toBe('Die Klasse ist hier');
    profile.setClass(null);
    expect(flag.hidden).toBe(true);
  });

  it('names the stage the note names when the walker stands between two stages, and the same hour', () => {
    const trek = deriveTrek(sampleRoadmap());
    const profile = strip();
    const first = trek.stages[0]!;
    // The first stage ends after five and a quarter hours, which is printed as 5.5.
    expect(first.endMinute).toBe(315);
    const camp = first.endMinute / trek.totalMinutes;
    profile.setWalker(camp);
    // By the minutes alone the end of stage 1 is the start of stage 2.
    expect(profile.readout).toBe('Hour 5.5 of 42 · Stage 2 · Silver');
    // At the signpost and the camp of stage 1 the note says stage 1, and so does the strip.
    profile.setStage(0);
    expect(profile.readout).toBe('Hour 5.5 of 42 · Stage 1 · Bronze');
    profile.setStage(1);
    expect(profile.readout).toBe('Hour 5.5 of 42 · Stage 2 · Silver');
    // A stage he is nowhere near is not believed: the note can lag behind a long scroll.
    profile.setStage(3);
    expect(profile.readout).toBe('Hour 5.5 of 42 · Stage 2 · Silver');
    profile.setStage(0);
    profile.setWalker(0.5);
    expect(profile.readout).toMatch(/· Stage 3 · Silver$/);
    profile.setStage(null);
    profile.setStage(99);
    expect(profile.readout).toMatch(/· Stage 3 · Silver$/);
    // A hair under the quarter hour is still the quarter hour: the readout does not drop to "Hour 5".
    profile.setStage(0);
    profile.setWalker(camp - 1e-13);
    expect((camp - 1e-13) * trek.totalMinutes).toBeLessThan(315);
    expect(profile.readout).toBe('Hour 5.5 of 42 · Stage 1 · Bronze');
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
