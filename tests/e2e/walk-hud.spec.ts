import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { datedClass, fillInline, latestSession, type FixtureRoadmap } from './fixtures';

/**
 * Three things of the walk on the real page: the class flag, the side trails of optional steps and the turn of
 * the floating note. The page is stepped by hand through its `?still` switch, and where a check depends on the
 * day or on the note's timers, the page runs on a clock the spec sets. The checks read the page's own numbers
 * and measured boxes, never stored images. Every capture is saved as a receipt: into the folder named by
 * RECEIPTS_DIR when it is set, otherwise into the test's output folder.
 */
test.setTimeout(420_000);

const RUST = 'rust-for-a-python-dev';
/** Friday 13 November 2026, mid-morning: the day after session 10 of the dated class. */
const TODAY = '2026-11-13';
const MORNING = (day: string): Date => new Date(`${day}T10:00:00Z`);

interface Info {
  mode: string;
  roadmap: string;
  walker: { along: number; item: string; panel: number; shown: boolean } | null;
}

interface Point {
  x: number;
  y: number;
  z: number;
}

interface PlanMark {
  x: number;
  z: number;
  on: { x: number; z: number };
  waypoint: { id: string; optional?: boolean };
  spur: { from: number; to: number; at: number; reach: number } | null;
}

interface WalkLike {
  classAlong: number | null;
  plan: { panels: { index: number; marks: PlanMark[] }[] };
  finish(): void;
  miniMap(stage: number): { classFlag: { x: number; y: number } | null } | null;
  walkerFeet(): Point;
  panelToWorld(panel: number, x: number, y: number, z: number): Point;
  object: { traverse(visit: (node: { name: string; visible: boolean }) => void): void };
}

interface SessionLike {
  roadmap: { id: string; stages: { id: string; waypoints: { id: string; title: string; minutes: number; optional?: boolean }[] }[] };
  trek: { totalMinutes: number; waypoints: { id: string; along: number }[] };
  today(): string;
}

type W = {
  __zt: {
    info(): Info;
    advance(seconds: number): Info;
    session: SessionLike;
    walk: WalkLike;
    hud: { bus: { emit(event: { type: string; [key: string]: unknown }): void } };
  };
};

function receipt(testInfo: TestInfo, name: string): string {
  const dir = (process.env.RECEIPTS_DIR ?? '').trim();
  if (!dir) return testInfo.outputPath(`${name}.png`);
  mkdirSync(dir, { recursive: true });
  return join(dir, `e2e-${testInfo.project.name}-${name}.png`);
}

function watch(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`uncaught: ${error.message}`));
  return errors;
}

const isPhone = (testInfo: TestInfo): boolean => testInfo.project.name === 'phone';

/** Writes a roadmap into the page's own `zero-to-roadmap` element, the way a file built by the skill carries it. */
async function inline(page: Page, roadmap: FixtureRoadmap): Promise<void> {
  await page.addInitScript(fillInline, { roadmap: JSON.stringify(roadmap), receipt: null });
}

async function open(page: Page, testInfo: TestInfo, query: string): Promise<void> {
  await page.setViewportSize(isPhone(testInfo) ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await page.goto(`/?${query}`);
  await page.waitForFunction(() => document.documentElement.dataset.zt === 'ready', null, { timeout: 300_000 });
}

const info = (page: Page): Promise<Info> => page.evaluate(() => (window as unknown as W).__zt.info());

/** Steps the page by hand, in slices short enough for one call each. */
async function advance(page: Page, seconds: number): Promise<Info> {
  let left = seconds;
  let last = await info(page);
  while (left > 1e-6) {
    const slice = Math.min(0.5, left);
    last = await page.evaluate((s) => (window as unknown as W).__zt.advance(s), slice);
    left -= slice;
  }
  return last;
}

/** The title of a step, as the roadmap on the page writes it. */
const stepTitle = (page: Page, waypointId: string): Promise<string> =>
  page.evaluate(
    (id) => (window as unknown as W).__zt.session.roadmap.stages.flatMap((stage) => stage.waypoints).find((step) => step.id === id)?.title ?? '?',
    waypointId,
  );

/** Walks the walker to a step, the way a click on its mark on the profile strip does. */
async function walkTo(page: Page, waypointId: string): Promise<Info> {
  await page.evaluate((id) => (window as unknown as W).__zt.hud.bus.emit({ type: 'go', waypointId: id }), waypointId);
  return advance(page, 4);
}

/** Where the class flag should stand: at the end of the furthest step the session did in class. */
function expectedClassAlong(page: Page, inClass: readonly string[]): Promise<{ along: number; waypointId: string }> {
  return page.evaluate((ids) => {
    const { session } = (window as unknown as W).__zt;
    const minutes = new Map(session.roadmap.stages.flatMap((stage) => stage.waypoints).map((step) => [step.id, step.minutes]));
    let best = { along: -1, waypointId: '' };
    for (const id of ids) {
      const step = session.trek.waypoints.find((entry) => entry.id === id);
      if (!step) continue;
      const along = Math.min(1, step.along + (minutes.get(id) ?? 0) / 2 / session.trek.totalMinutes);
      if (along > best.along) best = { along, waypointId: id };
    }
    return best;
  }, [...inClass]);
}

/** The flag on the profile strip: its name and where it stands, as a share of the strip. */
function profileFlag(page: Page): Promise<{ hidden: boolean; label: string | null; left: number }> {
  return page.evaluate(() => {
    const mark = document.querySelector<HTMLElement>('.zh-mark-class');
    return { hidden: !mark || mark.hidden !== false, label: mark?.getAttribute('aria-label') ?? null, left: Number.parseFloat(mark?.style.left ?? '') / 100 };
  });
}

test.describe('the class flag', () => {
  test('a class roadmap with dated sessions stands the flag after the latest session, on the map, its mini map and the profile strip', async ({ page }, testInfo) => {
    const errors = watch(page);
    const roadmap = datedClass();
    const session = latestSession(roadmap, TODAY);
    expect(session?.n).toBe(10);
    await page.clock.setFixedTime(MORNING(TODAY));
    await inline(page, roadmap);
    await open(page, testInfo, 'still&p=0.3');
    const opened = await info(page);
    expect(opened.roadmap).toBe(roadmap.id);
    expect(await page.evaluate(() => (window as unknown as W).__zt.session.today())).toBe(TODAY);

    const want = await expectedClassAlong(page, session?.inClass ?? []);
    expect(want.along).toBeGreaterThan(0);
    // The map and the profile strip agree on the place.
    expect(await page.evaluate(() => (window as unknown as W).__zt.walk.classAlong)).toBeCloseTo(want.along, 6);
    const flag = await profileFlag(page);
    expect(flag.hidden).toBe(false);
    expect(flag.label).toBe(`The class is here: session ${session?.n}, ${session?.title}`);
    expect(Math.abs(flag.left - want.along)).toBeLessThan(0.0002);

    // On the stage of that session the mini map carries the flag too, and on the first stage it does not.
    const there = await walkTo(page, want.waypointId);
    expect(there.walker?.item).toBe(`waypoint:${want.waypointId}`);
    const minis = await page.evaluate((stage) => {
      const { walk } = (window as unknown as W).__zt;
      walk.finish();
      return { here: walk.miniMap(stage)?.classFlag ?? null, first: walk.miniMap(0)?.classFlag ?? null };
    }, there.walker?.panel ?? -1);
    expect(minis.here).not.toBeNull();
    expect(minis.first).toBeNull();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: receipt(testInfo, 'class-flag-today') });
    expect(errors).toEqual([]);
  });

  test('another day stands it at another session, and before the first session there is none', async ({ page }, testInfo) => {
    test.skip(isPhone(testInfo), 'checked once, on the desktop');
    const roadmap = datedClass();
    await inline(page, roadmap);

    const tuesday = '2026-10-20';
    const early = latestSession(roadmap, tuesday);
    expect(early?.n).toBe(3);
    await page.clock.setFixedTime(MORNING(tuesday));
    await open(page, testInfo, 'still&p=0.3');
    const want = await expectedClassAlong(page, early?.inClass ?? []);
    expect(await page.evaluate(() => (window as unknown as W).__zt.walk.classAlong)).toBeCloseTo(want.along, 6);
    const flag = await profileFlag(page);
    expect(flag.label).toBe(`The class is here: session 3, ${early?.title}`);
    expect(Math.abs(flag.left - want.along)).toBeLessThan(0.0002);

    const before = '2026-10-05';
    expect(latestSession(roadmap, before)).toBeNull();
    await page.clock.setFixedTime(MORNING(before));
    await open(page, testInfo, 'still&p=0.3');
    expect(await page.evaluate(() => (window as unknown as W).__zt.walk.classAlong)).toBeNull();
    expect((await profileFlag(page)).hidden).toBe(true);
  });

  test('at midnight the map stands the flag at the session that has just become the latest', async ({ page }, testInfo) => {
    test.skip(isPhone(testInfo), 'checked once, on the desktop');
    const roadmap = datedClass();
    // Sunday night. Session 11 is on Monday 16 November.
    const sunday = latestSession(roadmap, '2026-11-15');
    const monday = latestSession(roadmap, '2026-11-16');
    expect([sunday?.n, monday?.n]).toEqual([10, 11]);
    await inline(page, roadmap);
    await page.clock.install({ time: new Date('2026-11-15T23:59:30Z') });
    await open(page, testInfo, 'still&p=0.5');
    await page.clock.runFor(1000);
    const sundayAlong = (await expectedClassAlong(page, sunday?.inClass ?? [])).along;
    const mondayAlong = (await expectedClassAlong(page, monday?.inClass ?? [])).along;
    const walkFlag = (): Promise<number | null> =>
      page.evaluate(() => {
        const zt = (window as unknown as W).__zt;
        zt.advance(0.1);
        return zt.walk.classAlong;
      });
    expect(await walkFlag()).toBeCloseTo(sundayAlong, 6);
    // The map asks the day again every 30 s.
    await page.clock.fastForward(60_000);
    expect(await page.evaluate(() => (window as unknown as W).__zt.session.today())).toBe('2026-11-16');
    expect(await walkFlag()).toBeCloseTo(mondayAlong, 6);
  });

  test('at midnight the profile strip moves its flag with the map', async ({ page }, testInfo) => {
    test.skip(isPhone(testInfo), 'checked once, on the desktop');
    // Known miss: the strip places its flag only when the session changes, so after midnight it still stands at
    // session 10 while the map has gone on to session 11. The overlay owns the fix. Remove this line with it.
    test.fail(true, 'the profile strip does not read the day again');
    const roadmap = datedClass();
    const monday = latestSession(roadmap, '2026-11-16');
    await inline(page, roadmap);
    await page.clock.install({ time: new Date('2026-11-15T23:59:30Z') });
    await open(page, testInfo, 'still&p=0.5');
    await page.clock.runFor(1000);
    await page.clock.fastForward(60_000);
    await advance(page, 0.5);
    await page.clock.runFor(31_000);
    const flag = await profileFlag(page);
    expect(flag.label).toBe(`The class is here: session 11, ${monday?.title}`);
    expect(Math.abs(flag.left - (await expectedClassAlong(page, monday?.inClass ?? [])).along)).toBeLessThan(0.0002);
  });
});

test.describe('side trails', () => {
  test('an optional step stands at the end of a dotted spur: the walker goes out to it and comes back to the route', async ({ page }, testInfo) => {
    const errors = watch(page);
    await open(page, testInfo, `still&p=0.2&road=${RUST}`);
    const marks = await page.evaluate(() => {
      const { walk } = (window as unknown as W).__zt;
      walk.finish();
      return walk.plan.panels.flatMap((panel) =>
        panel.marks.map((mark) => ({ panel: panel.index, id: mark.waypoint.id, optional: mark.waypoint.optional === true, x: mark.x, z: mark.z, on: mark.on, reach: mark.spur?.reach ?? null })),
      );
    });
    const optional = marks.filter((mark) => mark.optional);
    expect(optional.map((mark) => mark.id)).toEqual(['borrowing-examples', 'read-real-code']);
    for (const mark of marks) {
      if (!mark.optional) {
        // A step on the route stands on it.
        expect(mark.reach, mark.id).toBeNull();
        expect(Math.hypot(mark.x - mark.on.x, mark.z - mark.on.z), mark.id).toBeLessThan(1e-9);
        continue;
      }
      // An optional one stands off it, at the far end of its spur.
      expect(mark.reach ?? 0, mark.id).toBeGreaterThan(0.2);
      expect(Math.hypot(mark.x - mark.on.x, mark.z - mark.on.z), mark.id).toBeCloseTo(mark.reach ?? 0, 3);
    }

    const side = optional[0] as (typeof optional)[number];
    const ids = marks.map((mark) => mark.id);
    const before = ids[ids.indexOf(side.id) - 1] as string;
    const after = ids[ids.indexOf(side.id) + 1] as string;
    /** Where the walker's feet are against a step's mark, its place on the route, and whether the spur is drawn. */
    const measure = (id: string) =>
      page.evaluate(
        ({ id, side }) => {
          const { walk } = (window as unknown as W).__zt;
          const feet = walk.walkerFeet();
          const own = walk.plan.panels.flatMap((panel) => panel.marks.map((mark) => ({ panel: panel.index, mark }))).find((entry) => entry.mark.waypoint.id === id);
          const at = own ? walk.panelToWorld(own.panel, own.mark.x, 0, own.mark.z) : feet;
          const route = walk.panelToWorld(side.panel, side.on.x, 0, side.on.z);
          let drawn: boolean | null = null;
          walk.object.traverse((node) => {
            if (node.name === `panel-${side.panel}-spur-${side.id}`) drawn = node.visible;
          });
          return { toOwnMark: Math.hypot(feet.x - at.x, feet.z - at.z), fromRoute: Math.hypot(feet.x - route.x, feet.z - route.z), spurDrawn: drawn as boolean | null };
        },
        { id, side },
      );

    // The step before: he stands on the route at its mark, and the spur ahead is not drawn yet.
    expect((await walkTo(page, before)).walker?.item).toBe(`waypoint:${before}`);
    let now = await measure(before);
    expect(now.toOwnMark).toBeLessThan(0.05);
    expect(now.spurDrawn).toBe(false);

    // The optional step: out at the end of the spur, as far from the route as the spur reaches.
    const out = await walkTo(page, side.id);
    expect(out.walker?.item).toBe(`waypoint:${side.id}`);
    now = await measure(side.id);
    expect(now.toOwnMark).toBeLessThan(0.05);
    expect(now.fromRoute).toBeGreaterThan((side.reach ?? 0) * 0.8);
    expect(now.spurDrawn).toBe(true);
    await expect(page.locator('.zh-note-title')).toHaveText(await stepTitle(page, side.id));
    await page.waitForTimeout(1500);
    await page.screenshot({ path: receipt(testInfo, 'side-trail-at-the-step') });

    // The step after: back on the route.
    expect((await walkTo(page, after)).walker?.item).toBe(`waypoint:${after}`);
    now = await measure(after);
    expect(now.toOwnMark).toBeLessThan(0.05);
    expect(now.spurDrawn).toBe(true);
    expect(errors).toEqual([]);
  });

  test('the profile strip draws the same side trails: each optional dot stands at the far end of its dotted arc', async ({ page }, testInfo) => {
    await open(page, testInfo, `still&p=0.3&road=${RUST}`);
    await advance(page, 1);
    await expect(page.locator('.zh-profile')).toBeVisible();
    const optional = await page.evaluate(() =>
      (window as unknown as W).__zt.session.roadmap.stages.flatMap((stage) => stage.waypoints).filter((step) => step.optional).map((step) => step.id),
    );
    await expect(page.locator('.zh-mark-step.is-side')).toHaveCount(optional.length);
    const arcs = await page.evaluate(() =>
      [...document.querySelectorAll<SVGPathElement>('path.zh-profile-spur')].map((path) => {
        const id = path.dataset.waypoint ?? '';
        const box = path.getBoundingClientRect();
        const dot = document.querySelector(`.zh-mark-step[data-waypoint="${id}"] .zh-mark-dot`)?.getBoundingClientRect();
        return { id, up: !path.classList.contains('is-down'), box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom }, dot: dot ? { x: dot.left + dot.width / 2, y: dot.top + dot.height / 2 } : null };
      }),
    );
    expect(arcs.map((arc) => arc.id).sort()).toEqual([...optional].sort());
    for (const arc of arcs) {
      expect(arc.dot, arc.id).not.toBeNull();
      // The arc stands off the line, and the dot sits at its far end, half way along it.
      expect(arc.box.bottom - arc.box.top, arc.id).toBeGreaterThan(4);
      expect(Math.abs((arc.dot?.x ?? 0) - (arc.box.left + arc.box.right) / 2), arc.id).toBeLessThan(1.5);
      expect(Math.abs((arc.dot?.y ?? 0) - (arc.up ? arc.box.top : arc.box.bottom)), arc.id).toBeLessThan(1.5);
    }
    await page.locator('.zh-profile').screenshot({ path: receipt(testInfo, 'side-trails-on-the-profile') });
  });
});

/** What the note looks like at a moment of its running animations: they are paused and set to that moment. */
interface NoteFrame {
  classes: string;
  animations: string[];
  /** Lowest opacity of the paper, its head and its body. */
  opacity: number;
  /** How far the sheet is turned about its top edge, in degrees. */
  turn: number;
  title: string;
  card: boolean;
}

function noteAt(page: Page, ms: number): Promise<NoteFrame> {
  return page.evaluate((time) => {
    const note = document.querySelector('.zh-note') as HTMLElement;
    const running = note.getAnimations({ subtree: true });
    for (const animation of running) {
      animation.pause();
      animation.currentTime = time;
    }
    const opacity = (selector: string): number => Number(getComputedStyle(note.querySelector(selector) as Element).opacity);
    const transform = getComputedStyle(note.querySelector('.zh-note-paper') as Element).transform;
    const matrix = transform === 'none' ? null : new DOMMatrixReadOnly(transform);
    return {
      classes: note.className.replace('zh-note', '').trim(),
      animations: running.map((animation) => (animation as CSSAnimation).animationName),
      opacity: Math.min(opacity('.zh-note-paper'), opacity('.zh-note-head'), opacity('.zh-note-body')),
      turn: matrix ? (Math.atan2(matrix.m23, matrix.m22) * 180) / Math.PI : 0,
      title: note.querySelector('.zh-note-title')?.textContent ?? '',
      card: note.querySelector('.zh-note-body .zl-card') !== null,
    };
  }, ms);
}

/** Readable: a card is on the sheet, nothing on it is fainter than half, and the sheet is turned by less than 50 degrees. */
const readable = (frame: NoteFrame): boolean => frame.card && frame.opacity >= 0.5 && Math.abs(frame.turn) < 50;

/** Opens the walk at a step, on a clock the spec runs, and lets the note settle there. */
async function openOnClock(page: Page, testInfo: TestInfo): Promise<{ item: string; title: string }> {
  await page.clock.install();
  await open(page, testInfo, `still&p=0.2363&road=${RUST}`);
  await page.clock.runFor(1500);
  const now = await advance(page, 1);
  await page.clock.runFor(1500);
  // From here the page's timers run only when the spec says so: the turn's 170 ms wait among them.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  return { item: now.walker?.item ?? '', title: (await page.locator('.zh-note-title').textContent()) ?? '' };
}

/** The next step, by the keyboard on a wide window and by the note's own next-step event on a phone. */
async function nextStep(page: Page, testInfo: TestInfo): Promise<Info> {
  if (isPhone(testInfo)) await page.evaluate(() => (window as unknown as W).__zt.hud.bus.emit({ type: 'step', step: 1 }));
  else await page.keyboard.press('ArrowRight');
  return advance(page, 2.5);
}

test.describe('the note turn', () => {
  test('the sheet turns away with the step that was on it and comes back with the next, and is never shown bare', async ({ page }, testInfo) => {
    const errors = watch(page);
    const phone = isPhone(testInfo);
    const first = await openOnClock(page, testInfo);
    expect(first.item).toMatch(/^waypoint:/);
    expect((await noteAt(page, 0)).classes).toBe('');

    const moved = await nextStep(page, testInfo);
    expect(moved.walker?.item).not.toBe(first.item);
    const nextTitle = await stepTitle(page, (moved.walker?.item ?? '').replace('waypoint:', ''));

    // Out: the step that was there stays on the sheet while it turns away (on a phone, while its lines step up).
    const out: (NoteFrame & { t: number })[] = [];
    for (let t = 0; t <= 170; t += 5) out.push({ t, ...(await noteAt(page, t)) });
    expect(out[0]?.classes).toBe('is-out');
    expect(out[0]?.animations).toContain(phone ? 'zh-lines-out' : 'zh-sheet-out');
    for (const frame of out) expect(frame.title, `out at ${frame.t} ms`).toBe(first.title);
    await noteAt(page, 110);
    await page.screenshot({ path: receipt(testInfo, 'note-turn-1-out') });

    // In: 170 ms later the next step is on the sheet, and it comes back.
    await page.clock.runFor(170);
    const back: (NoteFrame & { t: number })[] = [];
    for (let t = 0; t <= 375; t += 5) back.push({ t, ...(await noteAt(page, t)) });
    expect(back[0]?.classes).toBe('is-in');
    expect(back[0]?.animations).toContain(phone ? 'zh-lines-in' : 'zh-sheet-in');
    for (const frame of back) expect(frame.title, `in at ${frame.t} ms`).toBe(nextTitle);
    await noteAt(page, 40);
    await page.screenshot({ path: receipt(testInfo, 'note-turn-2-in') });

    // Never bare: a step is on the sheet at every moment, and the time nothing can be read is short.
    for (const frame of [...out, ...back]) expect(frame.card, `a card at ${frame.t} ms`).toBe(true);
    const lastOld = [...out].reverse().find(readable)?.t ?? -1;
    const firstNew = back.find(readable)?.t ?? 999;
    expect(lastOld).toBeGreaterThanOrEqual(130);
    expect(firstNew).toBeLessThanOrEqual(60);
    expect(170 - lastOld + firstNew).toBeLessThanOrEqual(100);
    // The sheet turns about its top edge on a wide window; on a phone the bottom sheet stays where it is.
    const largest = Math.max(...[...out, ...back].map((frame) => Math.abs(frame.turn)));
    if (phone) expect(largest).toBeLessThan(0.5);
    else expect(largest).toBeGreaterThan(50);

    // Settled: the turn's class goes once the sheet lies, so a later change of layout cannot play it again.
    await page.evaluate(() => {
      for (const animation of (document.querySelector('.zh-note') as HTMLElement).getAnimations({ subtree: true })) animation.finish();
    });
    await page.clock.runFor(600);
    const settled = await noteAt(page, 0);
    expect(settled.classes).toBe('');
    expect(settled.title).toBe(nextTitle);
    expect(settled.opacity).toBe(1);
    await page.screenshot({ path: receipt(testInfo, 'note-turn-3-after') });
    expect(errors).toEqual([]);
  });

  test('with reduced motion the note changes at once, with no turn', async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const first = await openOnClock(page, testInfo);
    const moved = await nextStep(page, testInfo);
    expect(moved.walker?.item).not.toBe(first.item);
    const now = await noteAt(page, 0);
    expect(now.classes).toBe('');
    expect(now.animations.filter((name) => /zh-(sheet|lines)-/.test(name))).toEqual([]);
    expect(now.title).not.toBe(first.title);
    expect(now.opacity).toBe(1);
  });
});
