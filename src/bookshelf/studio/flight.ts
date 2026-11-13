import { Matrix4, type Object3D, PerspectiveCamera, Vector4 } from 'three';
import { createFlight as createCarriedCover, flightPose, type Flight, type FlightOptions } from '../app/flight';
import { leafTangent } from './leaf';
import { FLIGHT_COVER, flightOpening } from './riffle';
import type { Stage } from './stage';
import { type VolumeParts, type VolumeSize, VolumeMesh } from './volume';

/**
 * The flight of a volume in Studio: the lit volume itself, with its board and leaves, carried from the row
 * to its place beside the page above everything.
 *
 * It is built on the CSS flight and keeps that flight's layer, its long shadow and its box, which follows
 * `flightPose` exactly. Over that layer lies a small canvas that travels with the box and shows the volume
 * at that pose. Over the last fifth of the way the flat cover the CSS flight would have carried shows
 * through and the canvas fades. So the volume lands as the same cover, in the same box, that the reader's
 * own cover then replaces, and nothing jumps. Every frame depends on the time alone, so a flight played
 * backwards, or turned round in the air, is the same flight.
 *
 * The volume is drawn by the shelf's own renderer, in the shelf's own lit room, with the materials it has
 * in the row: materials and the room's reflections belong to one WebGL context and cannot be lent to a
 * second. Before each picture of the row, the room is emptied but for the flying volume, which is drawn
 * into a corner of the same canvas and copied from there to the travelling one. It stands where the
 * presented volume stands, so the light on it does not change as it leaves, and a camera of its own
 * looks at it straight on.
 */

/** What Studio knows about the volume to carry. */
export interface FlightBook {
  size: VolumeSize;
  /** The materials to draw it with right now; asked on every frame, so paint that arrives late is picked up. */
  parts(): VolumeParts;
}

/** Where in the room the flying volume stands to be lit: the foot of the presented volume. */
export interface FlightGround {
  x: number;
  y: number;
}

const DEG = Math.PI / 180;
/** The CSS flight layer's `perspective`, in px: the camera stands this far in front of the volume. */
const PERSPECTIVE = 2000;
/** Most device pixels per CSS px the travelling canvas is drawn at. */
const MAX_DENSITY = 2;
/** How far the open volume turns its fore-edge toward the viewer, in radians, so its pages can be seen. */
const SHOW_TURN = 0.4;
/** Shares of the flight over which the flat landing cover appears under the canvas, and the canvas fades. */
const COVER_FROM = 0.8;
const COVER_TO = 0.88;
const FADE_FROM = 0.86;
const FADE_TO = 0.985;

const smooth = (from: number, to: number, value: number): number => {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

interface Airborne {
  options: FlightOptions;
  book: FlightBook;
  time: number;
  /** Size of the travelling canvas in CSS px, and the device pixels per CSS px it is drawn at. */
  width: number;
  height: number;
  density: number;
  stop: () => void;
}

export class FlightStage {
  /** The canvas that travels with the volume. The lit picture is copied into it. */
  readonly canvas = document.createElement('canvas');
  private readonly context: CanvasRenderingContext2D | null;
  private readonly camera = new PerspectiveCamera();
  private readonly mesh = new VolumeMesh();
  private readonly matrix = new Matrix4();
  private readonly scratch = new Matrix4();
  private readonly viewport = new Vector4();
  private readonly scissor = new Vector4();
  private active: Airborne | null = null;

  /**
   * @param stage The shelf's lit room and renderer.
   * @param redraw Asks Studio for a frame; Studio calls `render` in it, before it draws the row.
   */
  constructor(
    private readonly stage: Stage,
    private readonly redraw: () => void,
  ) {
    this.canvas.className = 'bb-studio-flight';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.context = this.canvas.getContext('2d');
    this.mesh.group.visible = false;
    stage.scene.add(this.mesh.group);
  }

  /** Puts one volume in the air. Throws when it cannot, leaving nothing behind, so the caller can fly the CSS cover. */
  fly(options: FlightOptions, book: FlightBook): Flight {
    if (!this.context) throw new Error('The flight has no canvas to draw in.');
    if (this.active) throw new Error('A volume is already in the air.');
    const carried = createCarriedCover(options);
    const layer = options.cover.closest<HTMLElement>('.bb-flight');
    if (!layer) {
      carried.destroy();
      throw new Error('The flight has no layer.');
    }
    const { start, end } = options;
    const { canvas } = this;
    let drawing = true;

    /** From here on the flat cover flies alone, as it does without Studio. */
    const stop = (): void => {
      if (!drawing) return;
      drawing = false;
      canvas.remove();
      delete layer.dataset.paint;
      options.cover.style.opacity = '';
      options.cover.style.visibility = '';
      this.mesh.group.visible = false;
      if (this.active?.stop === stop) this.active = null;
    };

    // Room round the volume at its largest for the board to swing, the head to tip and the lean it starts with.
    const widest = Math.max(start.width, end.width);
    const tallest = end.width > 0 ? Math.max(start.height, (widest * end.height) / end.width) : start.height;
    const width = Math.ceil(widest * 1.6 + 48);
    const height = Math.ceil(tallest * 1.3 + 48);
    const density = Math.min(MAX_DENSITY, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(width * density));
    canvas.height = Math.max(1, Math.round(height * density));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.style.visibility = 'hidden';
    this.mesh.setSize(book.size);
    layer.dataset.paint = 'studio';
    layer.appendChild(canvas);
    const airborne: Airborne = { options, book, time: Number.NaN, width, height, density, stop };
    this.active = airborne;

    return {
      set: (time) => {
        carried.set(time);
        if (!drawing || time === airborne.time) return;
        airborne.time = time;
        // What does not wait for the picture: which of the two covers shows, and where the canvas is.
        const flat = smooth(COVER_FROM, COVER_TO, time);
        const fade = 1 - smooth(FADE_FROM, FADE_TO, time);
        options.cover.style.visibility = flat > 0 ? '' : 'hidden';
        options.cover.style.opacity = flat >= 1 ? '' : String(Math.round(flat * 1000) / 1000);
        canvas.style.opacity = fade >= 1 ? '' : String(Math.round(fade * 1000) / 1000);
        if (fade <= 0) canvas.style.visibility = 'hidden';
        canvas.dataset.time = String(Math.round(time * 10000) / 10000);
        const opening = flightOpening(time);
        canvas.dataset.cover = ((opening.cover * 180) / Math.PI).toFixed(2);
        canvas.dataset.edge = ((leafTangent(opening.leaves[0]!, 1) * 180) / Math.PI).toFixed(2);
        if (fade > 0) this.redraw();
      },
      destroy: () => {
        stop();
        carried.destroy();
      },
    };
  }

  /**
   * Draws the volume in the air, if there is one, and copies it to the travelling canvas. Studio calls
   * this in its frame before it draws the row, which then clears and repaints the whole canvas. A failure
   * here ends the lit flight and leaves the CSS cover flying.
   */
  render(ground: FlightGround): void {
    const airborne = this.active;
    if (!airborne || Number.isNaN(airborne.time)) return;
    try {
      this.draw(airborne, ground);
    } catch {
      airborne.stop();
    }
  }

  private draw(airborne: Airborne, ground: FlightGround): void {
    const { options, book, time, width, height } = airborne;
    const { start, end } = options;
    const { canvas, mesh, camera, stage } = this;
    const context = this.context;
    if (!context || 1 - smooth(FADE_FROM, FADE_TO, time) <= 0) return;

    const pose = flightPose(time, start, end);
    const opening = flightOpening(time);
    mesh.setParts(book.parts());
    mesh.setOpening(opening);
    // The round of the spine stands out beside the cover; it draws in as the CSS flight's spine edge does.
    mesh.setSpineRound(pose.spine);

    const { spineWidth: w, bookHeight: h, coverWidth: d } = book.size;
    const k = (end.width * pose.scale) / d;
    // The reader's cover may be a little taller or shorter for its width than this volume stands on the shelf.
    const landingStretch = end.width > 0 && h > 0 ? end.height / end.width / (h / d) : 1;
    const stretch = 1 + (landingStretch - 1) * (1 - pose.light);
    const show = -SHOW_TURN * Math.min(1, opening.cover / FLIGHT_COVER);
    // The CSS flight's transform, in its order: place the foot, scale, lean, tip, turn. Then the volume is
    // stood with its front board in the plane of the page, the middle of the board's foot on the spot.
    this.matrix
      .makeTranslation(ground.x, ground.y, 0)
      .multiply(this.scratch.makeScale(k, k * stretch, k))
      .multiply(this.scratch.makeRotationZ(-pose.lean * DEG))
      .multiply(this.scratch.makeRotationX(-pose.tip * DEG))
      .multiply(this.scratch.makeRotationY(pose.yaw * DEG + show))
      .multiply(this.scratch.makeTranslation(-d / 2, 0, -w / 2))
      .multiply(this.scratch.makeRotationY(-Math.PI / 2));
    mesh.group.matrix.copy(this.matrix);
    mesh.group.matrixWorldNeedsUpdate = true;

    // The camera stands straight in front of the middle of the cover, so nothing behind the cover shows as
    // it lands, and looks at as much of the room as the travelling canvas holds.
    const middle = (end.height * pose.scale) / 2;
    const near = PERSPECTIVE * 0.1;
    const s = near / PERSPECTIVE;
    camera.position.set(ground.x, ground.y + middle, PERSPECTIVE);
    camera.updateMatrixWorld(true);
    camera.projectionMatrix.makePerspective((-width / 2) * s, (width / 2) * s, (height / 2) * s, (-height / 2) * s, near, PERSPECTIVE * 4);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();

    // A corner of the shelf's canvas, as large as the travelling canvas or as large as fits.
    const renderer = stage.renderer;
    const buffer = renderer.domElement;
    const fit = Math.min(1, buffer.width / canvas.width, buffer.height / canvas.height);
    const pixelsWide = Math.max(1, Math.floor(canvas.width * fit));
    const pixelsHigh = Math.max(1, Math.floor(canvas.height * fit));
    const ratio = renderer.getPixelRatio();

    // Empty the room but for the lights and the flying volume.
    const hidden: Object3D[] = [];
    for (const child of stage.scene.children) {
      if (child === mesh.group || (child as { isLight?: boolean }).isLight || !child.visible) continue;
      child.visible = false;
      hidden.push(child);
    }
    mesh.group.visible = true;
    renderer.getViewport(this.viewport);
    renderer.getScissor(this.scissor);
    const scissored = renderer.getScissorTest();
    try {
      renderer.setViewport(0, 0, pixelsWide / ratio, pixelsHigh / ratio);
      renderer.setScissor(0, 0, pixelsWide / ratio, pixelsHigh / ratio);
      renderer.setScissorTest(true);
      renderer.render(stage.scene, camera);
      // The corner is at the foot of the drawing buffer; a canvas counts its rows from the head.
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(buffer, 0, buffer.height - pixelsHigh, pixelsWide, pixelsHigh, 0, 0, canvas.width, canvas.height);
    } finally {
      renderer.setViewport(this.viewport);
      renderer.setScissor(this.scissor);
      renderer.setScissorTest(scissored);
      mesh.group.visible = false;
      for (const child of hidden) child.visible = true;
    }
    canvas.style.transform = `translate3d(${Math.round((pose.x - width / 2) * 100) / 100}px, ${Math.round((pose.y - middle - height / 2) * 100) / 100}px, 0)`;
    canvas.style.visibility = '';
  }

  dispose(): void {
    this.active?.stop();
    this.stage.scene.remove(this.mesh.group);
    this.mesh.dispose();
    this.canvas.remove();
  }
}
