/**
 * The paper kit: the material every sheet in the scene is made of, the way a drawing becomes a cut-out, the
 * pop-up stack, the printed route, and the motion all of it shares.
 */
export * from './motion';
export {
  PAPER,
  createPaperDepthMaterial,
  createPaperMaterial,
  createPaperUniforms,
  paperShadowVertex,
  paperUniforms,
  type PaperDepthMaterial,
  type PaperMaterial,
  type PaperOptions,
  type PaperUniforms,
} from './material';
export {
  blurField,
  makeSilhouette,
  roundedRect,
  silhouettePad,
  type Draw2D,
  type Silhouette,
  type SilhouetteSize,
} from './silhouette';
export { buildSheet, type Sheet, type SheetSpec } from './sheet';
export {
  STACK,
  createSheetStack,
  keepApart,
  leafProgress,
  type Leaf,
  type LeafPose,
  type LeafState,
  type SheetStack,
} from './stack';
export {
  ROUTE,
  createRouteGeometry,
  createRouteMaterial,
  type RouteGeometryOptions,
  type RouteMaterial,
  type RouteOptions,
  type RouteRibbon,
  type RouteUniforms,
} from './route';
