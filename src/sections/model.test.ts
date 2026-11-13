import { describe, expect, it } from 'vitest';
import {
  FLOW,
  STOPS,
  STOP_IDS,
  boxLeg,
  currentStop,
  decorate,
  goDuration,
  holdRange,
  indexAt,
  isUp,
  legPoints,
  linkAge,
  localScroll,
  pieceRange,
  pointAt,
  polyline,
  progressFromScroll,
  stopState,
  threadHead,
  threadLength,
  type LegShape,
  type StopSpan,
  type ThreadPiece,
} from './model';

const VIEWPORT = 900;
const WIDTH = 1440;

/** A page laid out like the real one: a gap, then a stop, eight times. Pinned stops hold for their time. */
function page(viewport = VIEWPORT, pinned = true): { spans: StopSpan[]; pieces: ThreadPiece[]; height: number } {
  const spans: StopSpan[] = [];
  const pieces: ThreadPiece[] = [];
  let y = 0;
  let from = WIDTH / 2;
  for (const stop of STOPS) {
    const gap = stop.gap * viewport;
    const leg = polyline(legPoints(stop.leg, from, 46, WIDTH, gap));
    const legRange = pieceRange(y, gap, 0, viewport);
    pieces.push({ from: legRange[0], to: legRange[1], length: leg.length });
    y += gap;
    const pin = pinned && stop.hold > 0;
    const box = pin ? viewport : viewport * 1.3;
    const hold = pin ? stop.hold * viewport : 0;
    spans.push({ top: y, box, hold });
    const inside = polyline(boxLeg(WIDTH, box, 46, 54, WIDTH * stop.exit));
    const insideRange = pieceRange(y, box, hold, viewport);
    pieces.push({ from: insideRange[0], to: insideRange[1], length: inside.length });
    y += box + hold;
    from = WIDTH * stop.exit;
  }
  return { spans, pieces, height: y };
}

describe('stops', () => {
  it('lists eight stops, each with its own anchor, and no two neighbours share a leg shape', () => {
    expect(STOPS.map((stop) => stop.id)).toEqual([...STOP_IDS]);
    expect(new Set(STOPS.map((stop) => stop.anchor)).size).toBe(STOPS.length);
    for (let index = 1; index < STOPS.length; index += 1) expect(STOPS[index]?.leg).not.toBe(STOPS[index - 1]?.leg);
    expect(STOPS.filter((stop) => stop.centred).map((stop) => stop.id)).toEqual(['start']);
  });

  it('keeps the way between two stops short and sends the thread out across the page', () => {
    for (const stop of STOPS) {
      expect(stop.gap).toBeGreaterThan(0.1);
      expect(stop.gap).toBeLessThanOrEqual(1 / 3);
    }
    // A leg starts where the stop before it lets the thread out and ends in the gutter. No leg of a stop that
    // is read from the left starts in the left part of the window, where it would leave the rest of it empty.
    for (const stop of STOPS.filter((entry) => !entry.centred)) expect(stop.exit).toBeGreaterThanOrEqual(0.45);
  });

  it('activates the stops in order as the page is scrolled, and never goes back', () => {
    for (const pinned of [true, false]) {
      const { spans, height } = page(VIEWPORT, pinned);
      const seen: number[] = [];
      let last = -1;
      for (let y = -VIEWPORT; y <= height; y += 7) {
        const now = currentStop(spans, VIEWPORT, y);
        expect(now).toBeGreaterThanOrEqual(last);
        expect(now - last).toBeLessThanOrEqual(1);
        if (now !== last) seen.push(now);
        last = now;
      }
      expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    }
  });

  it('makes a stop current 0.45 of a window before its top reaches the top of the window', () => {
    const { spans } = page();
    const second = spans[1] as StopSpan;
    expect(currentStop(spans, VIEWPORT, second.top - VIEWPORT * FLOW.navLead - 1)).toBe(0);
    expect(currentStop(spans, VIEWPORT, second.top - VIEWPORT * FLOW.navLead)).toBe(1);
    expect(currentStop(spans, VIEWPORT, -5000)).toBe(-1);
  });

  it('plays each stop through ahead, forming, active and done, with at most one stop active', () => {
    const { spans, height } = page();
    const order = ['ahead', 'forming', 'active', 'done'];
    const reached = spans.map(() => 0);
    for (let y = -VIEWPORT; y <= height + VIEWPORT; y += 5) {
      const states = spans.map((span, index) => stopState(span, (STOPS[index] as (typeof STOPS)[number]).steps, VIEWPORT, y));
      expect(states.filter((state) => state.phase === 'active').length).toBeLessThanOrEqual(1);
      states.forEach((state, index) => {
        const rank = order.indexOf(state.phase);
        expect(rank).toBeGreaterThanOrEqual(reached[index] as number);
        reached[index] = rank;
      });
    }
    expect(reached).toEqual(spans.map(() => 3));
  });

  it('forms a pinned station between 0.9 and 0.06 of a window before it pins', () => {
    const span: StopSpan = { top: 5000, box: VIEWPORT, hold: 1000 };
    expect(stopState(span, 4, VIEWPORT, 5000 - VIEWPORT * 0.9).form).toBe(0);
    expect(stopState(span, 4, VIEWPORT, 5000 - VIEWPORT * 0.48).form).toBeCloseTo(0.5, 5);
    expect(stopState(span, 4, VIEWPORT, 5000 - VIEWPORT * 0.06).form).toBe(1);
  });

  it('steps through the things of a stop in order while it is held', () => {
    const span: StopSpan = { top: 5000, box: VIEWPORT, hold: 1000 };
    const steps: number[] = [];
    for (let y = 4000; y <= 6500; y += 10) {
      const { step } = stopState(span, 4, VIEWPORT, y);
      if (steps[steps.length - 1] !== step) steps.push(step);
    }
    expect(steps).toEqual([-1, 0, 1, 2, 3, -1]);
    expect(stopState(span, 4, VIEWPORT, 5500).hold).toBeCloseTo(0.5, 5);
  });

  it('gives a stop that is not pinned a hold while it crosses the window', () => {
    const span: StopSpan = { top: 5000, box: 1600, hold: 0 };
    const [from, to] = holdRange(span, VIEWPORT);
    expect(from).toBeLessThan(span.top);
    expect(to).toBeGreaterThan(from);
    expect(stopState(span, 3, VIEWPORT, from - 1).step).toBe(-1);
    expect(stopState(span, 3, VIEWPORT, from).step).toBe(0);
    expect(stopState(span, 3, VIEWPORT, to - 1).step).toBe(2);
    expect(stopState(span, 3, VIEWPORT, to).phase).toBe('done');
  });

  it('stands the cut-outs up one after another', () => {
    for (let form = 0; form <= 1.0001; form += 0.05) {
      const up = [0, 1, 2, 3].map((index) => isUp(form, index, 4));
      // Once one is down, every later one is down too.
      expect(up.join()).toBe([...up].sort((a, b) => Number(b) - Number(a)).join());
    }
    expect(isUp(0, 0, 4)).toBe(false);
    expect([0, 1, 2, 3].every((index) => isUp(1, index, 4))).toBe(true);
  });
});

describe('scroll', () => {
  it('maps scroll to progress and back', () => {
    expect(progressFromScroll(0, 900, 5000, 900)).toBe(0);
    expect(progressFromScroll(900 + 5000 - 900, 900, 5000, 900)).toBe(1);
    expect(progressFromScroll(-400, 900, 5000, 900)).toBe(0);
    expect(progressFromScroll(99_999, 900, 5000, 900)).toBe(1);
    expect(progressFromScroll(100, 0, 0, 900)).toBe(0);
    for (const scroll of [0, 300, 2500, 4100]) {
      const p = progressFromScroll(scroll, 0, 5000, 900);
      expect(localScroll(p, 5000, 900)).toBeCloseTo(scroll, 6);
    }
  });

  it('takes longer for a longer jump, never more than 3.2 seconds', () => {
    expect(goDuration(0)).toBe(0.8);
    expect(goDuration(4000)).toBeCloseTo(1.8, 6);
    expect(goDuration(-4000)).toBeCloseTo(1.8, 6);
    expect(goDuration(90_000)).toBe(3.2);
  });
});

describe('the thread', () => {
  it('grows monotonically with the scroll, from nothing to its whole length', () => {
    for (const pinned of [true, false]) {
      const { pieces, height } = page(VIEWPORT, pinned);
      const total = pieces.reduce((sum, piece) => sum + piece.length, 0);
      let last = -1;
      for (let y = -2 * VIEWPORT; y <= height + VIEWPORT; y += 3) {
        const done = threadLength(pieces, y);
        expect(done).toBeGreaterThanOrEqual(last);
        expect(done).toBeLessThanOrEqual(total + 1e-6);
        last = done;
      }
      expect(threadLength(pieces, -2 * VIEWPORT)).toBe(0);
      expect(threadLength(pieces, height + VIEWPORT)).toBeCloseTo(total, 6);
    }
  });

  it('has no jump where one piece hands over to the next', () => {
    const { pieces } = page();
    for (let index = 1; index < pieces.length; index += 1) {
      const before = pieces[index - 1] as ThreadPiece;
      const after = pieces[index] as ThreadPiece;
      expect(after.from).toBeCloseTo(before.to, 6);
      expect(threadLength(pieces, after.from + 0.001) - threadLength(pieces, before.to - 0.001)).toBeLessThan(0.02);
    }
  });

  it('moves the head from piece to piece in order and holds it in a pinned box for the whole hold', () => {
    const { pieces, spans, height } = page();
    let last = 0;
    for (let y = -VIEWPORT; y <= height; y += 11) {
      const head = threadHead(pieces, y);
      expect(head.piece).toBeGreaterThanOrEqual(last);
      last = head.piece;
    }
    const first = spans[0] as StopSpan;
    expect(threadHead(pieces, first.top + 1).piece).toBe(1);
    expect(threadHead(pieces, first.top + first.hold - 1).piece).toBe(1);
  });

  it('keeps the head near 0.55 of the window while it crosses a gap', () => {
    const [from, to] = pieceRange(3000, 400, 0, VIEWPORT);
    expect(from).toBe(3000 - VIEWPORT * FLOW.headLine);
    expect(to - from).toBe(400);
    const [, pinnedTo] = pieceRange(3000, VIEWPORT, 1200, VIEWPORT);
    expect(pinnedTo - (3000 - VIEWPORT * FLOW.headLine)).toBe(VIEWPORT + 1200);
  });

  it('draws every leg from its start to its end without turning back and inside the page', () => {
    const shapes: LegShape[] = ['curve', 'straight', 'switchbacks', 'arc', 'meander', 'drop', 'sweep'];
    for (const shape of shapes) {
      for (const [from, to, width] of [
        [900, 46, 1440],
        [130, 18, 390],
        [200, 720, 1440],
      ] as const) {
        const points = legPoints(shape, from, to, width, 400);
        const first = points[0];
        const last = points[points.length - 1];
        expect(first).toEqual({ x: from, y: 0 });
        expect(last?.x).toBeCloseTo(to, 6);
        expect(last?.y).toBeCloseTo(400, 6);
        for (let index = 1; index < points.length; index += 1) {
          expect((points[index]?.y ?? 0) - (points[index - 1]?.y ?? 0)).toBeGreaterThan(0);
          expect(points[index]?.x).toBeGreaterThanOrEqual(16);
          expect(points[index]?.x).toBeLessThanOrEqual(width - 16);
        }
        // It leaves and arrives heading down: over the first and the last sample it moves less sideways than down.
        const rise = 400 / (points.length - 1);
        expect(Math.abs((points[1]?.x ?? 0) - from)).toBeLessThan(rise * 0.6);
        expect(Math.abs((points[points.length - 2]?.x ?? 0) - to)).toBeLessThan(rise * 0.6);
      }
    }
  });

  it('runs the leg of a box down the gutter, along its foot and out at the exit', () => {
    const points = boxLeg(1440, 900, 46, 54, 900);
    expect(points[0]).toEqual({ x: 46, y: 0 });
    expect(points[points.length - 1]).toEqual({ x: 900, y: 900 });
    expect(Math.max(...points.map((point) => point.y))).toBe(900);
    expect(points.every((point) => point.x >= 46 - 1e-6 && point.x <= 900 + 1e-6)).toBe(true);
    const line = polyline(points);
    expect(line.length).toBeGreaterThan(900 + 854 - 60);
    // The centred stop takes the thread straight down to a point and ends it there.
    expect(boxLeg(1440, 900, 46, 54, 900, 140)).toEqual([
      { x: 720, y: 0 },
      { x: 720, y: 140 },
    ]);
  });

  it('finds a point at a length along a path', () => {
    const line = polyline([
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 50, y: 100 },
    ]);
    expect(line.length).toBe(150);
    expect(indexAt(line, 99)).toBe(0);
    expect(indexAt(line, 100)).toBe(1);
    expect(pointAt(line, 50)).toMatchObject({ x: 0, y: 50, index: 0 });
    expect(pointAt(line, 125)).toMatchObject({ x: 25, y: 100, index: 1 });
    expect(pointAt(line, 125).angle).toBeCloseTo(0, 6);
    expect(pointAt(line, -20)).toMatchObject({ x: 0, y: 0 });
    expect(pointAt(line, 999)).toMatchObject({ x: 50, y: 100 });
  });

  it('grows the same things beside a leg for the same seed', () => {
    const line = polyline(legPoints('switchbacks', 900, 46, 1440, 420));
    const once = decorate(line, 'leg/2');
    expect(once).toEqual(decorate(line, 'leg/2'));
    expect(once).not.toEqual(decorate(line, 'leg/3'));
    expect(once.length).toBeGreaterThan(1);
    for (const item of once) expect(['tussock', 'stone', 'cairn']).toContain(item.kind);
  });
});

describe('link age', () => {
  const today = new Date(2026, 10, 13);

  it('counts whole days since the links were opened', () => {
    expect(linkAge('2026-11-13', today)).toEqual({ days: 0, inDate: true });
    expect(linkAge('2026-11-01', today)).toEqual({ days: 12, inDate: true });
    expect(linkAge('2027-01-01', today)).toEqual({ days: 0, inDate: true });
  });

  it('suggests a recheck after 30 days for a fast topic and after 90 for any other', () => {
    expect(linkAge('2026-10-13', today, 'fast')?.inDate).toBe(false);
    expect(linkAge('2026-10-14', today, 'fast')?.inDate).toBe(true);
    expect(linkAge('2026-10-13', today, 'slow')?.inDate).toBe(true);
    expect(linkAge('2026-08-01', today, 'medium')?.inDate).toBe(false);
  });

  it('refuses a day it cannot read', () => {
    expect(linkAge('yesterday', today)).toBeNull();
    expect(linkAge('', today)).toBeNull();
  });
});
