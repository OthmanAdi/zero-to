import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createProgressTracker,
  positionFromMetrics,
  scrollTopFor,
  type BlockBox,
  type ScrollMetrics,
} from './progress';
import type { ReaderProgress } from './types';

const blocks: BlockBox[] = [
  { top: 100, bottom: 200 },
  { top: 220, bottom: 520 },
  { top: 540, bottom: 640 },
];
const metrics = (scrollTop: number): ScrollMetrics => ({ scrollTop, scrollHeight: 1000, clientHeight: 400 });

describe('positionFromMetrics', () => {
  it('finds the first block whose bottom is below the reading edge', () => {
    expect(positionFromMetrics(metrics(0), blocks, 60)).toEqual({ block: 0, ratio: 0, percent: 0 });
    expect(positionFromMetrics(metrics(90), blocks, 60)).toMatchObject({ block: 0, ratio: 0.5 });
    expect(positionFromMetrics(metrics(300), blocks, 0)).toMatchObject({ block: 1, ratio: 80 / 300 });
  });

  it('skips blocks that are fully above the edge', () => {
    expect(positionFromMetrics(metrics(560), blocks, 0).block).toBe(2);
  });

  it('reports the last block at ratio 1 past the end', () => {
    expect(positionFromMetrics(metrics(600), blocks, 100)).toMatchObject({ block: 2, ratio: 1, percent: 1 });
  });

  it('computes percent from scrollTop over the scrollable range, clamped', () => {
    expect(positionFromMetrics(metrics(300), blocks).percent).toBe(0.5);
    expect(positionFromMetrics(metrics(-50), blocks).percent).toBe(0);
    expect(positionFromMetrics(metrics(5000), blocks).percent).toBe(1);
  });

  it('reports percent 1 when the content does not scroll', () => {
    const fits = { scrollTop: 0, scrollHeight: 300, clientHeight: 400 };
    expect(positionFromMetrics(fits, blocks).percent).toBe(1);
  });

  it('copes with no blocks and with a zero-height block', () => {
    expect(positionFromMetrics(metrics(0), [])).toEqual({ block: 0, ratio: 0, percent: 0 });
    expect(positionFromMetrics(metrics(10), [{ top: 0, bottom: 0 }, { top: 0, bottom: 100 }])).toMatchObject({
      block: 1,
    });
  });
});

describe('scrollTopFor', () => {
  it('round trips with positionFromMetrics inside blocks', () => {
    const inset = 56;
    for (const scrollTop of [20, 90, 150, 300, 450, 520]) {
      const position = positionFromMetrics(metrics(scrollTop), blocks, inset);
      const back = scrollTopFor(position, blocks, inset);
      const again = positionFromMetrics(metrics(back), blocks, inset);
      expect(again.block).toBe(position.block);
      expect(again.ratio).toBeCloseTo(position.ratio, 6);
    }
  });

  it('places the saved spot at the reading edge', () => {
    expect(scrollTopFor({ block: 1, ratio: 0.5 }, blocks, 50)).toBe(220 + 150 - 50);
  });

  it('clamps to the scrollable range and to the known blocks', () => {
    expect(scrollTopFor({ block: 1, ratio: 0 }, blocks, 500)).toBe(0);
    expect(scrollTopFor({ block: 2, ratio: 1 }, blocks, 0, 600)).toBe(600);
    expect(scrollTopFor({ block: 99, ratio: 0 }, blocks, 0)).toBe(540);
    expect(scrollTopFor({ block: 0, ratio: 0 }, [], 0)).toBe(0);
    expect(scrollTopFor({ block: Number.NaN, ratio: Number.NaN }, blocks, 0)).toBe(100);
  });
});

describe('createProgressTracker', () => {
  afterEach(() => vi.unstubAllGlobals());

  function setup() {
    const queue: (() => void)[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => queue.push(callback));
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const scroller = document.createElement('div');
    let scrollTop = 0;
    Object.defineProperties(scroller, {
      scrollTop: { get: () => scrollTop, set: (value: number) => (scrollTop = value) },
      scrollHeight: { value: 1000 },
      clientHeight: { value: 400 },
    });
    const reports: { position: ReaderProgress; silent: boolean }[] = [];
    const tracker = createProgressTracker({
      scroller,
      measure: () => blocks,
      topInset: () => 0,
      onChange: (position, silent) => reports.push({ position, silent }),
    });
    const flush = () => queue.splice(0).forEach((callback) => callback());
    const scrollTo = (top: number) => {
      scrollTop = top;
      scroller.dispatchEvent(new Event('scroll'));
      flush();
    };
    return { tracker, scroller, reports, scrollTo, queue, setTop: (top: number) => (scrollTop = top) };
  }

  it('throttles scroll events to one frame and reports only changes', () => {
    const { tracker, reports, scrollTo, queue, scroller, setTop } = setup();
    setTop(150);
    scroller.dispatchEvent(new Event('scroll'));
    scroller.dispatchEvent(new Event('scroll'));
    expect(queue).toHaveLength(1);
    queue.splice(0).forEach((callback) => callback());
    expect(reports).toHaveLength(1);
    expect(reports[0]?.silent).toBe(false);
    scrollTo(150);
    expect(reports).toHaveLength(1);
    scrollTo(300);
    expect(reports).toHaveLength(2);
    expect(tracker.current()).toEqual(reports[1]?.position);
  });

  it('restores a position and does not report it as a person-made change', () => {
    const { tracker, reports, scroller } = setup();
    tracker.restore({ block: 1, ratio: 0.5, percent: 0.4 });
    expect(scroller.scrollTop).toBe(370);
    expect(reports.every((report) => report.silent)).toBe(true);
    expect(tracker.current()).toMatchObject({ block: 1, ratio: 0.5 });
  });

  it('restores percent 0 to the very top', () => {
    const { tracker, scroller } = setup();
    tracker.restore({ block: 0, ratio: 0, percent: 0 });
    expect(scroller.scrollTop).toBe(0);
  });

  it('re-applies a restore on settle only while the person has not moved', () => {
    const { tracker, scroller, scrollTo } = setup();
    tracker.restore({ block: 1, ratio: 0, percent: 0.3 });
    scroller.scrollTop = 0;
    tracker.settle();
    expect(scroller.scrollTop).toBe(0);
    tracker.restore({ block: 1, ratio: 0, percent: 0.3 });
    tracker.settle();
    expect(scroller.scrollTop).toBe(220);
    scrollTo(40);
    tracker.settle();
    expect(scroller.scrollTop).toBe(40);
  });

  it('removes its listener on destroy', () => {
    const { tracker, reports, scroller, queue } = setup();
    tracker.destroy();
    scroller.scrollTop = 300;
    scroller.dispatchEvent(new Event('scroll'));
    expect(queue).toHaveLength(0);
    expect(reports).toHaveLength(0);
  });
});
