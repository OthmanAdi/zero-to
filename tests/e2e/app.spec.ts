import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

/**
 * The whole site in a real browser: the table, the dive through the red pin, the walk, the list view and the
 * way a roadmap gets onto the table. Time is stepped by hand at 1/60 s through the page's own `?still` switch,
 * so a slow software renderer shows the same frames as a fast GPU. Nothing is compared against stored images:
 * the checks read the page's own numbers and the pixels of what it drew. Every capture is saved as a receipt,
 * into the folder named by RECEIPTS_DIR when it is set, otherwise into the test's output folder.
 */
test.setTimeout(420_000);

const RUST = 'rust-for-a-python-dev';
const SAMPLES = ['photography-basics', RUST, 'deutsch-a1-von-null', 'music-theory-for-a-class', 'statistics-for-data-work', 'langgraph-for-a-python-dev'];
/** The route colour, `signal` of the palette. */
const SIGNAL = [226, 73, 47] as const;

interface Info {
  mode: string;
  history: string[];
  view: string;
  hx: number;
  p: number;
  selected: number;
  roadmap: string;
  scrollY: number;
  walkReady: boolean;
  here: { stageId: string; waypointId: string } | null;
  sheet: { share: number; hereMinuteShare: number; hereStage: number; seed: string; terrain: string; trail: string; grow: number } | null;
  walker: { along: number; item: string; panel: number; shown: boolean } | null;
  walkHere: number | null;
  guard: number;
  pin: { x: number; y: number; visible: boolean } | null;
}

interface SessionLike {
  roadmap: { id: string; title: string; lang: string; stages: { id: string; waypoints: { id: string; title: string; minutes: number; optional?: boolean }[] }[] };
  trek: { totalMinutes: number; waypoints: { id: string; along: number }[] };
  done(id: string, value?: boolean): void;
  here(): { stageId: string; waypointId: string } | null;
  notebook: { size: number };
}

type W = { __zt: { info(): Info; advance(seconds: number): Info; session: SessionLike; hud: { openPanel(name: string): void } } };

function receipt(testInfo: TestInfo, name: string): string {
  const dir = (process.env.RECEIPTS_DIR ?? '').trim();
  if (!dir) return testInfo.outputPath(`${name}.png`);
  mkdirSync(dir, { recursive: true });
  return join(dir, `e2e-${testInfo.project.name}-${name}.png`);
}

/** Console errors and uncaught errors of a page. A failed font or image would show up here too. */
function watch(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`uncaught: ${error.message}`));
  return errors;
}

async function open(page: Page, testInfo: TestInfo, query: string): Promise<void> {
  const phone = testInfo.project.name === 'phone';
  await page.setViewportSize(phone ? { width: 390, height: 844 } : { width: 1440, height: 900 });
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

/** Steps until the page is in a mode, for the parts whose length depends on how fast the map is built. */
async function until(page: Page, mode: string, most = 40): Promise<Info> {
  let last = await info(page);
  for (let elapsed = 0; elapsed < most && last.mode !== mode; elapsed += 0.25) last = await advance(page, 0.25);
  expect(last.mode).toBe(mode);
  return last;
}

/** Reads pixels of a screenshot at shares of the window, by drawing it on a canvas in the page. */
async function pixels(page: Page, shot: Buffer, points: readonly (readonly [number, number])[]): Promise<number[][]> {
  return page.evaluate(
    async ({ data, at }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d') as CanvasRenderingContext2D;
      context.drawImage(image, 0, 0);
      return at.map((point) => [...context.getImageData(Math.round((point[0] ?? 0) * (image.width - 1)), Math.round((point[1] ?? 0) * (image.height - 1)), 1, 1).data.slice(0, 3)]);
    },
    { data: shot.toString('base64'), at: points.map((point) => [...point]) },
  );
}

test.describe('going in', () => {
  test('the enter button dives through the red cut and lands at the gate when nothing is walked', async ({ page }, testInfo) => {
    const errors = watch(page);
    await open(page, testInfo, `still&road=${RUST}`);
    const before = await info(page);
    expect(before.mode).toBe('table');
    expect(before.sheet?.grow).toBe(1);
    await page.screenshot({ path: receipt(testInfo, 'table') });

    await page.locator('.zh-enter').click();
    expect((await info(page)).mode).toBe('dive');
    const landed = await until(page, 'walk');
    await advance(page, 1.5);
    await page.waitForTimeout(1600);
    await page.screenshot({ path: receipt(testInfo, 'landed-at-the-gate') });

    expect(landed.history).toEqual(['boot', 'table', 'dive', 'cut', 'landing', 'walk']);
    expect(landed.view).toBe('walk');
    expect(landed.scrollY).toBeLessThan(2);
    expect(landed.walker?.shown).toBe(true);
    expect(landed.walker?.panel).toBe(0);
    expect(landed.walker?.along ?? 1).toBeLessThan(0.01);
    const first = await page.evaluate(() => (window as unknown as W).__zt.session.roadmap.stages[0]?.waypoints[0]?.id);
    expect(landed.walker?.item).toBe(`waypoint:${first}`);
    // The note of that step is on the page.
    await expect(page.locator('.zh-note')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('with progress it lands at the step of you-are-here', async ({ page }, testInfo) => {
    await open(page, testInfo, `still&road=${RUST}&done=5`);
    const here = (await info(page)).here;
    expect(here).not.toBeNull();
    await page.locator('.zh-enter').click();
    const arrived = await until(page, 'walk');
    // He comes up on the pin, in the panel of you-are-here, where the walked route ends.
    expect(arrived.walker?.panel).toBe(arrived.walkHere);
    expect(arrived.walker?.panel).toBeGreaterThan(0);
    expect(arrived.history).toContain('cut');
    // Then he walks on to the step that is next, and the note is that step's.
    const landed = await advance(page, 2.5);
    await page.waitForTimeout(1600);
    await page.screenshot({ path: receipt(testInfo, 'landed-at-you-are-here') });
    expect(landed.walker?.item).toBe(`waypoint:${here?.waypointId}`);
    expect(landed.walker?.panel).toBe(landed.walkHere);
    expect(landed.scrollY).toBeGreaterThan(100);
    const title = await page.evaluate((id) => (window as unknown as W).__zt.session.roadmap.stages.flatMap((stage) => stage.waypoints).find((step) => step.id === id)?.title ?? '?', here?.waypointId);
    await expect(page.locator('.zh-note')).toContainText(title);
  });

  test('another roadmap is picked and entered without loading a page', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'phone', 'checked once, on the desktop');
    let loads = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) loads += 1;
    });
    await open(page, testInfo, 'still');
    const loaded = loads;
    const first = await info(page);
    expect(first.selected).toBe(0);
    await page.keyboard.press('ArrowRight');
    const turned = await advance(page, 3.5);
    expect(turned.selected).toBe(1);
    expect(turned.roadmap).not.toBe(first.roadmap);
    expect(turned.sheet?.grow).toBe(1);
    await page.screenshot({ path: receipt(testInfo, 'switched') });

    await page.keyboard.press('Enter');
    const landed = await until(page, 'walk');
    await advance(page, 1);
    expect(landed.roadmap).toBe(turned.roadmap);
    expect(landed.walker?.shown).toBe(true);
    expect(loads).toBe(loaded);
    await page.waitForTimeout(1600);
    await page.screenshot({ path: receipt(testInfo, 'entered-the-second') });
  });

  test('at hx 0.6 the frame is the route colour from corner to corner', async ({ page }, testInfo) => {
    await open(page, testInfo, `still&hx=0.6&road=${RUST}`);
    const now = await info(page);
    expect(now.hx).toBe(0.6);
    expect(now.guard).toBe(1);
    expect(now.mode).toBe('cut');
    const shot = await page.screenshot({ path: receipt(testInfo, 'hx-060-red') });
    const grid: [number, number][] = [];
    for (const v of [0.02, 0.5, 0.98]) for (const u of [0.02, 0.5, 0.98]) grid.push([u, v]);
    const read = await pixels(page, shot, grid);
    for (const rgb of read) {
      for (let channel = 0; channel < 3; channel += 1) expect(Math.abs((rgb[channel] as number) - (SIGNAL[channel] as number)), `pixel ${rgb.join(',')}`).toBeLessThanOrEqual(12);
    }
  });

  test('either side of the cut shows the same red head: on the mountain before, on the map after', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'phone', 'checked once, on the desktop');
    const red = (rgb: number[]): boolean => (rgb[0] as number) > 150 && (rgb[0] as number) - (rgb[1] as number) > 50 && (rgb[0] as number) - (rgb[2] as number) > 60;
    const centre = async (name: string): Promise<number[]> => (await pixels(page, await page.screenshot({ path: receipt(testInfo, name) }), [[0.5, 0.5]]))[0] as number[];
    await open(page, testInfo, `still&road=${RUST}`);
    await page.locator('.zh-enter').click();

    // The frame before the guard comes down: the head on the mountain, already most of the window.
    let now = await info(page);
    while (now.hx < 0.55) now = await advance(page, 1 / 30);
    expect(now.mode).toBe('dive');
    expect(now.guard).toBe(0);
    const before = await centre('cut-1-before');
    expect(red(before), `centre ${before.join(',')}`).toBe(true);

    // Across the cut every frame is red: the guard, then the head on the map.
    let frames = 0;
    while ((now.guard > 0 || now.hx < 0.6) && frames < 120) {
      now = await advance(page, 1 / 60);
      frames += 1;
      if (now.guard > 0) {
        const during = await centre('cut-2-guard');
        expect(red(during), `centre ${during.join(',')} at hx ${now.hx}`).toBe(true);
      }
    }
    expect(now.mode).toBe('landing');
    expect(now.guard).toBe(0);
    expect(now.walker).not.toBeNull();
    const after = await centre('cut-3-after');
    expect(red(after), `centre ${after.join(',')} at hx ${now.hx}`).toBe(true);
  });
});

test.describe('progress', () => {
  test('two finished steps survive a reload, and the pin, the cover bar and the profile agree', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'phone', 'checked once, on the desktop');
    await open(page, testInfo, `still&road=${RUST}`);
    const done = await page.evaluate(() => {
      const session = (window as unknown as W).__zt.session;
      const steps = session.roadmap.stages.flatMap((stage) => stage.waypoints);
      const two = steps.slice(0, 2);
      for (const step of two) session.done(step.id);
      const total = steps.reduce((sum, step) => sum + step.minutes, 0);
      return { ids: two.map((step) => step.id), next: steps[2]?.id, share: two.reduce((sum, step) => sum + step.minutes, 0) / total };
    });

    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.zt === 'ready', null, { timeout: 300_000 });
    const now = await info(page);
    await page.screenshot({ path: receipt(testInfo, 'two-steps-after-reload') });
    // You are here: the third step.
    expect(now.here?.waypointId).toBe(done.next);
    // The cover bar prints the walked share, and the pin stands where the walked part ends.
    expect(now.sheet?.share).toBeCloseTo(done.share, 6);
    expect(now.sheet?.hereMinuteShare).toBeCloseTo(done.share, 6);
    expect(now.pin?.visible).toBe(true);
    // The profile's you-are-here mark stands on the dot of that same step.
    const marks = await page.evaluate((next) => {
      const here = document.querySelector<HTMLElement>('.zh-mark-here');
      const step = document.querySelector<HTMLElement>(`.zh-mark-step[data-waypoint="${next}"]`);
      return { here: here && !here.hidden ? here.style.left : null, step: step?.style.left ?? null };
    }, done.next);
    expect(marks.here).not.toBeNull();
    expect(Number.parseFloat(marks.here as string)).toBeCloseTo(Number.parseFloat(marks.step as string), 1);
    // And the side card says where the pin stands.
    await expect(page.locator('.zh-side')).toContainText(/stage 1/i);
  });
});

test.describe('a roadmap from a link', () => {
  test('a share link shows a preview first, and then the same mountain as the sender saw', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name === 'phone', 'checked once, on the desktop');
    await open(page, testInfo, `still&road=${RUST}`);
    const sender = await info(page);
    await page.evaluate(() => (window as unknown as W).__zt.hud.openPanel('share'));
    const field = page.locator('dialog[data-panel="share"] input.zh-field');
    await expect(field).toHaveValue(/#r=[zj]1\./, { timeout: 30_000 });
    const link = await field.inputValue();
    const fragment = link.slice(link.indexOf('#r='));

    const receiver = await context.newPage();
    await receiver.setViewportSize({ width: 1440, height: 900 });
    await receiver.goto(`/?still${fragment}`);
    await receiver.waitForFunction(() => document.documentElement.dataset.zt === 'ready', null, { timeout: 300_000 });
    // Nothing is applied yet: the table shows the gallery and the preview names the roadmap.
    const waiting = await info(receiver);
    expect(waiting.roadmap).not.toBe(RUST);
    const preview = receiver.locator('dialog[data-panel="open"]');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('Zero to Rust, coming from Python');
    await expect(preview.locator('.zh-facts')).toBeVisible();
    await expect(receiver.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
    await receiver.screenshot({ path: receipt(testInfo, 'share-preview') });

    await preview.locator('[data-action="apply"]').click();
    const applied = await advance(receiver, 2);
    await receiver.screenshot({ path: receipt(testInfo, 'share-applied') });
    expect(applied.roadmap).toBe(RUST);
    expect(applied.selected).toBe(0);
    expect(applied.sheet?.seed).toBe(sender.sheet?.seed);
    expect(applied.sheet?.terrain).toBe(sender.sheet?.terrain);
    expect(applied.sheet?.trail).toBe(sender.sheet?.trail);
    await receiver.close();
  });

  test('a link that holds no roadmap says so and leaves the gallery on the table', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'phone', 'checked once, on the desktop');
    await open(page, testInfo, 'still#r=z1.not-a-roadmap');
    await expect(page.locator('.zt-toast')).toBeVisible();
    expect((await info(page)).mode).toBe('table');
  });
});

/** Tabs until the focus is on something that matches. Returns false when it never gets there. */
async function tabTo(page: Page, selector: string, most: number): Promise<boolean> {
  for (let index = 0; index < most; index += 1) {
    await page.keyboard.press('Tab');
    if (await page.evaluate((query) => document.activeElement?.matches(query) ?? false, selector)) return true;
  }
  return false;
}

/** The learning loop with the keyboard alone: finish a step, open its card, pin a point, take the notebook away. */
async function keyboardPass(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  expect(await tabTo(page, 'input[data-zo-done]', 120)).toBe(true);
  const id = (await page.evaluate(() => document.activeElement?.getAttribute('data-zo-done'))) as string;
  await page.keyboard.press('Space');
  await expect(page.locator(`input[data-zo-done="${id}"]`)).toBeChecked();
  expect(await page.evaluate(() => (window as unknown as W).__zt.session.here()?.waypointId)).not.toBe(id);

  expect(await tabTo(page, `#w-${id} .zo-work`, 12)).toBe(true);
  await page.keyboard.press('Enter');
  await expect(page.locator(`#w-${id} .zl-waypoint`)).toBeVisible();

  expect(await tabTo(page, `#w-${id} .zl-pin`, 80)).toBe(true);
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => (window as unknown as W).__zt.session.notebook.size)).toBe(1);
  await expect(page.locator(`#w-${id} .zl-pin[aria-pressed="true"]`)).toHaveCount(1);
  await page.screenshot({ path: receipt(testInfo, `${name}-pinned`) });

  expect(await tabTo(page, '.zl-notebook .zl-export button', 900)).toBe(true);
  const download = page.waitForEvent('download');
  await page.keyboard.press('Enter');
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.md$/);
  const markdown = readFileSync(await file.path(), 'utf8');
  expect(markdown).toContain('Zero to Rust, coming from Python');
  expect(markdown.split('\n').filter((line) => line.startsWith('- ')).length).toBeGreaterThan(0);
}

test.describe('with the keyboard alone', () => {
  test('from the skip link to a pinned notebook entry exported as Markdown', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'phone', 'keyboard pass on the desktop project');
    await open(page, testInfo, `still&road=${RUST}`);
    await page.keyboard.press('Tab');
    const skip = page.locator('.zh-skip');
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    expect((await info(page)).mode).toBe('list');
    await expect(page.locator('html')).not.toHaveClass(/map-view/);
    await expect(page.locator('#zero-to-outline h1')).toBeFocused();
    await keyboardPass(page, testInfo, 'keyboard');

    // And back to the map: the table shows what was done in the list.
    await page.keyboard.press('l');
    const back = await advance(page, 0.5);
    expect(back.mode).toBe('table');
    expect(back.sheet?.share ?? 0).toBeGreaterThan(0);
  });
});

test.describe('with WebGL off', () => {
  test('the page is the roadmap as a list, and the same pass works', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'phone', 'keyboard pass on the desktop project');
    const errors = watch(page);
    // A browser with WebGL switched off or blocked hands no context to the page. That is what the page sees here.
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (/webgl/i.test(type)) return null;
        return (original as (this: HTMLCanvasElement, type: string, ...rest: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof original;
    });
    await open(page, testInfo, `road=${RUST}`);
    expect(
      await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
      }),
    ).toBe(false);
    const now = await info(page);
    expect(now.mode).toBe('list');
    await expect(page.locator('html')).toHaveClass(/no-webgl/);
    await expect(page.locator('#zero-to-outline h1')).toHaveText('Zero to Rust, coming from Python');
    await expect(page.locator('#zero-to-outline section.zo-stage > header h2')).toHaveCount(5);
    await expect(page.locator('#zt-stage')).toBeHidden();
    await page.screenshot({ path: receipt(testInfo, 'no-webgl') });
    await keyboardPass(page, testInfo, 'no-webgl');
    expect(errors).toEqual([]);
  });
});

test.describe('the gallery', () => {
  for (const id of SAMPLES) {
    test(`${id} draws its table and its map without an error`, async ({ page }, testInfo) => {
      const errors = watch(page);
      await open(page, testInfo, `still&road=${id}`);
      const table = await info(page);
      expect(table.roadmap).toBe(id);
      expect(table.sheet?.grow).toBe(1);
      expect(table.pin?.visible).toBe(true);
      await page.screenshot({ path: receipt(testInfo, `gallery-${id}-table`) });

      await open(page, testInfo, `still&p=0.45&road=${id}`);
      const walk = await info(page);
      expect(walk.mode).toBe('walk');
      expect(walk.history).toContain('fade');
      expect(walk.walker?.shown).toBe(true);
      await page.waitForTimeout(1600);
      await page.screenshot({ path: receipt(testInfo, `gallery-${id}-walk`) });
      expect(errors).toEqual([]);
    });
  }

  test('the six examples cover a German one, one of two stages and one of eight', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'phone', 'checked once, on the desktop');
    await open(page, testInfo, 'view=list');
    const facts: { lang: string; stages: number }[] = [];
    for (const id of SAMPLES) {
      await page.goto(`/?view=list&road=${id}`);
      await page.waitForFunction(() => document.documentElement.dataset.zt === 'ready');
      facts.push(await page.evaluate(() => ({ lang: (window as unknown as W).__zt.session.roadmap.lang, stages: document.querySelectorAll('section.zo-stage').length })));
    }
    expect(facts.some((fact) => fact.lang.startsWith('de'))).toBe(true);
    expect(facts.some((fact) => fact.stages === 2)).toBe(true);
    expect(facts.some((fact) => fact.stages === 8)).toBe(true);
  });
});

test.describe('scroll', () => {
  test('one notch of the wheel is one smooth move that settles in about 0.6 s', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'phone', 'a wheel belongs to the desktop');
    // The page's own clock: time moves only when the test steps it, one frame at a time.
    await page.clock.install({ time: new Date('2026-11-13T09:00:00Z') });
    await page.clock.pauseAt(new Date('2026-11-13T09:00:00Z'));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/?p=0.3&road=${RUST}`);
    let ready = false;
    for (let index = 0; index < 4000 && !ready; index += 1) {
      await page.clock.runFor(50);
      ready = await page.evaluate(() => document.documentElement.dataset.zt === 'ready' && (window as unknown as W).__zt.info().mode === 'walk');
      if (!ready) await page.waitForTimeout(40);
    }
    expect(ready).toBe(true);
    for (let index = 0; index < 90; index += 1) await page.clock.runFor(1000 / 60);
    const start = (await info(page)).p;
    expect(start).toBeCloseTo(0.3, 2);

    // One notch. The browser's own scroll is given time to arrive, then the page's clock is stepped.
    const from = await page.evaluate(() => window.scrollY);
    await page.mouse.move(700, 450);
    await page.mouse.wheel(0, 240);
    for (let index = 0; index < 100 && (await page.evaluate(() => window.scrollY)) < from + 200; index += 1) await page.waitForTimeout(20);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(from + 240, -1);
    const trace: number[] = [];
    for (let frame = 0; frame < 120; frame += 1) {
      await page.clock.runFor(1000 / 60);
      trace.push((await info(page)).p);
    }
    const end = trace[trace.length - 1] as number;
    const total = end - start;
    expect(total).toBeGreaterThan(0.005);
    // Monotonic, and no frame takes a step: the largest move of one frame is a small part of the whole.
    let largest = 0;
    let previous = start;
    for (const p of trace) {
      expect(p).toBeGreaterThanOrEqual(previous - 1e-9);
      largest = Math.max(largest, p - previous);
      previous = p;
    }
    expect(largest / total).toBeLessThan(0.12);
    // 95 percent of the way in about 0.6 s.
    const settle = (trace.findIndex((p) => p - start >= 0.95 * total) + 1) / 60;
    testInfo.annotations.push({ type: 'settle', description: `${settle.toFixed(3)} s, largest frame ${(100 * (largest / total)).toFixed(1)} % of the move` });
    console.log(`wheel notch: 95 % after ${settle.toFixed(3)} s, largest frame ${(100 * (largest / total)).toFixed(1)} % of the move`);
    expect(settle).toBeGreaterThan(0.4);
    expect(settle).toBeLessThan(0.85);
  });
});
