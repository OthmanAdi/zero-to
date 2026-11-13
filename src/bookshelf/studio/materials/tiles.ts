/**
 * The small repeating surfaces the bindings are made of: woven cloth, slubby linen, leather grain, paper
 * fibre, brushed metal, velvet pile, laminate, holographic flakes, the edge of a page block and wood.
 *
 * Every generator is a pure function that fills typed arrays and wraps at its edges, so a tile can be
 * repeated across a board without a seam and tested without a GPU. The kit turns the arrays into
 * textures. No three.js, no DOM.
 */
import { cells, fbm, hash2, seededRandom, valueNoise, type Cells } from './noise';

/** One square tile of a surface, `size` texels each way, row 0 at the bottom (v = 0). */
export interface Surface {
  size: number;
  /** Relief, 0 (deep) to 1 (high). */
  height: Float32Array;
  /** How the surface takes colour: 0.5 leaves the print as it is, lower is darker (hollows, dark threads). */
  shade: Float32Array;
  /** Share of the binding's roughness kept here, 0 to 1. */
  rough: Float32Array;
}

function surface(size: number): Surface {
  const length = size * size;
  return { size, height: new Float32Array(length), shade: new Float32Array(length).fill(0.5), rough: new Float32Array(length).fill(1) };
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export interface WeaveOptions {
  /** Threads across the tile each way. Rounded to a multiple of four so the weave closes on itself. */
  threads: number;
  /** How much a thread swells and thins along its length, 0 to 1. Linen is slubby, book cloth is even. */
  slub?: number;
  /** Open space between threads, as a share of the pitch. */
  gap?: number;
  /** Loose fibre on the threads. */
  fuzz?: number;
  /** How far single threads differ in colour, 0 to 1. */
  tint?: number;
  seed?: number;
}

/**
 * Plain weave: warp threads run up the tile, weft threads across, each passing over one and under one.
 * Every thread is a rounded ridge that rises where it crosses over and dips where it passes under.
 */
export function weaveSurface(size: number, options: WeaveOptions): Surface {
  const threads = Math.max(4, Math.round(options.threads / 4) * 4);
  const slub = options.slub ?? 0;
  const gap = options.gap ?? 0.06;
  const fuzz = options.fuzz ?? 0.08;
  const tint = options.tint ?? 0.1;
  const seed = options.seed ?? 1;
  const out = surface(size);
  const half = threads / 2;
  // Width of every thread at every step along its length: warp thread i at row y, weft thread j at column x.
  const warpWidths = new Float32Array(threads * size);
  const weftWidths = new Float32Array(threads * size);
  for (let thread = 0; thread < threads; thread += 1) {
    for (let step = 0; step < size; step += 1) {
      const along = (step / size) * threads * 0.5;
      warpWidths[thread * size + step] = 1 - gap + (slub === 0 ? 0 : slub * 1.5 * (valueNoise(along, thread, half, threads, seed + 1) - 0.5));
      weftWidths[thread * size + step] = 1 - gap + (slub === 0 ? 0 : slub * 1.5 * (valueNoise(along, thread, half, threads, seed + 2) - 0.5));
    }
  }
  for (let y = 0; y < size; y += 1) {
    const v = (y / size) * threads;
    const j = Math.floor(v);
    const fv = v - j - 0.5;
    for (let x = 0; x < size; x += 1) {
      const u = (x / size) * threads;
      const i = Math.floor(u);
      const fu = u - i - 0.5;
      const warpWidth = warpWidths[i * size + y]!;
      const weftWidth = weftWidths[j * size + x]!;
      const across = Math.cos(Math.max(-0.5, Math.min(0.5, fu / warpWidth)) * Math.PI);
      const along = Math.cos(Math.max(-0.5, Math.min(0.5, fv / weftWidth)) * Math.PI);
      const warpRise = 0.5 + 0.5 * Math.cos(Math.PI * (v - 0.5 + i));
      const weftRise = 0.5 - 0.5 * Math.cos(Math.PI * (u - 0.5 + j));
      const warp = Math.sqrt(across) * (0.22 + 0.78 * warpRise) * (0.75 + 0.25 * warpWidth);
      const weft = Math.sqrt(along) * (0.22 + 0.78 * weftRise) * (0.75 + 0.25 * weftWidth);
      const warpOnTop = warp >= weft;
      const fibre = warpOnTop
        ? valueNoise(u * 6, v * 1.5, threads * 6, threads * 1.5, seed + 7)
        : valueNoise(u * 1.5, v * 6, threads * 1.5, threads * 6, seed + 9);
      const height = clamp01((warpOnTop ? warp : weft) + fuzz * (fibre - 0.5));
      const thread = warpOnTop ? hash2(i, 11, seed) : hash2(j, 23, seed);
      const index = y * size + x;
      out.height[index] = height;
      const hollow = 1 - height;
      out.shade[index] = clamp01(0.5 + tint * (thread - 0.5) + 0.05 * (fibre - 0.5) - 0.2 * hollow * hollow);
      out.rough[index] = 1 - 0.14 * height;
    }
  }
  return out;
}

/** Book cloth: a fine, even, filled weave. */
export function clothSurface(size: number, seed = 1): Surface {
  return weaveSurface(size, { threads: size / 8, slub: 0.12, gap: 0.05, fuzz: 0.1, tint: 0.1, seed });
}

/**
 * Linen: threads nearly as fine as book cloth's (the recipe lays the tile over less of the board, so on
 * the book they are finer), that swell and thin in slubs and each differ a little in colour.
 */
export function linenSurface(size: number, seed = 2): Surface {
  return weaveSurface(size, { threads: size / 9, slub: 0.4, gap: 0.1, fuzz: 0.18, tint: 0.28, seed });
}

/**
 * Leather: small pebbles parted by creases, as on goatskin. The cells are pushed about by slow noise so
 * no two pebbles match, a second and larger run of cells lifts and sinks whole groups of them, the tops
 * are pitted with fine pores, and the creases are rougher and darker than the polished tops.
 */
export function leatherSurface(size: number, seed = 3): Surface {
  const out = surface(size);
  const coarse = Math.max(4, Math.round(size / 12));
  const broad = Math.max(2, Math.round(coarse / 3));
  const fine = coarse * 2;
  const near: Cells = { f1: 0, f2: 0, id: 0 };
  const group: Cells = { f1: 0, f2: 0, id: 0 };
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const pushX = valueNoise(u * 6, v * 6, 6, 6, seed + 3) - 0.5;
      const pushY = valueNoise(u * 6, v * 6, 6, 6, seed + 4) - 0.5;
      cells((u + pushX * 0.03) * coarse, (v + pushY * 0.03) * coarse, coarse, seed, near, 0.95);
      const pebble = smoothstep(0.02, 0.3, near.f2 - near.f1);
      const dome = 1 - Math.min(1, near.f1 * 1.15);
      const lift = 0.8 + 0.2 * near.id;
      // The larger pebbles: whole groups stand a little higher, with a shallow fold between them.
      cells((u + pushY * 0.05) * broad, (v + pushX * 0.05) * broad, broad, seed + 17, group, 0.9);
      const swell = 0.76 + 0.24 * smoothstep(0, 0.35, group.f2 - group.f1) * (0.7 + 0.3 * group.id);
      // Pores: fine pits scattered over the pebbles.
      const pore = smoothstep(0.12, 0.4, valueNoise(u * fine, v * fine, fine, fine, seed + 31));
      const wrinkle = fbm(u, v, 3, 3, seed + 9, 2);
      const height = clamp01(pebble * lift * swell * (0.62 + 0.2 * dome) + 0.1 * pore * pebble + 0.1 * wrinkle);
      const index = y * size + x;
      out.height[index] = height;
      const crease = 1 - pebble;
      out.shade[index] = clamp01(0.5 - 0.2 * crease - 0.05 * (1 - pore) + 0.1 * (wrinkle - 0.5));
      out.rough[index] = clamp01(0.74 + 0.26 * crease + 0.08 * (1 - pore) - 0.06 * dome);
    }
  }
  return out;
}

/** Paper: short fibres lying every way on a slightly cloudy sheet. */
export function paperSurface(size: number, seed = 4): Surface {
  const out = surface(size);
  const random = seededRandom(seed);
  const fibres = Math.round((size * size) / 90);
  const height = out.height;
  for (let fibre = 0; fibre < fibres; fibre += 1) {
    let x = random() * size;
    let y = random() * size;
    let angle = random() * Math.PI * 2;
    const length = 5 + random() * 22;
    const weight = 0.25 + random() * 0.5;
    const bend = (random() - 0.5) * 0.18;
    for (let step = 0; step < length; step += 1) {
      const xi = ((Math.floor(x) % size) + size) % size;
      const yi = ((Math.floor(y) % size) + size) % size;
      height[yi * size + xi]! += weight;
      x += Math.cos(angle);
      y += Math.sin(angle);
      angle += bend;
    }
  }
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x;
      const u = x / size;
      const v = y / size;
      const cloud = fbm(u, v, 4, 4, seed + 5, 3);
      const tooth = valueNoise(u * size * 0.5, v * size * 0.5, size * 0.5, size * 0.5, seed + 6);
      const fibre = Math.min(1, height[index]! * 0.6);
      height[index] = clamp01(0.3 + 0.38 * fibre + 0.22 * tooth + 0.1 * cloud);
      out.shade[index] = clamp01(0.5 + 0.07 * (cloud - 0.5) + 0.06 * fibre - 0.03);
      out.rough[index] = 1 - 0.06 * fibre;
    }
  }
  return out;
}

/** Laminate: flat, with the slow unevenness of a film laid over board, enough to make a reflection wander. */
export function glossSurface(size: number, seed = 5): Surface {
  const out = surface(size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x;
      out.height[index] = fbm(x / size, y / size, 5, 5, seed, 3);
      out.rough[index] = 0.9 + 0.1 * fbm(x / size, y / size, 9, 9, seed + 8, 2);
    }
  }
  return out;
}

/** Velvet: a fine pile, and broad patches where it has been stroked one way or the other. */
export function velvetSurface(size: number, seed = 6): Surface {
  const out = surface(size);
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = y * size + x;
      const pile = valueNoise(u * size * 0.5, v * size * 0.5, size * 0.5, size * 0.5, seed);
      const stroke = fbm(u, v, 3, 3, seed + 2, 3);
      const patch = smoothstep(0.25, 0.75, stroke);
      out.height[index] = clamp01(0.6 * pile + 0.4 * stroke);
      out.shade[index] = clamp01(0.3 + 0.2 * patch + 0.1 * (pile - 0.5));
      out.rough[index] = 1;
    }
  }
  return out;
}

/** Metal foil: long fine scratches from the roll, all one way, running along u. */
export function brushedSurface(size: number, seed = 7): Surface {
  const out = surface(size);
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = y * size + x;
      const fineLines = valueNoise(u * 3, v * size * 0.5, 3, size * 0.5, seed);
      const lines = valueNoise(u * 2, v * size * 0.125, 2, size * 0.125, seed + 1);
      const sweep = fbm(u, v, 2, 6, seed + 2, 2);
      out.height[index] = clamp01(0.65 * fineLines + 0.2 * lines + 0.15 * sweep);
      out.shade[index] = clamp01(0.5 + 0.06 * (lines - 0.5));
      out.rough[index] = clamp01(0.78 + 0.22 * fineLines);
    }
  }
  return out;
}

/** Height field to a tangent space normal map (RGBA bytes). Samples wrap, so a seamless height stays seamless. */
export function heightToNormal(height: Float32Array, width: number, rows: number, strength: number): Uint8Array {
  const out = new Uint8Array(width * rows * 4);
  for (let y = 0; y < rows; y += 1) {
    const up = ((y + 1) % rows) * width;
    const down = ((y + rows - 1) % rows) * width;
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const right = (x + 1) % width;
      const left = (x + width - 1) % width;
      const dx = (height[row + right]! - height[row + left]!) * strength;
      const dy = (height[up + x]! - height[down + x]!) * strength;
      const scale = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const index = (row + x) * 4;
      out[index] = Math.round((-dx * scale * 0.5 + 0.5) * 255);
      out[index + 1] = Math.round((-dy * scale * 0.5 + 0.5) * 255);
      out[index + 2] = Math.round((scale * 0.5 + 0.5) * 255);
      out[index + 3] = 255;
    }
  }
  return out;
}

/**
 * Shade and roughness packed the way three.js reads them: G is roughness and B is metalness, as in an
 * occlusion, roughness, metalness texture. R carries the shade, which the binding shader multiplies in.
 */
export function packDetail(shade: Float32Array, rough: Float32Array, metal?: Float32Array): Uint8Array {
  const out = new Uint8Array(shade.length * 4);
  for (let index = 0; index < shade.length; index += 1) {
    const at = index * 4;
    out[at] = Math.round(clamp01(shade[index]!) * 255);
    out[at + 1] = Math.round(clamp01(rough[index]!) * 255);
    out[at + 2] = metal ? Math.round(clamp01(metal[index]!) * 255) : 255;
    out[at + 3] = 255;
  }
  return out;
}

/** The textures of a holographic foil: flakes that each lean their own way, and a film whose thickness drifts. */
export interface FlakeTile {
  size: number;
  /** Tangent space normals, RGBA bytes. One direction per flake. */
  normal: Uint8Array;
  /** Shade (R), roughness (G), metalness (B). */
  detail: Uint8Array;
  /** Film thickness in G, 0 to 1 of the material's thickness range, RGBA bytes. */
  thickness: Uint8Array;
}

/**
 * Holographic foil. The sheet is made of small flakes that all lie nearly flat; one in twenty is a little
 * brighter than the sheet, which reads as glitter. None is darker than the sheet. The film thickness drifts slowly across the tile and steps
 * very slightly from flake to flake, so the colour runs in smooth bands with a grain at close range.
 */
export function flakeTile(size: number, seed = 8): FlakeTile {
  const count = size * size;
  const normal = new Uint8Array(count * 4);
  const detail = new Uint8Array(count * 4);
  const thickness = new Uint8Array(count * 4);
  const grid = Math.max(4, Math.round(size / 5));
  const near: Cells = { f1: 0, f2: 0, id: 0 };
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      cells(u * grid, v * grid, grid, seed, near, 1);
      const id = near.id;
      const angle = hash2(Math.floor(id * 65536), 3, seed) * Math.PI * 2;
      const pick = hash2(Math.floor(id * 65536), 5, seed);
      const spark = pick > 0.95;
      // Every flake lies nearly flat. One that leaned far would mirror a dark corner of the room most of
      // the time and show as a dark speck.
      const lean = spark ? 0.03 + 0.03 * hash2(Math.floor(id * 65536), 7, seed) : 0.006 + 0.02 * pick;
      const nx = Math.cos(angle) * lean;
      const ny = Math.sin(angle) * lean;
      const nz = Math.sqrt(1 - lean * lean);
      const at = (y * size + x) * 4;
      normal[at] = Math.round((nx * 0.5 + 0.5) * 255);
      normal[at + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normal[at + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normal[at + 3] = 255;
      // A flake is never darker than the sheet it lies in: the ones that stand out are brighter and smoother.
      detail[at] = Math.round((0.5 + (spark ? 0.1 + 0.12 * id : 0)) * 255);
      // All equally smooth: a smoother flake mirrors one spot of the room, which is dark more often than bright.
      detail[at + 1] = Math.round((0.9 + 0.1 * hash2(Math.floor(id * 65536), 9, seed)) * 255);
      detail[at + 2] = 255;
      detail[at + 3] = 255;
      // A slow run of bands that closes on itself, plus a step per flake.
      const drift = fbm(u, v, 2, 2, seed + 21, 2);
      const band = 0.5 + 0.5 * Math.sin((u + v * 2 + drift * 0.9) * Math.PI * 2);
      const film = clamp01(0.9 * band + 0.1 * id);
      thickness[at] = 0;
      thickness[at + 1] = Math.round(film * 255);
      thickness[at + 2] = 0;
      thickness[at + 3] = 255;
    }
  }
  return { size, normal, detail, thickness };
}

/** The edge of a page block: sheets stacked along u, in gatherings, with the colour and relief of each. */
export interface PagesTile {
  width: number;
  rows: number;
  /** sRGB colour, RGBA bytes. */
  color: Uint8Array;
  normal: Uint8Array;
  /** Sheets across the tile. */
  sheets: number;
}

/**
 * Page edges. Each sheet is a narrow ridge; sheets differ slightly in tone and set-back, every eighth gap
 * is deeper where one gathering meets the next, and the lines waver a little along their length.
 */
export function pagesTile(width = 256, rows = 64, seed = 9): PagesTile {
  const sheets = Math.round(width / 4);
  const height = new Float32Array(width * rows);
  const color = new Uint8Array(width * rows * 4);
  for (let y = 0; y < rows; y += 1) {
    const v = y / rows;
    for (let x = 0; x < width; x += 1) {
      const waver = (valueNoise(v * 4, (x / width) * 8, 4, 8, seed + 3) - 0.5) * 0.35;
      const s = (x / width) * sheets + waver;
      const sheet = ((Math.floor(s) % sheets) + sheets) % sheets;
      const across = s - Math.floor(s) - 0.5;
      const setBack = hash2(sheet, 1, seed);
      const tone = hash2(sheet, 2, seed);
      const gathering = sheet % 8 === 0 && across < 0 ? 0.55 : 0;
      const ridge = Math.cos(across * Math.PI);
      const relief = clamp01(Math.sqrt(ridge) * (0.7 + 0.3 * setBack) - gathering * (1 - ridge));
      height[y * width + x] = relief;
      const grain = valueNoise(v * rows * 0.5, x, rows * 0.5, width, seed + 5);
      // Bright paper: the gaps between sheets are a soft line, not a grey one.
      const light = 0.8 + 0.17 * relief + 0.06 * (tone - 0.5) + 0.04 * (grain - 0.5) - gathering * 0.2 * (1 - ridge);
      const at = (y * width + x) * 4;
      color[at] = Math.round(clamp01(light * 0.99) * 255);
      color[at + 1] = Math.round(clamp01(light * 0.955) * 255);
      color[at + 2] = Math.round(clamp01(light * 0.875) * 255);
      color[at + 3] = 255;
    }
  }
  return { width, rows, color, normal: heightToNormal(height, width, rows, 2.2), sheets };
}

/** A plank: colour (sRGB bytes), relief and how the finish varies. The grain runs along u. */
export interface WoodTile {
  size: number;
  color: Uint8Array;
  normal: Uint8Array;
  detail: Uint8Array;
}

export interface WoodOptions {
  /** Early wood and late wood, as sRGB 0 to 1. */
  light: readonly [number, number, number];
  dark: readonly [number, number, number];
  /** Growth rings across the tile. */
  rings?: number;
  /** How open the pores are, 0 (painted or filled) to 1 (oak). */
  pores?: number;
  /** Depth of the relief in the normal map. */
  relief?: number;
  seed?: number;
}

/**
 * Wood, cut along the grain: growth rings stretched into long bands that wander, with short dark pores
 * lying in them. With `pores` near 0 and close colours it is a painted or lacquered board that still
 * shows the grain underneath.
 */
export function woodTile(size: number, options: WoodOptions): WoodTile {
  const rings = Math.max(2, Math.round(options.rings ?? 9));
  const pores = options.pores ?? 1;
  const seed = options.seed ?? 10;
  const height = new Float32Array(size * size);
  const shade = new Float32Array(size * size);
  const rough = new Float32Array(size * size);
  const color = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const wander = fbm(u, v, 1, 2, seed, 3) - 0.5;
      const ring = v * rings + wander * 1.1;
      const phase = ring - Math.floor(ring);
      // Slow rise through the early wood, a quick dark line of late wood, then the next ring.
      const late = smoothstep(0.35, 0.9, phase) * (1 - smoothstep(0.9, 1, phase));
      const streak = valueNoise(u * 4, v * size * 0.25, 4, size * 0.25, seed + 4);
      const pore = pores * smoothstep(0.62, 0.9, valueNoise(u * 16, v * size * 0.5, 16, size * 0.5, seed + 6)) * (0.4 + 0.6 * late);
      const figure = fbm(u, v, 3, 2, seed + 8, 2);
      const mix = clamp01(0.2 + 0.42 * late + 0.34 * (streak - 0.5) + 0.25 * (figure - 0.5) + 0.35 * pore);
      const index = y * size + x;
      const at = index * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const value = options.light[channel]! + (options.dark[channel]! - options.light[channel]!) * mix;
        color[at + channel] = Math.round(clamp01(value) * 255);
      }
      color[at + 3] = 255;
      height[index] = clamp01(0.6 - 0.25 * late - 0.5 * pore + 0.15 * (streak - 0.5));
      shade[index] = 0.5;
      rough[index] = clamp01(0.8 + 0.2 * pore + 0.1 * late);
    }
  }
  return { size, color, normal: heightToNormal(height, size, size, options.relief ?? 2), detail: packDetail(shade, rough) };
}
