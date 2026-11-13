import { CanvasTexture, Group, LinearFilter, LinearMipmapLinearFilter, Mesh, NoColorSpace, PlaneGeometry, SRGBColorSpace } from 'three';
import { THEME } from '../look/theme';
import {
  PAPER,
  createPaperDepthMaterial,
  createPaperMaterial,
  type PaperDepthMaterial,
  type PaperMaterial,
} from './material';
import { makeSilhouette, roundedRect, type Draw2D, type Silhouette } from './silhouette';

/**
 * One sheet of paper: a cut-out that stands on the map, or a flat sheet that lies on the table.
 *
 * A sheet is described by two drawings of the same size. The outline says where there is paper. The print says
 * what is on it. Both are plain canvas drawings, so anything that can be drawn can be cut out of paper.
 */
export interface SheetSpec {
  /** Size of the drawing in scene units. */
  readonly width: number;
  readonly height: number;
  /**
   * Where there is paper, painted in white. Without it the sheet is a rectangle with slightly round corners.
   * A standing sheet should paint on below its foot (past `height`), so the foot stays a clean line.
   */
  readonly outline?: Draw2D;
  /** What is printed on the sheet. The canvas is already filled with the paper tone. */
  readonly print?: Draw2D;
  /** Paper tone under the print. */
  readonly paper?: string;
  /** Tone of the reverse side. Without it the reverse shows the print mirrored. */
  readonly back?: string | null;
  /** Canvas pixels per scene unit. 300 by default. Pass less on phones. */
  readonly resolution?: number;
  /** The widest canvas allowed, in pixels. Larger sheets get a lower resolution. 1400 by default. */
  readonly maxCanvas?: number;
  /** Softness of the outline field in scene units. It also sets the width of the lighter core of the cut. */
  readonly soft?: number;
  /**
   * True for a cut-out that stands on a hinge along its foot: the foot is kept straight and gets a contact
   * shade. False for a sheet that lies flat. Default true.
   */
  readonly standing?: boolean;
  readonly seed?: number;
  /**
   * How far the torn edge strays, as a share of the sheet's longer side (0.006 by default). The tear grows
   * with the sheet, so a large sheet such as a map panel reads cleaner with about half of that.
   */
  readonly deckle?: number;
  readonly warp?: number;
  readonly fibre?: number;
  readonly rim?: number;
  readonly hinge?: number;
  readonly through?: number;
  /** How far the sheet sways when it stands, in radians. 0.003 to 0.014 in the scene. */
  readonly sway?: number;
}

export interface Sheet {
  /**
   * The hinge. For a standing sheet its origin is the middle of the foot, the sheet rises along +Y and faces
   * +Z. For a lying sheet the origin is the middle of the sheet, which lies in the XZ plane facing up.
   */
  readonly object: Group;
  readonly mesh: Mesh<PlaneGeometry, PaperMaterial>;
  readonly material: PaperMaterial;
  readonly depthMaterial: PaperDepthMaterial;
  readonly silhouette: Silhouette;
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  readonly sway: number;
  /** Folds a standing sheet: 0 stands upright, -PI / 2 lies back on the map. */
  setAngle(angle: number): void;
  /** True when a point of the drawing (0 to 1 across and up) is on paper. For taps. */
  isPaper(u: number, v: number): boolean;
  /** Redraws the print, for example when progress changes what a sheet shows. */
  reprint(print: Draw2D): void;
  dispose(): void;
}

/** Builds a sheet from its two drawings. Needs a browser canvas. */
export function buildSheet(spec: SheetSpec): Sheet {
  const standing = spec.standing ?? true;
  const seed = spec.seed ?? 0;
  const maxCanvas = spec.maxCanvas ?? 1400;
  const soft = spec.soft ?? 0.014;
  let resolution = spec.resolution ?? 300;
  const longest = Math.max(spec.width, spec.height) + soft * 8;
  if (longest * resolution > maxCanvas) resolution = maxCanvas / longest;

  const pxWidth = Math.max(8, Math.round(spec.width * resolution));
  const pxHeight = Math.max(8, Math.round(spec.height * resolution));
  const blur = Math.max(1.2, soft * resolution);

  const corner = Math.min(spec.width, spec.height) * 0.02 * resolution;
  const outline: Draw2D =
    spec.outline ??
    ((ctx, w, h) => {
      roundedRect(ctx, 0, 0, w, standing ? h * 1.5 : h, corner);
      ctx.fill();
    });
  const silhouette = makeSilhouette(outline, blur, { width: pxWidth, height: pxHeight });
  const padPx = silhouette.pad;
  const pad = padPx / resolution;

  const printCanvas = document.createElement('canvas');
  printCanvas.width = pxWidth + padPx * 2;
  printCanvas.height = pxHeight + padPx * 2;
  const printCtx = printCanvas.getContext('2d');
  if (!printCtx) throw new Error('buildSheet: no 2D canvas');
  const paint = (print: Draw2D | undefined) => {
    printCtx.setTransform(1, 0, 0, 1, 0, 0);
    // Paper tone to the very edge of the canvas, so the torn edge never shows an unprinted fringe.
    printCtx.fillStyle = spec.paper ?? THEME.paper;
    printCtx.fillRect(0, 0, printCanvas.width, printCanvas.height);
    if (print) {
      printCtx.save();
      printCtx.translate(padPx, padPx);
      print(printCtx, pxWidth, pxHeight);
      printCtx.restore();
    }
  };
  paint(spec.print);

  const map = new CanvasTexture(printCanvas);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 4;
  const field = new CanvasTexture(silhouette.canvas);
  field.colorSpace = NoColorSpace;
  field.minFilter = LinearMipmapLinearFilter;
  field.magFilter = LinearFilter;

  const material = createPaperMaterial({
    map,
    silhouette: field,
    back: spec.back ?? null,
    size: [spec.width, spec.height],
    pad,
    seed,
    pinned: standing,
    warp: spec.warp ?? PAPER.warp,
    deckle: spec.deckle ?? PAPER.deckle,
    fibre: spec.fibre ?? PAPER.fibre,
    rim: spec.rim ?? PAPER.rim,
    hinge: spec.hinge ?? (standing ? PAPER.hinge : 0),
    through: spec.through ?? PAPER.through,
  });
  const depthMaterial = createPaperDepthMaterial(material);

  const fullWidth = spec.width + pad * 2;
  const fullHeight = spec.height + pad * 2;
  const geometry = new PlaneGeometry(
    fullWidth,
    fullHeight,
    Math.max(2, Math.min(24, Math.round(fullWidth * 3))),
    Math.max(2, Math.min(24, Math.round(fullHeight * 3))),
  );
  const mesh = new Mesh(geometry, material);
  mesh.customDepthMaterial = depthMaterial;
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const object = new Group();
  if (standing) {
    // The foot of the drawing is on the hinge line. The padding below it is under the map.
    mesh.position.y = spec.height / 2;
  } else {
    mesh.rotation.x = -Math.PI / 2;
  }
  object.add(mesh);

  return {
    object,
    mesh,
    material,
    depthMaterial,
    silhouette,
    width: spec.width,
    height: spec.height,
    seed,
    sway: spec.sway ?? 0,
    setAngle(angle) {
      object.rotation.x = angle;
    },
    isPaper(u, v) {
      return silhouette.valueAt(u, v) >= 0.5;
    },
    reprint(print) {
      paint(print);
      map.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      depthMaterial.dispose();
      map.dispose();
      field.dispose();
    },
  };
}
