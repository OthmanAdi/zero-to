import { createCover, layoutOf, type CoverLayout } from '../../shelf/cover-art';
import { imprintOf, seriesOf } from '../../shelf/imprint';
import type { ShelfItem } from '../../shelf/types';
import type { Binding, PaintedVolume, Stamp } from '../types';
import { artMarkup, decodeArt } from './art';
import { paintBack } from './back';
import { paintFront, planFront, type CoverFacts } from './front';
import { canvasSize } from './layout';
import { paletteOf, readLook, rulesOf } from './look';
import { fontOf } from './pen';
import { paintSpine, type DeviceShape, type SpineTreatment } from './spine';

export { stampInk } from './stamp';

export interface PaintRequest {
  item: ShelfItem;
  /** The volume's li.bb-book in the live CSS shelf. Read its computed style for --cloth, --cloth-ink, --cloth-art, fonts and the look (closest [data-variant]); never change it. */
  source: HTMLElement;
  size: { spineWidth: number; bookHeight: number; coverWidth: number }; // CSS px
  binding: Binding;
  stamp: Stamp;
  /** Device pixels per CSS px for the canvases; the caller passes 1 to 2.5 by distance and screen. Clamp each canvas side to 2048. */
  density: number;
}

/** As book.ts dresses a spine: one treatment and one device shape per site. */
const TREATMENTS: readonly SpineTreatment[] = ['bands', 'label', 'plain'];
const DEVICES: readonly DeviceShape[] = ['circle', 'square', 'lozenge', 'shield'];

function oneOf<T extends string>(value: string | undefined, known: readonly T[], fallback: T): T {
  return (known as readonly string[]).includes(value ?? '') ? (value as T) : fallback;
}

/** What the CSS cover for `item` says about itself: built with createCover, never attached to the page. */
function coverFacts(item: ShelfItem, number: string, aspect: number): { facts: CoverFacts; svg: SVGSVGElement | null } {
  const cover = createCover(item, number || undefined, { aspect });
  const title = cover.querySelector<HTMLElement>('.bb-cover__title');
  const size = parseFloat(title?.style.getPropertyValue('--bb-cover-title') ?? '');
  const clamp = parseInt(title?.style.getPropertyValue('--bb-cover-lines') ?? '', 10);
  const layout = (cover.dataset.layout as CoverLayout | undefined) ?? layoutOf(item.source);
  return {
    facts: {
      layout,
      title: item.title,
      size: Number.isFinite(size) ? size : 12.6,
      clamp: Number.isFinite(clamp) ? clamp : 4,
      broken: title?.classList.contains('bb-cover__title--break') ?? false,
      author: item.author ?? '',
      imprint: cover.querySelector('.bb-cover__imprint')?.textContent ?? '',
      done: cover.dataset.done !== undefined,
      number: cover.querySelector('.bb-cover__mark')?.textContent ?? '',
    },
    svg: cover.querySelector<SVGSVGElement>('svg.bb-cover__art'),
  };
}

/** Waits until every face the painter sets type in is loaded for the characters it will set. */
async function fontsFor(fonts: string[], text: string): Promise<void> {
  const set = typeof document !== 'undefined' ? document.fonts : undefined;
  if (!set) return;
  await Promise.all(fonts.map((font) => set.load(font, text).catch(() => [])));
  await set.ready;
}

/**
 * Paints the three outer faces of one volume as the CSS shelf draws them for the look `source` stands
 * in, with the stamped parts on a mask. Same request, same pixels; nothing is kept between calls.
 */
export async function paintVolume(request: PaintRequest): Promise<PaintedVolume> {
  const { item, source, size, binding, stamp, density } = request;
  const look = readLook(source);
  const rules = rulesOf(look);
  const palette = paletteOf(look, rules, binding, stamp);

  const spineElement = source.querySelector<HTMLElement>('.bb-book__spine');
  const deviceElement = source.querySelector<HTMLElement>('.bb-spine__device');
  const treatment = oneOf(spineElement?.dataset.treatment, TREATMENTS, TREATMENTS[seriesOf(item.source, TREATMENTS.length)] ?? 'bands');
  const shape = oneOf(deviceElement?.dataset.shape, DEVICES, DEVICES[seriesOf(item.source, DEVICES.length)] ?? 'circle');
  const initial = imprintOf(item.source).initial;
  const number = source.querySelector('.bb-spine__mark')?.textContent || item.mark || '';

  const aspect = size.coverWidth / size.bookHeight;
  const { facts, svg } = coverFacts(item, number, aspect);
  const front = { facts, look, rules, palette, stamp, width: size.coverWidth, height: size.bookHeight, density };

  // The drawing is decoded once, at the size it is drawn, in the inks its place on the cover gives it.
  const plan = planFront(front);
  const onPanel = facts.layout === 'band' || (facts.layout === 'plate' && plan.panel);
  const inks = onPanel ? { first: palette.panel1, second: palette.panel2 } : { first: palette.art1, second: palette.art2 };
  const scale = canvasSize(size.coverWidth, size.bookHeight, density);
  const art = svg && plan.art.width > 0 && plan.art.height > 0
    ? decodeArt(artMarkup(svg, inks, plan.art.width * scale.scaleX, plan.art.height * scale.scaleY))
    : Promise.resolve(null);

  const face = look.spineTitle;
  const text = [item.title, item.author ?? '', facts.imprint, number, initial, '…-'].join(' ');
  const [picture] = await Promise.all([
    art,
    fontsFor(
      [
        fontOf('normal', '600', 16, look.serif),
        fontOf('italic', '400', 16, look.serif),
        fontOf('normal', '500', 16, look.mono),
        fontOf('normal', face.weight, 16, face.family),
      ],
      text + text.toUpperCase(),
    ),
  ]);

  return {
    front: paintFront({ ...front, art: picture }),
    spine: paintSpine({
      title: item.title,
      number,
      initial,
      done: item.done === true,
      treatment,
      shape,
      look,
      rules,
      palette,
      stamp,
      width: size.spineWidth,
      height: size.bookHeight,
      density,
    }),
    back: paintBack({ shape, initial, palette, serif: look.serif, stamp, width: size.coverWidth, height: size.bookHeight, density }),
  };
}
