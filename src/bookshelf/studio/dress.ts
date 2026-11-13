import { CanvasTexture, type Material, MeshPhysicalMaterial, MeshStandardMaterial, SRGBColorSpace, type Texture } from 'three';
import type { FrameVolume } from '../shelf/types';
import type { Binding, PaintedVolume, Stamp } from './types';
import type { VolumeParts, VolumeSize } from './volume';

/**
 * Gives every volume its materials. A volume first gets plain materials in its own cloth colour, at
 * once, so it never shows bare; its painted and lit materials follow when the painter has drawn its
 * faces. Finished materials are kept per item, look, size and binding, and the least recently used are
 * dropped when there are too many.
 */

export interface DressStyle {
  cloth: string;
  ink: string;
  art: string;
}

/** What a volume is dressed from, as read from its DOM volume. */
export function styleOf(element: HTMLElement): DressStyle {
  const style = getComputedStyle(element);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return { cloth: read('--cloth', '#5a4a3a'), ink: read('--cloth-ink', '#efe9dc'), art: read('--cloth-art', '#c9b78f') };
}

export interface PaintRequest {
  volume: FrameVolume;
  size: VolumeSize;
  binding: Binding;
  stamp: Stamp;
  density: number;
}

export interface DressKit {
  /** Resolves the binding and stamp a volume is drawn with, in a look. Called for every volume in every frame. */
  bindingOf(volume: FrameVolume, variant?: string): { binding: Binding; stamp: Stamp };
  /** Paints the faces; may be slow. */
  paint?(request: PaintRequest): Promise<PaintedVolume>;
  /** Lit materials from painted faces. */
  materials?(volume: FrameVolume, style: DressStyle, binding: Binding, stamp: Stamp, faces: PaintedVolume): VolumeParts & { dispose(): void };
  /** What the volumes reflect: a filtered studio of lights. Left out, the stage's plain room is used. */
  readonly environment?: Texture;
  /** The board the row stands on, for a look and a board size in px. The kit owns the material. */
  floor?(variant: string, size: { width: number; depth: number }): Material;
  dispose?(): void;
}

interface Entry {
  parts: VolumeParts;
  dispose: () => void;
  ready: boolean;
  used: number;
}

const LIMIT = 90;

export class Dresser {
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Set<string>();
  private tick = 0;
  private alive = true;
  private readonly slip = new MeshStandardMaterial({ color: '#2346b4', roughness: 0.7 });

  constructor(
    private kit: DressKit,
    private readonly onReady: () => void,
  ) {}

  setKit(kit: DressKit): void {
    this.kit = kit;
    this.clear();
  }

  get slipMaterial(): Material {
    return this.slip;
  }

  /** The parts to draw a volume with right now. */
  partsFor(volume: FrameVolume, variant: string, density: number): VolumeParts {
    const size: VolumeSize = { spineWidth: volume.spineWidth, bookHeight: volume.bookHeight, coverWidth: volume.coverWidth };
    const { binding, stamp } = this.kit.bindingOf(volume, variant);
    const item = volume.item;
    // Painted faces depend on what is printed and how big it is drawn, not on where the volume stands.
    const key = [
      item.id,
      item.title,
      item.source ?? '',
      item.author ?? '',
      item.cloth ?? '',
      item.pattern ?? '',
      item.seed ?? 0,
      item.mark ?? volume.index,
      item.done ? 1 : 0,
      // Wear is drawn from how handled and how old a volume is, in steps fine enough to see and coarse
      // enough that reading a few lines does not repaint it.
      Math.round((item.handled ?? 0) * 10),
      Math.round(Math.log2(1 + Math.max(0, item.age ?? 0))),
      (volume as { presented?: number }).presented ?? 0,
      variant,
      Math.round(size.spineWidth),
      Math.round(size.bookHeight),
      binding,
      stamp,
      density,
    ].join('|');
    this.tick++;
    let entry = this.entries.get(key);
    if (!entry) {
      entry = this.plain(volume);
      this.entries.set(key, entry);
      this.trim();
    }
    entry.used = this.tick;
    if (!entry.ready && !this.pending.has(key) && this.kit.paint && this.kit.materials) {
      this.pending.add(key);
      const style = styleOf(volume.element);
      const kit = this.kit;
      kit
        .paint!({ volume, size, binding, stamp, density })
        .then((faces) => {
          this.pending.delete(key);
          if (!this.alive || kit !== this.kit) return;
          const current = this.entries.get(key);
          if (!current) return;
          const lit = kit.materials!(volume, style, binding, stamp, faces);
          current.dispose();
          current.parts = lit;
          current.dispose = () => lit.dispose();
          current.ready = true;
          this.onReady();
        })
        .catch(() => {
          this.pending.delete(key);
        });
    }
    return entry.parts;
  }

  clear(): void {
    for (const entry of this.entries.values()) entry.dispose();
    this.entries.clear();
    this.pending.clear();
  }

  dispose(): void {
    this.alive = false;
    this.clear();
    this.slip.dispose();
  }

  private trim(): void {
    if (this.entries.size <= LIMIT) return;
    const oldest = [...this.entries.entries()].sort((a, b) => a[1].used - b[1].used);
    for (const [key, entry] of oldest.slice(0, this.entries.size - LIMIT)) {
      entry.dispose();
      this.entries.delete(key);
    }
  }

  /** Cloth-coloured materials with a quick printed spine, drawn at once. */
  private plain(volume: FrameVolume): Entry {
    const style = styleOf(volume.element);
    const cloth = new MeshPhysicalMaterial({
      color: style.cloth,
      roughness: 0.78,
      sheen: 0.6,
      sheenRoughness: 0.6,
      sheenColor: style.cloth,
    });
    const pages = new MeshStandardMaterial({ color: '#efe6d2', roughness: 0.92 });
    const endpaper = new MeshStandardMaterial({ color: '#e8dfcc', roughness: 0.9 });
    const spineTexture = quickSpine(volume, style);
    const spine = spineTexture
      ? new MeshPhysicalMaterial({ map: spineTexture, roughness: 0.78, sheen: 0.5, sheenRoughness: 0.6, sheenColor: style.cloth })
      : cloth;
    const parts: VolumeParts = { front: cloth, back: cloth, spine, boardEdge: cloth, pages, endpaper };
    return {
      parts,
      ready: false,
      used: this.tick,
      dispose: () => {
        cloth.dispose();
        pages.dispose();
        endpaper.dispose();
        if (spine !== cloth) spine.dispose();
        spineTexture?.dispose();
      },
    };
  }
}

/** A spine with its title in the cloth's ink, drawn in a few ms, for the moments before the real paint. */
function quickSpine(volume: FrameVolume, style: DressStyle): CanvasTexture | null {
  const width = Math.max(8, Math.round(volume.spineWidth * 2));
  const height = Math.max(32, Math.round(volume.bookHeight * 2));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = style.cloth;
  context.fillRect(0, 0, width, height);
  context.save();
  context.translate(width / 2, height * 0.55);
  context.rotate(-Math.PI / 2);
  context.fillStyle = style.ink;
  const font = Math.max(8, Math.min(width * 0.42, 34));
  context.font = `600 ${font}px Newsreader, Georgia, serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  let title = volume.item.title;
  const room = height * 0.7;
  while (title.length > 4 && context.measureText(title).width > room) title = `${title.slice(0, -2)}…`;
  context.fillText(title, 0, 0);
  context.restore();
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
