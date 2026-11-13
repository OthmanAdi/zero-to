/**
 * The profile strip: the whole route as one line of height over time, on a strip of paper along the bottom edge.
 *
 * It answers three questions without a word of scolding: where am I, where does the plan put me today, and when
 * do I arrive. Distance is time (one hour of learning is one trail kilometre, printed as hours) and height is the
 * tier, so the four bands of the strip are Bronze, Silver, Gold and Diamond.
 *
 * Every mark is a real button laid over the drawing, and a hidden slider gives the same seek to the keyboard.
 */
import { uiLang } from '../i18n';
import { formatDay, formatNumber, roundHours } from '../look/format';
import { TIER_BAND, type Trek, type TrekStage } from '../roadmap/derive';
import { TIER_NAMES, type TierName } from '../scene/palette';
import { el, setText, svg, uid } from './dom';
import { say, tierKey } from './strings';

/** The drawing's own coordinates: 1000 wide, as tall as the plot. `x` is the share of the route times `width`. */
export const PROFILE = {
  width: 1000,
  height: 100,
  /** The line never touches the top or bottom edge of the plot. */
  top: 12,
  bottom: 90,
  /** Samples per stage. The line bends a little inside a stage; its ends are exact. */
  samples: 10,
  /** How much of a smooth step is mixed into the straight climb of a stage. */
  bend: 0.55,
  /** The readout is written again when the walker has moved by more than this share of an hour. */
  readoutStep: 0.02,
  /**
   * A side trail: the dotted spur of an optional step. It leaves the line `half` before the step (never more
   * than `gapShare` of the gap to the step beside it), stands `rise` off the line at the step and comes back.
   * It keeps `room` from the edge of the plot, and turns downward where there is no room above.
   */
  spur: { half: 12, gapShare: 0.3, rise: 18, room: 3 },
  /**
   * Marks that stay buttons are at least this far apart, centre to centre, in pixels: 24 for a mouse (WCAG
   * 2.5.8), 44 for a finger (section 7.4). A mark closer than that to one that stays is drawn but not pressed;
   * the slider and a drag along the strip reach its place.
   */
  pitch: { fine: 24, coarse: 44 },
} as const;

/** A mark as `spacedMarks` weighs it: its id and its place along the route, 0 to 1. */
export interface SpacedMark {
  readonly id: string;
  readonly along: number;
}

/**
 * The marks that stay buttons on a plot `width` pixels wide: taken in the order given, which is their priority,
 * each one kept when it is at least `pitch` pixels from every mark kept before it. All are kept while the width
 * is unknown.
 */
export function spacedMarks(marks: readonly SpacedMark[], width: number, pitch: number): Set<string> {
  const out = new Set<string>();
  const kept: number[] = [];
  for (const mark of marks) {
    const x = clamp01(mark.along) * width;
    if (width > 0 && kept.some((at) => Math.abs(at - x) < pitch - 1e-6)) continue;
    kept.push(x);
    out.add(mark.id);
  }
  return out;
}

export interface ProfilePoint {
  readonly along: number;
  readonly altitude: number;
  readonly x: number;
  readonly y: number;
}

export interface ProfileCamp extends ProfilePoint {
  readonly stageId: string;
  readonly stage: number;
  readonly tier: TierName;
}

/** A step. An optional one is drawn at the far point of its spur (x, y); `on` is its place on the line. */
export interface ProfileMark extends ProfilePoint {
  readonly id: string;
  readonly stageId: string;
  readonly optional: boolean;
  readonly on: { readonly x: number; readonly y: number };
}

/** The side trail of an optional step: a dotted arc that leaves the line and comes back to it. */
export interface ProfileSpur {
  readonly id: string;
  /** Where it leaves and where it rejoins, as shares of the route. */
  readonly from: number;
  readonly to: number;
  /** True when it stands above the line. */
  readonly up: boolean;
  /** The arc as an SVG path. */
  readonly d: string;
}

export interface ProfileBand {
  readonly tier: TierName;
  /** Top and bottom of the band in drawing coordinates (y grows downwards). */
  readonly y0: number;
  readonly y1: number;
  /** False for a band above the summit of this roadmap. */
  readonly reached: boolean;
}

export interface ProfileGeometry {
  readonly totalMinutes: number;
  readonly summitAltitude: number;
  readonly bands: readonly ProfileBand[];
  /** The line from the gate to the summit. */
  readonly line: readonly ProfilePoint[];
  /** One closed outline per stage, for the tier wash under the line. */
  readonly stageAreas: readonly { readonly tier: TierName; readonly from: number; readonly to: number; readonly d: string }[];
  readonly camps: readonly ProfileCamp[];
  readonly waypoints: readonly ProfileMark[];
  /** One per optional step that has room for it. */
  readonly spurs: readonly ProfileSpur[];
  /** `x` of a share of the route. Linear: the strip never bends time. */
  x(along: number): number;
  /** `y` of an altitude, 0 at the foot and 1 at the top of Diamond. */
  y(altitude: number): number;
  /** The height of the line at a share of the route. */
  altitudeAt(along: number): number;
  /** The share of the route at a minute. */
  alongOfMinute(minute: number): number;
  /** The index of the stage a share of the route lies in. */
  stageAt(along: number): number;
  /** The line as an SVG path. */
  readonly path: string;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const smooth = (t: number): number => t * t * (3 - 2 * t);
const round2 = (value: number): number => Math.round(value * 100) / 100;

function climb(stage: TrekStage, f: number): number {
  const eased = f + (smooth(f) - f) * PROFILE.bend;
  return stage.startAltitude + (stage.campAltitude - stage.startAltitude) * eased;
}

/** Everything the strip draws, worked out once per roadmap. Pure. */
export function profileGeometry(trek: Trek): ProfileGeometry {
  const total = trek.totalMinutes;
  const alongOfMinute = (minute: number): number => (total > 0 ? clamp01(minute / total) : 0);
  const x = (along: number): number => clamp01(along) * PROFILE.width;
  const y = (altitude: number): number => PROFILE.bottom - clamp01(altitude) * (PROFILE.bottom - PROFILE.top);

  const stageAt = (along: number): number => {
    const minute = clamp01(along) * total;
    for (let i = 0; i < trek.stages.length; i++) {
      if (minute < (trek.stages[i] as TrekStage).endMinute) return i;
    }
    return Math.max(0, trek.stages.length - 1);
  };

  const altitudeAt = (along: number): number => {
    if (trek.stages.length === 0 || total <= 0) return 0;
    const index = stageAt(along);
    const stage = trek.stages[index] as TrekStage;
    const f = stage.minutes > 0 ? clamp01((clamp01(along) * total - stage.startMinute) / stage.minutes) : 1;
    return climb(stage, f);
  };

  const point = (along: number, altitude: number): ProfilePoint => ({ along, altitude, x: round2(x(along)), y: round2(y(altitude)) });

  const line: ProfilePoint[] = [];
  const stageAreas: { tier: TierName; from: number; to: number; d: string }[] = [];
  const camps: ProfileCamp[] = [];
  trek.stages.forEach((stage, index) => {
    const own: ProfilePoint[] = [];
    for (let s = 0; s <= PROFILE.samples; s++) {
      const f = s / PROFILE.samples;
      own.push(point(alongOfMinute(stage.startMinute + stage.minutes * f), climb(stage, f)));
    }
    const first = own[0] as ProfilePoint;
    const last = own[own.length - 1] as ProfilePoint;
    // Stages share their end points, so the whole line has each of them once.
    line.push(...(index === 0 ? own : own.slice(1)));
    stageAreas.push({
      tier: stage.tier,
      from: first.along,
      to: last.along,
      d: `M${first.x} ${PROFILE.height}L${own.map((p) => `${p.x} ${p.y}`).join('L')}L${last.x} ${PROFILE.height}Z`,
    });
    camps.push({ ...last, stageId: stage.id, stage: index, tier: stage.tier });
  });

  const spurs: ProfileSpur[] = [];
  const waypoints: ProfileMark[] = trek.waypoints.map((wp, index) => {
    const on = point(wp.along, altitudeAt(wp.along));
    const mark = { ...on, id: wp.id, stageId: wp.stageId, optional: wp.optional, on: { x: on.x, y: on.y } };
    if (!wp.optional) return mark;
    const before = trek.waypoints[index - 1]?.along ?? 0;
    const after = trek.waypoints[index + 1]?.along ?? 1;
    const { half, gapShare, rise, room } = PROFILE.spur;
    const reach = Math.min(half / PROFILE.width, gapShare * (wp.along - before), gapShare * (after - wp.along));
    if (!(reach > 1e-4)) return mark;
    const up = on.y - rise >= room;
    const top = up ? on.y - rise : Math.min(PROFILE.height - room, on.y + rise);
    if (Math.abs(top - on.y) < rise / 3) return mark;
    const from = point(wp.along - reach, altitudeAt(wp.along - reach));
    const to = point(wp.along + reach, altitudeAt(wp.along + reach));
    const apex = round2(top);
    // Two quarter arcs: straight off the line, level at the step, and back.
    spurs.push({
      id: wp.id,
      from: from.along,
      to: to.along,
      up,
      d: `M${from.x} ${from.y}Q${from.x} ${apex} ${on.x} ${apex}Q${to.x} ${apex} ${to.x} ${to.y}`,
    });
    return { ...mark, y: apex };
  });

  const bands: ProfileBand[] = TIER_NAMES.map((tier, i) => ({
    tier,
    y0: round2(y((i + 1) * TIER_BAND)),
    y1: round2(y(i * TIER_BAND)),
    reached: trek.summitAltitude > i * TIER_BAND + 1e-9,
  }));

  return {
    totalMinutes: total,
    summitAltitude: trek.summitAltitude,
    bands,
    line,
    stageAreas,
    camps,
    waypoints,
    spurs,
    x,
    y,
    altitudeAt,
    alongOfMinute,
    stageAt,
    path: line.length > 0 ? `M${line.map((p) => `${p.x} ${p.y}`).join('L')}` : '',
  };
}

/**
 * The share of the route under a pointer: `clientX` against the plot's box. The plot has no inner margin, so the
 * left edge is the gate and the right edge the summit.
 */
export function alongAt(clientX: number, box: { readonly left: number; readonly width: number }): number {
  if (!(box.width > 0)) return 0;
  return clamp01((clientX - box.left) / box.width);
}

export interface ProfileDue {
  readonly waypointId: string;
  readonly title: string;
}

export interface ProfileOptions {
  /** Titles for the names of the buttons: waypoint and stage titles by id. They are roadmap text. */
  readonly titles?: Readonly<Record<string, string>>;
  /** Language of the titles. */
  readonly lang?: string;
  /** Called when a waypoint dot or a camp is pressed. Seek listeners hear its place as well. */
  readonly onGo?: (target: { readonly waypointId?: string; readonly stageId?: string }) => void;
  /** Called when the pace chip is pressed. */
  readonly onPaceOffer?: (anchor: HTMLElement) => void;
}

export interface Profile {
  readonly element: HTMLElement;
  readonly geometry: ProfileGeometry;
  /** Where the walker (the reading cursor) is, 0 to 1. The walked part of the line turns solid. */
  setWalker(along: number): void;
  /**
   * The stage the note says the walker is in, or null. At a signpost and a camp he stands on the line between
   * two stages, and the readout then names this one. It is ignored when he is not in or at the edge of it.
   */
  setStage(index: number | null): void;
  /** You are here, 0 to 1, or null when the route is finished. */
  setHere(along: number | null): void;
  /** Where the plan puts the learner today, and the day of arrival. Null hides either. */
  setPace(along: number | null, arrival: string | null): void;
  /** The steps whose review is due. Each gets a ringed cairn. */
  setDue(list: readonly ProfileDue[]): void;
  /** Where the class is today, or null. `note` names the session for the flag's label: it is roadmap text. */
  setClass(along: number | null, note?: string): void;
  /** Minutes finished per waypoint as a rating 1 to 4, or 0 for done without a rating: tints the stage's wash. */
  setRatings(ratings: Readonly<Record<string, number>>): void;
  /** Shows or hides the chip that offers the four choices. */
  setOffer(on: boolean): void;
  /** Hears the share of the route the visitor asked for: a click, a drag, a mark or the slider. */
  onSeek(listener: (along: number) => void): () => void;
  /** The text of the readout as it stands. */
  readonly readout: string;
  /** How often the readout was written. For tests of "only on change". */
  readonly writes: number;
  /** Builds the words again after the interface language changed. */
  relabel(): void;
  destroy(): void;
}

const pct = (value: number, of: number): string => `${Math.round((value / of) * 10000) / 100}%`;

export function createProfile(host: HTMLElement, trek: Trek, options: ProfileOptions = {}): Profile {
  const geometry = profileGeometry(trek);
  const titles = options.titles ?? {};
  const roadLang = options.lang ?? 'en';
  const seekers = new Set<(along: number) => void>();
  const clipId = uid('zh-clip');

  let walker = 0;
  let stageHint: number | null = null;
  let here: number | null = null;
  let paceAlong: number | null = null;
  let arrival: string | null = null;
  let classAlong: number | null = null;
  let classNote = '';
  let due: readonly ProfileDue[] = [];
  let ratings: Readonly<Record<string, number>> = {};
  let readoutAt = Number.NaN;
  let printedAt = Number.NaN;
  let stageWritten = -1;
  let writes = 0;

  // ---- The drawing
  const drawing = svg('svg', {
    class: 'zh-profile-svg',
    viewBox: `0 0 ${PROFILE.width} ${PROFILE.height}`,
    preserveAspectRatio: 'none',
    'aria-hidden': 'true',
    focusable: 'false',
  });
  const bandLayer = svg('g', { class: 'zh-profile-bands' });
  for (const band of geometry.bands) {
    bandLayer.append(
      svg('rect', {
        x: 0,
        y: band.y0,
        width: PROFILE.width,
        height: round2(band.y1 - band.y0),
        class: `zh-profile-band${band.reached ? '' : ' is-above'}`,
        'data-tier': band.tier,
      }),
    );
    bandLayer.append(svg('line', { x1: 0, x2: PROFILE.width, y1: band.y0, y2: band.y0, class: 'zh-profile-rule' }));
  }
  const washLayer = svg('g', { class: 'zh-profile-wash' });
  geometry.stageAreas.forEach((area) => washLayer.append(svg('path', { d: area.d, 'data-tier': area.tier })));
  const doneLayer = svg('g', { class: 'zh-profile-done' });
  const clip = svg('clipPath', { id: clipId });
  const clipRect = svg('rect', { x: 0, y: 0, width: 0, height: PROFILE.height });
  clip.append(clipRect);
  const ahead = svg('path', { d: geometry.path, class: 'zh-profile-line is-ahead' });
  const walked = svg('path', { d: geometry.path, class: 'zh-profile-line is-walked', 'clip-path': `url(#${clipId})` });
  // Side trails: dotted, under the line, so the line closes each of them.
  const spurLayer = svg('g', { class: 'zh-profile-spurs' });
  for (const spur of geometry.spurs) spurLayer.append(svg('path', { d: spur.d, class: `zh-profile-spur${spur.up ? '' : ' is-down'}`, 'data-waypoint': spur.id }));
  drawing.append(svg('defs', {}, clip), bandLayer, washLayer, doneLayer, spurLayer, ahead, walked);

  // ---- Marks: real buttons over the drawing
  const marks = el('div', { class: 'zh-profile-marks' });
  const place = (node: HTMLElement, point: { readonly x: number; readonly y: number }): void => {
    node.style.left = pct(point.x, PROFILE.width);
    node.style.top = pct(point.y, PROFILE.height);
  };
  const pointAt = (along: number): ProfilePoint => ({
    along,
    altitude: geometry.altitudeAt(along),
    x: geometry.x(along),
    y: geometry.y(geometry.altitudeAt(along)),
  });

  const stepButtons = new Map<string, HTMLButtonElement>();
  const campButtons: HTMLButtonElement[] = [];
  const emitSeek = (along: number): void => {
    for (const listener of [...seekers]) listener(clamp01(along));
  };

  const buildMarks = (): void => {
    marks.replaceChildren();
    stepButtons.clear();
    campButtons.length = 0;
    for (const wp of geometry.waypoints) {
      const button = el('button', {
        type: 'button',
        class: `zh-mark zh-mark-step${wp.optional ? ' is-side' : ''}`,
        'aria-label': say('waypoint', { title: titles[wp.id] ?? wp.id }),
        'data-waypoint': wp.id,
      });
      button.append(el('span', { class: 'zh-mark-dot', 'aria-hidden': 'true' }));
      button.addEventListener('click', () => {
        options.onGo?.({ waypointId: wp.id, stageId: wp.stageId });
        emitSeek(wp.along);
      });
      place(button, wp);
      stepButtons.set(wp.id, button);
      marks.append(button);
    }
    geometry.camps.forEach((camp, i) => {
      const last = i === geometry.camps.length - 1;
      const button = el('button', {
        type: 'button',
        class: `zh-mark zh-mark-camp${last ? ' is-summit' : ''}`,
        'aria-label': say('camp', { i: i + 1, title: titles[camp.stageId] ?? camp.stageId }),
        'data-stage': camp.stageId,
        'data-tier': camp.tier,
      });
      button.append(el('span', { class: 'zh-mark-tent', 'aria-hidden': 'true' }));
      button.addEventListener('click', () => {
        options.onGo?.({ stageId: camp.stageId });
        emitSeek(camp.along);
      });
      place(button, camp);
      campButtons.push(button);
      marks.append(button);
    });
    marks.append(cursor, paceMark, classMark, hereMark, walkerMark);
    syncDue();
    // New buttons: they are spaced from scratch.
    spacedKey = '';
    spaceMarks();
  };

  /**
   * Keeps the buttons apart. The step you are at comes first, then the summit and the other camps, then the due
   * reviews, then the other steps in route order. A mark that is too close to one of those stays on the drawing
   * but leaves the keyboard's path and lets a press through to the strip, which seeks to its place.
   */
  let plotWidth = 0;
  let spacedKey = '';
  function spaceMarks(): void {
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    const pitch = coarse ? PROFILE.pitch.coarse : PROFILE.pitch.fine;
    const camps = geometry.camps.map((camp) => ({ id: `camp:${camp.stageId}`, along: camp.along }));
    const summit = camps.pop();
    const dueIds = new Set(due.map((item) => item.waypointId));
    const hereId = here === null ? null : (geometry.waypoints.find((wp) => Math.abs(wp.along - (here as number)) < 1e-6)?.id ?? null);
    const steps = geometry.waypoints.map((wp) => ({ id: wp.id, along: wp.along }));
    const order: SpacedMark[] = [
      ...steps.filter((s) => s.id === hereId),
      ...(summit ? [summit] : []),
      ...camps,
      ...steps.filter((s) => s.id !== hereId && dueIds.has(s.id)),
      ...steps.filter((s) => s.id !== hereId && !dueIds.has(s.id)),
    ];
    const key = `${Math.round(plotWidth)}|${pitch}|${hereId ?? ''}|${[...dueIds].join(',')}|${stepButtons.size}`;
    if (key === spacedKey) return;
    spacedKey = key;
    const keep = spacedMarks(order, plotWidth, pitch);
    for (const [id, button] of stepButtons) button.inert = !keep.has(id);
    geometry.camps.forEach((camp, i) => {
      const button = campButtons[i];
      if (button) button.inert = !keep.has(`camp:${camp.stageId}`);
    });
  }

  const measure = (): void => {
    const width = plot.getBoundingClientRect().width;
    if (Math.abs(width - plotWidth) < 0.5) return;
    plotWidth = width;
    spaceMarks();
  };

  const paceMark = el('span', { class: 'zh-mark zh-mark-pace', hidden: true }, el('span', { class: 'zh-mark-pace-tick', 'aria-hidden': 'true' }));
  const classMark = el('span', { class: 'zh-mark zh-mark-class', hidden: true }, el('span', { class: 'zh-mark-flag', 'aria-hidden': 'true' }));
  const hereMark = el('span', { class: 'zh-mark zh-mark-here', hidden: true }, el('span', { class: 'zh-mark-pin', 'aria-hidden': 'true' }));
  const walkerMark = el('span', { class: 'zh-mark zh-mark-walker', 'aria-hidden': 'true' }, el('span', { class: 'zh-mark-walker-dot' }));
  // The reading cursor: a hairline through the whole height of the plot at the walker's place.
  const cursor = el('span', { class: 'zh-profile-cursor', 'aria-hidden': 'true' });

  // ---- The keyboard's way to seek: a slider over the whole route.
  const seek = el('input', {
    type: 'range',
    class: 'zh-profile-seek zh-sr',
    min: 0,
    max: 1000,
    step: 5,
    value: 0,
    'aria-label': say('seek'),
  });
  seek.addEventListener('input', () => emitSeek(Number(seek.value) / 1000));

  // ---- Readout above the strip
  const readoutLine = el('span', { class: 'zh-profile-now' });
  const arrivalLine = el('span', { class: 'zh-profile-arrival' });
  const offer = el('button', { type: 'button', class: 'zh-profile-offer', hidden: true });
  offer.addEventListener('click', () => options.onPaceOffer?.(offer));
  const readout = el('p', { class: 'zh-profile-readout zt-label', 'aria-live': 'off' }, readoutLine, offer, arrivalLine);
  const legend = el('div', { class: 'zh-profile-legend', 'aria-hidden': 'true' });

  const plot = el('div', { class: 'zh-profile-plot' }, drawing, marks);
  const strip = el('div', { class: 'zh-profile-strip zt-paper' }, legend, plot);
  const root = el('section', { class: 'zh-profile', lang: uiLang() }, readout, strip, seek);
  root.setAttribute('aria-label', say('profile'));

  const stageOf = (along: number): number => geometry.stageAt(along);
  /** The walker's stage. Between two stages the note's stage counts, when he is in it or on its edge. */
  const walkerStage = (): number => {
    const index = stageOf(walker);
    const hinted = stageHint === null ? undefined : trek.stages[stageHint];
    if (!hinted || stageHint === index) return index;
    const minute = clamp01(walker) * geometry.totalMinutes;
    return minute >= hinted.startMinute - 1e-6 && minute <= hinted.endMinute + 1e-6 ? (stageHint as number) : index;
  };
  // The minutes are rounded first: a share of the route times its minutes can come out a hair under a quarter
  // of an hour, and the readout would then say half an hour less than the note beside it.
  const printedHours = (along: number): number => roundHours(Math.round(clamp01(along) * geometry.totalMinutes * 1e6) / 1e6);
  const hoursOf = (along: number): string => formatNumber(printedHours(along), { fraction: 1 });
  const totalHours = (): string => formatNumber(roundHours(geometry.totalMinutes), { fraction: 1 });

  const writeReadout = (force = false): void => {
    const hours = (clamp01(walker) * geometry.totalMinutes) / 60;
    const printed = printedHours(walker);
    const index = walkerStage();
    // A small move is not written, unless it is the one that changes the hour or the stage the readout prints:
    // he may come to rest a hundredth of an hour past the place where the last text was written.
    if (!force && Math.abs(hours - readoutAt) <= PROFILE.readoutStep && printed === printedAt && index === stageWritten) return;
    readoutAt = hours;
    printedAt = printed;
    stageWritten = index;
    const stage = trek.stages[index];
    const text = [
      say('readoutHour', { n: hoursOf(walker), total: totalHours() }),
      say('readoutStage', { i: index + 1 }),
      stage ? say(tierKey(stage.tier)) : '',
    ]
      .filter(Boolean)
      .join(' · ');
    if (setText(readoutLine, text)) writes += 1;
    seek.setAttribute('aria-valuetext', say('seekValue', { n: hoursOf(walker), total: totalHours(), i: index + 1 }));
  };

  const syncWalker = (): void => {
    const point = pointAt(walker);
    place(walkerMark, point);
    cursor.style.left = pct(point.x, PROFILE.width);
    clipRect.setAttribute('width', String(round2(point.x)));
    if (document.activeElement !== seek) seek.value = String(Math.round(walker * 1000));
    writeReadout();
  };

  const syncHere = (): void => {
    hereMark.hidden = here === null;
    if (here === null) return;
    place(hereMark, pointAt(here));
    const index = stageOf(here);
    hereMark.setAttribute('title', say('here'));
    hereMark.setAttribute('aria-label', say('hereAt', { title: titles[(trek.stages[index] as TrekStage | undefined)?.id ?? ''] ?? say('readoutStage', { i: index + 1 }) }));
    hereMark.setAttribute('role', 'img');
  };

  const syncPace = (): void => {
    paceMark.hidden = paceAlong === null;
    if (paceAlong !== null) {
      place(paceMark, pointAt(paceAlong));
      paceMark.setAttribute('title', say('pace'));
      paceMark.setAttribute('aria-label', say('paceAt'));
      paceMark.setAttribute('role', 'img');
    }
    setText(arrivalLine, arrival ? say('arrival', { day: formatDay(arrival) }) : '');
    arrivalLine.hidden = !arrival;
  };

  const syncClass = (): void => {
    classMark.hidden = classAlong === null;
    if (classAlong === null) return;
    place(classMark, pointAt(classAlong));
    const name = classNote ? `${say('classFlag')}: ${classNote}` : say('classFlag');
    classMark.setAttribute('title', name);
    classMark.setAttribute('aria-label', name);
    classMark.setAttribute('role', 'img');
    // Near the right edge the cloth flies back over the strip.
    classMark.classList.toggle('is-back', classAlong > 0.97);
  };

  function syncDue(): void {
    const dueIds = new Map(due.map((item) => [item.waypointId, item.title]));
    for (const [id, button] of stepButtons) {
      const title = dueIds.get(id);
      button.classList.toggle('is-due', title !== undefined);
      button.setAttribute('aria-label', title !== undefined ? say('cairn', { title }) : say('waypoint', { title: titles[id] ?? id }));
    }
  }

  const syncRatings = (): void => {
    doneLayer.replaceChildren();
    for (const wp of geometry.waypoints) {
      const rating = ratings[wp.id];
      if (rating === undefined) continue;
      const stage = trek.stages.find((s) => s.id === wp.stageId);
      const mine = trek.waypoints.filter((w) => w.stageId === wp.stageId);
      const index = mine.findIndex((w) => w.id === wp.id);
      if (!stage || index < 0) continue;
      // A step's stretch runs from the middle between it and its neighbours, or from the stage's ends.
      const before = mine[index - 1];
      const after = mine[index + 1];
      const from = before ? (before.along + wp.along) / 2 : geometry.alongOfMinute(stage.startMinute);
      const to = after ? (after.along + wp.along) / 2 : geometry.alongOfMinute(stage.endMinute);
      const points: string[] = [];
      const steps = 6;
      for (let s = 0; s <= steps; s++) {
        const a = from + ((to - from) * s) / steps;
        points.push(`${round2(geometry.x(a))} ${round2(geometry.y(geometry.altitudeAt(a)))}`);
      }
      const tier = TIER_NAMES[Math.max(0, Math.min(TIER_NAMES.length - 1, (rating || 1) - 1))] as TierName;
      doneLayer.append(
        svg('path', {
          d: `M${round2(geometry.x(from))} ${PROFILE.height}L${points.join('L')}L${round2(geometry.x(to))} ${PROFILE.height}Z`,
          'data-tier': tier,
          class: rating > 0 ? 'is-rated' : 'is-done',
        }),
      );
      stepButtons.get(wp.id)?.classList.add('is-done');
    }
    for (const [id, button] of stepButtons) if (ratings[id] === undefined) button.classList.remove('is-done');
  };

  const relabel = (): void => {
    root.lang = uiLang();
    root.setAttribute('aria-label', say('profile'));
    seek.setAttribute('aria-label', say('seek'));
    plot.title = say('profileHint');
    setText(offer, say('paceOffer'));
    offer.setAttribute('aria-label', `${say('paceOffer')}. ${say('paceOfferOpen')}`);
    legend.replaceChildren(
      ...[...geometry.bands].reverse().map((band) => {
        const row = el('span', { class: `zh-profile-tier${band.reached ? '' : ' is-above'}`, 'data-tier': band.tier }, say(tierKey(band.tier)));
        row.style.top = pct((band.y0 + band.y1) / 2, PROFILE.height);
        return row;
      }),
    );
    buildMarks();
    syncHere();
    syncPace();
    syncClass();
    syncRatings();
    writeReadout(true);
  };

  // ---- Pointer seek: press or drag anywhere on the plot.
  let dragging = false;
  const seekFromPointer = (event: PointerEvent): void => {
    emitSeek(alongAt(event.clientX, plot.getBoundingClientRect()));
  };
  const onDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest('button')) return;
    dragging = true;
    plot.setPointerCapture?.(event.pointerId);
    seekFromPointer(event);
  };
  const onMove = (event: PointerEvent): void => {
    if (dragging) seekFromPointer(event);
  };
  const onUp = (event: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    plot.releasePointerCapture?.(event.pointerId);
  };
  plot.addEventListener('pointerdown', onDown);
  plot.addEventListener('pointermove', onMove);
  plot.addEventListener('pointerup', onUp);
  plot.addEventListener('pointercancel', onUp);

  // The spacing of the buttons follows the width of the plot.
  const sizes = typeof ResizeObserver === 'function' ? new ResizeObserver(() => measure()) : null;
  sizes?.observe(plot);
  window.addEventListener('resize', measure);

  relabel();
  syncWalker();
  host.append(root);
  measure();

  return {
    element: root,
    geometry,
    setWalker(along) {
      const next = clamp01(along);
      if (next === walker) return;
      walker = next;
      syncWalker();
    },
    setStage(index) {
      const next = index === null || !Number.isInteger(index) || index < 0 || index >= trek.stages.length ? null : index;
      if (next === stageHint) return;
      stageHint = next;
      writeReadout(true);
    },
    setHere(along) {
      here = along === null ? null : clamp01(along);
      syncHere();
      spaceMarks();
    },
    setPace(along, day) {
      paceAlong = along === null ? null : clamp01(along);
      arrival = day;
      syncPace();
    },
    setDue(list) {
      due = list;
      syncDue();
      spaceMarks();
    },
    setClass(along, note = '') {
      classAlong = along === null ? null : clamp01(along);
      classNote = note;
      syncClass();
    },
    setRatings(next) {
      ratings = next;
      syncRatings();
    },
    setOffer(on) {
      offer.hidden = !on;
    },
    onSeek(listener) {
      seekers.add(listener);
      return () => seekers.delete(listener);
    },
    get readout() {
      return readoutLine.textContent ?? '';
    },
    get writes() {
      return writes;
    },
    relabel,
    destroy() {
      seekers.clear();
      sizes?.disconnect();
      window.removeEventListener('resize', measure);
      root.remove();
    },
  };
}
