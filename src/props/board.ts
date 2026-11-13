import { Group, Vector3, type Raycaster } from 'three';
import { formatHours } from '../look/format';
import { THEME } from '../look/theme';
import { canvasFont, drawText, measureTextWidth } from '../look/type';
import { buildSheet } from '../paper/sheet';
import type { FrameTime, ScenePart } from '../scene/contract';
import type { TierName } from '../scene/palette';
import { DESIGN, sheetDrawings, type Drawing, type NamedDrawing } from './brush';
import { all, box, disc, poly, strip } from './shapes';
import { createStand, hitSheet } from './stand';
import { say } from './strings';
import type { UiLang } from '../i18n';

const T = THEME;
const S = THEME.surface;

/** The stage board: 1.0 by 0.67 on two stakes, printed on a canvas 480 px wide. */
export const BOARD = { width: 100, height: 96, plank: [29, 96], resolution: 480 } as const;

/** What a stage board says. Every string is ready to print: the caller has already put it in its language. */
export interface StageBoardText {
  /** The small line on top: "Stage 2 of 5". An interface string, printed in capitals. */
  readonly kicker: string;
  /** The big line: what the stage costs, "about 6 h". */
  readonly title: string;
  /** Up to two small lines under it: the practice share, where the stage ends. */
  readonly lines?: readonly string[];
  /** Tier of the stage. It gets a painted waymark in the tier's colour beside its name. */
  readonly tier?: TierName;
  readonly tierLabel?: string;
  /** A small plate nailed on when this stage climbs into a new tier: "Up to Gold". */
  readonly plate?: string;
  /** The word of the stamp that appears once the checkpoint is passed. */
  readonly passed?: string;
  /** Interface language of the strings, for letter shapes. */
  readonly lang?: string;
}

export interface StageBoardFacts {
  /** 1-based number of the stage and the number of stages. */
  readonly index: number;
  readonly count: number;
  readonly minutes: number;
  readonly practiceMinutes: number;
  readonly tier: TierName;
  /** True when this stage is the first of its tier and not the first stage. */
  readonly tierUp?: boolean;
}

const TIER_KEYS = { bronze: 'tierBronze', silver: 'tierSilver', gold: 'tierGold', diamond: 'tierDiamond' } as const;

/** The text of a stage board from the facts of a stage, in the interface language. */
export function stageBoardText(facts: StageBoardFacts, lang?: UiLang): StageBoardText {
  const tierLabel = say(TIER_KEYS[facts.tier], undefined, lang);
  const share = facts.minutes > 0 ? Math.round((Math.max(0, facts.practiceMinutes) / facts.minutes) * 100) : 0;
  return {
    kicker: say('stageOf', { i: facts.index, n: facts.count }, lang),
    title: formatHours(facts.minutes, lang ? { lang } : {}),
    lines: [say('handsOn', { percent: share }, lang)],
    tier: facts.tier,
    tierLabel,
    ...(facts.tierUp ? { plate: say('tierUp', { tier: tierLabel }, lang) } : {}),
    passed: say('passed', undefined, lang),
    ...(lang ? { lang } : {}),
  };
}

function fit(ctx: CanvasRenderingContext2D, text: string, role: 'display' | 'text' | 'label', size: number, weight: number, width: number, tracking = 0): number {
  ctx.font = canvasFont(role, size, weight);
  const measured = measureTextWidth(ctx, text, { tracking });
  if (measured <= width) return size;
  const smaller = Math.max(size * 0.5, (size * width) / measured);
  ctx.font = canvasFont(role, smaller, weight);
  return smaller;
}

function boardDrawing(text: StageBoardText, passed: boolean): Drawing {
  const [low, high] = BOARD.plank;
  return (b) => {
    // Two stakes, then the plank nailed across them.
    for (const x of [19, 76]) {
      const stake = poly([[x, -4], [x + 0.4, high - 4], [x + 5.6, high - 4], [x + 6, -4]], 0.6);
      b.piece(S.dirt, stake);
      b.inside(stake, () => {
        b.tone(T.walnut, 0.62, box(x - 1, -6, 8, high + 8));
        b.tone(T.walnutDeep, 0.3, box(x - 1, -6, 2.6, high + 8));
      });
    }
    const plank = poly([[1.5, low + 1.4], [0.6, high - 2.6], [3, high - 0.4], [97.6, high - 1], [99.4, high - 3.2], [98.6, low + 0.6], [96.6, low - 0.6], [3.2, low]], 1.3);
    b.piece(S.dirt, plank);
    b.inside(plank, () => {
      b.tone(T.walnut, 0.34, box(-2, low - 2, 104, 5.4));
      b.tone(T.paperHi, 0.16, box(-2, high - 5.6, 104, 6));
      b.line(T.walnutDeep, 0.2, 0.4, all(strip([[6, low + 21], [40, low + 21.6]]), strip([[52, low + 44], [94, low + 43.2]]), strip([[58, low + 12], [92, low + 12.4]])));
      // A painted rule under the kicker.
      b.tone(T.paperHi, 0.85, box(7, high - 19.4, 86, 1.1));
    });
    for (const [x, y] of [[22, high - 6], [79, high - 6], [22, low + 6], [79, low + 6]] as const) {
      b.tone(T.walnutDeep, 0.9, disc(x, y, 1));
      b.tone(T.paperHi, 0.4, disc(x + 0.3, y + 0.3, 0.35));
    }

    b.upright((ctx) => {
      const top = BOARD.height - high;
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = T.ink;
      const lang = text.lang;
      // Kicker: an interface label, in capitals and tracked.
      const kicker = text.kicker.toLocaleUpperCase(lang);
      fit(ctx, kicker, 'label', 5.6, 500, text.plate ? 48 : 84, 0.14);
      drawText(ctx, kicker, 8, top + 13.2, { tracking: 0.14, lang });
      // The big line.
      const titleSize = fit(ctx, text.title, 'display', 23, 600, 84, -0.02);
      drawText(ctx, text.title, 7.4, top + 26 + titleSize * 0.62, { tracking: -0.02, lang });
      // The small lines, and the tier with its waymark.
      let y = top + 51.5;
      for (const line of (text.lines ?? []).slice(0, 2)) {
        fit(ctx, line, 'label', 5.4, 400, 84, 0.02);
        drawText(ctx, line, 8, y, { tracking: 0.02, lang });
        y += 7.6;
      }
      if (text.tier && text.tierLabel) {
        // A waymark is paint: a white field with the tier's colour across it.
        ctx.fillStyle = T.paperHi;
        ctx.fillRect(8, y - 4.6, 7.6, 5.4);
        ctx.fillStyle = T.tier[text.tier];
        ctx.fillRect(8, y - 3.2, 7.6, 2.6);
        ctx.fillStyle = T.ink;
        fit(ctx, text.tierLabel, 'label', 5.4, 500, 70, 0.02);
        drawText(ctx, text.tierLabel, 18.4, y, { tracking: 0.02, lang });
      }
      if (text.plate) {
        // The plate for a new tier, nailed on askew.
        ctx.save();
        ctx.translate(93, top + 10.6);
        ctx.rotate(0.045);
        const size = fit(ctx, text.plate, 'label', 4.3, 500, 30, 0.04);
        const width = Math.min(36, measureTextWidth(ctx, text.plate, { tracking: 0.04 }) + 6);
        ctx.fillStyle = T.paperHi;
        ctx.fillRect(-width, -5, width, 7.6);
        ctx.fillStyle = T.walnutDeep;
        ctx.beginPath();
        ctx.arc(-width + 1.6, -1.2, 0.55, 0, Math.PI * 2);
        ctx.arc(-1.6, -1.2, 0.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = T.ink;
        drawText(ctx, text.plate, -width + 3.4, size * 0.36 - 0.5, { tracking: 0.04, lang });
        ctx.restore();
      }
      if (passed && text.passed) {
        // A rubber stamp, struck a little crooked.
        const word = text.passed.toLocaleUpperCase(lang);
        ctx.save();
        ctx.translate(71, top + 53.5);
        ctx.rotate(-0.14);
        const size = fit(ctx, word, 'label', 6.4, 500, 32, 0.12);
        const width = measureTextWidth(ctx, word, { tracking: 0.12 }) + 7;
        ctx.strokeStyle = T.ink;
        ctx.lineWidth = 0.9;
        ctx.strokeRect(-width / 2, -size * 0.92, width, size * 1.56);
        ctx.fillStyle = T.ink;
        drawText(ctx, word, 0, size * 0.22, { tracking: 0.12, lang, align: 'center' });
        ctx.restore();
      }
    });
  };
}

/** The board as a drawing, for checks. */
export function boardPieces(): NamedDrawing[] {
  const text = stageBoardText({ index: 2, count: 5, minutes: 375, practiceMinutes: 260, tier: 'gold', tierUp: true }, 'en');
  return [
    { name: 'board/open', draw: boardDrawing(text, false), width: BOARD.width, height: BOARD.height },
    { name: 'board/passed', draw: boardDrawing(text, true), width: BOARD.width, height: BOARD.height },
  ];
}

export interface StageBoardOptions {
  readonly phone?: boolean;
  readonly seed?: number;
  readonly up?: boolean;
  readonly passed?: boolean;
}

export interface StageBoardPart extends ScenePart<Group> {
  /** Shows the stamp: the checkpoint of this stage is passed. */
  setPassed(passed: boolean): void;
  readonly passed: boolean;
  /** Prints new words, for example after the interface language changed. */
  setText(text: StageBoardText): void;
  setUp(up: boolean, immediate?: boolean): void;
  readonly up: number;
  tap(): void;
  hit(raycaster: Raycaster): number | null;
  /** The top edge of the board in world space. */
  top(target?: Vector3): Vector3;
}

/** The board at the start of a stage: what the stage costs, how much of it is practice, and its tier. */
export function createStageBoard(text: StageBoardText, options: StageBoardOptions = {}): StageBoardPart {
  let current = text;
  let passed = options.passed ?? false;
  const seed = options.seed ?? 0;
  const drawings = sheetDrawings(boardDrawing(current, passed), BOARD.width, BOARD.height);
  const sheet = buildSheet({
    width: BOARD.width / DESIGN,
    height: BOARD.height / DESIGN,
    ...drawings,
    paper: S.dirt,
    soft: 0.008,
    rim: 0.4,
    seed,
    warp: 0.014,
    resolution: options.phone ? BOARD.resolution * 0.6 : BOARD.resolution,
  });
  const stand = createStand({ sway: 0.003, phase: (seed % 71) * 0.17, up: options.up });
  const object = new Group();
  object.add(stand.hinge);
  stand.hinge.add(sheet.object);
  const reprint = () => sheet.reprint(sheetDrawings(boardDrawing(current, passed), BOARD.width, BOARD.height).print);

  return {
    object,
    setPassed(next) {
      if (next === passed) return;
      passed = next;
      reprint();
    },
    get passed() {
      return passed;
    },
    setText(next) {
      current = next;
      reprint();
    },
    setUp(up, immediate) {
      stand.setUp(up, immediate);
    },
    get up() {
      return stand.up;
    },
    tap() {
      stand.tap();
    },
    hit(raycaster) {
      return stand.up > 0.2 ? hitSheet(raycaster, sheet) : null;
    },
    top(target = new Vector3()) {
      object.updateWorldMatrix(true, true);
      return stand.hinge.localToWorld(target.set(0, BOARD.height / DESIGN, 0));
    },
    update(frame: FrameTime) {
      stand.update(frame);
    },
    dispose() {
      sheet.dispose();
    },
  };
}
