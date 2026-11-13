import { BufferGeometry, CanvasTexture, DoubleSide, Float32BufferAttribute, LinearMipmapLinearFilter, Mesh, MeshStandardMaterial, SRGBColorSpace } from 'three';
import { THEME, withAlpha } from '../look/theme';
import { canvasFont, drawText, measureTextWidth } from '../look/type';
import { PAPER_WARP_GLSL, type PaperDepthMaterial, type PaperMaterial } from '../paper/material';
import { PANEL } from './fold';
import { CAIRN, cairnSpot, panelRoutePoints, type PanelMark, type PanelPlan, type PanelPoint } from './plan';
import { MODEL } from './strip';

/**
 * The waypoint marks and their titles on a panel. They are not printed on the paper: the card model is cut out of
 * the print, and a title that crosses a card edge would be sliced in two at different heights, with half of it
 * showing again on the card below. Each title and each mark is a flat label of its own instead. It lies on the
 * highest card under it, rides the cards as they rise and bends with the paper, like the route.
 */
export const LABEL = {
  /** The title's type, the widest a title may be, and the paper strip under it, in scene units. */
  size: 0.082,
  maxWidth: 1.05,
  pad: 0.03,
  /** The strip reaches this far above the baseline and this far below it. */
  ascent: 0.078,
  descent: 0.027,
  /** Where the baseline lies from the mark: in front of it, or behind it. */
  front: 0.2,
  behind: 0.115,
  /** A title keeps this far inside the panel's sides. */
  edge: 0.1,
  /**
   * A title behind its mark stands beside it, at least this far from the mark. The walker stops on the mark, and
   * he is 0.29 tall: whatever lies behind his feet is behind his figure in the picture. On the right it also keeps
   * clear of the cairn, which stands behind the mark there.
   */
  clear: 0.12,
  /**
   * A title in front of its mark may also start or end this far from the mark, or lie a row or two further out,
   * to keep off the route and its neighbours. A row is a strip and room on both sides of it.
   */
  near: 0.1,
  row: 0.15,
  /** Or slide this far to either side of the middle. */
  shift: 0.25,
  /** A title keeps this far from the middle of the route and the side trails, and from the other labels. */
  margin: 0.035,
  /**
   * How much further back a thing appears for each unit it is lifted, to a camera that looks down at 30 degrees:
   * a title on a high card over a low stretch of route would otherwise cover the route in the picture.
   */
  view: 1 / Math.tan(Math.PI / 6),
  /** Half the width of the stage board, the signpost with its arms and the camp, and how tall they stand. */
  tall: { board: { half: 0.5, height: 0.96 }, signpost: { half: 0.45, height: 1 }, camp: { half: 0.5, height: 1 } },
  /** The mark: a ring of this radius and line, and the square it is drawn in. */
  mark: 0.036,
  ring: 0.012,
  dot: 0.05,
  /**
   * A label is lifted over the cards a little in front of it too. A card that stands that close in front of it
   * would otherwise hide its near edge from a camera that looks down at 30 degrees.
   */
  sight: 0.08,
  /** Height over the card it lies on, the same as the route's. */
  lift: 0.004,
  /** How finely the cards under a label are looked at. */
  step: 0.02,
  /** How fast the labels come and go when their panel lands and folds, per second. */
  fade: 5,
} as const;

export interface LabelRect {
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
}

export interface PanelLabel {
  readonly mark: PanelMark;
  /** The title as it is printed: shortened with an ellipsis when it is wider than `LABEL.maxWidth`. */
  readonly text: string;
  readonly width: number;
  /** In front of the mark, or behind it and to one side of it. */
  readonly below: boolean;
  /** Where the text starts and where its baseline lies, in panel coordinates. */
  readonly left: number;
  readonly baseline: number;
  /** The paper strip under the title. */
  readonly strip: LabelRect;
  /** The highest card under the strip and just in front of it, which the strip lies on. -1 is the bare panel. */
  readonly card: number;
  /** The mark's own square, and the card it lies on. */
  readonly dot: LabelRect;
  readonly dotCard: number;
}

/** Shortens a title to `max` with an ellipsis. */
export function fitTitle(text: string, max: number, measure: (text: string) => number): string {
  if (measure(text) <= max) return text;
  const parts = Array.from(text);
  while (parts.length > 1 && measure(`${parts.join('').trimEnd()}…`) > max) parts.pop();
  return `${parts.join('').trimEnd()}…`;
}

/** The highest card under a rectangle of a panel, looking `sight` further toward the front. -1 is the bare panel. */
export function cardUnder(panel: Pick<PanelPlan, 'cards'>, rect: LabelRect, sight: number = LABEL.sight, step: number = LABEL.step): number {
  const z1 = rect.z1 + sight;
  const across = Math.max(1, Math.ceil((rect.x1 - rect.x0) / step));
  const deep = Math.max(1, Math.ceil((z1 - rect.z0) / step));
  let card = -1;
  for (let j = 0; j <= deep; j += 1) {
    const z = rect.z0 + ((z1 - rect.z0) * j) / deep;
    for (let i = 0; i <= across; i += 1) card = Math.max(card, panel.cards.cardAt(rect.x0 + ((rect.x1 - rect.x0) * i) / across, z));
  }
  return card;
}

const dotOf = (mark: PanelPoint): LabelRect => ({ x0: mark.x - LABEL.dot, x1: mark.x + LABEL.dot, z0: mark.z - LABEL.dot, z1: mark.z + LABEL.dot });
const meets = (a: LabelRect, b: LabelRect): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
const grow = (rect: LabelRect, by: number): LabelRect => ({ x0: rect.x0 - by, x1: rect.x1 + by, z0: rect.z0 - by, z1: rect.z1 + by });

/** Points along a line, no further apart than `step`. */
function along(points: readonly PanelPoint[], step: number): PanelPoint[] {
  const out: PanelPoint[] = [];
  for (let k = 0; k < points.length - 1; k += 1) {
    const a = points[k] as PanelPoint;
    const b = points[k + 1] as PanelPoint;
    const pieces = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
    for (let piece = 0; piece < pieces; piece += 1) out.push({ x: a.x + ((b.x - a.x) * piece) / pieces, z: a.z + ((b.z - a.z) * piece) / pieces });
  }
  const last = points[points.length - 1];
  if (last) out.push(last);
  return out;
}

/**
 * Where the marks and titles of a panel lie. `measure` gives the width of a title in scene units.
 *
 * A title would rather lie in front of its mark and behind it in turn, and a side trail's title beyond its mark,
 * away from the route. It never lies right behind its mark: the walker stops there and his figure would cover it.
 * Behind, it moves to the mark's left, or to its right past the cairn. In front, it may also start or end at the
 * mark, and either side may take a row further out. Each title takes the first of these places that crosses
 * neither the route, a side trail, another title nor another mark, and that no cairn, board, signpost or camp
 * stands in front of, as the camera sees them; where none is free, the one that crosses least.
 */
export function planLabels(
  panel: Pick<PanelPlan, 'marks' | 'cards' | 'first' | 'last' | 'route' | 'board' | 'signpost' | 'camp'>,
  measure: (text: string) => number,
): PanelLabel[] {
  // Everything is compared where the camera sees it: lifted by the cards it stands on, it appears further back.
  const lift = (card: number): number => (card + 1) * MODEL.thickness * LABEL.view;
  const seen = (rect: LabelRect, card: number): LabelRect => ({ x0: rect.x0, x1: rect.x1, z0: rect.z0 - lift(card), z1: rect.z1 - lift(card) });
  const lines = [along(panelRoutePoints(panel as PanelPlan), 0.01), ...panel.marks.flatMap((mark) => (mark.spur ? [along(mark.spur.points, 0.01)] : []))]
    .flat()
    .map((point) => ({ x: point.x, z: point.z - lift(panel.cards.cardAt(point.x, point.z)) }));
  const dots = panel.marks.map(dotOf);
  const dotCards = dots.map((dot) => cardUnder(panel, dot));
  const seenDots = dots.map((dot, k) => seen(dot, dotCards[k] as number));
  // A thing that stands on the panel hides the ground behind it in the picture, as far back as it is tall.
  const standing = (spot: PanelPoint, half: number, height: number): LabelRect =>
    seen({ x0: spot.x - half, x1: spot.x + half, z0: spot.z - height * LABEL.view, z1: spot.z + LABEL.margin }, panel.cards.cardAt(spot.x, spot.z));
  const tall = [
    ...panel.marks.flatMap((mark) => (mark.waypoint.checks && mark.waypoint.checks.length > 0 ? [standing(cairnSpot(mark), CAIRN.half, CAIRN.height)] : [])),
    standing(panel.board, LABEL.tall.board.half, LABEL.tall.board.height),
    standing(panel.signpost, LABEL.tall.signpost.half, LABEL.tall.signpost.height),
    standing(panel.camp, LABEL.tall.camp.half, LABEL.tall.camp.height),
  ];
  const placed: LabelRect[] = [];
  return panel.marks.map((mark, index) => {
    const text = fitTitle(mark.waypoint.title, LABEL.maxWidth, measure);
    const width = Math.min(LABEL.maxWidth, measure(text));
    interface Place {
      readonly below: boolean;
      readonly left: number;
      readonly baseline: number;
    }
    const stripAt = (place: Place): LabelRect => ({ x0: place.left - LABEL.pad, x1: place.left + width + LABEL.pad, z0: place.baseline - LABEL.ascent, z1: place.baseline + LABEL.descent });
    const inside = (left: number): number => Math.min(PANEL.width - LABEL.edge - width, Math.max(LABEL.edge, left));
    const across = [mark.x - width / 2, inside(mark.x - width / 2), mark.x - LABEL.near, mark.x + LABEL.near - width, mark.x - width / 2 - LABEL.shift, mark.x - width / 2 + LABEL.shift];
    const front = (row: number): Place[] => across.map((left) => ({ below: true, left, baseline: mark.z + LABEL.front + row * LABEL.row }));
    // Behind: on the mark's left, or on its right past the walker, and past the cairn where the step has one.
    const hasCairn = Boolean(mark.waypoint.checks && mark.waypoint.checks.length > 0);
    const right = hasCairn ? CAIRN.aside + CAIRN.half + LABEL.margin : LABEL.clear;
    const behind = (row: number): Place[] =>
      [mark.x - LABEL.clear - LABEL.pad - width, mark.x + right + LABEL.pad].map((left) => ({ below: false, left, baseline: mark.z - LABEL.behind - row * LABEL.row }));
    const inFront = mark.spur ? mark.z >= mark.on.z : index % 2 === 1;
    const first = inFront ? [...front(0), ...behind(0)] : [...behind(0), ...front(0)];
    const places = [...first, ...front(1), ...behind(1), ...front(2)].filter(({ left }) => left >= LABEL.edge - 1e-9 && left + width <= PANEL.width - LABEL.edge + 1e-9);
    // How much a place crosses, as the camera sees it: every bit of route or side trail under it, and far more for a
    // title, a mark or a cairn.
    const crossing = (rect: LabelRect): number => {
      const near = grow(seen(rect, cardUnder(panel, rect, LABEL.sight, LABEL.step * 2)), LABEL.margin);
      let count = 0;
      for (const point of lines) if (point.x > near.x0 && point.x < near.x1 && point.z > near.z0 && point.z < near.z1) count += 1;
      for (const other of placed) if (meets(near, other)) count += 1000;
      seenDots.forEach((dot, k) => {
        if (k !== index && meets(near, dot)) count += 500;
      });
      // A sign is far thinner than its box: a title it grazes is cheaper than one it covers.
      const area = (near.x1 - near.x0) * (near.z1 - near.z0);
      for (const thing of tall) {
        const covered = Math.max(0, Math.min(near.x1, thing.x1) - Math.max(near.x0, thing.x0)) * Math.max(0, Math.min(near.z1, thing.z1) - Math.max(near.z0, thing.z0));
        count += Math.round((400 * covered) / area);
      }
      return count;
    };
    // Where no place is on the panel at all: in front, where the walker never covers it, pushed inside the panel.
    let best: Place = { below: true, left: Math.min(PANEL.width - LABEL.edge - width, Math.max(LABEL.edge, mark.x - width / 2)), baseline: mark.z + LABEL.front };
    let least = Infinity;
    for (const place of places) {
      const cost = crossing(stripAt(place));
      if (cost < least) {
        least = cost;
        best = place;
      }
      if (cost === 0) break;
    }
    const strip = stripAt(best);
    const card = cardUnder(panel, strip);
    placed.push(seen(strip, card));
    const dot = dots[index] as LabelRect;
    return { mark, text, width, below: best.below, left: best.left, baseline: best.baseline, strip, card, dot, dotCard: dotCards[index] as number };
  });
}

type LabelMaterial = MeshStandardMaterial;

export interface LabelLayer {
  /** In the frame of the panel's sheet: x from the middle of the panel, z as the panel's. */
  readonly mesh: Mesh<BufferGeometry, LabelMaterial>;
  readonly labels: readonly PanelLabel[];
  /** Lays every label on its card. `top` is the height of a card's top right now; -1 is the bare panel. */
  setHeights(top: (card: number) => number): void;
  /** Whether the labels should show: they come when their panel lies open and go when it folds. */
  setShown(shown: boolean): void;
  /** Steps the fade. */
  update(dt: number, reduced: boolean): void;
  /** Puts the fade where it is heading. */
  settle(): void;
  /** Lays the labels out and prints them again: when the ink of the panel changes, or the fonts arrived. */
  repaint(ink: number): void;
  dispose(): void;
}

export interface LabelLayerOptions {
  /** The sheet the labels lie on: they bend with it. */
  readonly follow: PaperMaterial | PaperDepthMaterial;
  /** Pixels per scene unit of the labels' print. */
  readonly resolution: number;
  readonly ink: number;
  /** Language of the roadmap's text. */
  readonly lang: string;
}

const LABEL_KEY = 'zt-label-1';

/** The labels of one panel as one mesh: a quad per title and per mark, printed on one small canvas. */
export function createLabelLayer(panel: PanelPlan, options: LabelLayerOptions): LabelLayer {
  const res = options.resolution;
  const gap = 4;
  const count = panel.marks.length;
  const stripPx = { width: Math.ceil((LABEL.maxWidth + 2 * LABEL.pad) * res), height: Math.ceil((LABEL.ascent + LABEL.descent) * res) };
  const dotPx = Math.ceil(2 * LABEL.dot * res);
  const canvas = document.createElement('canvas');
  canvas.width = gap * 3 + stripPx.width + dotPx;
  canvas.height = gap + Math.max(1, count) * (Math.max(stripPx.height, dotPx) + gap);
  const ctx = canvas.getContext('2d');
  const font = canvasFont('text', LABEL.size * res, 600);
  const measure = (text: string): number => {
    if (!ctx) return text.length * LABEL.size * 0.55;
    ctx.font = font;
    return measureTextWidth(ctx, text, { lang: options.lang }) / res;
  };
  const rowOf = (index: number): number => gap + index * (Math.max(stripPx.height, dotPx) + gap);

  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 8;
  map.minFilter = LinearMipmapLinearFilter;

  const geometry = new BufferGeometry();
  const positions = new Float32BufferAttribute(new Float32Array(count * 2 * 4 * 3), 3);
  const uvs = new Float32BufferAttribute(new Float32Array(count * 2 * 4 * 2), 2);
  const normals = new Float32BufferAttribute(new Float32Array(count * 2 * 4 * 3).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3);
  const indices: number[] = [];
  for (let quad = 0; quad < count * 2; quad += 1) {
    const base = quad * 4;
    // Wound to face up: corner 0 back left, 1 back right, 2 front left, 3 front right.
    indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  geometry.setAttribute('position', positions);
  geometry.setAttribute('normal', normals);
  geometry.setAttribute('uv', uvs);
  geometry.setIndex(indices);

  const material: LabelMaterial = new MeshStandardMaterial({
    map,
    transparent: true,
    depthWrite: false,
    roughness: 0.94,
    metalness: 0,
    side: DoubleSide,
    // Over the paper, and under the route where the two meet: the route's ribbon is pushed further.
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const paper = options.follow.userData.paper;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uZtBox = paper.uZtBox;
    shader.uniforms.uZtShape = paper.uZtShape;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${PAPER_WARP_GLSL}`).replace(
      '#include <begin_vertex>',
      /* glsl */ `#include <begin_vertex>
	vec2 ztLabelSlope;
	transformed.y += ztWarp( vec2( position.x, - position.z ), 1.0, ztLabelSlope );`,
    );
  };
  material.customProgramCacheKey = () => LABEL_KEY;

  const mesh = new Mesh(geometry, material);
  mesh.name = `panel-${panel.index}-labels`;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = 1;

  let labels: PanelLabel[] = [];
  let shown = false;
  let fade = 0;
  let heights: Float32Array = new Float32Array(count * 2);

  /** Writes one quad: its corners in the sheet's frame and its place on the canvas. */
  const quad = (index: number, rect: LabelRect, px: number, py: number, pw: number, ph: number): void => {
    const xs = [rect.x0, rect.x1, rect.x0, rect.x1];
    const zs = [rect.z0, rect.z0, rect.z1, rect.z1];
    const us = [px, px + pw, px, px + pw].map((u) => u / canvas.width);
    const vs = [py, py, py + ph, py + ph].map((v) => 1 - v / canvas.height);
    for (let corner = 0; corner < 4; corner += 1) {
      const k = index * 4 + corner;
      positions.setXYZ(k, (xs[corner] as number) - PANEL.width / 2, heights[index] ?? 0, zs[corner] as number);
      uvs.setXY(k, us[corner] as number, vs[corner] as number);
    }
  };

  const paint = (ink: number): void => {
    labels = planLabels(panel, measure);
    if (ctx) {
      // A panel beyond the last passed checkpoint prints its labels lighter, but never below half.
      const alpha = 0.9 * Math.min(1, Math.max(0.5, ink));
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      labels.forEach((label, index) => {
        const y = rowOf(index);
        // The title on its strip of paper, so the contours do not cross it.
        const stripWidth = (label.strip.x1 - label.strip.x0) * res;
        ctx.fillStyle = withAlpha(THEME.paperHi, 0.78 * alpha);
        ctx.fillRect(gap, y, stripWidth, stripPx.height);
        ctx.fillStyle = withAlpha(THEME.ink, alpha);
        ctx.font = font;
        drawText(ctx, label.text, gap + LABEL.pad * res, y + LABEL.ascent * res, { lang: options.lang });
        // The mark: a ring on paper, dashed for an optional step, with a dot for a step on the route.
        const cx = gap * 2 + stripPx.width + dotPx / 2;
        const cy = y + dotPx / 2;
        const r = LABEL.mark * res;
        ctx.fillStyle = THEME.paperHi;
        ctx.strokeStyle = withAlpha(THEME.ink, alpha);
        ctx.lineWidth = LABEL.ring * res;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        if (label.mark.waypoint.optional) ctx.setLineDash([0.02 * res, 0.016 * res]);
        ctx.stroke();
        ctx.setLineDash([]);
        if (!label.mark.waypoint.optional) {
          ctx.fillStyle = withAlpha(THEME.ink, alpha);
          ctx.beginPath();
          ctx.arc(cx, cy, r * 0.42, 0, Math.PI * 2);
          ctx.fill();
        }
      });
      map.needsUpdate = true;
    }
    labels.forEach((label, index) => {
      const y = rowOf(index);
      quad(index * 2, label.strip, gap, y, (label.strip.x1 - label.strip.x0) * res, stripPx.height);
      quad(index * 2 + 1, label.dot, gap * 2 + stripPx.width, y, dotPx, dotPx);
    });
    positions.needsUpdate = true;
    uvs.needsUpdate = true;
    geometry.computeBoundingSphere();
  };
  paint(options.ink);

  const show = (): void => {
    material.opacity = fade;
    mesh.visible = fade > 0.001 && count > 0;
  };

  return {
    mesh,
    get labels() {
      return labels;
    },
    setHeights(top) {
      if (heights.length !== count * 2) heights = new Float32Array(count * 2);
      labels.forEach((label, index) => {
        heights[index * 2] = top(label.card) + LABEL.lift;
        heights[index * 2 + 1] = top(label.dotCard) + LABEL.lift;
      });
      for (let q = 0; q < count * 2; q += 1) for (let corner = 0; corner < 4; corner += 1) positions.setY(q * 4 + corner, heights[q] ?? 0);
      positions.needsUpdate = true;
    },
    setShown(next) {
      shown = next;
      if (!next && fade <= 0) show();
    },
    update(dt, reduced) {
      const target = shown ? 1 : 0;
      if (fade === target) return;
      fade = reduced ? target : target > fade ? Math.min(target, fade + dt * LABEL.fade) : Math.max(target, fade - dt * LABEL.fade);
      show();
    },
    settle() {
      fade = shown ? 1 : 0;
      show();
    },
    repaint(ink) {
      paint(ink);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      map.dispose();
    },
  };
}
