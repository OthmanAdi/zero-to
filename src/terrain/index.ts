/**
 * The terrain core: mountains, contour cards, trails and ground surfaces as plain data. Nothing here touches three.js
 * or the DOM, so an agent skill, a test or a build script can use it. The paper model lives in `./model`.
 */
export {
  DEFAULT_RESOLUTION,
  TERRAIN_TEMPLATE_IDS,
  generateHeightfield,
  heightfieldFromData,
  resolveTerrainTemplate,
  type Heightfield,
  type TerrainSpec,
  type TerrainTemplate,
} from './heightfield';
export {
  levelHeights,
  levelIndexAt,
  pointInLevel,
  pointInPolygon,
  pointInRing,
  ringArea,
  ringSelfIntersects,
  traceContours,
  type ContourLevel,
  type ContourOptions,
  type ContourPolygon,
  type Point2,
  type Ring,
} from './contours';
export {
  TRAIL_TEMPLATE_IDS,
  markTrail,
  planTrail,
  resolveTrailTemplate,
  trailPointAt,
  type Trail,
  type TrailMark,
  type TrailMarkOptions,
  type TrailPoint,
  type TrailSpec,
  type TrailStop,
  type TrailTemplate,
} from './trail';
export { assignSurfaces, isSurfaceKind, type SurfaceOptions } from './surfaces';
export { TERRAIN_TEMPLATES, TRAIL_TEMPLATES, describeTerrain, describeTrail, type TemplateEntry } from './catalogue';
export { createNoise2D, fbm, type Noise2D } from './noise';
