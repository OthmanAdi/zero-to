import { AmbientLight, CircleGeometry, Color, DataTexture, Group, LinearFilter, Mesh, MeshStandardMaterial, PerspectiveCamera, PointLight, RGBAFormat, SpotLight, type Scene, type WebGLRenderer } from 'three';
import { LAMP } from '../look/lamp';
import { THEME } from '../look/theme';
import { fitPose, type CameraPose } from '../paper/motion';
import { STATION, createStation, createWalker, routeDepth, type StationKind, type StationPart, type WalkerPart } from '../props';
import type { FrameTime, SceneEnvironment } from '../scene/contract';
import type { StagedStop, StopId } from '../sections';
import { STAGING, boxRows, clothShows, focusAt, formFor, lampCandela, lampPlace, placeBox, spotFrame, standingAt, walkerAt, type SpotFrame } from './staging';
import { mixPose } from './timeline';

/**
 * The paper stations of the landing page, in 3D. Each one stands on its own cloth under its own lamp, far from
 * the table, and is drawn into the box of its stop while that box is on the screen. The stop says how far the
 * station has formed and which of its cut-outs is in front. The numbers are in `staging.ts`.
 */

/** Which station stands at which stop. */
const KINDS: Partial<Record<StopId, StationKind>> = { what: 'altitudes', trail: 'carries' };

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
  /**
   * Where the cut-out in front of each station in the window is on the screen, in pixels: the point just above
   * it that a line from its card leads to. A station with nothing in front is not in the list.
   */
  leads(): readonly { readonly id: StopId; readonly x: number; readonly y: number }[];
  /** How far each station that has been built has formed, by stop, for checks. */
  forms(): Partial<Record<StopId, number>>;
  dispose(): void;
}

interface Entry {
  readonly id: StopId;
  readonly group: Group;
  readonly station: StationPart;
  /** What the camera frames on a wide and on a narrow window: each thing on its own, or the ring as one. */
  readonly frames: { readonly wide: readonly SpotFrame[]; readonly narrow: readonly SpotFrame[] };
  /** The walker in ink on the sheet, and where he stood along it in the last frame. */
  readonly walker: WalkerPart;
  walkerX: number | null;
  readonly dispose: () => void;
  /** The camera fitted to each frame for the place the station has now. */
  poses: CameraPose[];
  /** The camera of this frame: between two of `poses` while it pans. */
  pose: CameraPose | null;
  poseKey: string;
  /** Where the stop's box is on the screen this frame, or null when it is out of the window. */
  rows: { from: number; to: number } | null;
  boxTop: number;
  /** The point above the cut-out in front, on the screen, or null. */
  lead: { x: number; y: number } | null;
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
  /** Puts the one camera on a station, moved down to where the box of its stop is. */
  const aim = (entry: Entry, pose: CameraPose, width: number, height: number): void => {
    camera.fov = pose.fov;
    camera.aspect = width / Math.max(1, height);
    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
    // The picture is fitted for a box at the top of the window and moved down to where the box is.
    camera.setViewOffset(width, height, 0, -entry.boxTop, width, height);
    camera.updateMatrixWorld();
  };
  let visible = false;
  let alpha: DataTexture | null = null;

  /**
   * Puts the walker on the route at `x`, turned along it. `walked` says whether he walked there, which plays his
   * steps, or was put there.
   */
  const placeWalker = (entry: Entry, x: number, walked: boolean): void => {
    const { route } = entry.station;
    const z = routeDepth(route, x);
    const ahead = routeDepth(route, x + 0.05) - routeDepth(route, x - 0.05);
    entry.walker.object.position.set(x, STATION.thickness, z);
    entry.walker.object.rotation.y = -Math.atan2(ahead, 0.1);
    if (walked && entry.walkerX !== null) entry.walker.advance((x - entry.walkerX) / STAGING.walker.scale);
    entry.walkerX = x;
  };

  const build = (id: StopId, kind: StationKind): Entry => {
    const index = entries.size;
    const group = new Group();
    group.name = `station-${id}`;
    group.position.set(STAGING.away + index * STAGING.apart, 0, 0);
    group.visible = false;

    const station = createStation(kind, { environment, seed: 2 });
    group.add(station.object);
    const { width } = station.size;

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
    // The walker waits at the start of the route while the sheet comes up, and crosses it while the stop holds.
    const walker = createWalker({ phone: environment.phone, seed: 5 });
    walker.object.scale.setScalar(STAGING.walker.scale);
    walker.object.visible = false;
    group.add(walker.object);
    scene.add(group);

    const cx = group.position.x;
    // Each thing with the route in front of it, as deep as the route comes anywhere across the thing.
    const framesFor = (side: number) =>
      station.spots.map((spot) => {
        const half = spot.width / 2;
        const front = Math.max(...[-half, 0, half].map((dx) => routeDepth(station.route, spot.x + dx)));
        return spotFrame(spot, front, cx, { ...STAGING.focus, side });
      });
    // The ring keeps its margin on a phone: the cards at its sides stand out past its circle.
    const frames = { wide: framesFor(STAGING.focus.side), narrow: framesFor(station.spots.length > 1 ? STAGING.focus.narrowSide : STAGING.focus.side) };

    return {
      id,
      group,
      station,
      frames,
      walker,
      walkerX: null,
      poses: [],
      pose: null,
      poseKey: '',
      rows: null,
      boxTop: 0,
      lead: null,
      dispose: () => {
        group.removeFromParent();
        station.dispose();
        walker.dispose();
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
      for (const entry of entries.values()) {
        entry.rows = null;
        entry.lead = null;
      }
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
        // A station of several things is framed one at a time, and each stands when the camera comes to it.
        const focusing = entry.frames.wide.length > 1;
        const form = focusing ? formFor(standingAt(stop.state, station.count), station.count) : stop.state.form;
        // He is on the sheet while it comes up and while it holds, and has walked on once the stop is done.
        const things = focusing ? station.spots.map((spot) => spot.x) : [];
        const walkerX = walkerAt(stop.state.hold, things, station.route[0]?.x ?? 0);
        entry.walker.object.visible = stop.state.phase === 'forming' || stop.state.phase === 'active';
        if (!rows) {
          // Out of the window it keeps up with the stop without playing anything.
          station.setForm(form, true);
          station.setFocus(front, true);
          placeWalker(entry, walkerX, false);
          continue;
        }
        station.setForm(time.reduced ? 1 : form, time.reduced);
        station.setFocus(front, time.reduced);
        station.update(time);
        placeWalker(entry, walkerX, !time.reduced);
        entry.walker.update(time);
        const place = stop.slot.getBoundingClientRect();
        const fit = placeBox(place, box, width, height);
        const key = `${width}/${height}/${fit.x0.toFixed(4)}/${fit.x1.toFixed(4)}/${fit.y0.toFixed(4)}/${fit.y1.toFixed(4)}`;
        if (key !== entry.poseKey && fit.x1 > fit.x0 && fit.y1 > fit.y0) {
          entry.poseKey = key;
          const shot = focusing ? STAGING.focus : STAGING.shot;
          const narrow = width < STAGING.narrow;
          const fov = narrow ? STAGING.shot.narrowFov : STAGING.shot.fov;
          entry.poses = entry.frames[narrow ? 'narrow' : 'wide'].map((frame) => fitPose(frame.points, frame.target, shot.elevation, shot.yaw, fov, fit, width / Math.max(1, height), { startDistance: 14 }));
        }
        const at = focusing ? focusAt(stop.state.hold, entry.poses.length) : 0;
        const k = Math.max(0, Math.min(entry.poses.length - 2, Math.floor(at)));
        const from = entry.poses[k];
        const to = entry.poses[k + 1];
        entry.pose = from && to ? mixPose(from, to, at - k) : (from ?? null);
        entry.rows = rows;
        entry.boxTop = Math.round(box.top);
        if (!entry.pose) continue;
        visible = true;
        const anchor = front >= 0 && station.upOf(front) > 0.6 ? station.anchors()[front] : undefined;
        if (anchor) {
          aim(entry, entry.pose, width, height);
          anchor.project(camera);
          entry.lead = { x: ((anchor.x + 1) / 2) * width, y: ((1 - anchor.y) / 2) * height };
        }
      }
      return visible;
    },
    draw(renderer, scene, width, height) {
      for (const entry of entries.values()) {
        const { rows, pose } = entry;
        if (!rows || !pose) continue;
        entry.group.visible = true;
        aim(entry, pose, width, height);
        renderer.setScissor(0, height - rows.to, width, rows.to - rows.from);
        renderer.render(scene, camera);
        entry.group.visible = false;
      }
    },
    leads() {
      const out: { id: StopId; x: number; y: number }[] = [];
      for (const entry of entries.values()) if (entry.lead) out.push({ id: entry.id, x: entry.lead.x, y: entry.lead.y });
      return out;
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
