import { describe, expect, it } from 'vitest';
import { bindingFor, contrast, FOIL_READS, FOIL_TITLE_SIZE, LEGIBLE, legibleStamp, luminance } from './kit';

describe('choosing a stamp that can be read', () => {
  it('measures luminance and contrast as WCAG does', () => {
    expect(luminance('#000000')).toBe(0);
    expect(luminance('#ffffff')).toBeCloseTo(1, 6);
    expect(luminance('#fff')).toBeCloseTo(1, 6);
    expect(contrast('#000', '#fff')).toBeCloseTo(21, 6);
    expect(contrast('#777', '#777')).toBeCloseTo(1, 6);
  });

  it('keeps gold on a dark cloth and gives it up on ochre and bone', () => {
    expect(legibleStamp('gold', '#1f1e1b')).toBe('gold');
    expect(legibleStamp('gold', '#40533a')).toBe('gold');
    expect(legibleStamp('gold', '#c9982f')).toBe('ink');
    expect(legibleStamp('gold', '#e4dccb')).toBe('ink');
  });

  it('does not put copper on rust, and finds a foil that reads instead', () => {
    expect(legibleStamp('copper', '#a4442a')).not.toBe('copper');
    expect(['gold', 'silver']).toContain(legibleStamp('copper', '#a4442a'));
  });

  it('never chooses a blind stamp for anyone', () => {
    for (const cloth of ['#1f1e1b', '#e4dccb', '#a4442a', '#40533a', '#4b2b3e', '#c9982f', '#45515d', '#1f5a5c']) {
      expect(legibleStamp('blind', cloth)).not.toBe('blind');
    }
  });

  it('leaves a stamp the person chose alone', () => {
    const item = { id: 'a', title: 'A', seed: 7, stamp: 'blind', binding: 'cloth' };
    expect(bindingFor(item, '#e4dccb')).toEqual({ binding: 'cloth', stamp: 'blind' });
    expect(bindingFor({ ...item, stamp: 'gold' }, '#e4dccb', { titleSize: 9, contrastMore: true })).toEqual({ binding: 'cloth', stamp: 'gold' });
  });

  it('asks 4.5 to 1 of a foil, by how the foil reads on the shelf', () => {
    expect(LEGIBLE).toBe(4.5);
    // Every cloth of the four looks: whatever foil is chosen for the person holds the mark, else it is ink.
    const cloths = ['#1f1e1b', '#1f5a5c', '#a4442a', '#45515d', '#e4dccb', '#40533a', '#4b2b3e', '#c9982f', '#17484a', '#7d3120', '#36424e', '#33452e', '#154143', '#6c2716', '#313b46', '#ebe4d4', '#2a3825', '#44263a', '#f0d27e', '#1d4ed8', '#ef5b3a', '#8fa6b8', '#f1e6c8', '#1f7a52', '#7b3fa0', '#ffc531', '#23252b'];
    for (const cloth of cloths) {
      for (const first of ['gold', 'silver', 'copper', 'holo', 'blind'] as const) {
        const stamp = legibleStamp(first, cloth);
        if (stamp !== 'ink') expect(contrast(FOIL_READS[stamp as 'gold'], cloth)).toBeGreaterThanOrEqual(4.5);
      }
    }
    // Gold stays on the dark cloths a binder would put it on, and leaves rust to silver.
    expect(legibleStamp('gold', '#4b2b3e')).toBe('gold');
    expect(legibleStamp('gold', '#45515d')).toBe('gold');
    expect(legibleStamp('gold', '#a4442a')).toBe('silver');
    // A foil is a light on a dark ground: none is chosen for a pale cloth.
    for (const pale of ['#e4dccb', '#f1e6c8', '#ffc531', '#8fa6b8']) expect(legibleStamp('silver', pale)).toBe('ink');
  });

  it('prints a title too small for foil, and every title for a person who asked for more contrast', () => {
    expect(FOIL_TITLE_SIZE).toBe(14);
    expect(legibleStamp('gold', '#1f1e1b', { titleSize: 13.9 })).toBe('ink');
    expect(legibleStamp('gold', '#1f1e1b', { titleSize: 14 })).toBe('gold');
    expect(legibleStamp('silver', '#1f1e1b', { titleSize: 24, contrastMore: true })).toBe('ink');
    const item = { id: 'a', title: 'A', seed: 16619 };
    expect(bindingFor(item, '#1f1e1b', { titleSize: 10.1 }).stamp).toBe('ink');
    expect(bindingFor(item, '#1f1e1b', { contrastMore: true }).stamp).toBe('ink');
  });

  it('falls back on the stamp that reads best when not even ink reaches the mark', () => {
    // A look that prints a dim ink on a dark cloth: a foil that reads better than that ink is kept.
    expect(legibleStamp('copper', '#8a5a3c', { ink: '#a08a6a' })).not.toBe('ink');
    expect(legibleStamp('copper', '#8fa6b8', { ink: '#14202b' })).toBe('ink');
    expect(legibleStamp('gold', '#c9982f', { ink: '#211c12' })).toBe('ink');
  });

  it('binds a Pocket Paperback in paper or gloss unless the person chose its binding', () => {
    for (let seed = 1; seed < 400; seed += 7) {
      expect(['paper', 'gloss']).toContain(bindingFor({ id: 'a', title: 'A', seed }, '#ef5b3a', { look: 'pocket' }).binding);
    }
    expect(bindingFor({ id: 'a', title: 'A', seed: 7, binding: 'velvet' }, '#ef5b3a', { look: 'pocket' }).binding).toBe('velvet');
  });

  it('prints the title of a metal or holographic board, which the material lays down dark', () => {
    let boards = 0;
    for (let seed = 1; seed < 4000 && boards < 12; seed += 1) {
      const dress = bindingFor({ id: 'a', title: 'A', seed }, '#1f1e1b');
      if (dress.binding !== 'foil' && dress.binding !== 'holo') continue;
      boards += 1;
      expect(dress.stamp).toBe('ink');
    }
    expect(boards).toBeGreaterThan(0);
    expect(bindingFor({ id: 'a', title: 'A', seed: 3, binding: 'holo', stamp: 'copper' }, '#1f1e1b').stamp).toBe('copper');
    expect(bindingFor({ id: 'a', title: 'A', seed: 3, binding: 'holo' }).stamp).toBe('ink');
  });

  it('gives the same volume the same dress on every visit', () => {
    const item = { id: 'a', title: 'A', seed: 1234 };
    expect(bindingFor(item, '#1f5a5c')).toEqual(bindingFor(item, '#1f5a5c'));
  });
});
