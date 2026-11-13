import type { PaintedFace, Stamp } from '../types';
import { backDevice } from './layout';
import type { Palette } from './look';
import { createPen, finish, mark } from './pen';
import { paintDevice, type DeviceShape } from './spine';

export interface BackJob {
  shape: DeviceShape;
  initial: string;
  palette: Palette;
  serif: string;
  stamp: Stamp;
  width: number;
  height: number;
  density: number;
}

/**
 * The back board, seen from outside with the spine at its right edge: plain cloth and the site's device
 * pressed blind near the foot. Only a blind stamp puts it on the mask; under foil it stays a quiet
 * shade of the cloth rather than a second gold mark.
 */
export function paintBack(job: BackJob): PaintedFace {
  const { palette, width, height } = job;
  const pen = createPen(width, height, job.density);
  mark(pen, { colour: palette.ground, stamped: false }, (ctx) => ctx.fillRect(0, 0, width, height));
  const rect = backDevice(width, height);
  paintDevice(
    pen,
    rect,
    job.shape,
    job.initial,
    { colour: palette.backDevice, stamped: job.stamp === 'blind' },
    palette.ground,
    { family: job.serif, size: Math.max(6, rect.width * 0.59) },
  );
  return finish(pen);
}
