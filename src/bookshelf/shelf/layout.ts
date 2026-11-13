import type { Geometry } from './types';

/**
 * Pure row layout. Given a float position it returns where every volume in a
 * range of slots sits and how far it is turned. No DOM, so it is unit-testable.
 *
 * A "slot" is an unwrapped place in the row. With a looping row slot 14 of a
 * 12-item shelf shows item 2; the caller does that mapping.
 */
export interface SlotPose {
  slot: number;
  /** Focus weight: 1 at the centre, 0 most of a step away, smooth in between. */
  weight: number;
  /** Turn toward the viewer in degrees: 0 shows the spine, `focusAngle` shows the cover. */
  angle: number;
  /** Lean in degrees, about the foot corner the volume leans toward. Negative leans left. */
  lean: number;
  /** Centre of the spine at the floor, before the lean, relative to the centre of the row, in px. */
  x: number;
  /**
   * The foot corner the volume leans on, as an offset from `x` along the row once the volume is turned.
   * Drawn as `translate(x + corner) rotateZ(lean) translateX(-corner) rotateY(-angle)`, so that corner
   * stays on the floor and nothing passes through it.
   */
  corner: number;
  /** Upward lift in px. */
  lift: number;
  /** Push toward the viewer in px. */
  z: number;
}

const DEG = Math.PI / 180;

/**
 * A volume finishes its turn this far from its slot, in steps. Turning over the whole step would make the
 * two volumes in transition need far more room half way than at either end, and the rest of the row would
 * swell outward and pull back every time a volume passes the centre.
 */
const TURN_SPAN = 0.78;
/** Neighbours begin to make room a little before the turn starts. */
const GAP_SPAN = 0.9;

function smooth(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** How far a volume is turned toward the viewer: 1 at its slot, 0 from `TURN_SPAN` away. */
export function focusWeight(position: number, slot: number): number {
  return smooth(1 - Math.abs(position - slot) / TURN_SPAN);
}

/** How much extra room the row gives a volume near the centre: 1 at its slot, 0 from `GAP_SPAN` away. */
export function gapWeight(position: number, slot: number): number {
  return smooth(1 - Math.abs(position - slot) / GAP_SPAN);
}

/** The parts of a volume's size that may differ from one volume to the next, in px. */
export type VolumeSize = Pick<Geometry, 'spineWidth' | 'bookHeight' | 'coverWidth'>;
/** Size of the volume in a slot. Left out, every volume has the geometry's size. */
export type SizeOf = (slot: number) => VolumeSize;

/** However slim a volume is, its spine stays wide enough to see and to hit. */
const MIN_SPINE_PX = 30;

/**
 * Size of a volume from how thick (0 to 1) and how tall (0 to 1) it is. Either left out means the look's
 * own size in that direction. A shorter volume has a narrower cover: every cover keeps one aspect.
 */
export function volumeSize(geometry: Geometry, thickness?: number, stature?: number): VolumeSize {
  const clamp = (value: number): number => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  const spineWidth =
    thickness === undefined
      ? geometry.spineWidth
      : Math.max(MIN_SPINE_PX, geometry.spineWidth * (0.62 + 0.6 * clamp(thickness)));
  const tall = stature === undefined ? 1 : 0.9 + 0.1 * clamp(stature);
  return { spineWidth, bookHeight: geometry.bookHeight * tall, coverWidth: geometry.coverWidth * tall };
}

function sized(geometry: Geometry, size: VolumeSize | undefined): Geometry {
  return size ? { ...geometry, ...size } : geometry;
}

/** Distance between two neighbouring resting volumes of the geometry's size. */
export function restPitch(geometry: Geometry): number {
  return geometry.spineWidth + geometry.gap;
}

/** Width a volume takes up on screen when turned by `angle`: spine and cover both foreshortened. */
export function turnedWidth(geometry: Geometry, angle: number, size?: VolumeSize): number {
  const own = sized(geometry, size);
  const radians = angle * DEG;
  return own.spineWidth * Math.abs(Math.cos(radians)) + own.coverWidth * Math.sin(radians);
}

/** Sideways room a leaning volume needs at its head, in px. */
export function leanSpread(geometry: Geometry, weight: number, size?: VolumeSize): number {
  return sized(geometry, size).bookHeight * Math.abs(Math.sin(weight * geometry.focusLean * DEG));
}

/** Room one slot occupies along the row for a given focus weight and, when it differs, gap weight. */
export function slotAdvance(geometry: Geometry, weight: number, gap = weight, size?: VolumeSize): number {
  const angle = weight * geometry.focusAngle;
  return (
    turnedWidth(geometry, angle, size) + leanSpread(geometry, weight, size) + geometry.gap + gap * 2 * geometry.focusGap
  );
}

/**
 * How far the row moves for one unit of position near `position`, in px. With volumes of one size this
 * is the rest pitch. With mixed sizes the strips either side of the two turning volumes move at slightly
 * different speeds, and this is their mean: the mean resting width of those two volumes.
 */
export function pitchAt(position: number, geometry: Geometry, sizeOf?: SizeOf): number {
  const base = Math.floor(position);
  return (slotAdvance(geometry, 0, 0, sizeOf?.(base)) + slotAdvance(geometry, 0, 0, sizeOf?.(base + 1))) / 2;
}

/**
 * Poses for every slot from `from` to `to` inclusive. The volume at `position` sits at x = 0.
 *
 * Between two slots only the two volumes either side of `position` turn. Everything left of them and
 * everything right of them moves as one rigid strip, in step with the position, so the row stays under
 * the hand. The two turning volumes share the room between the strips: their own widths change with the
 * turn, and the gaps around them take up the difference. Those gaps never close, because a turned volume
 * is narrower than the room its slot gives it at rest.
 *
 * A leaning volume pivots on the foot corner it leans toward and gives up its gap on that side, so at
 * full turn its head rests against its neighbour instead of on air.
 */
export function computeRow(
  position: number,
  geometry: Geometry,
  from: number,
  to: number,
  sizeOf?: SizeOf,
): SlotPose[] {
  const base = Math.floor(position);
  const fraction = position - base;
  const side = Math.sign(geometry.focusLean);

  const sizes = new Map<number, VolumeSize>();
  const sizeAt = (slot: number): VolumeSize | undefined => {
    if (!sizeOf) return undefined;
    let size = sizes.get(slot);
    if (!size) {
      size = sizeOf(slot);
      sizes.set(slot, size);
    }
    return size;
  };
  const weightOf = (slot: number): number => focusWeight(position, slot);
  const bodyOf = (slot: number, weight: number): number =>
    turnedWidth(geometry, weight * geometry.focusAngle, sizeAt(slot)) + leanSpread(geometry, weight, sizeAt(slot));
  const roomOf = (gap: number): number => geometry.gap + gap * 2 * geometry.focusGap;
  // What a leaning volume gives up on its lean side: at full weight its own gap and its neighbour's.
  const tuckOf = (weight: number): number => (side === 0 ? 0 : weight * (geometry.gap + geometry.focusGap));
  const presentedOf = (slot: number): number => bodyOf(slot, 1) + roomOf(1) - tuckOf(1);
  const restingOf = (slot: number): number => bodyOf(slot, 0) + roomOf(0);

  // The two layouts this step travels between: `base` presented, then `base + 1` presented.
  const spanStart = presentedOf(base) + restingOf(base + 1);
  const spanEnd = restingOf(base) + presentedOf(base + 1);
  const span = spanStart + (spanEnd - spanStart) * fraction;
  const bodies = bodyOf(base, weightOf(base)) + bodyOf(base + 1, weightOf(base + 1));
  const tucks = tuckOf(weightOf(base)) + tuckOf(weightOf(base + 1));
  const rooms = roomOf(gapWeight(position, base)) + roomOf(gapWeight(position, base + 1));
  const share = rooms > 1e-6 ? Math.max(0, (span - bodies + tucks) / rooms) : 1;

  const roomAt = (slot: number): number => {
    const room = roomOf(gapWeight(position, slot));
    return slot === base || slot === base + 1 ? room * share : room;
  };
  const advanceOf = (slot: number): number => bodyOf(slot, weightOf(slot)) + roomAt(slot) - tuckOf(weightOf(slot));
  /** From the left edge of a slot to the left edge of the volume in it. */
  const insetOf = (room: number, weight: number): number => room / 2 - (side < 0 ? tuckOf(weight) : 0);

  // The presented volume is centred on 0 at both ends of the step; in between the origin moves evenly.
  // Measured from the left edge of slot `base`.
  const baseCentre = insetOf(roomOf(1), 1) + bodyOf(base, 1) / 2;
  const nextCentre = restingOf(base) + insetOf(roomOf(1), 1) + bodyOf(base + 1, 1) / 2;
  const origin = baseCentre + (nextCentre - baseCentre) * fraction;

  const lefts = new Map<number, number>();
  lefts.set(base, 0);
  let cursor = advanceOf(base);
  for (let slot = base + 1; slot <= to; slot++) {
    lefts.set(slot, cursor);
    cursor += advanceOf(slot);
  }
  cursor = 0;
  for (let slot = base - 1; slot >= from; slot--) {
    cursor -= advanceOf(slot);
    lefts.set(slot, cursor);
  }

  const poses: SlotPose[] = [];
  for (let slot = from; slot <= to; slot++) {
    const weight = weightOf(slot);
    const angle = weight * geometry.focusAngle;
    const lean = weight * geometry.focusLean;
    const own = sizeAt(slot);
    const spine = own?.spineWidth ?? geometry.spineWidth;
    const cover = own?.coverWidth ?? geometry.coverWidth;
    const radians = angle * DEG;
    // Foot corners of the turned volume, measured from the middle of its spine.
    const leftFoot = -(spine / 2) * Math.cos(radians);
    const rightFoot = (spine / 2) * Math.cos(radians) + cover * Math.sin(radians);
    const left = (lefts.get(slot) ?? 0) + insetOf(roomAt(slot), weight) - origin;
    const spread = leanSpread(geometry, weight, own);
    // Leaning left, the head reaches `spread` past the left foot; leaning right, past the right foot.
    const corner = lean < 0 ? leftFoot : lean > 0 ? rightFoot : 0;
    const x =
      lean < 0
        ? left + spread - leftFoot
        : lean > 0
          ? left + turnedWidth(geometry, angle, own) - rightFoot
          : left - leftFoot;
    poses.push({
      slot,
      weight,
      angle,
      lean,
      x,
      corner,
      lift: weight * geometry.focusLift,
      z: weight * geometry.focusPush,
    });
  }
  return poses;
}

/**
 * Left and right edge of a posed volume along the row, foot and head together, in the px `pose.x` is in.
 * With `upTo`, only the part of the volume below that height counts: a leaning volume reaches less far
 * sideways low down than at its head, which is what something shorter standing beside it meets.
 */
export function extentOf(pose: SlotPose, size: VolumeSize, upTo?: number): [number, number] {
  const radians = pose.angle * DEG;
  const head = size.bookHeight * Math.abs(Math.sin(pose.lean * DEG));
  const spread = upTo === undefined ? head : Math.min(head, Math.max(0, upTo) * Math.abs(Math.tan(pose.lean * DEG)));
  const leftFoot = -(size.spineWidth / 2) * Math.cos(radians);
  const rightFoot = (size.spineWidth / 2) * Math.cos(radians) + size.coverWidth * Math.sin(radians);
  return [pose.x + leftFoot - (pose.lean < 0 ? spread : 0), pose.x + rightFoot + (pose.lean > 0 ? spread : 0)];
}

/** Room a row of `count` volumes takes when all of them are at rest, gaps included, in px. */
export function restLength(geometry: Geometry, count: number, sizeOf?: SizeOf): number {
  if (!sizeOf) return Math.max(0, count) * restPitch(geometry);
  let length = 0;
  for (let slot = 0; slot < count; slot++) length += slotAdvance(geometry, 0, 0, sizeOf(slot));
  return length;
}

/** A row that stands still: every volume of it, placed about the centre of the scene. */
export interface StandingRow {
  /** Poses of slots 0 to `count - 1`, with `x` measured from the centre of the scene. */
  poses: SlotPose[];
  /** Outer edges of the first and of the last volume. They lie the same distance either side of the centre. */
  left: number;
  right: number;
  /**
   * Where the presented volume stands, as the centre of a travelling row would be: the point `computeRow`
   * measures from. It moves evenly along the row with the position.
   */
  origin: number;
}

/**
 * Poses for a row that does not travel. The row as a whole stays in the middle of the scene and the
 * presented volume turns where it stands: moving the position along it changes which volume is turned,
 * and the others only give or take the room that takes.
 */
export function computeStandingRow(
  position: number,
  geometry: Geometry,
  count: number,
  sizeOf?: SizeOf,
  within = Number.POSITIVE_INFINITY,
): StandingRow {
  if (count <= 0) return { poses: [], left: 0, right: 0, origin: 0 };
  const last = count - 1;
  const poses = computeRow(Math.min(last, Math.max(0, position)), geometry, 0, last, sizeOf);
  const left = extentOf(poses[0]!, sizeOf?.(0) ?? geometry)[0];
  const right = extentOf(poses[last]!, sizeOf?.(last) ?? geometry)[1];
  const centred = -(left + right) / 2;
  // A row too wide for its scene cannot stand in the middle whichever volume is presented: it is moved
  // just far enough to keep the presented one no more than `within` from the centre.
  const reach = Math.max(0, within);
  const shift = Math.min(reach, Math.max(-reach, centred));
  for (const pose of poses) pose.x += shift;
  return { poses, left: left + shift, right: right + shift, origin: shift };
}

/** Half the room the widest presented volume of a row takes, lean included, in px. */
export function presentedReach(geometry: Geometry, count: number, sizeOf?: SizeOf): number {
  let widest = 0;
  for (let slot = 0; slot < Math.max(1, count); slot++) {
    const size = sizeOf?.(slot);
    widest = Math.max(widest, turnedWidth(geometry, geometry.focusAngle, size) + leanSpread(geometry, 1, size));
    if (!sizeOf) break;
  }
  return widest / 2;
}

/**
 * Whether a row may go round in a scene `width` px wide. It may when its volumes at rest fill at least
 * `LOOP_FILL` of the scene and no volume could then be seen twice: one whole round of the row, with
 * whichever volume presented, is longer than the scene by the widest volume and by the board that a volume
 * standing off to one side shows running back from its spine.
 */
export function rowLoops(geometry: Geometry, count: number, width: number, sizeOf?: SizeOf): boolean {
  if (count <= 0) return false;
  const rest = restLength(geometry, count, sizeOf);
  if (rest < LOOP_FILL * width) return false;
  const tuck = geometry.focusLean === 0 ? 0 : geometry.gap + geometry.focusGap;
  let gain = Number.POSITIVE_INFINITY;
  let widest = 0;
  let deepest = 0;
  for (let slot = 0; slot < count; slot++) {
    const size = sizeOf?.(slot);
    // What the row gains in length when this volume is the presented one instead of standing at rest.
    gain = Math.min(gain, slotAdvance(geometry, 1, 1, size) - tuck - slotAdvance(geometry, 0, 0, size));
    widest = Math.max(widest, size?.spineWidth ?? geometry.spineWidth);
    deepest = Math.max(deepest, size?.coverWidth ?? geometry.coverWidth);
    if (!sizeOf) break;
  }
  const board = (deepest * (width / 2)) / Math.max(1, geometry.perspective);
  return rest + gain >= width + widest + board;
}

/** A row whose volumes at rest fill at least this share of the scene repeats; a shorter one stands still. */
export const LOOP_FILL = 0.8;

/**
 * Whether a row stands still in a scene `width` px wide instead of travelling. It does when its volumes at
 * rest leave more than a fifth of the scene empty, so that a travelling row would show bare floor, and
 * when it fits whole with any one volume presented and `ends` px of room kept at each end. An empty row
 * stands.
 */
export function rowStands(geometry: Geometry, count: number, width: number, sizeOf?: SizeOf, ends = 0): boolean {
  if (count <= 0) return true;
  if (restLength(geometry, count, sizeOf) >= LOOP_FILL * width) return false;
  // A volume pushed toward the viewer is drawn larger, and further from the middle of the scene.
  const nearer = geometry.perspective / Math.max(1, geometry.perspective - geometry.focusPush);
  for (let slot = 0; slot < count; slot++) {
    const row = computeStandingRow(slot, geometry, count, sizeOf);
    if ((row.right - row.left + 2 * ends) * nearer > width) return false;
  }
  return true;
}

/**
 * Where a point of the volume in `slot` stands along the row at `position`, in px from the centre of the
 * row. The point is a share of the volume's drawn width: 0 is its left edge, 1 its right edge. A volume
 * gets narrower as it turns back to its spine, and the point keeps its share of that width, so a hand
 * that follows the point stays on the volume.
 */
export function grabbedX(position: number, geometry: Geometry, slot: number, share: number, sizeOf?: SizeOf): number {
  const pose = computeRow(position, geometry, slot, slot, sizeOf)[0]!;
  const [left, right] = extentOf(pose, sizeOf?.(slot) ?? geometry);
  return left + (right - left) * share;
}

/**
 * The row position that puts the grabbed point of the volume in `slot` at `x`: what a drag asks for when
 * the volume under the hand is to stay under it. Found by halving, starting around `near`; the row moves
 * left as the position grows, so there is one answer. About a dozen layouts are worked out, and the
 * answer is good to a small fraction of a pixel.
 */
export function solvePosition(
  x: number,
  geometry: Geometry,
  slot: number,
  share: number,
  near: number,
  sizeOf?: SizeOf,
): number {
  const miss = (position: number): number => grabbedX(position, geometry, slot, share, sizeOf) - x;
  let low = near - 0.5;
  let high = near + 0.5;
  let above = miss(low);
  let below = miss(high);
  // The answer lies between a position that leaves the point right of `x` and one that leaves it left.
  for (let reach = 1; above < 0 && reach <= 64; reach *= 2) {
    high = low;
    below = above;
    low -= reach;
    above = miss(low);
  }
  for (let reach = 1; below > 0 && reach <= 64; reach *= 2) {
    low = high;
    above = below;
    high += reach;
    below = miss(high);
  }
  if (above < 0) return low;
  if (below > 0) return high;
  for (let step = 0; step < 10; step++) {
    const middle = (low + high) / 2;
    if (miss(middle) > 0) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

/**
 * How far a row that stands still gives under a hand that has pulled it `travel` px sideways. It follows
 * the hand at first and less and less after, and never gives more than `most` px: `reach` is the pull
 * that takes it about two thirds of the way there.
 */
export function giveOf(travel: number, most: number, reach: number): number {
  return Math.sign(travel) * most * (1 - Math.exp(-Math.abs(travel) / Math.max(1, reach)));
}

/** The pull that makes such a row give by `give` px: the inverse of `giveOf`. */
export function pullOf(give: number, most: number, reach: number): number {
  const share = Math.min(0.999, Math.abs(give) / Math.max(1e-6, most));
  return -Math.sign(give) * Math.max(1, reach) * Math.log(1 - share);
}

/**
 * Where something let go `seconds` ago is on its way back to rest: it was `from` away and moving at
 * `speed` per second. The pull back is that of a spring that just does not swing past its rest, the same
 * feel as a row settling on a volume.
 */
export function settleOf(from: number, speed: number, seconds: number, stiffness = 200): number {
  const rate = Math.sqrt(Math.max(1e-6, stiffness));
  const time = Math.max(0, seconds);
  return (from + (speed + rate * from) * time) * Math.exp(-rate * time);
}

/**
 * How far a standing volume leans behind the travel of the row, in degrees: `perSpeed` for each volume a
 * second, never more than `most`. Positive leans right, which is what a row moving up (to the left) does
 * to the heads of its volumes.
 */
export function swayOf(speed: number, perSpeed: number, most: number): number {
  if (!Number.isFinite(speed)) return 0;
  return Math.min(most, Math.max(-most, speed * perSpeed));
}

/**
 * Share of that lean a volume `distance` places from the row's position takes: none for a volume that is
 * turned at all, so the presented volume and its turning neighbour hold still, and all of it from about
 * two places out.
 */
export function swayShare(distance: number): number {
  return smooth((Math.abs(distance) - TURN_SPAN) / GAP_SPAN);
}

/**
 * A pose part of the way from one pose to another, `t` from 0 to 1. A volume whose place in the row
 * changes is drawn through these, so it travels and turns to where it belongs instead of jumping there.
 */
export function blendPose(from: SlotPose, to: SlotPose, t: number): SlotPose {
  const share = Math.min(1, Math.max(0, t));
  const mix = (one: number, other: number): number => one + (other - one) * share;
  return {
    slot: to.slot,
    weight: mix(from.weight, to.weight),
    angle: mix(from.angle, to.angle),
    lean: mix(from.lean, to.lean),
    x: mix(from.x, to.x),
    corner: mix(from.corner, to.corner),
    lift: mix(from.lift, to.lift),
    z: mix(from.z, to.z),
  };
}

/** Whether two poses would be drawn the same, to well under a pixel and a tenth of a degree. */
export function samePose(one: SlotPose, other: SlotPose): boolean {
  return (
    Math.abs(one.x - other.x) < 0.25 &&
    Math.abs(one.angle - other.angle) < 0.05 &&
    Math.abs(one.lean - other.lean) < 0.05 &&
    Math.abs(one.lift - other.lift) < 0.25 &&
    Math.abs(one.z - other.z) < 0.25
  );
}

/** Progress of a volume travelling to a new place: it gathers speed, then slows into its place. */
export function easeTravel(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

/** Inclusive slot range that can be visible in a viewport of `width` px, with a margin of spare slots. */
export function visibleRange(
  position: number,
  geometry: Geometry,
  width: number,
  count: number,
  loop: boolean,
  margin = 2,
  sizeOf?: SizeOf,
): { from: number; to: number } {
  if (count <= 0) return { from: 0, to: -1 };
  const centre = Math.round(position);
  let from = centre;
  let to = centre;
  if (sizeOf) {
    // Walk out from the centre until half the width is filled on each side: thin volumes need more slots.
    const limit = loop ? Math.ceil(width / 2 / Math.max(1, geometry.gap)) : count;
    for (let reach = 1, filled = 0; filled < width / 2 && reach <= limit; reach++) {
      filled += slotAdvance(geometry, 0, 0, sizeOf(centre + reach));
      to = centre + reach;
    }
    for (let reach = 1, filled = 0; filled < width / 2 && reach <= limit; reach++) {
      filled += slotAdvance(geometry, 0, 0, sizeOf(centre - reach));
      from = centre - reach;
    }
    from -= margin;
    to += margin;
  } else {
    const reach = Math.ceil(width / 2 / restPitch(geometry)) + margin;
    from = centre - reach;
    to = centre + reach;
  }
  if (loop) return { from, to };
  return { from: Math.max(0, from), to: Math.min(count - 1, to) };
}

/**
 * A spine this wide can carry a title on two lines of at least 10 px. On a small scene the volumes get
 * shorter but their spines do not get narrower than this (or than the look makes them at full size, if
 * that is less): fewer volumes fit in view, and each can still be read.
 */
export const READABLE_SPINE_PX = 44;

/**
 * A look's geometry at the scale that fits a scene, with spines kept wide enough to read: everything is
 * scaled together except that the spine stops at `READABLE_SPINE_PX`.
 */
export function fitGeometry(geometry: Geometry, factor: number): Geometry {
  const scaled = scaleGeometry(geometry, factor);
  scaled.spineWidth = Math.max(scaled.spineWidth, Math.min(geometry.spineWidth, READABLE_SPINE_PX));
  return scaled;
}

export function scaleGeometry(geometry: Geometry, factor: number): Geometry {
  return {
    spineWidth: geometry.spineWidth * factor,
    bookHeight: geometry.bookHeight * factor,
    coverWidth: geometry.coverWidth * factor,
    gap: geometry.gap * factor,
    focusGap: geometry.focusGap * factor,
    focusAngle: geometry.focusAngle,
    focusLean: geometry.focusLean,
    focusPush: geometry.focusPush * factor,
    focusLift: geometry.focusLift * factor,
    perspective: geometry.perspective,
  };
}
