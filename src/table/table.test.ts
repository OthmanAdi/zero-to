import { PerspectiveCamera, Ray, Vector3 } from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { draft, sampleRoadmap } from '../roadmap/testing';
import type { Roadmap } from '../roadmap/types';
import type { SceneEnvironment } from '../scene/contract';
import { FIELD_OFFSET } from './cover';
import type { ReadoutParts } from './readout';
import type { SheetSpec } from './sheet-data';
import { AUTO_TURN, EXIT, INTRO, createTable, type TablePart } from './table';
import { TURN } from './turntable';

// No WebGL here: the table is built without textures and never drawn. Its state machine runs all the same.
const ENVIRONMENT: SceneEnvironment = { envMap: null, maxTexture: 1024, phone: true };
const FRAME = 1 / 60;

function sheets(count: number): SheetSpec[] {
  const tiers = ['gold', 'silver', 'bronze', 'diamond', 'gold', 'silver', 'bronze'] as const;
  return Array.from({ length: count }, (_, index) => {
    const roadmap = draft();
    roadmap.id = `road-${index}`;
    roadmap.title = `Roadmap ${index + 1}`;
    roadmap.brief.targetTier = tiers[index % tiers.length];
    roadmap.map = { terrain: 'massif', trail: 'switchback', seed: `seed-${index}` };
    return { roadmap: (index === 0 ? sampleRoadmap() : roadmap) as Roadmap, example: index !== 0 };
  });
}

let clock = 0;
let table: TablePart | null = null;

function make(options: Parameters<typeof createTable>[1] = {}): TablePart {
  clock = 0;
  table = createTable(ENVIRONMENT, { lang: 'en', pixelRatio: 1, ...options });
  return table;
}

function run(part: TablePart, seconds: number, reduced = false): void {
  const frames = Math.round(seconds / FRAME);
  for (let i = 0; i < frames; i += 1) {
    clock += FRAME;
    part.update({ dt: FRAME, t: clock, reduced });
  }
}

afterEach(() => {
  table?.dispose();
  table = null;
});

// Every test cuts real mountains; on a busy machine that takes longer than the default five seconds.
describe('createTable', { timeout: 60_000 }, () => {
  it('lays the sheets out and lights the roadmap that was opened', () => {
    const part = make({ sheets: sheets(5), intro: false });
    expect(part.ready).toBe(true);
    expect(part.count).toBe(5);
    expect(part.selected).toBe(0);
    expect(part.standing).toBe(0);
    expect(part.grow).toBe(1);
    expect(part.readout?.hours).toBe(42);
    expect(part.readout?.line).toBe('20 cards · 5 stages · to Gold');
    expect(part.sheetData(0)?.roadmap.id).toBe('rust-for-a-python-dev');
    expect(part.mapRoot(4)).not.toBeNull();
    expect(part.mapRoot(5)).toBeNull();
  });

  it('holds at most seven sheets', () => {
    const part = make({ sheets: sheets(7), intro: false });
    expect(part.count).toBe(7);
    part.setSheets([...sheets(7), ...sheets(3)]);
    expect(part.count).toBe(TURN.maxSheets);
  });

  it('turns to a picked sheet: the old mountain sinks, the new one grows when the table has settled', () => {
    const part = make({ sheets: sheets(5), intro: false });
    run(part, 0.2);
    const stood: number[] = [];
    const picked: [number, string][] = [];
    part.onStand((index) => stood.push(index));
    part.onSelect((index, by) => picked.push([index, by]));

    expect(part.next()).toBe(true);
    // The selection and the readout answer at once; the mountain waits for the table.
    expect(part.selected).toBe(1);
    expect(picked).toEqual([[1, 'person']]);
    expect(stood).toEqual([-1]);
    expect(part.readout?.sheet).toBe(1);
    expect(part.readout?.hours).toBe(0);

    run(part, 0.9);
    expect(part.standing).toBe(-1);
    expect(part.grow).toBe(0);
    run(part, 0.6);
    expect(part.standing).toBe(1);
    expect(part.grow).toBeGreaterThan(0);
    expect(part.grow).toBeLessThan(1);
    run(part, 1.4);
    expect(part.grow).toBe(1);
    expect(part.phi).toBeCloseTo(72, 1);
    expect(stood).toEqual([-1, 1]);
    expect(part.readout?.hours).toBeGreaterThan(0);
    expect(part.height).toBeGreaterThan(0.5);
  });

  it('counts the hours up while the mountain grows and writes the readout only when it changes', () => {
    const part = make({ sheets: sheets(5), intro: false });
    run(part, 0.2);
    part.next();
    const seen: ReadoutParts[] = [];
    part.onReadout((parts) => seen.push(parts));
    run(part, 3.5);
    const hours = seen.map((parts) => parts.hours);
    for (let i = 1; i < hours.length; i += 1) expect(hours[i]).toBeGreaterThanOrEqual(hours[i - 1] as number);
    expect(new Set(seen.map((parts) => parts.key)).size).toBe(seen.length);
    const settled = seen.length;
    run(part, 1);
    expect(seen.length).toBe(settled);
  });

  it('plays the intro: the table turns in, then the lit sheet grows from 2.05 s', () => {
    const part = make({ sheets: sheets(5) });
    run(part, 0.3);
    expect(part.phi).toBeCloseTo(TURN.introFrom, 3);
    expect(part.standing).toBe(-1);
    run(part, INTRO.grow - 0.3 - 0.1);
    expect(part.standing).toBe(-1);
    expect(part.grow).toBe(0);
    run(part, 0.4);
    expect(part.standing).toBe(0);
    run(part, 2);
    expect(part.grow).toBe(1);
    expect(Math.abs(part.phi)).toBeLessThan(0.1);
  });

  it('holds still under reduced motion and answers a pick at once', () => {
    const part = make({ sheets: sheets(5) });
    run(part, 0.5, true);
    const before = { phi: part.phi, grow: part.grow, height: part.height, standing: part.standing };
    expect(before.phi).toBe(0);
    expect(before.grow).toBe(1);
    expect(before.standing).toBe(0);
    run(part, 1, true);
    expect({ phi: part.phi, grow: part.grow, height: part.height, standing: part.standing }).toEqual(before);
    part.select(2);
    run(part, FRAME * 2, true);
    expect(part.phi).toBeCloseTo(144);
    expect(part.standing).toBe(2);
    expect(part.grow).toBe(1);
  });

  it('turns by itself only when asked to, first after 6.2 s, and waits 14 s after a person picked', () => {
    const own = make({ sheets: sheets(5), intro: false });
    run(own, 20);
    expect(own.selected).toBe(0);
    own.dispose();

    const gallery = make({ sheets: sheets(5), intro: false, autoTurn: true });
    run(gallery, AUTO_TURN.first - 0.2);
    expect(gallery.selected).toBe(0);
    run(gallery, 0.4);
    expect(gallery.selected).toBe(1);
    run(gallery, AUTO_TURN.every + 0.2);
    expect(gallery.selected).toBe(2);
    gallery.select(0);
    run(gallery, AUTO_TURN.afterPick - 0.5);
    expect(gallery.selected).toBe(0);
    run(gallery, 1);
    expect(gallery.selected).toBe(1);
  });

  it('hands the camera the lit sheet, its mountain and the compass, wherever the table is', () => {
    const part = make({ sheets: sheets(5), intro: false });
    const points = part.framePoints();
    expect(points.length).toBe(14);
    const corners = points.slice(0, 4);
    expect(corners.reduce((sum, p) => sum + p.x, 0)).toBeCloseTo(0);
    expect(corners.reduce((sum, p) => sum + p.z, 0) / 4).toBeCloseTo(TURN.radius);
    expect(Math.max(...points.map((p) => p.y))).toBeCloseTo(part.compass.topY);
    part.next();
    run(part, 0.4);
    expect(part.framePoints()).toEqual(points);
  });

  it('finds the card, the lit sheet and a sheet at the edge under a ray, and selects on a click', () => {
    const part = make({ sheets: sheets(5), intro: false });
    run(part, 0.2);
    part.object.updateMatrixWorld(true);
    const down = new Vector3(0, -1, 0);
    const summit = part.sheetData(0);
    expect(summit).not.toBeNull();

    const onField = part.hover(new Ray(new Vector3(0, 10, TURN.radius + FIELD_OFFSET), down));
    expect(onField.kind).toBe('card');
    expect(onField.card).toBeGreaterThanOrEqual(0);
    expect(onField.stage).toBeGreaterThanOrEqual(0);

    const onCover = part.hover(new Ray(new Vector3(0, 10, TURN.radius - 2.5), down));
    expect(onCover.kind).toBe('lit');

    const angle = (-72 * Math.PI) / 180;
    const edge = new Ray(new Vector3(Math.sin(angle) * TURN.radius, 10, Math.cos(angle) * TURN.radius), down);
    expect(part.hover(edge)).toMatchObject({ kind: 'sheet', sheet: 1 });
    expect(part.hover(new Ray(new Vector3(0, 10, 0), down)).kind).toBe('none');

    const entered: number[] = [];
    part.onEnter((enter) => entered.push(enter.stage));
    part.click(new Ray(new Vector3(0, 10, TURN.radius - 2.5), down));
    expect(entered).toEqual([-1]);
    part.click(edge);
    expect(part.selected).toBe(1);
  });

  it('names the stage of the card under the pointer after a moment, and lets go after the pointer left', () => {
    const part = make({ sheets: sheets(5), intro: false });
    run(part, 0.2);
    part.object.updateMatrixWorld(true);
    const ray = new Ray(new Vector3(0.4, 10, TURN.radius + FIELD_OFFSET + 0.3), new Vector3(0, -1, 0));
    part.hover(ray, 0);
    run(part, 0.04);
    expect(part.readout?.card).toBeNull();
    run(part, 0.1);
    expect(part.readout?.card).not.toBeNull();
    expect(part.readout?.line).toMatch(/^Card \d+ of 20 · Stage \d · /);
    part.hover(null);
    run(part, 0.3);
    expect(part.readout?.card).not.toBeNull();
    run(part, 0.3);
    expect(part.readout?.card).toBeNull();
  });

  it('clears the table for the dive: the compass leaves and the other sheets slide out', () => {
    const part = make({ sheets: sheets(5), intro: false });
    run(part, 0.2);
    const neighbour = part.mapRoot(1);
    const before = neighbour?.getWorldPosition(new Vector3()).length() ?? 0;
    part.setExit(EXIT.sheets.to + 0.01);
    run(part, 0.2);
    part.object.updateMatrixWorld(true);
    expect(part.compass.object.visible).toBe(false);
    expect(neighbour?.getWorldPosition(new Vector3()).length() ?? 0).toBeGreaterThan(before + 5);
    expect(part.standing).toBe(0);
    part.setExit(0);
    run(part, 0.2);
    expect(part.compass.object.visible).toBe(true);
  });

  it('projects the pin and the anchors of the overlay', () => {
    const part = make({ sheets: sheets(5), intro: false });
    run(part, 0.5);
    const camera = new PerspectiveCamera(32, 1.6, 0.1, 200);
    camera.position.set(0, 14, 24);
    camera.lookAt(0, 0.5, 3);
    camera.updateMatrixWorld(true);
    part.object.updateMatrixWorld(true);
    const pin = part.pinScreen(camera);
    expect(pin.visible).toBe(true);
    expect(Math.abs(pin.x)).toBeLessThan(1);
    expect(Math.abs(pin.y)).toBeLessThan(1);
    expect(part.anchor('arrowPrevious').x).toBeLessThan(part.anchor('arrowNext').x);
    expect(part.anchor('enter').z).toBeLessThan(part.anchor('sheet').z);
    expect(part.anchor('pin').distanceTo(part.anchor('sheet'))).toBeLessThan(3);
  });

  it('keeps few mountains alive and still shows every sheet', () => {
    const part = make({ sheets: sheets(5), intro: false });
    for (let i = 0; i < 5; i += 1) {
      part.next();
      run(part, 4.5);
    }
    let mountains = 0;
    part.object.traverse((child) => {
      if (child.name === 'mountain') mountains += 1;
    });
    expect(mountains).toBeLessThanOrEqual(3);
    expect(part.selected).toBe(0);
    expect(part.grow).toBe(1);
  });
});
