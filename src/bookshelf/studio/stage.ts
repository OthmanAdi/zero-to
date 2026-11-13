import {
  BoxGeometry,
  Color,
  CustomToneMapping,
  DirectionalLight,
  Group,
  HemisphereLight,
  type Material,
  Mesh,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  ShaderChunk,
  SpotLight,
  SRGBColorSpace,
  type Texture,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { ShelfFrame } from '../shelf/types';
import { createBudget, startingDensity, type Budget } from './budget';
import { canvasBox, type CanvasBox, fitCamera, rowOrigin } from './camera';
import { follow, follower, FOLLOW_MS, HOME_MS } from './pointer';

/**
 * The lit room Studio draws in: renderer, camera, a key light that casts soft shadows, a fill from the
 * sky, an environment for reflections, and the board the volumes stand on. It draws only when asked.
 */

/** Most device pixels per CSS px the canvas is drawn at: enough for a page zoomed to 400 %. */
const MAX_DENSITY = 4;
/** Above this many device pixels the density is lowered, so a large window stays smooth. */
const MAX_PIXELS = 5_200_000;

export interface Room {
  /** Colour of the board's top and front. */
  board: string;
  /** Whether a lamp stands over the row (the Night look) instead of a window light. */
  lamp: boolean;
  /** Strength of the key light: lux from a window, or lux on the presented cover from the lamp. */
  key: number;
  /** Strength of the environment in reflections and fill. */
  environment: number;
  /** Colour temperature of the key, as a colour. */
  keyColor: string;
  /** Exposure the picture is developed at. */
  exposure: number;
  /** Strength of the light from the sky and back off the board. */
  sky: number;
  /** Height of the board's front edge, in px. */
  lip: number;
  /** How far the board reaches in front of the spines, as a share of the deepest volume. */
  front: number;
  /** How dark the contact shadows are, 0 to 1. */
  contact: number;
}

/*
 * Exposure and sky are set so a cream spine, a mustard one and the board come out within a few steps of
 * the CSS drawing of the same look: switching drawings changes the material, not the brightness.
 */
export const ROOMS: Record<string, Room> = {
  paper: { board: '#e2dccd', lamp: false, key: 2.3, environment: 0.16, keyColor: '#fffaf3', exposure: 1.66, sky: 0.55, lip: 6, front: 0.2, contact: 0.62 },
  oak: { board: '#7a5636', lamp: false, key: 2.45, environment: 0.16, keyColor: '#fff8ee', exposure: 1.73, sky: 0.7, lip: 8, front: 0.42, contact: 0.66 },
  night: { board: '#2a211b', lamp: true, key: 5.2, environment: 0.08, keyColor: '#ffe3c0', exposure: 1.15, sky: 0.55, lip: 5, front: 0.85, contact: 0.5 },
  pocket: { board: '#d2bd98', lamp: false, key: 2.2, environment: 0.16, keyColor: '#fffbf5', exposure: 1.78, sky: 0.55, lip: 6, front: 0.2, contact: 0.62 },
};

export function roomOf(variant: string): Room {
  return ROOMS[variant] ?? ROOMS.paper!;
}

/** Where the highlights begin to roll off, and how much a bright colour pales as it does. */
export const SHOULDER = 0.76;
const DESATURATION = 0.15;

/**
 * The tone curve, on the brightest channel: a straight line up to SHOULDER, then a shoulder that reaches
 * white only for an endlessly bright light. It is three's neutral curve without the offset that curve
 * takes off every channel: the offset is there to cancel a veil of ambient light, and with the little
 * ambient light of these rooms it only made dark cloth darker and yellower.
 */
export function shoulder(peak: number): number {
  if (peak < SHOULDER) return peak;
  const d = 1 - SHOULDER;
  return 1 - (d * d) / (peak + d - SHOULDER);
}

const TONE_STUB = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
/**
 * Strength of the toe, in linear light after exposure: a value this dark comes out at half, a cream at
 * about 96 percent. The diffuse sky that lights a shelf from all round lifts the darks; the toe takes
 * that lift back without taking the room's light away.
 */
const TOE = '0.03';

const TONE_CURVE = /* glsl */ `vec3 CustomToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	// A toe: the darks go down toward the depth the CSS drawing gives them, the light tones hardly move.
	color = color * color / ( color + ${TOE} );
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < ${SHOULDER} ) return color;
	float d = 1.0 - ${SHOULDER};
	float newPeak = 1.0 - d * d / ( peak + d - ${SHOULDER} );
	color *= newPeak / peak;
	float g = 1.0 - 1.0 / ( ${DESATURATION} * ( peak - newPeak ) + 1.0 );
	return mix( color, vec3( newPeak ), g );
}`;

/** Develops a renderer's picture for a room: Studio's tone curve at the room's exposure. */
export function develop(renderer: WebGLRenderer, room: Room): void {
  if (ShaderChunk.tonemapping_pars_fragment.includes(TONE_STUB)) {
    ShaderChunk.tonemapping_pars_fragment = ShaderChunk.tonemapping_pars_fragment.replace(TONE_STUB, TONE_CURVE);
  }
  renderer.toneMapping = CustomToneMapping;
  renderer.toneMappingExposure = room.exposure;
}

const DEG = Math.PI / 180;
/** Where the key stands at rest: to the left of the viewer and above, the same place as the room's key box. */
export const KEY_AZIMUTH = -38 * DEG;
export const KEY_ELEVATION = 42 * DEG;
/** How far the key swings with the pointer, in radians: enough to move a highlight, not the colour of the room. */
export const KEY_SWING = 0.3;
export const KEY_RISE = 0.1;

/** Direction toward the key for a pointer place of -1 to 1 each way, and how far the room turns with it. */
export function keyAim(px: number, py: number): { x: number; y: number; z: number; yaw: number; pitch: number } {
  const yaw = Math.max(-0.35, Math.min(0.35, px * KEY_SWING));
  const pitch = -py * KEY_RISE;
  const azimuth = KEY_AZIMUTH + yaw;
  const elevation = KEY_ELEVATION + pitch;
  return {
    x: Math.sin(azimuth) * Math.cos(elevation),
    y: Math.sin(elevation),
    z: Math.cos(azimuth) * Math.cos(elevation),
    yaw,
    pitch,
  };
}

export class Stage {
  readonly renderer: WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(30, 1, 1, 10000);
  /** Everything that stands on the board: volumes and bookends. */
  readonly row = new Group();
  /**
   * Set by a caller that calls `advance` with every frame and `touch` when something that casts a shadow
   * moved. The light then follows the pointer with a lag and shadows are drawn only when asked for. Left
   * false, the light goes to the pointer at once and every frame draws its shadows, which is right for a
   * caller that draws one book and knows of neither.
   */
  paced = false;
  /** By day the window light. At night, when the lamp is the key, a cool rim from behind for separation. */
  private readonly key = new DirectionalLight('#fff6ea', 2.3);
  private readonly lamp = new SpotLight('#ffe3c0', 0, 0, 1.0, 0.8, 2);
  private readonly sky = new HemisphereLight('#f6f1ea', '#5d544a', 0.55);
  private readonly board: Mesh;
  private readonly boardMaterial: MeshStandardMaterial;
  private box: CanvasBox | null = null;
  private size = { width: 0, height: 0, perspective: 0, density: 0 };
  /** What this device can afford, learnt from how long frames take; it only ever goes down. */
  private budget: Budget = createBudget(1);
  private room: Room = roomOf('paper');
  private boardOverride: Material | null = null;
  /** Pointer place over the scene, -1 to 1 each way, following the hand with a short lag; the light leans toward it. */
  private readonly pointer = follower();
  private homing = false;
  private stepped = 0;
  private origin = { x: 0, y: 0 };
  private span = 1000;
  private depth = 300;
  private tallest = 400;
  private lampX = 0;
  private floorY = 30;
  private shadowSize = 0;
  private stale = true;
  private readonly corner = new Vector3();
  private readonly forward = new Vector3();
  private readonly right = new Vector3();
  private readonly up = new Vector3();

  constructor(canvas = document.createElement('canvas')) {
    this.canvas = canvas;
    this.renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
    this.budget = createBudget(startingDensity(window.devicePixelRatio || 1, rendererName(this.renderer), MAX_DENSITY));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    // A shadow map is drawn again only when something that casts or the light itself has moved.
    this.renderer.shadowMap.autoUpdate = false;

    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.6;
    this.lamp.shadow.bias = -0.0005;
    this.lamp.shadow.normalBias = 0.5;
    this.scene.add(this.key, this.key.target, this.lamp, this.lamp.target, this.sky, this.row);

    // The board the row stands on: a top running back under the volumes and a front edge facing the viewer.
    this.boardMaterial = new MeshStandardMaterial({ color: '#e9e3d6', roughness: 0.82, metalness: 0 });
    this.board = new Mesh(new BoxGeometry(1, 1, 1), this.boardMaterial);
    this.board.receiveShadow = true;
    this.scene.add(this.board);
    this.setRoom('paper');
  }

  setEnvironment(texture: Texture | null): void {
    this.scene.environment = texture;
  }

  /** A material for the board from a material kit; null keeps the plain one. */
  setBoardMaterial(material: Material | null): void {
    this.boardOverride = material;
    this.board.material = material ?? this.boardMaterial;
  }

  setRoom(variant: string): void {
    this.room = roomOf(variant);
    const room = this.room;
    this.boardMaterial.color.set(room.board);
    this.lamp.color.set(room.keyColor);
    this.key.color.set(room.lamp ? RIM_COLOR : room.keyColor);
    // Only the light that lights the room casts shadows: a shadow pass for a light that is off is a third of the frame.
    this.key.castShadow = !room.lamp;
    this.lamp.castShadow = room.lamp;
    // Light coming back off the board has the colour of the board, so pale books on a pale board keep clean shade sides.
    this.sky.color.set(room.lamp ? '#93a0bd' : '#eef3fc');
    this.sky.groundColor.set(room.board).multiplyScalar(room.lamp ? 0.9 : 0.8);
    this.sky.intensity = room.sky;
    this.scene.environmentIntensity = room.environment;
    develop(this.renderer, room);
    if (!this.boardOverride) this.board.material = this.boardMaterial;
    this.stale = true;
  }

  /** Where the pointer is, -1 to 1 each way. The light goes there over the next moments, see `advance`. */
  setPointer(x: number, y: number): void {
    this.pointer.targetX = Math.max(-1, Math.min(1, x));
    this.pointer.targetY = Math.max(-1, Math.min(1, y));
    this.homing = false;
    if (this.paced) return;
    this.pointer.x = this.pointer.targetX;
    this.pointer.y = this.pointer.targetY;
    this.aimLights();
  }

  /** The pointer has left or lies still: the light drifts back to where it rests. */
  home(): void {
    this.pointer.targetX = 0;
    this.pointer.targetY = 0;
    this.homing = true;
  }

  /** Puts the light at rest at once, for a person who asked for less motion. */
  pin(): void {
    this.home();
    if (this.pointer.x !== 0 || this.pointer.y !== 0) this.stale = true;
    this.pointer.x = 0;
    this.pointer.y = 0;
  }

  /** Where the hand is, as last told: what the presented volume leans toward. */
  get aim(): { x: number; y: number } {
    return { x: this.pointer.targetX, y: this.pointer.targetY };
  }

  /**
   * Moves the light on toward the pointer for the time since the last frame. Returns whether it is still
   * on its way, so the caller knows to draw again; once it returns false nothing moves and nothing need be drawn.
   */
  advance(now: number): boolean {
    const dt = this.stepped === 0 ? 16 : Math.min(64, Math.max(0, now - this.stepped));
    const { x, y } = this.pointer;
    const moving = follow(this.pointer, dt, this.homing ? HOME_MS : FOLLOW_MS);
    this.stepped = moving ? now : 0;
    if (x !== this.pointer.x || y !== this.pointer.y) this.stale = true;
    return moving;
  }

  /** Says that something which casts a shadow has moved, so the shadows are drawn again with the next frame. */
  touch(): void {
    this.stale = true;
  }

  /** Fits canvas, camera, board and lights to a frame. Cheap when nothing about the scene changed. */
  fit(frame: ShelfFrame, deepest: number, tallest = 0): CanvasBox {
    const wanted = Math.min(MAX_DENSITY, window.devicePixelRatio || 1, this.budget.density);
    const box = canvasBox(frame.width, frame.height);
    const density = Math.min(wanted, Math.sqrt(MAX_PIXELS / Math.max(1, box.width * box.height)));
    const changed =
      frame.width !== this.size.width ||
      frame.height !== this.size.height ||
      frame.perspective !== this.size.perspective ||
      density !== this.size.density;
    this.origin = rowOrigin(frame);
    this.floorY = frame.floorY;
    if (this.lampX !== frame.lampX) this.stale = true;
    this.lampX = frame.lampX;
    if (changed || !this.box) {
      this.size = { width: frame.width, height: frame.height, perspective: frame.perspective, density };
      this.box = box;
      this.renderer.setPixelRatio(density);
      this.renderer.setSize(box.width, box.height, false);
      this.canvas.style.width = `${box.width}px`;
      this.canvas.style.height = `${box.height}px`;
      this.canvas.style.top = `${-box.top}px`;
      fitCamera(this.camera, frame.width, frame.height, frame.perspective, box);
      this.fitShadows(density);
      this.stale = true;
    }
    this.span = frame.width * 1.6;
    this.depth = Math.max(80, deepest);
    this.tallest = tallest > 0 ? tallest : frame.height * 0.8;
    this.placeBoard();
    this.aimLights();
    return this.box;
  }

  /** Size of the board's top in px, in steps of 200 px so a resize does not ask for a new floor every frame. */
  boardSize(): { width: number; depth: number } {
    const step = (value: number) => Math.max(200, Math.round(value / 200) * 200);
    return { width: step(this.span), depth: step(this.reach() + this.depth * 1.25) };
  }

  /** Most device pixels per CSS px this device can afford, for the canvas and for painted faces. */
  get detail(): number {
    return this.budget.density;
  }

  /**
   * Notes how long one frame of continuous motion took, from the frame before it, in ms. Returns true when
   * that showed this device cannot keep up at the present detail and the detail has just been lowered; the
   * next frame is then fitted afresh at the lower density.
   */
  note(ms: number): boolean {
    if (!this.budget.record(ms)) return false;
    this.size = { ...this.size, density: -1 };
    this.stale = true;
    return true;
  }

  render(): void {
    if (this.stale || !this.paced) {
      this.stale = false;
      this.renderer.shadowMap.needsUpdate = true;
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.board.geometry.dispose();
    this.boardMaterial.dispose();
    this.key.dispose();
    this.lamp.dispose();
    // Give the context back now. A browser keeps only so many, and waiting for the collector loses the oldest one still in use.
    this.renderer.forceContextLoss();
    this.renderer.dispose();
    this.canvas.remove();
  }

  /** How far the board reaches in front of the spines, in px. */
  get front(): number {
    return this.reach();
  }

  private reach(): number {
    // The board ends inside the scene box: below the box is the page, and a board drawn there would lie on its text.
    const room = (this.size.perspective * (this.floorY - this.room.lip)) / Math.max(1, this.size.height / 2) - 2;
    return Math.max(14, Math.min(this.depth * this.room.front, room));
  }

  private placeBoard(): void {
    const front = this.reach();
    const back = this.depth * 1.25;
    const thick = this.room.lip;
    this.board.scale.set(this.span, thick, front + back);
    this.board.position.set(0, this.origin.y - thick / 2, (front - back) / 2);
  }

  /** Shadow maps as fine as the screen can show: half the size on a screen of one device pixel per px. */
  private fitShadows(density: number): void {
    const size = density > 1 ? 2048 : density >= 1 ? 1024 : 512;
    if (size === this.shadowSize) return;
    this.shadowSize = size;
    for (const light of [this.key, this.lamp]) {
      light.shadow.mapSize.set(size, size);
      light.shadow.map?.dispose();
      light.shadow.map = null;
    }
  }

  private aimLights(): void {
    const { y } = this.origin;
    const depth = this.depth;
    const height = this.size.height;
    const reach = Math.max(this.size.width, 600) * 1.4;
    const aim = keyAim(this.pointer.x, this.pointer.y);
    if (this.room.lamp) {
      // A lamp over the presented volume: above and in front of it and a little to its left, so its cover
      // is lit and throws a shadow onto the volumes at its right. It leans a little with the pointer.
      const cover = this.corner.set(this.lampX, y + this.tallest * 0.55, depth * 0.3);
      this.lamp.position.set(this.lampX - height * 0.1 + this.pointer.x * height * 0.07, y + height * (1.28 - this.pointer.y * 0.05), depth * 2.1);
      this.lamp.target.position.set(this.lampX + height * 0.04, y + this.tallest * 0.3, -depth * 0.2);
      // Candela from the lux wanted on the cover: light falls off with the square of the distance, so the
      // cover is bright, the floor under it has a pool, and the ends of a wide row are in half dark.
      this.lamp.intensity = this.room.key * this.lamp.position.distanceToSquared(cover);
      this.lamp.distance = 0;
      this.lamp.decay = 2;
      this.lamp.shadow.camera.near = Math.max(10, height * 0.2);
      this.lamp.shadow.camera.far = height * 4 + depth * 3;
      this.lamp.shadow.radius = (4 * this.shadowSize) / 1024;
      // The rim: cool, weak, from behind and to the right, with no shadow of its own.
      this.key.intensity = RIM;
      this.key.position.set(reach * 0.55, y + reach * 0.5, -reach * 0.65);
      this.key.target.position.set(0, y, 0);
    } else {
      this.lamp.intensity = 0;
      this.key.intensity = this.room.key;
      // Daylight from the upper left and in front, as the CSS looks are lit, swinging a little with the pointer.
      this.key.target.position.set(0, y + this.tallest * 0.4, -depth * 0.3);
      this.key.position.set(aim.x * reach, aim.y * reach, aim.z * reach).add(this.key.target.position);
      this.fitKeyShadow(reach);
    }
    // The room turns with the key, so what a cover reflects and where its shadow falls stay one light.
    this.scene.environmentRotation.set(-aim.pitch, aim.yaw, 0);
    this.key.updateMatrixWorld();
    this.key.target.updateMatrixWorld();
    this.lamp.updateMatrixWorld();
    this.lamp.target.updateMatrixWorld();
  }

  /** Draws the shadow map of the key round the row and no wider, so every texel of it lands on something seen. */
  private fitKeyShadow(reach: number): void {
    const { y } = this.origin;
    const half = this.size.width / 2 + 80;
    const forward = this.forward.copy(this.key.target.position).sub(this.key.position).normalize();
    const right = this.right.set(0, 1, 0).cross(forward).negate().normalize();
    const up = this.up.copy(right).cross(forward);
    let left = Infinity;
    let rightmost = -Infinity;
    let bottom = Infinity;
    let top = -Infinity;
    let near = Infinity;
    let far = -Infinity;
    for (const cx of [-half, half]) {
      for (const cy of [y - this.room.lip, y + this.tallest + 40]) {
        for (const cz of [-this.depth * 1.3, this.reach() + this.depth * 0.6]) {
          const corner = this.corner.set(cx, cy, cz).sub(this.key.position);
          const across = corner.dot(right);
          const along = corner.dot(up);
          const away = corner.dot(forward);
          left = Math.min(left, across);
          rightmost = Math.max(rightmost, across);
          bottom = Math.min(bottom, along);
          top = Math.max(top, along);
          near = Math.min(near, away);
          far = Math.max(far, away);
        }
      }
    }
    const camera = this.key.shadow.camera;
    camera.left = left;
    camera.right = rightmost;
    camera.top = top;
    camera.bottom = bottom;
    camera.near = Math.max(1, near - 40);
    camera.far = Math.min(reach * 4, far + 40);
    camera.updateProjectionMatrix();
    // About three and a half px of blur at the foot of a volume, whatever the size of the map.
    this.key.shadow.radius = Math.max(1, (3.5 * this.shadowSize) / Math.max(1, rightmost - left));
  }
}

/** The rim light of a lamp-lit room. */
const RIM_COLOR = '#aebfe0';
const RIM = 0.3;

/** The name a renderer's context gives for the hardware it draws with, or '' when it will not say. */
function rendererName(renderer: WebGLRenderer): string {
  try {
    const gl = renderer.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
  } catch {
    return '';
  }
}

export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2');
    // The context of the probe is given back at once: a browser keeps only so many alive.
    context?.getExtension('WEBGL_lose_context')?.loseContext();
    return context !== null;
  } catch {
    return false;
  }
}

export const colorOf = (value: string, fallback = '#7a6a5a'): Color => {
  const color = new Color();
  try {
    color.setStyle(value.trim() || fallback);
  } catch {
    color.set(fallback);
  }
  return color;
};
