import { describe, expect, it } from 'vitest';
import {
  brushedSurface,
  clothSurface,
  flakeTile,
  glossSurface,
  heightToNormal,
  leatherSurface,
  linenSurface,
  packDetail,
  pagesTile,
  paperSurface,
  velvetSurface,
  weaveSurface,
  woodTile,
  type Surface,
} from './tiles';

const SIZE = 64;
const makers: Record<string, (size: number, seed?: number) => Surface> = {
  cloth: clothSurface,
  linen: linenSurface,
  leather: leatherSurface,
  paper: paperSurface,
  gloss: glossSurface,
  velvet: velvetSurface,
  brushed: brushedSurface,
};

/** Mean step between neighbours inside the tile and across its wrap, along both axes. */
function seam(field: ArrayLike<number>, width: number, rows: number, stride = 1, channel = 0): { inside: number; across: number } {
  const at = (x: number, y: number) => field[(y * width + x) * stride + channel]!;
  let inside = 0;
  let insideCount = 0;
  let across = 0;
  let acrossCount = 0;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = Math.abs(at(x, y) - at((x + 1) % width, y));
      const dy = Math.abs(at(x, y) - at(x, (y + 1) % rows));
      if (x === width - 1) [across, acrossCount] = [across + dx, acrossCount + 1];
      else [inside, insideCount] = [inside + dx, insideCount + 1];
      if (y === rows - 1) [across, acrossCount] = [across + dy, acrossCount + 1];
      else [inside, insideCount] = [inside + dy, insideCount + 1];
    }
  }
  return { inside: inside / insideCount, across: across / acrossCount };
}

function expectUnitNormals(normal: Uint8Array): void {
  for (let at = 0; at < normal.length; at += 4) {
    const x = (normal[at]! / 255) * 2 - 1;
    const y = (normal[at + 1]! / 255) * 2 - 1;
    const z = (normal[at + 2]! / 255) * 2 - 1;
    const length = Math.hypot(x, y, z);
    if (Math.abs(length - 1) > 0.02 || z <= 0 || normal[at + 3] !== 255) {
      throw new Error(`normal ${at / 4} is (${x}, ${y}, ${z}), length ${length}`);
    }
  }
}

describe('binding surfaces', () => {
  for (const [name, make] of Object.entries(makers)) {
    it(`${name} is deterministic, in range and has relief`, () => {
      const a = make(SIZE, 11);
      const b = make(SIZE, 11);
      expect(a.size).toBe(SIZE);
      expect(a.height.length).toBe(SIZE * SIZE);
      expect(Array.from(b.height)).toEqual(Array.from(a.height));
      expect(Array.from(b.shade)).toEqual(Array.from(a.shade));
      expect(Array.from(make(SIZE, 12).height)).not.toEqual(Array.from(a.height));
      let low = 1;
      let high = 0;
      for (const field of [a.height, a.shade, a.rough]) {
        for (const value of field) {
          if (!(value >= 0 && value <= 1)) throw new Error(`${name} has a value out of range: ${value}`);
        }
      }
      for (const value of a.height) [low, high] = [Math.min(low, value), Math.max(high, value)];
      expect(high - low).toBeGreaterThan(0.15);
    });

    it(`${name} wraps without a seam`, () => {
      const made = make(SIZE, 11);
      for (const field of [made.height, made.shade, made.rough]) {
        const { inside, across } = seam(field, SIZE, SIZE);
        expect(across).toBeLessThanOrEqual(inside * 2 + 0.004);
      }
    });

    it(`${name} gives unit normals`, () => {
      const made = make(SIZE, 11);
      expectUnitNormals(heightToNormal(made.height, SIZE, SIZE, 3));
    });
  }

  it('weaves over one and under one', () => {
    const threads = 8;
    const weave = weaveSurface(64, { threads, fuzz: 0, slub: 0, gap: 0, seed: 1 });
    const pitch = 64 / threads;
    const centre = (i: number, j: number) => weave.height[Math.floor((j + 0.5) * pitch) * 64 + Math.floor((i + 0.5) * pitch)]!;
    const corner = (i: number, j: number) => weave.height[Math.floor(j * pitch) * 64 + Math.floor(i * pitch)]!;
    for (let j = 0; j < threads; j += 1) {
      for (let i = 0; i < threads; i += 1) {
        expect(centre(i, j)).toBeGreaterThan(0.85);
        expect(corner(i, j)).toBeLessThan(0.2);
      }
    }
  });

  it('makes linen less even than book cloth', () => {
    const spread = (made: Surface) => {
      let mean = 0;
      for (const value of made.shade) mean += value;
      mean /= made.shade.length;
      let variance = 0;
      for (const value of made.shade) variance += (value - mean) ** 2;
      return variance / made.shade.length;
    };
    expect(spread(linenSurface(128))).toBeGreaterThan(spread(clothSurface(128)));
  });

  it('grains leather finely: a pebble is a twelfth of the tile or less', () => {
    const size = 96;
    const leather = leatherSurface(size);
    // Creases are the deep lines between pebbles. Count the pebbles a row crosses by its runs of high ground.
    let runs = 0;
    for (let y = 0; y < size; y += 8) {
      let high = false;
      for (let x = 0; x < size; x += 1) {
        const now = leather.height[y * size + x]! > 0.3;
        if (now && !high) runs += 1;
        high = now;
      }
    }
    expect(runs / (size / 8)).toBeGreaterThanOrEqual(6);
  });

  it('makes leather rougher in its creases than on its pebbles', () => {
    const leather = leatherSurface(96);
    let high = 0;
    let highCount = 0;
    let low = 0;
    let lowCount = 0;
    leather.height.forEach((value, index) => {
      if (value > 0.6) [high, highCount] = [high + leather.rough[index]!, highCount + 1];
      if (value < 0.2) [low, lowCount] = [low + leather.rough[index]!, lowCount + 1];
    });
    expect(highCount).toBeGreaterThan(0);
    expect(lowCount).toBeGreaterThan(0);
    expect(low / lowCount).toBeGreaterThan(high / highCount + 0.08);
  });
});

describe('heightToNormal', () => {
  it('points straight up on a flat field and leans away from a rise', () => {
    const flat = heightToNormal(new Float32Array(16).fill(0.4), 4, 4, 5);
    for (let at = 0; at < flat.length; at += 4) expect([flat[at], flat[at + 1], flat[at + 2], flat[at + 3]]).toEqual([128, 128, 255, 255]);
    // A ramp rising with x: the surface faces back toward lower x.
    const ramp = new Float32Array(64);
    for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) ramp[y * 8 + x] = x / 8;
    const normal = heightToNormal(ramp, 8, 8, 4);
    const at = (3 * 8 + 3) * 4;
    expect(normal[at]!).toBeLessThan(110);
    expect(normal[at + 1]).toBe(128);
  });

  it('handles a tile that is not square', () => {
    const field = new Float32Array(32 * 8);
    for (let index = 0; index < field.length; index += 1) field[index] = ((index * 7919) % 13) / 13;
    const normal = heightToNormal(field, 32, 8, 2);
    expect(normal.length).toBe(32 * 8 * 4);
    expectUnitNormals(normal);
  });
});

describe('packDetail', () => {
  it('packs shade, roughness and metalness into R, G and B', () => {
    const packed = packDetail(new Float32Array([0, 0.5, 2]), new Float32Array([1, 0.25, -1]), new Float32Array([0, 1, 0.5]));
    expect(Array.from(packed)).toEqual([0, 255, 0, 255, 128, 64, 255, 255, 255, 0, 128, 255]);
    expect(packDetail(new Float32Array([0.5]), new Float32Array([1]))[2]).toBe(255);
  });
});

describe('holographic flakes', () => {
  const tile = flakeTile(SIZE, 4);

  it('is deterministic, with unit normals and a film that varies', () => {
    expect(Array.from(flakeTile(SIZE, 4).normal)).toEqual(Array.from(tile.normal));
    expectUnitNormals(tile.normal);
    let low = 255;
    let high = 0;
    for (let at = 1; at < tile.thickness.length; at += 4) [low, high] = [Math.min(low, tile.thickness[at]!), Math.max(high, tile.thickness[at]!)];
    expect(high - low).toBeGreaterThan(120);
  });

  it('lays every flake nearly flat, each leaning its own way', () => {
    const leans = new Set<number>();
    for (let at = 0; at < tile.normal.length; at += 4) {
      // A flake that leaned far would mirror a dark corner of the room and show as a dark speck.
      expect(tile.normal[at + 2]!).toBeGreaterThanOrEqual(254);
      leans.add(tile.normal[at]! * 256 + tile.normal[at + 1]!);
    }
    expect(leans.size).toBeGreaterThan(8);
  });

  it('never makes a flake darker than the sheet, and makes one in twenty brighter', () => {
    const big = flakeTile(128, 8);
    let brighter = 0;
    for (let at = 0; at < big.detail.length; at += 4) {
      // Shade: 127 or 128 leaves the colour as it is.
      expect(big.detail[at]!).toBeGreaterThanOrEqual(127);
      if (big.detail[at]! > 130) brighter += 1;
      // All equally smooth: a smoother flake would mirror one spot of the room and mostly show dark.
      expect(big.detail[at + 1]!).toBeGreaterThanOrEqual(229);
    }
    const share = brighter / (big.detail.length / 4);
    expect(share).toBeGreaterThan(0.01);
    expect(share).toBeLessThan(0.12);
  });

  it('wraps without a seam in its film', () => {
    const { inside, across } = seam(tile.thickness, SIZE, SIZE, 4, 1);
    expect(across).toBeLessThanOrEqual(inside * 2 + 1);
  });
});

describe('page edges', () => {
  const pages = pagesTile(128, 16, 2);

  it('stacks sheets along u in a warm paper tone', () => {
    expect(pages.sheets).toBe(32);
    expect(pages.color.length).toBe(128 * 16 * 4);
    expectUnitNormals(pages.normal);
    let red = 0;
    let blue = 0;
    for (let at = 0; at < pages.color.length; at += 4) {
      red += pages.color[at]!;
      blue += pages.color[at + 2]!;
    }
    expect(red).toBeGreaterThan(blue * 1.05);
    // Bright paper, not grey card.
    expect(red / (pages.color.length / 4)).toBeGreaterThan(215);
    // Lines run along v: colour changes far more across the sheets than along them.
    let acrossSheets = 0;
    let alongSheets = 0;
    for (let y = 0; y < 15; y += 1) {
      for (let x = 0; x < 127; x += 1) {
        const at = (y * 128 + x) * 4;
        acrossSheets += Math.abs(pages.color[at]! - pages.color[at + 4]!);
        alongSheets += Math.abs(pages.color[at]! - pages.color[at + 128 * 4]!);
      }
    }
    expect(acrossSheets).toBeGreaterThan(alongSheets * 3);
  });

  it('wraps and repeats', () => {
    expect(Array.from(pagesTile(128, 16, 2).color)).toEqual(Array.from(pages.color));
    const { inside, across } = seam(pages.color, 128, 16, 4, 0);
    expect(across).toBeLessThanOrEqual(inside * 2 + 1);
  });
});

describe('wood', () => {
  const oak = woodTile(SIZE, { light: [0.72, 0.55, 0.34], dark: [0.42, 0.27, 0.13], seed: 3 });

  it('stays between its two colours, with unit normals', () => {
    for (let at = 0; at < oak.color.length; at += 4) {
      expect(oak.color[at]!).toBeGreaterThanOrEqual(Math.round(0.42 * 255));
      expect(oak.color[at]!).toBeLessThanOrEqual(Math.round(0.72 * 255));
    }
    expectUnitNormals(oak.normal);
    expect(Array.from(woodTile(SIZE, { light: [0.72, 0.55, 0.34], dark: [0.42, 0.27, 0.13], seed: 3 }).color)).toEqual(Array.from(oak.color));
  });

  it('runs its grain along u and wraps', () => {
    let alongGrain = 0;
    let acrossGrain = 0;
    for (let y = 0; y < SIZE - 1; y += 1) {
      for (let x = 0; x < SIZE - 1; x += 1) {
        const at = (y * SIZE + x) * 4;
        alongGrain += Math.abs(oak.color[at]! - oak.color[at + 4]!);
        acrossGrain += Math.abs(oak.color[at]! - oak.color[at + SIZE * 4]!);
      }
    }
    expect(acrossGrain).toBeGreaterThan(alongGrain * 1.5);
    const { inside, across } = seam(oak.color, SIZE, SIZE, 4, 0);
    expect(across).toBeLessThanOrEqual(inside * 2 + 1);
  });
});
