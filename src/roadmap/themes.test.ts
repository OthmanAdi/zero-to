// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SURFACE_KINDS } from '../scene/palette';
import { DEFAULT_THEME, THEMES, kelvinToHex, resolveTheme, signpostFor, surfacesFor } from './themes';

describe('map themes', () => {
  it('lists the four themes the schema documents, each with real surfaces', () => {
    expect(THEMES.map((theme) => theme.id)).toEqual(['classic-topo', 'alpine-winter', 'desert-expedition', 'coastal-survey']);
    for (const theme of THEMES) {
      expect(theme.surfaces.length).toBeGreaterThan(1);
      for (const surface of theme.surfaces) expect(SURFACE_KINDS).toContain(surface);
    }
  });

  it('falls back to the default theme', () => {
    expect(resolveTheme(undefined).id).toBe(DEFAULT_THEME);
    expect(resolveTheme('no-such-theme').id).toBe(DEFAULT_THEME);
    expect(resolveTheme('alpine-winter').signpost).toBe('snow-pole');
  });

  it('chooses the signpost from the checkpoint, then the map, then the theme', () => {
    expect(signpostFor('summit-flag', 'cairn', 'alpine-winter')).toBe('summit-flag');
    expect(signpostFor(undefined, 'cairn', 'alpine-winter')).toBe('cairn');
    expect(signpostFor(undefined, undefined, 'alpine-winter')).toBe('snow-pole');
    expect(signpostFor(undefined, undefined, undefined)).toBe('timber');
  });

  it('uses the roadmap surfaces unless they are auto or missing', () => {
    expect(surfacesFor(['sand', 'rock'], 'alpine-winter')).toEqual(['sand', 'rock']);
    expect(surfacesFor('auto', 'desert-expedition')).toEqual(['sand', 'dirt', 'rock']);
    expect(surfacesFor(undefined, undefined)).toEqual(resolveTheme(undefined).surfaces);
  });

  it('turns lamp temperatures into warm to cool colours', () => {
    expect(kelvinToHex(6600)).toMatch(/^#ff[ef][0-9a-f]f[0-9a-f]$/);
    const warm = Number.parseInt(kelvinToHex(2500).slice(5, 7), 16);
    const cool = Number.parseInt(kelvinToHex(4200).slice(5, 7), 16);
    expect(warm).toBeLessThan(cool);
  });

  it('matches the skill documentation row by row', () => {
    const doc = readFileSync(join(import.meta.dirname, '../../.agents/skills/zero-to/references/map-and-assets.md'), 'utf8');
    for (const theme of THEMES) {
      const row = doc.split(/\r?\n/).find((line) => line.startsWith(`| \`${theme.id}\` |`));
      expect(row, theme.id).toBeDefined();
      expect(row).toContain(`Ground ${theme.surfaces.join(', ')}.`);
      expect(row).toContain(`Signposts \`${theme.signpost}\`.`);
      expect(row).toContain(`${theme.lampKelvin} K`);
    }
  });
});
