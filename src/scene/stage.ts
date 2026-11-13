import {
  ACESFilmicToneMapping,
  Color,
  PCFShadowMap,
  PMREMGenerator,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { FrameTime, SceneEnvironment, ScenePart } from './contract';
import { PALETTE } from './palette';
import { createFrameClock, phoneLike, pixelRatioFor } from './stage-math';

export interface StageOptions {
  canvas: HTMLCanvasElement;
  /** Reads the visitor's reduced-motion wish on every frame. */
  reduced: () => boolean;
  background?: string;
  fov?: number;
}

export interface Stage {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly environment: SceneEnvironment;
  add(part: ScenePart): void;
  remove(part: ScenePart): void;
  /** Called every frame before the parts update, for the camera rig and the scroll. */
  onFrame(listener: (frame: FrameTime) => void): () => void;
  /** Draws one frame now, for tests and still captures. */
  renderOnce(): void;
  start(): void;
  stop(): void;
  dispose(): void;
}

/** True when this browser can give the page a WebGL2 or WebGL context. */
export function canUseWebGL(): boolean {
  try {
    const probe = document.createElement('canvas');
    return Boolean(probe.getContext('webgl2') ?? probe.getContext('webgl'));
  } catch {
    return false;
  }
}

/**
 * The one renderer, scene, camera and environment of the page. Parts are added to it and updated with a shared
 * frame time. The loop pauses while the tab is hidden and resizes with the canvas.
 */
export function createStage(options: StageOptions): Stage {
  const { canvas } = options;
  const phone = phoneLike(window.screen.width, window.screen.height, matchMedia('(pointer: coarse)').matches);
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;

  const scene = new Scene();
  scene.background = new Color(options.background ?? PALETTE.night);
  const camera = new PerspectiveCamera(options.fov ?? 34, 1, 0.1, 200);

  const pmrem = new PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envTarget = pmrem.fromScene(room, 0.035);
  room.dispose();
  pmrem.dispose();

  const environment: SceneEnvironment = {
    envMap: envTarget.texture,
    maxTexture: phone ? 1024 : 2048,
    phone,
  };

  const parts = new Set<ScenePart>();
  const listeners = new Set<(frame: FrameTime) => void>();
  const clock = createFrameClock();
  let raf = 0;
  let running = false;

  const resize = () => {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    renderer.setPixelRatio(pixelRatioFor(window.devicePixelRatio, phone));
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const time = clock.tick(now / 1000, options.reduced());
    for (const listener of listeners) listener(time);
    for (const part of parts) part.update(time);
    renderer.render(scene, camera);
  };

  const onVisibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
    } else if (running) {
      clock.resume();
      raf = requestAnimationFrame(frame);
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  return {
    renderer,
    scene,
    camera,
    environment,
    add(part) {
      parts.add(part);
      scene.add(part.object);
    },
    remove(part) {
      parts.delete(part);
      scene.remove(part.object);
    },
    onFrame(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    renderOnce() {
      const time = clock.tick(performance.now() / 1000, options.reduced());
      for (const listener of listeners) listener(time);
      for (const part of parts) part.update(time);
      renderer.render(scene, camera);
    },
    start() {
      if (running) return;
      running = true;
      clock.resume();
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
    dispose() {
      this.stop();
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      for (const part of parts) part.dispose();
      parts.clear();
      envTarget.dispose();
      renderer.dispose();
    },
  };
}
