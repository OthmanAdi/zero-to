import { describe, expect, it } from 'vitest';
import german from '../roadmap/samples/deutsch-a1-von-null.json';
import langgraph from '../roadmap/samples/langgraph-for-a-python-dev.json';
import music from '../roadmap/samples/music-theory-for-a-class.json';
import photography from '../roadmap/samples/photography-basics.json';
import rust from '../roadmap/samples/rust-for-a-python-dev.json';
import statistics from '../roadmap/samples/statistics-for-data-work.json';
import type { Roadmap } from '../roadmap/types';
import { PANEL } from './fold';
import { LABEL, cardUnder, fitTitle, planLabels, type PanelLabel } from './labels';
import { CAIRN, cairnSpot, panelRoutePoints, planWalk, type PanelPlan } from './plan';
import { MODEL } from './strip';

const SAMPLES = [rust, german, photography, langgraph, music, statistics] as unknown as Roadmap[];
/** A plain measure for tests: every character half as wide as the type is tall. */
const measure = (text: string): number => Array.from(text).length * LABEL.size * 0.5;

const plans = SAMPLES.map((roadmap) => planWalk(structuredClone(roadmap), { phone: true }));

/** Every card of a panel under a rectangle, sampled as `cardUnder` does but with no look to the front. */
function cardsUnder(panel: PanelPlan, rect: PanelLabel['strip']): Set<number> {
  const cards = new Set<number>();
  for (let z = rect.z0; z <= rect.z1 + 1e-9; z += 0.01) for (let x = rect.x0; x <= rect.x1 + 1e-9; x += 0.01) cards.add(panel.cards.cardAt(x, z));
  return cards;
}

describe('waypoint labels', () => {
  it('gives every mark of every gallery sample one title and one mark, on the highest card under each', () => {
    for (const plan of plans) {
      for (const panel of plan.panels) {
        const labels = planLabels(panel, measure);
        expect(labels).toHaveLength(panel.marks.length);
        labels.forEach((label, index) => {
          const where = `${plan.roadmap.id}/${label.mark.waypoint.id}`;
          expect(label.mark).toBe(panel.marks[index]);
          // No card under the strip, or under the mark, stands higher than the one it lies on: no edge cuts it.
          for (const card of cardsUnder(panel, label.strip)) expect(card, where).toBeLessThanOrEqual(label.card);
          for (const card of cardsUnder(panel, label.dot)) expect(card, where).toBeLessThanOrEqual(label.dotCard);
          expect(label.card, where).toBe(cardUnder(panel, label.strip));
          // The strip holds the whole title and stays on the panel.
          expect(label.strip.x1 - label.strip.x0, where).toBeCloseTo(label.width + 2 * LABEL.pad, 9);
          expect(label.width, where).toBeLessThanOrEqual(LABEL.maxWidth + 1e-9);
          expect(label.strip.x0, where).toBeGreaterThanOrEqual(LABEL.edge - LABEL.pad - 1e-9);
          expect(label.strip.x1, where).toBeLessThanOrEqual(PANEL.width - LABEL.edge + LABEL.pad + 1e-9);
          // The mark's square is centred on the mark.
          expect((label.dot.x0 + label.dot.x1) / 2, where).toBeCloseTo(label.mark.x, 9);
          expect((label.dot.z0 + label.dot.z1) / 2, where).toBeCloseTo(label.mark.z, 9);
        });
      }
    }
  }, 120_000);

  it('keeps a title behind its mark clear of where the walker stops, and a title in front of it in front', () => {
    let behind = 0;
    for (const plan of plans) {
      for (const panel of plan.panels) {
        for (const label of planLabels(panel, measure)) {
          const where = `${plan.roadmap.id}/${label.mark.waypoint.id}`;
          if (label.below) {
            expect(label.strip.z0, where).toBeGreaterThan(label.mark.z);
          } else {
            behind += 1;
            expect(label.strip.z1, where).toBeLessThan(label.mark.z);
            // The walker stands on the mark: the strip lies on his left or his right, with room for his figure.
            const clear = label.strip.x1 <= label.mark.x - LABEL.clear + 1e-9 || label.strip.x0 >= label.mark.x + LABEL.clear - 1e-9;
            expect(clear, where).toBe(true);
          }
        }
      }
    }
    expect(behind).toBeGreaterThan(10);
  }, 120_000);

  it('keeps the titles off the route, the side trails, the other marks and each other, as the camera sees them', () => {
    // A thing lifted by the cards it stands on appears further back to a camera that looks down at 30 degrees.
    const lift = (card: number): number => (card + 1) * MODEL.thickness * LABEL.view;
    let crossings = 0;
    let titles = 0;
    for (const plan of plans) {
      for (const panel of plan.panels) {
        const labels = planLabels(panel, measure);
        const lines = [panelRoutePoints(panel), ...panel.marks.flatMap((mark) => (mark.spur ? [mark.spur.points] : []))];
        labels.forEach((label, index) => {
          const where = `${plan.roadmap.id}/${label.mark.waypoint.id}`;
          titles += 1;
          const { x0, x1 } = label.strip;
          const z0 = label.strip.z0 - lift(label.card);
          const z1 = label.strip.z1 - lift(label.card);
          const crosses = lines.some((line) =>
            line.some((point, k) => {
              const next = line[k + 1];
              if (!next) return false;
              for (let t = 0; t <= 1; t += 0.05) {
                const x = point.x + (next.x - point.x) * t;
                const ground = point.z + (next.z - point.z) * t;
                const z = ground - lift(panel.cards.cardAt(x, ground));
                if (x > x0 && x < x1 && z > z0 && z < z1) return true;
              }
              return false;
            }),
          );
          if (crosses) crossings += 1;
          labels.forEach((other, k) => {
            if (k === index) return;
            const meets = other.strip.x0 < x1 && x0 < other.strip.x1 && other.strip.z0 - lift(other.card) < z1 && z0 < other.strip.z1 - lift(other.card);
            expect(meets, `${where} meets ${other.mark.waypoint.id}`).toBe(false);
            const onMark = other.dot.x0 < x1 && x0 < other.dot.x1 && other.dot.z0 - lift(other.dotCard) < z1 && z0 < other.dot.z1 - lift(other.dotCard);
            expect(onMark, `${where} lies on the mark of ${other.mark.waypoint.id}`).toBe(false);
          });
        });
      }
    }
    // A crowded stretch may leave a title no free place; then it takes the one that crosses least, and a route
    // under a title is cheaper than a sign in front of it. Nearly all are free.
    expect(crossings / titles).toBeLessThanOrEqual(0.08);
  }, 120_000);

  it('keeps the titles out from behind the cairns, the stage board, the signpost and the camp', () => {
    const lift = (card: number): number => (card + 1) * MODEL.thickness * LABEL.view;
    let hidden = 0;
    let titles = 0;
    for (const plan of plans) {
      for (const panel of plan.panels) {
        // What a thing standing on the panel hides: the ground behind it, as far back as it is tall.
        const standing = (spot: { x: number; z: number }, half: number, height: number) => {
          const up = lift(panel.cards.cardAt(spot.x, spot.z));
          return { x0: spot.x - half, x1: spot.x + half, z0: spot.z - height * LABEL.view - up, z1: spot.z - up };
        };
        const tall = [
          ...panel.marks.filter((mark) => (mark.waypoint.checks?.length ?? 0) > 0).map((mark) => standing(cairnSpot(mark), CAIRN.half, CAIRN.height)),
          standing(panel.board, LABEL.tall.board.half, LABEL.tall.board.height),
          standing(panel.signpost, LABEL.tall.signpost.half, LABEL.tall.signpost.height),
          standing(panel.camp, LABEL.tall.camp.half, LABEL.tall.camp.height),
        ];
        for (const label of planLabels(panel, measure)) {
          titles += 1;
          const rect = { x0: label.strip.x0, x1: label.strip.x1, z0: label.strip.z0 - lift(label.card), z1: label.strip.z1 - lift(label.card) };
          const area = (rect.x1 - rect.x0) * (rect.z1 - rect.z0);
          const share = Math.max(0, ...tall.map((t) => (Math.max(0, Math.min(rect.x1, t.x1) - Math.max(rect.x0, t.x0)) * Math.max(0, Math.min(rect.z1, t.z1) - Math.max(rect.z0, t.z0))) / area));
          // A sign is far thinner than its box: a quarter of a title inside the box still reads.
          if (share > 0.25) hidden += 1;
        }
      }
    }
    expect(hidden / titles).toBeLessThanOrEqual(0.03);
  }, 120_000);

  it('shortens a long title with an ellipsis to the widest a title may be', () => {
    const long = 'A very long title for a waypoint that does not fit on one strip of paper at all';
    const short = fitTitle(long, LABEL.maxWidth, measure);
    expect(short.endsWith('…')).toBe(true);
    expect(measure(short)).toBeLessThanOrEqual(LABEL.maxWidth);
    expect(fitTitle('Find the pulse', LABEL.maxWidth, measure)).toBe('Find the pulse');
  });

  it('looks a little in front of a label for a card that would hide it', () => {
    const panel = plans[0]?.panels[0] as PanelPlan;
    const flat = { x0: 1, x1: 2, z0: 0, z1: 0.1 };
    expect(cardUnder(panel, flat)).toBeGreaterThanOrEqual(cardUnder(panel, flat, 0));
    // Off the model there is no card at all.
    expect(cardUnder(panel, { x0: 0, x1: 0.05, z0: -2.7, z1: -2.65 }, 0)).toBe(-1);
  }, 60_000);
});
