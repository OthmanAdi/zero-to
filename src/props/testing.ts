import { boardPieces } from './board';
import type { NamedDrawing } from './brush';
import { DESIGN } from './brush';
import { campPieces } from './camp';
import { allProps } from './registry';
import { signpostPieces } from './signpost';
import { SIGNPOSTS, SIGNPOST_KEYS } from './signposts';
import { stationPieces } from './station';
import { walkerPieces } from './walker';

/**
 * Helpers for checking drawings without a browser: a list of every drawing in the package, and a stand-in for
 * a 2D canvas that draws nothing and remembers the colours it was given.
 */

/** Every drawing this package can put on paper: props, posts, arms, flags, the walker, the station pieces. */
export function allDrawings(): NamedDrawing[] {
  return [
    ...allProps().map((art) => ({ name: art.id, draw: art.draw, width: art.size.width * DESIGN, height: art.size.height * DESIGN })),
    ...SIGNPOST_KEYS.map((key) => ({ name: `signpost/${key}`, draw: SIGNPOSTS[key].draw, width: SIGNPOSTS[key].size.width * DESIGN, height: SIGNPOSTS[key].size.height * DESIGN })),
    ...signpostPieces(),
    ...boardPieces(),
    ...campPieces(),
    ...walkerPieces(),
    ...stationPieces(),
  ];
}

export interface Recording {
  readonly ctx: CanvasRenderingContext2D;
  /** Every colour set as a fill, a stroke, a shadow or a gradient stop, as it was written. */
  readonly colors: Set<string>;
  /** Text handed to `fillText`. */
  readonly texts: string[];
  /** Number of fills and strokes. */
  readonly marks: { fills: number; strokes: number };
}

/** A canvas context that draws nothing. Text is measured at half its size per character. */
export function recordingContext(): Recording {
  const colors = new Set<string>();
  const texts: string[] = [];
  const marks = { fills: 0, strokes: 0 };
  const values: Record<string, unknown> = { font: '10px sans-serif', textAlign: 'left', direction: 'ltr', textBaseline: 'alphabetic', lineWidth: 1 };
  const gradient = { addColorStop: (_offset: number, color: string) => void colors.add(color) };
  const px = () => Number(/(\d+(?:\.\d+)?)px/.exec(String(values.font))?.[1] ?? 10);
  const methods: Record<string, (...args: never[]) => unknown> = {
    fill: () => void (marks.fills += 1),
    stroke: () => void (marks.strokes += 1),
    fillRect: () => void (marks.fills += 1),
    strokeRect: () => void (marks.strokes += 1),
    fillText: (text: string) => void texts.push(text),
    measureText: (text: string) => ({ width: Array.from(text).length * px() * 0.5 }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    getLineDash: () => [],
  };
  const ctx = new Proxy(values, {
    get(target, name) {
      if (typeof name !== 'string') return undefined;
      if (name in target) return target[name];
      return methods[name] ?? (() => undefined);
    },
    set(target, name, value) {
      if (typeof name !== 'string') return true;
      if ((name === 'fillStyle' || name === 'strokeStyle' || name === 'shadowColor') && typeof value === 'string') colors.add(value);
      target[name] = value;
      return true;
    },
    has(target, name) {
      return typeof name === 'string' && name in target;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, colors, texts, marks };
}

/** A CSS colour as `#rrggbb`, with any alpha dropped. Null when it is neither a hex colour nor `rgb()`/`rgba()`. */
export function baseColor(color: string): string | null {
  const text = color.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(text);
  if (hex?.[1]) return `#${hex[1].length === 3 ? hex[1].replace(/./g, '$&$&') : hex[1]}`;
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(text);
  if (!rgb) return null;
  return `#${[rgb[1], rgb[2], rgb[3]].map((part) => Number(part).toString(16).padStart(2, '0')).join('')}`;
}

/** Every colour of a theme object as `#rrggbb`. */
export function themeColors(theme: Readonly<Record<string, unknown>>): Set<string> {
  const found = new Set<string>();
  const walk = (node: Readonly<Record<string, unknown>>) => {
    for (const value of Object.values(node)) {
      if (typeof value === 'string') {
        const base = baseColor(value);
        if (base) found.add(base);
      } else if (value && typeof value === 'object') walk(value as Record<string, unknown>);
    }
  };
  walk(theme);
  return found;
}
