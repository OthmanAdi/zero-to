import { describe, expect, it } from 'vitest';
import { createRandom } from '../core/random';
import { layoutDial } from './dial-layout';
import { paintDial, withAlpha, type DialColors } from './dial-texture';

interface Call {
  readonly name: string;
  readonly args: readonly unknown[];
  readonly fillStyle: unknown;
  readonly font: unknown;
}

/** A stand-in for a 2D context that records what is drawn. No pixels, so it runs without a canvas. */
function recorder(): { ctx: CanvasRenderingContext2D; calls: Call[]; depth: () => number } {
  const calls: Call[] = [];
  const state: Record<string, unknown> = {};
  let depth = 0;
  const gradient = { addColorStop: (): void => undefined };
  const ctx = new Proxy(state, {
    get(target, key) {
      if (typeof key !== 'string') return undefined;
      if (key in target) return target[key];
      return (...args: unknown[]) => {
        if (key === 'save') depth += 1;
        if (key === 'restore') depth -= 1;
        calls.push({ name: key, args, fillStyle: target.fillStyle, font: target.font });
        return key.startsWith('create') ? gradient : undefined;
      };
    },
    set(target, key, value) {
      if (typeof key === 'string') target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls, depth: () => depth };
}

const COLORS: DialColors = {
  paper: '#f3ece0',
  paperShade: '#d9cdb8',
  ink: '#1f2a3d',
  inkSoft: '#5a6577',
  signal: '#e2492f',
  engraving: '#1a130b',
};

describe('paintDial', () => {
  const layout = layoutDial();
  const paint = (): ReturnType<typeof recorder> => {
    const recording = recorder();
    paintDial(recording.ctx, { size: 1024, layout, colors: COLORS, random: createRandom('test') });
    return recording;
  };

  it('prints every letter and numeral of the layout', () => {
    const { calls } = paint();
    const texts = calls.filter((call) => call.name === 'fillText').map((call) => call.args[0]);
    for (const label of [...layout.ringLabels, ...layout.cardLabels]) expect(texts).toContain(label.text);
    expect(texts).toHaveLength(layout.ringLabels.length + layout.cardLabels.length);
  });

  it('engraves the ring letters dark and the card letters in ink', () => {
    const { calls } = paint();
    const text = (value: string): Call | undefined => calls.find((call) => call.name === 'fillText' && call.args[0] === value);
    expect(text('N')?.fillStyle).toBe(COLORS.engraving);
    expect(text('NE')?.fillStyle).toBe(COLORS.ink);
    expect(String(text('N')?.font)).toContain('Georgia');
  });

  it('starts from a white sheet, so the metal ring keeps its own colour', () => {
    const { calls } = paint();
    const first = calls.find((call) => call.name === 'fillRect');
    expect(first?.fillStyle).toBe('#ffffff');
    expect(first?.args).toEqual([0, 0, 1024, 1024]);
  });

  it('fills the north mark in the signal colour', () => {
    const { calls } = paint();
    expect(calls.some((call) => call.name === 'fill' && call.fillStyle === COLORS.signal)).toBe(true);
  });

  it('balances save and restore', () => {
    expect(paint().depth()).toBe(0);
  });

  it('draws the same thing for the same seed', () => {
    const a = paint().calls.map((call) => [call.name, call.args]);
    const b = paint().calls.map((call) => [call.name, call.args]);
    expect(a).toEqual(b);
  });
});

describe('withAlpha', () => {
  it('turns hex into rgba', () => {
    expect(withAlpha('#ff8000', 0.5)).toBe('rgba(255, 128, 0, 0.5)');
    expect(withAlpha('#fff', 1)).toBe('rgba(255, 255, 255, 1)');
    expect(withAlpha('#000000', 7)).toBe('rgba(0, 0, 0, 1)');
  });

  it('passes other colours through', () => {
    expect(withAlpha('tomato', 0.5)).toBe('tomato');
  });
});
