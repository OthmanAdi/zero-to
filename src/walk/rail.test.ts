import { describe, expect, it } from 'vitest';
import { projectToScreen, type CameraPose, type Vec3 } from '../paper/motion';
import { PANEL } from './fold';
import { LANDING, RAIL, cameraAt, landingPose, panelLeft, panelPoints, railPoses } from './rail';
import { railAt } from './timeline';

function inside(pose: CameraPose, point: Vec3, aspect: number, slack = 0.03): boolean {
  const screen = projectToScreen(pose, point, aspect);
  return screen.z > 0 && Math.abs(screen.x) <= 1 + slack && Math.abs(screen.y) <= 1 + slack;
}

describe('railPoses', () => {
  it('has a pose for the shut map, one per panel, the whole map and the shut map again', () => {
    for (const n of [2, 5, 8]) {
      const poses = railPoses(n, 1.6);
      expect(poses).toHaveLength(n + 3);
      expect(poses[n + 2]?.position).toEqual(poses[0]?.position);
      expect(poses[n + 2]?.target).toEqual(poses[0]?.target);
    }
  });

  it('fits every panel into its box, on a desktop and on a phone', () => {
    for (const aspect of [1.6, 2.4, 390 / 844]) {
      for (const n of [2, 5, 8]) {
        const poses = railPoses(n, aspect);
        const narrow = aspect < RAIL.narrowAspect;
        const box = narrow ? RAIL.panel.narrowBox : RAIL.panel.box;
        for (let index = 0; index < n; index += 1) {
          const pose = poses[index + 1] as CameraPose;
          for (const point of panelPoints(index)) {
            const screen = projectToScreen(pose, point, aspect);
            expect(screen.z).toBeGreaterThan(0);
            expect(screen.x).toBeGreaterThanOrEqual(box.x0 - 0.02);
            expect(screen.x).toBeLessThanOrEqual(box.x1 + 0.02);
            expect(screen.y).toBeGreaterThanOrEqual(box.y0 - 0.02);
            expect(screen.y).toBeLessThanOrEqual(box.y1 + 0.02);
          }
          expect(pose.fov).toBe(narrow ? RAIL.panel.narrowFov : RAIL.panel.fov);
        }
        // The wide shot shows every panel.
        const wide = poses[n + 1] as CameraPose;
        for (let index = 0; index < n; index += 1) {
          for (const z of [-PANEL.depth / 2, PANEL.depth / 2]) {
            expect(inside(wide, { x: panelLeft(index), y: 0, z }, aspect)).toBe(true);
            expect(inside(wide, { x: panelLeft(index) + PANEL.width, y: 0, z }, aspect)).toBe(true);
          }
        }
        // The shut map lies whole in its shot.
        for (const x of [-PANEL.width / 2, PANEL.width / 2]) {
          for (const z of [-PANEL.depth / 2, PANEL.depth / 2]) expect(inside(poses[0] as CameraPose, { x, y: 0, z }, aspect)).toBe(true);
        }
      }
    }
  });

  it('keeps the panel above what the overlays take from the bottom', () => {
    const aspect = 390 / 844;
    const bottom = (2 * 152) / 844;
    const pose = railPoses(5, aspect, { bottom })[1] as CameraPose;
    for (const point of panelPoints(0)) {
      expect(projectToScreen(pose, point, aspect).y).toBeGreaterThanOrEqual(RAIL.panel.narrowBox.y0 + bottom - 0.02);
    }
  });
});

describe('cameraAt', () => {
  it('is the pose itself at a whole rail position and hops between panels', () => {
    const poses = railPoses(5, 1.6);
    for (let index = 0; index < poses.length; index += 1) {
      const pose = cameraAt(index, poses);
      expect(pose.position.x).toBeCloseTo((poses[index] as CameraPose).position.x, 9);
      expect(pose.position.y).toBeCloseTo((poses[index] as CameraPose).position.y, 9);
      expect(pose.target.z).toBeCloseTo((poses[index] as CameraPose).target.z, 9);
    }
    const a = poses[2] as CameraPose;
    const b = poses[3] as CameraPose;
    const half = cameraAt(2.5, poses);
    expect(half.position.y).toBeCloseTo((a.position.y + b.position.y) / 2 + RAIL.hop, 9);
    expect(half.target.y).toBeCloseTo((a.target.y + b.target.y) / 2 + RAIL.hop * RAIL.hopLook, 9);
    expect(half.target.x).toBeCloseTo((a.target.x + b.target.x) / 2 + RAIL.lead, 9);
    // No hop on the way in from the shut map or out to the wide shot.
    const start = cameraAt(0.5, poses);
    expect(start.position.y).toBeCloseTo(((poses[0] as CameraPose).position.y + (poses[1] as CameraPose).position.y) / 2, 9);
    const out = cameraAt(5.5, poses);
    expect(out.position.y).toBeCloseTo(((poses[5] as CameraPose).position.y + (poses[6] as CameraPose).position.y) / 2, 9);
  });

  it('moves without a jump along the whole walk', () => {
    const poses = railPoses(8, 1.6);
    let previous = cameraAt(railAt(0, 8), poses);
    for (let step = 1; step <= 4000; step += 1) {
      const pose = cameraAt(railAt(step / 4000, 8), poses);
      const moved = Math.hypot(pose.position.x - previous.position.x, pose.position.y - previous.position.y, pose.position.z - previous.position.z);
      expect(moved).toBeLessThan(0.6);
      previous = pose;
    }
  });
});

describe('landingPose', () => {
  const stage = railPoses(5, 1.6)[1] as CameraPose;
  const spot = { x: -1.7, y: 0.1, z: 1.05 };
  const head = { x: spot.x, y: spot.y + 0.32, z: spot.z };
  const input = { spot, head, headDistance: 0.084, stage, fov: 32 };

  it('starts inside the head, nearly overhead, and ends in the stage shot', () => {
    const start = landingPose(0, input);
    expect(start.distance).toBeCloseTo(0.084, 9);
    expect(start.target).toEqual(head);
    const up = (start.position.y - head.y) / start.distance;
    expect(up).toBeCloseTo(Math.sin((LANDING.arrive.elevation * Math.PI) / 180), 9);
    expect(start.fov).toBe(32);
    const end = landingPose(1, input);
    expect(end.position.x).toBeCloseTo(stage.position.x, 9);
    expect(end.position.y).toBeCloseTo(stage.position.y, 9);
    expect(end.target.z).toBeCloseTo(stage.target.z, 9);
    expect(end.fov).toBe(stage.fov);
  });

  it('pulls back, drops to the eye level of the walker and rises again', () => {
    const pulled = landingPose(LANDING.pull.to, input);
    expect(pulled.distance).toBeCloseTo(LANDING.pull.distance, 6);
    const low = landingPose(0.42, input);
    const high = landingPose(LANDING.pull.to, input);
    expect(low.position.y).toBeLessThan(high.position.y);
    expect(low.position.y - spot.y).toBeLessThan(0.6);
    expect(landingPose(1, input).position.y).toBeGreaterThan(low.position.y);
    let previous = landingPose(0, input);
    for (let step = 1; step <= 500; step += 1) {
      const pose = landingPose(step / 500, input);
      expect(Math.hypot(pose.position.x - previous.position.x, pose.position.y - previous.position.y, pose.position.z - previous.position.z)).toBeLessThan(0.5);
      previous = pose;
    }
  });
});
