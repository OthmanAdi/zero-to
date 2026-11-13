/**
 * The profile of the route as an inline SVG: minutes run left to right, altitude (the tier bands) bottom to top.
 * It carries the camps, every step as a dot (an optional one at the far point of a dotted side trail), the
 * walked part as a solid line and the you-are-here pin, the plan's position for today, due reviews and the
 * class flag.
 *
 * The drawing is decoration for the eye: the figure caption next to it says the same in words, and the SVG is
 * hidden from screen readers.
 */
import { uiLang, type UiLang } from '../i18n';
import { THEME } from '../look/theme';
import type { Trek } from '../roadmap/derive';
import { TIER_NAMES } from '../scene/palette';
import { say as learnSay } from '../learn/strings';
import { svgEl, toHtml, type ONode } from './tree';
import { say } from './strings';

export interface ProfileMarks {
  /** 0 to 1 along the route: the walked part ends here and the pin stands here. Null or absent: no pin. */
  readonly here?: number | null;
  /** 0 to 1: where the plan puts a learner today. */
  readonly pace?: number | null;
  /** 0 to 1: where the class is today. */
  readonly classAt?: number | null;
  /** Waypoint ids that are done. */
  readonly done?: readonly string[];
  /** Waypoint ids whose review is due. */
  readonly due?: readonly string[];
  /** Stage ids whose signpost is passed: their camp flies its flag. */
  readonly passed?: readonly string[];
}

export interface ProfileOptions {
  readonly ui?: UiLang;
  /** Height of the drawing in viewBox units; the width is always 1000. Default 240. */
  readonly height?: number;
}

export const PROFILE_WIDTH = 1000;
/** The tier names stand in a gutter on the left, clear of the route and the pin. */
const LEFT = 92;
const RIGHT = 986;
const TOP = 40;

/**
 * A side trail: the dotted spur an optional step stands on, drawn the way the strip of the 3D view draws it. It
 * leaves the route at most `half` before the step and rejoins it at most `half` after it. Each side takes no
 * more than `gapShare` of the gap to the mark beside it (a step, a camp or an end of the route), so a spur next
 * to a camp rejoins short of the tent. It stands `rise` off the route at the step, or `steep` times its width
 * when it is narrow, never less than half of `rise`. It keeps `room` from the edge of the drawing and turns
 * downward where there is none above. A step with less than `least` on either side stays on the route. Units
 * are those of the viewBox.
 */
export const PROFILE_SPUR = { half: 14, gapShare: 0.3, rise: 22, steep: 0.9, room: 8, least: 3 } as const;

interface Point {
  readonly x: number;
  readonly y: number;
}

/** The side trail of an optional step: a dotted arc that leaves the route and rejoins it. */
export interface ProfileSpur {
  readonly id: string;
  /** Where it leaves and where it rejoins the route, as shares of the route. */
  readonly from: number;
  readonly to: number;
  /** True when it stands above the route. */
  readonly up: boolean;
  /** The step's place on the route. */
  readonly on: Point;
  /** The far point of the spur, where the step's dot is drawn. */
  readonly at: Point;
  /** The arc as an SVG path. */
  readonly d: string;
}

const r1 = (n: number): number => Math.round(n * 10) / 10;
const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** The drawing's geometry: x for a share of the route, y for an altitude, the line of the ground and the spurs. */
export function profileGeometry(trek: Trek, height = 240) {
  const bottom = height - 30;
  const x = (along: number): number => LEFT + (RIGHT - LEFT) * clamp01(along);
  const y = (altitude: number): number => bottom - (bottom - TOP) * clamp01(altitude);
  const total = trek.totalMinutes;
  const share = (minute: number): number => (total === 0 ? 0 : minute / total);
  const line: Point[] = [];
  const push = (p: Point): void => {
    const last = line[line.length - 1];
    if (!last || Math.abs(last.x - p.x) > 0.01 || Math.abs(last.y - p.y) > 0.01) line.push(p);
  };
  for (const stage of trek.stages) {
    push({ x: x(share(stage.startMinute)), y: y(stage.startAltitude) });
    for (const w of trek.waypoints) if (w.stageId === stage.id) push({ x: x(w.along), y: y(w.altitude) });
    push({ x: x(share(stage.endMinute)), y: y(stage.campAltitude) });
  }
  if (line.length === 0) push({ x: x(0), y: y(0) });
  if (line.length === 1) push({ x: x(1), y: (line[0] as Point).y });
  const yAt = (px: number): number => {
    const first = line[0] as Point;
    if (px <= first.x) return first.y;
    for (let i = 1; i < line.length; i += 1) {
      const a = line[i - 1] as Point;
      const b = line[i] as Point;
      if (px <= b.x) return b.x === a.x ? b.y : a.y + ((b.y - a.y) * (px - a.x)) / (b.x - a.x);
    }
    return (line[line.length - 1] as Point).y;
  };

  // The marks on the route a spur keeps clear of: both ends, every camp and every step.
  const stops = [0, 1, ...trek.stages.map((stage) => share(stage.endMinute)), ...trek.waypoints.map((w) => w.along)];
  const spurs: ProfileSpur[] = [];
  const { half, gapShare, rise, steep, room, least } = PROFILE_SPUR;
  const width = RIGHT - LEFT;
  for (const w of trek.waypoints) {
    if (!w.optional) continue;
    let before = 0;
    let after = 1;
    for (const stop of stops) {
      if (stop < w.along - 1e-9 && stop > before) before = stop;
      if (stop > w.along + 1e-9 && stop < after) after = stop;
    }
    const lead = Math.min(half / width, gapShare * (w.along - before));
    const trail = Math.min(half / width, gapShare * (after - w.along));
    if (!(Math.min(lead, trail) * width >= least)) continue;
    const lift = Math.min(rise, Math.max(rise / 2, steep * (lead + trail) * width));
    const on = { x: x(w.along), y: y(w.altitude) };
    const up = on.y - lift >= room;
    const apex = up ? on.y - lift : Math.min(height - room, on.y + lift);
    if (Math.abs(apex - on.y) < lift / 3) continue;
    const fromX = x(w.along - lead);
    const toX = x(w.along + trail);
    const from = { x: fromX, y: yAt(fromX) };
    const to = { x: toX, y: yAt(toX) };
    // Two quarter arcs: straight off the route, level at the step, and back.
    spurs.push({
      id: w.id,
      from: w.along - lead,
      to: w.along + trail,
      up,
      on,
      at: { x: on.x, y: apex },
      d: `M${r1(from.x)} ${r1(from.y)}Q${r1(from.x)} ${r1(apex)} ${r1(on.x)} ${r1(apex)}Q${r1(to.x)} ${r1(apex)} ${r1(to.x)} ${r1(to.y)}`,
    });
  }
  return { x, y, bottom, line, yAt, share, spurs };
}

const path = (points: readonly Point[]): string => points.map((p, i) => `${i === 0 ? 'M' : 'L'}${r1(p.x)} ${r1(p.y)}`).join(' ');

/** The profile as a tree, for the outline and the handouts. */
export function profileTree(trek: Trek, marks: ProfileMarks = {}, options: ProfileOptions = {}): ONode {
  const ui = options.ui ?? uiLang();
  const height = options.height ?? 240;
  const g = profileGeometry(trek, height);
  const kids: ONode[] = [];

  // Tier bands, bronze at the bottom. Faint washes in the tier colours, a label at the left of each.
  TIER_NAMES.forEach((tier, i) => {
    const top = g.y((i + 1) / TIER_NAMES.length);
    const low = g.y(i / TIER_NAMES.length);
    kids.push(
      svgEl('rect', {
        class: `zo-p-band zo-p-band-${tier}`,
        x: LEFT,
        y: r1(top),
        width: RIGHT - LEFT,
        height: r1(low - top),
        fill: THEME.tier[tier],
        'fill-opacity': 0.13,
      }),
      svgEl('text', { class: 'zo-p-tier', x: LEFT - 10, y: r1((top + low) / 2 + 5), 'text-anchor': 'end', fill: THEME.inkSoft }, learnSay(`tier.${tier}`, undefined, ui)),
    );
  });

  // Stage edges.
  for (const stage of trek.stages.slice(0, -1)) {
    const x = r1(g.x(g.share(stage.endMinute)));
    kids.push(svgEl('line', { class: 'zo-p-edge', x1: x, x2: x, y1: TOP - 14, y2: g.bottom, stroke: THEME.ink, 'stroke-opacity': 0.12 }));
  }

  // The ground and the route.
  const ground = `${path(g.line)} L${r1((g.line[g.line.length - 1] as Point).x)} ${g.bottom} L${r1((g.line[0] as Point).x)} ${g.bottom} Z`;
  kids.push(svgEl('path', { class: 'zo-p-ground', d: ground, fill: THEME.paperShade, 'fill-opacity': 0.55 }));
  // Side trails: dots where the route has dashes, so the two are told apart without colour. Under the route,
  // so the route closes each of them.
  for (const spur of g.spurs) {
    kids.push(
      svgEl('path', {
        class: 'zo-p-spur',
        'data-waypoint': spur.id,
        d: spur.d,
        fill: 'none',
        stroke: THEME.ink,
        'stroke-opacity': 0.62,
        'stroke-width': 2.2,
        'stroke-linecap': 'round',
        'stroke-dasharray': '0.01 5',
      }),
    );
  }
  kids.push(
    svgEl('path', {
      class: 'zo-p-route',
      d: path(g.line),
      fill: 'none',
      stroke: THEME.ink,
      'stroke-opacity': 0.62,
      'stroke-width': 2,
      'stroke-dasharray': '9 7',
      'stroke-linejoin': 'round',
    }),
  );

  const here = marks.here === null || marks.here === undefined ? null : clamp01(marks.here);
  if (here !== null && here > 0) {
    const hx = g.x(here);
    const walked = g.line.filter((p) => p.x < hx);
    walked.push({ x: hx, y: g.yAt(hx) });
    kids.push(
      svgEl('path', {
        class: 'zo-p-walked',
        d: path(walked),
        fill: 'none',
        stroke: THEME.signal,
        'stroke-width': 3.5,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      }),
    );
  }

  // The plan's position today: a pale line, never a warning.
  if (marks.pace !== null && marks.pace !== undefined) {
    const px = r1(g.x(marks.pace));
    kids.push(
      svgEl(
        'g',
        { class: 'zo-p-pace', 'data-zo-mark': 'pace', transform: `translate(${px} 0)` },
        svgEl('line', { x1: 0, x2: 0, y1: TOP - 6, y2: g.bottom, stroke: THEME.inkSoft, 'stroke-opacity': 0.55, 'stroke-dasharray': '2 5' }),
        svgEl('text', { class: 'zo-p-small', x: 0, y: g.bottom + 22, 'text-anchor': 'middle', fill: THEME.inkSoft }, say('planToday', undefined, ui)),
      ),
    );
  }

  // Steps. An optional step with a spur stands at its far point.
  const done = new Set(marks.done ?? []);
  const due = new Set(marks.due ?? []);
  const spurOf = new Map(g.spurs.map((spur) => [spur.id, spur]));
  for (const w of trek.waypoints) {
    const at = spurOf.get(w.id)?.at;
    const cx = r1(at ? at.x : g.x(w.along));
    const cy = r1(at ? at.y : g.y(w.altitude));
    const isDone = done.has(w.id);
    if (due.has(w.id)) {
      kids.push(svgEl('circle', { class: 'zo-p-due', cx, cy, r: 9, fill: 'none', stroke: THEME.signal, 'stroke-width': 2 }));
    }
    kids.push(
      svgEl('circle', {
        class: `zo-p-step${isDone ? ' is-done' : ''}${w.optional ? ' is-optional' : ''}`,
        cx,
        cy,
        r: w.optional ? 3 : 4.5,
        fill: isDone ? THEME.ink : THEME.paperHi,
        stroke: THEME.ink,
        'stroke-width': 1.5,
      }),
    );
  }

  // Camps: a tent at the end of every stage, a flag on the summit and on every passed signpost.
  const passed = new Set(marks.passed ?? []);
  trek.stages.forEach((stage, i) => {
    const cx = r1(g.x(g.share(stage.endMinute)));
    const cy = r1(g.y(stage.campAltitude));
    const last = i === trek.stages.length - 1;
    const flag = last || passed.has(stage.id);
    kids.push(
      svgEl(
        'g',
        { class: `zo-p-camp${passed.has(stage.id) ? ' is-passed' : ''}`, transform: `translate(${cx} ${cy})` },
        svgEl('path', { d: 'M-8 0 L0 -13 L8 0 Z', fill: THEME.paper, stroke: THEME.ink, 'stroke-width': 1.5, 'stroke-linejoin': 'round' }),
        flag
          ? svgEl(
              'g',
              { class: 'zo-p-flag' },
              svgEl('line', { x1: 0, x2: 0, y1: -13, y2: -30, stroke: THEME.ink, 'stroke-width': 1.5 }),
              svgEl('path', { d: 'M0 -30 L12 -26 L0 -22 Z', fill: last ? THEME.signal : THEME.ink }),
            )
          : null,
        svgEl('text', { class: 'zo-p-num', x: 0, y: flag ? -36 : -19, 'text-anchor': 'middle', fill: THEME.ink }, String(i + 1)),
      ),
    );
  });

  // The class flag.
  if (marks.classAt !== null && marks.classAt !== undefined) {
    const cx = r1(g.x(marks.classAt));
    kids.push(
      svgEl(
        'g',
        { class: 'zo-p-class', 'data-zo-mark': 'class', transform: `translate(${cx} ${r1(g.yAt(g.x(marks.classAt)))})` },
        svgEl('line', { x1: 0, x2: 0, y1: 0, y2: -24, stroke: THEME.inkSoft, 'stroke-width': 1.5 }),
        svgEl('path', { d: 'M0 -24 L-11 -20 L0 -16 Z', fill: THEME.inkSoft }),
        svgEl('text', { class: 'zo-p-small', x: -4, y: -30, 'text-anchor': 'end', fill: THEME.inkSoft }, say('classToday', undefined, ui)),
      ),
    );
  }

  // You are here: the red pin on the route.
  if (here !== null) {
    const hx = g.x(here);
    const hy = g.yAt(hx);
    const anchor = here > 0.85 ? 'end' : here < 0.15 ? 'start' : 'middle';
    kids.push(
      svgEl(
        'g',
        { class: 'zo-p-here', 'data-zo-mark': 'here', 'data-along': r1(here * 1000) / 1000, transform: `translate(${r1(hx)} ${r1(hy)})` },
        svgEl('line', { x1: 0, x2: 0, y1: 0, y2: -18, stroke: THEME.ink, 'stroke-width': 1.5 }),
        svgEl('circle', { cx: 0, cy: -22, r: 7, fill: THEME.signal, stroke: THEME.paperHi, 'stroke-width': 2 }),
        svgEl(
          'text',
          { class: 'zo-p-label', x: anchor === 'start' ? -6 : anchor === 'end' ? 6 : 0, y: -44, 'text-anchor': anchor, fill: THEME.signalDeep },
          say('youAreHere', undefined, ui),
        ),
      ),
    );
  }

  return svgEl(
    'svg',
    {
      class: 'zo-profile-svg',
      viewBox: `0 0 ${PROFILE_WIDTH} ${height}`,
      width: PROFILE_WIDTH,
      height,
      'aria-hidden': 'true',
      focusable: 'false',
      xmlns: 'http://www.w3.org/2000/svg',
    },
    kids,
  );
}

/** The profile as SVG text: `marks` places the pin, the walked line, the plan, due reviews and the class flag. */
export function profileSvg(trek: Trek, marks: ProfileMarks = {}, options: ProfileOptions = {}): string {
  return toHtml(profileTree(trek, marks, options));
}
