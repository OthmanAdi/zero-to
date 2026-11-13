import {
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Raycaster,
  SpotLight,
  Vector3,
  type Camera,
  type Ray,
} from 'three';
import { hashSeed } from '../core/random';
import { uiLang, type UiLang } from '../i18n';
import { THEME } from '../look/theme';
import { clamp01, lerp, seg, settleSpring, smooth, spring, stepSpringKC, type CameraPose, type Vec3 } from '../paper/motion';
import { buildSheet, type Sheet } from '../paper/sheet';
import { createWalker, type WalkerPart } from '../props';
import type { Progress } from '../roadmap/progress';
import type { Roadmap } from '../roadmap/types';
import type { FrameTime, SceneEnvironment, ScenePart } from '../scene/contract';
import { COVER, coverLayout, paintCover, titleMeasure, type CoverSpec } from '../table/cover';
import { PIN, createPin, type Pin } from '../table/pin';
import { createCloth } from '../table/room';
import { flatTones } from '../table/sheet';
import { trailAlong } from '../table/sheet-data';
import { PANEL, coverAngle, coverHeight, creaseAngle, panelLanded, stackOffset } from './fold';
import { createPanelView, type PanelView, type WalkHit, type WeightedWorldPoint } from './panel';
import { hereAt, placeAt, planWalk, progressForAlong, progressForItem, type HerePlace, type PanelPlan, type WalkPlace, type WalkPlan } from './plan';
import { MINI, PRINT, miniPixel, paintLegend, paintMiniMap } from './print';
import { LANDING, cameraAt, landingPose, panelLeft, railPoses, type WalkInsets } from './rail';
import { WALK, mapOpenAt, railAt, sceneAt, type WalkItem } from './timeline';

/**
 * The light of the walk: a little daylight everywhere and one lamp whose pool is one panel wide.
 *
 * The lamp stands in front of the panel it lights, a little to the right. A low lamp throws a pool that is
 * long in the direction it shines. Shining from the front, the pool is long along the depth of the panel and
 * narrow across the row of panels, so the panel under the camera is lit from edge to edge and the panels
 * beside it fall into shade.
 */
export const WALK_LIGHT = {
  key: 0.27,
  hemisphere: 0.1,
  fill: 0.05,
  /** The lamp: candela, half-angle of its cone in degrees, and where it stands from the point it lights. */
  lamp: { intensity: 560, cone: 22, penumbra: 0.6, decay: 2, distance: 9.3, azimuth: 152, elevation: 34 },
  /** Where the pool lies on a panel, measured from the panel's middle. */
  aim: { x: -0.1, z: 0.35 },
  shadow: { mapSize: 2048, phoneMapSize: 1024, near: 2.3, far: 24, bias: -0.0003, normalBias: 0.015 },
  /** Fog starts and ends at these multiples of the camera's distance from what it looks at. */
  fog: { near: 1.8, far: 5.5 },
} as const;

/** The walker's own springs and distances. */
export const WALKER_ON_MAP = {
  /** His height follows the ground on this spring. */
  k: 220,
  c: 18,
  /** A move longer than this in one frame is a jump: he is put there and does not walk it. */
  jump: 1.2,
  /** The pin stands up when the walker is further than this from it, in route length. */
  pinClear: 0.4,
} as const;

export interface WalkInput {
  readonly roadmap: Roadmap;
  readonly progress?: Progress | null;
  /** Interface language of the prints. The visitor's by default. */
  readonly lang?: UiLang;
  /** For the cover: the place on the table, and whether this is a gallery example. */
  readonly number?: number;
  readonly example?: boolean;
  /** The dark cloth under the map. On by default; a host that has its own ground turns it off. */
  readonly ground?: boolean;
  /** The lights of the walk. On by default. */
  readonly lights?: boolean;
  /** Milliseconds per frame spent on building. Default 10. */
  readonly budget?: number;
}

/** A point on the screen in window pixels, with how much a note should keep off it. */
export interface WalkScreenPoint {
  readonly x: number;
  readonly y: number;
  readonly weight: number;
}

export interface WalkProjection {
  /** The walker's head on the screen, or null when he is not shown. */
  readonly walker: { readonly x: number; readonly y: number } | null;
  /** Route, signs and props of the panel he is on. Signs weigh 40, route points 6, props 3. */
  readonly points: WalkScreenPoint[];
}

export interface WalkMiniMap {
  /** The base drawing of the stage, 560 by 300. */
  readonly canvas: HTMLCanvasElement;
  /** The walker's pixel on it, or null when he is on another stage. */
  readonly pixel: { readonly x: number; readonly y: number } | null;
  /** The waypoints of the stage on the drawing. */
  readonly marks: readonly { readonly id: string; readonly x: number; readonly y: number; readonly title: string }[];
}

/** Where the director wants to walk to. */
export interface WalkTarget {
  /** A share of the roadmap's minutes, 0 to 1. */
  readonly along?: number;
  readonly waypointId?: string;
  readonly stageId?: string;
  /** With a stage: its signpost or its camp. Without, the start of the stage. */
  readonly kind?: 'signpost' | 'camp';
}

export interface WalkPart extends ScenePart<Group> {
  readonly plan: WalkPlan;
  /** True once every panel is printed and built. */
  readonly ready: boolean;
  /** Share of the building that is done, 0 to 1. */
  readonly built: number;
  /** Builds everything that is left at once, for stills and tests. */
  finish(): void;
  /** How far the map is open, 0 shut to 1 lying open. Null hands the fold back to the walk progress. */
  setFold(fold: number | null): void;
  readonly fold: number;
  /** Lifts the shut cover a little, 0 to 1, to say that it opens. */
  setPeek(peek: number): void;
  /** Walk progress, 0 to 1. */
  setProgress(p: number): void;
  readonly progress: number;
  /** You-are-here as a share of the roadmap's minutes. The pin stands there and the route is solid up to it. */
  setHere(along: number): void;
  /** Indexes of the stages whose checkpoint is passed. */
  setPassed(stages: readonly number[]): void;
  /** Waypoints whose review is due: their cairns carry the ring. */
  setDue(waypointIds: readonly string[]): void;
  /** Finished rungs of a stage's project: one flag per rung flies at its camp. */
  setRungs(stageId: string, done: number): void;
  /** Ticked arms of a stage's signpost. */
  setTicked(stageId: string, ticked: readonly boolean[]): void;
  /** The landing after the dive, 0 to 1, or null when there is none. */
  setLanding(u: number | null): void;
  /** The camera during the landing. */
  landingPose(u: number): CameraPose;
  /** Solves the rail for a window and keeps it. Returns the poses: the shut map, the panels, the whole map, the shut map. */
  posesFor(aspect: number, insets?: WalkInsets): CameraPose[];
  /** The camera on the rail at walk progress `p` (the current progress by default). */
  cameraAt(p?: number): CameraPose;
  /**
   * Where the lamp's pool lies. By default it follows the rail: the middle of the panel the camera is on.
   * A host that wants it elsewhere passes a point in the part's space; null hands it back to the rail.
   */
  aim(target: Vec3 | null): void;
  /** Strength of the walk's own lights, 0 to 1, for the hand-over from the table's lamp. */
  setLight(amount: number): void;
  /** Where fog should start and end for a camera at this distance from what it looks at. */
  fogFor(distance: number): { near: number; far: number };
  /** Screen points of the walker, the route, the signs and the props of his panel, for placing the note. */
  projectActive(camera: Camera, viewport: { readonly width: number; readonly height: number }): WalkProjection;
  /** What the walker stands on: a waypoint, a signpost or a camp. Null before the walk and after it. */
  readonly activeItem: WalkItem | null;
  /** Where he is: panel, place on its path, length walked, share of the minutes behind him. */
  readonly place: WalkPlace;
  /** The share of the roadmap's minutes behind the walker, 0 to 1. */
  readonly along: number;
  /** The mini map of a stage and the walker's pixel on it. */
  miniMap(stageIndex: number): WalkMiniMap | null;
  /** What a ray meets: the walker, a sign, a camp, a cairn, a prop or the pin. */
  hitTest(ray: Ray): WalkHit | null;
  /** The same, and whatever was hit wobbles. */
  tap(ray: Ray): WalkHit | null;
  /** Walk progress for a place: a share of the minutes, a waypoint, or a stage's start, signpost or camp. */
  progressFor(target: WalkTarget): number | null;
  /** A point of a panel (x across, y up, z from the back edge to the front) in world space. */
  panelToWorld(index: number, x: number, y: number, z: number, target?: Vector3): Vector3;
  /** Height of the ground under a point of a panel right now, in panel coordinates. */
  groundAt(index: number, x: number, z: number): number;
  /** Where the walker's feet are, in world space, and whether he is shown. */
  walkerFeet(target?: Vector3): Vector3;
  readonly walkerShown: boolean;
  /** You-are-here: the panel, the place on it and the length of route before it. */
  readonly here: HerePlace;
  /** A point just above the walker's hat, in world space. */
  walkerTop(target?: Vector3): Vector3;
  /** The head of the pin in world space. */
  pinHead(target?: Vector3): Vector3;
  /** Puts everything where it is heading, with no motion. */
  settle(): void;
  /** Prints everything again: after the fonts arrived. */
  reprint(): void;
}

const RAD = Math.PI / 180;

/**
 * The walk: the folded map of one roadmap. It opens panel by panel, every panel grows its own stretch of the
 * mountain, and a paper walker follows the dashed route past waypoints, signposts and camps.
 *
 * The part's origin is the middle of the shut map on the table, x to the right and z toward the viewer. The
 * part does not move the camera: it solves the rail (`posesFor`, `cameraAt`, `landingPose`) and the host
 * applies it.
 */
export function createWalk(environment: SceneEnvironment, input: WalkInput): WalkPart {
  const lang = input.lang ?? uiLang();
  const phone = environment.phone;
  const plan = planWalk(input.roadmap, { progress: input.progress ?? null, phone });
  const { schedule, windows } = plan;
  const count = plan.panels.length;
  const budget = input.budget ?? 10;

  const object = new Group();
  object.name = 'walk';
  const map = new Group();
  map.name = 'walk-map';
  object.add(map);

  // -------------------------------------------------------------------------------------------------------
  // State that comes from outside.

  let progress = 0;
  let foldOverride: number | null = null;
  let fold = -1;
  let peek = 0;
  let hereShare = plan.data.hereMinuteShare;
  let here: HerePlace = hereAt(plan, hereShare);
  let passed = new Set<number>(plan.data.passed);
  let due: ReadonlySet<string> = new Set();
  let landing: number | null = null;
  let light = 1;
  const aimAt = new Vector3(0, 0, 0);
  let aimOverride: Vector3 | null = null;

  const inkOf = (index: number): number => {
    if (input.roadmap.brief.gating === 'open') return 1;
    let open = 0;
    while (open < count && passed.has(open)) open += 1;
    const entry = Math.max(0, input.roadmap.stages.findIndex((stage) => stage.id === input.roadmap.brief.entry));
    return index <= Math.max(open, entry, here.panel) ? 1 : PRINT.dimInk;
  };

  // -------------------------------------------------------------------------------------------------------
  // The panels, hung on each other's creases.

  const entryIndex = Math.max(0, input.roadmap.stages.findIndex((stage) => stage.id === input.roadmap.brief.entry));
  const views: PanelView[] = plan.panels.map((panel) =>
    createPanelView(panel, {
      plan,
      environment,
      lang,
      ink: inkOf(panel.index),
      scale: panel.index === here.panel ? PRINT.activeScale : PRINT.restScale,
      passed: passed.has(panel.index),
      entry: panel.index === entryIndex,
    }),
  );
  views.forEach((view, index) => {
    if (index === 0) {
      view.pivot.position.set(-PANEL.width / 2, 0, 0);
      map.add(view.pivot);
    } else {
      view.pivot.position.set(PANEL.width, 0, 0);
      (views[index - 1] as PanelView).frame.add(view.pivot);
    }
  });
  const firstFrame = (views[0] as PanelView).frame;

  // -------------------------------------------------------------------------------------------------------
  // The cover, hinged on the left edge of panel 0. Its inside is the legend.

  const coverHinge = new Group();
  coverHinge.name = 'walk-cover';
  coverHinge.position.set(0, coverHeight(count), 0);
  firstFrame.add(coverHinge);
  let coverSheet: Sheet | null = null;
  let legendSheet: Sheet | null = null;

  const coverPrint = (): HTMLCanvasElement | null => {
    const scale = Math.min(phone ? 1 : 2, environment.maxTexture / COVER.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(COVER.width * scale);
    canvas.height = Math.round(COVER.height * scale);
    const context = canvas.getContext('2d');
    if (!context) return null;
    const data = plan.data;
    const spec: CoverSpec = {
      title: data.roadmap.title,
      lang: data.roadmap.lang,
      number: input.number ?? 1,
      tier: data.tier,
      stages: data.stageCount,
      minutes: data.totalMinutes,
      share: data.share,
      example: input.example === true,
      measure: titleMeasure(context, data.roadmap.lang),
    };
    const layout = coverLayout(spec, lang);
    const hereAlong = trailAlong(data, plan.print.trail.stops.map((stop) => stop.along), hereShare);
    paintCover(context, layout, spec, { print: plan.print, here: hereAlong, walked: data.share > 0 ? hereAlong : 0, tones: flatTones(layout.board, plan.print.surfaces), lang, seed: data.map.seed }, scale);
    return canvas;
  };

  const buildCover = (): void => {
    const image = coverPrint();
    const board = THEME.cover[plan.data.tier];
    coverSheet = buildSheet({
      width: COVER.body.width,
      height: COVER.body.depth,
      standing: false,
      paper: board,
      resolution: (COVER.width * (phone ? 1 : 1.6)) / COVER.body.width,
      maxCanvas: environment.maxTexture,
      soft: 0.03,
      seed: 3.3,
      deckle: 0.0012,
      warp: 0.003,
      fibre: 0.05,
      rim: 0.18,
      through: 0,
      print: (ctx, width, height) => {
        if (image) ctx.drawImage(image, 0, 0, width, height);
      },
    });
    coverSheet.object.position.set(PANEL.width / 2, 0.003, 0);
    legendSheet = buildSheet({
      width: COVER.body.width,
      height: COVER.body.depth,
      standing: false,
      paper: THEME.paper,
      resolution: (PRINT.width * (phone ? 1 : 1.5)) / PANEL.width,
      maxCanvas: environment.maxTexture,
      soft: 0.03,
      seed: 5.1,
      deckle: 0.0012,
      warp: 0.003,
      rim: 0.3,
      through: 0,
      print: (ctx, width, height) => paintLegend(ctx, width, height, { plan, lang }),
    });
    // Turned over: it faces the map while the cover is shut and the lamp once the cover lies open.
    legendSheet.object.rotation.z = Math.PI;
    legendSheet.object.position.set(PANEL.width / 2, -0.001, 0);
    coverHinge.add(coverSheet.object, legendSheet.object);
  };

  // -------------------------------------------------------------------------------------------------------
  // The walker and the pin.

  const walker: WalkerPart = createWalker({ phone, seed: hashSeed(plan.data.map.seed) % 89, up: false });
  walker.object.visible = false;
  const walkerHeight = spring(0);
  let walkerPanel = -1;
  let walkerLength: number | null = null;
  let walkerShown = false;

  const pin: Pin = createPin(environment);
  pin.setStanding(false, true);
  pin.object.visible = false;
  let pinPanel = -1;
  const pinAnchor = new Vector3();

  // -------------------------------------------------------------------------------------------------------
  // The lights.

  const lights = new Group();
  lights.name = 'walk-lights';
  const key = new DirectionalLight(new Color(THEME.lampCold), WALK_LIGHT.key);
  const hemisphere = new HemisphereLight(new Color(THEME.glass), new Color(THEME.night), WALK_LIGHT.hemisphere);
  const fill = new DirectionalLight(new Color(THEME.lampCold), WALK_LIGHT.fill);
  const lamp = new SpotLight(new Color(THEME.lampLight), WALK_LIGHT.lamp.intensity, 0, WALK_LIGHT.lamp.cone * RAD, WALK_LIGHT.lamp.penumbra, WALK_LIGHT.lamp.decay);
  lamp.castShadow = true;
  const mapSize = phone ? WALK_LIGHT.shadow.phoneMapSize : WALK_LIGHT.shadow.mapSize;
  lamp.shadow.mapSize.set(mapSize, mapSize);
  lamp.shadow.camera.near = WALK_LIGHT.shadow.near;
  lamp.shadow.camera.far = WALK_LIGHT.shadow.far;
  lamp.shadow.bias = WALK_LIGHT.shadow.bias;
  lamp.shadow.normalBias = WALK_LIGHT.shadow.normalBias;
  lights.add(key, key.target, hemisphere, fill, fill.target, lamp, lamp.target);
  if (input.lights !== false) object.add(lights);

  const placeLights = (): void => {
    const { azimuth, elevation, distance } = WALK_LIGHT.lamp;
    const az = azimuth * RAD;
    const el = elevation * RAD;
    lamp.position.set(aimAt.x + distance * Math.sin(az) * Math.cos(el), aimAt.y + distance * Math.sin(el), aimAt.z - distance * Math.cos(az) * Math.cos(el));
    lamp.target.position.copy(aimAt);
    key.position.set(aimAt.x - 5.2, aimAt.y + 8.7, aimAt.z + 4.7);
    key.target.position.copy(aimAt);
    fill.position.set(aimAt.x + 1.7, aimAt.y + 2.3, aimAt.z + 9.3);
    fill.target.position.copy(aimAt);
    lamp.intensity = WALK_LIGHT.lamp.intensity * light;
    key.intensity = WALK_LIGHT.key * light;
    hemisphere.intensity = WALK_LIGHT.hemisphere * light;
    fill.intensity = WALK_LIGHT.fill * light;
  };
  placeLights();

  const cloth = input.ground === false ? null : createCloth(environment);
  if (cloth) {
    cloth.mesh.position.y = -0.012;
    object.add(cloth.mesh);
  }

  // -------------------------------------------------------------------------------------------------------
  // Building, a little per frame. The cover and the panel the walker lands on come first.

  const queue: (() => void)[] = [buildCover];
  const order = views.map((_, index) => index).sort((a, b) => Math.abs(a - here.panel) - Math.abs(b - here.panel));
  for (const index of order) queue.push(...(views[index] as PanelView).steps);
  const total = queue.length;
  let done = 0;
  let dirty = true;

  const runQueue = (milliseconds: number): void => {
    if (done >= total) return;
    const start = performance.now();
    do {
      (queue[done] as () => void)();
      done += 1;
    } while (done < total && performance.now() - start < milliseconds);
    dirty = true;
  };

  // -------------------------------------------------------------------------------------------------------
  // The rail.

  let poses: CameraPose[] = railPoses(count, 1.6);

  // -------------------------------------------------------------------------------------------------------
  // Mini maps, drawn when first asked for and again when you-are-here moves.

  const minis = new Map<number, { canvas: HTMLCanvasElement; walked: number }>();
  const walkedOn = (panel: PanelPlan): number => Math.min(panel.length, Math.max(0, here.length - panel.start));

  // -------------------------------------------------------------------------------------------------------
  // Placing everything for the current state.

  let place: WalkPlace = placeAt(plan, 0);
  const scratch = new Vector3();
  const raycaster = new Raycaster();

  const applyFold = (next: number): void => {
    if (next === fold && !dirty) return;
    fold = next;
    for (let index = 1; index < count; index += 1) {
      const view = views[index] as PanelView;
      view.pivot.rotation.z = creaseAngle(schedule, index, fold);
      view.frame.position.y = stackOffset(schedule, index, fold);
    }
    coverHinge.rotation.z = coverAngle(schedule, fold, peek);
  };

  const sceneOf = (index: number): number => {
    const byProgress = sceneAt(progress, index, windows);
    if (landing === null || index !== here.panel) return byProgress;
    return Math.max(byProgress * (landing >= 1 ? 1 : 0), smooth(seg(landing, LANDING.panel, 0.66)));
  };

  const frameOf = (index: number): Group => (views[Math.min(count - 1, Math.max(0, index))] as PanelView).frame;

  const state = (): { open: boolean; shown: boolean; length: number } => {
    place = placeAt(plan, progress);
    const open = fold > 0.999;
    const inRange = progress > WALK.walker.from && progress < WALK.walker.to;
    const shown = landing !== null ? landing >= LANDING.walker : inRange && panelLanded(schedule, place.panel, fold);
    return { open, shown, length: place.length };
  };

  const update = (frame: FrameTime): void => {
    runQueue(budget);
    applyFold(foldOverride ?? mapOpenAt(progress));
    const { open, shown, length } = state();

    // Panels: their scenes, their routes, their things.
    const drawn = landing !== null && landing < LANDING.walker ? Math.min(length, here.length) : length;
    views.forEach((view, index) => {
      const landed = panelLanded(schedule, index, fold);
      view.setScene(sceneOf(index), landed);
      view.setWalker(shown && index === place.panel ? place.point.x : null, shown || progress >= WALK.walker.to ? length : -Infinity);
      view.setRoute(drawn, here.length, open);
      view.update(frame);
    });

    // The walker.
    const view = views[place.panel] as PanelView;
    if (walkerPanel !== place.panel) {
      frameOf(place.panel).add(walker.object);
      walkerPanel = place.panel;
    }
    const ground = view.groundAt(place.point.x, place.point.z);
    const moved = walkerLength === null ? 0 : length - walkerLength;
    const jumped = walkerLength === null || Math.abs(moved) > WALKER_ON_MAP.jump || !walkerShown;
    if (jumped || frame.reduced) settleSpring(walkerHeight, ground);
    else stepSpringKC(walkerHeight, ground, WALKER_ON_MAP.k, WALKER_ON_MAP.c, Math.min(frame.dt, 0.034));
    if (!jumped && shown) walker.advance(moved);
    walkerLength = length;
    if (shown !== walkerShown) {
      walker.setUp(shown, frame.reduced);
      walkerShown = shown;
    }
    walker.object.position.set(place.point.x, walkerHeight.x + 0.004, place.point.z + 0.012);
    walker.update(frame);
    walker.object.visible = shown || walker.up > 0.02;

    // The pin, at you-are-here.
    if (pinPanel !== here.panel) {
      frameOf(here.panel).add(pin.object);
      pinPanel = here.panel;
    }
    const pinView = views[here.panel] as PanelView;
    const pinLanded = panelLanded(schedule, here.panel, fold);
    const onPin = shown && place.panel === here.panel && Math.abs(length - here.length) < WALKER_ON_MAP.pinClear;
    let standing = pinLanded && !onPin && sceneOf(here.panel) > 0.5;
    let size = 1;
    if (landing !== null) {
      standing = landing < LANDING.press.from;
      size = lerp(LANDING.head, 1, smooth(seg(landing, LANDING.pull.to, LANDING.eye.to)));
    }
    pin.setStanding(standing, landing !== null && landing <= 0);
    pin.object.scale.setScalar(size);
    pin.object.visible = pinLanded || landing !== null;
    pinAnchor.set(here.point.x, pinView.groundAt(here.point.x, here.point.z) + 0.006, here.point.z - 0.012);
    pin.update(frame.dt, pinAnchor, frame.reduced);

    // The lamp stands by the panel the camera is on, and by the walker while he lands.
    if (aimOverride) {
      aimAt.copy(aimOverride);
    } else if (landing !== null && landing < 1) {
      aimAt.set(panelLeft(here.panel) + here.point.x, 0.1, here.point.z);
    } else {
      const rail = railAt(progress, count, windows);
      const middle = panelLeft(0) + (count * PANEL.width) / 2;
      let x: number;
      if (rail <= 1) x = 0;
      else if (rail <= count) x = (rail - 1) * PANEL.width;
      else if (rail <= count + 1) x = lerp((count - 1) * PANEL.width, middle, rail - count);
      else x = lerp(middle, 0, rail - count - 1);
      const onPanel = clamp01(rail) * (1 - clamp01(rail - count - 1));
      aimAt.set(x + WALK_LIGHT.aim.x * onPanel, 0.1, WALK_LIGHT.aim.z * onPanel);
    }
    placeLights();
    dirty = false;
  };

  const hitTest = (ray: Ray, tap: boolean): WalkHit | null => {
    raycaster.ray.copy(ray);
    object.updateWorldMatrix(true, true);
    let best: WalkHit | null = null;
    let owner: PanelView | null = null;
    for (const view of views) {
      const hit = view.hit(raycaster);
      if (hit && (!best || hit.distance < best.distance)) {
        best = hit;
        owner = view;
      }
    }
    const walkerHit = walkerShown ? walker.hit(raycaster) : null;
    if (walkerHit !== null && (!best || walkerHit < best.distance)) {
      best = { kind: 'walker', panel: place.panel, stageId: (plan.panels[place.panel] as PanelPlan).stage.id, distance: walkerHit };
      owner = null;
    }
    if (pin.object.visible) {
      const head = pin.headWorld(scratch);
      const reach = PIN.radius * 2.2;
      const along = head.clone().sub(ray.origin).dot(ray.direction);
      if (along > 0 && ray.distanceSqToPoint(head) < reach * reach && (!best || along < best.distance)) {
        best = { kind: 'pin', panel: here.panel, stageId: (plan.panels[here.panel] as PanelPlan).stage.id, distance: along };
        owner = null;
      }
    }
    if (tap && best) {
      if (best.kind === 'walker') walker.tap();
      else owner?.tap(best, raycaster);
    }
    return best;
  };

  const part: WalkPart = {
    object,
    plan,
    get ready() {
      return done >= total;
    },
    get built() {
      return total === 0 ? 1 : done / total;
    },
    finish() {
      runQueue(Infinity);
    },
    setFold(next) {
      foldOverride = next === null ? null : clamp01(next);
    },
    get fold() {
      return Math.max(0, fold);
    },
    setPeek(next) {
      peek = clamp01(next);
      dirty = true;
    },
    setProgress(p) {
      progress = clamp01(Number.isFinite(p) ? p : 0);
    },
    get progress() {
      return progress;
    },
    setHere(along) {
      hereShare = clamp01(along);
      here = hereAt(plan, hereShare);
      views.forEach((view, index) => view.setInk(inkOf(index)));
    },
    setPassed(stages) {
      passed = new Set(stages);
      views.forEach((view, index) => {
        view.setPassed(passed.has(index));
        view.setInk(inkOf(index));
      });
    },
    setDue(waypointIds) {
      due = new Set(waypointIds);
      for (const view of views) view.setDue(due);
    },
    setRungs(stageId, rungsDone) {
      views.find((view) => view.plan.stage.id === stageId)?.setRungs(rungsDone);
    },
    setTicked(stageId, ticked) {
      views.find((view) => view.plan.stage.id === stageId)?.setTicked(ticked);
    },
    setLanding(u) {
      landing = u === null ? null : clamp01(u);
    },
    landingPose(u) {
      object.updateWorldMatrix(true, true);
      const frame = frameOf(here.panel);
      const ground = (views[here.panel] as PanelView).groundAt(here.point.x, here.point.z);
      const spot = frame.localToWorld(new Vector3(here.point.x, ground, here.point.z - 0.012));
      const head = frame.localToWorld(new Vector3(here.point.x, ground + (PIN.needle + PIN.radius * 0.9) * LANDING.head, here.point.z - 0.012));
      return landingPose(u, { spot, head, headDistance: PIN.diveDistance * LANDING.head, stage: poses[here.panel + 1] as CameraPose, fov: 32 });
    },
    posesFor(aspect, insets = {}) {
      poses = railPoses(count, aspect, insets);
      return poses;
    },
    cameraAt(p = progress) {
      return cameraAt(railAt(p, count, windows), poses);
    },
    aim(target) {
      aimOverride = target === null ? null : new Vector3(target.x, target.y, target.z);
    },
    setLight(amount) {
      light = clamp01(amount);
    },
    fogFor(distance) {
      return { near: WALK_LIGHT.fog.near * distance, far: WALK_LIGHT.fog.far * distance };
    },
    projectActive(camera, viewport) {
      object.updateWorldMatrix(true, true);
      const world: WeightedWorldPoint[] = [];
      (views[place.panel] as PanelView).points(world);
      const toScreen = (position: Vector3): { x: number; y: number; visible: boolean } => {
        const projected = position.project(camera);
        return { x: ((projected.x + 1) / 2) * viewport.width, y: ((1 - projected.y) / 2) * viewport.height, visible: projected.z < 1 };
      };
      const points: WalkScreenPoint[] = [];
      for (const point of world) {
        const screen = toScreen(point.position);
        if (screen.visible) points.push({ x: screen.x, y: screen.y, weight: point.weight });
      }
      let walkerScreen: { x: number; y: number } | null = null;
      if (walkerShown) {
        const screen = toScreen(walker.top(scratch));
        if (screen.visible) walkerScreen = { x: screen.x, y: screen.y };
      }
      return { walker: walkerScreen, points };
    },
    get activeItem() {
      if (landing !== null && landing < 1) return null;
      if (progress < WALK.handover || progress >= WALK.stages.to) return null;
      return place.item.item;
    },
    get place() {
      return place;
    },
    get along() {
      return place.along;
    },
    miniMap(stageIndex) {
      const view = views[stageIndex];
      if (!view || !view.built) return null;
      const panel = view.plan;
      const walked = walkedOn(panel);
      let entry = minis.get(stageIndex);
      if (!entry) {
        const canvas = document.createElement('canvas');
        canvas.width = MINI.width;
        canvas.height = MINI.height;
        entry = { canvas, walked: -1 };
        minis.set(stageIndex, entry);
      }
      if (entry.walked !== walked) {
        const context = entry.canvas.getContext('2d');
        if (context) paintMiniMap(context, { plan, panel, contours: view.contours, lang, walked });
        entry.walked = walked;
      }
      const clampPixel = (x: number, z: number): { x: number; y: number } => {
        const pixel = miniPixel(x, z);
        return { x: Math.min(MINI.width, Math.max(0, pixel.x)), y: Math.min(MINI.height, Math.max(0, pixel.y)) };
      };
      return {
        canvas: entry.canvas,
        pixel: place.panel === stageIndex ? clampPixel(place.point.x, place.point.z) : null,
        marks: panel.marks.map((mark) => ({ id: mark.waypoint.id, ...clampPixel(mark.x, mark.z), title: mark.waypoint.title })),
      };
    },
    hitTest(ray) {
      return hitTest(ray, false);
    },
    tap(ray) {
      return hitTest(ray, true);
    },
    progressFor(target) {
      if (target.waypointId !== undefined) return progressForItem(plan, (item) => item.kind === 'waypoint' && item.waypointId === target.waypointId);
      if (target.stageId !== undefined) {
        if (target.kind) return progressForItem(plan, (item) => item.kind === target.kind && item.stageId === target.stageId);
        const window = windows.stages.find((stage) => stage.id === target.stageId);
        return window ? window.from + (window.to - window.from) * 0.02 : null;
      }
      if (target.along !== undefined) return progressForAlong(plan, target.along);
      return null;
    },
    panelToWorld(index, x, y, z, target = new Vector3()) {
      object.updateWorldMatrix(true, true);
      return frameOf(index).localToWorld(target.set(x, y, z));
    },
    groundAt(index, x, z) {
      return (views[Math.min(count - 1, Math.max(0, index))] as PanelView).groundAt(x, z);
    },
    walkerFeet(target = new Vector3()) {
      object.updateWorldMatrix(true, true);
      return walker.object.getWorldPosition(target);
    },
    get walkerShown() {
      return walkerShown;
    },
    get here() {
      return here;
    },
    walkerTop(target = new Vector3()) {
      return walker.top(target);
    },
    pinHead(target = new Vector3()) {
      return pin.headWorld(target);
    },
    settle() {
      applyFold(foldOverride ?? mapOpenAt(progress));
      const { shown, length } = state();
      views.forEach((view, index) => {
        view.setScene(sceneOf(index), panelLanded(schedule, index, fold));
        view.setWalker(shown && index === place.panel ? place.point.x : null, shown || progress >= WALK.walker.to ? length : -Infinity);
        view.settle();
      });
      walkerLength = null;
    },
    reprint() {
      for (const view of views) {
        const ink = view.ink;
        view.setInk(ink === 1 ? 0.999 : 1);
        view.setInk(ink);
      }
      minis.clear();
    },
    update,
    dispose() {
      for (const view of views) view.dispose();
      coverSheet?.dispose();
      legendSheet?.dispose();
      walker.dispose();
      pin.dispose();
      cloth?.dispose();
      lamp.dispose();
      key.dispose();
      fill.dispose();
      hemisphere.dispose();
      for (const entry of minis.values()) entry.canvas.width = 0;
    },
  };
  return part;
}
