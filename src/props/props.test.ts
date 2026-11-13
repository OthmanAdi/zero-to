import { describe, expect, it } from 'vitest';
import { THEME } from '../look/theme';
import { SURFACE_KINDS } from '../scene/palette';
import { artSheetSpec, deckleFor, resolutionFor } from './art';
import { playDrawing } from './brush';
import { PROPS, PROP_SURFACES, allProps, isPropSurface, propById, propsFor } from './registry';
import { MAX_SCENERY, NEAR_LEAD, sceneryFor } from './scenery';
import { allDrawings, baseColor, recordingContext, themeColors } from './testing';

describe('the prop registry', () => {
  it('covers the eight ground surfaces, the sky and the camp', () => {
    expect([...PROP_SURFACES].sort()).toEqual([...SURFACE_KINDS, 'sky', 'camp'].sort());
    expect(Object.keys(PROPS).sort()).toEqual([...PROP_SURFACES].sort());
  });

  it('has at least two props for every surface', () => {
    for (const surface of PROP_SURFACES) expect(PROPS[surface].length, surface).toBeGreaterThanOrEqual(2);
  });

  it('holds at least 24 drawings, each with its own id and a sane size', () => {
    const arts = allProps();
    expect(arts.length).toBeGreaterThanOrEqual(24);
    expect(new Set(arts.map((art) => art.id)).size).toBe(arts.length);
    for (const art of arts) {
      expect(art.id).toBe(`${art.surface}/${art.name}`);
      expect(art.size.width, art.id).toBeGreaterThan(0.1);
      expect(art.size.height, art.id).toBeGreaterThan(0.1);
      expect(art.size.width, art.id).toBeLessThanOrEqual(2.4);
      expect(art.size.height, art.id).toBeLessThanOrEqual(1.6);
      expect(art.soft, art.id).toBeGreaterThan(0);
      expect(art.weight, art.id).toBeGreaterThan(0);
      expect(art.sway, art.id).toBeLessThanOrEqual(0.014);
      expect(propById(art.id)).toBe(art);
    }
  });

  it('keeps lakes flat and hangs the sky on wires', () => {
    expect(propById('water/tarn')?.pose).toBe('tip');
    for (const art of PROPS.sky) expect(art.pose, art.id).toBe('hang');
    for (const surface of SURFACE_KINDS) expect(PROPS[surface].some((art) => art.pose === 'stand'), surface).toBe(true);
  });

  it('answers an unknown surface with grass instead of failing', () => {
    expect(propsFor('lava')).toBe(PROPS.grass);
    expect(propsFor('snow')).toBe(PROPS.snow);
    expect(isPropSurface('camp')).toBe(true);
    expect(isPropSurface('lava')).toBe(false);
  });

  it('gives small props more pixels and thin sheets a finer cut', () => {
    expect(resolutionFor(0.3)).toBeGreaterThan(resolutionFor(2));
    expect(resolutionFor(0.3, true)).toBeLessThan(resolutionFor(0.3));
    expect(deckleFor(0.05, 1.3)).toBeLessThan(deckleFor(1, 1));
    const spec = artSheetSpec(propById('forest/spruce')!, { scale: 1.2 });
    expect(spec.width).toBeCloseTo(0.42 * 1.2);
    expect(spec.standing).toBe(true);
  });
});

describe('every drawing', () => {
  const allowed = themeColors(THEME);

  it('uses no colour outside the theme', () => {
    const drawings = allDrawings();
    expect(drawings.length).toBeGreaterThan(60);
    for (const drawing of drawings) {
      const record = recordingContext();
      playDrawing(drawing.draw, record.ctx, drawing.width, drawing.height, false);
      expect(record.colors.size, drawing.name).toBeGreaterThan(0);
      for (const color of record.colors) {
        const base = baseColor(color);
        expect(base, `${drawing.name} uses ${color}`).not.toBeNull();
        expect(allowed.has(base as string), `${drawing.name} uses ${color}`).toBe(true);
      }
    }
  });

  it('cuts at least one piece of paper, and cuts it in white', () => {
    for (const drawing of allDrawings()) {
      const record = recordingContext();
      playDrawing(drawing.draw, record.ctx, drawing.width, drawing.height, true);
      expect(record.marks.fills, drawing.name).toBeGreaterThan(0);
      expect([...record.colors], drawing.name).toEqual(['#fff']);
      expect(record.texts, drawing.name).toEqual([]);
    }
  });

  it('keeps the route colour for things that mark the route', () => {
    const signal = new Set([baseColor(THEME.signal), baseColor(THEME.signalDeep)]);
    const mayUseSignal = /^(signpost\/blaze-post|signpost\/snow-pole|station\/card-stages|station\/card-pace)$/;
    for (const drawing of allDrawings()) {
      const record = recordingContext();
      playDrawing(drawing.draw, record.ctx, drawing.width, drawing.height, false);
      const uses = [...record.colors].some((color) => signal.has(baseColor(color)));
      if (uses) expect(mayUseSignal.test(drawing.name), `${drawing.name} uses the route colour`).toBe(true);
    }
  });

  it('keeps tier colours for painted waymarks', () => {
    const tiers = new Set(Object.values(THEME.tier).map((color) => baseColor(color)));
    const mayUseTier = /^(board\/|station\/peak-)/;
    for (const drawing of allDrawings()) {
      const record = recordingContext();
      playDrawing(drawing.draw, record.ctx, drawing.width, drawing.height, false);
      const uses = [...record.colors].some((color) => tiers.has(baseColor(color)));
      if (uses) expect(mayUseTier.test(drawing.name), `${drawing.name} uses a tier colour`).toBe(true);
    }
  });
});

describe('sceneryFor', () => {
  it('is the same for the same surface, seed and count', () => {
    for (const surface of PROP_SURFACES) {
      const a = sceneryFor(surface, 'roadmap-1/stage-2', 9);
      const b = sceneryFor(surface, 'roadmap-1/stage-2', 9);
      expect(a.map((item) => [item.art.id, item.x, item.z, item.scale, item.flip, item.seed, item.trigger])).toEqual(
        b.map((item) => [item.art.id, item.x, item.z, item.scale, item.flip, item.seed, item.trigger]),
      );
    }
  });

  it('changes with the seed', () => {
    const a = sceneryFor('forest', 'one', 9).map((item) => `${item.art.id}@${item.x.toFixed(3)}`);
    const b = sceneryFor('forest', 'two', 9).map((item) => `${item.art.id}@${item.x.toFixed(3)}`);
    expect(a).not.toEqual(b);
  });

  it('returns the count asked for, up to the cap, and nothing for nothing', () => {
    expect(sceneryFor('grass', 1, 0)).toEqual([]);
    expect(sceneryFor('grass', 1, -3)).toEqual([]);
    expect(sceneryFor('grass', 1, Number.NaN)).toEqual([]);
    for (const count of [1, 2, 5, 12]) expect(sceneryFor('rock', 7, count)).toHaveLength(count);
    expect(sceneryFor('rock', 7, 500)).toHaveLength(MAX_SCENERY);
  });

  it('places every prop inside the panel, sorted from the back to the front', () => {
    for (const surface of PROP_SURFACES) {
      const items = sceneryFor(surface, 42, 12);
      for (const item of items) {
        expect(item.x, item.art.id).toBeGreaterThanOrEqual(0);
        expect(item.x, item.art.id).toBeLessThanOrEqual(1);
        expect(item.z, item.art.id).toBeGreaterThanOrEqual(0);
        expect(item.z, item.art.id).toBeLessThanOrEqual(1);
        expect(item.scale).toBeGreaterThanOrEqual(0.86);
        expect(item.scale).toBeLessThanOrEqual(1.14);
        if (item.flip) expect(item.art.mirror, item.art.id).toBe(true);
      }
      expect(items.map((item) => item.z)).toEqual([...items.map((item) => item.z)].sort((a, b) => a - b));
    }
  });

  it('draws only from the surface asked for and the sky', () => {
    for (const surface of SURFACE_KINDS) {
      for (const item of sceneryFor(surface, 'seed', 12)) expect(['sky', surface], item.art.id).toContain(item.art.surface);
    }
    for (const item of sceneryFor('lava', 'seed', 6)) expect(['sky', 'grass']).toContain(item.art.surface);
  });

  it('puts one skyline at the back where the surface has one, and something in the sky', () => {
    for (const surface of ['forest', 'rock', 'snow', 'sand'] as const) {
      const items = sceneryFor(surface, 'skyline', 9);
      const skylines = items.filter((item) => item.art.layer === 'back' && item.art.pose !== 'hang');
      expect(skylines, surface).toHaveLength(1);
      expect(skylines[0]?.z).toBeLessThanOrEqual(0.12);
      expect(skylines[0]?.trigger.kind).toBe('fraction');
      expect(items.some((item) => item.art.surface === 'sky'), surface).toBe(true);
    }
    expect(sceneryFor('forest', 'skyline', 2).every((item) => item.art.layer !== 'back')).toBe(true);
  });

  it('stands a wide drawing only once on a panel', () => {
    for (const surface of PROP_SURFACES) {
      for (const seed of ['a', 'b', 'c', 'd']) {
        const wide = sceneryFor(surface, seed, 12)
          .filter((item) => item.art.size.width >= 1 && item.art.surface !== 'sky')
          .map((item) => item.art.id);
        expect(new Set(wide).size, `${surface} ${seed}: ${wide.join(', ')}`).toBe(wide.length);
      }
    }
  });

  it('stands front props up as the walker nears', () => {
    const items = sceneryFor('grass', 'near', 12);
    const near = items.filter((item) => item.trigger.kind === 'near');
    expect(near.length).toBeGreaterThan(0);
    for (const item of near) expect(item.trigger).toEqual({ kind: 'near', lead: NEAR_LEAD });
    expect(NEAR_LEAD).toBeCloseTo(1.3 * (7 / 12), 2);
  });
});
