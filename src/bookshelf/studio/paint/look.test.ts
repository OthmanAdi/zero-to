import { describe, expect, it } from 'vitest';
import { css, mix, parseColour, type Rgba } from './colour';
import { paletteOf, rulesOf, type LookInput } from './look';
import { stampInk } from './stamp';

const rgb = (text: string): Rgba => parseColour(text)!;

const PAPER = rulesOf({ name: 'paper', spineMark: false });
const POCKET = rulesOf({ name: 'pocket', spineMark: true });
const OAK = rulesOf({ name: 'oak', spineMark: false });

function input(name: string, colours: Partial<LookInput> = {}): LookInput {
  return {
    name,
    clothName: 'rust',
    cloth: rgb('#7d3120'),
    ink: rgb('#f8eedf'),
    art: rgb('#f2c9a0'),
    foil: [rgb('#f6e4a9'), rgb('#dcb969'), rgb('#f9edc4')],
    paper: rgb('#f1ead9'),
    paperInk: rgb('#24211c'),
    spineMark: false,
    coverMark: false,
    serif: 'serif',
    mono: 'monospace',
    spineTitle: { family: 'serif', weight: '600', letterSpacing: 0.012, upper: false },
    ...colours,
  };
}

describe('palette', () => {
  it('paints what the stylesheet paints under the ink stamp', () => {
    const paper = paletteOf(input('paper'), PAPER, 'cloth', 'ink');
    expect(paper.lettering).toBe('#f8eedf');
    expect(paper.coverTitle).toBe('#f8eedf');
    expect(paper.art1).toBe('#f2c9a0');
    expect(paper.art2).toBe(css(mix(rgb('#f2c9a0'), rgb('#f8eedf'), 0.55)));
    expect(paper.device).toBe('#f2c9a0');
    expect(paper.bandAlpha).toBe(0.55);
  });

  it('letters Oak Library in its foil and presses its drawing into the cloth', () => {
    const oak = paletteOf(input('oak'), OAK, 'cloth', 'ink');
    expect(oak.lettering).toBe('#dcb969');
    expect(oak.frame).toBe('#dcb969');
    expect(oak.art1).toBe(css(mix(rgb('#7d3120'), rgb('#000'), 0.7)));
    // A printed binding keeps the drawing in full ink.
    expect(paletteOf(input('oak'), OAK, 'paper', 'ink').art1).toBe('#f2c9a0');
    expect(paletteOf(input('oak'), OAK, 'foil', 'ink').art1).toBe('#f2c9a0');
  });

  it('repaints only the stamped parts in the stamp’s ink', () => {
    const gold = paletteOf(input('paper'), PAPER, 'cloth', 'gold');
    const foil = stampInk('gold', '#7d3120', '#f8eedf');
    expect(gold.lettering).toBe(foil);
    expect(gold.coverTitle).toBe(foil);
    expect(gold.band).toBe(foil);
    expect(gold.bandAlpha).toBe(1);
    expect(gold.device).toBe(foil);
    expect(gold.frame).toBe(foil);
    expect(gold.art1).toBe('#f2c9a0');
    expect(gold.paperInk).toBe('#24211c');
    expect(gold.spinePaperInk).toBe('#2a2620');
    const blind = paletteOf(input('paper'), PAPER, 'cloth', 'blind');
    expect(blind.lettering).toBe(stampInk('blind', '#7d3120', '#f8eedf'));
  });

  it('blocks a band in foil only where the look does', () => {
    expect(paletteOf(input('oak'), OAK, 'cloth', 'silver').bandPanel).toBe(stampInk('silver', '#7d3120', '#dcb969'));
    expect(paletteOf(input('paper'), PAPER, 'cloth', 'silver').bandPanel).toBe('#f2c9a0');
  });

  it('prints the Pocket number reversed out of a block', () => {
    const pocket = paletteOf(input('pocket', { spineMark: true }), POCKET, 'paper', 'ink');
    expect(pocket.markBlock).toBe('#f8eedf');
    expect(pocket.markInk).toBe('#7d3120');
  });
});

describe('look rules', () => {
  it('turns only the Paper Row spine title and keeps bands off paperbacks', () => {
    expect(PAPER.turned).toBe(true);
    expect(OAK.turned).toBe(false);
    expect(rulesOf({ name: 'night', spineMark: false }).turned).toBe(false);
    expect(POCKET.bands).toBe(false);
    expect(POCKET.spineGap).toBe(0.2);
  });

  it('treats an unknown look as the default with what its custom properties say', () => {
    const rules = rulesOf({ name: 'custom', spineMark: true });
    expect(rules.spineMark).toBe(true);
    expect(rules.turned).toBe(false);
    expect(rules.bands).toBe(true);
  });
});
