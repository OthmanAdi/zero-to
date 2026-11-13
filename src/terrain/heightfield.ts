import { fork, pick, range, type Random } from '../core/random';
import { createNoise2D, fbm } from './noise';

/** The mountain shapes a roadmap can ask for. */
export const TERRAIN_TEMPLATE_IDS = ['volcano', 'ridge', 'massif', 'twin-peaks', 'plateau', 'canyon'] as const;
export type TerrainTemplate = (typeof TERRAIN_TEMPLATE_IDS)[number];

export interface TerrainSpec {
  /** The same seed always gives the same mountain. */
  readonly seed: number | string;
  /** A prepared shape, or 'random' to let the seed choose one. */
  readonly template: TerrainTemplate | 'random';
  /** Grid nodes per side. Default 129. */
  readonly resolution?: number;
  /** 0 is smooth ground, 1 is broken ground. Default 0.5. */
  readonly roughness?: number;
}

/**
 * A square grid of normalised heights. x and z run from -1 to 1, heights from 0 to 1. The summit is exactly 1 and
 * the border of the footprint is 0.
 */
export interface Heightfield {
  /** Grid nodes per side. */
  readonly resolution: number;
  /** Heights, row by row: index = j * resolution + i, with i along x and j along z. */
  readonly data: Float32Array;
  /** The shape that was built. Never 'random'. */
  readonly template: TerrainTemplate;
  readonly seed: number | string;
  readonly roughness: number;
  /** The highest node. */
  readonly summit: { readonly x: number; readonly z: number; readonly h: number };
  /** Height at a grid node, clamped to the grid. */
  at(i: number, j: number): number;
  /** Height at any point, bilinear between nodes, clamped to the footprint. */
  sample(x: number, z: number): number;
}

export const DEFAULT_RESOLUTION = 129;

const TAU = Math.PI * 2;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Smallest difference between two angles, in [0, pi]. */
function angleBetween(a: number, b: number): number {
  const d = Math.abs(a - b) % TAU;
  return d > Math.PI ? TAU - d : d;
}

const gauss = (distance: number, width: number): number => Math.exp(-((distance / width) ** 2));

/** One template: the bare shape, how much noise it takes at a point, and an optional cut made after the noise. */
interface Shape {
  height(x: number, z: number): number;
  detail?(x: number, z: number): number;
  carve?(x: number, z: number, height: number): number;
}

interface Peak {
  readonly x: number;
  readonly z: number;
  readonly height: number;
  readonly radius: number;
}

/** A soft maximum, so neighbouring peaks join with a saddle and not with a crease. */
function blendPeaks(peaks: readonly Peak[], x: number, z: number, power: number, sharpness: number): number {
  let sum = 0;
  for (const peak of peaks) {
    const d = Math.hypot(x - peak.x, z - peak.z);
    const v = peak.height * Math.max(0, 1 - d / peak.radius) ** power;
    sum += v ** sharpness;
  }
  return sum ** (1 / sharpness);
}

function volcano(random: Random): Shape {
  const cx = range(random, -0.07, 0.07);
  const cz = range(random, -0.07, 0.07);
  const radius = range(random, 0.8, 0.9);
  const rim = range(random, 0.14, 0.19);
  const depth = range(random, 0.15, 0.24);
  const tilt = range(random, 0, TAU);
  const tiltAmount = range(random, 0.06, 0.12);
  const breach = range(random, 0, TAU);
  const breachAmount = random() < 0.65 ? range(random, 0.12, 0.26) : 0;
  const rimHeight = (1 - rim / radius) ** 1.55;
  return {
    height(x, z) {
      const dx = x - cx;
      const dz = z - cz;
      const d = Math.hypot(dx, dz);
      const angle = Math.atan2(dz, dx);
      // Concave flanks outside the rim, a bowl inside it. The two meet in a sharp crest.
      let h = d >= rim ? Math.max(0, 1 - d / radius) ** 1.55 : rimHeight - depth * (1 - (d / rim) ** 2) ** 2;
      // One side of the rim stands higher, so there is a single summit.
      h *= 1 + tiltAmount * Math.cos(angle - tilt) * Math.max(0, 1 - d / radius);
      // An old lava breach lowers the rim on one side.
      h -= breachAmount * rimHeight * gauss(angleBetween(angle, breach), 0.4) * gauss(d - rim, rim * 0.9);
      return Math.max(0, h);
    },
  };
}

function ridge(random: Random): Shape {
  const angle = range(random, 0, Math.PI);
  const dirX = Math.cos(angle);
  const dirZ = Math.sin(angle);
  const half = 0.74;
  const bend = range(random, -0.17, 0.17);
  const main = range(random, -0.22, 0.22);
  const left = main - range(random, 0.36, 0.55);
  const right = main + range(random, 0.36, 0.55);
  const leftHeight = range(random, 0.1, 0.22);
  const rightHeight = range(random, 0.1, 0.22);
  const width = range(random, 0.44, 0.52);
  return {
    height(x, z) {
      const along = (x * dirX + z * dirZ) / half;
      const t = clamp(along, -1, 1);
      const across = -x * dirZ + z * dirX - bend * (1 - t * t);
      const beyond = Math.max(0, Math.abs(along) - 1) * half;
      const d = Math.hypot(across, beyond);
      // The crest line: one main summit, two lower tops, and a spine that drops toward both ends.
      let crest = 0.66 + 0.34 * gauss(t - main, 0.3) + leftHeight * gauss(t - left, 0.2) + rightHeight * gauss(t - right, 0.2);
      crest *= 1 - 0.5 * t ** 4;
      const reach = width * (0.55 + 0.45 * crest);
      return crest * Math.max(0, 1 - d / reach) ** 1.2;
    },
  };
}

function massif(random: Random): Shape {
  const cx = range(random, -0.08, 0.08);
  const cz = range(random, -0.08, 0.08);
  const peaks: Peak[] = [{ x: cx, z: cz, height: 1, radius: range(random, 0.62, 0.74) }];
  const count = 4 + Math.floor(random() * 3);
  const turn = range(random, 0, TAU);
  for (let i = 0; i < count; i += 1) {
    const angle = turn + (i / count) * TAU + range(random, -0.35, 0.35);
    const distance = range(random, 0.26, 0.48);
    peaks.push({
      x: cx + Math.cos(angle) * distance,
      z: cz + Math.sin(angle) * distance,
      height: range(random, 0.5, 0.82),
      radius: range(random, 0.38, 0.54),
    });
  }
  return {
    height(x, z) {
      const d = Math.hypot(x - cx, z - cz);
      const dome = 0.28 * Math.max(0, 1 - (d / 0.94) ** 2);
      return 0.85 * blendPeaks(peaks, x, z, 1.3, 5) + dome;
    },
  };
}

function twinPeaks(random: Random): Shape {
  const angle = range(random, 0, Math.PI);
  const dirX = Math.cos(angle);
  const dirZ = Math.sin(angle);
  const gap = range(random, 0.27, 0.34);
  const lower = range(random, 0.74, 0.88);
  const side = random() < 0.5 ? 1 : -1;
  const peaks: Peak[] = [
    { x: dirX * gap * 0.9 * side, z: dirZ * gap * 0.9 * side, height: 1, radius: range(random, 0.56, 0.62) },
    { x: -dirX * gap * 1.1 * side, z: -dirZ * gap * 1.1 * side, height: lower, radius: range(random, 0.52, 0.58) },
  ];
  return {
    height(x, z) {
      const along = x * dirX + z * dirZ;
      const across = -x * dirZ + z * dirX;
      const dome = 0.3 * Math.max(0, 1 - (along / 0.96) ** 2 - (across / 0.72) ** 2);
      return blendPeaks(peaks, x, z, 1.45, 6) + dome;
    },
  };
}

function plateau(random: Random): Shape {
  const cx = range(random, -0.06, 0.06);
  const cz = range(random, -0.06, 0.06);
  const radius = range(random, 0.46, 0.54);
  const cliff = range(random, 0.06, 0.1);
  const phase3 = range(random, 0, TAU);
  const phase5 = range(random, 0, TAU);
  const phase2 = range(random, 0, TAU);
  const knollAngle = range(random, 0, TAU);
  const knollDistance = radius * range(random, 0.15, 0.5);
  const knollX = cx + Math.cos(knollAngle) * knollDistance;
  const knollZ = cz + Math.sin(knollAngle) * knollDistance;
  const knollHeight = range(random, 0.07, 0.11);
  const outer = 0.97;
  const lobed = (x: number, z: number): number => {
    const dx = x - cx;
    const dz = z - cz;
    const angle = Math.atan2(dz, dx);
    return Math.hypot(dx, dz) * (1 + 0.14 * Math.cos(3 * angle + phase3) + 0.09 * Math.cos(5 * angle + phase5));
  };
  const mesaAt = (reach: number): number => 1 - smoothstep(radius - cliff, radius + cliff, reach);
  return {
    height(x, z) {
      const reach = lobed(x, z);
      const mesa = mesaAt(reach);
      // The scree apron below the cliff.
      const apron = reach <= radius ? 1 : Math.max(0, 1 - (reach - radius) / (outer - radius));
      const skirt = 0.36 * apron ** 1.2;
      const angle = Math.atan2(z - cz, x - cx);
      const top =
        0.8 +
        knollHeight * gauss(Math.hypot(x - knollX, z - knollZ), 0.13) +
        0.025 * Math.cos(2 * angle + phase2) * Math.min(1, reach / radius);
      return skirt * (1 - mesa) + top * mesa;
    },
    detail(x, z) {
      return 1 - 0.8 * mesaAt(lobed(x, z));
    },
  };
}

function canyon(random: Random): Shape {
  const angle = range(random, 0, TAU);
  const dirX = Math.cos(angle);
  const dirZ = Math.sin(angle);
  const perpX = -dirZ;
  const perpZ = dirX;
  const offset = range(random, 0.2, 0.28);
  const cx = perpX * offset;
  const cz = perpZ * offset;
  const peaks: Peak[] = [{ x: cx, z: cz, height: 1, radius: range(random, 0.66, 0.74) }];
  for (let i = 0; i < 2; i += 1) {
    const side = i === 0 ? 1 : -1;
    const distance = range(random, 0.3, 0.44);
    peaks.push({
      x: cx + dirX * distance * side + perpX * range(random, -0.05, 0.12),
      z: cz + dirZ * distance * side + perpZ * range(random, -0.05, 0.12),
      height: range(random, 0.5, 0.72),
      radius: range(random, 0.4, 0.5),
    });
  }
  const riverOffset = range(random, 0.3, 0.38);
  const riverX = -perpX * riverOffset;
  const riverZ = -perpZ * riverOffset;
  const phaseA = range(random, 0, TAU);
  const phaseB = range(random, 0, TAU);
  const floor = 0.03;
  const wall = range(random, 0.09, 0.13);
  return {
    height(x, z) {
      // A raised bench under the mountain, so the river has something to cut through.
      const square = (x ** 4 + z ** 4) ** 0.25;
      const bench = 0.3 * (1 - smoothstep(0.55, 0.95, square));
      return bench + 0.85 * blendPeaks(peaks, x, z, 1.4, 5);
    },
    carve(x, z, height) {
      const along = (x - riverX) * dirX + (z - riverZ) * dirZ;
      const across = (x - riverX) * perpX + (z - riverZ) * perpZ;
      const meander = 0.08 * Math.sin(along * 4.2 + phaseA) + 0.04 * Math.sin(along * 9.1 + phaseB);
      return height * smoothstep(floor, floor + wall, Math.abs(across - meander));
    },
  };
}

const SHAPES: Record<TerrainTemplate, (random: Random) => Shape> = {
  volcano,
  ridge,
  massif,
  'twin-peaks': twinPeaks,
  plateau,
  canyon,
};

/** The template a spec ends up with: its own, or the one the seed picks for 'random'. */
export function resolveTerrainTemplate(spec: Pick<TerrainSpec, 'seed' | 'template'>): TerrainTemplate {
  if (spec.template !== 'random') {
    if (!TERRAIN_TEMPLATE_IDS.includes(spec.template)) throw new Error(`Unknown terrain template: ${String(spec.template)}`);
    return spec.template;
  }
  return pick(fork(spec.seed, 'terrain/template'), TERRAIN_TEMPLATE_IDS);
}

/** Builds the mountain for a spec. The same spec always returns the same heights. */
export function generateHeightfield(spec: TerrainSpec): Heightfield {
  const resolution = Math.round(clamp(spec.resolution ?? DEFAULT_RESOLUTION, 17, 513));
  const roughness = clamp(spec.roughness ?? 0.5, 0, 1);
  const template = resolveTerrainTemplate(spec);
  const shape = SHAPES[template](fork(spec.seed, `terrain/shape/${template}`));
  const noise = createNoise2D(fork(spec.seed, 'terrain/noise'));
  const warp = createNoise2D(fork(spec.seed, 'terrain/warp'));

  // Coarse grids cannot carry the finest octave without turning it into speckle.
  const octaves = resolution >= 97 ? 4 : 3;
  const swell = 0.1 + 0.3 * roughness;
  const crags = 0.05 + 0.17 * roughness;
  const bend = 0.05 + 0.07 * roughness;
  const data = new Float32Array(resolution * resolution);
  const last = resolution - 1;
  let top = 0;
  let topIndex = 0;

  for (let j = 0; j < resolution; j += 1) {
    const z = -1 + (2 * j) / last;
    for (let i = 0; i < resolution; i += 1) {
      const x = -1 + (2 * i) / last;
      // Bend the coordinates, so no template looks drawn with a compass.
      const wx = x + bend * fbm(warp, x * 1.2 + 3.1, z * 1.2 - 1.7, 2, 0.5);
      const wz = z + bend * fbm(warp, x * 1.2 - 7.7, z * 1.2 + 5.3, 2, 0.5);
      const base = shape.height(wx, wz);
      const detail = shape.detail ? shape.detail(wx, wz) : 1;
      // Broad swells push whole flanks out and in. Ridged noise adds spurs and gullies that run down the slopes.
      const rolling = fbm(noise, x * 1.9, z * 1.9, octaves, 0.5);
      const ridged = 1 - Math.abs(fbm(noise, x * 2.3 + 11.3, z * 2.3 - 4.9, 3, 0.55));
      // Flat low ground stays calm. Broken ground belongs on the slopes.
      const carry = Math.min(1, base * 2.2);
      let h = base * (1 + swell * detail * rolling) + crags * detail * carry * (ridged - 0.7);
      h = Math.max(0, h);
      // The footprint ends in a rounded square: the border itself is exactly 0.
      h *= 1 - smoothstep(0.8, 1, (x ** 4 + z ** 4) ** 0.25);
      if (shape.carve) h = shape.carve(x, z, h);
      const index = j * resolution + i;
      data[index] = h;
      if (h > top) {
        top = h;
        topIndex = index;
      }
    }
  }

  if (top > 0) for (let index = 0; index < data.length; index += 1) data[index] = (data[index] as number) / top;
  data[topIndex] = 1;

  return heightfieldFromData(resolution, data, { template, seed: spec.seed, roughness });
}

/**
 * Wraps a grid of heights that already exists. The data is used as it is: nothing is rescaled. The summit is the
 * highest node.
 */
export function heightfieldFromData(
  resolution: number,
  data: Float32Array,
  info: { readonly template?: TerrainTemplate; readonly seed?: number | string; readonly roughness?: number } = {},
): Heightfield {
  if (resolution < 2 || data.length !== resolution * resolution) {
    throw new Error('heightfieldFromData: data must hold resolution x resolution heights');
  }
  const last = resolution - 1;
  let topIndex = 0;
  for (let index = 1; index < data.length; index += 1) {
    if ((data[index] as number) > (data[topIndex] as number)) topIndex = index;
  }

  const summit = {
    x: -1 + (2 * (topIndex % resolution)) / last,
    z: -1 + (2 * Math.floor(topIndex / resolution)) / last,
    h: data[topIndex] as number,
  };

  const at = (i: number, j: number): number =>
    data[clamp(Math.round(j), 0, last) * resolution + clamp(Math.round(i), 0, last)] as number;

  const sample = (x: number, z: number): number => {
    const fx = clamp((x + 1) * 0.5, 0, 1) * last;
    const fz = clamp((z + 1) * 0.5, 0, 1) * last;
    const i0 = Math.min(last - 1, Math.floor(fx));
    const j0 = Math.min(last - 1, Math.floor(fz));
    const tx = fx - i0;
    const tz = fz - j0;
    const row0 = j0 * resolution + i0;
    const row1 = row0 + resolution;
    const a = data[row0] as number;
    const b = data[row0 + 1] as number;
    const c = data[row1] as number;
    const d = data[row1 + 1] as number;
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  };

  return {
    resolution,
    data,
    template: info.template ?? 'massif',
    seed: info.seed ?? 0,
    roughness: info.roughness ?? 0,
    summit,
    at,
    sample,
  };
}
