import {
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NearestFilter,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type Texture,
} from 'three';
import type { UiLang } from '../i18n';
import { THEME, mix } from '../look/theme';
import { PALETTE, type SurfaceKind } from '../scene/palette';
import { settleSpring, spring, springAtRest, stepSpringKC, type Spring } from '../paper/motion';
import type { SceneEnvironment } from '../scene/contract';
import { COVER, clearTitle, coverLayout, coverReach, paintCover, titleMeasure, type CoverLayout, type CoverSpec } from './cover';
import { ROOM_ENV } from './room';
import { trailAlong, type SheetData, type SheetPrint } from './sheet-data';

/** Springs of a sheet on the table, stiffness and damping for unit mass. */
export const SHEET = {
  liftUp: { k: 150, c: 15 },
  liftDown: { k: 55, c: 10.5 },
  tip: { k: 120, c: 13 },
  slide: { k: 55, c: 14 },
  yaw: { k: 90, c: 13 },
  dim: { k: 60, c: 16 },
  /** How far a sheet rises under the pointer, and how far it tips toward the viewer, in radians. */
  hoverLift: 0.32,
  hoverTip: (7 * Math.PI) / 180,
  /** How far the other sheets slide out along their own radius when the dive starts, and how far they turn. */
  exitSlide: 6,
  exitYaw: (-16 * Math.PI) / 180,
  bevel: 0.012,
} as const;

/**
 * How much of its ground colour the paper of a card takes, per surface. These mirror the tints the terrain model
 * gives its cards, so the cover can print the same tones. If the model's tints change, only the match between
 * a printed field and a flat model in the dark slots is affected.
 */
const SURFACE_KEEP: Record<SurfaceKind, number> = { water: 0.9, sand: 0.86, grass: 0.86, forest: 0.8, dirt: 0.8, scree: 0.84, rock: 0.86, snow: 1 };

/** Share of its own paper a card shows while it still lies flat in the print. The rest is the sheet's tone. */
export const FLAT_PAPER = 0.25;

/**
 * The tone of every card while it lies in the print, bottom card first, as CSS colours: the cover's cloth with a
 * quarter of the card's own paper mixed in, in linear light, the way the card shader mixes them.
 */
export function flatTones(board: string, surfaces: readonly SurfaceKind[]): string[] {
  const cloth = new Color(board);
  const paper = new Color(PALETTE.paper);
  const tone = new Color();
  return surfaces.map((kind, card) => {
    tone.copy(paper).lerp(new Color(PALETTE.surface[kind]), SURFACE_KEEP[kind]).multiplyScalar(card % 2 === 0 ? 1 : 0.955);
    tone.lerp(cloth, 1 - FLAT_PAPER);
    return `#${tone.getHexString()}`;
  });
}

/** Thickness of a shut pocket map with `stages` panels and its cover. */
export function sheetThickness(stages: number): number {
  return 0.022 + 0.008 * (Math.min(8, Math.max(1, stages)) + 1);
}

/**
 * The body of a shut pocket map: a rounded slab with a small bevel. Group 0 is the cover (top and bevel, mapped
 * to the cover print), group 1 is the edge, where `uv.y` runs from the table to the cover so a striped map can
 * draw the paper layers.
 */
export function bodyGeometry(width: number, depth: number, radius: number, thickness: number, bevel: number): BufferGeometry {
  const outline: { x: number; z: number; nx: number; nz: number }[] = [];
  const steps = 7;
  const corners: readonly (readonly [number, number, number])[] = [
    [width / 2 - radius, -(depth / 2 - radius), 0],
    [-(width / 2 - radius), -(depth / 2 - radius), Math.PI / 2],
    [-(width / 2 - radius), depth / 2 - radius, Math.PI],
    [width / 2 - radius, depth / 2 - radius, (3 * Math.PI) / 2],
  ];
  for (const [cx, cz, start] of corners) {
    for (let i = 0; i <= steps; i += 1) {
      const a = start + (i / steps) * (Math.PI / 2);
      // The outline runs counter-clockwise seen from above (from +x toward -z), so the faces look outward.
      const nx = Math.cos(a);
      const nz = -Math.sin(a);
      outline.push({ x: cx + nx * radius, z: cz + nz * radius, nx, nz });
    }
  }

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const coverUv = (x: number, z: number): [number, number] => [x / width + 0.5, 0.5 - z / depth];
  const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number): void => {
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
    uvs.push(u, v);
  };
  const count = outline.length;
  const slant = Math.SQRT1_2;

  // Top face: a fan round the middle.
  for (let i = 0; i < count; i += 1) {
    const a = outline[i] as (typeof outline)[number];
    const b = outline[(i + 1) % count] as (typeof outline)[number];
    const ax = a.x - a.nx * bevel;
    const az = a.z - a.nz * bevel;
    const bx = b.x - b.nx * bevel;
    const bz = b.z - b.nz * bevel;
    push(0, thickness, 0, 0, 1, 0, ...coverUv(0, 0));
    push(ax, thickness, az, 0, 1, 0, ...coverUv(ax, az));
    push(bx, thickness, bz, 0, 1, 0, ...coverUv(bx, bz));
  }
  // Bevel: from the top face down to the edge.
  for (let i = 0; i < count; i += 1) {
    const a = outline[i] as (typeof outline)[number];
    const b = outline[(i + 1) % count] as (typeof outline)[number];
    const ax = a.x - a.nx * bevel;
    const az = a.z - a.nz * bevel;
    const bx = b.x - b.nx * bevel;
    const bz = b.z - b.nz * bevel;
    const y = thickness - bevel;
    push(ax, thickness, az, a.nx * slant, slant, a.nz * slant, ...coverUv(ax, az));
    push(a.x, y, a.z, a.nx * slant, slant, a.nz * slant, ...coverUv(a.x, a.z));
    push(b.x, y, b.z, b.nx * slant, slant, b.nz * slant, ...coverUv(b.x, b.z));
    push(ax, thickness, az, a.nx * slant, slant, a.nz * slant, ...coverUv(ax, az));
    push(b.x, y, b.z, b.nx * slant, slant, b.nz * slant, ...coverUv(b.x, b.z));
    push(bx, thickness, bz, b.nx * slant, slant, b.nz * slant, ...coverUv(bx, bz));
  }
  const coverVertices = positions.length / 3;
  // Edge: from under the bevel to the table.
  for (let i = 0; i < count; i += 1) {
    const a = outline[i] as (typeof outline)[number];
    const b = outline[(i + 1) % count] as (typeof outline)[number];
    const top = thickness - bevel;
    const vTop = top / thickness;
    const ua = i / count;
    const ub = (i + 1) / count;
    push(a.x, top, a.z, a.nx, 0, a.nz, ua, vTop);
    push(a.x, 0, a.z, a.nx, 0, a.nz, ua, 0);
    push(b.x, 0, b.z, b.nx, 0, b.nz, ub, 0);
    push(a.x, top, a.z, a.nx, 0, a.nz, ua, vTop);
    push(b.x, 0, b.z, b.nx, 0, b.nz, ub, 0);
    push(b.x, top, b.z, b.nx, 0, b.nz, ub, vTop);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.addGroup(0, coverVertices, 0);
  geometry.addGroup(coverVertices, positions.length / 3 - coverVertices, 1);
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

function canvasOf(width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  let context: CanvasRenderingContext2D | null = null;
  try {
    context = canvas.getContext('2d');
  } catch {
    context = null;
  }
  return context ? { canvas, context } : null;
}

/** The edge of a shut map: one stripe of paper per panel with a hair of shade between, and the cover on top. */
function edgeTexture(layers: number, board: string): Texture | null {
  const made = canvasOf(4, layers * 10);
  if (!made) return null;
  const { canvas, context } = made;
  for (let layer = 0; layer < layers; layer += 1) {
    // Canvas row 0 is the top of the stack.
    const y = layer * 10;
    const cover = layer === 0;
    context.fillStyle = cover ? mix(board, '#000000', 0.25) : layer % 2 === 0 ? THEME.paper : THEME.card;
    context.fillRect(0, y, 4, 10);
    context.fillStyle = cover ? mix(board, '#000000', 0.55) : mix(THEME.paperShade, THEME.ink, 0.45);
    context.fillRect(0, y + 8, 4, 2);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = NearestFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  return texture;
}

let shadowTexture: Texture | null = null;
let shadowUsers = 0;

/** The soft card of shade under every sheet: three blurred boxes on a 192 by 240 canvas. */
function contactShadowTexture(): Texture | null {
  if (shadowTexture) return shadowTexture;
  const made = canvasOf(192, 240);
  if (!made) return null;
  const { canvas, context } = made;
  context.clearRect(0, 0, 192, 240);
  // A box drawn off the canvas throws only its blurred shadow onto it.
  const far = 1000;
  for (const [inset, blur, alpha] of [
    [30, 26, 0.34],
    [36, 13, 0.38],
    [40, 5, 0.42],
  ] as const) {
    context.shadowColor = `rgba(0,0,0,${alpha})`;
    context.shadowBlur = blur;
    context.shadowOffsetX = far;
    context.fillStyle = '#000';
    context.fillRect(inset - far, inset, 192 - 2 * inset, 240 - 2 * inset);
  }
  context.shadowColor = 'transparent';
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  shadowTexture = texture;
  return texture;
}

export interface TableSheetOptions {
  readonly index: number;
  readonly data: SheetData;
  readonly print: SheetPrint;
  readonly environment: SceneEnvironment;
  readonly lang: UiLang;
  /** Device pixels per CSS pixel, for the size of the cover canvas. */
  readonly pixelRatio: number;
  /** Size of the sheet next to the full size, below 1 when more than five sheets share the table. */
  readonly scale: number;
}

export interface TableSheet {
  readonly index: number;
  readonly data: SheetData;
  readonly print: SheetPrint;
  /** Turns with the table. Its origin is the middle of the sheet on the table top; +z points to the rim. */
  readonly slot: Group;
  /** Lifts, tips and slides on springs. The map body and the mountain hang on it. */
  readonly body: Group;
  /**
   * The mount for whatever lies on this sheet: its origin is the middle of the cover's top face, x to the
   * right of the title and z toward the lower edge. The folded map of the walk is attached here.
   */
  readonly mount: Group;
  readonly layout: CoverLayout;
  readonly thickness: number;
  readonly scale: number;
  /** You-are-here as a share of the drawn trail. */
  readonly hereAlong: number;
  /** Light the sheet keeps, 0.3 to 1. */
  readonly dim: number;
  /** How far the sheet has left its place for the dive, 0 to 1. */
  readonly away: number;
  setHover(on: boolean): void;
  setDimTarget(dim: number): void;
  /** 0 to 1: the slide off the table as the dive starts. */
  setExit(amount: number): void;
  /** Hides the dummy body when the real folded map takes its place. */
  setBodyVisible(visible: boolean): void;
  /** `viewerAngle` is the sheet's angle from the lit slot in radians, so the tip can lean toward the viewer. */
  update(dt: number, viewerAngle: number, reduced: boolean): void;
  /** Prints the cover again, after the fonts arrived or the progress changed. */
  repaint(lang?: UiLang): void;
  dispose(): void;
}

export function createTableSheet(options: TableSheetOptions): TableSheet {
  const { index, data, print, environment } = options;
  const scale = options.scale;
  const thickness = sheetThickness(data.stageCount);
  let lang = options.lang;

  const slot = new Group();
  slot.name = `sheet-${index}`;
  const body = new Group();
  body.name = `sheet-${index}-body`;
  slot.add(body);
  const scaled = new Group();
  scaled.scale.setScalar(scale);
  body.add(scaled);
  const mount = new Group();
  mount.name = `sheet-${index}-mount`;
  mount.position.y = thickness;
  scaled.add(mount);

  const hereAlong = trailAlong(data, print.trail.stops.map((stop) => stop.along), data.hereMinuteShare);
  const walkedAlong = data.share > 0 ? hereAlong : 0;

  // The cover print.
  const pixelScale = Math.min(environment.phone ? 1 : 2, Math.max(1, options.pixelRatio), environment.maxTexture / COVER.height);
  const coverSpec = (measure?: CoverSpec['measure']): CoverSpec => ({
    title: data.roadmap.title,
    lang: data.roadmap.lang,
    number: index + 1,
    tier: data.tier,
    stages: data.stageCount,
    minutes: data.totalMinutes,
    share: data.share,
    example: data.spec.example === true,
    ...(measure ? { measure } : {}),
  });
  // The title keeps clear of where this sheet's mountain will stand (paintCover sets it the same way).
  const reach = coverReach(print);
  const firstSpec = coverSpec();
  let layout = clearTitle(coverLayout(firstSpec, lang), firstSpec, reach);
  const cover = canvasOf(COVER.width * pixelScale, COVER.height * pixelScale);
  let coverTexture: CanvasTexture | null = null;
  const paint = (): void => {
    if (!cover) return;
    const spec = coverSpec(titleMeasure(cover.context, data.roadmap.lang));
    layout = clearTitle(coverLayout(spec, lang), spec, reach);
    cover.context.setTransform(1, 0, 0, 1, 0, 0);
    cover.context.clearRect(0, 0, cover.canvas.width, cover.canvas.height);
    paintCover(
      cover.context,
      layout,
      spec,
      { print, here: hereAlong, walked: walkedAlong, tones: flatTones(layout.board, print.surfaces), lang, seed: data.map.seed },
      pixelScale,
    );
    if (coverTexture) coverTexture.needsUpdate = true;
  };
  paint();
  if (cover) {
    coverTexture = new CanvasTexture(cover.canvas);
    coverTexture.colorSpace = SRGBColorSpace;
    coverTexture.anisotropy = environment.phone ? 4 : 16;
    coverTexture.minFilter = LinearMipmapLinearFilter;
  }

  const board = new Color(layout.board);
  const coverMaterial = new MeshStandardMaterial({
    color: 0xffffff,
    map: coverTexture,
    roughness: 0.9,
    metalness: 0,
    envMap: environment.envMap,
    envMapIntensity: ROOM_ENV.paper,
  });
  if (!coverTexture) coverMaterial.color.copy(board);
  const edgeMap = edgeTexture(data.stageCount + 1, layout.board);
  const edgeMaterial = new MeshStandardMaterial({
    color: 0xffffff,
    map: edgeMap,
    roughness: 0.95,
    metalness: 0,
    envMap: environment.envMap,
    envMapIntensity: ROOM_ENV.paper,
  });
  if (!edgeMap) edgeMaterial.color.copy(board);
  const geometry = bodyGeometry(COVER.body.width, COVER.body.depth, COVER.body.radius, thickness, SHEET.bevel);
  const mesh = new Mesh(geometry, [coverMaterial, edgeMaterial]);
  mesh.name = `sheet-${index}-map`;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scaled.add(mesh);

  // The contact shadow stays on the table when the sheet lifts.
  const shade = contactShadowTexture();
  if (shade) shadowUsers += 1;
  const shadowMaterial = new MeshBasicMaterial({ map: shade, color: 0x000000, transparent: true, depthWrite: false, opacity: 0.85 });
  const shadowGeometry = new PlaneGeometry(COVER.body.width * (192 / (192 - 2 * 40)), COVER.body.depth * (240 / (240 - 2 * 40)));
  shadowGeometry.rotateX(-Math.PI / 2);
  const shadow = new Mesh(shadowGeometry, shadowMaterial);
  shadow.name = `sheet-${index}-shadow`;
  shadow.position.y = 0.003;
  shadow.scale.setScalar(scale);
  shadow.renderOrder = 1;
  slot.add(shadow);

  const lift: Spring = spring(0);
  const tip: Spring = spring(0);
  const slide: Spring = spring(0);
  const yaw: Spring = spring(0);
  const dim: Spring = spring(1);
  let hover = false;
  let dimTarget = 1;
  let exit = 0;
  const axis = new Vector3();
  const up = new Vector3(0, 1, 0);
  const turn = new Quaternion();
  const lean = new Quaternion();

  const apply = (viewerAngle: number): void => {
    body.position.set(0, lift.x, slide.x);
    // The tip leans the cover toward the viewer, who looks along -z of the world: in the sheet's own frame that
    // axis is turned back by the sheet's angle on the table.
    axis.set(Math.cos(viewerAngle), 0, Math.sin(viewerAngle));
    lean.setFromAxisAngle(axis, tip.x);
    turn.setFromAxisAngle(up, yaw.x);
    body.quaternion.copy(lean).multiply(turn);
    const light = Math.max(0, dim.x);
    coverMaterial.color.setScalar(coverTexture ? light : 1);
    if (!coverTexture) coverMaterial.color.copy(board).multiplyScalar(light);
    edgeMaterial.color.setScalar(edgeMap ? light : 1);
    // A lifted sheet throws a wider, fainter shade.
    const height = Math.max(0, lift.x) / SHEET.hoverLift;
    shadow.scale.setScalar(scale * (1 + 0.1 * height));
    shadowMaterial.opacity = 0.85 * (1 - 0.45 * height) * Math.max(0, 1 - slide.x / (SHEET.exitSlide * 0.6));
    shadow.position.z = slide.x;
  };
  apply(0);

  return {
    index,
    data,
    print,
    slot,
    body,
    mount,
    get layout() {
      return layout;
    },
    thickness,
    scale,
    hereAlong,
    get dim() {
      return Math.max(0, dim.x);
    },
    get away() {
      return Math.min(1, Math.max(0, slide.x / SHEET.exitSlide));
    },
    setHover(on) {
      hover = on;
    },
    setDimTarget(value) {
      dimTarget = Math.min(1, Math.max(0, value));
    },
    setExit(amount) {
      exit = Math.min(1, Math.max(0, amount));
    },
    setBodyVisible(visible) {
      mesh.visible = visible;
    },
    update(dt, viewerAngle, reduced) {
      const liftTarget = hover ? SHEET.hoverLift : 0;
      const tipTarget = hover ? SHEET.hoverTip : 0;
      const slideTarget = exit * SHEET.exitSlide;
      const yawTarget = exit * SHEET.exitYaw;
      if (reduced) {
        settleSpring(lift, liftTarget);
        settleSpring(tip, tipTarget);
        settleSpring(slide, slideTarget);
        settleSpring(yaw, yawTarget);
        settleSpring(dim, dimTarget);
      } else {
        const liftSpring = liftTarget > lift.x ? SHEET.liftUp : SHEET.liftDown;
        if (!springAtRest(lift, liftTarget)) stepSpringKC(lift, liftTarget, liftSpring.k, liftSpring.c, dt);
        if (!springAtRest(tip, tipTarget)) stepSpringKC(tip, tipTarget, SHEET.tip.k, SHEET.tip.c, dt);
        // The dive is driven by the scroll, which is already smoothed: the slide follows it directly.
        slide.x = slideTarget;
        yaw.x = yawTarget;
        stepSpringKC(dim, dimTarget, SHEET.dim.k, SHEET.dim.c, dt);
      }
      apply(viewerAngle);
    },
    repaint(next) {
      if (next) lang = next;
      paint();
    },
    dispose() {
      slot.removeFromParent();
      geometry.dispose();
      shadowGeometry.dispose();
      coverMaterial.dispose();
      edgeMaterial.dispose();
      shadowMaterial.dispose();
      coverTexture?.dispose();
      edgeMap?.dispose();
      if (shade) {
        shadowUsers -= 1;
        if (shadowUsers <= 0 && shadowTexture) {
          shadowTexture.dispose();
          shadowTexture = null;
          shadowUsers = 0;
        }
      }
    },
  };
}
