import { Color, Group, Plane, Ray, Vector3, type Camera, type Material, type Mesh, type Object3D, type ShaderMaterial } from 'three';
import { createCompass, directionToBearing, type CompassPart } from '../compass';
import { uiLang, type UiLang } from '../i18n';
import { THEME } from '../look/theme';
import { clamp01, damp, easeInOutCubic, easeOutBack, easeOutCubic, lerp, seg, smooth, type Vec3 } from '../paper/motion';
import type { FrameTime, SceneEnvironment, ScenePart } from '../scene/contract';
import { COVER, FIELD_OFFSET } from './cover';
import { GROW } from './grow';
import { createLamp } from './lamp';
import { createMountain, type Mountain } from './mountain-port';
import { PIN, createPin, type Pin } from './pin';
import { readoutFor, type ReadoutParts } from './readout';
import { createCloth, createTableTop } from './room';
import { createTableSheet, type TableSheet } from './sheet';
import { deriveSheet, paperHalf, stageOfCard, stageStartShare, tracePrint, type SheetData, type SheetSpec } from './sheet-data';
import { DIM_FLOOR, TURN, createTurntable, sheetScale, shortestSteps, slotPose, type PickBy, type Turntable } from './turntable';

/** The moments of the intro, in seconds from its start. */
export const INTRO = {
  /** The lamp comes on with an overshoot. */
  lamp: { from: 0, to: 1.15, overshoot: 2.4 },
  /** The lamp warms from its cold first light. */
  warm: { from: 0.15, to: 2.6 },
  /** The table is held at its turned-away angle until here, then turns in. */
  hold: 0.5,
  /**
   * The sheets come out of the dark as the table turns in, between these shares of the turn. Until then only the
   * wood takes the lamp, and the roadmap that happens to lie under it first is not read.
   */
  reveal: { from: 0.6, to: 0.95 },
  /** The compass rises by `rise` and its glow comes up. */
  compass: { from: 0.35, to: 1.8, rise: 0.5 },
  /** The lit sheet may grow its mountain from here. */
  grow: 2.05,
  /** After this the intro is over. */
  end: 4.6,
} as const;

/**
 * When the table turns by itself: only with the gallery on it, and only while nobody acts. A pick puts the next
 * turn off by `afterPick`, the pointer on the table and keyboard focus on a control by `afterHover`. A key press
 * or a dive into a roadmap stops it for the rest of the visit.
 */
export const AUTO_TURN = { first: 6.2, every: 8.8, afterPick: 14, afterHover: 3 } as const;

/**
 * Keys that do not count as somebody acting on the page: Tab only moves the focus, which holds the turn on its
 * own, and a modifier pressed alone does nothing.
 */
const PASSIVE_KEYS: ReadonlySet<string> = new Set(['Tab', 'Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock', 'Fn', 'OS', 'Unidentified']);

/** The dive, in hero-exit progress. */
export const EXIT = {
  select: 0.015,
  settle: { from: 0.015, to: 0.075 },
  compass: { from: 0.012, to: 0.07, rise: 4 },
  sheets: { from: 0.02, to: 0.15 },
  mountain: { from: 0.02, to: 0.14 },
  sun: { from: 0.3, to: 0.6 },
} as const;

/** How the pointer picks a card: it has to rest a moment, and a pick is held a little after it leaves. */
export const HOVER = { dwellSlow: 0.08, dwellFast: 0.24, fast: 300, hold: 0.5, dim: 0.62 } as const;

export interface TableOptions {
  readonly sheets?: readonly SheetSpec[];
  /** The sheet in the light at the start. Default 0, the roadmap that was opened. */
  readonly selected?: number;
  /** Play the intro. Default true. Reduced motion never plays it. */
  readonly intro?: boolean;
  /** Let the table turn by itself. Only for the gallery; default false. */
  readonly autoTurn?: boolean;
  /** Interface language of the cover print and the readout. */
  readonly lang?: UiLang;
  /** Device pixels per CSS pixel, for the cover canvases. */
  readonly pixelRatio?: number;
  /** Width of the compass across its outer ring. */
  readonly compassDiameter?: number;
  /** True on touch screens: the raking lamp drifts by itself. */
  readonly touch?: boolean;
  /** Most mountains kept with their GPU buffers at once. Default 3, on phones 2. */
  readonly maxModels?: number;
  /**
   * The page the table watches for somebody being there: a key press stops the automatic turn for the rest of
   * the visit, and while a control holds the keyboard focus the turn waits. Default: the page's document, when
   * there is one. Null watches nothing.
   */
  readonly watch?: Document | null;
}

export type TableHitKind = 'none' | 'sheet' | 'lit' | 'card' | 'pin';

export interface TableHit {
  readonly kind: TableHitKind;
  /** The sheet under the pointer, or -1. */
  readonly sheet: number;
  /** The contour card under the pointer (0 is the bottom card), or -1. */
  readonly card: number;
  /** The stage that card belongs to, or -1. */
  readonly stage: number;
}

/** A request to go into the lit map: at a stage (a click on a card) or at the pin. */
export interface TableEnter {
  readonly sheet: number;
  /** Stage index, or -1 for "at the pin". */
  readonly stage: number;
  /** Where to land, as a share of the roadmap's minutes. */
  readonly minuteShare: number;
}

export type TableAnchor = 'pin' | 'enter' | 'arrowPrevious' | 'arrowNext' | 'compass' | 'sheet';

export interface ScreenPoint {
  /** Screen units: -1 left and bottom, 1 right and top. */
  x: number;
  y: number;
  /** False when the point is behind the camera or the thing is not shown. */
  visible: boolean;
}

export interface TablePart extends ScenePart<Group> {
  readonly compass: CompassPart;
  /** True once sheets are on the table and the lit mountain is cut. */
  readonly ready: boolean;
  readonly count: number;
  readonly selected: number;
  /** Table angle in degrees. */
  readonly phi: number;
  /** The sheet whose mountain stands or is growing, or -1 during a turn. */
  readonly standing: number;
  /** Growth of the lit mountain, 0 to 1. */
  readonly grow: number;
  /** Height of the lit mountain above its cover right now, in scene units. */
  readonly height: number;
  /** The same for any sheet: 0 when its mountain lies in the print or is not cut. */
  heightOf(index: number): number;
  /** What the side card shows. The object is replaced only when something visible changes. */
  readonly readout: ReadoutParts | null;
  setSheets(sheets: readonly SheetSpec[], selected?: number): void;
  sheetData(index: number): SheetData | null;
  select(index: number, by?: PickBy): boolean;
  next(by?: PickBy): boolean;
  previous(by?: PickBy): boolean;
  onSelect(listener: (index: number, by: PickBy) => void): () => void;
  /** Called when a mountain starts to stand (its index) and when the table starts to turn (-1). */
  onStand(listener: (index: number) => void): () => void;
  onReadout(listener: (parts: ReadoutParts) => void): () => void;
  onEnter(listener: (enter: TableEnter) => void): () => void;
  /** Hero-exit progress of the dive, 0 to 1. */
  setExit(hx: number): void;
  /** Pointer in screen units for the lamp and the compass, or null when there is none. */
  setPointer(x: number | null, y: number | null): void;
  /** The pointer ray in world space, with its speed in pixels per second. Returns what lies under it. */
  hover(ray: Ray | null, speed?: number): TableHit;
  /** A click along a ray: a sheet at the edge is selected, the lit sheet asks to be entered. */
  click(ray: Ray): TableHit;
  /** The points the hero camera is fitted to: the lit sheet, its tallest mountain and the compass. */
  framePoints(): Vec3[];
  /** Where the head of the pin is on the screen of a camera. */
  pinScreen(camera: Camera, target?: ScreenPoint): ScreenPoint;
  /** World positions the overlay places its controls by. */
  anchor(name: TableAnchor, target?: Vector3): Vector3;
  /** The mount on top of a sheet's cover, where the folded map of the walk is attached. */
  mapRoot(index: number): Group | null;
  /** Shows or hides the dummy body of a sheet, for when the real map takes its place. */
  setSheetBody(index: number, visible: boolean): void;
  startIntro(): void;
  skipIntro(): void;
  /**
   * Holds the lit mountain flat in its print, the way the folded map comes back from a walk: no mountain stands
   * and the pin is down while it is held. `immediate` lays a standing mountain down at once instead of letting
   * it sink. Let go, the lit mountain grows again as soon as the table is still.
   */
  holdFlat(on: boolean, immediate?: boolean): void;
  /** True while the lit mountain is held flat. */
  readonly flat: boolean;
  /** Lets the table turn by itself (the gallery) or not (a person's own roadmap). It never undoes `acted`. */
  setAutoTurn(on: boolean): void;
  /** Puts the next automatic turn off by at least this many seconds, for a host that sees somebody busy. */
  holdAutoTurn(seconds: number): void;
  /**
   * True once somebody has pressed a key or dived into a roadmap. The table then never turns by itself again in
   * this visit.
   */
  readonly acted: boolean;
  /** Marks from outside that somebody is here: the automatic turn stops for the rest of the visit. */
  act(): void;
  /** True while the table may still turn by itself. */
  readonly autoTurning: boolean;
  /**
   * How much of the room's light the environment map gives right now, 0 to 1: it comes up with the lamp in the
   * intro, so the room stays dark until the lamp lights it. The compass waits for its own rise.
   */
  readonly roomLight: number;
  /** Prints the covers again: after the fonts arrived, or in another interface language. */
  repaint(lang?: UiLang): void;
}

const RAD = Math.PI / 180;
const NO_HIT: TableHit = { kind: 'none', sheet: -1, card: -1, stage: -1 };
const SLOT = new Vector3(0, 0, TURN.radius);

interface Model {
  readonly mountain: Mountain;
  readonly pin: Pin;
  readonly anchor: Vector3;
  readonly pinCard: number;
  flat: number;
  /** True while the intro keeps the model out of sight with its dark sheet. */
  hidden: boolean;
}

export function createTable(environment: SceneEnvironment, options: TableOptions = {}): TablePart {
  let lang = options.lang ?? uiLang();
  const pixelRatio = options.pixelRatio ?? (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
  const maxModels = Math.max(2, options.maxModels ?? (environment.phone ? 2 : 3));
  const touch = options.touch ?? false;
  const watch = options.watch === undefined ? (typeof document === 'undefined' ? null : document) : options.watch;

  // Everything that takes light from the room's environment map, with the strength it was made with. In the
  // intro the room is as dark as the lamp: the map comes up with it, the compass with its own rise.
  type Lit = Material & { envMapIntensity: number };
  const roomLit = new Map<Lit, number>();
  const compassLit = new Map<Lit, number>();
  let roomLight = 1;
  let compassLight = 1;
  const eachMaterial = (object: Object3D, visit: (material: Lit) => void): void => {
    object.traverse((child) => {
      const material = (child as Mesh).material as Material | Material[] | undefined;
      for (const one of Array.isArray(material) ? material : material ? [material] : []) {
        if (typeof (one as { envMapIntensity?: unknown }).envMapIntensity === 'number') visit(one as Lit);
      }
    });
  };
  const collectLit = (object: Object3D, into: Map<Lit, number>, light: number): void => {
    eachMaterial(object, (material) => {
      if (into.has(material)) return;
      into.set(material, material.envMapIntensity);
      material.envMapIntensity *= light;
    });
  };
  const forgetLit = (object: Object3D): void => {
    eachMaterial(object, (material) => {
      const own = roomLit.get(material);
      if (own === undefined) return;
      material.envMapIntensity = own;
      roomLit.delete(material);
    });
  };
  const setLight = (into: Map<Lit, number>, light: number): void => {
    for (const [material, own] of into) material.envMapIntensity = own * light;
  };

  const root = new Group();
  root.name = 'table';
  const cloth = createCloth(environment);
  root.add(cloth.mesh);
  const turner = new Group();
  turner.name = 'turntable';
  root.add(turner);
  const top = createTableTop(environment);
  turner.add(top.mesh);
  const lamp = createLamp(environment, touch);
  root.add(lamp.object);

  // The compass floats over the middle. The lamp head hangs to its south-west, about 58 degrees up.
  const compass = createCompass({
    environment,
    diameter: options.compassDiameter ?? (environment.phone ? 2.6 : 3.2),
    lean: 0.32,
    heading: Math.PI,
    glow: 0,
    lightBearing: directionToBearing(-1.9, 2.6),
    lightElevation: 58 * RAD,
  });
  root.add(compass.object);
  collectLit(cloth.mesh, roomLit, 1);
  collectLit(top.mesh, roomLit, 1);
  collectLit(compass.object, compassLit, 1);
  const compassCentre = (compass.topY + compass.bottomY) / 2;
  const compassRadius = (compass.topY - compass.bottomY) / 2;
  const compassGround = compass.object.getObjectByName('compass-ground') as Mesh | undefined;
  const groundRest = compassGround?.position.y ?? 0.004;
  const glowUniforms: { value: Color }[] = [];
  compass.object.traverse((child) => {
    const uniforms = ((child as Mesh).material as ShaderMaterial | undefined)?.uniforms;
    if (!uniforms) return;
    for (const name of ['uColor', 'uGlowColor']) {
      const uniform = uniforms[name] as { value: unknown } | undefined;
      if (uniform && uniform.value instanceof Color) glowUniforms.push(uniform as { value: Color });
    }
  });
  const glowColor = new Color(THEME.lamp);
  const glowTarget = new Color(THEME.lamp);
  const white = new Color(0xffffff);

  let turntable: Turntable = createTurntable(1);
  let sheets: TableSheet[] = [];
  const arms: Group[] = [];
  const models = new Map<number, Model>();
  let scale = 1;
  let tallest: number = GROW.fullHeight;
  let thickest = 0.07;

  let now = 0;
  let wantIntro = options.intro ?? true;
  let introStart: number | null = null;
  let introHeld = false;
  /** How far the sheets have come out of the dark in the intro, 0 to 1. */
  let revealed = 1;
  let autoTurn = options.autoTurn ?? false;
  let nextAuto: number = AUTO_TURN.first;
  let acted = false;
  let exit = 0;
  let exitPicked = false;
  let flatHold = false;
  let standing = -1;
  let rake = 0;
  let stoodFor = 0;
  let lastBuild = 0;
  let disposed = false;

  const pointerRay = new Ray();
  let hasRay = false;
  let pointerSpeed = 0;
  let hoverSheet = -1;
  let candidate = -1;
  let candidateFor = 0;
  let hovered = -1;
  let heldFor = 0;
  let readout: ReadoutParts | null = null;

  const selectListeners = new Set<(index: number, by: PickBy) => void>();
  const standListeners = new Set<(index: number) => void>();
  const readoutListeners = new Set<(parts: ReadoutParts) => void>();
  const enterListeners = new Set<(enter: TableEnter) => void>();

  const plane = new Plane(new Vector3(0, 1, 0), 0);
  const scratch = new Vector3();
  const scratch2 = new Vector3();
  const lampFocus = new Vector3();
  const compassAim = new Vector3(0, compassCentre, 0);

  const ensureModel = (index: number): Model | null => {
    const existing = models.get(index);
    if (existing) return existing;
    const sheet = sheets[index];
    if (!sheet) return null;
    const mountain = createMountain(sheet.data, environment, sheet.layout.board);
    mountain.object.position.z = FIELD_OFFSET;
    mountain.setWalked(sheet.data.share > 0 ? sheet.hereAlong : 0);
    mountain.setPassed(sheet.data.passed);
    mountain.setDim(sheet.dim);
    sheet.mount.add(mountain.object);
    const pin = createPin(environment);
    mountain.object.add(pin.object);
    collectLit(mountain.object, roomLit, roomLight);
    const model: Model = { mountain, pin, anchor: new Vector3(), pinCard: mountain.cardOnTrail(sheet.hereAlong), flat: 0, hidden: false };
    mountain.anchorAt(sheet.hereAlong, model.anchor);
    pin.update(0, model.anchor, true);
    models.set(index, model);
    lastBuild = now;
    return model;
  };

  const releaseModel = (index: number): void => {
    const model = models.get(index);
    if (!model) return;
    forgetLit(model.mountain.object);
    model.pin.dispose();
    model.mountain.dispose();
    models.delete(index);
  };

  const clearSheets = (): void => {
    for (const index of [...models.keys()]) releaseModel(index);
    for (const sheet of sheets) {
      forgetLit(sheet.slot);
      sheet.dispose();
    }
    for (const arm of arms) arm.removeFromParent();
    sheets = [];
    arms.length = 0;
  };

  const setStanding = (index: number): void => {
    if (index === standing) return;
    standing = index;
    stoodFor = 0;
    for (const listener of standListeners) listener(index);
  };

  const writeReadout = (): void => {
    const sheet = sheets[turntable.selected];
    if (!sheet) return;
    const model = models.get(turntable.selected);
    const next = readoutFor(turntable.selected, sheet.data, model?.mountain.grow ?? 0, standing === turntable.selected ? hovered : -1, lang);
    if (readout && readout.key === next.key) return;
    readout = next;
    for (const listener of readoutListeners) listener(next);
  };

  const tintFor = (index: number): void => {
    const sheet = sheets[index];
    if (!sheet) return;
    glowTarget.set(THEME.tier[sheet.data.tier]).lerp(white, 0.12);
  };

  const doSelect = (index: number, by: PickBy): boolean => {
    if (!turntable.select(index, by)) return false;
    // The picked sheet gets its mountain now, while it still lies in the dark, so the swap from the printed
    // field to the flat model is never seen.
    ensureModel(index);
    setStanding(-1);
    hovered = -1;
    candidate = -1;
    tintFor(index);
    if (by === 'person') nextAuto = Math.max(nextAuto, now + AUTO_TURN.afterPick);
    else if (by === 'auto') nextAuto = now + AUTO_TURN.every;
    writeReadout();
    for (const listener of selectListeners) listener(index, by);
    return true;
  };

  /** True while an element other than the page itself holds the keyboard focus. */
  const focusOnControl = (): boolean => {
    const active = watch?.activeElement ?? null;
    return active !== null && active !== watch?.body && active !== watch?.documentElement;
  };
  const onKey = (event: KeyboardEvent): void => {
    if (!PASSIVE_KEYS.has(event.key)) acted = true;
  };
  watch?.addEventListener('keydown', onKey, true);

  /** True when a ray passes the head of a standing pin, with room to spare for a pointer. */
  const onPin = (ray: Ray, model: Model): boolean => model.pin.up > 0.5 && ray.distanceSqToPoint(model.pin.headWorld(scratch)) < (PIN.radius * 2.6) ** 2;

  const hitTest = (ray: Ray): TableHit => {
    const lit = turntable.selected;
    const model = models.get(lit);
    const litSheet = sheets[lit];
    if (model && litSheet && standing === lit && model.mountain.grow > 0.5) {
      if (onPin(ray, model)) return { kind: 'pin', sheet: lit, card: model.pinCard, stage: stageOfCard(litSheet.data, model.pinCard) };
      const card = model.mountain.cardAt(ray);
      if (card >= 0) return { kind: 'card', sheet: lit, card, stage: stageOfCard(litSheet.data, card) };
    }
    plane.constant = -thickest;
    if (!ray.intersectPlane(plane, scratch)) return NO_HIT;
    for (const sheet of sheets) {
      const local = sheet.slot.worldToLocal(scratch2.copy(scratch));
      if (Math.abs(local.x) <= (COVER.body.width / 2) * scale && Math.abs(local.z) <= (COVER.body.depth / 2) * scale) {
        return { kind: sheet.index === lit ? 'lit' : 'sheet', sheet: sheet.index, card: -1, stage: -1 };
      }
    }
    return NO_HIT;
  };

  const part: TablePart = {
    object: root,
    compass,
    get ready() {
      return sheets.length > 0;
    },
    get count() {
      return sheets.length;
    },
    get selected() {
      return turntable.selected;
    },
    get phi() {
      return turntable.phi;
    },
    get standing() {
      return standing;
    },
    get grow() {
      return models.get(turntable.selected)?.mountain.grow ?? 0;
    },
    get height() {
      return part.heightOf(turntable.selected);
    },
    heightOf(index) {
      const model = models.get(index);
      // A flat model still has the hair of thickness that keeps its cards apart; that is not height.
      return model && model.mountain.grow + model.mountain.height > 0 ? Math.max(0, model.mountain.height - model.mountain.flatHeight) * scale : 0;
    },
    get readout() {
      return readout;
    },
    get flat() {
      return flatHold;
    },
    get acted() {
      return acted;
    },
    get autoTurning() {
      return autoTurn && !acted;
    },
    get roomLight() {
      return roomLight;
    },

    setSheets(specs, selected = 0) {
      clearSheets();
      const list = specs.slice(0, TURN.maxSheets);
      turntable = createTurntable(Math.max(1, list.length));
      scale = sheetScale(list.length);
      const step = (360 / Math.max(1, list.length)) * RAD;
      tallest = 0;
      thickest = 0;
      list.forEach((spec, index) => {
        const data = deriveSheet(spec);
        const sheet = createTableSheet({
          index,
          data,
          print: tracePrint(data, environment.phone),
          environment,
          lang,
          pixelRatio,
          scale,
        });
        collectLit(sheet.slot, roomLit, roomLight);
        const arm = new Group();
        arm.name = `arm-${index}`;
        arm.rotation.y = -index * step;
        sheet.slot.position.z = TURN.radius;
        arm.add(sheet.slot);
        turner.add(arm);
        arms.push(arm);
        sheets.push(sheet);
        tallest = Math.max(tallest, data.cards * GROW.thickness);
        thickest = Math.max(thickest, sheet.thickness);
      });
      if (list.length === 0) return;
      const start = Math.min(list.length - 1, Math.max(0, Math.round(selected)));
      if (start !== 0) turntable.select(start, 'scroll');
      turntable.settle();
      standing = -1;
      hovered = -1;
      readout = null;
      tintFor(start);
      glowColor.copy(glowTarget);
      const model = ensureModel(start);
      if (!wantIntro && model) {
        model.mountain.setGrow(1, true);
        model.pin.setStanding(true, true);
        standing = start;
        rake = 1;
      }
      introStart = null;
      introHeld = false;
      nextAuto = now + AUTO_TURN.first;
      writeReadout();
    },

    sheetData(index) {
      return sheets[index]?.data ?? null;
    },

    select(index, by = 'person') {
      return doSelect(index, by);
    },
    next(by = 'person') {
      return sheets.length > 1 && doSelect((turntable.selected + 1) % sheets.length, by);
    },
    previous(by = 'person') {
      return sheets.length > 1 && doSelect((turntable.selected - 1 + sheets.length) % sheets.length, by);
    },

    onSelect(listener) {
      selectListeners.add(listener);
      return () => selectListeners.delete(listener);
    },
    onStand(listener) {
      standListeners.add(listener);
      return () => standListeners.delete(listener);
    },
    onReadout(listener) {
      readoutListeners.add(listener);
      return () => readoutListeners.delete(listener);
    },
    onEnter(listener) {
      enterListeners.add(listener);
      return () => enterListeners.delete(listener);
    },

    setExit(hx) {
      exit = clamp01(Number.isFinite(hx) ? hx : 0);
      if (exit < EXIT.select) exitPicked = false;
      // Somebody went into a roadmap: back on the table it stays lit, and the table no longer turns by itself.
      if (exit > 0) acted = true;
    },

    setPointer(x, y) {
      lamp.setPointer(x, y);
      compass.setTilt(x ?? 0, y ?? 0);
    },

    hover(ray, speed = 0) {
      if (!ray) {
        hasRay = false;
        hoverSheet = -1;
        return NO_HIT;
      }
      pointerRay.copy(ray);
      hasRay = true;
      pointerSpeed = Number.isFinite(speed) ? Math.max(0, speed) : 0;
      const hit = hitTest(ray);
      hoverSheet = hit.kind === 'sheet' ? hit.sheet : -1;
      if (hit.kind !== 'none') nextAuto = Math.max(nextAuto, now + AUTO_TURN.afterHover);
      return hit;
    },

    click(ray) {
      const hit = hitTest(ray);
      const sheet = sheets[hit.sheet];
      if (hit.kind === 'sheet') {
        doSelect(hit.sheet, 'person');
      } else if (sheet && hit.kind === 'card') {
        const enter: TableEnter = { sheet: hit.sheet, stage: hit.stage, minuteShare: stageStartShare(sheet.data, hit.stage) };
        for (const listener of enterListeners) listener(enter);
      } else if (sheet && (hit.kind === 'lit' || hit.kind === 'pin')) {
        const enter: TableEnter = { sheet: hit.sheet, stage: -1, minuteShare: sheet.data.hereMinuteShare };
        for (const listener of enterListeners) listener(enter);
      }
      return hit;
    },

    framePoints() {
      const points: Vec3[] = [];
      const halfWidth = (COVER.body.width / 2) * scale;
      const halfDepth = (COVER.body.depth / 2) * scale;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) points.push({ x: sx * halfWidth, y: thickest, z: TURN.radius + sz * halfDepth });
      const half = paperHalf() * scale;
      const fieldZ = TURN.radius + FIELD_OFFSET * scale;
      const peak = thickest + tallest * scale;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) points.push({ x: sx * half * 0.7, y: peak, z: fieldZ + sz * half * 0.7 });
      const r = compassRadius;
      points.push(
        { x: 0, y: compass.topY, z: 0 },
        { x: 0, y: compass.bottomY, z: 0 },
        { x: -r, y: compassCentre, z: 0 },
        { x: r, y: compassCentre, z: 0 },
        { x: 0, y: compassCentre, z: r },
        { x: 0, y: compassCentre, z: -r },
      );
      return points;
    },

    pinScreen(camera, target = { x: 0, y: 0, visible: false }) {
      const model = models.get(turntable.selected);
      if (!model) {
        target.visible = false;
        return target;
      }
      model.pin.headWorld(scratch).project(camera);
      target.x = scratch.x;
      target.y = scratch.y;
      target.visible = scratch.z > -1 && scratch.z < 1 && model.pin.up > 0.5;
      return target;
    },

    anchor(name, target = new Vector3()) {
      const halfWidth = (COVER.body.width / 2) * scale;
      const halfDepth = (COVER.body.depth / 2) * scale;
      switch (name) {
        case 'pin': {
          const model = models.get(turntable.selected);
          return model ? model.pin.headWorld(target) : target.set(0, thickest, TURN.radius);
        }
        case 'enter':
          // Half way between the foot of the compass and the far edge of the lit sheet.
          return target.set(0, (compass.bottomY * 0.35 + thickest) / 2, (TURN.radius - halfDepth) * 0.56);
        case 'arrowPrevious':
          return target.set(-halfWidth - 0.62, thickest, TURN.radius + halfDepth * 0.42);
        case 'arrowNext':
          return target.set(halfWidth + 0.62, thickest, TURN.radius + halfDepth * 0.42);
        case 'compass':
          return target.set(0, compassCentre + compass.object.position.y, 0);
        case 'sheet':
          return target.set(0, thickest, TURN.radius);
      }
    },

    mapRoot(index) {
      return sheets[index]?.mount ?? null;
    },
    setSheetBody(index, visible) {
      sheets[index]?.setBodyVisible(visible);
    },

    startIntro() {
      wantIntro = true;
      introStart = null;
      introHeld = false;
      for (const model of models.values()) {
        model.mountain.setGrow(0, true);
        model.pin.setStanding(false, true);
      }
      standing = -1;
      rake = 0;
    },
    skipIntro() {
      wantIntro = false;
      introStart = null;
      turntable.settle();
    },
    holdFlat(on, immediate = false) {
      flatHold = on;
      if (!on || !immediate) return;
      for (const model of models.values()) {
        model.mountain.setGrow(0, true);
        model.pin.setStanding(false, true);
        model.flat = 0;
      }
      setStanding(-1);
      hovered = -1;
      candidate = -1;
      rake = 0;
      writeReadout();
    },
    setAutoTurn(on) {
      autoTurn = on;
      nextAuto = now + AUTO_TURN.first;
    },
    holdAutoTurn(seconds) {
      if (Number.isFinite(seconds) && seconds > 0) nextAuto = Math.max(nextAuto, now + seconds);
    },
    act() {
      acted = true;
    },
    repaint(next) {
      if (next) lang = next;
      for (const sheet of sheets) sheet.repaint(lang);
      readout = null;
      writeReadout();
    },

    update(frame: FrameTime) {
      if (disposed) return;
      const dt = Math.max(0, frame.dt);
      const reduced = frame.reduced;
      now = frame.t;
      if (sheets.length === 0) {
        compass.update(frame);
        return;
      }

      // The intro clock.
      let intro: number | null = null;
      if (wantIntro && !reduced) {
        if (introStart === null) {
          introStart = frame.t;
          introHeld = true;
          turntable.displace(TURN.introFrom);
          nextAuto = frame.t + AUTO_TURN.first;
          // The sheets lie in the dark until the table turns in.
          revealed = 0;
          for (const sheet of sheets) {
            sheet.setDimTarget(0);
            sheet.update(0, slotPose(sheet.index, turntable.phi, sheets.length).yaw, true);
          }
        }
        intro = frame.t - introStart;
        if (intro >= INTRO.end) {
          wantIntro = false;
          intro = null;
        }
      } else if (wantIntro && reduced) {
        wantIntro = false;
      }

      // The dive selects nothing new, but it stops the table where it is going.
      if (exit >= EXIT.select && !exitPicked) exitPicked = true;

      // The table turns by itself only while nobody is here. A control with the keyboard focus means somebody
      // is: the turn waits, so what that control points at does not change under it.
      if (autoTurn && !acted && focusOnControl()) nextAuto = Math.max(nextAuto, frame.t + AUTO_TURN.afterHover);
      if (autoTurn && !acted && !reduced && intro === null && exit < 0.005 && frame.t >= nextAuto && sheets.length > 1) {
        doSelect((turntable.selected + 1) % sheets.length, 'auto');
      }

      // The turntable.
      if (reduced) turntable.settle();
      else if (intro === null || intro >= INTRO.hold) {
        introHeld = false;
        turntable.advance(dt);
      }
      const settle = smooth(seg(exit, EXIT.settle.from, EXIT.settle.to));
      const drawn = lerp(turntable.phi, turntable.target, settle);
      turner.rotation.y = drawn * RAD;

      // Which mountain may stand.
      const selected = turntable.selected;
      let may = introHeld ? -1 : turntable.up;
      if (intro !== null && intro < INTRO.grow) may = -1;
      if (exit >= EXIT.mountain.from) may = selected;
      if (flatHold) may = -1;
      if (may !== standing) setStanding(may);
      if (standing >= 0) stoodFor += dt;

      // Sheets. In the intro they lie in the dark while the lamp comes on and come out of it as the table turns
      // in, so the roadmap that happens to lie under the lamp first is never read.
      if (intro === null) revealed = 1;
      else if (!introHeld) revealed = Math.max(revealed, smooth(seg(1 - Math.abs(turntable.phi - turntable.target) / Math.abs(TURN.introFrom), INTRO.reveal.from, INTRO.reveal.to)));
      const others = sheets.length - 1;
      for (const sheet of sheets) {
        const pose = slotPose(sheet.index, drawn, sheets.length);
        const raised = hoverSheet === sheet.index && sheet.index !== selected && exit < 0.005;
        // A sheet under the pointer comes out of the dark a little, so its lift can be seen.
        sheet.setDimTarget((raised ? Math.max(pose.dim, HOVER.dim) : pose.dim) * revealed);
        sheet.setHover(raised);
        if (sheet.index === selected || others <= 0) sheet.setExit(0);
        else {
          // The farthest sheet leaves first, the nearest last.
          const rank = 1 - Math.abs(pose.angle) / 180;
          const span = (EXIT.sheets.to - EXIT.sheets.from) * 0.55;
          const from = EXIT.sheets.from + rank * (EXIT.sheets.to - EXIT.sheets.from - span);
          sheet.setExit(easeInOutCubic(seg(exit, from, from + span)));
        }
        sheet.update(dt, pose.yaw, reduced);
      }

      // Hover intent on the lit mountain.
      const litModel = models.get(selected);
      let under = -1;
      if (hasRay && litModel && standing === selected && litModel.mountain.grow > 0.5 && exit < 0.005) {
        // On the pin the readout names the card the pin stands on, not the one behind its head.
        under = onPin(pointerRay, litModel) ? litModel.pinCard : litModel.mountain.cardAt(pointerRay);
      }
      if (under !== candidate) {
        candidate = under;
        candidateFor = 0;
      } else {
        candidateFor += dt;
      }
      if (candidate >= 0) {
        heldFor = 0;
        if (candidate !== hovered && (reduced || candidateFor >= (pointerSpeed < HOVER.fast ? HOVER.dwellSlow : HOVER.dwellFast))) hovered = candidate;
      } else if (hovered >= 0) {
        heldFor += dt;
        if (heldFor >= HOVER.hold || standing !== selected) hovered = -1;
      }

      // Mountains and pins.
      for (const [index, model] of models) {
        const sheet = sheets[index];
        if (!sheet) continue;
        const stands = index === standing;
        model.mountain.setGrow(stands ? 1 : 0);
        if (stands && exit > EXIT.mountain.from) model.mountain.raise(seg(exit, EXIT.mountain.from, EXIT.mountain.to));
        model.mountain.setHover(stands && index === selected ? hovered : -1);
        model.mountain.setDim(sheet.dim);
        model.mountain.update(frame);
        const landed = model.mountain.cardRise(model.pinCard) >= GROW.landed && model.mountain.grow > 0.5;
        model.pin.setStanding(stands && landed);
        model.pin.setDim(sheet.dim);
        model.mountain.anchorAt(sheet.hereAlong, model.anchor);
        model.pin.update(dt, model.anchor, reduced);
        model.flat = !stands && model.mountain.grow === 0 && !model.mountain.moving ? model.flat + dt : 0;
        // The printed trail of a flat model does not take the dim, so while the intro keeps its sheet in the dark
        // the model is put away with it.
        const hide = intro !== null && sheet.dim < DIM_FLOOR / 2;
        if (hide !== model.hidden) {
          model.hidden = hide;
          model.mountain.object.visible = !hide;
        }
      }

      // Keep few mountains alive: the lit one, and its neighbours cut ahead of the next turn.
      if (models.size > maxModels) {
        let worst = -1;
        let worstSteps = 0;
        for (const [index, model] of models) {
          const steps = Math.abs(shortestSteps(selected, index, sheets.length));
          if (index !== selected && model.flat > 0.4 && steps >= worstSteps) {
            worst = index;
            worstSteps = steps;
          }
        }
        if (worst >= 0) releaseModel(worst);
      } else if (!reduced && intro === null && exit < 0.005 && standing === selected && stoodFor > 1.9 && frame.t - lastBuild > 0.7 && sheets.length > 1) {
        const ahead = (selected + 1) % sheets.length;
        const behind = (selected - 1 + sheets.length) % sheets.length;
        if (!models.has(ahead)) ensureModel(ahead);
        else if (!models.has(behind) && models.size < maxModels) ensureModel(behind);
      }

      // The compass: the needle keeps on the selected sheet through the whole turn.
      const lead = slotPose(selected, drawn, sheets.length);
      compass.setHeading(directionToBearing(lead.x, lead.z), reduced ? { immediate: true } : undefined);
      const rising = intro === null ? 1 : easeOutCubic(seg(intro, INTRO.compass.from, INTRO.compass.to));
      const leaving = easeInOutCubic(seg(exit, EXIT.compass.from, EXIT.compass.to));
      compass.setGlow((intro === null ? 1 : seg(intro, INTRO.compass.from, INTRO.compass.to)) * (1 - leaving));
      compass.object.position.y = -INTRO.compass.rise * (1 - rising) + EXIT.compass.rise * leaving;
      compass.object.visible = leaving < 1;
      if (compassGround) compassGround.position.y = groundRest - compass.object.position.y;
      glowColor.lerp(glowTarget, reduced ? 1 : damp(3.2, dt));
      for (const uniform of glowUniforms) uniform.value.copy(glowColor);
      compass.update(frame);

      // The lamp, and the room's light with it: the environment map gives no more than the lamp does, so the
      // first frame is the dark room and the lamp is what shows the table. The compass waits for its rise.
      const rakeTarget = litModel && standing === selected ? litModel.mountain.grow : 0;
      rake = reduced ? rakeTarget : rake + (rakeTarget - rake) * damp(5, dt);
      lampFocus.set(0, thickest + 0.3, TURN.radius + FIELD_OFFSET * scale);
      const on = intro === null ? 1 : easeOutBack(seg(intro, INTRO.lamp.from, INTRO.lamp.to), INTRO.lamp.overshoot) * seg(intro, 0, 0.12);
      const room = clamp01(on);
      const compassRoom = room * (intro === null ? 1 : smooth(seg(intro, INTRO.compass.from, INTRO.compass.to)));
      if (room !== roomLight) {
        roomLight = room;
        setLight(roomLit, room);
      }
      if (compassRoom !== compassLight) {
        compassLight = compassRoom;
        setLight(compassLit, compassRoom);
      }
      lamp.update({
        t: frame.t,
        dt,
        reduced,
        on,
        warm: intro === null ? 1 : smooth(seg(intro, INTRO.warm.from, INTRO.warm.to)),
        rake,
        sun: seg(exit, EXIT.sun.from, EXIT.sun.to),
        slot: SLOT,
        focus: lampFocus,
        compass: compassAim,
        compassOn: (intro === null ? 1 : smooth(seg(intro, INTRO.compass.from, INTRO.compass.to))) * (1 - leaving),
      });

      writeReadout();
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      watch?.removeEventListener('keydown', onKey, true);
      clearSheets();
      root.removeFromParent();
      cloth.dispose();
      top.dispose();
      lamp.dispose();
      compass.dispose();
      selectListeners.clear();
      standListeners.clear();
      readoutListeners.clear();
      enterListeners.clear();
    },
  };

  if (options.sheets && options.sheets.length > 0) part.setSheets(options.sheets, options.selected ?? 0);
  return part;
}
