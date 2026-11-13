/**
 * Materials for Studio: what a volume, its pages and the shelf it stands on are made of, as lit
 * three.js materials. Everything is generated here, in typed arrays, when it is first needed; no image
 * is loaded.
 *
 * What the mesh has to provide: a `uv` attribute on every face, (0,0) at the bottom left and (1,1) at
 * the top right as seen from outside, and a `normal`. Nothing else. Tangents are not needed; the
 * shader builds its tangent frame from the UVs, so UVs must not be mirrored or rotated on a face.
 *  - front: the spine is at u = 0. back: the spine is at u = 1. (The joint is drawn on that side.)
 *  - pages: u runs across the thickness of the block, from one board to the other, on all three edges.
 *  - floor: u runs along the shelf, v from back to front.
 */
import * as THREE from 'three';
import type { Binding, PaintedFace, Stamp } from '../types';
import { createStudioEnvironment } from './environment';
import { BINDING_RECIPES, FILM, STAMP_FILM, STAMP_RECIPES, nearness, reliefAt, rubOf, stampAt, sunLift, useOf, type BindingRecipe, type StampRecipe, type TileName, type Use } from './recipes';
import { applyBindingShader, type BindingUniforms, type FaceUniforms } from './shader';
import {
  brushedSurface,
  clothSurface,
  flakeTile,
  glossSurface,
  heightToNormal,
  leatherSurface,
  linenSurface,
  packDetail,
  pagesTile,
  paperSurface,
  velvetSurface,
  woodTile,
  type Surface,
  type WoodOptions,
} from './tiles';

export { resolveBinding, resolveStamp, BINDING_WEIGHTS, LOOK_BINDING_WEIGHTS, STAMP_WEIGHTS } from './resolve';
export { BINDING_RECIPES, STAMP_RECIPES, nearness, reliefAt, stampAt, useOf, type BindingRecipe, type StampRecipe, type Use } from './recipes';

export interface VolumeLook {
  binding: Binding;
  stamp: Stamp;
  /** CSS colour of the binding (from the shelf's cloth palette) and of its ink. */
  cloth: string;
  ink: string;
  seed: number;
  /** Size of the volume in CSS px: spine width (thickness), height, cover width (depth of the book). */
  size: { spineWidth: number; bookHeight: number; coverWidth: number };
  /** Draw the joint, the groove where each board hinges on the spine. Default true. */
  joint?: boolean;
  /** How round the spine is across its width: 0 flat, 1 strongly rounded. Default 0.35. */
  spineRound?: number;
  /**
   * How near the volume is shown, 0 (standing in the row, at shelf distance) to 1 (a cover shown large).
   * Grain is quieter and foil softer far off. Left out, it follows from `size.bookHeight`; say it when
   * the volume is drawn at another size than `size` (a camera close to it, a scaled group).
   */
  presented?: number;
  /** How much the volume has been handled, 0 (never opened) to 1 (read through). Rubs edges and corners and dulls the foil at the head of the spine. */
  handled?: number;
  /** Days since the link was saved. The spine fades and yellows a little with the years; the boards stay fresh. */
  age?: number;
}

export interface VolumeMaterials {
  /** Outer face of the front board: painted colour and stamp. The spine is at u = 0. */
  front: THREE.Material;
  /** Outer face of the back board. The spine is at u = 1. */
  back: THREE.Material;
  /** Outer face of the spine. */
  spine: THREE.Material;
  /** Edges of the boards: the binding without print. */
  boardEdge: THREE.Material;
  /** Page block edges: fine paper lines, a warm tone, soft. u runs across the thickness of the block. */
  pages: THREE.Material;
  /** Inside faces of the boards. */
  endpaper: THREE.Material;
  /**
   * A loose leaf: bright warm paper, lit from both sides, with a little light of its own (paper lets light
   * through) and a sheen, so a band crosses a leaf as it lifts. One material for the whole kit, owned by
   * the kit: `dispose` of a volume leaves it alone.
   */
  leaf: THREE.Material;
  dispose(): void;
}

export interface MaterialKit {
  volume(look: VolumeLook, faces: { front: PaintedFace; spine: PaintedFace; back: PaintedFace }): VolumeMaterials;
  /**
   * Shelf floor for a look name: 'paper' (pale paper-covered board), 'oak' (oiled oak with a little
   * clearcoat), 'night' (dark lacquered wood), 'pocket' (painted pine). Unknown names get 'paper'.
   * `size` is the floor in CSS px (u along the shelf, v from back to front), so the grain keeps its
   * scale; without it a floor of 1600 by 420 is assumed. The kit owns the material.
   */
  floor(look: string, size?: { width: number; depth: number }): THREE.Material;
  /** The paper of loose leaves, the same material every volume hands out as `leaf`. */
  readonly leaf: THREE.Material;
  /**
   * PMREM-filtered studio environment (soft boxes, a warm key, cool fill) for scene.environment. The
   * caller rotates it with scene.environmentRotation to sweep reflections with the pointer.
   */
  readonly environment: THREE.Texture;
  dispose(): void;
}

interface TileTextures {
  /** Share of the recipe's span one repeat of this tile covers. */
  cover: number;
  normal: THREE.DataTexture;
  detail: THREE.DataTexture;
  thickness?: THREE.DataTexture;
}

/**
 * Each tile: its texels at high quality (low quality halves them), the texels the recipe's span is
 * written for, and the slope its relief is given. A tile holds a fixed number of texels to a thread, a
 * pebble or a flake, so a smaller tile holds fewer of them and has to cover less of the board: the kit
 * shrinks the span by `size / reference`. Laminate is the exception, its waves fill the tile at any size.
 */
const TILES: Record<TileName, { size: number; reference: number; strength: number; make?: (size: number) => Surface }> = {
  cloth: { size: 256, reference: 512, strength: 1.5, make: clothSurface },
  linen: { size: 256, reference: 512, strength: 1.5, make: linenSurface },
  leather: { size: 256, reference: 512, strength: 1.7, make: leatherSurface },
  paper: { size: 256, reference: 256, strength: 1.4, make: paperSurface },
  gloss: { size: 128, reference: 0, strength: 2.5, make: glossSurface },
  velvet: { size: 256, reference: 256, strength: 2, make: velvetSurface },
  brushed: { size: 256, reference: 256, strength: 1.6, make: brushedSurface },
  flake: { size: 256, reference: 256, strength: 1 },
};

const FLOORS: Record<string, { wood?: WoodOptions; color: string; span: number; roughness: number; normalScale: number; clearcoat: number; clearcoatRoughness: number }> = {
  paper: { color: '#efebe2', span: 96, roughness: 0.93, normalScale: 0.5, clearcoat: 0, clearcoatRoughness: 0 },
  oak: {
    wood: { light: [0.63, 0.46, 0.27], dark: [0.33, 0.21, 0.1], rings: 14, pores: 1, relief: 2.4, seed: 21 },
    color: '#ffffff',
    span: 380,
    roughness: 0.62,
    normalScale: 0.7,
    clearcoat: 0.3,
    clearcoatRoughness: 0.3,
  },
  night: {
    wood: { light: [0.13, 0.1, 0.085], dark: [0.05, 0.038, 0.03], rings: 12, pores: 0.35, relief: 1.2, seed: 22 },
    color: '#ffffff',
    span: 420,
    roughness: 0.5,
    normalScale: 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.09,
  },
  pocket: {
    wood: { light: [0.93, 0.91, 0.86], dark: [0.8, 0.77, 0.7], rings: 9, pores: 0.12, relief: 1.6, seed: 23 },
    color: '#ffffff',
    span: 340,
    roughness: 0.6,
    normalScale: 0.55,
    clearcoat: 0.18,
    clearcoatRoughness: 0.4,
  },
};

/** The height in CSS px of the volume the recipes' spans are written for: the shelf's default book. */
const REFERENCE_HEIGHT = 340;
/**
 * A volume in the row shows its spine; its boards are only seen once it is taken out and turned to the
 * reader. So unless the caller says how near the volume is, its boards count as at least this near.
 */
const BOARD_NEAR = 0.5;
/**
 * Paper: the share of its own colour a page block and a loose leaf give back unlit (light that came
 * through the sheet), and the sheen that lays a band across a leaf as it lifts.
 */
export const PAPER = { glow: 0.16, leafGlow: 0.2, sheen: 0.25 };

let probe: CanvasRenderingContext2D | null | undefined;

/** A CSS colour as a linear three.js colour. Forms three.js cannot read are resolved through a canvas. */
function cssColor(css: string, fallback: string): THREE.Color {
  const value = css.trim();
  if (/^#[0-9a-f]{3,8}$/i.test(value) || /^(rgb|hsl)a?\(/i.test(value) || /^[a-z]+$/i.test(value)) {
    if (/^#[0-9a-f]{8}$/i.test(value)) return new THREE.Color(value.slice(0, 7));
    if (/^#[0-9a-f]{4}$/i.test(value)) return new THREE.Color(value.slice(0, 4));
    return new THREE.Color(value);
  }
  if (probe === undefined) {
    probe = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  }
  if (!probe) return new THREE.Color(fallback);
  probe.fillStyle = fallback;
  probe.fillStyle = value;
  probe.fillRect(0, 0, 1, 1);
  const [red = 0, green = 0, blue = 0] = probe.getImageData(0, 0, 1, 1).data;
  return new THREE.Color().setRGB(red / 255, green / 255, blue / 255, THREE.SRGBColorSpace);
}

export function createMaterialKit(renderer: THREE.WebGLRenderer, options?: { quality?: 'high' | 'low' }): MaterialKit {
  const high = (options?.quality ?? 'high') === 'high';
  const anisotropy = Math.max(1, Math.min(high ? 8 : 2, renderer.capabilities.getMaxAnisotropy()));
  const tiles = new Map<TileName, TileTextures>();
  const floors = new Map<string, THREE.Material>();
  const woods = new Map<string, { color: THREE.DataTexture; normal: THREE.DataTexture; detail: THREE.DataTexture }>();
  /** Everything the kit made and has not yet disposed. */
  const live = new Set<{ dispose(): void }>();
  let pages: { color: THREE.DataTexture; normal: THREE.DataTexture; span: number } | undefined;
  let leaf: THREE.MeshPhysicalMaterial | undefined;
  let studio: ReturnType<typeof createStudioEnvironment> | undefined;
  let disposed = false;

  function dataTexture(data: Uint8Array, width: number, height: number, colorSpace: THREE.ColorSpace): THREE.DataTexture {
    const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = anisotropy;
    texture.colorSpace = colorSpace;
    texture.needsUpdate = true;
    live.add(texture);
    return texture;
  }

  function tile(name: TileName): TileTextures {
    let made = tiles.get(name);
    if (made) return made;
    const spec = TILES[name];
    const size = high ? spec.size : spec.size / 2;
    const cover = spec.reference > 0 ? size / spec.reference : 1;
    if (spec.make) {
      const made2 = spec.make(size);
      // Laminate keeps its waves at any size, so with half the texels the slope per texel doubles.
      const normal = heightToNormal(made2.height, size, size, spec.reference > 0 ? spec.strength : (spec.strength * size) / spec.size);
      made = {
        cover,
        normal: dataTexture(normal, size, size, THREE.NoColorSpace),
        detail: dataTexture(packDetail(made2.shade, made2.rough), size, size, THREE.NoColorSpace),
      };
    } else {
      const flakes = flakeTile(size);
      made = {
        cover,
        normal: dataTexture(flakes.normal, size, size, THREE.NoColorSpace),
        detail: dataTexture(flakes.detail, size, size, THREE.NoColorSpace),
        thickness: dataTexture(flakes.thickness, size, size, THREE.NoColorSpace),
      };
    }
    tiles.set(name, made);
    return made;
  }

  /**
   * The same tile with its own repeat. The copy shares the pixels on the GPU. three.js marks the shared
   * source as changed whenever a texture is copied, which would upload the tile again for every volume,
   * so the source's version is put back: nothing about the pixels has changed.
   */
  function repeated(texture: THREE.Texture, repeatX: number, repeatY: number, into: Set<{ dispose(): void }>): THREE.Texture {
    const version = texture.source.version;
    const copy = texture.clone();
    texture.source.version = version;
    copy.repeat.set(repeatX, repeatY);
    into.add(copy);
    return copy;
  }

  function canvasTexture(canvas: HTMLCanvasElement, colorSpace: THREE.ColorSpace, into: Set<{ dispose(): void }>, format?: THREE.PixelFormat): THREE.CanvasTexture {
    const texture = new THREE.CanvasTexture(canvas);
    if (format !== undefined) texture.format = format;
    texture.colorSpace = colorSpace;
    texture.anisotropy = anisotropy;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    into.add(texture);
    return texture;
  }

  function bindingMaterial(recipe: BindingRecipe, cloth: THREE.Color): THREE.MeshPhysicalMaterial {
    const material = new THREE.MeshPhysicalMaterial({
      roughness: recipe.roughness,
      metalness: recipe.metalness,
      clearcoat: recipe.clearcoat,
      clearcoatRoughness: recipe.clearcoatRoughness,
    });
    if (recipe.sheen > 0) {
      material.sheen = recipe.sheen;
      material.sheenRoughness = recipe.sheenRoughness;
      material.sheenColor = cloth.clone().lerp(new THREE.Color(1, 1, 1), recipe.sheenLift);
    }
    if (recipe.anisotropy > 0) {
      material.anisotropy = recipe.anisotropy;
      // Scratches run along u; the highlight is drawn out across them.
      material.anisotropyRotation = Math.PI / 2;
    }
    return material;
  }

  function film(material: THREE.MeshPhysicalMaterial, width: number, height: number, into: Set<{ dispose(): void }>): void {
    material.iridescence = 1;
    material.iridescenceIOR = FILM.ior;
    material.iridescenceThicknessMinimum = FILM.thickness[0];
    material.iridescenceThicknessMaximum = FILM.thickness[1];
    // The film's bands fill the tile whatever its size, so its span is not scaled.
    material.iridescenceThicknessMap = repeated(tile('flake').thickness!, width / FILM.span, height / FILM.span, into);
  }

  interface FaceSpec {
    face: PaintedFace;
    width: number;
    height: number;
    /** Joint centre in px from the left edge, or a negative number for none. */
    joint: number;
    round: number;
    /** Size of the detail against its size on a volume 340 px tall. */
    grain: number;
    /** 0 at shelf distance, 1 shown large. */
    near: number;
    /** The spine: the one face that stands in the light and is hooked out by its head. */
    spine: boolean;
    use: Use;
  }

  function faceMaterial(look: VolumeLook, recipe: BindingRecipe, stamp: StampRecipe, cloth: THREE.Color, ink: THREE.Color, spec: FaceSpec, into: Set<{ dispose(): void }>): THREE.MeshPhysicalMaterial {
    const textures = tile(recipe.tile);
    const repeatX = spec.width / (recipe.span * textures.cover * spec.grain);
    const repeatY = spec.height / (recipe.span * textures.cover * spec.grain);
    const material = bindingMaterial(recipe, cloth);
    material.map = canvasTexture(spec.face.color, THREE.SRGBColorSpace, into);
    material.normalMap = repeated(textures.normal, repeatX, repeatY, into);
    const relief = reliefAt(spec.near);
    material.normalScale.setScalar(recipe.normalScale * relief);
    material.roughnessMap = repeated(textures.detail, repeatX, repeatY, into);
    const holoStamp = stamp.iridescence !== null && stamp.iridescence > 0;
    if (recipe.iridescence > 0 || holoStamp) film(material, spec.width / spec.grain, spec.height / spec.grain, into);

    // The shader reads one channel of the mask, so one channel is all the GPU is given: a quarter of the memory.
    const mask = canvasTexture(spec.face.mask, THREE.NoColorSpace, into, THREE.RedFormat);
    const pressed = stampAt(stamp, recipe, spec.near);
    const filmOutside = recipe.iridescence;
    const filmInside = stamp.iridescence ?? recipe.iridescence;
    // A metal board is bright whatever its cloth colour was: the look's pale ink would be lost on it.
    const metalBoard = recipe.metalness > 0.5;
    const stampColor =
      stamp.color === 'ink' ? (metalBoard ? new THREE.Color(0.03, 0.028, 0.026) : ink) : stamp.color ? new THREE.Color(stamp.color[0], stamp.color[1], stamp.color[2]) : new THREE.Color(0, 0, 0);
    const luminance = (color: THREE.Color): number => 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
    const rub = rubOf(recipe.wear, spec.use.rub);
    // Metal does not fade. Elsewhere only the spine has stood in the light.
    const sun = spec.spine && !metalBoard ? spec.use.sun : 0;
    // A foil title is light; a printed or blind one is as light as the look's ink.
    const titleLuminance = Array.isArray(stamp.color) ? 1 : luminance(ink);
    const jointWidth = Math.max(1.5, spec.width * 0.011);
    const uniforms: FaceUniforms = {
      bbDetail: { value: new THREE.Vector4(recipe.shade * relief, recipe.lift, recipe.iridescence > 0 ? recipe.filmShift : holoStamp ? STAMP_FILM.shift : 0, recipe.pastel) },
      bbStamp: { value: mask },
      bbStampTexel: { value: new THREE.Vector2(1.25 / Math.max(1, spec.face.mask.width), 1.25 / Math.max(1, spec.face.mask.height)) },
      bbStampColor: { value: stampColor },
      bbStampMix: { value: new THREE.Vector4(stamp.tint, stamp.shade, pressed.flatten, pressed.deboss) },
      bbStampPbr: { value: new THREE.Vector4(pressed.roughness[0], pressed.roughness[1], pressed.metalness[0], pressed.metalness[1]) },
      bbFoil: { value: new THREE.Vector4(pressed.gain - 1, pressed.wall, metalBoard ? 1 : 0, 0) },
      bbCloth: { value: cloth.clone() },
      bbUse: { value: new THREE.Vector4(sun, spec.use.rub, spec.spine && Array.isArray(stamp.color) ? spec.use.dull : 0, sunLift(sun, titleLuminance, luminance(cloth))) },
      // A spine's long edges are its joints, which rub far less than its head and tail.
      bbRub: { value: new THREE.Vector4(spec.spine ? rub.reach * 0.35 : rub.reach, rub.reach, 0, 0) },
      bbStampFx: { value: new THREE.Vector4(stamp.sheen, stamp.clearcoat, filmOutside, filmInside) },
      bbFaceSize: { value: new THREE.Vector2(spec.width, spec.height) },
      bbEdge: { value: new THREE.Vector4(0, rub.amount, recipe.bevel[0], recipe.bevel[1]) },
      bbJoint: { value: new THREE.Vector4(spec.joint, jointWidth, spec.joint < 0 || look.joint === false ? 0 : recipe.joint, spec.round) },
    };
    applyBindingShader(material, uniforms, true);
    into.add(material);
    return material;
  }

  function pagesTextures(): NonNullable<typeof pages> {
    if (!pages) {
      const width = high ? 256 : 128;
      const made = pagesTile(width, 64);
      // One sheet to about 1.4 CSS px: fine lines that still read as paper on a spine a few dozen px wide.
      pages = {
        color: dataTexture(made.color, made.width, made.rows, THREE.SRGBColorSpace),
        normal: dataTexture(made.normal, made.width, made.rows, THREE.NoColorSpace),
        span: made.sheets * 1.4,
      };
    }
    return pages;
  }

  function volume(look: VolumeLook, faces: { front: PaintedFace; spine: PaintedFace; back: PaintedFace }): VolumeMaterials {
    const own = new Set<{ dispose(): void }>();
    const recipe = BINDING_RECIPES[look.binding] ?? BINDING_RECIPES.cloth;
    const stamp = STAMP_RECIPES[look.stamp] ?? STAMP_RECIPES.ink;
    const cloth = cssColor(look.cloth, '#45515d');
    const ink = cssColor(look.ink, '#efe9dc');
    const { spineWidth, bookHeight, coverWidth } = look.size;
    const jointAt = coverWidth * 0.034;
    const round = look.spineRound ?? 0.35;
    const grain = Math.max(0.25, bookHeight / REFERENCE_HEIGHT);
    const near = nearness(bookHeight, look.presented);
    const boardNear = look.presented === undefined ? Math.max(near, BOARD_NEAR) : near;
    const use = useOf(look.handled, look.age);

    const front = faceMaterial(look, recipe, stamp, cloth, ink, { face: faces.front, width: coverWidth, height: bookHeight, joint: jointAt, round: 0, grain, near: boardNear, spine: false, use }, own);
    const back = faceMaterial(look, recipe, stamp, cloth, ink, { face: faces.back, width: coverWidth, height: bookHeight, joint: coverWidth - jointAt, round: 0, grain, near: boardNear, spine: false, use }, own);
    const spine = faceMaterial(look, recipe, stamp, cloth, ink, { face: faces.spine, width: spineWidth, height: bookHeight, joint: -1, round, grain, near, spine: true, use }, own);

    // The board edges are a few px wide: the binding's colour and finish, without its relief.
    const boardEdge = bindingMaterial(recipe, cloth);
    boardEdge.color.copy(cloth);
    if (recipe.iridescence > 0) {
      boardEdge.iridescence = 1;
      boardEdge.iridescenceIOR = FILM.ior;
      boardEdge.iridescenceThicknessMinimum = FILM.thickness[0];
      boardEdge.iridescenceThicknessMaximum = FILM.thickness[1];
    }
    const edgeUniforms: BindingUniforms = { bbDetail: { value: new THREE.Vector4(0, recipe.lift, recipe.filmShift, recipe.pastel) } };
    applyBindingShader(boardEdge, edgeUniforms, false);
    own.add(boardEdge);

    const sheets = pagesTextures();
    const sheetColor = repeated(sheets.color, Math.max(0.05, spineWidth / (sheets.span * grain)), 1, own);
    // Paper lets light through: the block gives back a little of its own colour even in the shade of its
    // boards, so its edges read as paper and not as grey card. The sheen lays a soft band across them.
    const pagesMaterial = new THREE.MeshPhysicalMaterial({
      map: sheetColor,
      emissiveMap: sheetColor,
      emissive: new THREE.Color(1, 1, 1),
      emissiveIntensity: PAPER.glow,
      normalMap: repeated(sheets.normal, Math.max(0.05, spineWidth / (sheets.span * grain)), 1, own),
      roughness: 0.88,
      metalness: 0,
      sheen: PAPER.sheen,
      sheenRoughness: 0.5,
      sheenColor: new THREE.Color(1, 0.97, 0.9),
    });
    pagesMaterial.normalScale.setScalar(0.4);
    own.add(pagesMaterial);

    // Endpapers: a plain sheet that takes a little of the binding's colour.
    const paper = tile('paper');
    const sheet = BINDING_RECIPES.paper;
    const endpaper = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setRGB(0.93, 0.9, 0.82, THREE.SRGBColorSpace).lerp(cloth, 0.16),
      normalMap: repeated(paper.normal, coverWidth / (sheet.span * paper.cover * grain), bookHeight / (sheet.span * paper.cover * grain), own),
      roughnessMap: repeated(paper.detail, coverWidth / (sheet.span * paper.cover * grain), bookHeight / (sheet.span * paper.cover * grain), own),
      roughness: 0.92,
      metalness: 0,
    });
    endpaper.normalScale.setScalar(0.35);
    own.add(endpaper);

    for (const item of own) live.add(item);
    return {
      front,
      back,
      spine,
      boardEdge,
      pages: pagesMaterial,
      endpaper,
      leaf: leafPaper(),
      dispose() {
        for (const item of own) {
          item.dispose();
          live.delete(item);
        }
        own.clear();
      },
    };
  }

  function leafPaper(): THREE.Material {
    if (!leaf) {
      if (disposed) throw new Error('The material kit has been disposed.');
      leaf = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color().setRGB(0.957, 0.925, 0.859, THREE.SRGBColorSpace),
        emissive: new THREE.Color().setRGB(0.957, 0.925, 0.859, THREE.SRGBColorSpace),
        emissiveIntensity: PAPER.leafGlow,
        roughness: 0.86,
        metalness: 0,
        sheen: PAPER.sheen,
        sheenRoughness: 0.5,
        sheenColor: new THREE.Color(1, 0.97, 0.9),
        side: THREE.DoubleSide,
      });
      live.add(leaf);
    }
    return leaf;
  }

  function floor(look: string, size?: { width: number; depth: number }): THREE.Material {
    const name = Object.hasOwn(FLOORS, look) ? look : 'paper';
    const width = size?.width ?? 1600;
    const depth = size?.depth ?? 420;
    const key = `${name}:${Math.round(width)}:${Math.round(depth)}`;
    const cached = floors.get(key);
    if (cached) return cached;
    const spec = FLOORS[name]!;
    const material = new THREE.MeshPhysicalMaterial({
      color: cssColor(spec.color, '#efebe2'),
      roughness: spec.roughness,
      metalness: 0,
      clearcoat: spec.clearcoat,
      clearcoatRoughness: spec.clearcoatRoughness,
    });
    const repeatX = width / spec.span;
    const repeatY = depth / spec.span;
    if (spec.wood) {
      let wood = woods.get(name);
      if (!wood) {
        const edge = high ? 256 : 128;
        const made = woodTile(edge, spec.wood);
        wood = {
          color: dataTexture(made.color, edge, edge, THREE.SRGBColorSpace),
          normal: dataTexture(made.normal, edge, edge, THREE.NoColorSpace),
          detail: dataTexture(made.detail, edge, edge, THREE.NoColorSpace),
        };
        woods.set(name, wood);
      }
      material.map = repeated(wood.color, repeatX, repeatY, live);
      material.normalMap = repeated(wood.normal, repeatX, repeatY, live);
      material.roughnessMap = repeated(wood.detail, repeatX, repeatY, live);
    } else {
      const paper = tile('paper');
      material.normalMap = repeated(paper.normal, repeatX / paper.cover, repeatY / paper.cover, live);
      material.roughnessMap = repeated(paper.detail, repeatX / paper.cover, repeatY / paper.cover, live);
    }
    material.normalScale.setScalar(spec.normalScale);
    live.add(material);
    floors.set(key, material);
    return material;
  }

  return {
    volume,
    floor,
    get leaf() {
      return leafPaper();
    },
    get environment() {
      if (!studio) {
        if (disposed) throw new Error('The material kit has been disposed.');
        studio = createStudioEnvironment(renderer, high ? 512 : 128);
      }
      return studio.texture;
    },
    dispose() {
      disposed = true;
      for (const item of live) item.dispose();
      live.clear();
      tiles.clear();
      floors.clear();
      woods.clear();
      pages = undefined;
      leaf = undefined;
      studio?.dispose();
      studio = undefined;
    },
  };
}
