import './studio.css';
import { BoxGeometry, Euler, Matrix4, Mesh, MeshStandardMaterial, Vector3, type WebGLRenderer } from 'three';
import type { Flight, FlightOptions } from '../app/flight';
import type { FrameVolume, ShelfFrame, ShelfHandle } from '../shelf/types';
import { fromCssMatrix, volumeMatrix } from './camera';
import { type DressKit, Dresser } from './dress';
import { ContactShadows } from './ground';
import { IDLE_MS, pointerPlace, type Spring, spring, TILT_PITCH, TILT_YAW } from './pointer';
import { roomOf, Stage, webglAvailable } from './stage';
import { type FlightBook, FlightStage } from './flight';
import { leafTangent } from './leaf';
import { arrivalAt, ARRIVE_MS, isShut, layer, PEEK_COVER, PEEK_REST_MS, peekAt, scaled, shut } from './riffle';
import { type Opening, VolumeMesh } from './volume';

export type { Binding, Paint, PaintedFace, PaintedVolume, Stamp } from './types';
export { webglAvailable } from './stage';

/**
 * Studio: paints the shelf a second time, in WebGL, with lit materials. The DOM shelf stays and keeps
 * every control, gesture and focus ring; its faces turn transparent and the canvas behind them shows
 * the same volumes at the same places, because the camera repeats the CSS perspective exactly.
 */

export interface StudioOptions {
  /** Materials and painting, or a function that makes them for Studio's renderer. Left out, volumes are drawn in plain lit cloth. */
  kit?: DressKit | ((renderer: WebGLRenderer) => DressKit);
  /** Called when WebGL is lost or cannot start; the host should go back to the CSS shelf. */
  onFailure?: (reason: string) => void;
}

export interface StudioHandle {
  readonly canvas: HTMLCanvasElement;
  /** Swaps the materials kit, for example once the full one has loaded. */
  setKit(kit: DressKit): void;
  /**
   * Carries the volume `id` from the row to its place beside the page as the lit volume itself, pages and
   * all, in a canvas above everything. It takes what the CSS flight takes and gives back the same handle:
   * `set(time)` with 0 on the shelf and 1 landed, and `destroy()`. It lands as the flat cover it was given,
   * in the same box. Throws when it cannot fly (the volume is not drawn, WebGL is gone); the caller then
   * flies the CSS cover.
   */
  createFlight(options: FlightOptions, id: string): Flight;
  destroy(): void;
}

/** How long a volume keeps being read from the DOM after a pointer touched it: its CSS reaction runs this long. */
const LIVELY_MS = 900;

/** How long the canvas takes to come up over the CSS drawing when Studio first draws, in ms. Also in studio.css. */
const ARRIVE_FADE_MS = 250;

/** Nearer the centre than this, a volume counts as presented: it has arrived. */
const PRESENTED = 0.98;

/** How far an open volume turns its fore-edge toward the viewer, in radians, when its board stands fully open. */
const SHOW_TURN = 0.3;

/** A volume opening or closing under the hand: which way, since when, and how it stood at that moment. */
interface Peek {
  open: boolean;
  since: number;
  from: Opening;
  /** Share of the full opening the hand asks for, and how far the volume shows its fore-edge, both eased. */
  reach: number;
  turn: number;
  /** When `reach` and `turn` were last stepped. */
  stepped: number;
}

/** A hand at the hinge opens the volume this share of the way; at the fore-edge it opens it fully. */
const REACH_AT_HINGE = 0.25;
/**
 * Under keyboard focus the board opens only this far, in radians, and the volume does not turn: the focus
 * ring is drawn round the cover as it stands, and must still frame it.
 */
const FOCUS_COVER = 0.12;
/** Time constant with which the opening follows the hand along the cover, in ms. */
const REACH_TAU_MS = 90;
const DEG = Math.PI / 180;

const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const plainKit: DressKit = {
  bindingOf: () => ({ binding: 'cloth', stamp: 'gold' }),
};

export function mountStudio(shelf: ShelfHandle, options: StudioOptions = {}): StudioHandle {
  if (!webglAvailable()) throw new Error('WebGL 2 is not available.');
  const stage = new Stage();
  // This draw loop steps the light itself and says when a shadow has to be drawn again.
  stage.paced = true;
  const canvas = stage.canvas;
  canvas.className = 'bb-studio';
  canvas.setAttribute('aria-hidden', 'true');
  const root = shelf.element;

  const meshes = new Map<number, VolumeMesh>();
  const bookendMaterial = new MeshStandardMaterial({ color: '#4b4842', roughness: 0.45, metalness: 0.35 });
  const bookendGeometry = new BoxGeometry(1, 1, 1);
  bookendGeometry.translate(0, 0.5, -0.5);
  const bookends = [new Mesh(bookendGeometry, bookendMaterial), new Mesh(bookendGeometry, bookendMaterial)];
  for (const bookend of bookends) {
    bookend.castShadow = true;
    bookend.receiveShadow = true;
    bookend.visible = false;
    stage.row.add(bookend);
  }

  let frame: ShelfFrame | null = null;
  let variant = '';
  let queued: number | null = null;
  let alive = true;
  let drawn = 0;
  /** Whether the frame being drawn was asked for by the one before it, and when that one was drawn. */
  let continuing = false;
  let lastDrawAt = 0;
  const lively = new Map<Element, number>();
  /** Volumes that stand open under the hand or are closing again, by slot. The page motion itself is in riffle.ts. */
  const peeks = new Map<number, Peek>();
  /** Volumes whose pages flutter because they have just arrived at the centre, by slot. */
  const arrivals = new Map<number, { since: number; steps: number }>();
  /** The volume that was last presented, to tell an arrival from a volume that simply stands there. */
  let home: { id: string; slot: number } | null = null;
  let hovered: Element | null = null;
  const matrix = new Matrix4();
  const body = new Matrix4();
  /** Where the hand is over the scene, -1 to 1 each way, while it is there and moving; null once it left or lies still. */
  let hand: { x: number; y: number } | null = null;
  let idle: number | null = null;
  /** The lean of the presented volume toward the hand, 1 being the most it turns. */
  const yaw: Spring = { value: 0, velocity: 0 };
  const pitch: Spring = { value: 0, velocity: 0 };
  let leaned = 0;
  const lean = new Matrix4();
  const turn = new Euler();
  const middle = new Vector3();
  const turned = new Vector3();
  /** The frame the shadows were last drawn for, and whether anything was moving in it. */
  let shaded: ShelfFrame | null = null;
  let wasMoving = false;
  /** Studio shows itself once its first whole frame is drawn: 'no', then 'compiling', then 'ready', then 'shown'. */
  let arrival: 'no' | 'compiling' | 'ready' | 'shown' = 'no';
  let arriving: number | null = null;
  let kit: DressKit = typeof options.kit === 'function' ? options.kit(stage.renderer) : (options.kit ?? plainKit);
  const dresser = new Dresser(kit, () => invalidate());
  stage.setEnvironment(kit.environment ?? null);
  const ground = new ContactShadows();
  stage.row.add(ground.mesh);
  let floorKey = '';
  /** Draws a volume in the air between the row and the page; made for the first flight and kept for the next. */
  let flights: FlightStage | null = null;
  let leavesReady = false;

  /** A volume as the flight draws it: with the same materials as in the row, so nothing changes when it leaves. */
  function bookOf(volume: FrameVolume): FlightBook {
    const detail = density(volume);
    const look = variant;
    const id = volume.id;
    return {
      size: { spineWidth: volume.spineWidth, bookHeight: volume.bookHeight, coverWidth: volume.coverWidth },
      parts: () => dresser.partsFor(frame?.volumes.find((entry) => entry.id === id) ?? volume, look, detail),
    };
  }

  const fail = (reason: string) => {
    if (!alive) return;
    options.onFailure?.(reason);
  };
  const onLost = (event: Event) => {
    event.preventDefault();
    fail('The WebGL context was lost.');
  };
  canvas.addEventListener('webglcontextlost', onLost);

  function invalidate(): void {
    if (queued !== null || !alive) return;
    queued = requestAnimationFrame(draw);
  }


  /** Detail of the painted faces: more for a large shelf on a sharp screen, never more than the canvas shows. */
  function density(volume: FrameVolume): number {
    const ratio = window.devicePixelRatio || 1;
    const screen = Math.min(2, ratio);
    const near = Math.min(2.5, screen * 1.25);
    // The presented volume is the one that gets read: it keeps up with a zoomed page, up to four device px per px.
    const wanted = volume.centre ? Math.max(near, Math.min(4, ratio)) : volume.weight > 0 ? near : screen;
    // Never paint faces finer than this device can afford to draw.
    return Math.min(wanted, Math.max(1, stage.detail * 1.25));
  }

  /** Studio takes over from the CSS drawing: the canvas comes up behind the row while the CSS faces fade away over it. */
  function arrive(): void {
    arrival = 'shown';
    canvas.classList.add('is-shown');
    if (reducedMotion()) {
      root.dataset.paint = 'studio';
      return;
    }
    root.dataset.studio = 'arriving';
    arriving = window.setTimeout(() => {
      arriving = null;
      root.dataset.paint = 'studio';
      delete root.dataset.studio;
    }, ARRIVE_FADE_MS);
  }

  function draw(): void {
    queued = null;
    if (!frame || !alive) return;
    const current = frame;
    if (current.scene !== canvas.parentElement) placeCanvas(current.scene);
    if (current.variant !== variant) {
      variant = current.variant;
      stage.setRoom(variant);
      dresser.clear();
      ground.setStrength(roomOf(variant).contact);
      floorKey = '';
    }
    const now = performance.now();
    const still = reducedMotion();
    let moving = false;
    // Frames asked for one after another are motion: how far apart they come is what this device can do. A
    // device that cannot keep up is given less detail, so the shelf's motion is not stretched out.
    const travelling = root.dataset.settled === '0';
    if ((continuing || travelling) && now - lastDrawAt < 1000 && stage.note(now - lastDrawAt)) moving = true;
    lastDrawAt = now;
    // The light follows the hand with a lag and keeps the frames coming until it has arrived.
    if (still) stage.pin();
    else if (stage.advance(now)) moving = true;
    let deepest = 0;
    let tallest = 0;
    for (const volume of current.volumes) {
      deepest = Math.max(deepest, volume.coverWidth);
      tallest = Math.max(tallest, volume.bookHeight);
    }
    stage.fit(current, deepest, tallest);
    const origin = { x: current.rowGive, y: current.floorY - current.height / 2 };
    const board = stage.boardSize();
    if (floorKey !== `${variant}:${board.width}:${board.depth}`) {
      floorKey = `${variant}:${board.width}:${board.depth}`;
      stage.setBoardMaterial(kit.floor?.(variant, board) ?? null);
    }
    ground.update(current, origin, stage.front);
    const seen = new Set<number>();
    for (const volume of current.volumes) {
      seen.add(volume.slot);
      let mesh = meshes.get(volume.slot);
      if (!mesh) {
        mesh = new VolumeMesh();
        meshes.set(volume.slot, mesh);
        stage.row.add(mesh.group);
      }
      mesh.setSize(volume);
      mesh.setParts(dresser.partsFor(volume, variant, density(volume)));
      const progress = volume.item.done ? 0 : Math.min(1, Math.max(0, volume.item.progress ?? 0));
      mesh.setSlip(progress, dresser.slipMaterial);
      volumeMatrix(volume, origin, matrix);
      // A volume reacting to the pointer (rising, tipping, pressed) moves its body by CSS; follow it.
      const until = lively.get(volume.element);
      const reacting = until !== undefined && until > now;
      const arriving = volume.element.classList.contains('is-rising') || volume.element.classList.contains('is-arriving');
      if (reacting || arriving) {
        const bodyElement = volume.element.querySelector<HTMLElement>('.bb-book__body');
        const transform = bodyElement ? getComputedStyle(bodyElement).transform : 'none';
        if (transform && transform !== 'none') matrix.multiply(fromCssMatrix(new DOMMatrixReadOnly(transform), body));
        moving = true;
      } else if (until !== undefined) lively.delete(volume.element);
      const presented = current.open === 0 && volume.centre && volume.weight > PRESENTED && !volume.hidden;
      // A volume that reaches the centre from another place lets its pages run on for a moment.
      if (presented && (home?.id !== volume.id || home.slot !== volume.slot)) {
        const moved = home !== null && current.volumes.some((other) => other.id === home?.id);
        if (moved && !still && home) arrivals.set(volume.slot, { since: now, steps: Math.max(1, Math.abs(volume.slot - home.slot)) });
        home = { id: volume.id, slot: volume.slot };
        yaw.value = yaw.velocity = pitch.value = pitch.velocity = 0;
      }
      const arrival = arrivals.get(volume.slot);
      let flutter: Opening | null = null;
      if (arrival) {
        if (!presented || still || now - arrival.since >= ARRIVE_MS) arrivals.delete(volume.slot);
        else {
          flutter = arrivalAt(now - arrival.since, arrival.steps);
          moving = true;
        }
      }
      // The presented volume opens while the hand rests on it, as the CSS one lifts, and closes when it leaves.
      const underHand = hovered === volume.element;
      const wanted = !still && presented && (underHand || ringed(volume.element));
      let peek = peeks.get(volume.slot);
      // How far the hand asks the volume to open: more the nearer it is to the fore-edge; a little for the keyboard.
      let reach = FOCUS_COVER / PEEK_COVER;
      if (wanted && underHand) reach = REACH_AT_HINGE + (1 - REACH_AT_HINGE) * alongCover(volume.element);
      if (!peek && wanted) {
        peek = { open: true, since: now, from: shut(), reach, turn: underHand ? 1 : 0, stepped: now };
        peeks.set(volume.slot, peek);
      } else if (peek && peek.open !== wanted) {
        peek.from = peekAt(now - peek.since, peek.open, peek.from);
        peek.open = wanted;
        peek.since = now;
      }
      let opening: Opening | null = null;
      if (peek) {
        const age = now - peek.since;
        if (!peek.open && (age >= PEEK_REST_MS || still)) peeks.delete(volume.slot);
        else {
          // While the hand is there the opening follows it along the cover; once it has left, it closes from where it was.
          if (peek.open) {
            const step = 1 - Math.exp(-Math.min(100, Math.max(0, now - peek.stepped)) / REACH_TAU_MS);
            const turn = underHand ? 1 : 0;
            peek.reach = Math.abs(reach - peek.reach) < 0.003 ? reach : peek.reach + (reach - peek.reach) * step;
            peek.turn = Math.abs(turn - peek.turn) < 0.003 ? turn : peek.turn + (turn - peek.turn) * step;
            if (peek.reach !== reach || peek.turn !== turn) moving = true;
          }
          peek.stepped = now;
          opening = scaled(peekAt(age, peek.open, peek.from), peek.reach);
          if (age < PEEK_REST_MS) moving = true;
        }
      }
      if (flutter) opening = opening ? layer(opening, flutter) : flutter;
      const shown = opening && !isShut(opening) ? opening : null;
      mesh.setOpening(shown);
      // An open volume turns its fore-edge a little toward the viewer, or the board would hide its own pages.
      if (shown) matrix.multiply(body.makeRotationY(-SHOW_TURN * (peek?.turn ?? 1) * Math.min(1, shown.cover / PEEK_COVER)));
      if (presented) {
        canvas.dataset.cover = shown ? ((shown.cover * 180) / Math.PI).toFixed(2) : '0';
        canvas.dataset.edge = shown ? ((leafTangent(shown.leaves[0]!, 1) * 180) / Math.PI).toFixed(2) : '0';
        // The presented volume leans toward the hand on a spring, about its own middle, while it stands shut.
        if (still) yaw.value = yaw.velocity = pitch.value = pitch.velocity = 0;
        else {
          const calm = hand !== null && !shown;
          const place = (origin.x + volume.x) / Math.max(1, current.width / 2);
          const dt = leaned === 0 ? 16 : Math.min(64, Math.max(0, now - leaned));
          const turning = spring(yaw, calm && hand ? Math.max(-1, Math.min(1, (hand.x - place) * 1.4)) : 0, dt);
          const nodding = spring(pitch, calm && hand ? Math.max(-1, Math.min(1, hand.y * 1.2)) : 0, dt);
          leaned = turning || nodding ? now : 0;
          if (turning || nodding) moving = true;
        }
        if (yaw.value !== 0 || pitch.value !== 0) {
          // A turn about the middle of the volume: the middle stays where it is, so the control over it still fits.
          middle.set(0, volume.bookHeight / 2, -volume.coverWidth / 2).applyMatrix4(matrix);
          lean.makeRotationFromEuler(turn.set(pitch.value * TILT_PITCH * DEG, yaw.value * TILT_YAW * DEG, 0, 'YXZ'));
          turned.copy(middle).applyMatrix4(lean);
          lean.setPosition(middle.sub(turned));
          matrix.premultiply(lean);
        }
        canvas.dataset.tilt = `${(yaw.value * TILT_YAW).toFixed(2)},${(pitch.value * TILT_PITCH).toFixed(2)}`;
      }
      mesh.group.matrix.copy(matrix);
      mesh.group.matrixWorldNeedsUpdate = true;
      mesh.group.visible = !volume.hidden;
    }
    for (const [slot, mesh] of meshes) {
      if (seen.has(slot)) continue;
      stage.row.remove(mesh.group);
      mesh.dispose();
      meshes.delete(slot);
    }
    bookends.forEach((bookend, index) => {
      const end = current.bookends[index];
      bookend.visible = end !== undefined;
      if (!end) return;
      bookend.scale.set(end.width, end.height, end.depth);
      bookend.position.set(origin.x + end.x, origin.y, 0);
    });
    // Shadows are drawn again only when the shelf sent a new frame, a volume is in motion, or the light moved.
    if (current !== shaded || moving || wasMoving) stage.touch();
    shaded = current;
    wasMoving = moving;
    // Before the first frame the programs are built off the main thread where the browser can, so the page stays in hand.
    if (arrival === 'no') {
      arrival = 'compiling';
      const ready = () => {
        if (arrival !== 'compiling') return;
        arrival = 'ready';
        invalidate();
      };
      stage.renderer.compileAsync(stage.scene, stage.camera).then(ready, ready);
      window.setTimeout(ready, 3000);
    }
    if (arrival === 'compiling') return;
    // A volume in the air is drawn first, into a corner of this canvas, lit as the presented volume is.
    if (flights) {
      const centred = current.volumes.find((volume) => volume.centre);
      flights.render({ x: origin.x + (centred ? centred.x : current.lampX), y: origin.y });
    }
    stage.render();
    if (arrival === 'ready') arrive();
    // What was drawn, for tests and for anyone checking Studio in the inspector.
    drawn++;
    canvas.dataset.drawn = String(drawn);
    canvas.dataset.volumes = String(current.volumes.filter((volume) => !volume.hidden).length);
    continuing = moving;
    if (moving) invalidate();
    // The loose leaves are first shown when a volume opens. Their shader is compiled once the row stands, in a
    // quiet moment, or the first opening would wait for it and jump.
    if (!leavesReady && current.volumes.length > 0) {
      leavesReady = true;
      window.setTimeout(() => {
        if (!alive) return;
        try {
          stage.renderer.compile(stage.scene, stage.camera);
        } catch {
          // Without it the first opening compiles the shader itself.
        }
      }, 350);
    }
  }

  function placeCanvas(scene: HTMLElement): void {
    const row = scene.querySelector('.bb-shelf__row');
    scene.insertBefore(canvas, row);
  }

  const stopFrames = shelf.onFrame((next) => {
    frame = next;
    invalidate();
  });

  // The light leans toward the pointer, so moving over the shelf moves the highlights on the covers. It
  // follows with a lag (in the stage), goes back to rest when the hand leaves or lies still, and stays at
  // rest for a person who asked for less motion, while a reader covers the shelf, and for a pointer elsewhere on the page.
  const scene = shelf.surface;
  const rest = () => {
    if (idle !== null) clearTimeout(idle);
    idle = null;
    if (hand === null) return;
    hand = null;
    stage.home();
    // With a reader over the shelf nobody sees the light go home, so it is put there without a frame.
    if (root.dataset.open !== '0' && root.dataset.open !== undefined) stage.pin();
    else invalidate();
  };
  const onMove = (event: PointerEvent) => {
    if (reducedMotion() || (root.dataset.open !== '0' && root.dataset.open !== undefined)) return;
    const place = pointerPlace(event.clientX, event.clientY, scene.getBoundingClientRect());
    if (!place) {
      rest();
      return;
    }
    if (hand && hand.x === place.x && hand.y === place.y) return;
    hand = place;
    stage.setPointer(place.x, place.y);
    if (idle !== null) clearTimeout(idle);
    idle = window.setTimeout(rest, IDLE_MS);
    invalidate();
  };
  const onLeave = () => rest();
  const lessMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const onMotionChoice = () => {
    if (idle !== null) clearTimeout(idle);
    idle = null;
    hand = null;
    stage.home();
    invalidate();
  };
  // Where the hand is along the presented cover, for how far the volume opens under it.
  let handX: number | null = null;
  const onHand = (event: PointerEvent) => {
    handX = event.clientX;
    if (hovered) invalidate();
  };
  /** Share of the way from the hinge to the fore-edge at which the hand is over a volume's cover; the middle when unknown. */
  const alongCover = (element: HTMLElement): number => {
    const cover = element.querySelector('.bb-book__cover');
    if (handX === null || !cover) return 0.5;
    const box = cover.getBoundingClientRect();
    return box.width > 0 ? Math.min(1, Math.max(0, (handX - box.left) / box.width)) : 0.5;
  };
  const onTouch = (event: Event) => {
    const book = (event.target as Element | null)?.closest?.('.bb-book') ?? null;
    if (book) lively.set(book, performance.now() + LIVELY_MS);
    if (event.type === 'pointerover') hovered = book;
    else if (event.type === 'pointerout' && book === hovered) {
      const into = (event as PointerEvent).relatedTarget as Element | null;
      if (!into || into.closest?.('.bb-book') !== book) hovered = null;
    }
    invalidate();
  };
  const ringed = (element: HTMLElement): boolean => element.querySelector('.bb-book__control:focus-visible') !== null;
  window.addEventListener('pointermove', onMove, { passive: true });
  document.documentElement.addEventListener('pointerleave', onLeave, { passive: true });
  lessMotion?.addEventListener('change', onMotionChoice);
  const reactions = ['pointerover', 'pointerout', 'pointerdown', 'pointerup', 'focusin', 'focusout'] as const;
  for (const type of reactions) scene.addEventListener(type, onTouch, { passive: true });
  scene.addEventListener('pointermove', onHand, { passive: true });

  return {
    canvas,
    setKit(next) {
      kit.dispose?.();
      kit = next;
      dresser.setKit(kit);
      stage.setEnvironment(kit.environment ?? null);
      floorKey = '';
      invalidate();
    },
    createFlight(flightOptions, id) {
      const volume = frame?.volumes.find((entry) => entry.id === id && entry.centre) ?? frame?.volumes.find((entry) => entry.id === id);
      if (!alive || !volume) throw new Error('Studio has not drawn this volume.');
      flights ??= new FlightStage(stage, invalidate);
      return flights.fly(flightOptions, bookOf(volume));
    },
    destroy() {
      alive = false;
      if (idle !== null) clearTimeout(idle);
      if (arriving !== null) clearTimeout(arriving);
      flights?.dispose();
      flights = null;
      if (queued !== null) cancelAnimationFrame(queued);
      stopFrames();
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      lessMotion?.removeEventListener('change', onMotionChoice);
      for (const type of reactions) scene.removeEventListener(type, onTouch);
      scene.removeEventListener('pointermove', onHand);
      canvas.removeEventListener('webglcontextlost', onLost);
      for (const mesh of meshes.values()) mesh.dispose();
      meshes.clear();
      bookendGeometry.dispose();
      bookendMaterial.dispose();
      dresser.dispose();
      ground.dispose();
      kit.dispose?.();
      stage.dispose();
      delete root.dataset.paint;
      delete root.dataset.studio;
    },
  };
}
