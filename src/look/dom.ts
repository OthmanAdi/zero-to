import './look.css';

/**
 * The parts of the look that live in the DOM: the grain and vignette over the room, and the chewed edge of DOM
 * paper. The lamp is not here. The lamp is the real light of the scene.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const EDGE_ID = 'zt-paper-edge';

/** A seamless tile of fine noise as a CSS `url(…)`. `size` is the tile in pixels. */
export function grainUrl(size = 160, frequency = 0.9, octaves = 2): string {
  const svg =
    `<svg xmlns="${SVG_NS}" width="${size}" height="${size}">` +
    `<filter id="n"><feTurbulence type="fractalNoise" baseFrequency="${frequency}" numOctaves="${octaves}" stitchTiles="stitch"/>` +
    `<feColorMatrix type="saturate" values="0"/></filter>` +
    `<rect width="100%" height="100%" filter="url(#n)"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** A soft, pale mottling for DOM paper, multiplied over the paper tone. */
export function paperGrainUrl(): string {
  const svg =
    `<svg xmlns="${SVG_NS}" width="220" height="220">` +
    `<filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.035 0.6" numOctaves="3" seed="7" stitchTiles="stitch"/>` +
    `<feColorMatrix type="matrix" values="0 0 0 0 0.86  0 0 0 0 0.83  0 0 0 0 0.76  0.5 0.5 0 0 -0.42"/></filter>` +
    `<rect width="100%" height="100%" fill="#fff"/><rect width="100%" height="100%" filter="url(#n)" opacity="0.5"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export interface OverlayOptions {
  /** The left scrim behind the hero text. Off by default. */
  readonly scrim?: boolean;
  readonly vignette?: boolean;
  readonly grain?: boolean;
}

/**
 * The fixed layers over the room: vignette, optional scrim, grain on top. Put the returned element after the
 * canvas and before the interface. It is hidden from assistive technology and never takes a pointer.
 */
export function createRoomOverlays(doc: Document = document, options: OverlayOptions = {}): HTMLElement {
  const root = doc.createElement('div');
  root.className = 'zt-overlays';
  root.setAttribute('aria-hidden', 'true');
  const layer = (name: string) => {
    const element = doc.createElement('div');
    element.className = name;
    root.append(element);
    return element;
  };
  if (options.vignette !== false) layer('zt-vignette');
  if (options.scrim) layer('zt-scrim');
  if (options.grain !== false) layer('zt-grain').style.setProperty('--zt-grain', grainUrl());
  return root;
}

/**
 * Makes sure the document has the filter that chews the edge of `.zt-paper`, and the grain DOM paper uses.
 * Safe to call many times. Returns the filter's id.
 */
export function ensurePaperEdge(doc: Document = document): string {
  if (doc.getElementById(EDGE_ID)) return EDGE_ID;
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.style.position = 'absolute';
  const filter = doc.createElementNS(SVG_NS, 'filter');
  filter.id = EDGE_ID;
  filter.setAttribute('x', '-6%');
  filter.setAttribute('y', '-6%');
  filter.setAttribute('width', '112%');
  filter.setAttribute('height', '112%');
  filter.setAttribute('color-interpolation-filters', 'sRGB');
  const noise = doc.createElementNS(SVG_NS, 'feTurbulence');
  noise.setAttribute('type', 'fractalNoise');
  noise.setAttribute('baseFrequency', '0.04 0.11');
  noise.setAttribute('numOctaves', '3');
  noise.setAttribute('seed', '4');
  noise.setAttribute('result', 'noise');
  const displace = doc.createElementNS(SVG_NS, 'feDisplacementMap');
  displace.setAttribute('in', 'SourceGraphic');
  displace.setAttribute('in2', 'noise');
  displace.setAttribute('scale', '5');
  displace.setAttribute('xChannelSelector', 'R');
  displace.setAttribute('yChannelSelector', 'G');
  filter.append(noise, displace);
  svg.append(filter);
  doc.body.append(svg);
  doc.documentElement.style.setProperty('--zt-paper-grain', paperGrainUrl());
  return EDGE_ID;
}
