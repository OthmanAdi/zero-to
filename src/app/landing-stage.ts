import { AmbientLight, CircleGeometry, Color, DataTexture, Group, LinearFilter, Mesh, MeshStandardMaterial, PerspectiveCamera, PointLight, RGBAFormat, SpotLight, type Scene, type WebGLRenderer } from 'three';
import { LAMP } from '../look/lamp';
import { THEME } from '../look/theme';
import { fitPose, type CameraPose, type Vec3 } from '../paper/motion';
import { createStation, type StationKind, type StationPart } from '../props';
import type { FrameTime, SceneEnvironment } from '../scene/contract';
import type { StagedStop, StopId } from '../sections';
import { STAGING, boxRows, clothShows, lampCandela, lampPlace, placeBox } from './staging';

/**
 * The paper stations of the landing page, in 3D. Each one stands on its own cloth under its own lamp, far from
 * the table, and is drawn into the box of its stop while that box is on the screen. The stop says how far the
 * station has formed and which of its cut-outs is in front. The numbers are in `staging.ts`.
 */

/** Which station stands at which stop. */
const KINDS: Partial<Record<StopId, StationKind>> = { what: 'altitudes', trail: 'carries' };

/** The highest thing on a station, for the camera's fit. */
const TALLEST: Record<StationKind, number> = { altitudes: 2.5, carries: 1.5 };

export interface LandingStage {
  /**
   * Takes the staged stops of this frame: forms and updates the stations whose boxes are in the window and
   * fits their cameras. A station is built when its box comes near the window, and from further away while
   * the page is `calm` (nothing else is being played). Returns true when at least one station is to be drawn.
   */
  frame(staged: readonly StagedStop[], time: FrameTime, width: number, height: number, calm: boolean): boolean;
  /** Draws the stations of the last `frame` into the rows of their boxes. The scissor test stays on. */
  draw(renderer: WebGLRenderer, scene: Scene, width: number, height: number): void;
  /** True when the last `frame` had a station in the window. */
  readonly visible: boolean;
  /** How far each station that has been built has formed, by stop, for checks. */
  forms(): Partial<Record<StopId, number>>;
  dispose(): void;
}

interface Entry {
  readonly id: StopId;
  readonly group: Group;
  readonly station: StationPart;
  readonly points: readonly Vec3[];
  readonly target: Vec3;
  readonly dispose: () => void;
  pose: CameraPose | null;
  poseKey: string;
  /** Where the stop's box is on the screen this frame, or null when it is out of the window. */
  rows: { from: number; to: number } | null;
  boxTop: number;
}

/** A round texture whose alpha falls to nothing at the rim, for a cloth with no edge. */
function clothAlpha(size = 128): DataTexture {
  const data = new Uint8Array(size * size * 4);
  const half = (size - 1) / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const value = Math.round(255 * clothShows(Math.hypot(x - half, y - half) / half));
      data.fill(value, (y * size + x) * 4, (y * size + x) * 4 + 4);
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function createLandingStage(environment: SceneEnvironment, scene: Scene): LandingStage {
  const entries = new Map<StopId, Entry>();
  const camera = new PerspectiveCamera(STAGING.shot.fov, 1, 0.1, 200);
  let visible = false;
  let alpha: DataTexture | null = null;

  const build = (id: StopId, kind: StationKind): Entry => {
    const index = entries.size;
    const group = new Group();
    group.name = `station-${id}`;
    group.position.set(STAGING.away + index * STAGING.apart, 0, 0);
    group.visible = false;

    const station = createStation(kind, { environment, seed: 2 });
    group.add(station.object);
    const { width, depth } = station.size;

    // The cloth: dark, lit only where the lamp falls, and gone into the night at its rim.
    alpha ??= clothAlpha();
    const clothMaterial = new MeshStandardMaterial({ color: new Color(THEME.cloth), roughness: 1, metalness: 0, alphaMap: alpha, transparent: true, depthWrite: false });
    const cloth = new Mesh(new CircleGeometry(width * STAGING.cloth.radius, 72), clothMaterial);
    cloth.name = 'station-cloth';
    cloth.rotation.x = -Math.PI / 2;
    cloth.position.y = -0.004;
    cloth.receiveShadow = true;
    group.add(cloth);

    const hang = lampPlace(width);
    const candela = lampCandela(LAMP.intensity, hang.distance);
    const lamp = new SpotLight(new Color(LAMP.color), candela, 0, (STAGING.lamp.cone * Math.PI) / 180, STAGING.lamp.penumbra, LAMP.decay);
    lamp.name = 'station-lamp';
    lamp.position.set(hang.x, hang.y, hang.z);
    lamp.target.position.set(0, 0, 0);
    lamp.castShadow = true;
    const mapSize = Math.min(STAGING.lamp.shadowMap, environment.maxTexture);
    lamp.shadow.mapSize.set(mapSize, mapSize);
    lamp.shadow.camera.near = hang.distance * 0.3;
    lamp.shadow.camera.far = hang.distance * 2.4;
    lamp.shadow.bias = LAMP.shadow.bias;
    lamp.shadow.normalBias = LAMP.shadow.normalBias;
    lamp.shadow.focus = STAGING.lamp.focus;
    const bounce = new PointLight(new Color(LAMP.color), candela * STAGING.lamp.bounce, 0, LAMP.decay);
    bounce.position.copy(lamp.position);
    const ambient = new AmbientLight(0xffffff, STAGING.ambient);
    group.add(lamp, lamp.target, bounce, ambient);
    scene.add(group);

    const cx = group.position.x;
    const points: Vec3[] = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) points.push({ x: cx + (sx * width) / 2, y: 0, z: (sz * depth) / 2 });
    points.push({ x: cx, y: TALLEST[kind], z: -0.5 });

    return {
      id,
      group,
      station,
      points,
      target: { x: cx, y: 0.4, z: 0 },
      pose: null,
      poseKey: '',
      rows: null,
      boxTop: 0,
      dispose: () => {
        group.removeFromParent();
        station.dispose();
        cloth.geometry.dispose();
        clothMaterial.dispose();
        lamp.shadow.map?.dispose();
        lamp.dispose();
        bounce.dispose();
        ambient.dispose();
      },
    };
  };

  return {
    get visible() {
      return visible;
    },
    frame(staged, time, width, height, calm) {
      visible = false;
      let built = false;
      for (const entry of entries.values()) entry.rows = null;
      for (const stop of staged) {
        const kind = KINDS[stop.id];
        if (!kind) continue;
        const box = stop.box.getBoundingClientRect();
        const rows = boxRows(box, height);
        let entry = entries.get(stop.id);
        // A station is built when its box comes near the window, not with the page, and one a frame at most.
        const near = height * (calm ? STAGING.build.calm : STAGING.build.busy);
        if (!entry && !built && box.top < near && box.top + box.height > -height * 0.5) {
          entry = build(stop.id, kind);
          entries.set(stop.id, entry);
          built = true;
        }
        if (!entry) continue;
        const { station } = entry;
        const front = stop.front >= 0 && stop.front < station.count ? stop.front : -1;
        if (!rows) {
          // Out of the window it keeps up with the stop without playing anything.
          station.setForm(stop.state.form, true);
          station.setFocus(front, true);
          continue;
        }
        station.setForm(time.reduced ? 1 : stop.state.form, time.reduced);
        station.setFocus(front, time.reduced);
        station.update(time);
        const place = stop.slot.getBoundingClientRect();
        const fit = placeBox(place, box, width, height);
        const key = `${width}/${height}/${fit.x0.toFixed(4)}/${fit.x1.toFixed(4)}/${fit.y0.toFixed(4)}/${fit.y1.toFixed(4)}`;
        if (key !== entry.poseKey && fit.x1 > fit.x0 && fit.y1 > fit.y0) {
          entry.poseKey = key;
          entry.pose = fitPose(entry.points, entry.target, STAGING.shot.elevation, STAGING.shot.yaw, STAGING.shot.fov, fit, width / Math.max(1, height), { startDistance: 14 });
        }
        entry.rows = rows;
        entry.boxTop = Math.round(box.top);
        if (entry.pose) visible = true;
      }
      return visible;
    },
    draw(renderer, scene, width, height) {
      for (const entry of entries.values()) {
        const { rows, pose } = entry;
        if (!rows || !pose) continue;
        entry.group.visible = true;
        camera.fov = pose.fov;
        camera.aspect = width / Math.max(1, height);
        camera.position.set(pose.position.x, pose.position.y, pose.position.z);
        camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
        // The picture is fitted for a box at the top of the window and moved down to where the box is.
        camera.setViewOffset(width, height, 0, -entry.boxTop, width, height);
        camera.updateMatrixWorld();
        renderer.setScissor(0, height - rows.to, width, rows.to - rows.from);
        renderer.render(scene, camera);
        entry.group.visible = false;
      }
    },
    forms() {
      const out: Partial<Record<StopId, number>> = {};
      for (const entry of entries.values()) out[entry.id] = entry.station.form;
      return out;
    },
    dispose() {
      for (const entry of entries.values()) entry.dispose();
      entries.clear();
      alpha?.dispose();
      alpha = null;
      visible = false;
    },
  };
}
