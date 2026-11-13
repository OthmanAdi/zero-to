import { describe, expect, it, vi } from 'vitest';
import { createManualClock } from './clock';

describe('createManualClock', () => {
  it('starts at the given time and reports it through now()', () => {
    expect(createManualClock().now()).toBe(0);
    expect(createManualClock(250).now()).toBe(250);
  });

  it('runs a queued frame when time advances, passing the current time', () => {
    const clock = createManualClock();
    const callback = vi.fn();
    clock.request(callback);
    expect(clock.pending()).toBe(1);

    clock.advance(1000 / 60);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]?.[0]).toBeCloseTo(1000 / 60);
    expect(clock.now()).toBeCloseTo(1000 / 60);
  });

  it('drops pending to zero once nothing re-requests a frame', () => {
    const clock = createManualClock();
    clock.request(() => undefined);
    clock.advance(100);
    expect(clock.pending()).toBe(0);
  });

  it('keeps running while a callback re-requests itself', () => {
    const clock = createManualClock();
    let calls = 0;
    const loop = (): void => {
      calls += 1;
      clock.request(loop);
    };
    clock.request(loop);
    clock.advance(100, 10);
    expect(calls).toBe(10);
    expect(clock.pending()).toBe(1);
  });

  it('steps in frameMs slices and a short remainder', () => {
    const clock = createManualClock();
    const times: number[] = [];
    const record = (time: number): void => {
      times.push(time);
      clock.request(record);
    };
    clock.request(record);
    clock.advance(25, 10);
    expect(times).toEqual([10, 20, 25]);
  });

  it('does not run a cancelled frame', () => {
    const clock = createManualClock();
    const callback = vi.fn();
    const handle = clock.request(callback);
    clock.cancel(handle);
    expect(clock.pending()).toBe(0);
    clock.advance(100);
    expect(callback).not.toHaveBeenCalled();
  });

  it('gives each request a distinct handle', () => {
    const clock = createManualClock();
    const first = clock.request(() => undefined);
    const second = clock.request(() => undefined);
    expect(first).not.toBe(second);
  });
});
