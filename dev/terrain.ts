/**
 * Dev page for the terrain model.
 *
 * Query: ?template=volcano|ridge|massif|twin-peaks|plateau|canyon|random  &trail=switchback|ridge-walk|spiral|
 * valley-first|traverse|random  &seed=<text>  &surfaces=grass,dirt,rock,snow  &stops=6  &rough=0.5  &phone=1
 * &decor=0  &still=1 (no motion, sets <html data-ready="1"> when drawn)  &grow=0..1  &progress=0..1  &hover=<card>
 * &elev=24 &yaw=-14 &dist=7.6 (camera)  &ui=0
 *
 * Keys: G grow again, T next mountain, R next trail, S new seed, W walk the route, arrows turn the camera.
 */
import {
  ACESFilmicToneMapping,
  CircleGeometry,
  Color,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PCFShadowMap,
  PMREMGenerator,
  PerspectiveCamera,
  PointLight,
  Raycaster,
  SRGBColorSpace,
  Scene,
  SphereGeometry,
  SpotLight,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { SceneEnvironment } from '../src/scene/contract';
import { PALETTE, type SurfaceKind } from '../src/scene/palette';
import {
  TERRAIN_TEMPLATE_IDS,
  TRAIL_TEMPLATE_IDS,
  describeTerrain,
  describeTrail,
  isSurfaceKind,
  type TerrainSpec,
  type TerrainTemplate,
  type TrailSpec,
  type TrailTemplate,
} from '../src/terrain';
import { createTerrainModel, type TerrainPart } from '../src/terrain/model';

const query = new URLSearchParams(location.search);
const numberOf = (name: string, fallback: number): number => {
  const raw = query.get(name);
  const value = raw === null || raw === '' ? Number.NaN : Number(raw);
  return Number.isFinite(value) ? value : fallback;
};
const oneOf = <T extends string>(name: string, list: readonly T[], fallback: T | 'random'): T | 'random' => {
  const raw = query.get(name);
  if (raw === 'random') return 'random';
  return raw !== null && (list as readonly string[]).includes(raw) ? (raw as T) : fallback;
};

const state = {
  template: oneOf<TerrainTemplate>('template', TERRAIN_TEMPLATE_IDS, 'massif'),
  trail: oneOf<TrailTemplate>('trail', TRAIL_TEMPLATE_IDS, 'switchback'),
  seed: query.get('seed') ?? 'zero-to',
  stops: Math.round(numberOf('stops', 6)),
  rough: numberOf('rough', 0.5),
  surfaces: ((): SurfaceKind[] | 'auto' => {
    const list = (query.get('surfaces') ?? '').split(',').map((item) => item.trim()).filter(isSurfaceKind);
    return list.length > 0 ? list : 'auto';
  })(),
  phone: query.get('phone') === '1',
  decor: query.get('decor') !== '0',
  still: query.has('still') && query.get('still') !== '0',
  elevation: numberOf('elev', 24),
  yaw: numberOf('yaw', -14),
  distance: numberOf('dist', 7.6),
};

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const label = document.getElementById('label') as HTMLDivElement;
if (query.get('ui') === '0') label.style.display = 'none';

const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.outputColorSpace = SRGBColorSpace;
renderer.shadowMap.enabled = true;
// In this three.js release PCFShadowMap is the soft, filtered kind.
renderer.shadowMap.type = PCFShadowMap;

const scene = new Scene();
scene.background = new Color(PALETTE.night);

const pmrem = new PMREMGenerator(renderer);
const room = new RoomEnvironment();
const envMap = pmrem.fromScene(room, 0.04).texture;
room.dispose();
pmrem.dispose();
scene.environment = envMap;
scene.environmentIntensity = 0.12;

const environment: SceneEnvironment = { envMap, maxTexture: state.phone ? 1024 : 2048, phone: state.phone };

const camera = new PerspectiveCamera(30, 1, 0.1, 100);
const focus = new Vector3(0, 0.42, 0);
function aimCamera(): void {
  const elevation = (state.elevation * Math.PI) / 180;
  const yaw = (state.yaw * Math.PI) / 180;
  const flat = Math.cos(elevation) * state.distance;
  camera.position.set(focus.x + Math.sin(yaw) * flat, focus.y + Math.sin(elevation) * state.distance, focus.z + Math.cos(yaw) * flat);
  camera.lookAt(focus);
}

// The table: a dark round top, radius 9, at y = 0.
const table = new Mesh(
  new CircleGeometry(9, 96),
  new MeshStandardMaterial({ color: new Color(PALETTE.nightSoft), roughness: 0.72, metalness: 0, envMapIntensity: 0.8 }),
);
table.rotation.x = -Math.PI / 2;
table.receiveShadow = true;
scene.add(table);

// The lamp stands behind and to the left, low enough to rake across the cards, so every step throws a shadow
// toward the viewer.
const lamp = new SpotLight(new Color(PALETTE.lamp), 190, 30, 0.46, 1, 2);
lamp.castShadow = true;
lamp.shadow.mapSize.set(2048, 2048);
lamp.shadow.camera.near = 2;
lamp.shadow.camera.far = 22;
lamp.shadow.bias = -0.00028;
lamp.shadow.normalBias = 0.012;
lamp.shadow.radius = 2.5;
lamp.target.position.set(0, 0.35, 0);
scene.add(lamp, lamp.target);
const lampRest = { azimuth: 142, elevation: 38 };
const lampNow = { azimuth: lampRest.azimuth, elevation: lampRest.elevation, va: 0, ve: 0 };
const lampWanted = { ...lampRest };
function aimLamp(): void {
  const azimuth = (lampNow.azimuth * Math.PI) / 180;
  const elevation = (lampNow.elevation * Math.PI) / 180;
  const reach = 7.6;
  lamp.position.set(Math.cos(azimuth) * Math.cos(elevation) * reach, 0.35 + Math.sin(elevation) * reach, -Math.sin(azimuth) * Math.cos(elevation) * reach);
}
aimLamp();

// What is left of the room's light, and the glow the lit table throws back up.
scene.add(new HemisphereLight(new Color('#a9b8d6'), new Color('#1a1410'), 0.14));
const bounce = new PointLight(new Color(PALETTE.lamp), 1.2, 12, 2);
bounce.position.set(1.2, 2.6, 4.2);
scene.add(bounce);

// A walker for the route: a red bead that sits on the card it crosses.
const walker = new Mesh(new SphereGeometry(0.05, 24, 16), new MeshStandardMaterial({ color: new Color(PALETTE.signal), roughness: 0.45 }));
walker.castShadow = true;
walker.visible = false;
scene.add(walker);

let part: TerrainPart | null = null;
let progress = clampUnit(numberOf('progress', 0));
let walking = false;

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function terrainSpec(): TerrainSpec {
  return { seed: state.seed, template: state.template, roughness: state.rough };
}
function trailSpec(): TrailSpec {
  return { seed: state.seed, template: state.trail, stops: state.stops };
}

function showProgress(): void {
  if (!part) return;
  part.setProgress(progress);
  walker.visible = progress > 0 && progress < 1;
  part.routeAt(progress, walker.position);
  walker.position.y += 0.05;
}

function rebuild(): void {
  part?.dispose();
  const started = performance.now();
  part = createTerrainModel({
    terrain: terrainSpec(),
    trail: trailSpec(),
    surfaces: state.surfaces,
    environment,
    decorations: state.decor,
  });
  scene.add(part.object);
  const took = Math.round(performance.now() - started);
  showProgress();
  label.innerHTML =
    `<b>${part.heightfield.template}</b> · ${describeTerrain(terrainSpec())}\n` +
    `<b>${part.trail.template}</b> · ${describeTrail(trailSpec())}\n` +
    `seed ${state.seed} · ${part.levels.length} cards · ${part.surfaces.filter((s, i, all) => all.indexOf(s) === i).join(', ')} · built in ${took} ms\n` +
    `G grow · T mountain · R trail · S seed · W walk · arrows turn`;
  const next = new URLSearchParams(location.search);
  next.set('template', state.template);
  next.set('trail', state.trail);
  next.set('seed', state.seed);
  history.replaceState(null, '', `${location.pathname}?${next.toString()}`);
}

function resize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  // Keep the whole board in view on tall screens.
  camera.fov = camera.aspect < 1 ? 30 / Math.max(0.55, camera.aspect) : 30;
  camera.updateProjectionMatrix();
}

function next<T>(list: readonly T[], current: T | 'random'): T {
  const index = current === 'random' ? -1 : list.indexOf(current);
  return list[(index + 1) % list.length] as T;
}

window.addEventListener('resize', resize);
window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  if (key === 'g') part?.playGrow();
  else if (key === 't') {
    state.template = next(TERRAIN_TEMPLATE_IDS, state.template);
    rebuild();
    part?.playGrow();
  } else if (key === 'r') {
    state.trail = next(TRAIL_TEMPLATE_IDS, state.trail);
    rebuild();
  } else if (key === 's') {
    state.seed = Date.now().toString(36).slice(-6);
    rebuild();
    part?.playGrow();
  } else if (key === 'w') {
    walking = !walking;
    if (walking && progress >= 1) progress = 0;
  } else if (key === 'arrowleft') state.yaw -= 6;
  else if (key === 'arrowright') state.yaw += 6;
  else if (key === 'arrowup') state.elevation = Math.min(85, state.elevation + 3);
  else if (key === 'arrowdown') state.elevation = Math.max(8, state.elevation - 3);
});

// The lamp swings a little with the pointer, and the card under the pointer lifts.
const pointer = new Vector2(2, 2);
const raycaster = new Raycaster();
const hit = new Vector3();
if (!state.still) {
  window.addEventListener('pointermove', (event) => {
    pointer.set((event.clientX / window.innerWidth) * 2 - 1, -(event.clientY / window.innerHeight) * 2 + 1);
    lampWanted.azimuth = lampRest.azimuth + pointer.x * -34;
    lampWanted.elevation = lampRest.elevation + pointer.y * 7;
  });
  window.addEventListener('pointerleave', () => {
    pointer.set(2, 2);
    lampWanted.azimuth = lampRest.azimuth;
    lampWanted.elevation = lampRest.elevation;
  });
}

function pickCard(): void {
  if (!part) return;
  if (Math.abs(pointer.x) > 1 || Math.abs(pointer.y) > 1) {
    part.setHover(null);
    return;
  }
  raycaster.setFromCamera(pointer, camera);
  const found = raycaster.intersectObject(part.raycastTarget, false)[0];
  if (!found) {
    part.setHover(null);
    return;
  }
  hit.copy(found.point);
  part.object.worldToLocal(hit);
  const card = part.cardAt(hit.x, hit.z);
  part.setHover(card > 0 ? card : null);
}

resize();
aimCamera();
rebuild();

const html = document.documentElement;
let last = performance.now();
let elapsed = 0;
let frames = 0;

if (state.still) {
  const active = part as TerrainPart | null;
  active?.grow(clampUnit(numberOf('grow', 1)), true);
  if (query.has('hover')) {
    active?.setHover(Math.round(numberOf('hover', 0)));
    active?.update({ dt: 0, t: 0, reduced: true });
  }
} else {
  (part as TerrainPart | null)?.playGrow();
}

function frame(now: number): void {
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  elapsed += dt;
  aimCamera();

  if (!state.still) {
    lampNow.va += ((lampWanted.azimuth - lampNow.azimuth) * 7.5 - lampNow.va * 4.3) * dt;
    lampNow.azimuth += lampNow.va * dt;
    lampNow.ve += ((lampWanted.elevation - lampNow.elevation) * 7.5 - lampNow.ve * 4.3) * dt;
    lampNow.elevation += lampNow.ve * dt;
    aimLamp();
    pickCard();
    if (walking) {
      progress = Math.min(1, progress + dt / 16);
      if (progress >= 1) walking = false;
      showProgress();
    }
  }

  part?.update({ dt, t: elapsed, reduced: state.still });
  renderer.render(scene, camera);
  frames += 1;
  if (frames === 3) html.dataset.ready = '1';
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
