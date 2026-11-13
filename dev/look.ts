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
  SRGBColorSpace,
  Scene,
  SpotLight,
  WebGLRenderer,
} from 'three';
import { setUiLang, uiLang } from '../src/i18n';
import {
  FONTS,
  LAMP,
  TEXT_PAIRS,
  THEME,
  brandMark,
  brandMarkDataUrl,
  canvasFont,
  contrast,
  createBrand,
  createBrandMark,
  createRoomOverlays,
  createWordmark,
  drawBrandMark,
  drawText,
  drawWordmark,
  ensurePaperEdge,
  formatDay,
  formatHours,
  injectTokens,
  loadFonts,
  tokenEntries,
  type FontReport,
  type FontRole,
} from '../src/look';
import {
  buildSheet,
  createRouteGeometry,
  createRouteMaterial,
  createSheetStack,
  fitPose,
  paperUniforms,
  type CameraPose,
  type Draw2D,
  type Sheet,
  type Vec3,
} from '../src/paper';
import { createRandom } from '../src/core/random';
import type { FrameTime } from '../src/scene/contract';

/**
 * Dev page for the look: the type sheet, the lamp calibration, a standing torn sheet with its shadow, and the
 * brand mark.
 *
 * URL: ?section=type|paper|sheet|brand shows one section alone and full size. ?t=seconds steps the scenes to
 * that moment with a fixed 1/60 s frame and holds (&still=1 also hides the captions). ?motion=reduced.
 * ?ui=en|de. Paper scene: &lamp=<candela>, &exposure=<n>. Sheet scene: &deckle=<n>, &fold=0..1,
 * &matte=sheet|shadow, &solo=1 (one sheet only), &light=rake|hero, &cam=front|close|edge|foot|shadow|shadow-edge|low|top.
 */
const params = new URLSearchParams(window.location.search);
const numberParam = (name: string, fallback: number): number => {
  const raw = params.get(name);
  if (raw === null || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
};
const only = params.get('section');
const still = params.get('still') === '1';
const fixedTime = params.has('t') ? numberParam('t', 0) : null;
const reduced = params.get('motion') === 'reduced' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

injectTokens();
ensurePaperEdge();
document.documentElement.lang = uiLang();
document.body.classList.toggle('solo', only !== null);
document.body.classList.toggle('still', still);

type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (name === 'class') element.className = value;
    else if (name === 'style') element.style.cssText = value;
    else element.setAttribute(name, value);
  }
  for (const child of children) if (child) element.append(child);
  return element;
}

const app = document.getElementById('app') as HTMLElement;
document.body.append(createRoomOverlays(document, { vignette: only === null || only === 'type' || only === 'brand' }));

function section(id: string, gl: boolean): HTMLElement {
  const element = h('section', { id, class: `${gl ? 'gl ' : ''}${only === id ? 'on' : ''}` });
  app.append(element);
  return element;
}

interface LookHooks {
  ready: Promise<void>;
  fonts: FontReport | null;
  widths: Record<FontRole, { face: number; fallback: number }> | null;
  calibration: { low: number[]; mid: number[]; top: number[]; pass: boolean; intensity: number; exposure: number } | null;
  sheet: {
    /** `sheet` shows the sheet flat white on black. `shadow` hides it and leaves its shadow on white ground. */
    setMatte(mode: 'none' | 'sheet' | 'shadow'): void;
    setDeckle(value: number): void;
    render(): void;
  } | null;
}
const hooks: LookHooks = { ready: Promise.resolve(), fonts: null, widths: null, calibration: null, sheet: null };
(window as unknown as { __look: LookHooks }).__look = hooks;

// ---------------------------------------------------------------------------------------------------------
// 1. Type sheet

function buildTypeSheet(root: HTMLElement): void {
  const lang = uiLang();
  const head = h(
    'div',
    { class: 'sheet-head' },
    createBrand(document, { size: 34, wordmark: 18 }),
    h('p', { class: 'eyebrow plain zt-label' }, 'Type sheet · three faces · OFL 1.1'),
  );

  const headline = h('h1', { class: 'zt-headline' }, 'Any topic, from zero to the ', h('em', {}, 'summit'), '.');
  const copy = h(
    'div',
    { class: 'hero-copy' },
    h('p', { class: 'eyebrow zt-label' }, 'Display · Fraunces 500 · 64 / 40 px'),
    headline,
    h(
      'p',
      { class: 'lede zt-body' },
      'A roadmap you can walk: stages, checkpoints, sources that were opened and checked, and a pace that is yours.',
    ),
    h('p', { class: 'eyebrow hint zt-label' }, 'Scroll down for altitudes, sources and pace'),
    h('button', { class: 'demo-button zt-label', type: 'button', id: 'focus-room' }, 'Walk this roadmap'),
  );

  const note = h(
    'article',
    { class: 'note zt-paper' },
    h('span', { class: 'zt-tape' }),
    h('p', { class: 'kicker zt-label' }, lang === 'de' ? 'Stunde 4,5 · Etappe 2 von 5' : 'Hour 4.5 · Stage 2 of 5'),
    h('h2', { class: 'zt-title' }, 'Reading the ground before you walk it'),
    h(
      'p',
      { class: 'zt-body' },
      'Predict first: where is the steepest part of this slope? Then open the source and check your answer against it.',
    ),
    h('div', { class: 'rule' }),
    h(
      'p',
      { class: 'meta zt-data' },
      h('span', {}, h('b', {}, formatHours(45)), ' · 70 % hands-on'),
      h('span', {}, `free · opened ${formatDay('2026-11-13')}`),
      h('span', { class: 'gated' }, 'sign-in needed for part 2'),
    ),
    h('button', { class: 'demo-button zt-label', type: 'button', id: 'focus-paper' }, 'Mark as done'),
  );

  const faces = h(
    'div',
    { class: 'faces' },
    h(
      'div',
      { class: 'face' },
      h('p', { class: 'eyebrow zt-label' }, 'Display · Fraunces'),
      h('p', { class: 'big display', 'data-face': 'display' }, 'Aa Gg ', h('i', {}, 'Rr'), ' 27'),
      h('p', { class: 'zt-title sample' }, 'From the first camp to the summit'),
      h('p', { class: 'glyphs zt-data' }, 'Weight 100 to 900 · optical size 9 to 144 · soft'),
      h('p', { class: 'use zt-small' }, 'Headlines, roadmap titles, cover titles, big numbers.'),
    ),
    h(
      'div',
      { class: 'face' },
      h('p', { class: 'eyebrow zt-label' }, 'Text · Atkinson Hyperlegible Next'),
      h('p', { class: 'big text', 'data-face': 'text' }, 'Aa Il1 O0'),
      h('p', { class: 'zt-body sample' }, 'Every letter is drawn to be told apart: I, l and 1, O and 0, rn and m.'),
      h('p', { class: 'glyphs zt-data' }, 'Weight 200 to 800 · upright and italic'),
      h('p', { class: 'use zt-small' }, 'Notes, tasks, buttons, everything that is read.'),
    ),
    h(
      'div',
      { class: 'face' },
      h('p', { class: 'eyebrow zt-label' }, 'Label · IBM Plex Mono'),
      h('p', { class: 'big label', 'data-face': 'label' }, 'Aa 0123'),
      h('p', { class: 'zt-label sample' }, 'Card 7 of 16 · Stage 2 · Silver · about 6 h'),
      h('p', { class: 'glyphs zt-data' }, 'Weight 400 and 500 · tabular figures'),
      h('p', { class: 'use zt-small' }, 'Map print, readouts, eyebrows, index numbers.'),
    ),
  );

  const scripts = h('div', { class: 'scripts' });
  const titles: [string, string, string][] = [
    ['Deutsch', 'de', 'Größenverhältnisse einschätzen'],
    ['Polski', 'pl', 'Źródła, które sprawdziliśmy'],
    ['Русский', 'ru', 'Основы статистики'],
    ['العربية', 'ar', 'تعلّم الخط العربي من الصفر'],
    ['日本語', 'ja', 'はじめての将棋'],
    ['हिन्दी', 'hi', 'हिंदी व्याकरण की शुरुआत'],
  ];
  for (const [name, code, title] of titles) {
    scripts.append(
      h('div', {}, h('p', { class: 'eyebrow plain zt-label' }, name), h('p', { class: 'zt-title', lang: code, dir: 'auto' }, title)),
    );
  }

  const printed = h('div', { class: 'printed' }, h('p', { class: 'eyebrow zt-label' }, 'Printed on canvas with drawText'));
  const canvas = h('canvas', { id: 'printed', role: 'img', 'aria-label': 'Sample of text printed on a canvas' });
  printed.append(canvas);

  const colours = h('div', { class: 'printed' }, h('p', { class: 'eyebrow zt-label' }, 'Tokens'));
  const swatches = h('div', { class: 'swatches' });
  for (const [name, value] of tokenEntries()) {
    swatches.append(
      h('div', { class: 'swatch' }, h('i', { style: `background:${value}` }), h('span', { class: 'zt-data' }, name.replace('--zt-', ''))),
    );
  }
  const pairs = h('div', { class: 'pairs' });
  for (const pair of TEXT_PAIRS) {
    pairs.append(
      h(
        'div',
        { class: 'pair zt-data', style: `background:${pair.ground};color:${pair.ink}` },
        h('span', {}, pair.name),
        h('span', { style: 'white-space:nowrap' }, `${contrast(pair.ink, pair.ground).toFixed(1)} : 1`),
      ),
    );
  }
  colours.append(swatches, pairs);

  root.append(head, h('div', { class: 'hero-grid' }, copy, h('div', { class: 'note-wrap' }, note)), faces, scripts, printed, colours);
}

/** A cover band printed with the canvas text kit: tracked labels, a display title, and joined scripts. */
function printSample(canvas: HTMLCanvasElement): void {
  const scale = Math.min(2, window.devicePixelRatio || 1);
  const cssWidth = Math.max(280, canvas.clientWidth || 800);
  const narrow = cssWidth < 620;
  const cssHeight = narrow ? 330 : 236;
  canvas.width = Math.round(cssWidth * scale);
  canvas.height = Math.round(cssHeight * scale);
  canvas.style.aspectRatio = `${cssWidth} / ${cssHeight}`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(scale, scale);
  ctx.fillStyle = THEME.cover.gold;
  ctx.fillRect(0, 0, cssWidth, cssHeight);
  const pad = narrow ? 18 : 28;

  drawBrandMark(ctx, pad, pad - 4, 22, { ink: THEME.paperHi });
  drawWordmark(ctx, pad + 30, pad + 12, 15, { ink: THEME.paperHi, signal: THEME.paperHi });
  ctx.fillStyle = THEME.paperHi;
  ctx.textBaseline = 'alphabetic';
  ctx.font = canvasFont('label', 10.5, 500);
  drawText(ctx, 'NO. 03', cssWidth - pad, pad + 10, { tracking: 0.14, align: 'right' });

  ctx.font = canvasFont('display', narrow ? 30 : 40, 500);
  drawText(ctx, 'Topographic maps', pad, pad + (narrow ? 62 : 74), { tracking: -0.02, lang: 'en' });
  ctx.font = canvasFont('display', narrow ? 30 : 40, 500, 'italic');
  drawText(ctx, 'from zero', pad, pad + (narrow ? 96 : 116), { tracking: -0.02, lang: 'en' });

  ctx.font = canvasFont('display', narrow ? 22 : 26, 500);
  // Joined and stacked scripts are drawn whole, whatever tracking is asked for.
  const right = narrow ? pad : cssWidth * 0.56;
  const top = narrow ? pad + 142 : pad + 52;
  drawText(ctx, 'تعلّم الخط العربي', right, top, { tracking: 0.14, lang: 'ar' });
  drawText(ctx, 'はじめての将棋', right, top + (narrow ? 32 : 38), { tracking: 0.14, lang: 'ja' });
  drawText(ctx, 'Основы статистики', right, top + (narrow ? 64 : 76), { tracking: -0.01, lang: 'ru' });

  ctx.globalAlpha = 0.5;
  ctx.fillRect(pad, cssHeight - pad - 22, cssWidth - pad * 2, 1);
  ctx.globalAlpha = 1;
  ctx.font = canvasFont('label', 10.5, 500);
  const row = ['5 STAGES', `${formatHours(38 * 60).toUpperCase()}`, 'TO GOLD', 'EN'];
  const step = (cssWidth - pad * 2) / (narrow ? 2 : 4);
  row.forEach((text, index) => {
    const column = narrow ? index % 2 : index;
    const line = narrow ? Math.floor(index / 2) : 0;
    drawText(ctx, text, pad + column * step, cssHeight - pad - 6 + line * 16 - (narrow ? 8 : 0), { tracking: 0.14 });
  });
}

/** Width of a sample in each face and in that face's fallback stack. They differ when the face has loaded. */
function measureFaces(): LookHooks['widths'] {
  const probe = document.createElement('canvas').getContext('2d');
  if (!probe) return null;
  const sample = 'Hamburgefonstiv 0123456789 Il1O0';
  const widths = {} as Record<FontRole, { face: number; fallback: number }>;
  for (const role of Object.keys(FONTS) as FontRole[]) {
    probe.font = canvasFont(role, 40);
    const face = probe.measureText(sample).width;
    probe.font = canvasFont(role, 40).replace(`'${FONTS[role].family}', `, '');
    widths[role] = { face, fallback: probe.measureText(sample).width };
  }
  return widths;
}

// ---------------------------------------------------------------------------------------------------------
// Scene plumbing shared by the two WebGL sections

interface View {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  lamp: SpotLight;
  ambient: AmbientLight;
  bounce: PointLight;
  table: Mesh<CircleGeometry, MeshStandardMaterial>;
  canvas: HTMLCanvasElement;
  aspect(): number;
  resize(): void;
  render(): void;
  usePose(pose: CameraPose): void;
}

function createView(host: HTMLElement, pool: Vec3): View {
  const canvas = h('canvas', { 'aria-hidden': 'true' });
  host.append(canvas);
  // The renderer the stage builds: ACES filmic at exposure 1, sRGB out, filtered shadows.
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = numberParam('exposure', LAMP.exposure);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;

  const scene = new Scene();
  scene.background = new Color(THEME.night);
  const camera = new PerspectiveCamera(34, 1, 0.1, 200);

  const lamp = new SpotLight(LAMP.color, numberParam('lamp', LAMP.intensity), 0, (LAMP.cone * Math.PI) / 180, LAMP.penumbra, LAMP.decay);
  lamp.position.set(pool.x + LAMP.offset.x, pool.y + LAMP.offset.y, pool.z + LAMP.offset.z);
  lamp.target.position.set(pool.x, pool.y, pool.z);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(LAMP.shadow.mapSize, LAMP.shadow.mapSize);
  lamp.shadow.camera.near = LAMP.shadow.near;
  lamp.shadow.camera.far = LAMP.shadow.far;
  lamp.shadow.bias = LAMP.shadow.bias;
  lamp.shadow.normalBias = LAMP.shadow.normalBias;
  const ambient = new AmbientLight(0xffffff, LAMP.ambient);
  scene.add(lamp, lamp.target, ambient);
  const bounce = new PointLight(LAMP.color, lamp.intensity * LAMP.bounce, 0, 2);
  bounce.position.copy(lamp.position);
  scene.add(bounce);

  // The table: dark walnut, enough to catch the pool and the shadows.
  const table = new Mesh(
    new CircleGeometry(9, 96),
    new MeshStandardMaterial({ color: THEME.walnut, roughness: 0.62, metalness: 0 }),
  );
  table.rotation.x = -Math.PI / 2;
  table.position.set(pool.x, -0.002, pool.z - 2);
  table.receiveShadow = true;
  scene.add(table);

  const view: View = {
    renderer,
    scene,
    camera,
    lamp,
    ambient,
    bounce,
    table,
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
    render() {
      renderer.render(scene, camera);
    },
    usePose(pose) {
      camera.fov = pose.fov;
      camera.position.set(pose.position.x, pose.position.y, pose.position.z);
      camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
      camera.updateProjectionMatrix();
    },
  };
  view.resize();
  return view;
}

/** Mean sRGB colour of a small square of the rendered frame, centred on a scene point. */
function readPatch(view: View, point: Vec3, half = 5): number[] {
  const gl = view.renderer.getContext();
  const projected = view.camera.position.clone().set(point.x, point.y, point.z).project(view.camera);
  const x = Math.round(((projected.x + 1) / 2) * gl.drawingBufferWidth);
  const y = Math.round(((projected.y + 1) / 2) * gl.drawingBufferHeight);
  const size = half * 2 + 1;
  const pixels = new Uint8Array(size * size * 4);
  gl.readPixels(x - half, y - half, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const sum = [0, 0, 0];
  for (let i = 0; i < size * size; i += 1) {
    sum[0] = (sum[0] as number) + (pixels[i * 4] as number);
    sum[1] = (sum[1] as number) + (pixels[i * 4 + 1] as number);
    sum[2] = (sum[2] as number) + (pixels[i * 4 + 2] as number);
  }
  return sum.map((value) => Math.round((value / (size * size)) * 10) / 10);
}

// ---------------------------------------------------------------------------------------------------------
// 2. Lamp calibration

function buildCalibration(root: HTMLElement): () => void {
  root.append(h('p', { class: 'eyebrow zt-label' }, 'Lamp calibration · paper under the middle of the pool'));
  const host = h('div', { class: 'scene' });
  const readout = h('p', { class: 'readout zt-data' });
  root.append(host, readout);

  const pool: Vec3 = { x: 0, y: 0, z: 0 };
  const view = createView(host, pool);

  // A sheet on the table and two cards above it: the heights of the table top, a low summit and the highest.
  const levels = [
    { name: 'sheet on the table', y: 0.004, size: 3.4, tone: THEME.paper },
    { name: 'low summit, 0.72', y: 0.72, size: 2.1, tone: THEME.card },
    { name: 'highest summit, 1.4', y: 1.4, size: 0.9, tone: THEME.paper },
  ];
  const sheets: Sheet[] = levels.map((level, index) => {
    const sheet = buildSheet({
      width: level.size,
      height: level.size,
      standing: false,
      paper: level.tone,
      seed: index + 1,
      resolution: 160,
      deckle: 0.003,
    });
    sheet.object.position.set(pool.x, level.y, pool.z);
    view.scene.add(sheet.object);
    return sheet;
  });

  const frame = () => {
    view.resize();
    const points: Vec3[] = [];
    for (const x of [-1.7, 1.7]) for (const z of [-1.7, 1.7]) points.push({ x, y: 0, z });
    points.push({ x: 0, y: 1.4, z: 0 });
    view.usePose(fitPose(points, pool, 52, -14, 34, { x0: -0.8, x1: 0.8, y0: -0.8, y1: 0.8 }, view.aspect()));
  };

  return () => {
    frame();
    view.render();
    const offsets = [1.35, 0.78, 0];
    const read = levels.map((level, index) => readPatch(view, { x: pool.x + (offsets[index] as number), y: level.y, z: pool.z + (offsets[index] as number) * 0.4 }));
    const top = read[2] as number[];
    const green = top[1] as number;
    const peak = Math.max(...read.flat());
    const pass = green >= LAMP.cardBand[0] && green <= LAMP.cardBand[1] && peak < 253;
    hooks.calibration = {
      low: read[0] as number[],
      mid: read[1] as number[],
      top,
      pass,
      intensity: view.lamp.intensity,
      exposure: view.renderer.toneMappingExposure,
    };
    readout.replaceChildren(
      `lamp ${view.lamp.intensity} cd · exposure ${view.renderer.toneMappingExposure} · ACES filmic\n`,
      ...levels.map((level, index) => `${level.name.padEnd(22)} rgb ${(read[index] as number[]).join(' ')}\n`),
      h('span', { class: pass ? 'ok' : 'miss' }, pass ? `in band ${LAMP.cardBand.join(' to ')}, nothing clips` : `outside ${LAMP.cardBand.join(' to ')} or clipped`),
    );
    void sheets;
  };
}

// ---------------------------------------------------------------------------------------------------------
// 3. A standing torn sheet and its shadow

/** A ridge with a snow cap: an original drawing, the kind of cut-out that stands on a map panel. */
function ridgeOutline(seed: number, rock: string = THEME.surface.rock): { outline: Draw2D; print: Draw2D } {
  const profile = (w: number, h: number): [number, number][] => {
    const random = createRandom(seed);
    const points: [number, number][] = [];
    const steps = 22;
    for (let i = 0; i <= steps; i += 1) {
      const u = i / steps;
      const peak = Math.exp(-Math.pow((u - 0.56) / 0.2, 2)) * 0.82 + Math.exp(-Math.pow((u - 0.24) / 0.13, 2)) * 0.42;
      const shoulder = 0.16 + 0.08 * Math.sin(u * 9 + seed);
      const y = Math.min(0.97, Math.max(peak, shoulder) + (random() - 0.5) * 0.05);
      points.push([u * w, h - y * h]);
    }
    return points;
  };
  const trace = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const points = profile(w, h);
    ctx.beginPath();
    ctx.moveTo(0, h * 1.5);
    for (const [x, y] of points) ctx.lineTo(x, y);
    ctx.lineTo(w, h * 1.5);
    ctx.closePath();
  };
  return {
    outline(ctx, w, h) {
      trace(ctx, w, h);
      ctx.fill();
    },
    print(ctx, w, h) {
      // Rock in a quiet slate, with the snow left as bare paper along the top.
      ctx.save();
      trace(ctx, w, h);
      ctx.clip();
      ctx.fillStyle = rock;
      ctx.fillRect(-w, -h, w * 3, h * 4);
      const points = profile(w, h);
      ctx.fillStyle = THEME.paperHi;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      for (const [x, y] of points) ctx.lineTo(x, y);
      ctx.lineTo(w, 0);
      ctx.lineTo(w, -h);
      ctx.lineTo(0, -h);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      points.forEach(([x, y], index) => {
        const depth = h * (0.1 + 0.07 * Math.sin(index * 1.9 + seed) + (index % 2) * 0.06);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        ctx.lineTo(x + w * 0.012, y + depth);
      });
      ctx.lineTo(w, 0);
      ctx.lineTo(0, 0);
      ctx.closePath();
      ctx.fill();
      // Hatching on the shaded flank, in ink.
      ctx.strokeStyle = 'rgba(31, 42, 61, 0.28)';
      ctx.lineWidth = Math.max(1, h * 0.006);
      for (let i = 0; i < 26; i += 1) {
        const x = w * (0.58 + i * 0.016);
        ctx.beginPath();
        ctx.moveTo(x, h * (0.34 + i * 0.022));
        ctx.lineTo(x + w * 0.05, h * (0.5 + i * 0.022));
        ctx.stroke();
      }
      ctx.restore();
    },
  };
}

/** A map panel: paper with contour lines, an original drawing from a small noise field. */
const panelPrint: Draw2D = (ctx, w, h) => {
  const random = createRandom('look-panel');
  const centres = Array.from({ length: 4 }, () => ({ x: random() * w, y: random() * h, r: (0.25 + random() * 0.35) * w }));
  const field = (x: number, y: number) => {
    let value = 0;
    for (const c of centres) value += Math.exp(-((x - c.x) ** 2 + (y - c.y) ** 2) / (c.r * c.r));
    return value;
  };
  ctx.strokeStyle = 'rgba(31, 42, 61, 0.34)';
  ctx.lineWidth = Math.max(1, w * 0.0016);
  const cell = w / 110;
  for (let level = 0.18; level < 1.9; level += 0.13) {
    ctx.beginPath();
    for (let y = 0; y < h; y += cell) {
      for (let x = 0; x < w; x += cell) {
        const a = field(x, y) - level;
        const b = field(x + cell, y) - level;
        const c = field(x, y + cell) - level;
        const cuts: [number, number][] = [];
        if (a * b < 0) cuts.push([x + (cell * a) / (a - b), y]);
        if (a * c < 0) cuts.push([x, y + (cell * a) / (a - c)]);
        const d = field(x + cell, y + cell) - level;
        if (b * d < 0) cuts.push([x + cell, y + (cell * b) / (b - d)]);
        if (c * d < 0) cuts.push([x + (cell * c) / (c - d), y + cell]);
        if (cuts.length >= 2) {
          ctx.moveTo((cuts[0] as [number, number])[0], (cuts[0] as [number, number])[1]);
          ctx.lineTo((cuts[1] as [number, number])[0], (cuts[1] as [number, number])[1]);
        }
      }
    }
    ctx.stroke();
  }
};

function buildSheetScene(root: HTMLElement): (frame: FrameTime) => void {
  root.append(h('p', { class: 'eyebrow zt-label' }, 'Paper · a standing cut-out, its torn edge and its shadow'));
  const host = h('div', { class: 'scene' });
  const readout = h('p', { class: 'readout zt-data' }, 'The shadow caster reads the same outline field as the sheet.');
  root.append(host, readout);

  const pool: Vec3 = { x: 0, y: 0, z: 0.4 };
  const view = createView(host, pool);
  const solo = params.get('solo') === '1';
  const deckle = params.has('deckle') ? numberParam('deckle', 0.006) : undefined;

  // The lamp of this scene. `rake` is the low lamp that stands by a mountain, here from the front right, so
  // the faces of the cut-outs are lit and their shadows run back across the map. `hero` is the lamp over the
  // table, above and behind, which lights the cut-outs through the paper.
  const light = params.get('light') ?? 'rake';
  if (light === 'rake') {
    const azimuth = (numberParam('az', 150) * Math.PI) / 180;
    const elevation = (numberParam('el', 31) * Math.PI) / 180;
    view.lamp.position.set(
      pool.x + 7.6 * Math.sin(azimuth) * Math.cos(elevation),
      pool.y + 7.6 * Math.sin(elevation),
      pool.z - 7.6 * Math.cos(azimuth) * Math.cos(elevation),
    );
    view.lamp.angle = (44 * Math.PI) / 180;
    view.lamp.intensity = numberParam('lamp', LAMP.intensity) * 0.82;
    view.ambient.intensity = 0.21;
    view.bounce.intensity = numberParam('lamp', LAMP.intensity) * 0.07;
    view.bounce.position.copy(view.lamp.position);
    // The shadow map looks only at the middle of the cone, where the map panel is, so shadows stay fine.
    view.lamp.shadow.focus = 0.5;
  }

  const panel = buildSheet({
    width: 4.2,
    height: 5.6,
    standing: false,
    print: panelPrint,
    seed: 3,
    resolution: 240,
    warp: 0.012,
    deckle: 0.003,
  });
  panel.object.position.set(0, 0.004, 0.6);
  panel.mesh.castShadow = false;
  view.scene.add(panel.object);

  const ridge = ridgeOutline(11);
  const cutouts: { sheet: Sheet; x: number; z: number }[] = [
    { sheet: buildSheet({ width: 2.7, height: 1.55, ...ridge, seed: 5, sway: 0.006, ...(deckle === undefined ? {} : { deckle }) }), x: -0.15, z: -0.55 },
  ];
  if (!solo) {
    const small = ridgeOutline(4, THEME.surface.forest);
    cutouts.push({
      sheet: buildSheet({ width: 1.5, height: 0.62, ...small, seed: 9, sway: 0.012, paper: THEME.paper, ...(deckle === undefined ? {} : { deckle }) }),
      x: 0.95,
      z: 0.75,
    });
    cutouts.push({
      sheet: buildSheet({ width: 0.9, height: 1.05, seed: 13, sway: 0.01, paper: THEME.card, ...(deckle === undefined ? {} : { deckle }) }),
      x: -1.35,
      z: 0.5,
    });
  }

  // Cut-outs stand on the panel, a hair into its surface so no light passes under a foot.
  const FOOT = 0.008;
  const stack = createSheetStack();
  for (const cutout of cutouts) {
    const { sheet } = cutout;
    sheet.object.position.set(cutout.x, FOOT, cutout.z);
    view.scene.add(sheet.object);
    stack.add({
      height: sheet.height,
      width: sheet.width,
      x: cutout.x,
      z: cutout.z,
      sway: sheet.sway,
      phase: sheet.seed,
      apply(pose) {
        sheet.setAngle(pose.angle);
        sheet.object.position.y = FOOT + pose.lift;
        sheet.object.rotation.z = pose.sway;
      },
    });
  }

  // The route across the panel, passing in front of the ridge: dashed ahead, solid where it was walked.
  const routePoints: Vec3[] = [];
  for (let i = 0; i <= 80; i += 1) {
    const u = i / 80;
    routePoints.push({ x: -1.9 + u * 3.8, y: 0, z: 0.95 - Math.sin(u * Math.PI * 1.4) * 0.75 + Math.sin(u * 9) * 0.06 });
  }
  const ribbon = createRouteGeometry(routePoints);
  const routeMaterial = createRouteMaterial({ seed: 2, follow: panel.material });
  routeMaterial.setWalked(ribbon.length * 0.42);
  const route = new Mesh(ribbon.geometry, routeMaterial);
  route.receiveShadow = true;
  // A child of the panel, in the panel's own frame, so it bends with the paper.
  if (!solo) panel.object.add(route);

  const cam = params.get('cam') ?? 'front';
  const frame = () => {
    view.resize();
    const points: Vec3[] = [
      { x: -2.1, y: 0, z: -1.6 },
      { x: 2.1, y: 0, z: -1.6 },
      { x: -2.1, y: 0, z: 3.4 },
      { x: 2.1, y: 0, z: 3.4 },
      { x: -1.5, y: 1.6, z: -0.55 },
      { x: 1.2, y: 1.6, z: -0.55 },
    ];
    const narrow = view.aspect() < 0.85;
    const close: Vec3[] = [
      { x: -0.9, y: 0.45, z: -0.55 },
      { x: 0.75, y: 0.45, z: -0.55 },
      { x: -0.9, y: 1.6, z: -0.55 },
      { x: 0.75, y: 1.6, z: -0.55 },
    ];
    const foot: Vec3[] = [
      { x: 0.1, y: 0, z: 0.75 },
      { x: 1.8, y: 0, z: 0.75 },
      { x: 0.1, y: 0.7, z: 0.75 },
      { x: 1.8, y: 0.7, z: 0.75 },
      { x: 0.1, y: 0, z: 1.3 },
    ];
    const behind: Vec3[] = [
      { x: -2.7, y: 0, z: -2.9 },
      { x: 1.3, y: 0, z: -2.9 },
      { x: -1.7, y: 0, z: -0.5 },
      { x: 1.3, y: 0, z: -0.5 },
    ];
    const edge: Vec3[] = [
      { x: -0.45, y: 0.8, z: -0.55 },
      { x: 0.45, y: 0.8, z: -0.55 },
      { x: -0.45, y: 1.62, z: -0.55 },
      { x: 0.45, y: 1.62, z: -0.55 },
    ];
    const behindClose: Vec3[] = [
      { x: -1.7, y: 0, z: -2.5 },
      { x: 0.3, y: 0, z: -2.5 },
      { x: -1.7, y: 0, z: -0.9 },
      { x: 0.3, y: 0, z: -0.9 },
    ];
    const pose =
      cam === 'shadow-edge'
        ? fitPose(behindClose, pool, 70, -4, 26, { x0: -0.98, x1: 0.98, y0: -0.98, y1: 0.98 }, view.aspect())
        : cam === 'edge'
        ? fitPose(edge, pool, 12, -8, 26, { x0: -0.96, x1: 0.96, y0: -0.96, y1: 0.96 }, view.aspect())
        : cam === 'shadow'
        ? fitPose(behind, pool, 62, -6, 30, { x0: -0.92, x1: 0.92, y0: -0.92, y1: 0.92 }, view.aspect())
        : cam === 'close'
        ? fitPose(close, pool, 16, -12, 30, { x0: -0.9, x1: 0.9, y0: -0.9, y1: 0.9 }, view.aspect())
        : cam === 'foot'
          ? fitPose(foot, pool, 24, -10, 30, { x0: -0.9, x1: 0.9, y0: -0.9, y1: 0.9 }, view.aspect())
          : cam === 'top'
        ? fitPose(points, pool, 80, 0, 34, { x0: -0.9, x1: 0.9, y0: -0.9, y1: 0.9 }, view.aspect())
        : cam === 'low'
          ? fitPose(points.slice(4).concat([{ x: -1.5, y: 0, z: 1.2 }, { x: 1.2, y: 0, z: 1.2 }]), pool, 14, -16, 34, { x0: -0.8, x1: 0.8, y0: -0.7, y1: 0.7 }, view.aspect())
          : fitPose(points, pool, narrow ? 40 : 30, -9, narrow ? 40 : 34, { x0: -0.92, x1: 0.92, y0: -0.9, y1: 0.78 }, view.aspect());
    view.usePose(pose);
  };

  const fold = numberParam('fold', 1);
  stack.setFold(fold);
  if (reduced) stack.settle();

  // Matte passes for measuring a capture. They change what is shaded, never the outline: the sheet keeps its
  // geometry, its outline field and its shadow caster.
  let matte: 'none' | 'sheet' | 'shadow' = 'none';
  const night = new Color(THEME.night);
  const ground = view.table.material;
  const groundColor = ground.color.clone();
  const ambientLevel = view.ambient.intensity;
  const bounceLevel = view.bounce.intensity;
  const applyMatte = () => {
    for (const { sheet } of cutouts) {
      paperUniforms(sheet.material).uZtMatte.value = matte === 'sheet' ? 1 : 0;
      sheet.material.colorWrite = matte !== 'shadow';
      sheet.material.depthWrite = matte !== 'shadow';
    }
    // `sheet`: the cut-outs flat white on black. `shadow`: the cut-outs unseen, their shadows alone on a
    // plain white ground with no fill light.
    panel.object.visible = matte === 'none';
    view.table.visible = matte !== 'sheet';
    ground.color.set(matte === 'shadow' ? 0xffffff : groundColor);
    ground.roughness = matte === 'shadow' ? 1 : 0.62;
    view.ambient.intensity = matte === 'shadow' ? 0 : ambientLevel;
    view.bounce.intensity = matte === 'shadow' ? 0 : bounceLevel;
    view.scene.background = matte === 'sheet' ? new Color(0x000000) : night;
  };
  hooks.sheet = {
    setMatte(mode) {
      matte = mode;
      applyMatte();
    },
    setDeckle(value) {
      for (const { sheet } of cutouts) paperUniforms(sheet.material).uZtShape.value.z = value;
    },
    render() {
      frame();
      view.render();
    },
  };
  const initial = params.get('matte');
  if (initial === 'sheet' || initial === 'shadow') hooks.sheet.setMatte(initial);

  return (time) => {
    stack.update(time);
    routeMaterial.setDraw(reduced ? ribbon.length : Math.min(ribbon.length, Math.max(0, time.t - 0.4) * 2.2));
    frame();
    view.render();
  };
}

// ---------------------------------------------------------------------------------------------------------
// 4. Brand mark

function buildBrand(root: HTMLElement): void {
  root.append(h('p', { class: 'eyebrow zt-label' }, 'Brand · the zero bearing'));
  const marks = h('div', { class: 'marks' });
  const caption = (text: string) => h('span', { class: 'zt-data', style: 'color:var(--zt-text-faint)' }, text);

  for (const size of [512, 32, 16]) {
    const plate = h('div', { class: 'plate', 'data-mark': String(size), style: `width:${size}px;max-width:100%;aspect-ratio:1` });
    plate.append(createBrandMark(size, { title: 'zero-to' }));
    (plate.firstElementChild as SVGElement).style.maxWidth = '100%';
    (plate.firstElementChild as SVGElement).style.height = 'auto';
    marks.append(h('div', { class: 'mark' }, plate, caption(`${size} px`)));
  }

  // The small sizes again, drawn on a canvas at their true pixel size and shown eight times larger.
  for (const size of [16, 32]) {
    const zoom = h('canvas', { class: 'zoom', 'data-zoom': String(size), width: String(size), height: String(size), style: `width:${size * 8}px;height:${size * 8}px` });
    const ctx = zoom.getContext('2d');
    if (ctx) {
      ctx.fillStyle = THEME.night;
      ctx.fillRect(0, 0, size, size);
      drawBrandMark(ctx, 0, 0, size);
    }
    marks.append(h('div', { class: 'mark' }, zoom, caption(`${size} px, pixels × 8`)));
  }

  for (const size of [64, 32, 16]) {
    const plate = h('div', { class: 'plate paper', style: `width:${size + 24}px;height:${size + 24}px` });
    plate.append(createBrandMark(size, { ink: THEME.ink }));
    marks.append(h('div', { class: 'mark' }, plate, caption(`${size} px on paper`)));
  }

  const icon = h('img', { width: '128', height: '128', alt: 'zero-to app icon', src: brandMarkDataUrl(128, { tile: THEME.night }) });
  const favicon = h('img', { width: '16', height: '16', alt: 'zero-to favicon', src: brandMarkDataUrl(16, { adaptive: true }) });
  marks.append(h('div', { class: 'mark' }, icon, caption('app icon')), h('div', { class: 'mark' }, h('div', { class: 'plate paper', style: 'width:40px;height:40px' }, favicon), caption('favicon, follows the tab colour')));

  const lockups = h(
    'div',
    { class: 'lockups' },
    createBrand(document, { size: 34, wordmark: 18 }),
    createBrand(document, { size: 56, wordmark: 30 }),
    h('div', { class: 'on-paper' }, createBrand(document, { size: 34, wordmark: 18, ink: THEME.ink, signal: THEME.signalDeep })),
  );
  const big = h('div', { class: 'wordmark-big' }, createWordmark());
  root.append(marks, lockups, big);

  const link = h('link', { rel: 'icon', type: 'image/svg+xml', href: brandMarkDataUrl(32, { adaptive: true }) });
  document.head.append(link);
  void brandMark;
}

// ---------------------------------------------------------------------------------------------------------

const wants = (id: string) => only === null || only === id;
const typeSection = wants('type') ? section('type', false) : null;
const paperSection = wants('paper') ? section('paper', true) : null;
const sheetSection = wants('sheet') ? section('sheet', true) : null;
const brandSection = wants('brand') ? section('brand', false) : null;

if (params.has('ui')) setUiLang(uiLang(), false);

hooks.ready = (async () => {
  hooks.fonts = await loadFonts({ text: 'Größenverhältnisse Źródła' });
  hooks.widths = measureFaces();
  if (typeSection) {
    buildTypeSheet(typeSection);
    const canvas = document.getElementById('printed') as HTMLCanvasElement;
    printSample(canvas);
    window.addEventListener('resize', () => printSample(canvas));
  }
  if (brandSection) buildBrand(brandSection);

  const calibrate = paperSection ? buildCalibration(paperSection) : null;
  const sheetFrame = sheetSection ? buildSheetScene(sheetSection) : null;

  if (fixedTime !== null || reduced) {
    // A fixed 1/60 s frame up to the asked moment, then hold.
    const end = fixedTime ?? 6;
    let t = 0;
    sheetFrame?.({ dt: 0, t: 0, reduced });
    while (t < end) {
      t = Math.min(end, t + 1 / 60);
      sheetFrame?.({ dt: 1 / 60, t, reduced });
    }
    calibrate?.();
    window.addEventListener('resize', () => {
      calibrate?.();
      sheetFrame?.({ dt: 0, t, reduced });
    });
  } else {
    let last = performance.now();
    let t = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      t += dt;
      if (!document.hidden) {
        calibrate?.();
        sheetFrame?.({ dt, t, reduced });
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  document.documentElement.dataset.look = 'ready';
})();
