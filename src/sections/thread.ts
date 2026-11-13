import { CAIRN, STONE, TUSSOCK, WALKER } from './art';
import { svg, svgEl } from './dom';
import { decorate, indexAt, pointAt, polyline, type PathPoint, type Point, type Polyline } from './model';

/**
 * The red thread in the page: one small SVG per piece (a leg across a gap, or the leg inside a box), each with
 * the faint dashes of the way ahead and the route-coloured dashes of the way done. The walker of the page
 * stands at the head.
 */

export interface ThreadPieceView {
  readonly element: SVGSVGElement;
  readonly line: Polyline;
  /** Draws the done part up to this length. Pass the full length or more for a finished piece. */
  setDone(length: number): PathPoint;
  /** Shows or hides the head dot of this piece. */
  setHead(point: PathPoint | null): void;
}

function pathOf(points: readonly Point[], upTo = points.length - 1, tail?: Point): string {
  let d = '';
  for (let index = 0; index <= upTo; index += 1) {
    const point = points[index] as Point;
    d += `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
  }
  if (tail) d += `L${tail.x.toFixed(1)} ${tail.y.toFixed(1)}`;
  return d;
}

export interface PieceOptions {
  /** A seed for what grows beside the leg. Without one nothing grows. */
  readonly deco?: string;
  /** Contour rings round a point of the leg, as on a map where the path circles a hill. */
  readonly rings?: boolean;
}

export function createPiece(points: readonly Point[], width: number, height: number, options: PieceOptions = {}): ThreadPieceView {
  const line = polyline(points);
  const element = svgEl('svg', { class: 'zs-thread', viewBox: `0 0 ${Math.max(1, width)} ${Math.max(1, height)}`, 'aria-hidden': 'true', focusable: 'false' });
  element.setAttribute('preserveAspectRatio', 'none');

  if (options.rings && line.length > 0) {
    const centre = pointAt(line, line.length * 0.52);
    const rings = svgEl('g', { class: 'zs-thread-rings' });
    for (let ring = 1; ring <= 7; ring += 1) {
      rings.append(svgEl('ellipse', { cx: (centre.x + 70).toFixed(1), cy: centre.y.toFixed(1), rx: ring * 22, ry: ring * 13, transform: `rotate(-12 ${(centre.x + 70).toFixed(1)} ${centre.y.toFixed(1)})` }));
    }
    element.append(rings);
  }

  if (options.deco) {
    const group = svgEl('g', { class: 'zs-thread-deco' });
    let inner = '';
    for (const item of decorate(line, options.deco)) {
      const art = item.kind === 'tussock' ? TUSSOCK : item.kind === 'stone' ? STONE : CAIRN;
      inner += `<g transform="translate(${item.x.toFixed(1)} ${item.y.toFixed(1)}) scale(${(item.flip ? -item.size : item.size).toFixed(2)} ${item.size.toFixed(2)})">${art}</g>`;
    }
    group.innerHTML = inner;
    element.append(group);
  }

  const full = pathOf(line.points);
  const ahead = svgEl('path', { class: 'zs-thread-ahead', d: full });
  const done = svgEl('path', { class: 'zs-thread-done', d: '' });
  const head = svgEl('circle', { class: 'zs-thread-head', r: 5, cx: 0, cy: 0 });
  head.style.display = 'none';
  element.append(ahead, done, head);

  let drawn = -1;
  return {
    element,
    line,
    setDone(length) {
      const at = pointAt(line, length);
      const clamped = Math.min(line.length, Math.max(0, length));
      // Rounded to a pixel, so a resting page does not rewrite the path.
      const key = Math.round(clamped);
      if (key !== drawn) {
        drawn = key;
        if (clamped <= 0) done.setAttribute('d', '');
        else if (clamped >= line.length) done.setAttribute('d', full);
        else done.setAttribute('d', pathOf(line.points, indexAt(line, clamped), at));
      }
      return at;
    },
    setHead(point) {
      if (!point) {
        head.style.display = 'none';
        return;
      }
      head.style.display = '';
      head.setAttribute('cx', point.x.toFixed(1));
      head.setAttribute('cy', point.y.toFixed(1));
    },
  };
}

export interface WalkerView {
  readonly element: HTMLElement;
  /** Puts the walker on a point of a piece. `walked` is the length of thread behind him: it swings his legs. */
  place(host: Element, point: PathPoint, walked: number, still: boolean): void;
  hide(): void;
}

/** The walker of the page: our own cut-out, with legs that swing with the distance walked, not with time. */
export function createWalker(): WalkerView {
  const element = document.createElement('span');
  element.className = 'zs-walker';
  element.setAttribute('aria-hidden', 'true');
  const figure = svg(WALKER.viewBox, WALKER.body);
  element.append(figure);
  const legA = figure.querySelector<SVGGElement>('.zs-walker-leg-a');
  const legB = figure.querySelector<SVGGElement>('.zs-walker-leg-b');
  let facing = 1;
  let parent: Element | null = null;
  return {
    element,
    place(host, point, walked, still) {
      if (parent !== host) {
        host.append(element);
        parent = host;
      }
      const heading = Math.cos(point.angle);
      if (heading > 0.3) facing = 1;
      else if (heading < -0.3) facing = -1;
      const phase = walked / 11;
      const swing = still ? 0 : Math.sin(phase) * 16;
      const bob = still ? 0 : Math.abs(Math.sin(phase)) * 2.2;
      element.hidden = false;
      element.style.transform = `translate(${point.x.toFixed(1)}px, ${(point.y - bob).toFixed(1)}px) scaleX(${facing})`;
      legA?.setAttribute('transform', `rotate(${swing.toFixed(1)} 34 50)`);
      legB?.setAttribute('transform', `rotate(${(-swing).toFixed(1)} 34 50)`);
    },
    hide() {
      element.hidden = true;
    },
  };
}
