import { describe, expect, it } from 'vitest';
import { SURFACE_KINDS, type SurfaceKind } from '../scene/palette';
import { TERRAIN_TEMPLATES, TRAIL_TEMPLATES, describeTerrain, describeTrail } from './catalogue';
import { levelHeights } from './contours';
import { TERRAIN_TEMPLATE_IDS } from './heightfield';
import { assignSurfaces, isSurfaceKind } from './surfaces';
import { TRAIL_TEMPLATE_IDS } from './trail';

const levels = (count: number): { height: number }[] => levelHeights(count).map((height) => ({ height }));
const AUTO_ORDER: SurfaceKind[] = ['water', 'sand', 'grass', 'forest', 'dirt', 'scree', 'rock', 'snow'];

describe('assignSurfaces', () => {
  it('gives every band a surface', () => {
    for (const count of [1, 2, 5, 12, 24, 28]) {
      const surfaces = assignSurfaces(levels(count), 'auto', 'seed');
      expect(surfaces.length).toBe(count);
      for (const surface of surfaces) expect(SURFACE_KINDS).toContain(surface);
    }
    expect(assignSurfaces([], 'auto', 1)).toEqual([]);
  });

  it('orders auto surfaces believably from the foot to the top', () => {
    for (const template of TERRAIN_TEMPLATE_IDS) {
      for (const seed of [1, 'two', 3]) {
        const surfaces = assignSurfaces(levels(24), 'auto', seed, { template });
        const ranks = surfaces.map((surface) => AUTO_ORDER.indexOf(surface));
        for (let i = 1; i < ranks.length; i += 1) expect(ranks[i] as number).toBeGreaterThanOrEqual(ranks[i - 1] as number);
        expect(surfaces[surfaces.length - 1]).toBe('snow');
        expect(new Set(surfaces).size).toBeGreaterThanOrEqual(6);
      }
    }
  });

  it('puts water or sand at the base only where the shape suits it', () => {
    expect(assignSurfaces(levels(20), 'auto', 1, { template: 'canyon' })[0]).toBe('water');
    expect(assignSurfaces(levels(20), 'auto', 1, { template: 'volcano' })[0]).toBe('water');
    expect(assignSurfaces(levels(20), 'auto', 1, { template: 'plateau' })[0]).toBe('sand');
    expect(assignSurfaces(levels(20), 'auto', 1, { template: 'ridge' })[0]).toBe('grass');
    expect(assignSurfaces(levels(20), 'auto', 1)[0]).toBe('grass');
    expect(assignSurfaces(levels(20), 'auto', 1, { template: 'canyon' }).filter((s) => s === 'water').length).toBe(1);
  });

  it('shares a chosen list out over the bands in the order given', () => {
    const surfaces = assignSurfaces(levels(12), ['grass', 'dirt', 'rock', 'snow'], 'x');
    expect(surfaces).toEqual(['grass', 'grass', 'grass', 'dirt', 'dirt', 'dirt', 'rock', 'rock', 'rock', 'snow', 'snow', 'snow']);
    expect(assignSurfaces(levels(3), ['sand'], 'x')).toEqual(['sand', 'sand', 'sand']);
    expect(assignSurfaces(levels(2), ['grass', 'dirt', 'rock', 'snow'], 'x')).toEqual(['grass', 'rock']);
  });

  it('ignores unknown names and falls back to auto when nothing is left', () => {
    expect(assignSurfaces(levels(4), ['lava' as never, 'rock'], 'x')).toEqual(['rock', 'rock', 'rock', 'rock']);
    expect(assignSurfaces(levels(6), ['lava' as never], 's')).toEqual(assignSurfaces(levels(6), 'auto', 's'));
    expect(isSurfaceKind('snow')).toBe(true);
    expect(isSurfaceKind('lava')).toBe(false);
  });

  it('is the same for the same seed and moves the belts between seeds', () => {
    expect(assignSurfaces(levels(24), 'auto', 'a')).toEqual(assignSurfaces(levels(24), 'auto', 'a'));
    const variants = new Set<string>();
    for (let seed = 0; seed < 30; seed += 1) variants.add(assignSurfaces(levels(28), 'auto', seed).join(','));
    expect(variants.size).toBeGreaterThan(1);
  });
});

describe('catalogue', () => {
  it('lists every template once with a name and a one-line description', () => {
    expect(TERRAIN_TEMPLATES.map((entry) => entry.id).sort()).toEqual([...TERRAIN_TEMPLATE_IDS].sort());
    expect(TRAIL_TEMPLATES.map((entry) => entry.id).sort()).toEqual([...TRAIL_TEMPLATE_IDS].sort());
    for (const entry of [...TERRAIN_TEMPLATES, ...TRAIL_TEMPLATES]) {
      expect(entry.name.length).toBeGreaterThan(2);
      expect(entry.description.length).toBeGreaterThan(20);
      expect(entry.description.length).toBeLessThan(110);
      expect(entry.description).not.toContain('\n');
      expect(entry.description.endsWith('.')).toBe(true);
    }
  });

  it('describes a terrain in plain words', () => {
    expect(describeTerrain({ seed: 1, template: 'volcano' })).toBe(
      'Volcano. One cone with a crater on top. The summit is the highest point of the rim. Uneven ground.',
    );
    expect(describeTerrain({ seed: 1, template: 'plateau', roughness: 0 })).toContain('Smooth ground.');
    expect(describeTerrain({ seed: 1, template: 'plateau', roughness: 1 })).toContain('Very rough');
    const random = describeTerrain({ seed: 'rust', template: 'random' });
    expect(random).toContain('Picked by the seed.');
    expect(random).toBe(describeTerrain({ seed: 'rust', template: 'random' }));
  });

  it('describes a trail in plain words', () => {
    expect(describeTrail({ seed: 1, template: 'spiral', stops: 6 })).toBe(
      'Spiral. Winds round the whole mountain, so every side is seen on the way up. A gate, the summit and 4 camps between.',
    );
    expect(describeTrail({ seed: 1, template: 'traverse', stops: 2 })).toContain('no camps between');
    expect(describeTrail({ seed: 1, template: 'traverse', stops: 3 })).toContain('1 camp between');
    expect(describeTrail({ seed: 1, template: 'random', stops: 3 })).toContain('Picked by the seed.');
  });
});
