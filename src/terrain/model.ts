import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DataTexture,
  DodecahedronGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  Path,
  PlaneGeometry,
  Quaternion,
  RGBADepthPacking,
  RepeatWrapping,
  Shape,
  Sphere,
  Vector2,
  Vector3,
  Vector4,
  type Material,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { fork, range } from '../core/random';
import type { FrameTime, SceneEnvironment, ScenePart } from '../scene/contract';
import { PALETTE, type SurfaceKind } from '../scene/palette';
import { levelHeights, levelIndexAt, traceContours, type ContourLevel, type ContourPolygon } from './contours';
import { generateHeightfield, type Heightfield, type TerrainSpec } from './heightfield';
import { ROUTE_RAMP, createCanvas, paintGrain, paintGround, paintRoute, routeBleed } from './paper';
import { assignSurfaces } from './surfaces';
import { planTrail, trailPointAt, type Trail, type TrailSpec } from './trail';

/** The shader keeps one row of numbers per card. This is how many rows it has room for. */
export const MAX_CARDS = 28;

export interface TerrainModelOptions {
  readonly terrain: TerrainSpec;
  readonly trail: TrailSpec;
  /** Ground per contour band from the bottom up, or 'auto'. Default 'auto'. */
  readonly surfaces?: readonly SurfaceKind[] | 'auto';
  /** What the host knows about the device. Phones get a coarser grid, fewer cards and smaller canvases. */
  readonly environment?: SceneEnvironment;
  /** Cards in the stack, 3 to 28. Default 22, on phones 14. */
  readonly cards?: number;
  /** Thickness of one card. Default 0.055, on phones 0.08. */
  readonly cardThickness?: number;
  /** Side of the square board the model is mounted on. Default 4. */
  readonly size?: number;
  /** Paper trees on forest bands and stones on scree bands. Default true. */
  readonly decorations?: boolean;
}

export interface TerrainPart extends ScenePart<Group> {
  readonly heightfield: Heightfield;
  /** The paper shapes, one level per card, from the sheet upward. */
  readonly levels: readonly ContourLevel[];
  /** The ground of each card. */
  readonly surfaces: readonly SurfaceKind[];
  readonly trail: Trail;
  /** Thickness of one card when the model stands. */
  readonly cardThickness: number;
  /** Height of the board the stack stands on. */
  readonly boardHeight: number;
  /** An unseen, simple skin over the model for pointer rays. `Raycaster` does not need it to be visible. */
  readonly raycastTarget: Mesh;
  /** Where each stop stands on the grown model, gate first, summit last. In the space of `object`. */
  readonly stopPositions: readonly Vector3[];
  /**
   * The point on the route at a share of the trail (0 gate, 1 summit), on top of the card it crosses, in the space
   * of `object`. The height steps from card to card; a camera should ease it.
   */
  routeAt(along: number, target?: Vector3): Vector3;
  /** The card under a point of the model (x and z in the space of `object`), or -1 beside the paper. */
  cardAt(x: number, z: number): number;
  /** The height of the top of a card right now, while the model grows or stands. */
  cardTop(card: number): number;
  /** Tints the route darker from the gate up to this share of the trail. */
  setProgress(progress: number): void;
  /**
   * How far the model has grown out of its print: 0 is a flat contour map, 1 is the standing mountain. The cards
   * follow on springs during `update`. Pass `immediate` to place them at once.
   */
  grow(amount: number, immediate?: boolean): void;
  /** Lets the model grow from flat to standing, bottom card first. */
  playGrow(seconds?: number): void;
  /** Lifts a card and everything above it a little and inks its edge in the route colour. Null puts it back. */
  setHover(card: number | null): void;
}

const BOARD_HEIGHT = 0.07;
/** Thickness of a card that still lies in the print. Not zero, so stacked flat cards do not flicker. */
const FLAT = 0.0009;
const HOVER_LIFT = 0.025;
const GROW_SECONDS = 1.25;
/**
 * The printed route, in scene units: the width of the line, the dot under a stop, and the width in screen pixels
 * below which the line is not allowed to thin out when the model is small on the screen.
 */
export const ROUTE_LINE = { width: 0.03, stopRadius: 0.05, minPixels: 3 } as const;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const smooth = (edge0: number, edge1: number, value: number): number => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};
const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

const CARD_VERTEX_HEAD = /* glsl */ `
#define TERRAIN_ROWS ${MAX_CARDS + 1}
attribute float aCard;
attribute float aWall;
uniform vec4 uCard[TERRAIN_ROWS];
uniform float uPrintScale;
varying vec2 vPrintUv;
varying vec4 vCardInfo;
varying vec3 vPaperPos;
varying float vCardGlow;
varying float vCardUp;
`;

/** Places a vertex by its card's row: where the card starts and how thick it is right now. */
const CARD_VERTEX_BODY = /* glsl */ `
#include <begin_vertex>
int cardRow = int(aCard + 0.5);
vec4 cardNow = uCard[cardRow];
transformed.y = cardNow.x + position.y * cardNow.y;
`;

const CARD_VERTEX_VARYINGS = /* glsl */ `
vPrintUv = position.xz * uPrintScale + 0.5;
vCardInfo = vec4(aWall, position.y, cardNow.z, uCard[cardRow + 1].z);
vPaperPos = vec3(position.x, transformed.y, position.z);
vCardGlow = cardNow.w;
// How far the face looks up: 1 on the top of a card, about 0.7 on the bevel of its cut edge, 0 on the edge itself.
vCardUp = normal.y;
`;

const CARD_FRAGMENT_HEAD = /* glsl */ `
uniform sampler2D uGround;
uniform sampler2D uRoute;
uniform sampler2D uGrain;
uniform float uProgress;
uniform vec3 uSignal;
uniform vec3 uWalked;
uniform vec3 uInk;
uniform vec3 uCore;
uniform vec3 uSheet;
uniform vec3 uRouteLine;
varying vec2 vPrintUv;
varying vec4 vCardInfo;
varying vec3 vPaperPos;
varying float vCardGlow;
varying float vCardUp;
`;

const CARD_FRAGMENT_BODY = /* glsl */ `
#include <color_fragment>
{
  float wall = step(0.5, vCardInfo.x);
  float top = 1.0 - wall;
  float rise = clamp(vCardInfo.z, 0.0, 1.0);
  float riseAbove = clamp(vCardInfo.w, 0.0, 1.0);
  vec3 ground = texture2D(uGround, vPrintUv).rgb;
  vec3 route = texture2D(uRoute, vPrintUv).rgb;
  vec3 paper = diffuseColor.rgb;

  // A card that still lies flat is only a line in the print, so it carries the tone of the sheet.
  paper = mix(uSheet, paper, mix(1.0, 0.25 + 0.75 * smoothstep(0.0, 0.7, rise), top));
  // The printed ground pattern.
  paper *= mix(1.0, ground.g, top);
  // The cut edge: an ink line while the card is flat, the pale core of the paper once it stands.
  float rim = (1.0 - ground.b) * top;
  vec3 rimColor = mix(mix(uInk, uCore, smoothstep(0.15, 0.7, rise)), uSignal, vCardGlow);
  paper = mix(paper, rimColor, rim * mix(0.5, 0.7, max(rise, vCardGlow)));
  // The card above presses a soft shadow on this one.
  paper *= 1.0 - (1.0 - ground.r) * top * 0.6 * smoothstep(0.0, 0.6, riseAbove);
  // Walls are darker at the foot and catch the light at the top edge.
  paper *= mix(1.0, mix(0.72, 1.05, smoothstep(0.0, 0.9, vCardInfo.y)), wall);
  // Paper fibre.
  vec2 fibreUv = mix(vPaperPos.xz, vec2(vPaperPos.x + vPaperPos.z, vPaperPos.y * 2.5), wall) * 1.7;
  float fibre = texture2D(uGrain, fibreUv).r;
  paper *= 0.86 + 0.28 * fibre;

  // The route. The canvas holds a distance ramp, so the edge stays sharp however close the camera comes.
  // Seen from far away the line would thin out to nothing. There its edge is moved out along the ramp, so the line
  // keeps a width that can be seen. uRouteLine: half the width of the line and the reach of the ramp, both in print
  // coordinates, and the least half width in screen pixels.
  float pixel = max(length(dFdx(vPrintUv)), length(dFdy(vPrintUv)));
  float bold = clamp((uRouteLine.z * pixel - uRouteLine.x) / (2.0 * uRouteLine.y), 0.0, 0.3);
  float edge = 0.5 - bold;
  float soft = clamp(fwidth(route.r) * 0.8, 0.02, min(0.3, edge - 0.05));
  // The line is printed from above. It lies on the faces and on the bevel of a cut edge and never runs down the
  // edge itself: on steep ground it steps from card to card.
  float printed = smoothstep(0.35, 0.6, vCardUp);
  float inked = smoothstep(edge - soft, edge + soft, route.r) * printed;
  float walked = smoothstep(-0.004, 0.004, uProgress - route.b);
  vec3 ink = mix(uSignal, uWalked, walked) * (0.76 + 0.3 * fibre);
  paper = mix(paper, ink, inked * 0.96);

  diffuseColor.rgb = paper;
}
`;

interface CardUniforms {
  uCard: { value: Vector4[] };
  uPrintScale: { value: number };
  uGround: { value: Texture };
  uRoute: { value: Texture };
  uGrain: { value: Texture };
  uProgress: { value: number };
  uSignal: { value: Color };
  uWalked: { value: Color };
  uInk: { value: Color };
  uCore: { value: Color };
  uSheet: { value: Color };
  uRouteLine: { value: Vector3 };
}

function patchCardVertex(shader: WebGLProgramParametersWithUniforms, uniforms: CardUniforms, withVaryings: boolean): void {
  shader.uniforms.uCard = uniforms.uCard;
  shader.uniforms.uPrintScale = uniforms.uPrintScale;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${CARD_VERTEX_HEAD}`)
    .replace('#include <begin_vertex>', withVaryings ? CARD_VERTEX_BODY + CARD_VERTEX_VARYINGS : CARD_VERTEX_BODY);
}

/** A texture of one flat value, for where no canvas can be had. */
function plainTexture(r: number, g: number, b: number): DataTexture {
  const texture = new DataTexture(new Uint8Array([r, g, b, 255]), 1, 1);
  texture.colorSpace = NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function numberTexture(canvas: HTMLCanvasElement, repeat: boolean, anisotropy: number): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  // The canvases hold numbers, not colours: no colour conversion, and row 0 of the canvas is v = 0.
  texture.colorSpace = NoColorSpace;
  texture.flipY = false;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = anisotropy;
  if (repeat) {
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
  }
  return texture;
}

/** Paper colour of a ground surface: the palette colour pulled toward paper, so it still reads as a sheet of card. */
function paperTint(kind: SurfaceKind): Color {
  const keep: Record<SurfaceKind, number> = {
    water: 0.9,
    sand: 0.86,
    grass: 0.86,
    forest: 0.8,
    dirt: 0.8,
    scree: 0.84,
    rock: 0.86,
    snow: 1,
  };
  return new Color(PALETTE.paper).lerp(new Color(PALETTE.surface[kind]), keep[kind]);
}

function polygonShape(polygon: ContourPolygon, half: number): Shape {
  // Shapes are drawn in x and y and extruded along z. Turning the result up puts shape y on -z and the depth on y.
  const shape = new Shape(polygon.outer.map((p) => new Vector2(p.x * half, -p.z * half)));
  for (const hole of polygon.holes) shape.holes.push(new Path(hole.map((p) => new Vector2(p.x * half, -p.z * half))));
  return shape;
}

/**
 * All cards in one geometry. Each level is extruded with a slight bevel, turned upright and squeezed to a height of
 * 1, so the shader can give every card its own thickness. Faces that could never be seen (the undersides) are left
 * out.
 */
function buildCards(levels: readonly ContourLevel[], half: number, thickness: number, tops: readonly Color[], walls: readonly Color[]): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const cards: number[] = [];
  const wallFlags: number[] = [];
  const bevel = Math.min(0.006, thickness * 0.14);

  levels.forEach((level, card) => {
    if (level.polygons.length === 0) return;
    const extruded = new ExtrudeGeometry(
      level.polygons.map((polygon) => polygonShape(polygon, half)),
      {
        depth: thickness - 2 * bevel,
        bevelEnabled: true,
        bevelThickness: bevel,
        bevelSize: bevel,
        bevelOffset: -bevel,
        bevelSegments: 1,
        steps: 1,
        curveSegments: 1,
      },
    );
    const position = extruded.getAttribute('position');
    const normal = extruded.getAttribute('normal');
    const lids = extruded.groups.find((group) => group.materialIndex === 0);
    const lidStart = lids?.start ?? 0;
    const lidEnd = lidStart + (lids?.count ?? 0);
    const top = tops[card] as Color;
    const wall = walls[card] as Color;
    for (let v = 0; v + 2 < position.count; v += 3) {
      const isLid = v >= lidStart && v < lidEnd;
      if (isLid && normal.getZ(v) < 0) continue;
      const color = isLid ? top : wall;
      for (let corner = v; corner < v + 3; corner += 1) {
        positions.push(position.getX(corner), (position.getZ(corner) + bevel) / thickness, -position.getY(corner));
        normals.push(normal.getX(corner), normal.getZ(corner), -normal.getY(corner));
        colors.push(color.r, color.g, color.b);
        cards.push(card);
        wallFlags.push(isLid ? 0 : 1);
      }
    }
    extruded.dispose();
  });

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setAttribute('aCard', new Float32BufferAttribute(cards, 1));
  geometry.setAttribute('aWall', new Float32BufferAttribute(wallFlags, 1));
  // The shader moves the vertices, so the bounds are set by hand to cover the standing model.
  const height = BOARD_HEIGHT + levels.length * thickness + HOVER_LIFT;
  geometry.boundingSphere = new Sphere(new Vector3(0, height / 2, 0), Math.hypot(half * Math.SQRT2, height / 2));
  return geometry;
}

function buildBoard(size: number): BufferGeometry {
  const half = size / 2;
  const bevel = 0.012;
  const radius = 0.07;
  const edge = half - bevel;
  const shape = new Shape();
  shape.moveTo(-edge + radius, -edge);
  shape.lineTo(edge - radius, -edge);
  shape.quadraticCurveTo(edge, -edge, edge, -edge + radius);
  shape.lineTo(edge, edge - radius);
  shape.quadraticCurveTo(edge, edge, edge - radius, edge);
  shape.lineTo(-edge + radius, edge);
  shape.quadraticCurveTo(-edge, edge, -edge, edge - radius);
  shape.lineTo(-edge, -edge + radius);
  shape.quadraticCurveTo(-edge, -edge, -edge + radius, -edge);
  const geometry = new ExtrudeGeometry(shape, {
    depth: BOARD_HEIGHT - 2 * bevel,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 6,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, bevel, 0);
  return geometry;
}

interface Placed {
  readonly x: number;
  readonly z: number;
  readonly card: number;
  readonly scale: number;
  readonly yaw: number;
  readonly squash: number;
}

/** Scatters small things on the bands of one surface: off the route, off the card edges, not on top of each other. */
function scatter(
  levels: readonly ContourLevel[],
  surfaces: readonly SurfaceKind[],
  kind: SurfaceKind,
  trail: Trail,
  seed: number | string,
  limit: number,
  spacing: number,
): Placed[] {
  const random = fork(seed, `terrain/scatter/${kind}`);
  const placed: Placed[] = [];
  if (!surfaces.includes(kind)) return placed;
  const edge = 0.012;
  const clear = 0.05;
  for (let attempt = 0; attempt < limit * 30 && placed.length < limit; attempt += 1) {
    const x = range(random, -0.95, 0.95);
    const z = range(random, -0.95, 0.95);
    const scale = range(random, 0.7, 1.25);
    const yaw = range(random, 0, Math.PI * 2);
    const squash = range(random, 0.55, 1);
    const card = levelIndexAt(levels, x, z);
    if (card < 0 || surfaces[card] !== kind) continue;
    if (
      levelIndexAt(levels, x + edge, z) !== card ||
      levelIndexAt(levels, x - edge, z) !== card ||
      levelIndexAt(levels, x, z + edge) !== card ||
      levelIndexAt(levels, x, z - edge) !== card
    ) {
      continue;
    }
    let free = true;
    for (const p of trail.points) {
      if (Math.abs(p.x - x) < clear && Math.abs(p.z - z) < clear && Math.hypot(p.x - x, p.z - z) < clear) {
        free = false;
        break;
      }
    }
    if (!free) continue;
    for (const other of placed) {
      if (Math.hypot(other.x - x, other.z - z) < spacing) {
        free = false;
        break;
      }
    }
    if (free) placed.push({ x, z, card, scale, yaw, squash });
  }
  return placed;
}

/**
 * Builds the paper mountain: a stack of contour cards on a mounted board, with the route printed on the cards, a
 * gate at the foot, flags at the camps and the summit, and small paper trees and stones.
 */
export function createTerrainModel(options: TerrainModelOptions): TerrainPart {
  const environment = options.environment;
  const phone = environment?.phone ?? false;
  const size = options.size ?? 4;
  const half = size / 2 - size * 0.03;
  const cardCount = Math.round(clamp(options.cards ?? (phone ? 14 : 22), 3, MAX_CARDS));
  const thickness = clamp(options.cardThickness ?? (phone ? 0.08 : 0.055), 0.01, 0.2);
  const seed = options.terrain.seed;

  // The pure core: heights, paper shapes, the way up, and the ground of each band.
  const heightfield = generateHeightfield({ ...options.terrain, resolution: options.terrain.resolution ?? (phone ? 65 : 129) });
  const levels = traceContours(heightfield, levelHeights(cardCount), { simplify: phone ? 0.005 : 0.003 });
  const trail = planTrail(heightfield, { ...options.trail, footHeight: options.trail.footHeight ?? 1.5 / cardCount });
  const surfaces = assignSurfaces(levels, options.surfaces ?? 'auto', seed, { template: heightfield.template });

  const root = new Group();
  root.name = 'terrain';
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(thing: T): T => {
    disposables.push(thing);
    return thing;
  };

  // Colours. Neighbouring cards of one surface differ a little, so every step can be read.
  const coreColor = new Color(PALETTE.paperHi);
  const topColors = surfaces.map((kind, card) => paperTint(kind).multiplyScalar(card % 2 === 0 ? 1 : 0.955));
  // Card is dyed through: its cut edge has the colour of its face, a little paler and, being rough, a little duller.
  const wallColors = topColors.map((tint) => tint.clone().lerp(coreColor, 0.15).multiplyScalar(0.84));

  // Canvases: fibre, ground print, route print.
  const textureSize = Math.min(2048, Math.max(256, environment?.maxTexture ?? 2048));
  const unit = textureSize / (2 * half);
  const anisotropy = phone ? 2 : 8;
  const lineWidth = ROUTE_LINE.width;
  const stopRadius = ROUTE_LINE.stopRadius;

  let grainTexture: Texture = plainTexture(128, 128, 128);
  const grain = createCanvas(phone ? 256 : 512);
  if (grain) {
    paintGrain(grain.context, grain.canvas.width, fork(seed, 'terrain/grain'));
    grainTexture = numberTexture(grain.canvas, true, anisotropy);
  }
  let groundTexture: Texture = plainTexture(255, 255, 255);
  const ground = createCanvas(textureSize);
  if (ground) {
    paintGround(ground.context, { size: textureSize, unit, levels, surfaces, random: fork(seed, 'terrain/print') });
    groundTexture = numberTexture(ground.canvas, false, anisotropy);
  }
  let routeTexture: Texture = plainTexture(0, 0, 0);
  const route = createCanvas(textureSize);
  if (route) {
    paintRoute(route.context, { size: textureSize, unit, half, trail, lineWidth, stopRadius });
    routeTexture = numberTexture(route.canvas, false, anisotropy);
  }
  keep(grainTexture);
  keep(groundTexture);
  keep(routeTexture);

  const uniforms: CardUniforms = {
    uCard: { value: Array.from({ length: MAX_CARDS + 1 }, () => new Vector4(0, 0, 0, 0)) },
    uPrintScale: { value: 1 / (2 * half) },
    uGround: { value: groundTexture },
    uRoute: { value: routeTexture },
    uGrain: { value: grainTexture },
    uProgress: { value: 0 },
    uSignal: { value: new Color(PALETTE.signal).lerp(new Color(PALETTE.signalDeep), 0.25) },
    uWalked: { value: new Color(PALETTE.signalDeep).lerp(new Color(PALETTE.ink), 0.45) },
    uInk: { value: new Color(PALETTE.ink) },
    uCore: { value: coreColor },
    uSheet: { value: topColors[0]?.clone() ?? new Color(PALETTE.paper) },
    uRouteLine: { value: new Vector3((lineWidth / 2) / (2 * half), (lineWidth * ROUTE_RAMP) / (2 * half), ROUTE_LINE.minPixels / 2) },
  };

  // The cards: one mesh, one material. It stays a standard material, so lamps and shadow maps keep working.
  const cardMaterial = keep(
    new MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.94,
      metalness: 0,
      envMap: environment?.envMap ?? null,
      envMapIntensity: 0.55,
    }),
  );
  cardMaterial.onBeforeCompile = (shader) => {
    patchCardVertex(shader, uniforms, true);
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${CARD_FRAGMENT_HEAD}`)
      .replace('#include <color_fragment>', CARD_FRAGMENT_BODY);
  };
  cardMaterial.customProgramCacheKey = () => 'zero-to-terrain-card';
  // The shadow pass has to move the cards the same way, or the shadows would stay behind while the model grows.
  const depthMaterial = keep(new MeshDepthMaterial({ depthPacking: RGBADepthPacking }));
  depthMaterial.onBeforeCompile = (shader) => patchCardVertex(shader, uniforms, false);
  depthMaterial.customProgramCacheKey = () => 'zero-to-terrain-card-depth';

  const cards = new Mesh(keep(buildCards(levels, half, thickness, topColors, wallColors)), cardMaterial);
  cards.name = 'terrain-cards';
  cards.customDepthMaterial = depthMaterial;
  cards.castShadow = true;
  cards.receiveShadow = true;
  root.add(cards);

  // The board the map is mounted on.
  const boardMaterial = keep(
    new MeshStandardMaterial({
      color: new Color(PALETTE.ink).lerp(new Color(PALETTE.night), 0.25),
      roughness: 0.62,
      metalness: 0,
      envMap: environment?.envMap ?? null,
      envMapIntensity: 0.7,
    }),
  );
  const board = new Mesh(keep(buildBoard(size)), boardMaterial);
  board.name = 'terrain-board';
  board.castShadow = true;
  board.receiveShadow = true;
  root.add(board);

  // A simple skin for pointer rays.
  const skinSegments = phone ? 32 : 64;
  const skinGeometry = keep(new PlaneGeometry(2 * half, 2 * half, skinSegments, skinSegments));
  skinGeometry.rotateX(-Math.PI / 2);
  const skinPosition = skinGeometry.getAttribute('position');
  for (let i = 0; i < skinPosition.count; i += 1) {
    const h = heightfield.sample(skinPosition.getX(i) / half, skinPosition.getZ(i) / half);
    skinPosition.setY(i, BOARD_HEIGHT + thickness * Math.min(cardCount, 1 + Math.floor(h * cardCount)));
  }
  skinGeometry.computeBoundingSphere();
  skinGeometry.computeBoundingBox();
  const skinMaterial = keep(new MeshBasicMaterial({ visible: false }));
  const raycastTarget = new Mesh(skinGeometry, skinMaterial);
  raycastTarget.name = 'terrain-raycast';
  raycastTarget.visible = false;
  root.add(raycastTarget);

  // Where things stand when the model is fully grown.
  const standingTop = (card: number): number => BOARD_HEIGHT + (clamp(card, 0, cardCount - 1) + 1) * thickness;
  const cardOf = (x: number, z: number): number => levelIndexAt(levels, x, z);
  const stopCards = trail.stops.map((stop) => Math.max(0, cardOf(stop.x, stop.z)));
  const stopPositions = trail.stops.map((stop, index) => new Vector3(stop.x * half, standingTop(stopCards[index] as number), stop.z * half));

  // Flags at the camps and the summit, a gate at the foot.
  const stopCount = trail.stops.length;
  const flagCount = stopCount - 1;
  const poleMaterial = keep(new MeshStandardMaterial({ color: new Color(PALETTE.paperHi), roughness: 0.8 }));
  const flagMaterial = keep(new MeshStandardMaterial({ color: new Color(PALETTE.signal), roughness: 0.85, side: DoubleSide }));
  const gateMaterial = keep(new MeshStandardMaterial({ color: new Color(PALETTE.paperHi), roughness: 0.85 }));
  const poleGeometry = keep(new CylinderGeometry(0.006, 0.008, 1, 6));
  poleGeometry.translate(0, 0.5, 0);
  const flagGeometry = keep(new BufferGeometry());
  flagGeometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0.1, -0.03, 0, 0, -0.06, 0], 3));
  flagGeometry.setAttribute('normal', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  const poles = new InstancedMesh(poleGeometry, poleMaterial, Math.max(1, flagCount));
  const flags = new InstancedMesh(flagGeometry, flagMaterial, Math.max(1, flagCount));
  const gate = new InstancedMesh(keep(new BoxGeometry(1, 1, 1)), gateMaterial, 3);
  for (const mesh of [poles, flags, gate]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    root.add(mesh);
  }
  poles.name = 'terrain-poles';
  flags.name = 'terrain-flags';
  gate.name = 'terrain-gate';
  // The gate stands across the first steps of the trail.
  const gateStop = trail.stops[0];
  const gateAhead = trailPointAt(trail, Math.min(1, 0.06 / Math.max(0.06, trail.length)));
  const gateYaw = gateStop ? Math.atan2(gateAhead.x - gateStop.x, gateAhead.z - gateStop.z) : 0;

  // Paper trees and stones.
  const wantDecor = options.decorations ?? true;
  const trees = wantDecor ? scatter(levels, surfaces, 'forest', trail, seed, phone ? 60 : 190, 0.034) : [];
  const stones = wantDecor ? scatter(levels, surfaces, 'scree', trail, seed, phone ? 24 : 80, 0.045) : [];
  let treeMesh: InstancedMesh | null = null;
  let stoneMesh: InstancedMesh | null = null;
  if (trees.length > 0) {
    const geometry = keep(new ConeGeometry(0.03, 0.1, 4, 1));
    geometry.translate(0, 0.05, 0);
    const material = keep(
      new MeshStandardMaterial({
        color: paperTint('forest').lerp(new Color(PALETTE.surface.forest), 0.35),
        roughness: 0.95,
        flatShading: true,
      }),
    );
    treeMesh = new InstancedMesh(geometry, material, trees.length);
    treeMesh.name = 'terrain-trees';
  }
  if (stones.length > 0) {
    const geometry = keep(new DodecahedronGeometry(0.024, 0));
    geometry.translate(0, 0.012, 0);
    const material = keep(new MeshStandardMaterial({ color: paperTint('rock').multiplyScalar(0.94), roughness: 0.95, flatShading: true }));
    stoneMesh = new InstancedMesh(geometry, material, stones.length);
    stoneMesh.name = 'terrain-stones';
  }
  for (const mesh of [treeMesh, stoneMesh]) {
    if (!mesh) continue;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    root.add(mesh);
  }

  // Growth: one spring per card, each chasing its place in a wave that runs up the stack.
  const rise = new Float32Array(cardCount).fill(1);
  const speed = new Float32Array(cardCount);
  const tops = new Float32Array(cardCount);
  const shown = new Float32Array(cardCount);
  const spread = clamp(cardCount * 0.32, 2, 7);
  let grown = 1;
  let playing = false;
  let playSeconds = GROW_SECONDS;
  let hoverCard = -1;
  let hoverWanted = 0;
  let hoverNow = 0;
  let hoverSpeed = 0;
  let awake = true;

  const wanted = (card: number): number => clamp((grown * (cardCount - 1 + spread) - card) / spread, 0, 1);

  const matrix = new Matrix4();
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  const up = new Vector3(0, 1, 0);

  const place = (): void => {
    let y = BOARD_HEIGHT;
    for (let card = 0; card < cardCount; card += 1) {
      const r = rise[card] as number;
      // Past its target the spring carries the card a little too far, and that overshoot is shown larger.
      const f = r <= 1 ? easeInOutCubic(Math.max(0, r)) : 1 + (r - 1) * 1.2;
      const now = Math.max(FLAT, thickness * f);
      const lifted = hoverCard >= 0 && card >= hoverCard ? hoverNow * HOVER_LIFT : 0;
      (uniforms.uCard.value[card] as Vector4).set(y + lifted, now, f, card === hoverCard ? hoverNow : 0);
      tops[card] = y + lifted + now;
      shown[card] = smooth(0.5, 1, f);
      y += now;
    }

    for (let i = 0; i < flagCount; i += 1) {
      const stopIndex = i + 1;
      const stop = trail.stops[stopIndex];
      if (!stop) continue;
      const card = stopCards[stopIndex] as number;
      const pop = shown[card] as number;
      const summit = stopIndex === stopCount - 1;
      const height = (summit ? 0.3 : 0.19) * pop;
      const top = tops[card] as number;
      matrix.compose(position.set(stop.x * half, top, stop.z * half), quaternion.identity(), scale.set(summit ? 1.3 : 1, Math.max(1e-4, height), summit ? 1.3 : 1));
      poles.setMatrixAt(i, matrix);
      const flagSize = (summit ? 1.5 : 1) * pop;
      matrix.compose(position.set(stop.x * half, top + height, stop.z * half), quaternion.identity(), scale.set(Math.max(1e-4, flagSize), Math.max(1e-4, flagSize), 1));
      flags.setMatrixAt(i, matrix);
    }
    poles.instanceMatrix.needsUpdate = true;
    flags.instanceMatrix.needsUpdate = true;

    if (gateStop) {
      const card = stopCards[0] as number;
      const pop = shown[card] as number;
      const top = tops[card] as number;
      const postHeight = 0.13 * pop;
      const span = 0.075;
      quaternion.setFromAxisAngle(up, gateYaw);
      const sideX = Math.cos(gateYaw);
      const sideZ = -Math.sin(gateYaw);
      for (let side = 0; side < 2; side += 1) {
        const sign = side === 0 ? -1 : 1;
        matrix.compose(
          position.set(gateStop.x * half + sideX * span * sign, top + postHeight / 2, gateStop.z * half + sideZ * span * sign),
          quaternion,
          scale.set(0.016, Math.max(1e-4, postHeight), 0.016),
        );
        gate.setMatrixAt(side, matrix);
      }
      matrix.compose(
        position.set(gateStop.x * half, top + postHeight, gateStop.z * half),
        quaternion,
        scale.set(Math.max(1e-4, (span * 2 + 0.05) * pop), Math.max(1e-4, 0.02 * pop), 0.02),
      );
      gate.setMatrixAt(2, matrix);
      gate.instanceMatrix.needsUpdate = true;
    }

    const stand = (mesh: InstancedMesh | null, things: readonly Placed[], squashed: boolean): void => {
      if (!mesh) return;
      things.forEach((thing, i) => {
        const pop = shown[thing.card] as number;
        // Nothing stands on a card that still lies in the print: things unfold as their card comes up.
        const wide = Math.max(1e-4, thing.scale * Math.sqrt(pop));
        quaternion.setFromAxisAngle(up, thing.yaw);
        matrix.compose(
          position.set(thing.x * half, tops[thing.card] as number, thing.z * half),
          quaternion,
          scale.set(wide, Math.max(1e-4, thing.scale * pop * (squashed ? thing.squash : 0.8 + 0.4 * thing.squash)), wide),
        );
        mesh.setMatrixAt(i, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    };
    stand(treeMesh, trees, false);
    stand(stoneMesh, stones, true);
  };

  const settle = (): void => {
    for (let card = 0; card < cardCount; card += 1) {
      rise[card] = wanted(card);
      speed[card] = 0;
    }
    hoverNow = hoverWanted;
    hoverSpeed = 0;
    place();
  };
  settle();

  const walkedBias = routeBleed({ lineWidth }) / Math.max(0.2, trail.length * half);

  const part: TerrainPart = {
    object: root,
    heightfield,
    levels,
    surfaces,
    trail,
    cardThickness: thickness,
    boardHeight: BOARD_HEIGHT,
    raycastTarget,
    stopPositions,

    routeAt(along, target = new Vector3()) {
      const point = trailPointAt(trail, along);
      return target.set(point.x * half, standingTop(Math.max(0, cardOf(point.x, point.z))), point.z * half);
    },

    cardAt(x, z) {
      return cardOf(x / half, z / half);
    },

    cardTop(card) {
      return tops[Math.round(clamp(card, 0, cardCount - 1))] as number;
    },

    setProgress(progress) {
      const p = clamp(Number.isFinite(progress) ? progress : 0, 0, 1);
      // The blue channel runs a little ahead of the line it lies under; the bias takes that back out.
      uniforms.uProgress.value = p <= 0 ? -1 : p >= 1 ? 2 : p + walkedBias;
    },

    grow(amount, immediate = false) {
      grown = clamp(Number.isFinite(amount) ? amount : 1, 0, 1);
      playing = false;
      awake = true;
      if (immediate) settle();
    },

    playGrow(seconds = GROW_SECONDS) {
      playSeconds = Math.max(0.05, seconds);
      grown = 0;
      settle();
      playing = true;
      awake = true;
    },

    setHover(card) {
      const next = card === null || !Number.isFinite(card) || card < 0 ? -1 : Math.round(clamp(card, 0, cardCount - 1));
      if (next === hoverCard) return;
      if (next >= 0) {
        hoverCard = next;
        hoverWanted = 1;
      } else {
        hoverWanted = 0;
      }
      awake = true;
    },

    update(frame: FrameTime) {
      if (!awake) return;
      if (frame.reduced) {
        if (playing) grown = 1;
        playing = false;
        settle();
        if (hoverWanted === 0) hoverCard = -1;
        awake = false;
        return;
      }
      const dt = clamp(frame.dt, 0, 0.1);
      const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
      const h = dt / steps;
      let moving = playing;
      for (let step = 0; step < steps; step += 1) {
        if (playing) {
          grown = Math.min(1, grown + h / playSeconds);
          if (grown >= 1) playing = false;
        }
        for (let card = 0; card < cardCount; card += 1) {
          const goal = wanted(card);
          let v = (speed[card] as number) + ((goal - (rise[card] as number)) * 150 - (speed[card] as number) * 12) * h;
          let r = (rise[card] as number) + v * h;
          if (r < 0) {
            r = 0;
            v = 0;
          }
          rise[card] = r;
          speed[card] = v;
          if (Math.abs(goal - r) > 5e-4 || Math.abs(v) > 5e-3) moving = true;
        }
        hoverSpeed += ((hoverWanted - hoverNow) * 260 - hoverSpeed * 24) * h;
        hoverNow += hoverSpeed * h;
        if (Math.abs(hoverWanted - hoverNow) > 5e-4 || Math.abs(hoverSpeed) > 5e-3) moving = true;
      }
      if (!moving) {
        settle();
        if (hoverWanted === 0) hoverCard = -1;
        awake = false;
        return;
      }
      place();
    },

    dispose() {
      root.removeFromParent();
      for (const mesh of [poles, flags, gate, treeMesh, stoneMesh]) mesh?.dispose();
      for (const thing of disposables) thing.dispose();
      disposables.length = 0;
    },
  };

  return part;
}

/** The materials of a part, for hosts that want to set the environment map after the fact. */
export function terrainMaterials(part: TerrainPart): Material[] {
  const found = new Set<Material>();
  part.object.traverse((child) => {
    const material = (child as Mesh).material;
    if (Array.isArray(material)) material.forEach((m) => found.add(m));
    else if (material) found.add(material);
  });
  return [...found];
}
