/**
 * The cover's drawing as an image: the SVG that cover-art.ts builds, given the colours the stylesheet
 * would give its two inks, serialised into a Blob URL and decoded once. The second ink overprints the
 * first inside the drawing only (`isolation: isolate` on the SVG), as on the CSS cover.
 */

export interface ArtInks {
  first: string;
  second: string;
}

/** The SVG markup for `svg` at `width` by `height` device px in `inks`. The original is left as it is. */
export function artMarkup(svg: SVGSVGElement, inks: ArtInks, width: number, height: number): string {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute('width', String(Math.max(1, Math.round(width))));
  copy.setAttribute('height', String(Math.max(1, Math.round(height))));
  copy.setAttribute('style', 'isolation: isolate');
  copy.removeAttribute('class');
  const first = copy.querySelector('.bb-cover__ink--1');
  const second = copy.querySelector('.bb-cover__ink--2');
  first?.setAttribute('style', `color: ${inks.first}`);
  second?.setAttribute('style', `color: ${inks.second}; mix-blend-mode: multiply`);
  return new XMLSerializer().serializeToString(copy);
}

export async function decodeArt(markup: string): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
  try {
    const picture = new Image();
    picture.decoding = 'async';
    picture.src = url;
    await picture.decode();
    return picture;
  } finally {
    URL.revokeObjectURL(url);
  }
}
