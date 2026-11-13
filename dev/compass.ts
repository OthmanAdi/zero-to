import {
  ACESFilmicToneMapping,
  CanvasTexture,
  Color,
  CylinderGeometry,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  RepeatWrapping,
  RingGeometry,
  Scene,
  SpotLight,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { bearingToDirection, createCompass, type CompassPart } from '../src/compass';
import { createRandom } from '../src/core/random';
import type { SceneEnvironment } from '../src/scene/contract';
import { PALETTE } from '../src/scene/palette';

/**
 * Dev page for the compass alone: a dark room, a round dark wooden table, one warm lamp and the compass.
 *
 * Keys 1 to 5 point the needle at the five numbered tags, G toggles the glow, the pointer tilts the compass.
 * URL: ?still=1 freezes time (with &t=seconds to choose the moment), &heading=degrees, &glow=0..1, &phone=1,
 * &reduced=1, &ring=0 (no outer ring), &cam=hero|close|top|low|side.
 */
const params = new URLSearchParams(window.location.search);
const flag = (name: string): boolean => params.get(name) === '1';
const number = (name: string, fallback: number): number => {
  const raw = params.get(name);
  if (raw === null || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
};

const still = flag('still');
const stillTime = number('t', 0);
const phone = flag('phone');
const reduced = flag('reduced') || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const cam = params.get('cam') ?? 'hero';
document.body.classList.toggle('still', still);

const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, phone ? 1.5 : 2));
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = number('exposure', 1);
renderer.outputColorSpace = SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;

const scene = new Scene();
scene.background = new Color(PALETTE.night);

// One room for every reflection.
const pmrem = new PMREMGenerator(renderer);
const room = new RoomEnvironment();
const envMap = pmrem.fromScene(room, 0.04).texture;
room.dispose();
pmrem.dispose();
scene.environment = envMap;
scene.environmentIntensity = 0.22;

const environment: SceneEnvironment = { envMap, maxTexture: phone ? 1024 : 2048, phone };

// The table: a dark oak disc with a turned groove near the edge. Its top is at y = 0.
const TABLE_RADIUS = 9;
function woodTexture(): CanvasTexture {
  const size = 1024;
  const sheet = document.createElement('canvas');
  sheet.width = size;
  sheet.height = size;
  const ctx = sheet.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');
  const random = createRandom('dev-table');
  ctx.fillStyle = '#17120f';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 1500; i += 1) {
    const y = random() * size;
    const light = random() > 0.55;
    ctx.strokeStyle = light ? `rgba(92, 70, 52, ${0.05 + random() * 0.12})` : `rgba(6, 4, 3, ${0.08 + random() * 0.22})`;
    ctx.lineWidth = 0.6 + random() * 2.4;
    ctx.beginPath();
    const wave = 2 + random() * 7;
    const phase = random() * 6.28;
    for (let x = 0; x <= size; x += 32) {
      const yy = y + Math.sin(phase + (x / size) * 6.28) * wave;
      if (x === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  const texture = new CanvasTexture(sheet);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(2, 5);
  texture.anisotropy = 8;
  return texture;
}

const wood = woodTexture();
const tableTop = new Mesh(
  new CylinderGeometry(TABLE_RADIUS, TABLE_RADIUS, 0.3, 160),
  new MeshPhysicalMaterial({
    map: wood,
    bumpMap: wood,
    bumpScale: 0.6,
    roughness: 0.6,
    metalness: 0,
    clearcoat: 0.14,
    clearcoatRoughness: 0.45,
    envMapIntensity: 0.3,
  }),
);
tableTop.position.y = -0.15;
tableTop.receiveShadow = true;
scene.add(tableTop);

const groove = new Mesh(
  new RingGeometry(TABLE_RADIUS - 0.62, TABLE_RADIUS - 0.5, 200),
  new MeshBasicMaterial({ color: 0x050506 }),
);
groove.rotation.x = -Math.PI / 2;
groove.position.y = 0.002;
scene.add(groove);

// Five numbered paper tags, where map sheets would lie.
const BEARINGS = [0, 72, 144, 216, 288].map((degrees) => (degrees * Math.PI) / 180);
function tagTexture(text: string): CanvasTexture {
  const sheet = document.createElement('canvas');
  sheet.width = 128;
  sheet.height = 128;
  const ctx = sheet.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');
  ctx.fillStyle = PALETTE.paper;
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = PALETTE.ink;
  ctx.font = '600 76px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 70);
  const texture = new CanvasTexture(sheet);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
BEARINGS.forEach((bearing, i) => {
  const direction = bearingToDirection(bearing);
  const tag = new Mesh(
    new PlaneGeometry(0.9, 0.9),
    new MeshStandardMaterial({ map: tagTexture(String(i + 1)), roughness: 0.95 }),
  );
  tag.rotation.x = -Math.PI / 2;
  tag.rotation.z = -bearing;
  tag.position.set(direction.x * 4.3, 0.012, direction.z * 4.3);
  tag.receiveShadow = true;
  scene.add(tag);
});

// The compass.
const compass: CompassPart = createCompass({
  environment,
  heading: (number('heading', 72) * Math.PI) / 180,
  glow: number('glow', 0.35),
  outerRing: params.get('ring') !== '0',
});
scene.add(compass.object);
const compassHeight = compass.object.getObjectByName('compass-floater')?.position.y ?? 1.5;

// The lamp: above and behind-left of the compass, so shadows fall towards the viewer.
const lamp = new SpotLight(new Color(PALETTE.lamp), number('lamp', 120), 0, (36 * Math.PI) / 180, 1, 2);
lamp.position.set(-2.4, 9, -3.6);
lamp.target.position.set(0, 0.6, 0);
lamp.castShadow = true;
lamp.shadow.mapSize.set(2048, 2048);
lamp.shadow.camera.near = 2;
lamp.shadow.camera.far = 30;
lamp.shadow.bias = -0.0003;
lamp.shadow.normalBias = 0.02;
lamp.shadow.radius = 2.5;
scene.add(lamp, lamp.target);
scene.add(new HemisphereLight(0x9fb1d0, 0x0b0f17, 0.1));

// The camera: about 24 degrees above the table, looking at the compass.
const camera = new PerspectiveCamera(30, 1, 0.1, 100);
const target = new Vector3(0, compassHeight - 0.15, 0);
function placeCamera(): void {
  const poses: Record<string, [number, number, number]> = {
    hero: [24, 8.6, 0],
    close: [24, 5.4, 0],
    top: [78, 6.2, 0],
    low: [9, 8.5, 0],
    side: [24, 7.5, 55],
  };
  const [elevationDeg, distance, azimuthDeg] = poses[cam] ?? (poses.hero as [number, number, number]);
  const elevation = (elevationDeg * Math.PI) / 180;
  const azimuth = (azimuthDeg * Math.PI) / 180;
  const flat = Math.cos(elevation) * distance;
  camera.position.set(target.x + Math.sin(azimuth) * flat, target.y + Math.sin(elevation) * distance, target.z + Math.cos(azimuth) * flat);
  camera.lookAt(target);
}

function resize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(1, height);
  camera.updateProjectionMatrix();
  placeCamera();
}
window.addEventListener('resize', resize);
resize();

const hud = document.getElementById('hud');
let glowOn = true;
window.addEventListener('keydown', (event) => {
  const index = '12345'.indexOf(event.key);
  if (index >= 0) compass.setHeading(BEARINGS[index] as number, { immediate: still || reduced });
  if (event.key === 'g' || event.key === 'G') {
    glowOn = !glowOn;
    compass.setGlow(glowOn ? 0.8 : 0);
  }
});
window.addEventListener('pointermove', (event) => {
  compass.setTilt((event.clientX / window.innerWidth) * 2 - 1, 1 - (event.clientY / window.innerHeight) * 2);
});

let last = performance.now();
let elapsed = 0;
let frames = 0;
function frame(now: number): void {
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  elapsed += dt;
  compass.update(still ? { dt: 0, t: stillTime, reduced } : { dt, t: elapsed, reduced });
  renderer.render(scene, camera);
  frames += 1;
  if (hud && frames % 20 === 0) {
    const info = renderer.info.render;
    hud.textContent =
      `1-5 needle   G glow   pointer tilt\n` +
      `bearing ${((compass.bearing * 180) / Math.PI).toFixed(1)} deg   heading ${((compass.heading * 180) / Math.PI).toFixed(0)} deg\n` +
      `part ${compass.triangles} tris   frame ${info.triangles} tris   ${info.calls} calls`;
  }
  if (frames === 3) document.body.dataset.ready = '1';
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// For screenshot scripts and the console.
Object.assign(window, { __compass: { compass, renderer, scene, camera, bearings: BEARINGS } });
