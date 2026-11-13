import type { Binding, Stamp } from '../types';
import { colourOr, css, gradientMean, mix, over, parseColour, type Rgba, BLACK } from './colour';
import type { LookGeometry } from './layout';
import { blindInk, foilInk, isFoil, isStamped, type Part } from './stamp';

/**
 * A look as the painter needs it: the colours and type the stylesheet gives one volume, and the rules
 * of variants.css that place or colour things differently per look. The colours are read from the page;
 * the rules are written out here, each one after the selector it mirrors.
 */

export interface TypeFace {
  /** CSS font family list, as computed. */
  family: string;
  weight: string;
  /** Extra space after each character, in em. */
  letterSpacing: number;
  upper: boolean;
}

/** What is read from the page for one volume. */
export interface LookInput {
  /** The look's name, from the closest `data-variant`. */
  name: string;
  /** The cloth's name, from `bb-cloth--*`. */
  clothName: string;
  cloth: Rgba;
  ink: Rgba;
  art: Rgba;
  /** `--bb-foil-1` to `--bb-foil-3`, when the look letters in foil. */
  foil: [Rgba, Rgba, Rgba] | null;
  /** Paper and ink of a cover's pasted label (`--bb-cover-paper`, `--bb-cover-paper-ink`). */
  paper: Rgba;
  paperInk: Rgba;
  /** `--bb-spine-mark: 1` and `--bb-cover-mark: 1`. */
  spineMark: boolean;
  coverMark: boolean;
  serif: string;
  mono: string;
  /** The spine title's face, as computed on the volume's spine. */
  spineTitle: TypeFace;
}

/** The rules of a look that the stylesheet expresses as selectors rather than custom properties. */
export interface LookRules extends LookGeometry {
  /** The spine title reads from tail to head (`rotate: 180deg` on a vertical-rl title). */
  turned: boolean;
  /** The bands of a `bands` spine are printed. Paperbacks have none. */
  bands: boolean;
  /** Lettering, rules and the device are blocked in the look's foil. */
  foilLettering: boolean;
  /** The drawing is pressed into the cloth, a shade darker, instead of printed. */
  blindArt: boolean;
  /** The band of a band cover is blocked in foil. */
  bandFoil: boolean;
  /** The rule over a plate is printed. */
  plateRule: boolean;
}

const BASE_RULES: LookRules = {
  spineGap: 0.14,
  spineMark: false,
  markBlock: false,
  platePanel: false,
  boardLine: false,
  turned: false,
  bands: true,
  foilLettering: false,
  blindArt: false,
  bandFoil: false,
  plateRule: true,
};

const RULES: Record<string, Partial<LookRules>> = {
  // .bb-shelf[data-variant='paper'] .bb-spine__title { rotate: 180deg }
  paper: { turned: true },
  // Oak Library: gold foil lettering, blind-stamped drawing, no plate rule, a line tooled round the board.
  oak: { foilLettering: true, blindArt: true, bandFoil: true, plateRule: false, boardLine: true },
  night: {},
  // Pocket Paperbacks: wider gaps, no bands, a numbered block at the head and a plate printed as a panel.
  pocket: { spineGap: 0.2, bands: false, markBlock: true, platePanel: true },
};

/** The rules of a look; the custom properties it sets (the numbers at head and on cover) come from `input`. */
export function rulesOf(input: Pick<LookInput, 'name' | 'spineMark'>): LookRules {
  return { ...BASE_RULES, ...(RULES[input.name] ?? {}), spineMark: input.spineMark };
}

/** Every colour a face is painted in, after the binding and the stamp. CSS colour strings. */
export interface Palette {
  ground: string;
  /** Type on the cloth other than the titles: author, imprint, number, the read check. */
  lettering: string;
  coverTitle: string;
  spineTitle: string;
  /** Bands on a spine, and how strongly they are printed. */
  band: string;
  bandAlpha: number;
  plateRule: string;
  /** The double rule of a frame cover. */
  frame: string;
  /** The line tooled round the board in Oak Library, or what a stamp makes of it. */
  boardLine: string;
  device: string;
  /** The initial on the device, reversed out in the cloth. */
  initial: string;
  /** Number on the spine: its block (or null) and its type. */
  markBlock: string | null;
  markInk: string;
  markAlpha: number;
  /** The two inks of the drawing on plain cloth. */
  art1: string;
  art2: string;
  /** A printed panel (band, Pocket's plate) and the two inks of the drawing on it. */
  panel: string;
  bandPanel: string;
  panel1: string;
  panel2: string;
  /** A cover's pasted label. */
  paper: string;
  paperInk: string;
  /** A spine's pasted label (its own ink, whatever the look). */
  spinePaper: string;
  spinePaperInk: string;
  /** The device on the back board, always blind. */
  backDevice: string;
}

/** Bindings whose cover is printed, not pressed: their drawing is always printed in full ink. */
export function printsStrong(binding: Binding): boolean {
  return binding === 'paper' || binding === 'gloss' || binding === 'foil' || binding === 'holo';
}

/**
 * Colours for one volume. With the `ink` stamp they are what the stylesheet paints today, with its foil
 * gradients flattened to their mean colour; any other stamp repaints the stamped parts in its own ink.
 */
export function paletteOf(input: LookInput, rules: LookRules, binding: Binding, stamp: Stamp): Palette {
  const { cloth, ink, art } = input;
  const foil = rules.foilLettering ? input.foil : null;
  const lettering = foil ? foil[1] : ink;
  const stops = (...at: [Rgba, number][]) => gradientMean(at.map(([colour, place]) => ({ colour, at: place })));
  // The flat colour of each foil gradient in variants.css.
  const coverTitle = foil ? stops([foil[0], 0], [foil[1], 0.46], [foil[2], 0.62], [foil[1], 1]) : ink;
  const spineTitle = foil ? stops([foil[1], 0], [foil[0], 0.34], [foil[2], 0.52], [foil[1], 0.78]) : ink;
  const device = foil ? stops([foil[0], 0], [foil[1], 0.55], [foil[2], 1]) : art;
  const bandPanel = foil && rules.bandFoil ? stops([foil[0], 0], [foil[1], 0.6], [foil[2], 1]) : art;

  let art1 = art;
  let art2 = mix(art, ink, 0.55);
  if (rules.blindArt && !printsStrong(binding)) {
    // Black cloth cannot go darker; there the pressed drawing shows by a trace of the lettering colour.
    const black = input.clothName === 'ink';
    art1 = black ? mix(cloth, input.ink, 0.88) : mix(cloth, BLACK, 0.7);
    art2 = black ? mix(cloth, input.ink, 0.93) : mix(cloth, BLACK, 0.84);
  }

  const pressed = stamp === 'blind' ? blindInk(cloth, lettering) : isFoil(stamp) ? foilInk(stamp as 'gold', cloth) : null;
  const paint = (part: Part, colour: Rgba): string => css(pressed && isStamped(part, stamp) ? pressed : colour);

  return {
    ground: css(cloth),
    lettering: paint('lettering', lettering),
    coverTitle: paint('lettering', coverTitle),
    spineTitle: paint('lettering', spineTitle),
    band: paint('rule', lettering),
    bandAlpha: pressed ? 1 : 0.55,
    plateRule: paint('rule', art),
    frame: paint('frame', foil ? foil[1] : art),
    boardLine: paint('frame', over({ r: 0, g: 0, b: 0, a: 0.3 }, cloth)),
    device: paint('device', device),
    initial: css(cloth),
    markBlock: rules.markBlock ? paint('lettering', ink) : null,
    markInk: rules.markBlock ? css(cloth) : paint('lettering', lettering),
    markAlpha: rules.markBlock || pressed ? 1 : 0.86,
    art1: css(art1),
    art2: css(art2),
    panel: css(art),
    bandPanel: rules.bandFoil ? paint('block', bandPanel) : css(art),
    panel1: css(cloth),
    panel2: css(mix(cloth, art, 0.55)),
    paper: css(input.paper),
    paperInk: css(input.paperInk),
    spinePaper: '#efe6d2',
    spinePaperInk: '#2a2620',
    backDevice: css(blindInk(cloth, ink)),
  };
}

// ---------- reading the page ----------

/** Turns any colour the page gives into one the parser reads, through a canvas when it has to. */
function resolver(): (text: string, fallback: string) => Rgba {
  let ctx: CanvasRenderingContext2D | null | undefined;
  return (text, fallback) => {
    const value = text.trim();
    const direct = parseColour(value);
    if (direct || value === '') return direct ?? colourOr('', fallback);
    if (ctx === undefined) {
      try {
        ctx = document.createElement('canvas').getContext('2d');
      } catch {
        ctx = null;
      }
    }
    if (ctx) {
      ctx.fillStyle = '#000';
      ctx.fillStyle = value;
      const normal = parseColour(String(ctx.fillStyle));
      if (normal) return normal;
    }
    return colourOr('', fallback);
  };
}

const FALLBACK_SERIF = "'Newsreader Variable', Georgia, serif";
const FALLBACK_MONO = "'IBM Plex Mono', ui-monospace, monospace";

/** Reads the look of the volume `source` (an `li.bb-book`) from the page. It changes nothing there. */
export function readLook(source: HTMLElement): LookInput {
  const style = getComputedStyle(source);
  const read = (name: string) => style.getPropertyValue(name).trim();
  const colour = resolver();
  const name = source.closest<HTMLElement>('[data-variant]')?.dataset.variant ?? 'paper';
  const clothName = /\bbb-cloth--(\S+)/.exec(source.className)?.[1] ?? 'ink';
  const cloth = colour(read('--cloth'), '#1f1e1b');
  const ink = colour(read('--cloth-ink'), '#efe9dc');
  const art = colour(read('--cloth-art'), '#c9b78f');
  const foilNames = ['--bb-foil-1', '--bb-foil-2', '--bb-foil-3'].map(read);
  const foil = foilNames.every((value) => value !== '')
    ? (foilNames.map((value) => colour(value, '#dcb969')) as [Rgba, Rgba, Rgba])
    : null;
  const serif = read('--bb-font-serif') || FALLBACK_SERIF;
  const mono = read('--bb-font-mono') || FALLBACK_MONO;

  const title = source.querySelector<HTMLElement>('.bb-spine__title');
  let spineTitle: TypeFace = { family: serif, weight: '600', letterSpacing: 0.012, upper: false };
  if (title) {
    const own = getComputedStyle(title);
    const size = parseFloat(own.fontSize) || 16;
    const spacing = parseFloat(own.letterSpacing);
    spineTitle = {
      family: own.fontFamily || serif,
      weight: own.fontWeight || '600',
      letterSpacing: Number.isFinite(spacing) ? spacing / size : 0,
      upper: own.textTransform === 'uppercase',
    };
  }
  const shelf = source.closest<HTMLElement>('.bb-shelf');
  const spineMarkValue = shelf ? getComputedStyle(shelf).getPropertyValue('--bb-spine-mark').trim() : read('--bb-spine-mark');
  return {
    name,
    clothName,
    cloth,
    ink,
    art,
    foil,
    paper: colour(read('--bb-cover-paper'), '#f1ead9'),
    paperInk: colour(read('--bb-cover-paper-ink'), '#24211c'),
    spineMark: spineMarkValue === '1' || read('--bb-spine-mark') === '1',
    coverMark: read('--bb-cover-mark') === '1',
    serif,
    mono,
    spineTitle,
  };
}
