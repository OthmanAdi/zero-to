import { describe, expect, it } from 'vitest';
import { BINDINGS, STAMPS } from '../types';
import { softBoxFalloff, STUDIO_LAMPS } from './environment';
import { BINDING_RECIPES, FILM, RUB_REACH, STAMP_FILM, STAMP_RECIPES, nearness, reliefAt, rubOf, stampAt, sunLift, useOf } from './recipes';
import { patchFragmentShader } from './shader';

describe('binding recipes', () => {
  it('has one for every binding, with values a physical material accepts', () => {
    for (const binding of BINDINGS) {
      const recipe = BINDING_RECIPES[binding];
      expect(recipe.span).toBeGreaterThan(0);
      for (const value of [recipe.roughness, recipe.metalness, recipe.sheen, recipe.sheenLift, recipe.clearcoat, recipe.clearcoatRoughness, recipe.anisotropy, recipe.iridescence, recipe.shade, recipe.pastel]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
      expect(recipe.lift).toBeGreaterThan(0);
      expect(recipe.lift).toBeLessThanOrEqual(1);
    }
  });

  it('keeps the bindings apart: fabric glows, laminate is coated, foil is metal', () => {
    expect(BINDING_RECIPES.cloth.sheen).toBeGreaterThan(BINDING_RECIPES.linen.sheen);
    expect(BINDING_RECIPES.velvet.sheen).toBe(1);
    expect(BINDING_RECIPES.velvet.roughness).toBe(1);
    expect(BINDING_RECIPES.paper.sheen).toBe(0);
    // A clear film over a matt print: the film mirrors the lamps, the print underneath does not.
    expect(BINDING_RECIPES.gloss.clearcoat).toBeGreaterThanOrEqual(0.7);
    expect(BINDING_RECIPES.gloss.clearcoat).toBeLessThan(1);
    expect(BINDING_RECIPES.gloss.clearcoatRoughness).toBeLessThan(0.1);
    expect(BINDING_RECIPES.gloss.roughness).toBeGreaterThan(0.5);
    expect(BINDING_RECIPES.leather.clearcoat).toBeGreaterThan(0);
    expect(BINDING_RECIPES.foil.metalness).toBe(1);
    expect(BINDING_RECIPES.foil.anisotropy).toBeGreaterThan(0);
    expect(FILM.thickness[1]).toBeGreaterThan(FILM.thickness[0]);
  });

  it('keeps holographic foil a pale film that turns a quarter of its colours over a tilt of 7 degrees', () => {
    const holo = BINDING_RECIPES.holo;
    expect(holo.iridescence).toBeGreaterThan(0.4);
    expect(holo.iridescence).toBeLessThan(0.8);
    expect(holo.pastel).toBeGreaterThanOrEqual(0.8);
    expect(holo.normalScale).toBeLessThanOrEqual(0.4);
    // One run of colours is half a wavelength of green light inside the film.
    const cycle = 550 / (2 * FILM.ior);
    // A tilt of 7 degrees turns the mirrored direction by 14.
    const moved = holo.filmShift * Math.sin((14 * Math.PI) / 180);
    expect(moved / cycle).toBeGreaterThan(0.2);
    expect(moved / cycle).toBeLessThan(0.3);
    expect((STAMP_FILM.shift * Math.sin((14 * Math.PI) / 180)) / cycle).toBeGreaterThan(0.2);
    // Across a board the film drifts by less than one run of colours: no bands of oil.
    expect(FILM.thickness[1] - FILM.thickness[0]).toBeLessThan(cycle);
    expect(STAMP_RECIPES.holo.iridescence).toBe(STAMP_FILM.strength);
    expect(STAMP_FILM.strength).toBeLessThan(1);
  });
});

describe('grain', () => {
  it('is lit, not printed: little of a tile is multiplied into the colour', () => {
    for (const binding of ['cloth', 'linen', 'leather', 'paper'] as const) expect(BINDING_RECIPES[binding].shade).toBeLessThanOrEqual(0.4);
  });

  it('draws linen finer than book cloth and leather with a small pebble', () => {
    // Threads to a px on the reference volume: the weave tiles hold a thread to 8 texels (cloth) and 9 (linen),
    // 512 texels to a span.
    const threads = (span: number, texels: number) => 512 / texels / span;
    expect(threads(BINDING_RECIPES.linen.span, 9)).toBeGreaterThan(threads(BINDING_RECIPES.cloth.span, 8));
    // A leather pebble is 12 of 512 texels of the span: under 1.6 px on a volume 340 px tall, about 1 mm.
    expect((BINDING_RECIPES.leather.span * 12) / 512).toBeLessThan(1.6);
    expect(BINDING_RECIPES.leather.clearcoat).toBeLessThanOrEqual(0.12);
  });

  it('is quieter at shelf distance than on a cover shown large', () => {
    expect(nearness(340)).toBe(0);
    // A volume in the row stands 400 to 500 px tall on a desktop.
    expect(nearness(494)).toBe(0);
    expect(nearness(900)).toBe(1);
    expect(nearness(700)).toBeGreaterThan(0.3);
    expect(nearness(700)).toBeLessThan(0.8);
    expect(nearness(340, 1)).toBe(1);
    expect(nearness(900, 0)).toBe(0);
    expect(nearness(340, Number.NaN)).toBe(0);
    expect(reliefAt(0)).toBeLessThan(0.6);
    expect(reliefAt(0)).toBeGreaterThan(0.3);
    expect(reliefAt(1)).toBe(1);
    expect(reliefAt(0.5)).toBeGreaterThan(reliefAt(0.2));
  });
});

describe('stamp recipes', () => {
  it('has one for every stamp', () => {
    for (const stamp of STAMPS) expect(STAMP_RECIPES[stamp]).toBeDefined();
  });

  it('makes foils metal, and leaves blind and ink without metal of their own', () => {
    for (const stamp of ['gold', 'silver', 'copper', 'holo'] as const) {
      const recipe = STAMP_RECIPES[stamp];
      expect(recipe.metalness[0]).toBeGreaterThanOrEqual(0.75);
      expect(recipe.metalnessNear[0]).toBeGreaterThan(recipe.metalness[0]);
      expect(recipe.tint).toBe(1);
      expect(recipe.sheen).toBe(0);
    }
    expect(STAMP_RECIPES.blind.tint).toBe(0);
    expect(STAMP_RECIPES.blind.shade).toBeLessThan(1);
    expect(STAMP_RECIPES.blind.metalness).toEqual([0, 1]);
    expect(STAMP_RECIPES.blind.deboss).toBeGreaterThan(STAMP_RECIPES.gold.deboss);
    expect(STAMP_RECIPES.ink.color).toBe('ink');
    expect(STAMP_RECIPES.ink.metalness).toEqual([0, 0]);
  });
});

describe('a stamp in its bed', () => {
  it('is soft and even at shelf distance, sharp on a cover shown large', () => {
    for (const stamp of ['gold', 'silver', 'copper', 'holo'] as const) {
      const far = stampAt(STAMP_RECIPES[stamp], BINDING_RECIPES.cloth, 0);
      const close = stampAt(STAMP_RECIPES[stamp], BINDING_RECIPES.cloth, 1);
      const rough = (pressed: typeof far) => pressed.roughness[0] + pressed.roughness[1] * BINDING_RECIPES.cloth.roughness;
      expect(rough(far)).toBeGreaterThan(0.3);
      expect(rough(close)).toBeLessThan(0.2);
      expect(far.gain).toBeGreaterThan(close.gain);
      expect(close.gain).toBeGreaterThanOrEqual(1);
      expect(far.metalness[0]).toBeLessThan(close.metalness[0]);
    }
  });

  it('irons leather and velvet flat and leaves a trace of the weave in cloth and linen', () => {
    const flat = (binding: keyof typeof BINDING_RECIPES, near: number) => stampAt(STAMP_RECIPES.gold, BINDING_RECIPES[binding], near).flatten;
    expect(flat('leather', 1)).toBeGreaterThanOrEqual(0.95);
    expect(flat('velvet', 1)).toBeGreaterThanOrEqual(0.95);
    expect(flat('cloth', 1)).toBeLessThan(0.7);
    expect(flat('linen', 1)).toBeLessThan(flat('cloth', 1));
    expect(flat('linen', 1)).toBeGreaterThan(0.4);
    // Far off a thread inside a letter is noise: every bed is nearly flat.
    for (const binding of ['cloth', 'linen', 'leather', 'paper'] as const) expect(flat(binding, 0)).toBeGreaterThanOrEqual(0.9);
    // Printed ink is not pressed at all.
    expect(stampAt(STAMP_RECIPES.ink, BINDING_RECIPES.cloth, 0).flatten).toBeLessThan(0.25);
  });

  it('has a hairline wall for foil and a real step for a blind stamp', () => {
    expect(STAMP_RECIPES.gold.deboss).toBeLessThanOrEqual(0.5);
    expect(STAMP_RECIPES.blind.deboss).toBe(1.7);
    expect(STAMP_RECIPES.ink.wall).toBe(0);
  });
});

describe('wear from use', () => {
  it('leaves a new, unread link crisp', () => {
    expect(useOf()).toEqual({ sun: 0, rub: 0, dull: 0 });
    expect(useOf(0, 0)).toEqual({ sun: 0, rub: 0, dull: 0 });
    expect(useOf(Number.NaN, Number.NaN)).toEqual({ sun: 0, rub: 0, dull: 0 });
    expect(useOf(-3, -40)).toEqual({ sun: 0, rub: 0, dull: 0 });
  });

  it('grows with handling and with the years, and stays within bounds', () => {
    expect(useOf(0.5, 0).rub).toBe(0.5);
    expect(useOf(7, 0).rub).toBe(1);
    expect(useOf(1, 0).dull).toBe(1);
    expect(useOf(0, 0).sun).toBe(0);
    expect(useOf(0, 365).sun).toBeGreaterThan(0.45);
    expect(useOf(0, 365).sun).toBeLessThan(0.55);
    expect(useOf(0, 3650).sun).toBeGreaterThan(useOf(0, 365).sun);
    expect(useOf(0, 1e9).sun).toBeLessThanOrEqual(1);
    // Handling does not fade a spine and time does not rub a corner.
    expect(useOf(1, 0).sun).toBe(0);
    expect(useOf(0, 5000).rub).toBe(0);
    expect(useOf(0.4, 200)).toEqual(useOf(0.4, 200));
  });

  it('widens the rubbed edge from the binder\u2019s width to at most 14 px', () => {
    for (const binding of ['cloth', 'linen', 'leather', 'paper', 'velvet'] as const) {
      const wear = BINDING_RECIPES[binding].wear;
      const fresh = rubOf(wear, 0);
      const worn = rubOf(wear, 1);
      expect(fresh.reach).toBe(wear[0]);
      expect(worn.reach).toBeGreaterThan(fresh.reach);
      expect(worn.reach).toBeLessThanOrEqual(RUB_REACH);
      expect(Math.abs(fresh.amount)).toBeLessThan(Math.abs(worn.amount));
      expect(Math.abs(fresh.amount)).toBeLessThan(0.07);
      expect(Math.abs(worn.amount)).toBeLessThanOrEqual(0.3);
      expect(Math.sign(worn.amount)).toBe(Math.sign(wear[1]));
    }
    expect(RUB_REACH).toBe(14);
    expect(rubOf([0, 0], 1)).toEqual({ reach: 0, amount: 0 });
  });

  it('never fades a spine at the cost of its title', () => {
    // A light title on a dark cloth: the cloth keeps its depth.
    expect(sunLift(1, 0.8, 0.05)).toBe(0);
    expect(sunLift(1, 1, 0.3)).toBe(0);
    // A dark title on a pale cloth: a paler cloth only helps.
    expect(sunLift(1, 0.02, 0.6)).toBeGreaterThan(0);
    expect(sunLift(1, 0.02, 0.6)).toBeLessThanOrEqual(0.08);
    expect(sunLift(0, 0.02, 0.6)).toBe(0);
    expect(sunLift(0.5, 0.02, 0.6)).toBeLessThan(sunLift(1, 0.02, 0.6));
  });
});

describe('binding shader', () => {
  const stock = 'uniform float a;\nvoid main() {\n#include <normal_fragment_maps>\n#include <lights_physical_fragment>\n#include <lights_fragment_maps>\n}';

  it('adds its code after each anchor and keeps the stock shader', () => {
    const patched = patchFragmentShader(stock);
    expect(patched).toContain('uniform sampler2D bbStamp;');
    expect(patched.indexOf('uniform vec4 bbDetail;')).toBeLessThan(patched.indexOf('void main() {'));
    expect(patched.indexOf('bbMask = texture2D')).toBeGreaterThan(patched.indexOf('#include <normal_fragment_maps>'));
    expect(patched.indexOf('material.iridescenceThickness')).toBeGreaterThan(patched.indexOf('#include <lights_physical_fragment>'));
    expect(patched.indexOf('radiance *=')).toBeGreaterThan(patched.indexOf('#include <lights_fragment_maps>'));
    // Without the place where the room is read, the rest still goes in.
    expect(patchFragmentShader(stock.replace('#include <lights_fragment_maps>\n', ''))).toContain('uniform sampler2D bbStamp;');
    for (const uniform of ['bbFoil', 'bbCloth', 'bbUse', 'bbRub']) expect(patched).toContain(`${uniform};`);
    // The highlight is spread where the relief is finer than a pixel.
    expect(patched).toMatch(/dFdx\( normal \)/);
    for (const line of stock.split('\n')) expect(patched).toContain(line);
  });

  it('leaves a shader alone when an anchor is missing', () => {
    const other = stock.replace('#include <normal_fragment_maps>', '');
    expect(patchFragmentShader(other)).toBe(other);
  });
});

describe('studio lamps', () => {
  it('fall off to nothing at the rim and are full in the middle', () => {
    expect(softBoxFalloff(0.5, 0.5, 0.5)).toBe(1);
    expect(softBoxFalloff(0, 0.5, 0.5)).toBe(0);
    expect(softBoxFalloff(0.5, 1, 0.5)).toBe(0);
    expect(softBoxFalloff(0.1, 0.5, 0.5)).toBeGreaterThan(0);
    expect(softBoxFalloff(0.1, 0.5, 0.5)).toBeLessThan(1);
    expect(softBoxFalloff(0.02, 0.5, 0)).toBe(1);
  });

  it('put a warm key on the left and a weaker cool fill on the right, both in front', () => {
    const [key, fill] = STUDIO_LAMPS;
    expect(key!.position[0]).toBeLessThan(0);
    expect(fill!.position[0]).toBeGreaterThan(0);
    expect(key!.position[2]).toBeGreaterThan(0);
    expect(key!.color[0]).toBeGreaterThan(key!.color[2]);
    expect(fill!.color[2]).toBeGreaterThan(fill!.color[0]);
    expect(key!.intensity).toBeGreaterThan(fill!.intensity);
  });
});
