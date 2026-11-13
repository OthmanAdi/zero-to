import { THEME } from './theme';

/**
 * The lamp over the table, calibrated for the renderer the stage builds (ACES filmic tone mapping at exposure
 * 1.0, sRGB output).
 *
 * How it was fixed: on the look dev page a paper card lies under the middle of the pool at three heights. The
 * readings at 340 candela, in sRGB (red, green, blue):
 *
 * | Card                           | Reading       |
 * |--------------------------------|---------------|
 * | top of the highest summit, 1.4 | 238, 232, 220 |
 * | top of a low summit, 0.72      | 230, 222, 206 |
 * | sheet on the table             | 171, 161, 143 |
 *
 * The highest card is the one that could clip, so it sets the level: at 340 it sits in the band of 228 to 245
 * with room left for a hovered card's glow. The tone curve is flat up there: at 440 candela the same card
 * read 242, 237, 228. Anything tuned against the lamp starts from these numbers.
 */
export const LAMP = {
  /** Where the lamp hangs, measured from the middle of its pool: left, above and behind it. */
  offset: { x: -1.9, y: 7.9, z: -3.2 },
  /** Candela of the spot light. */
  intensity: 340,
  /** Tone mapping exposure the intensity was calibrated with. */
  exposure: 1,
  /** Half-angle of the cone in degrees, the `angle` of a three.js spot light. */
  cone: 34,
  penumbra: 1,
  decay: 2,
  color: THEME.lampLight,
  colorCold: THEME.lampCold,
  /** Ambient light in the room. */
  ambient: 0.08,
  /** An unshadowed point light at the lamp, as a share of the lamp's intensity: the bounce off the room. */
  bounce: 0.036,
  shadow: { mapSize: 2048, phoneMapSize: 1024, near: 1.75, far: 41, bias: -0.00028, normalBias: 0.012 },
  /** The band a paper card top must land in under the middle of the pool, in sRGB. */
  cardBand: [228, 245],
} as const;
