import { BufferAttribute, Group, Mesh, Vector3, type BufferGeometry, type Raycaster } from 'three';
import { hashSeed } from '../core/random';
import type { UiLang } from '../i18n';
import { THEME } from '../look/theme';
import { ROUTE, createRouteGeometry, createRouteMaterial, type RouteMaterial } from '../paper/route';
import { buildSheet, type Sheet } from '../paper/sheet';
import {
  createCairn,
  createCamp,
  createClassFlag,
  createProp,
  createScenery,
  createSignpost,
  createStageBoard,
  propById,
  resolveSignpost,
  sceneryFor,
  stageBoardText,
  type CairnPart,
  type CampPart,
  type ClassFlagPart,
  type PropPart,
  type SceneryPart,
  type SignpostPart,
  type StageBoardPart,
} from '../props';
import type { FrameTime, SceneEnvironment } from '../scene/contract';
import { createCardModel, type CardModel } from './cards';
import { PANEL } from './fold';
import { createLabelLayer, type LabelLayer } from './labels';
import { SPUR, cairnSpot, panelRoutePoints, pathPoint, type PanelPlan, type PanelPoint, type WalkPlan } from './plan';
import { PRINT, paintPanel, panelContours, panelPaper, type ContourLine } from './print';
import { MODEL, STRIP } from './strip';

/**
 * One panel of the map as things in the scene: its printed face, its card model, the route across it and the
 * scene that stands on it: scenery, the stage board, the checkpoint signpost, the camp and the cairns.
 *
 * A panel builds in steps, so the page never waits for a whole map at once.
 */
export const SCENE = {
  /** The band the scenery stands in, in panel coordinates. */
  band: { width: 3.7, depth: 2.8, middle: -0.85 },
  /** Props a panel gets. */
  props: 13,
  phoneProps: 7,
  /** Scenery keeps this far behind the route, and this far behind a sign it would hide. */
  behindRoute: 0.26,
  behindSign: 0.34,
  /** How far the scene has to have unfolded before each piece stands up. */
  board: 0.18,
  signpost: 0.42,
  camp: 0.55,
  cairn: 0.3,
  /** A cairn stands up when the walker is this near, in route length. */
  cairnLead: 0.55,
  /** The class flag stands this far behind the route, so the walker passes in front of it. */
  flagBack: 0.11,
} as const;

export type WalkHitKind = 'walker' | 'board' | 'signpost' | 'camp' | 'cairn' | 'prop' | 'pin' | 'flag';

export interface WalkHit {
  readonly kind: WalkHitKind;
  /** Index of the panel the thing stands on. */
  readonly panel: number;
  readonly stageId: string;
  /** For a cairn: the waypoint it marks. */
  readonly waypointId?: string;
  /** Distance along the ray. */
  readonly distance: number;
}

/** A point of the active panel on the screen with how much a note should avoid it. */
export interface WeightedWorldPoint {
  readonly position: Vector3;
  readonly weight: number;
}

interface Standing {
  readonly object: Group;
  readonly x: number;
  readonly z: number;
  readonly card: number;
  readonly lift: number;
}

export interface PanelView {
  readonly plan: PanelPlan;
  /** Sits on the crease of the panel before it and turns with it. */
  readonly pivot: Group;
  /** The panel itself, in panel coordinates. */
  readonly frame: Group;
  /** The steps that build this panel, in order. Each is small enough for one frame. */
  readonly steps: (() => void)[];
  readonly built: boolean;
  readonly contours: readonly ContourLine[];
  /** How far the scene stands, and whether the panel lies open. */
  setScene(up: number, landed: boolean): void;
  /** Where the walker is on this panel's route, or null when he is on another panel. */
  setWalker(x: number | null, length: number): void;
  /** Reveals the route up to this length on the whole map, and makes it solid up to `walked`. */
  setRoute(draw: number, walked: number, shown: boolean): void;
  setInk(ink: number): void;
  readonly ink: number;
  setPassed(passed: boolean): void;
  setDue(ids: ReadonlySet<string>): void;
  setRungs(done: number): void;
  setTicked(ticked: readonly boolean[]): void;
  /** Where the class flag stands on this panel's route, or null when the class is on another panel or has no flag. */
  setClass(point: PanelPoint | null): void;
  /** Height of the ground under a point of the panel right now. */
  groundAt(x: number, z: number): number;
  /** Puts everything on its target at once. */
  settle(): void;
  update(frame: FrameTime): void;
  /** What a ray meets on this panel. */
  hit(raycaster: Raycaster): WalkHit | null;
  tap(hit: WalkHit, raycaster: Raycaster): void;
  /** World points of the route, the signs and the props, for placing a note. */
  points(target: WeightedWorldPoint[]): void;
  dispose(): void;
}

export interface PanelViewOptions {
  readonly plan: WalkPlan;
  readonly environment: SceneEnvironment;
  readonly lang: UiLang;
  readonly ink: number;
  /** Scale of this panel's prints: 2 for the panel the walker lands on, 1.5 for the rest. */
  readonly scale: number;
  readonly passed: boolean;
  readonly entry: boolean;
}

export function createPanelView(panel: PanelPlan, options: PanelViewOptions): PanelView {
  const { plan, environment, lang } = options;
  const phone = environment.phone;
  const pivot = new Group();
  pivot.name = `panel-${panel.index}-pivot`;
  const frame = new Group();
  frame.name = `panel-${panel.index}`;
  pivot.add(frame);
  const scene = new Group();
  scene.name = `panel-${panel.index}-scene`;
  scene.visible = false;
  frame.add(scene);

  const seed = hashSeed(panel.seed);
  let ink = options.ink;
  let passed = options.passed;
  let built = false;
  let contours: ContourLine[] = [];
  let sheet: Sheet | null = null;
  let cards: CardModel | null = null;
  interface Ribbon {
    readonly mesh: Mesh<BufferGeometry, RouteMaterial>;
    readonly cardOf: Int16Array;
    readonly positions: BufferAttribute;
  }
  /** A side trail's ribbon, with the route length beside each of its points and its own length up to there. */
  interface SpurRibbon extends Ribbon {
    readonly beside: readonly number[];
    readonly own: readonly number[];
  }
  let route: Ribbon | null = null;
  const spurs: SpurRibbon[] = [];
  let labels: LabelLayer | null = null;
  let flag: (Standing & { part: ClassFlagPart }) | null = null;
  let classAt: PanelPoint | null = null;
  let scenery: SceneryPart | null = null;
  let sceneryPlaces: Standing[] = [];
  let board: (Standing & { part: StageBoardPart }) | null = null;
  let signpost: (Standing & { part: SignpostPart }) | null = null;
  let camp: (Standing & { part: CampPart | PropPart; flags: boolean }) | null = null;
  const cairns: (Standing & { part: CairnPart; waypointId: string; length: number })[] = [];
  let due: ReadonlySet<string> = new Set();
  let rungs = 0;
  let ticked: readonly boolean[] = [];

  let sceneUp = 0;
  let landed = false;
  let walkerX: number | null = null;
  let walkerLength = -Infinity;
  let cardsMoved = true;

  const print = () => ({ plan, panel, contours, lang, ink, entry: options.entry });
  const stand = (object: Group, x: number, z: number, lift = 0): Standing => {
    object.position.set(x, 0, z);
    scene.add(object);
    return { object, x, z, card: panel.cards.cardAt(x, z), lift };
  };
  const heightOf = (place: Standing): number => (cards ? cards.cardTop(place.card) : 0) + place.lift;

  const steps: (() => void)[] = [];

  // 1. The printed face.
  steps.push(() => {
    contours = panelContours(panel, phone ? 65 : 97);
    const scale = Math.min(phone ? PRINT.phoneScale : options.scale, environment.maxTexture / PRINT.height);
    const resolution = (PRINT.width * scale) / PANEL.width;
    sheet = buildSheet({
      width: PANEL.width,
      height: PANEL.depth,
      standing: false,
      paper: panelPaper(panel.surface),
      back: THEME.paperShade,
      resolution,
      maxCanvas: PRINT.height * scale + 200,
      soft: 0.02,
      seed: (seed % 97) * 0.31 + panel.index,
      deckle: 0.0022,
      warp: 0.008,
      fibre: 0.07,
      rim: 0.3,
      through: 0.12,
      print: (ctx, width, height) => paintPanel(ctx, width, height, print()),
    });
    sheet.object.position.set(PANEL.width / 2, 0, 0);
    sheet.mesh.castShadow = true;
    sheet.mesh.receiveShadow = true;
    frame.add(sheet.object);
  });

  // 2. The card model.
  steps.push(() => {
    cards = createCardModel(panel, { plan, environment, lang, ink, scale: phone ? 1 : options.scale * 0.75 });
    frame.add(cards.object);
  });

  // 3. The route, and the side trails of the optional steps.
  /** Points no further apart than 0.02, so a ribbon bends smoothly and steps cleanly from card to card. */
  const densify = <P extends { readonly x: number; readonly z: number; readonly s: number }>(coarse: readonly P[]): { x: number; z: number; s: number }[] => {
    const dense: { x: number; z: number; s: number }[] = [];
    for (let k = 0; k < coarse.length - 1; k += 1) {
      const a = coarse[k] as P;
      const b = coarse[k + 1] as P;
      const pieces = Math.max(1, Math.ceil(Math.max(b.s - a.s, Math.hypot(b.x - a.x, b.z - a.z)) / 0.02));
      for (let piece = 0; piece < pieces; piece += 1) {
        const t = piece / pieces;
        dense.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, s: a.s + (b.s - a.s) * t });
      }
    }
    const last = coarse[coarse.length - 1] as P;
    dense.push({ x: last.x, z: last.z, s: last.s });
    return dense;
  };
  const buildRibbon = (
    name: string,
    dense: readonly { readonly x: number; readonly z: number }[],
    look: { readonly width: number; readonly startLength: number; readonly seed: number; readonly period?: number; readonly ink?: number },
  ): (Ribbon & { readonly lengths: readonly number[] }) | null => {
    if (!sheet) return null;
    const ribbon = createRouteGeometry(
      dense.map((point) => ({ x: point.x - PANEL.width / 2, y: 0, z: point.z })),
      { width: look.width, lift: ROUTE.lift, startLength: look.startLength },
    );
    // Where the route leaves a high edge of the model it does not run down the side as a red stripe: the
    // ribbon ends at the edge and goes on at its foot.
    const cardOf = Int16Array.from(dense, (point) => panel.cards.cardAt(point.x, point.z));
    const kept: number[] = [];
    for (let j = 0; j < dense.length - 1; j += 1) {
      const a = cardOf[j] as number;
      const b = cardOf[j + 1] as number;
      if ((a < 0 && b >= 2) || (b < 0 && a >= 2)) continue;
      const base = j * 2;
      kept.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
    ribbon.geometry.setIndex(kept);
    const material = createRouteMaterial({
      seed: look.seed,
      follow: sheet.material,
      ...(look.period !== undefined ? { period: look.period } : {}),
      ...(look.ink !== undefined ? { ink: look.ink } : {}),
    });
    const mesh = new Mesh(ribbon.geometry, material);
    mesh.name = name;
    mesh.receiveShadow = true;
    mesh.visible = false;
    mesh.frustumCulled = false;
    sheet.object.add(mesh);
    return { mesh, cardOf, positions: ribbon.geometry.getAttribute('position') as BufferAttribute, lengths: ribbon.lengths };
  };
  steps.push(() => {
    route = buildRibbon(`panel-${panel.index}-route`, densify(panelRoutePoints(panel)), { width: ROUTE.width, startLength: panel.start, seed: panel.index * 3.7 + 0.4 });
    for (const mark of panel.marks) {
      if (!mark.spur) continue;
      const dense = densify(mark.spur.points);
      // A side trail is dotted for good: it is never the walked route, whoever has been there.
      const ribbon = buildRibbon(`panel-${panel.index}-spur-${mark.waypoint.id}`, dense, {
        width: SPUR.width,
        startLength: 0,
        seed: panel.index * 3.7 + 1.9 + mark.index,
        period: SPUR.period,
        ink: SPUR.ink,
      });
      if (!ribbon) continue;
      ribbon.mesh.material.setWalked(-1);
      spurs.push({ mesh: ribbon.mesh, cardOf: ribbon.cardOf, positions: ribbon.positions, beside: dense.map((point) => panel.start + point.s), own: ribbon.lengths });
    }
  });

  // 3b. The waypoint marks and their titles: labels of their own that lie on the cards, not print the cards cut.
  steps.push(() => {
    if (!sheet) return;
    labels = createLabelLayer(panel, { follow: sheet.material, resolution: phone ? 300 : 420, ink, lang: plan.roadmap.lang });
    sheet.object.add(labels.mesh);
  });

  // 4. The stage board, the signpost and the camp.
  steps.push(() => {
    const stageCount = plan.panels.length;
    const before = plan.panels[panel.index - 1];
    const text = stageBoardText(
      {
        index: panel.index + 1,
        count: stageCount,
        minutes: panel.trek.minutes,
        practiceMinutes: panel.trek.practiceMinutes,
        tier: panel.stage.tier,
        tierUp: Boolean(before) && before?.stage.tier !== panel.stage.tier,
      },
      lang,
    );
    const part = createStageBoard(text, { phone, seed: seed % 211, passed });
    board = { ...stand(part.object, panel.board.x, panel.board.z), part };
  });
  steps.push(() => {
    const key = resolveSignpost(panel.stage.checkpoint.signpost, plan.data.map.signpost, plan.data.map.theme);
    const part = createSignpost(key, panel.stage.checkpoint.show, {
      lang: plan.roadmap.lang,
      phone,
      seed: seed % 173,
      passed,
      locked: plan.roadmap.brief.gating === 'gated' && !passed,
      ticked: panel.stage.checkpoint.show.map((_, index) => ticked[index] === true),
    });
    signpost = { ...stand(part.object, panel.signpost.x, panel.signpost.z), part };
  });
  steps.push(() => {
    const project = panel.stage.project;
    if (project) {
      const part = createCamp(project.rungs.length, { phone, seed: seed % 149, done: rungs });
      camp = { ...stand(part.object, panel.camp.x, panel.camp.z), part, flags: true };
    } else {
      const tent = propById('camp/tent');
      if (!tent) return;
      const part = createProp(tent, { phone, seed: seed % 149 });
      camp = { ...stand(part.object, panel.camp.x, panel.camp.z), part, flags: false };
    }
  });

  // 5. A cairn at every step that has something to review.
  for (const mark of panel.marks) {
    if (!mark.waypoint.checks || mark.waypoint.checks.length === 0) continue;
    steps.push(() => {
      const part = createCairn({ phone, seed: (seed + mark.index * 31) % 199, due: due.has(mark.waypoint.id) });
      const spot = cairnSpot(mark);
      cairns.push({ ...stand(part.object, spot.x, spot.z), part, waypointId: mark.waypoint.id, length: panel.start + pathPoint(panel, mark.at).s });
    });
  }

  // 6. The scenery of the stage's ground.
  steps.push(() => {
    const items = sceneryFor(panel.surface, panel.seed, phone ? SCENE.phoneProps : SCENE.props);
    scenery = createScenery(items, { width: SCENE.band.width, depth: SCENE.band.depth, phone, wire: 0.75 });
    scenery.object.position.set(PANEL.width / 2, 0, SCENE.band.middle);
    scene.add(scenery.object);
    const routePoints = panel.route.points;
    const routeZ = (x: number, reach: number): number => {
      let z = Infinity;
      for (const point of routePoints) if (Math.abs(point.x - x) <= reach) z = Math.min(z, point.z);
      return Number.isFinite(z) ? z : STRIP.routeZ - STRIP.band / 2;
    };
    const signs = [board, signpost, camp].filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    sceneryPlaces = scenery.props.map((prop, index) => {
      const item = items[index] as (typeof items)[number];
      const x = PANEL.width / 2 + prop.object.position.x;
      let z = SCENE.band.middle + prop.object.position.z;
      const half = (item.art.size.width * item.scale) / 2;
      if (item.art.pose !== 'hang') {
        z = Math.min(z, routeZ(x, half + 0.1) - SCENE.behindRoute);
        // Nothing stands in front of a sign.
        for (const sign of signs) if (Math.abs(sign.x - x) < half + 0.6) z = Math.min(z, sign.z - SCENE.behindSign - (index % 3) * 0.12);
        z = Math.max(-PANEL.depth / 2 + 0.75, z);
      }
      prop.object.position.z = z - SCENE.band.middle;
      // A wide flat thing (a lake, a dune) stays off the model: it would cut through the steps of the cards.
      const onModel = item.art.pose === 'stand';
      return { object: prop.object, x, z, card: onModel ? panel.cards.cardAt(x, z) : -1, lift: index * 0.0012 + (onModel ? 0 : 0.004) };
    });
  });

  steps.push(() => {
    built = true;
    cardsMoved = true;
    placeFlag();
    apply();
  });

  const settleHeights = (): void => {
    for (const place of sceneryPlaces) place.object.position.y = Math.max(heightOf(place), place.card < 0 ? place.lift : 0);
    for (const entry of [board, signpost, camp, flag, ...cairns]) if (entry) entry.object.position.y = heightOf(entry);
    if (!cards) return;
    const model = cards;
    labels?.setHeights((card) => model.cardTop(card));
    for (const ribbon of [route, ...spurs]) {
      if (!ribbon) continue;
      const { positions, cardOf } = ribbon;
      for (let j = 0; j < cardOf.length; j += 1) {
        const y = cards.cardTop(cardOf[j] as number) + ROUTE.lift;
        positions.setY(j * 2, y);
        positions.setY(j * 2 + 1, y);
      }
      positions.needsUpdate = true;
    }
  };

  /** How much of a side trail is drawn when the route is drawn up to `length`: its own length up to there. */
  const spurDrawn = (spur: SpurRibbon, length: number): number => {
    const { beside, own } = spur;
    const last = beside.length - 1;
    if (length <= (beside[0] as number)) return 0;
    if (length >= (beside[last] as number)) return (own[last] as number) + 1;
    let low = 0;
    let high = last;
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if ((beside[middle] as number) <= length) low = middle;
      else high = middle;
    }
    const span = (beside[high] as number) - (beside[low] as number);
    const t = span > 1e-9 ? (length - (beside[low] as number)) / span : 0;
    return (own[low] as number) + ((own[high] as number) - (own[low] as number)) * t;
  };

  /** Stands the class flag at its place, a little behind the route. It is built the first time it is needed. */
  const placeFlag = (): void => {
    if (!built) return;
    if (!classAt) {
      if (flag) flag.object.visible = false;
      return;
    }
    const x = classAt.x;
    const z = Math.max(MODEL.z0 + 0.08, classAt.z - SCENE.flagBack);
    const part = flag?.part ?? createClassFlag({ phone, seed: seed % 131 });
    flag = { ...stand(part.object, x, z), part };
    flag.object.visible = true;
    flag.object.position.y = heightOf(flag);
  };

  /**
   * A scene that has not begun to unfold stays out of sight: its cut-outs would lie on the print of a panel
   * nobody has reached yet. Once it has stood, it is shown until every piece has lain down again.
   */
  function showScene(): void {
    if (!landed) {
      scene.visible = false;
      return;
    }
    if (sceneUp > 0.001) {
      scene.visible = true;
      return;
    }
    if (!scene.visible) return;
    let standing = false;
    for (const entry of [board, signpost, camp, flag, ...cairns]) if (entry && entry.part.up > 0.03) standing = true;
    if (scenery) for (const prop of scenery.props) if (prop.up > 0.03) standing = true;
    scene.visible = standing;
  }

  function apply(immediate = false): void {
    if (!built) return;
    const up = landed ? sceneUp : 0;
    // The labels lie on the panel only while it lies open, as the route does: folded, they would show through
    // the panel stacked on it.
    labels?.setShown(landed);
    cards?.setFold(up);
    showScene();
    scenery?.setFold(up);
    scenery?.setWalker(walkerX === null ? null : walkerX - PANEL.width / 2);
    scenery?.setEnd(walkerLength >= panel.start + panel.length - STRIP.margin - 0.35);
    // The landmarks of a stage stand up with its scene, one after the other: they say where the stage leads.
    board?.part.setUp(up > SCENE.board, immediate);
    signpost?.part.setUp(up > SCENE.signpost, immediate);
    camp?.part.setUp(up > SCENE.camp, immediate);
    for (const cairn of cairns) cairn.part.setUp(up > SCENE.cairn && (due.has(cairn.waypointId) || walkerLength > cairn.length - SCENE.cairnLead), immediate);
    // The class flag is news of today, not of the walker: it stands as soon as its stage does.
    flag?.part.setUp(up > SCENE.cairn && classAt !== null, immediate);
  }

  return {
    plan: panel,
    pivot,
    frame,
    steps,
    get built() {
      return built;
    },
    get contours() {
      return contours;
    },
    get ink() {
      return ink;
    },
    setScene(up, isLanded) {
      const next = Math.min(1, Math.max(0, up));
      if (next === sceneUp && isLanded === landed) return;
      sceneUp = next;
      landed = isLanded;
      apply();
    },
    setWalker(x, length) {
      if (x === walkerX && length === walkerLength) return;
      walkerX = x;
      walkerLength = length;
      apply();
    },
    setRoute(draw, walked, shown) {
      if (!route) return;
      route.mesh.visible = shown && landed && draw > panel.start - 1e-6;
      route.mesh.material.setDraw(draw);
      route.mesh.material.setWalked(walked);
      for (const spur of spurs) {
        spur.mesh.visible = route.mesh.visible && draw > (spur.beside[0] as number);
        spur.mesh.material.setDraw(spurDrawn(spur, draw));
      }
    },
    setInk(next) {
      if (Math.abs(next - ink) < 1e-6) return;
      ink = next;
      if (!built) return;
      sheet?.reprint((ctx, width, height) => paintPanel(ctx, width, height, print()));
      cards?.repaint(ink);
      labels?.repaint(ink);
      cardsMoved = true;
    },
    setPassed(next) {
      passed = next;
      board?.part.setPassed(next);
      signpost?.part.setPassed(next);
      if (plan.roadmap.brief.gating === 'gated') signpost?.part.setLocked(!next);
    },
    setDue(ids) {
      due = ids;
      for (const cairn of cairns) cairn.part.setDue(ids.has(cairn.waypointId));
      apply();
    },
    setRungs(done) {
      rungs = done;
      if (camp?.flags) (camp.part as CampPart).setRungs(done);
    },
    setTicked(next) {
      ticked = next;
      if (signpost) for (let index = 0; index < signpost.part.count; index += 1) signpost.part.setTicked(index, next[index] === true);
    },
    setClass(point) {
      if (point === classAt || (point && classAt && point.x === classAt.x && point.z === classAt.z)) return;
      classAt = point ? { x: point.x, z: point.z } : null;
      placeFlag();
      apply();
    },
    groundAt(x, z) {
      return cards ? cards.groundAt(x, z) : 0;
    },
    settle() {
      if (!built) return;
      apply(true);
      cards?.settle();
      scenery?.settle();
      labels?.settle();
      settleHeights();
    },
    update(time) {
      if (!built) return;
      const moving = cards ? cards.update(time.dt, time.reduced) : false;
      if (moving || cardsMoved) settleHeights();
      cardsMoved = moving;
      labels?.update(time.dt, time.reduced);
      if (!landed) return;
      if (sceneUp <= 0.001 && scene.visible) showScene();
      if (!scene.visible) return;
      scenery?.update(time);
      board?.part.update(time);
      signpost?.part.update(time);
      camp?.part.update(time);
      flag?.part.update(time);
      for (const cairn of cairns) cairn.part.update(time);
    },
    hit(raycaster) {
      if (!built || !landed) return null;
      let best: WalkHit | null = null;
      const consider = (kind: WalkHitKind, distance: number | null, waypointId?: string): void => {
        if (distance === null || (best && best.distance <= distance)) return;
        best = { kind, panel: panel.index, stageId: panel.stage.id, distance, ...(waypointId ? { waypointId } : {}) };
      };
      if (board) consider('board', board.part.hit(raycaster));
      if (signpost) consider('signpost', signpost.part.hit(raycaster));
      if (camp) consider('camp', camp.part.hit(raycaster));
      for (const cairn of cairns) consider('cairn', cairn.part.hit(raycaster), cairn.waypointId);
      if (flag && classAt) consider('flag', flag.part.hit(raycaster));
      if (scenery) for (const prop of scenery.props) consider('prop', prop.hit(raycaster));
      return best;
    },
    tap(hit, raycaster) {
      if (hit.kind === 'board') board?.part.tap();
      else if (hit.kind === 'signpost') signpost?.part.tap();
      else if (hit.kind === 'camp') camp?.part.tap();
      else if (hit.kind === 'cairn') cairns.find((cairn) => cairn.waypointId === hit.waypointId)?.part.tap();
      else if (hit.kind === 'flag') flag?.part.tap();
      else if (hit.kind === 'prop') scenery?.tap(raycaster);
    },
    points(target) {
      if (!built) return;
      frame.updateWorldMatrix(true, false);
      const push = (x: number, y: number, z: number, weight: number): void => {
        target.push({ position: frame.localToWorld(new Vector3(x, y, z)), weight });
      };
      const points = panel.route.points;
      for (let k = 0; k < points.length; k += 8) {
        const point = points[k] as { x: number; z: number };
        push(point.x, cards ? cards.groundAt(point.x, point.z) : 0, point.z, 6);
      }
      for (const entry of [board, signpost, camp]) {
        if (!entry) continue;
        push(entry.x, entry.object.position.y + 0.25, entry.z, 40);
        push(entry.x, entry.object.position.y + 0.8, entry.z, 40);
      }
      for (const place of sceneryPlaces) push(place.x, place.object.position.y + 0.3, place.z, 3);
    },
    dispose() {
      sheet?.dispose();
      cards?.dispose();
      labels?.dispose();
      for (const ribbon of [route, ...spurs]) {
        if (!ribbon) continue;
        ribbon.mesh.geometry.dispose();
        ribbon.mesh.material.dispose();
      }
      flag?.part.dispose();
      scenery?.dispose();
      board?.part.dispose();
      signpost?.part.dispose();
      camp?.part.dispose();
      for (const cairn of cairns) cairn.part.dispose();
    },
  };
}
