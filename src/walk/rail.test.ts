import { describe, expect, it } from 'vitest';
import { projectToScreen, type CameraPose, type Vec3 } from '../paper/motion';
import { PANEL } from './fold';
import { LANDING, RAIL, cameraAt, followShift, landingPose, panelLeft, panelPoints, railPoses, shiftPose } from './rail';
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

  /** Every corner of every panel and of the legend, which lies open left of panel 0 and is as wide as a panel. */
  const mapCorners = (n: number): Vec3[] => {
    const corners: Vec3[] = [];
    for (let index = -1; index < n; index += 1) {
      for (const x of [panelLeft(index), panelLeft(index) + PANEL.width]) for (const z of [-PANEL.depth / 2, PANEL.depth / 2]) corners.push({ x, y: 0, z });
    }
    return corners;
  };

  it('keeps the whole map, the legend too, inside the wide shot', () => {
    for (const aspect of [1440 / 900, 2.4, 390 / 844]) {
      for (const n of [2, 5, 8]) {
        const wide = railPoses(n, aspect)[n + 1] as CameraPose;
        for (const corner of mapCorners(n)) expect(inside(wide, corner, aspect, 0), `${aspect} ${n} ${corner.x},${corner.z}`).toBe(true);
      }
    }
  });

  it('fills the stretch between the finale actions and the profile strip on a phone', () => {
    // The overlays of a 390 by 844 phone: the profile strip takes 184 px from the bottom, of which the director
    // hands 0.6 to the rail, and the finale's actions end 372 px from the top.
    const aspect = 390 / 844;
    const bottom = ((2 * 184) / 844) * 0.6;
    const actions = 1 - (2 * 372) / 844;
    const strip = 1 - (2 * 660) / 844;
    for (const n of [2, 5, 8]) {
      const wide = railPoses(n, aspect, { bottom })[n + 1] as CameraPose;
      const screen = mapCorners(n).map((corner) => projectToScreen(wide, corner, aspect));
      const top = Math.max(...screen.map((point) => point.y));
      const low = Math.min(...screen.map((point) => point.y));
      expect(top, `${n} panels`).toBeLessThanOrEqual(actions);
      expect(low, `${n} panels`).toBeGreaterThanOrEqual(strip);
      // At least 30 percent of the window's height: the screen is 2 high.
      expect(top - low, `${n} panels`).toBeGreaterThanOrEqual(0.6);
      for (const point of screen) expect(Math.abs(point.x)).toBeLessThanOrEqual(1);
    }
  });
});

describe('followShift', () => {
  const aspect = 390 / 844;
  const bottom = (2 * 152) / 844;

  it('shows a panel larger than a narrow window and keeps the walker in the picture', () => {
    const n = 5;
    const poses = railPoses(n, aspect, { bottom });
    for (let index = 0; index < n; index += 1) {
      const pose = poses[index + 1] as CameraPose;
      const left = panelLeft(index);
      // The front edge of the panel is wider than the window, which is 2 wide: the trail is not shrunk to fit a whole panel.
      const frontLeft = projectToScreen(pose, { x: left, y: 0, z: PANEL.depth / 2 }, aspect);
      const frontRight = projectToScreen(pose, { x: left + PANEL.width, y: 0, z: PANEL.depth / 2 }, aspect);
      expect(frontRight.x - frontLeft.x).toBeGreaterThan(2.4);
      // Wherever the walker stands on the panel, the camera has gone along far enough to show him.
      for (let step = 0; step <= 20; step += 1) {
        const walkerX = left + (PANEL.width * step) / 20;
        const followed = shiftPose(pose, followShift(index + 1, n, walkerX));
        for (const z of [0.4, 1.2, 2]) {
          const screen = projectToScreen(followed, { x: walkerX, y: 0.2, z }, aspect);
          expect(Math.abs(screen.x), `panel ${index}, walker at ${walkerX.toFixed(2)}, ${z}`).toBeLessThan(0.9);
          expect(screen.y).toBeGreaterThan(RAIL.panel.narrowBox.y0 + bottom);
          expect(screen.y).toBeLessThan(RAIL.panel.narrowBox.y1);
        }
      }
    }
  });

  it('does not move the shots of the whole map', () => {
    const n = 5;
    expect(followShift(0, n, 3)).toBeCloseTo(0, 12);
    expect(followShift(n + 1, n, 3)).toBeCloseTo(0, 12);
    expect(followShift(n + 2, n, 3)).toBeCloseTo(0, 12);
    // In the middle of a panel there is nothing to follow.
    expect(followShift(3, n, 2 * PANEL.width)).toBeCloseTo(0, 12);
  });

  it('carries the camera over a crease without a jump', () => {
    const n = 5;
    const poses = railPoses(n, aspect);
    // The walker waits at the crease between two panels while the rail crosses from one to the next.
    const walkerX = panelLeft(2) + PANEL.width;
    let previous = shiftPose(cameraAt(2, poses), followShift(2, n, walkerX));
    for (let step = 1; step <= 400; step += 1) {
      const rail = 2 + step / 400;
      const pose = shiftPose(cameraAt(rail, poses), followShift(rail, n, walkerX));
      expect(Math.abs(pose.position.x - previous.position.x)).toBeLessThan(0.02);
      previous = pose;
    }
  });

  it('moves a pose sideways and leaves where it looks alone', () => {
    const pose = railPoses(3, aspect)[2] as CameraPose;
    const moved = shiftPose(pose, 0.7);
    expect(moved.position.x - pose.position.x).toBeCloseTo(0.7, 12);
    expect(moved.target.x - pose.target.x).toBeCloseTo(0.7, 12);
    expect(moved.position.y).toBe(pose.position.y);
    expect(moved.target.z).toBe(pose.target.z);
    expect(moved.distance).toBe(pose.distance);
    expect(moved.fov).toBe(pose.fov);
    expect(shiftPose(pose, 0)).toBe(pose);
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
