import { describe, expect, it } from 'vitest';
import { backDevice, canvasSize, coverPlan, labelBox, MAX_SIDE, spinePlan, spineTitleLength, TITLE_ROOM, type LookGeometry } from './layout';

const PAPER: LookGeometry = { spineGap: 0.14, spineMark: false, markBlock: false, platePanel: false, boardLine: false };
const POCKET: LookGeometry = { spineGap: 0.2, spineMark: true, markBlock: true, platePanel: true, boardLine: false };
const OAK: LookGeometry = { ...PAPER, boardLine: true };

describe('canvas size', () => {
  it('multiplies by the density and rounds', () => {
    expect(canvasSize(206, 340, 2)).toEqual({ width: 412, height: 680, scaleX: 2, scaleY: 2 });
    const odd = canvasSize(58.3, 340, 1.5);
    expect(odd.width).toBe(87);
    expect(odd.scaleX).toBeCloseTo(87 / 58.3, 6);
  });

  it('clamps the longest side to 2048 and keeps the pixels square', () => {
    const size = canvasSize(1000, 3000, 2.5);
    expect(size.height).toBe(MAX_SIDE);
    expect(size.width).toBe(683);
    expect(size.scaleX).toBeCloseTo(size.scaleY, 2);
  });

  it('falls back to one device px per CSS px for a density it cannot use', () => {
    expect(canvasSize(10, 20, Number.NaN)).toMatchObject({ width: 10, height: 20 });
    expect(canvasSize(10, 20, -1)).toMatchObject({ width: 10, height: 20 });
    expect(canvasSize(0, 0, 2)).toMatchObject({ width: 2, height: 2 });
  });
});

describe('spine plan', () => {
  it('stacks the parts from head to tail as the flex column in shelf.css', () => {
    const plan = spinePlan(58, 340, PAPER);
    expect(plan.done.y).toBeCloseTo(11.6, 6);
    expect(plan.done.height).toBeCloseTo(11.6, 6);
    expect(plan.mark).toBeNull();
    expect(plan.rules[0].y).toBeCloseTo(11.6 + 11.6 + 8.12, 6);
    expect(plan.rules[0].width).toBeCloseTo(58 * 0.62, 6);
    expect(plan.device.height).toBeCloseTo(25.52, 6);
    expect(plan.device.y + plan.device.height).toBeCloseTo(340 - 11.6, 6);
    // Head padding, check, rule, title, rule, device and tail padding fill the spine with four gaps.
    const filled = 11.6 * 2 + 11.6 + 4 + plan.title.height + 4 + 25.52 + 4 * 8.12;
    expect(filled).toBeCloseTo(340, 6);
  });

  it('keeps room for a numbered block at the head when the look prints one', () => {
    const plan = spinePlan(36, 300, POCKET);
    expect(plan.mark).not.toBeNull();
    expect(plan.mark!.size).toBe(9);
    expect(plan.mark!.rect.height).toBeCloseTo(9 * 1.45, 6);
    expect(plan.mark!.rect.y).toBeCloseTo(7.2 + 10 + 7.2, 6);
  });

  it('gives the title the room the shelf fits it to, less a label inset', () => {
    const plan = spinePlan(58, 340, PAPER);
    expect(spineTitleLength(plan, 58, false)).toBeCloseTo(plan.title.height * TITLE_ROOM, 6);
    expect(spineTitleLength(plan, 58, true)).toBeCloseTo(plan.title.height * TITLE_ROOM - 2 * 0.16 * 58, 6);
  });
});

describe('cover plan', () => {
  const W = 206;
  const H = 340;
  const c = W / 100;

  it('lays out a plate cover on the grid of cover.css', () => {
    const plan = coverPlan('plate', W, H, PAPER);
    expect(plan.head).toEqual({ x: 12 * c, y: 10 * c, width: 79 * c, height: 0.47 * H - 10 * c });
    expect(plan.plate.y).toBe(0.5 * H);
    expect(plan.plate.y + plan.plate.height).toBeCloseTo(H - 14 * c, 6);
    expect(plan.art.y).toBeCloseTo(0.5 * H + 1 + 5 * c, 6);
    expect(plan.rule).toBe(true);
    expect(plan.foot).toEqual({ x: 12 * c, width: 79 * c, bottom: H - 5 * c, align: 'start' });
  });

  it('prints Pocket plates as a panel running off both edges', () => {
    const plan = coverPlan('plate', 190, 300, POCKET);
    expect(plan.panel).toBe(true);
    expect(plan.plate.x).toBe(0);
    expect(plan.plate.width).toBe(190);
    expect(plan.art.width).toBeCloseTo(190 - 21 * 1.9, 6);
  });

  it('sizes a label to its type between its least and greatest height, standing on the 47 % line', () => {
    const plan = coverPlan('label', W, H, PAPER);
    const label = plan.label!;
    expect(labelBox(label, 10).height).toBeCloseTo(0.29 * H, 6);
    expect(labelBox(label, 1000).height).toBeCloseTo(0.47 * H - 6 * c, 6);
    const mid = labelBox(label, 90);
    expect(mid.height).toBeCloseTo(90 + 11 * c, 6);
    expect(mid.y + mid.height).toBeCloseTo(0.47 * H, 6);
    expect(plan.head.width).toBeCloseTo(65 * c, 6);
  });

  it('frames a frame cover with a double rule and centres its type', () => {
    const plan = coverPlan('frame', W, H, PAPER);
    expect(plan.align).toBe('center');
    expect(plan.frames).toHaveLength(2);
    expect(plan.frames[0]!.rect).toEqual({ x: 11 * c, y: 6 * c, width: W - 17 * c, height: H - 12 * c });
    expect(plan.frames[1]!.rect.x - plan.frames[0]!.rect.x).toBeCloseTo(1.6 * c + 1, 6);
    expect(plan.frames[1]!.line).toBe(0.5);
    expect(plan.head.width).toBeCloseTo(67 * c, 6);
  });

  it('prints a band across the head and sets the title under it', () => {
    const plan = coverPlan('band', W, H, PAPER);
    expect(plan.plate).toEqual({ x: 0, y: 0, width: W, height: 0.47 * H });
    expect(plan.panel).toBe(true);
    expect(plan.head.y).toBeCloseTo(0.47 * H + 8 * c, 6);
  });

  it('adds Oak Library’s tooled line round every board but a frame cover', () => {
    expect(coverPlan('plate', 204, 300, OAK).frames.filter((frame) => frame.blind)).toHaveLength(1);
    expect(coverPlan('frame', 204, 300, OAK).frames.filter((frame) => frame.blind)).toHaveLength(0);
  });

  it('leaves the foot off a small cover and all type off a thumbnail, as the container queries do', () => {
    expect(coverPlan('plate', 160, 264, PAPER).foot).toBeNull();
    expect(coverPlan('plate', 160, 264, PAPER).authorSize).toBe(9);
    expect(coverPlan('plate', 110, 180, PAPER).type).toBe(false);
  });

  it('sets the back board’s device near its foot, inside the board', () => {
    const device = backDevice(W, H);
    expect(device.y + device.height).toBeCloseTo(H - 9 * c, 6);
    expect(device.x).toBeGreaterThan(0);
    expect(device.x + device.width).toBeLessThan(W);
  });
});
