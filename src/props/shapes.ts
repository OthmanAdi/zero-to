import type { Path } from './brush';

/**
 * The cuts a pair of scissors makes: straight edges with a slightly round corner, long curves, discs, bands.
 * Every helper returns a path in drawing units, to hand to a brush.
 */
export type Pt = readonly [x: number, y: number];

const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const dist = (a: Pt, b: Pt): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** A closed shape with straight edges. `round` softens the corners, as scissors do when they turn. */
export function poly(points: readonly Pt[], round = 0): Path {
  return (ctx) => {
    const n = points.length;
    if (n < 3) return;
    if (round <= 0) {
      ctx.moveTo((points[0] as Pt)[0], (points[0] as Pt)[1]);
      for (let i = 1; i < n; i += 1) ctx.lineTo((points[i] as Pt)[0], (points[i] as Pt)[1]);
      ctx.closePath();
      return;
    }
    const start = mid(points[n - 1] as Pt, points[0] as Pt);
    ctx.moveTo(start[0], start[1]);
    for (let i = 0; i < n; i += 1) {
      const before = points[(i + n - 1) % n] as Pt;
      const here = points[i] as Pt;
      const after = points[(i + 1) % n] as Pt;
      const r = Math.min(round, dist(before, here) * 0.45, dist(here, after) * 0.45);
      ctx.arcTo(here[0], here[1], after[0], after[1], r);
    }
    ctx.closePath();
  };
}

/** A closed soft shape. The points pull the curve towards them, they do not lie on it. */
export function curve(points: readonly Pt[]): Path {
  return (ctx) => {
    const n = points.length;
    if (n < 3) return;
    const start = mid(points[n - 1] as Pt, points[0] as Pt);
    ctx.moveTo(start[0], start[1]);
    for (let i = 0; i < n; i += 1) {
      const here = points[i] as Pt;
      const next = mid(here, points[(i + 1) % n] as Pt);
      ctx.quadraticCurveTo(here[0], here[1], next[0], next[1]);
    }
    ctx.closePath();
  };
}

/** An open run of straight strokes, for printed lines. */
export function strip(points: readonly Pt[]): Path {
  return (ctx) => {
    points.forEach((point, index) => (index === 0 ? ctx.moveTo(point[0], point[1]) : ctx.lineTo(point[0], point[1])));
  };
}

/** An open soft stroke through the first and last point, pulled towards the ones between. */
export function sweep(points: readonly Pt[]): Path {
  return (ctx) => {
    const n = points.length;
    if (n < 2) return;
    ctx.moveTo((points[0] as Pt)[0], (points[0] as Pt)[1]);
    if (n === 2) {
      ctx.lineTo((points[1] as Pt)[0], (points[1] as Pt)[1]);
      return;
    }
    for (let i = 1; i < n - 1; i += 1) {
      const here = points[i] as Pt;
      const next = i === n - 2 ? (points[n - 1] as Pt) : mid(here, points[i + 1] as Pt);
      ctx.quadraticCurveTo(here[0], here[1], next[0], next[1]);
    }
  };
}

export function disc(x: number, y: number, r: number): Path {
  return (ctx) => {
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.closePath();
  };
}

export function oval(x: number, y: number, rx: number, ry: number, turn = 0): Path {
  return (ctx) => {
    ctx.moveTo(x + rx * Math.cos(turn), y + rx * Math.sin(turn));
    ctx.ellipse(x, y, rx, ry, turn, 0, Math.PI * 2);
    ctx.closePath();
  };
}

/** A rectangle from its lower left corner, with round corners. */
export function box(x: number, y: number, width: number, height: number, round = 0): Path {
  return poly(
    [
      [x, y],
      [x + width, y],
      [x + width, y + height],
      [x, y + height],
    ],
    round,
  );
}

/** Points along a curve from `from` to `to` that bends towards `pull`. */
export function arcPoints(from: Pt, pull: Pt, to: Pt, steps = 10): Pt[] {
  const points: Pt[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    points.push([a * from[0] + b * pull[0] + c * to[0], a * from[1] + b * pull[1] + c * to[1]]);
  }
  return points;
}

/**
 * A band of paper that follows a line: a stem, a branch, a rail. Its width runs from `startWidth` at the first
 * point to `endWidth` at the last, and both ends are cut square.
 */
export function band(points: readonly Pt[], startWidth: number, endWidth = startWidth): Path {
  return (ctx) => {
    const n = points.length;
    if (n < 2) return;
    const left: Pt[] = [];
    const right: Pt[] = [];
    for (let i = 0; i < n; i += 1) {
      const before = points[Math.max(0, i - 1)] as Pt;
      const after = points[Math.min(n - 1, i + 1)] as Pt;
      const length = dist(before, after) || 1;
      const nx = -(after[1] - before[1]) / length;
      const ny = (after[0] - before[0]) / length;
      const half = (startWidth + ((endWidth - startWidth) * i) / (n - 1)) / 2;
      const here = points[i] as Pt;
      left.push([here[0] + nx * half, here[1] + ny * half]);
      right.push([here[0] - nx * half, here[1] - ny * half]);
    }
    ctx.moveTo((left[0] as Pt)[0], (left[0] as Pt)[1]);
    for (let i = 1; i < n; i += 1) ctx.lineTo((left[i] as Pt)[0], (left[i] as Pt)[1]);
    for (let i = n - 1; i >= 0; i -= 1) ctx.lineTo((right[i] as Pt)[0], (right[i] as Pt)[1]);
    ctx.closePath();
  };
}

/** A blade: wide at the root, a point at the tip, bent a little on the way. Grass, leaves, flames. */
export function blade(root: Pt, width: number, tip: Pt, bend = 0): Path {
  return (ctx) => {
    const dx = tip[0] - root[0];
    const dy = tip[1] - root[1];
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length;
    const ny = dx / length;
    const mx = root[0] + dx * 0.55 + nx * bend;
    const my = root[1] + dy * 0.55 + ny * bend;
    const hx = (nx * width) / 2;
    const hy = (ny * width) / 2;
    ctx.moveTo(root[0] + hx, root[1] + hy);
    ctx.quadraticCurveTo(mx + hx, my + hy, tip[0], tip[1]);
    ctx.quadraticCurveTo(mx - hx, my - hy, root[0] - hx, root[1] - hy);
    ctx.closePath();
  };
}

/**
 * The points of a lumpy round shape: a tree crown, a cloud, a bush. Hand them to `curve`. Every second point
 * sits further out, which gives the scalloped edge of a crown cut freehand.
 */
export function lumps(x: number, y: number, rx: number, ry: number, count: number, depth = 0.16, turn = 0): Pt[] {
  const points: Pt[] = [];
  const total = count * 2;
  for (let i = 0; i < total; i += 1) {
    const angle = turn + (i / total) * Math.PI * 2;
    const reach = i % 2 === 0 ? 1 + depth : 1 - depth;
    // A little unevenness that repeats, so the same crown is always cut the same way.
    const uneven = 1 + 0.05 * Math.sin(i * 2.4 + turn * 3);
    points.push([x + Math.cos(angle) * rx * reach * uneven, y + Math.sin(angle) * ry * reach * uneven]);
  }
  return points;
}

/** Several paths as one. */
export function all(...paths: readonly Path[]): Path {
  return (ctx) => {
    for (const path of paths) path(ctx);
  };
}

/** A path moved by `dx` and `dy`. */
export function shift(path: Path, dx: number, dy: number): Path {
  return (ctx) => {
    ctx.translate(dx, dy);
    path(ctx);
    ctx.translate(-dx, -dy);
  };
}

/** A path scaled about a point. */
export function scaled(path: Path, x: number, y: number, sx: number, sy = sx): Path {
  return (ctx) => {
    ctx.translate(x, y);
    ctx.scale(sx, sy);
    ctx.translate(-x, -y);
    path(ctx);
    ctx.translate(x, y);
    ctx.scale(1 / sx, 1 / sy);
    ctx.translate(-x, -y);
  };
}
