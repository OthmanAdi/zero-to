import { Color, PerspectiveCamera, Ray, Vector3, type Group, type Mesh, type MeshStandardMaterial } from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { THEME } from '../look/theme';
import { orbitDirection } from '../paper/motion';
import { heroPose, heroShot } from './camera';
import { draft, sampleRoadmap } from '../roadmap/testing';
import type { Roadmap } from '../roadmap/types';
import type { SceneEnvironment } from '../scene/contract';
import { COVER, COVER_EYE, COVER_REACH, FIELD_OFFSET } from './cover';
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

  it('keeps the room dark until the lamp lights it: the environment map, the sheets and the compass come up in turn', () => {
    const part = make({ sheets: sheets(5) });
    const mesh = (name: string): Mesh => part.object.getObjectByName(name) as Mesh;
    const cloth = mesh('table-cloth').material as MeshStandardMaterial;
    const wood = (mesh('table-top').material as MeshStandardMaterial[])[1] as MeshStandardMaterial;
    const cover = (mesh('sheet-3-map').material as MeshStandardMaterial[])[0] as MeshStandardMaterial;
    let brass: MeshStandardMaterial | null = null;
    part.compass.object.traverse((child) => {
      const material = (child as Mesh).material as MeshStandardMaterial | undefined;
      if (!brass && material && typeof material.envMapIntensity === 'number' && material.envMapIntensity > 0.5) brass = material;
    });
    const own = { cloth: cloth.envMapIntensity, wood: wood.envMapIntensity, brass: (brass as MeshStandardMaterial | null)?.envMapIntensity ?? 0 };
    expect(own.wood).toBeGreaterThan(0);
    expect(own.brass).toBeGreaterThan(0);
    const light = (material: MeshStandardMaterial): number => material.color.r + material.color.g + material.color.b;

    // The first frame: the lamp has hardly begun, so the room gives next to nothing, and no sheet can be read.
    run(part, FRAME);
    expect(part.roomLight).toBeLessThan(0.02);
    expect(wood.envMapIntensity).toBeLessThan(own.wood * 0.02);
    expect(cloth.envMapIntensity).toBeLessThan(own.cloth * 0.02);
    expect((brass as MeshStandardMaterial | null)?.envMapIntensity).toBe(0);
    expect(light(cover)).toBeLessThan(0.01);

    // The lamp is on before the table turns in; the sheets still lie in the dark, the compass is only rising.
    run(part, INTRO.hold - 0.1);
    expect(part.roomLight).toBe(1);
    expect(wood.envMapIntensity).toBeCloseTo(own.wood);
    expect(light(cover)).toBeLessThan(0.01);
    expect((brass as MeshStandardMaterial | null)?.envMapIntensity ?? 0).toBeLessThan(own.brass * 0.1);

    // Once the intro is over everything has its own light again.
    run(part, INTRO.end);
    expect(part.roomLight).toBe(1);
    expect(cloth.envMapIntensity).toBeCloseTo(own.cloth);
    expect(wood.envMapIntensity).toBeCloseTo(own.wood);
    expect((brass as MeshStandardMaterial | null)?.envMapIntensity).toBeCloseTo(own.brass);
    expect(light(cover)).toBeGreaterThan(0.1);
  });

  it('brings the sheets out of the dark only as the table turns in, so the lit roadmap is the first one read', () => {
    const part = make({ sheets: sheets(5) });
    /** The light a sheet keeps right now, read off its cover: printed covers are tinted grey, plain ones are the board. */
    const kept = (index: number): number => {
      const material = ((part.object.getObjectByName(`sheet-${index}-map`) as Mesh).material as MeshStandardMaterial[])[0] as MeshStandardMaterial;
      if (material.map) return material.color.r;
      return material.color.r / new Color(THEME.cover[part.sheetData(index)?.tier ?? 'gold']).r;
    };
    run(part, FRAME);
    for (let index = 0; index < 5; index += 1) expect(kept(index)).toBeLessThan(0.01);
    // Every other sheet that passes under the lamp on the way in stays dark while it passes.
    let passing = 0;
    let seen = 0;
    for (let frame = 0; frame < INTRO.grow / FRAME && Math.abs(part.phi) > 25; frame += 1) {
      run(part, FRAME);
      for (let index = 1; index < 5; index += 1) {
        const angle = ((((part.phi - index * 72) % 360) + 540) % 360) - 180;
        if (Math.abs(angle) < 20) {
          seen += 1;
          passing = Math.max(passing, kept(index));
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
    expect(passing).toBeLessThan(0.15);
    run(part, INTRO.end);
    expect(kept(0)).toBeCloseTo(1, 2);
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

  it('stops turning by itself for the visit once somebody presses a key; Tab and a lone modifier do not count', () => {
    const gallery = make({ sheets: sheets(5), intro: false, autoTurn: true });
    for (const key of ['Tab', 'Shift', 'Control']) document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    expect(gallery.acted).toBe(false);
    run(gallery, AUTO_TURN.first + 0.2);
    expect(gallery.selected).toBe(1);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }));
    expect(gallery.acted).toBe(true);
    expect(gallery.autoTurning).toBe(false);
    run(gallery, 30);
    expect(gallery.selected).toBe(1);
    // The host's switch does not undo it.
    gallery.setAutoTurn(true);
    run(gallery, 30);
    expect(gallery.selected).toBe(1);
  });

  it('waits while a control holds the keyboard focus, so what that control points at does not change under it', () => {
    const button = document.createElement('button');
    document.body.append(button);
    try {
      const gallery = make({ sheets: sheets(5), intro: false, autoTurn: true });
      button.focus();
      expect(document.activeElement).toBe(button);
      run(gallery, 30);
      expect(gallery.selected).toBe(0);
      expect(gallery.acted).toBe(false);
      button.blur();
      run(gallery, AUTO_TURN.afterHover - 0.2);
      expect(gallery.selected).toBe(0);
      run(gallery, 0.4);
      expect(gallery.selected).toBe(1);
    } finally {
      button.remove();
    }
  });

  it('stays on the roadmap somebody went into: back from the walk, the table never turns by itself', () => {
    const gallery = make({ sheets: sheets(5), intro: false, autoTurn: true });
    run(gallery, 1);
    gallery.setExit(0.3);
    expect(gallery.acted).toBe(true);
    // The walk: scene time runs on far past the next turn.
    run(gallery, 20);
    gallery.setExit(0);
    run(gallery, 40);
    expect(gallery.selected).toBe(0);
  });

  it('puts the next turn off when the host asks, and watches no page when told not to', () => {
    const gallery = make({ sheets: sheets(5), intro: false, autoTurn: true, watch: null });
    run(gallery, 1);
    gallery.holdAutoTurn(10);
    run(gallery, 9.8);
    expect(gallery.selected).toBe(0);
    run(gallery, 0.4);
    expect(gallery.selected).toBe(1);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(gallery.acted).toBe(false);
    gallery.act();
    expect(gallery.autoTurning).toBe(false);
  });

  it('is seen by the hero camera from where the cover reckons it (COVER_EYE), and no window looks much flatter', () => {
    const desk = createTable({ envMap: null, maxTexture: 2048, phone: false }, { sheets: sheets(5), intro: false, lang: 'en', pixelRatio: 1, watch: null });
    try {
      desk.update({ dt: FRAME, t: FRAME, reduced: false });
      desk.object.updateMatrixWorld(true);
      const mount = desk.mapRoot(0) as Group;
      const eyeAt = (width: number, height: number): Vector3 => {
        const pose = heroPose(desk.framePoints(), width, height);
        const shot = heroShot(width, height);
        const toward = orbitDirection(shot.elevation, shot.yaw);
        const eye = new Vector3(pose.target.x + toward.x * pose.distance, pose.target.y + toward.y * pose.distance, pose.target.z + toward.z * pose.distance);
        return mount.worldToLocal(eye);
      };
      const desktop = eyeAt(1440, 900);
      expect(desktop.x).toBeCloseTo(COVER_EYE.x, 1);
      expect(Math.abs(desktop.y - COVER_EYE.y)).toBeLessThan(0.2);
      expect(Math.abs(desktop.z - COVER_EYE.z)).toBeLessThan(0.2);
      // How flat a window looks onto the far edge of the field: run over rise. The cover's margin covers the rest.
      const farEdge = FIELD_OFFSET - COVER.field / 2;
      const flatness = (eye: { x: number; y: number; z: number }): number => (eye.z - farEdge) / eye.y;
      for (const [width, height] of [
        [1280, 720],
        [1920, 1080],
        [2560, 1080],
        [1366, 768],
        [800, 900],
        [1024, 1366],
        [390, 844],
      ] as const) {
        expect(flatness(eyeAt(width, height)), `${width} by ${height}`).toBeLessThanOrEqual(flatness(COVER_EYE) * COVER_REACH.margin);
      }
    } finally {
      desk.dispose();
    }
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

  it('holds the lit mountain flat for the way back from a walk, and grows it again when let go', () => {
    const part = make({ sheets: sheets(5), intro: false });
    run(part, 0.5);
    expect(part.grow).toBe(1);
    expect(part.flat).toBe(false);
    const stood: number[] = [];
    part.onStand((index) => stood.push(index));

    // Laid down at once: no sinking, no pin, no mountain standing, and the lamp off its rake.
    part.holdFlat(true, true);
    expect(part.flat).toBe(true);
    expect(part.grow).toBe(0);
    expect(part.standing).toBe(-1);
    expect(part.height).toBe(0);
    run(part, 2);
    // Held: a still table does not grow it, the dive's exit does not raise it, a turn and back changes nothing.
    expect(part.grow).toBe(0);
    part.setExit(EXIT.mountain.to);
    run(part, 0.3);
    expect(part.grow).toBe(0);
    part.setExit(0);
    expect(stood).toEqual([-1]);
    const camera = new PerspectiveCamera(32, 1.6, 0.1, 200);
    camera.position.set(0, 14, 24);
    camera.lookAt(0, 0.5, 3);
    camera.updateMatrixWorld(true);
    part.object.updateMatrixWorld(true);
    expect(part.pinScreen(camera).visible).toBe(false);

    // Let go: it grows in its usual 1.25 s and the pin stands again.
    part.holdFlat(false);
    run(part, 0.6);
    expect(part.standing).toBe(0);
    expect(part.grow).toBeGreaterThan(0.2);
    expect(part.grow).toBeLessThan(1);
    run(part, 1.4);
    expect(part.grow).toBe(1);
    part.object.updateMatrixWorld(true);
    expect(part.pinScreen(camera).visible).toBe(true);
    expect(stood).toEqual([-1, 0]);
  });

  it('lets a held mountain sink on its own when it is not laid down at once', () => {
    const part = make({ sheets: sheets(5), intro: false });
    run(part, 0.5);
    part.holdFlat(true);
    run(part, 0.1);
    expect(part.grow).toBeGreaterThan(0);
    expect(part.grow).toBeLessThan(1);
    run(part, 1.2);
    expect(part.grow).toBe(0);
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
