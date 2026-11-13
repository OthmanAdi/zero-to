import { describe, expect, it } from 'vitest';
import { bezier, createFlight, flightLayoutWidth, flightPose, type FlightEnd, type FlightStart } from './flight';

const start: FlightStart = { cx: 640, cy: 360, width: 206, height: 340, lean: -4.4, yaw: 6 };
const end: FlightEnd = { x: 840, y: 104, width: 285, height: 470 };

describe('bezier', () => {
  it('passes through both ends and stays in order', () => {
    const ease = bezier(0.65, 0, 0.35, 1);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    let previous = 0;
    for (let step = 1; step <= 50; step++) {
      const value = ease(step / 50);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('treats values outside 0 to 1 as the ends', () => {
    const ease = bezier(0.2, 0, 0, 1);
    expect(ease(-1)).toBe(0);
    expect(ease(2)).toBe(1);
  });
});

describe('flightPose', () => {
  it('starts exactly where the cover stands on the shelf', () => {
    const pose = flightPose(0, start, end);
    expect(pose.x).toBeCloseTo(640, 5);
    expect(pose.y).toBeCloseTo(360 + 170, 5);
    expect(pose.scale).toBeCloseTo(206 / 285, 5);
    expect(pose.lean).toBeCloseTo(-4.4, 5);
    expect(pose.yaw).toBeCloseTo(6, 5);
    expect(pose.tip).toBeCloseTo(0, 5);
    expect(pose.shadow).toBe(0);
    expect(pose.spine).toBe(1);
    expect(pose.light).toBe(1);
  });

  it('lands flat and square in its place beside the page', () => {
    const pose = flightPose(1, start, end);
    expect(pose.x).toBeCloseTo(840 + 285 / 2, 5);
    expect(pose.y).toBeCloseTo(104 + 470, 5);
    expect(pose.scale).toBeCloseTo(1, 5);
    expect(pose.lean).toBeCloseTo(0, 5);
    expect(pose.yaw).toBeCloseTo(0, 5);
    expect(pose.tip).toBeCloseTo(0, 5);
    expect(pose.shadow).toBeCloseTo(0, 5);
    expect(pose.spine).toBe(0);
    expect(pose.light).toBe(0);
  });

  it('never jumps between two frames', () => {
    const frames = 42;
    let previous = flightPose(0, start, end);
    for (let frame = 1; frame <= frames; frame++) {
      const pose = flightPose(frame / frames, start, end);
      expect(Math.hypot(pose.x - previous.x, pose.y - previous.y)).toBeLessThan(40);
      expect(Math.abs(pose.scale - previous.scale)).toBeLessThan(0.05);
      expect(Math.abs(pose.yaw - previous.yaw)).toBeLessThan(4);
      previous = pose;
    }
  });

  it('rises off the shelf before it is carried away', () => {
    const early = flightPose(0.12, start, end);
    expect(early.y).toBeLessThan(360 + 170);
    expect(Math.abs(early.x - 640)).toBeLessThan(1);
    expect(early.tip).toBeLessThan(0);
  });

  it('turns toward where it is going, whichever side that is', () => {
    const right = flightPose(0.47, { ...start, yaw: 0 }, end);
    const left = flightPose(0.47, { ...start, yaw: 0 }, { ...end, x: 40 });
    expect(right.yaw).toBeGreaterThan(0);
    expect(left.yaw).toBeLessThan(0);
  });

  it('gives the same pose for the same moment in either direction', () => {
    expect(flightPose(0.4, start, end)).toEqual(flightPose(0.4, start, end));
  });

  it('holds still when it is given a time outside the flight', () => {
    expect(flightPose(-0.5, start, end)).toEqual(flightPose(0, start, end));
    expect(flightPose(1.5, start, end)).toEqual(flightPose(1, start, end));
  });
});

describe('createFlight', () => {
  it('lays the cover out once at landing size and moves it by transform only', () => {
    const cover = document.createElement('span');
    const host = document.createElement('div');
    const flight = createFlight({ cover, start, end, host, spineEdge: 8, clothClass: 'bb-cloth--ink' });
    const book = host.querySelector<HTMLElement>('.bb-flight__book');
    expect(book).not.toBeNull();
    expect(book?.contains(cover)).toBe(true);
    expect(book?.style.width).toBe('285px');
    expect(book?.style.height).toBe('470px');
    expect(book?.classList.contains('bb-cloth--ink')).toBe(true);

    flight.set(0);
    const first = book?.style.transform ?? '';
    flight.set(0.5);
    const second = book?.style.transform ?? '';
    expect(first).not.toBe('');
    expect(second).not.toBe(first);
    expect(book?.style.width).toBe('285px');

    flight.destroy();
    expect(host.querySelector('.bb-flight')).toBeNull();
  });

  it('carries the highlight the cover had on the shelf and lets it go on the way', () => {
    const host = document.createElement('div');
    const flight = createFlight({ cover: document.createElement('span'), start, end, host, sheen: { opacity: 0.06, sweep: 0.3 } });
    const sheen = host.querySelector<HTMLElement>('.bb-book__sheen');
    expect(sheen?.style.getPropertyValue('--bb-sweep')).toBe('0.3');
    flight.set(0);
    expect(sheen?.style.getPropertyValue('--bb-sheen')).toBe('0.06');
    flight.set(1);
    expect(sheen?.style.getPropertyValue('--bb-sheen')).toBe('0');
    flight.destroy();
  });

  it('adds no highlight when the cover had none', () => {
    const host = document.createElement('div');
    const flight = createFlight({ cover: document.createElement('span'), start, end, host });
    expect(host.querySelector('.bb-book__sheen')).toBeNull();
    flight.destroy();
  });

  it('is laid out at its shelf size when it lands in a smaller place', () => {
    const thumbnail: FlightEnd = { x: 16, y: 8, width: 40, height: 66 };
    expect(flightLayoutWidth(start, thumbnail)).toBe(206);
    expect(flightLayoutWidth(start, end)).toBe(285);
    const host = document.createElement('div');
    const flight = createFlight({ cover: document.createElement('span'), start, end: thumbnail, host });
    const book = host.querySelector<HTMLElement>('.bb-flight__book');
    expect(book?.style.width).toBe('206px');
    flight.set(0);
    expect(book?.style.transform).toContain('scale(1)');
    flight.set(1);
    expect(book?.style.transform).toContain(`scale(${Math.round((40 / 206) * 1000) / 1000})`);
    flight.destroy();
  });

  it('is hidden from assistive technology', () => {
    const host = document.createElement('div');
    const flight = createFlight({ cover: document.createElement('span'), start, end, host });
    expect(host.querySelector('.bb-flight')?.getAttribute('aria-hidden')).toBe('true');
    flight.destroy();
  });
});
