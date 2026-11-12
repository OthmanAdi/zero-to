import type { Object3D, Texture } from 'three';

/**
 * Shared rules for everything drawn in the zero-to scene.
 *
 * Units: one unit is about 10 cm of a real table. The round table has a radius of 9 and its top is at y = 0.
 * The compass stands at the centre, about 2.4 across, floating between y = 0.9 and y = 1.3.
 * A terrain model (a paper mountain) has a footprint of 4 by 4 (x and z in [-2, 2]) and is at most 1.4 high.
 * Map sheets lie flat on the table, about 4.2 by 5.6, around the compass.
 *
 * Renderer: WebGLRenderer with ACESFilmic tone mapping, sRGB output, PCF soft shadows. Reflections come from one
 * PMREM environment map that the host builds once and passes in, so every metal and glass part reflects the same
 * room. A part never creates its own renderer, scene, camera or environment.
 *
 * Every part is created by a factory and returned as a `ScenePart`. The host adds `object` to its scene, calls
 * `update` once per frame and `dispose` when the part leaves. Parts never read the clock themselves: time comes
 * through `update`, so tests, recordings and reduced motion can drive them.
 */
export interface FrameTime {
  /** Seconds since the previous frame, clamped by the host to at most 0.1. */
  readonly dt: number;
  /** Seconds since the scene started. */
  readonly t: number;
  /** True when the visitor asked for reduced motion. Parts then hold still or move without travel. */
  readonly reduced: boolean;
}

export interface ScenePart<TObject extends Object3D = Object3D> {
  readonly object: TObject;
  update(frame: FrameTime): void;
  dispose(): void;
}

/** What the host hands every part that needs it. */
export interface SceneEnvironment {
  /** PMREM-filtered environment map for reflections. Null in tests and in the no-WebGL path. */
  readonly envMap: Texture | null;
  /** Largest texture side the device should use. 2048 on desktops, 1024 on phones. */
  readonly maxTexture: number;
  /** True on small touch screens. Parts use fewer segments and smaller canvases. */
  readonly phone: boolean;
}
