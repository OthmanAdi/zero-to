import {
  ACESFilmicToneMapping,
  AmbientLight,
  CircleGeometry,
  Color,
  Mesh,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PointLight,
  Raycaster,
  SRGBColorSpace,
  Scene,
  SpotLight,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { LAMP, THEME, injectTokens, loadFonts, mix } from '../src/look';
import { buildSheet, fitPose, type Vec3 } from '../src/paper';
import { sheetDrawings } from '../src/props/brush';
import { allDrawings } from '../src/props/testing';
import { uiLang } from '../src/i18n';
import {
  PROPS,
  PROP_SURFACES,
  SIGNPOST_CATALOGUE,
  SIGNPOST_KEYS,
  createCairn,
  createCamp,
  createProp,
  createScenery,
  createSignpost,
  createStageBoard,
  createStation,
  createWalker,
  sceneryFor,
  stageBoardText,
  type PropArt,
  type PropPart,
  type PropSurface,
  type SignpostKey,
  type SignpostPart,
  type StationKind,
} from '../src/props';
import type { FrameTime } from '../src/scene/contract';
import { SURFACE_KINDS } from '../src/scene/palette';

/**
 * Dev page for the props package: every cut-out drawing on paper under the lamp.
 *
 * URL: ?section=sheet|signposts|parts|scenery|station|art picks what is shown. ?t=seconds steps the scene to that
 * moment with a fixed 1/60 s frame and holds; &still=1 also hides the page controls. ?motion=reduced.
 * Sheet: &only=<surface> shows one surface large and from the front, &labels=0 hides the captions.
 */
const params = new URLSearchParams(window.location.search);
const numberParam = (name: string, fallback: number): number => {
  const raw = params.get(name);
  if (raw === null || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
};
const SECTIONS = ['sheet', 'signposts', 'parts', 'scenery', 'station', 'art'] as const;
type SectionId = (typeof SECTIONS)[number];
const sectionId: SectionId = (SECTIONS as readonly string[]).includes(params.get('section') ?? '') ? (params.get('section') as SectionId) : 'sheet';
const still = params.get('still') === '1';
const fixedTime = params.has('t') ? numberParam('t', 0) : null;
const reduced = params.get('motion') === 'reduced' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const phone = window.matchMedia('(pointer: coarse)').matches && Math.min(window.screen.width, window.screen.height) < 600;

injectTokens();
document.body.classList.toggle('still', still);
document.body.classList.toggle('bare', params.get('labels') === '0');

interface Label {
  readonly text: string;
  readonly at: Vec3;
  readonly dim?: boolean;
}

interface Section {
  /** Points the camera has to show. */
  readonly points: readonly Vec3[];
  /** Where the lamp looks. */
  readonly pool: Vec3;
  readonly elevation: number;
  readonly yaw: number;
  readonly labels: readonly Label[];
  update(frame: FrameTime): void;
  /** A tap on the canvas. */
  tap?(raycaster: Raycaster): void;
  controls?(host: HTMLElement): void;
  state?(): unknown;
}

interface View {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly lamp: SpotLight;
  readonly canvas: HTMLCanvasElement;
  aspect(): number;
  resize(): void;
}

function createView(): View {
  const canvas = document.getElementById('stage') as HTMLCanvasElement;
  // The renderer the stage builds: ACES filmic at exposure 1, sRGB out, filtered shadows.
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = LAMP.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  const scene = new Scene();
  scene.background = new Color(THEME.night);
  const camera = new PerspectiveCamera(34, 1, 0.1, 200);
  const lamp = new SpotLight(LAMP.color, LAMP.intensity, 0, (44 * Math.PI) / 180, LAMP.penumbra, LAMP.decay);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(LAMP.shadow.mapSize, LAMP.shadow.mapSize);
  lamp.shadow.camera.near = LAMP.shadow.near;
  lamp.shadow.camera.far = 60;
  lamp.shadow.bias = LAMP.shadow.bias;
  lamp.shadow.normalBias = LAMP.shadow.normalBias;
  scene.add(lamp, lamp.target);
  return {
    renderer,
    scene,
    camera,
    lamp,
    canvas,
    aspect: () => (canvas.clientWidth || 1) / Math.max(1, canvas.clientHeight),
    resize() {
      const width = canvas.clientWidth || 1;
      const height = canvas.clientHeight || 1;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
  };
}

/**
 * The low lamp that stands by a panel during the walk: from the front right, so the faces of the cut-outs are
 * lit and their shadows run back across the map. `reach` is the half-width of what it has to light.
 */
function rakeLamp(view: View, pool: Vec3, reach: number, wide = false): void {
  // A wide sheet is lit from further round to the front, or its near rows would only be grazed.
  const azimuth = (numberParam('az', wide ? 158 : 122) * Math.PI) / 180;
  const elevation = (numberParam('el', 34) * Math.PI) / 180;
  const distance = Math.max(7.6, reach * (wide ? 4.6 : 3.4));
  view.lamp.position.set(
    pool.x + distance * Math.sin(azimuth) * Math.cos(elevation),
    pool.y + distance * Math.sin(elevation),
    pool.z - distance * Math.cos(azimuth) * Math.cos(elevation),
  );
  view.lamp.target.position.set(pool.x, pool.y, pool.z);
  // Candela for the calibrated lamp at 7.6, carried to this distance.
  const candela = LAMP.intensity * 0.82 * (distance / 7.6) ** 2;
  view.lamp.intensity = candela;
  view.lamp.shadow.focus = 0.7;
  view.scene.add(new AmbientLight(0xffffff, 0.21));
  const bounce = new PointLight(LAMP.color, candela * 0.07, 0, 2);
  bounce.position.copy(view.lamp.position);
  view.scene.add(bounce);
  const table = new Mesh(new CircleGeometry(Math.max(9, reach * 2.2), 96), new MeshStandardMaterial({ color: THEME.walnut, roughness: 0.62 }));
  table.rotation.x = -Math.PI / 2;
  table.position.set(pool.x, -0.012, pool.z);
  table.receiveShadow = true;
  view.scene.add(table);
}

/** A strip of map paper for props to stand on, tinted towards its surface as a panel of the walk is. */
function ground(view: View, surface: PropSurface, x: number, z: number, width: number, depth: number): void {
  const tint = surface === 'sky' ? THEME.paper : surface === 'camp' ? mix(THEME.paper, THEME.surface.dirt, 0.16) : mix(THEME.paper, THEME.surface[surface], 0.3);
  const sheet = buildSheet({ width, height: depth, standing: false, paper: tint, seed: x * 7 + z * 3 + 1, resolution: 120, warp: 0.008 });
  sheet.object.position.set(x, 0, z);
  sheet.mesh.castShadow = false;
  view.scene.add(sheet.object);
}

// ---------------------------------------------------------------------------------------------------------
// 1. The contact sheet: every prop of the registry on its own ground.

function buildContactSheet(view: View): Section {
  const only = params.get('only');
  const surfaces = PROP_SURFACES.filter((surface) => only === null || surface === only);
  const columns = surfaces.length > 1 ? 2 : 1;
  const stripWidth = 5.6;
  const stripDepth = 1.5;
  const pitchX = 6.0;
  const pitchZ = 2.75;
  const props: PropPart[] = [];
  const labels: Label[] = [];
  const points: Vec3[] = [];

  surfaces.forEach((surface, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const cx = (column - (columns - 1) / 2) * pitchX;
    const cz = row * pitchZ;
    ground(view, surface, cx, cz, stripWidth, stripDepth);
    if (surfaces.length > 1) labels.push({ text: surface, at: { x: cx - stripWidth / 2 + 0.3, y: 0, z: cz - stripDepth / 2 - 0.12 }, dim: true });
    const arts: readonly PropArt[] = PROPS[surface];
    const total = arts.reduce((sum, art) => sum + art.size.width, 0);
    const gap = Math.min(0.5, (stripWidth - 0.5 - total) / Math.max(1, arts.length - 1));
    let x = cx - (total + gap * (arts.length - 1)) / 2;
    arts.forEach((art, order) => {
      const prop = createProp(art, { seed: index * 10 + order + 1, phone, wire: 0.5 });
      const px = x + art.size.width / 2;
      const pz = cz + (art.pose === 'tip' ? 0.5 : art.layer === 'back' ? -0.4 : art.layer === 'mid' ? -0.05 : 0.3);
      prop.object.position.set(px, 0.004, pz);
      view.scene.add(prop.object);
      props.push(prop);
      labels.push({ text: surfaces.length > 1 ? art.name : art.id, at: { x: px, y: 0, z: cz + stripDepth / 2 + 0.02 } });
      points.push({ x: px - art.size.width / 2, y: 0, z: pz }, { x: px + art.size.width / 2, y: art.pose === 'tip' ? 0.1 : art.size.height + (art.pose === 'hang' ? 0.5 : 0), z: pz });
      x += art.size.width + gap;
    });
    points.push({ x: cx - stripWidth / 2, y: 0, z: cz + stripDepth / 2 }, { x: cx + stripWidth / 2, y: 0, z: cz - stripDepth / 2 });
  });

  const rows = Math.ceil(surfaces.length / columns);
  const pool: Vec3 = { x: 0, y: 0, z: ((rows - 1) * pitchZ) / 2 };
  rakeLamp(view, pool, Math.max((columns * pitchX) / 2, (rows * pitchZ) / 2), surfaces.length > 1);
  for (const prop of props) prop.setUp(true);

  return {
    points,
    pool,
    elevation: numberParam('elev', surfaces.length > 1 ? 47 : 14),
    yaw: numberParam('yaw', surfaces.length > 1 ? -7 : -9),
    labels,
    update(frame) {
      for (const prop of props) prop.update(frame);
    },
    tap(raycaster) {
      let best: PropPart | null = null;
      let bestDistance = Infinity;
      for (const prop of props) {
        const distance = prop.hit(raycaster);
        if (distance !== null && distance < bestDistance) {
          best = prop;
          bestDistance = distance;
        }
      }
      best?.tap();
      hooks.lastTap = best ? best.art.id : null;
    },
    state: () => props.map((prop) => ({ id: prop.art.id, up: prop.up, swing: prop.swing })),
  };
}

// ---------------------------------------------------------------------------------------------------------
// 2. Signposts: every style with a checkpoint's `show` items on its arms.

/** Sample `show` items, written as roadmaps would write them: several subjects, scripts and lengths. */
const SHOW: Record<SignpostKey, readonly string[]> = {
  timber: ['Read a staff', 'Clap a rhythm in 4/4', 'Name the notes of C major'],
  cairn: ['Borrow a value', 'Explain a lifetime error to someone else, then fix it without the compiler'],
  'trig-pillar': ['Mittelwert', 'Standardabweichung', 'Größenverhältnisse erklären', 'Median'],
  'blaze-post': ['写一个函数', 'テストを書く', 'नक्शा पढ़ना'],
  'snow-pole': ['اقرأ الخريطة', 'שלום עולם', 'Привет, мир'],
  buoy: ['Tie a bowline', 'Read a chart'],
  'summit-flag': ['Ship it', 'Teach it', 'Write it up', 'Present it', 'Maintain it'],
};
const SHOW_LANG: Partial<Record<SignpostKey, string>> = { 'trig-pillar': 'de', 'blaze-post': 'zh', 'snow-pole': 'ar' };

function listParam(name: string): number[] {
  return (params.get(name) ?? '')
    .split(',')
    .filter((part) => part !== '')
    .map(Number)
    .filter((value) => Number.isInteger(value));
}

interface Tappable {
  hit(raycaster: Raycaster): number | null;
  tap(): void;
}

function nearest(raycaster: Raycaster, parts: readonly (readonly [string, Tappable])[]): string | null {
  let best: readonly [string, Tappable] | null = null;
  let distance = Infinity;
  for (const entry of parts) {
    const hit = entry[1].hit(raycaster);
    if (hit !== null && hit < distance) {
      best = entry;
      distance = hit;
    }
  }
  best?.[1].tap();
  return best ? best[0] : null;
}

function button(host: HTMLElement, label: string, onClick: (self: HTMLButtonElement) => void): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.textContent = label;
  node.addEventListener('click', () => onClick(node));
  host.append(node);
  return node;
}

function buildSignposts(view: View): Section {
  const only = params.get('only');
  const keys = SIGNPOST_KEYS.filter((key) => only === null || key === only);
  const pitch = 2.05;
  const rowPitch = 3.3;
  const ticked = listParam('ticked');
  const posts: (readonly [SignpostKey, SignpostPart])[] = [];
  const labels: Label[] = [];
  const points: Vec3[] = [];
  const columns = keys.length > 4 ? 4 : keys.length;
  const rows = Math.ceil(keys.length / columns);

  for (let row = 0; row < rows; row += 1) ground(view, row % 2 === 0 ? 'grass' : 'scree', 0, row * rowPitch + 0.1, columns * pitch + 0.6, 1.3);
  keys.forEach((key, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const inRow = Math.min(columns, keys.length - row * columns);
    const x = (column - (inRow - 1) / 2) * pitch;
    const z = row * rowPitch;
    const post = createSignpost(key, SHOW[key], { lang: SHOW_LANG[key] ?? 'en', seed: index + 1, phone });
    post.object.position.set(x, 0.004, z);
    view.scene.add(post.object);
    posts.push([key, post]);
    const entry = SIGNPOST_CATALOGUE.find((item) => item.key === key);
    labels.push({ text: `${key} · ${entry?.name[uiLang()] ?? ''}`, at: { x, y: 0, z: z + 0.5 } });
    points.push({ x: x - 0.86, y: 0, z }, { x: x + 0.86, y: post.style.size.height + 0.12, z }, { x, y: 0, z: z + 0.5 });
  });

  const pool: Vec3 = { x: 0, y: 0, z: ((rows - 1) * rowPitch) / 2 };
  rakeLamp(view, pool, Math.max((columns * pitch) / 2, rows * 1.3), keys.length > 1);
  for (const [, post] of posts) {
    post.setUp(true);
    for (const index of ticked) post.setTicked(index, true);
    if (params.get('passed') === '1') post.setPassed(true);
    if (params.get('locked') === '1') post.setLocked(true);
  }

  // Live: tick one arm after another, raise the pennant, start again.
  const auto = fixedTime === null && !reduced && !params.has('ticked');
  let step = -1;
  return {
    points,
    pool,
    elevation: numberParam("elev", keys.length > 1 ? 30 : 12),
    yaw: numberParam('yaw', -9),
    labels,
    update(frame) {
      if (auto) {
        const now = Math.floor(frame.t / 1.3);
        if (now !== step) {
          step = now;
          const beat = now % 8;
          for (const [, post] of posts) {
            for (let i = 0; i < post.count; i += 1) post.setTicked(i, beat >= 1 && i < beat && beat < 7);
            post.setPassed(beat >= post.count + 1 && beat < 7);
          }
        }
      }
      for (const [, post] of posts) post.update(frame);
    },
    tap(raycaster) {
      hooks.lastTap = nearest(raycaster, posts);
    },
    controls(host) {
      for (let i = 0; i < 5; i += 1) {
        button(host, `Arm ${i + 1}`, () => {
          for (const [, post] of posts) post.setTicked(i, !post.isTicked(i));
        });
      }
      button(host, 'Passed', () => {
        for (const [, post] of posts) post.setPassed(!post.passed);
      });
      const note = document.createElement('p');
      note.textContent = 'Arms tick by themselves. Tap a signpost to make it wobble.';
      host.append(note);
    },
    state: () =>
      posts.map(([key, post]) => ({
        key,
        count: post.count,
        up: post.up,
        pennant: post.pennant,
        arms: Array.from({ length: post.count }, (_, index) => {
          const ends = post.armEnds(index);
          const pivot = ends ? hooks.project(ends.pivot) : { x: 0, y: 0 };
          const tip = ends ? hooks.project(ends.tip) : { x: 0, y: 0 };
          return {
            ticked: post.isTicked(index),
            swing: post.armSwing(index),
            lines: post.armText(index).lines,
            truncated: post.armText(index).truncated,
            pivot,
            tip,
            // Direction of the arm on the screen, in degrees: 0 points right, 180 points left.
            screenAngle: (Math.atan2(pivot.y - tip.y, tip.x - pivot.x) * 180) / Math.PI,
          };
        }),
      })),
  };
}

// ---------------------------------------------------------------------------------------------------------
// 3. The pieces that carry a learning action: stage board, camp, cairn, walker.

function buildParts(view: View): Section {
  const only = params.get('only');
  ground(view, 'dirt', 0, 0.15, 7.2, 1.9);
  const points: Vec3[] = [];
  const labels: Label[] = [];
  const lang = uiLang();

  const board = createStageBoard(stageBoardText({ index: 2, count: 5, minutes: 375, practiceMinutes: 262, tier: 'silver', tierUp: true }, lang), { seed: 3, phone });
  const camp = createCamp(3, { seed: 5, phone });
  const cairn = createCairn({ seed: 7, phone });
  const walker = createWalker({ seed: 9, phone });
  const home = 2.45;
  const placed = [
    { name: 'board', part: board, x: -2.55, width: 1.2, height: 1.0 },
    { name: 'camp', part: camp, x: -0.55, width: 1.5, height: 1.06 },
    { name: 'cairn', part: cairn, x: 1.25, width: 0.8, height: 0.4 },
    { name: 'walker', part: walker, x: home, width: only === 'walker' ? 0.56 : 1.2, height: only === 'walker' ? 0.33 : 0.4 },
  ];
  const shown = placed.filter((entry) => only === null || only === entry.name);
  for (const entry of placed) {
    entry.part.object.position.set(entry.x, 0.004, 0);
    entry.part.object.visible = shown.includes(entry);
    view.scene.add(entry.part.object);
  }
  for (const entry of shown) {
    labels.push({ text: entry.name, at: { x: entry.x, y: 0, z: only ? 0.2 : 1.1 } });
    points.push({ x: entry.x - entry.width / 2, y: 0, z: 0 }, { x: entry.x + entry.width / 2, y: entry.height, z: 0 }, { x: entry.x, y: 0, z: only ? 0.2 : 0.7 });
  }
  const pool: Vec3 = { x: only ? (shown[0]?.x ?? 0) : 0, y: 0, z: 0.2 };
  rakeLamp(view, pool, only ? 1.6 : 3.8);

  board.setUp(true);
  camp.setUp(true);
  cairn.setUp(true);
  const fixed = fixedTime !== null || reduced;
  let rungs = Math.round(numberParam('rungs', 0));
  let due = params.get('due') === '1';
  let passed = params.get('passed') === '1';
  let walking = numberParam('walk', fixed ? 0 : 0.42);
  let auto = !fixed && !params.has('rungs') && !params.has('due');
  camp.setRungs(rungs);
  cairn.setDue(due);
  board.setPassed(passed);
  let walkerX = walking > 0 ? home - 0.45 : home;
  let heading = 1;
  let beat = -1;
  const tapAt = params.has('tap') ? numberParam('tap', 0) : null;
  let tapped = false;

  return {
    points,
    pool,
    elevation: numberParam('elev', 16),
    yaw: numberParam('yaw', -9),
    labels,
    update(frame) {
      if (auto) {
        const now = Math.floor(frame.t / 1.6);
        if (now !== beat) {
          beat = now;
          rungs = now % 5 > 3 ? 0 : now % 5;
          due = now % 4 >= 2;
          passed = now % 6 >= 3;
          camp.setRungs(Math.min(3, rungs));
          cairn.setDue(due);
          board.setPassed(passed);
        }
      }
      if (tapAt !== null && !tapped && frame.t >= tapAt) {
        tapped = true;
        walker.tap();
        board.tap();
        camp.tap();
        cairn.tap();
      }
      // The walker paces a short stretch of trail, and turns at each end.
      if (walking > 0 && frame.dt > 0) {
        const stride = walking * frame.dt * heading;
        walkerX += stride;
        if (walkerX > home + 0.45) heading = -1;
        if (walkerX < home - 0.45) heading = 1;
        walker.advance(stride);
      }
      walker.object.position.x = walkerX;
      board.update(frame);
      camp.update(frame);
      cairn.update(frame);
      walker.update(frame);
    },
    tap(raycaster) {
      hooks.lastTap = nearest(raycaster, shown.map((entry) => [entry.name, entry.part] as const));
    },
    controls(host) {
      button(host, 'Raise a rung flag', () => {
        auto = false;
        rungs = (rungs + 1) % 4;
        camp.setRungs(rungs);
      });
      button(host, 'Cairn due', (self) => {
        auto = false;
        due = !due;
        cairn.setDue(due);
        self.setAttribute('aria-pressed', String(due));
      });
      button(host, 'Stage passed', (self) => {
        auto = false;
        passed = !passed;
        board.setPassed(passed);
        self.setAttribute('aria-pressed', String(passed));
      });
      button(host, 'Walk / stand', () => {
        walking = walking > 0 ? 0 : 0.42;
      });
      const note = document.createElement('p');
      note.textContent = 'Tap the walker, the board, the camp or the cairn to make it wobble.';
      host.append(note);
    },
    state: () => ({
      rungs: camp.rungs,
      flags: Array.from({ length: camp.count }, (_, index) => camp.flagUp(index)),
      due: cairn.due,
      ring: cairn.ring,
      passed: board.passed,
      walker: { x: walkerX, walk: walker.walk, phase: walker.phase, swing: walker.swing, facing: walker.facing, pose: walker.pose },
      screen: {
        cairn: hooks.project({ x: 1.25, y: 0, z: 0 }),
        ring: hooks.project({ x: 1.25 + 0.27, y: 0.01, z: 0 }),
        ringLeft: hooks.project({ x: 1.25 - 0.27, y: 0.01, z: 0 }),
        flagSlots: [0.86, 0.69, 0.52].map((y) => hooks.project({ x: -0.55 + 0.54 + 0.13, y, z: -0.03 })),
        walker: hooks.project({ x: walkerX, y: 0.15, z: 0 }),
        board: hooks.project({ x: -2.55, y: 0.6, z: 0 }),
      },
    }),
  };
}

// ---------------------------------------------------------------------------------------------------------
// 4. Scenery: what `sceneryFor` lays out on one panel of each surface.

function buildScenery(view: View): Section {
  const only = params.get('only');
  const surfaces = SURFACE_KINDS.filter((surface) => only === null || surface === only);
  const columns = surfaces.length > 1 ? 4 : 1;
  const width = 4.2;
  const depth = 2.2;
  const pitchX = 4.5;
  const pitchZ = 4.3;
  const count = Math.round(numberParam('count', 9));
  const seed = params.get('seed') ?? 'dev';
  const fold = numberParam('fold', 1);
  const labels: Label[] = [];
  const points: Vec3[] = [];
  const panels = surfaces.map((surface, index) => {
    const cx = ((index % columns) - (columns - 1) / 2) * pitchX;
    const cz = Math.floor(index / columns) * pitchZ;
    ground(view, surface, cx, cz, width, depth + 0.9);
    const scenery = createScenery(sceneryFor(surface, seed, count), { width: width - 0.5, depth, phone });
    scenery.object.position.set(cx, 0.004, cz - 0.3);
    view.scene.add(scenery.object);
    labels.push({ text: only ? `${surface} · ${scenery.items.map((item) => item.art.name).join(', ')}` : surface, at: { x: cx, y: 0, z: cz + depth / 2 + 0.45 } });
    points.push({ x: cx - width / 2, y: 0, z: cz + depth / 2 + 0.45 }, { x: cx + width / 2, y: 0, z: cz - depth / 2 - 0.45 }, { x: cx, y: 1.7, z: cz - depth / 2 });
    return { scenery, cx };
  });
  const rows = Math.ceil(surfaces.length / columns);
  const pool: Vec3 = { x: 0, y: 0, z: ((rows - 1) * pitchZ) / 2 };
  rakeLamp(view, pool, Math.max((columns * pitchX) / 2, (rows * pitchZ) / 2), surfaces.length > 1);
  const fixed = fixedTime !== null || reduced;
  return {
    points,
    pool,
    elevation: numberParam('elev', surfaces.length > 1 ? 42 : 22),
    yaw: numberParam('yaw', -9),
    labels,
    update(frame) {
      for (const { scenery } of panels) {
        if (fixed) {
          scenery.setFold(fold);
          scenery.setWalker(params.has('walker') ? numberParam('walker', 0) : width);
          scenery.setEnd(params.get('end') !== '0');
        } else {
          // Live: the scene unfolds, the walker crosses it, then it folds away again.
          const cycle = (frame.t % 12) / 12;
          scenery.setFold(cycle < 0.85 ? Math.min(1, cycle * 5) : 0);
          scenery.setWalker(-width / 2 + Math.max(0, cycle - 0.15) * width * 1.9);
          scenery.setEnd(cycle > 0.62);
        }
        scenery.update(frame);
      }
    },
    tap(raycaster) {
      let name: string | null = null;
      for (const { scenery } of panels) name = scenery.tap(raycaster)?.art.id ?? name;
      hooks.lastTap = name;
    },
    state: () =>
      panels.map(({ scenery }) =>
        scenery.items.map((item, index) => ({ id: item.art.id, x: item.x, z: item.z, trigger: item.trigger.kind, up: (scenery.props[index] as PropPart).up })),
      ),
  };
}

// ---------------------------------------------------------------------------------------------------------
// 5. The paper stations of the landing page.

function buildStation(view: View): Section {
  const kind: StationKind = params.get('kind') === 'carries' ? 'carries' : 'altitudes';
  const station = createStation(kind, { seed: 2, environment: { envMap: null, maxTexture: phone ? 1024 : 2048, phone } });
  view.scene.add(station.object);
  const pool: Vec3 = { x: 0, y: 0, z: 0 };
  rakeLamp(view, pool, station.size.width / 2);
  const fixed = fixedTime !== null || reduced;
  if (fixed) {
    station.setForm(numberParam('form', 1));
    station.setFocus(Math.round(numberParam('focus', -1)));
  }
  const w = station.size.width / 2;
  const d = station.size.depth / 2;
  let beat = -1;
  return {
    points: [
      { x: -w, y: 0, z: d },
      { x: w, y: 0, z: d },
      { x: -w, y: 0, z: -d },
      { x: w, y: 0, z: -d },
      { x: 0, y: kind === 'altitudes' ? 2.5 : 1.5, z: -0.5 },
    ],
    pool,
    elevation: numberParam('elev', 26),
    yaw: numberParam('yaw', -8),
    labels: [],
    update(frame) {
      if (!fixed) {
        station.setForm(Math.min(1, frame.t / 2.4));
        const now = Math.floor(frame.t / 2.2);
        if (now !== beat) {
          beat = now;
          const turn = (now - 2) % (station.count + 1);
          station.setFocus(now < 2 || turn === station.count ? -1 : turn);
        }
      }
      station.update(frame);
    },
    controls(host) {
      for (const other of ['altitudes', 'carries'] as const) {
        const link = document.createElement('a');
        const next = new URLSearchParams(params);
        next.set('kind', other);
        link.href = `?${next.toString()}`;
        link.textContent = other === 'altitudes' ? 'Stop 01 altitudes' : 'Stop 02 what a roadmap carries';
        link.className = 'pick';
        host.append(link);
      }
    },
    state: () => ({
      kind,
      names: station.names,
      form: station.form,
      focus: station.focus,
      up: Array.from({ length: station.count }, (_, index) => station.upOf(index)),
      anchors: station.anchors().map((anchor) => hooks.project(anchor)),
    }),
  };
}

// ---------------------------------------------------------------------------------------------------------
// 6. The drawings themselves, flat: every drawing of the package printed and cut out, with no lamp and no map.

interface ArtStat {
  readonly name: string;
  /** Share of the drawing's box that is paper. */
  readonly filled: number;
  /** Paper pixels outside the box to the left, to the right or above: a drawing larger than it says it is. */
  readonly over: number;
  /** Paper pixels on the left, right or top edge of the box, above the foot: a shape cut off by its box. */
  readonly cut: number;
}

function buildArtSheet(): ArtStat[] {
  const host = document.createElement('main');
  host.id = 'art';
  const filter = params.get('only');
  const stats: ArtStat[] = [];
  for (const drawing of allDrawings()) {
    if (filter && !filter.split(',').some((prefix) => drawing.name.startsWith(prefix))) continue;
    const scale = Math.min(9, Math.max(2.4, numberParam('px', 300) / Math.max(drawing.width, drawing.height)));
    const pad = 10;
    const w = Math.round(drawing.width * scale);
    const h = Math.round(drawing.height * scale);
    const { outline, print } = sheetDrawings(drawing.draw, drawing.width, drawing.height);
    const canvas = document.createElement('canvas');
    canvas.width = w + pad * 2;
    canvas.height = h + pad * 2;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.translate(pad, pad);
    print(ctx, w, h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const mask = document.createElement('canvas');
    mask.width = canvas.width;
    mask.height = canvas.height;
    const maskCtx = mask.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    maskCtx.translate(pad, pad);
    maskCtx.fillStyle = '#fff';
    maskCtx.strokeStyle = '#fff';
    outline(maskCtx, w, h);
    maskCtx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(mask, 0, 0);

    // Measure the cut. The foot may run on below the box, and its lowest band may meet the sides.
    const data = maskCtx.getImageData(0, 0, mask.width, mask.height).data;
    const paper = (x: number, y: number) => (data[(y * mask.width + x) * 4 + 3] as number) > 128;
    const foot = pad + Math.round(h * 0.9);
    let filled = 0;
    let over = 0;
    let cut = 0;
    for (let y = 0; y < mask.height; y += 1) {
      for (let x = 0; x < mask.width; x += 1) {
        if (!paper(x, y)) continue;
        const inside = x >= pad && x < pad + w && y >= pad && y < pad + h;
        if (inside) filled += 1;
        else if (y < foot && (x < pad - 1 || x > pad + w || y < pad - 1)) over += 1;
        if (y < foot && inside && (x === pad || x === pad + w - 1 || y === pad)) cut += 1;
      }
    }
    stats.push({ name: drawing.name, filled: filled / (w * h), over, cut });

    const figure = document.createElement('figure');
    figure.dataset.name = drawing.name;
    const caption = document.createElement('figcaption');
    caption.textContent = drawing.name;
    figure.append(canvas, caption);
    host.append(figure);
  }
  document.body.classList.add('flat');
  document.body.append(host);
  return stats;
}

interface Hooks {
  ready: Promise<void>;
  section: SectionId;
  lastTap: string | null;
  /** Measurements of the flat drawings. Filled by the `art` section. */
  art: ArtStat[];
  state(): unknown;
  /** Screen position of a scene point, in CSS pixels. */
  project(point: Vec3): { x: number; y: number };
  /** Mean colour of the rendered frame in a small square round a point given in CSS pixels. */
  pixel(x: number, y: number, half?: number): number[];
  /** Steps a held frame on by this many seconds and draws it. Only with ?t=. */
  step(seconds: number): void;
}
const hooks: Hooks = {
  ready: Promise.resolve(),
  section: sectionId,
  lastTap: null,
  art: [],
  state: () => null,
  project: () => ({ x: 0, y: 0 }),
  pixel: () => [0, 0, 0],
  step: () => undefined,
};
(window as unknown as { __props: Hooks }).__props = hooks;

const nav = document.getElementById('nav') as HTMLElement;
for (const id of SECTIONS) {
  const link = document.createElement('a');
  const next = new URLSearchParams(params);
  next.set('section', id);
  next.delete('only');
  link.href = `?${next.toString()}`;
  link.textContent = id;
  if (id === sectionId) link.setAttribute('aria-current', 'page');
  nav.append(link);
}

hooks.ready = (async () => {
  await loadFonts({ text: 'Größe Übung данные' });
  if (sectionId === 'art') {
    hooks.art = buildArtSheet();
    hooks.state = () => hooks.art;
    document.documentElement.dataset.props = 'ready';
    return;
  }
  const view = createView();
  view.resize();
  const builders: Record<Exclude<SectionId, 'art'>, (view: View) => Section> = {
    sheet: buildContactSheet,
    signposts: buildSignposts,
    parts: buildParts,
    scenery: buildScenery,
    station: buildStation,
  };
  const section = builders[sectionId](view);
  hooks.state = () => section.state?.() ?? null;
  section.controls?.(document.getElementById('controls') as HTMLElement);

  const labelHost = document.getElementById('labels') as HTMLElement;
  const labelNodes = section.labels.map((label) => {
    const node = document.createElement('span');
    node.className = `label${label.dim ? ' dim' : ''}`;
    node.textContent = label.text;
    labelHost.append(node);
    return node;
  });
  const scratch = new Vector3();
  const project = (point: Vec3) => {
    scratch.set(point.x, point.y, point.z).project(view.camera);
    return { x: ((scratch.x + 1) / 2) * view.canvas.clientWidth, y: ((1 - scratch.y) / 2) * view.canvas.clientHeight };
  };
  hooks.project = project;
  hooks.pixel = (x, y, half = 2) => {
    const gl = view.renderer.getContext();
    const scaleX = gl.drawingBufferWidth / view.canvas.clientWidth;
    const scaleY = gl.drawingBufferHeight / view.canvas.clientHeight;
    const size = half * 2 + 1;
    const pixels = new Uint8Array(size * size * 4);
    gl.readPixels(Math.round(x * scaleX) - half, Math.round((view.canvas.clientHeight - y) * scaleY) - half, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const sum = [0, 0, 0];
    for (let i = 0; i < size * size; i += 1) for (let c = 0; c < 3; c += 1) sum[c] = (sum[c] as number) + (pixels[i * 4 + c] as number);
    return sum.map((value) => Math.round(value / (size * size)));
  };

  const frameCamera = () => {
    view.resize();
    const narrow = view.aspect() < 0.85;
    const pose = fitPose(section.points, section.pool, section.elevation, section.yaw, narrow ? 40 : 34, { x0: -0.86, x1: 0.86, y0: -0.8, y1: 0.78 }, view.aspect());
    view.camera.fov = pose.fov;
    view.camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    view.camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
    view.camera.updateProjectionMatrix();
    view.camera.updateMatrixWorld();
    section.labels.forEach((label, index) => {
      const at = project(label.at);
      const node = labelNodes[index] as HTMLElement;
      node.style.left = `${at.x}px`;
      node.style.top = `${at.y + 4}px`;
    });
  };
  const draw = (frame: FrameTime) => {
    section.update(frame);
    frameCamera();
    view.renderer.render(view.scene, view.camera);
  };

  // A tap is a press and a release within 6 px.
  const raycaster = new Raycaster();
  let down: { x: number; y: number } | null = null;
  view.canvas.addEventListener('pointerdown', (event) => (down = { x: event.clientX, y: event.clientY }));
  view.canvas.addEventListener('pointerup', (event) => {
    if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6) return;
    const rect = view.canvas.getBoundingClientRect();
    raycaster.setFromCamera(new Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, 1 - ((event.clientY - rect.top) / rect.height) * 2), view.camera);
    section.tap?.(raycaster);
  });

  if (fixedTime !== null || reduced) {
    // A fixed 1/60 s frame up to the asked moment, then hold.
    const end = fixedTime ?? 4;
    let t = 0;
    section.update({ dt: 0, t: 0, reduced });
    while (t < end) {
      t = Math.min(end, t + 1 / 60);
      section.update({ dt: 1 / 60, t, reduced });
    }
    draw({ dt: 0, t, reduced });
    window.addEventListener('resize', () => draw({ dt: 0, t, reduced }));
    // A held frame can be stepped on, so a tap still shows its wobble and a check can read it.
    hooks.step = (seconds) => {
      const until = t + Math.max(0, seconds);
      while (t < until - 1e-9) {
        t = Math.min(until, t + 1 / 60);
        section.update({ dt: 1 / 60, t, reduced });
      }
      draw({ dt: 0, t, reduced });
    };
    view.canvas.addEventListener('pointerup', () => hooks.step(0.2));
  } else {
    let last = performance.now();
    let t = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      t += dt;
      if (!document.hidden) draw({ dt, t, reduced });
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  document.documentElement.dataset.props = 'ready';
})();
