import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { buildViewer } from '../../scripts/build-viewer';

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
/** A gallery roadmap on disk, to serve from an address or drop as a file under another id. */
const SAMPLE_FILE = fileURLToPath(new URL('../../src/roadmap/samples/rust-for-a-python-dev.json', import.meta.url));
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
  intro: number | null;
  wipe: number | null;
  rise: number | null;
  flat: boolean;
  curtain: number;
  ratio: number;
  jump: boolean;
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
    // The link's roadmap is what the page is for: it lies on the table alone, with no example beside it. The
    // preview names it, and this browser keeps it only once it is opened.
    const waiting = await info(receiver);
    expect(waiting.roadmap).toBe(RUST);
    await expectAlone(receiver, RUST);
    expect(await kept(receiver)).not.toContain(RUST);
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
    expect(await kept(receiver)).toContain(RUST);
    await expectAlone(receiver, RUST);
    // The preview had nothing to give the focus back to: it goes to where the page goes on from.
    await expect(receiver.locator('.zh-enter')).toBeFocused();
    await receiver.close();
  });

  test('a link that holds no roadmap says so and leaves the gallery on the table', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'phone', 'checked once, on the desktop');
    await open(page, testInfo, 'still#r=z1.not-a-roadmap');
    await expect(page.locator('.zt-toast')).toBeVisible();
    expect((await info(page)).mode).toBe('table');
  });
});

/** The titles of the gallery's examples, as the page would print them. */
const SAMPLE_TITLES = SAMPLES.map((id) => (JSON.parse(readFileSync(fileURLToPath(new URL(`../../src/roadmap/samples/${id}.json`, import.meta.url)), 'utf8')) as { title: string }).title);

/** The ids of the roadmaps this browser keeps. */
const kept = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    try {
      return ((JSON.parse(localStorage.getItem('zero-to:library') ?? '{}') as { items?: { id: string }[] }).items ?? []).map((item) => item.id);
    } catch {
      return [];
    }
  });

/**
 * A given roadmap lies on the table alone: one sheet, no arrows and no counter, and no word of any other example
 * anywhere on the page, the sections and their footer included.
 */
async function expectAlone(page: Page, id: string): Promise<void> {
  const facts = await page.evaluate(() => ({
    count: (window as unknown as { __zt: { table: { count: number } | null } }).__zt.table?.count ?? 0,
    sheets: document.documentElement.dataset.ztSheets,
    text: document.body.innerText,
    gallery: [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') ?? '').filter((href) => /gallery/i.test(href)),
  }));
  expect(facts.count).toBe(1);
  expect(facts.sheets).toBe('1');
  await expect(page.locator('.zh-counter')).toBeHidden();
  await expect(page.locator('.zh-arrow')).toHaveCount(2);
  for (const arrow of await page.locator('.zh-arrow').all()) await expect(arrow).toBeHidden();
  const own = SAMPLES.indexOf(id);
  const others = SAMPLE_TITLES.filter((_, index) => index !== own);
  expect(others.filter((title) => facts.text.includes(title))).toEqual([]);
  expect(facts.gallery).toEqual([]);
  await expect(page.locator('.zs-ages')).toHaveCount(0);
}

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

/** A gallery roadmap under another id and title, so the page treats it as one it has never seen. */
function strangerRoadmap(id: string, title: string): string {
  const roadmap = JSON.parse(readFileSync(SAMPLE_FILE, 'utf8')) as { id: string; title: string };
  roadmap.id = id;
  roadmap.title = title;
  return JSON.stringify(roadmap);
}

/** Lets the page draw frames for a while, so CSS transitions run as they do with the page's own loop. */
async function settle(page: Page, ms: number): Promise<void> {
  await page.evaluate(
    (wait) =>
      new Promise<void>((resolve) => {
        const end = performance.now() + wait;
        const step = (): void => {
          if (performance.now() >= end) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    ms,
  );
}

test.describe('another roadmap, entered at once', () => {
  test('the red opens as a circle from the pin in 0.42 s, holds, and lands on the new map without a page load', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'phone', 'checked once, on the desktop');
    const errors = watch(page);
    let loads = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) loads += 1;
    });
    // The gallery with nobody about: no map has been started for any sheet.
    await open(page, testInfo, 'still');
    const loaded = loads;
    await page.keyboard.press('ArrowRight');
    const picked = await advance(page, 0.3);
    expect(picked.walkReady).toBe(false);
    await page.keyboard.press('Enter');

    let now = await info(page);
    expect(now.mode).toBe('dive');
    let started: number | null = null;
    let covered: number | null = null;
    let t = 0;
    let shotMid = false;
    for (let frame = 0; frame < 60 * 4 && covered === null; frame += 1) {
      now = await advance(page, 1 / 60);
      t += 1 / 60;
      if (now.wipe !== null && started === null) {
        started = t;
        // It opens from the pin, which the camera is falling onto.
        expect(now.pin?.visible).toBe(true);
        const clip = await page.evaluate(() => document.getElementById('zt-guard')?.style.clipPath ?? '');
        expect(clip).toMatch(/^circle\(/);
        const at = clip.match(/at ([\d.]+)px ([\d.]+)px/);
        expect(Math.abs(Number(at?.[1]) - (now.pin?.x ?? 0))).toBeLessThan(2);
        expect(Math.abs(Number(at?.[2]) - (now.pin?.y ?? 0))).toBeLessThan(2);
      }
      if (now.wipe !== null) expect(now.guard).toBe(1);
      if (now.wipe !== null && now.wipe > 30 && !shotMid) {
        shotMid = true;
        await page.screenshot({ path: receipt(testInfo, 'circle-opening') });
      }
      if (now.wipe !== null && now.wipe >= 150) covered = t;
    }
    expect(started).not.toBeNull();
    expect(covered).not.toBeNull();
    // 0.42 s from nothing to 150 percent, give or take a frame; the approach takes 1.75 s.
    expect((covered as number) - (started as number)).toBeGreaterThan(0.4);
    expect((covered as number) - (started as number)).toBeLessThan(0.46);
    expect(covered as number).toBeLessThan(1.8);
    const shot = await page.screenshot({ path: receipt(testInfo, 'circle-covered') });
    for (const rgb of await pixels(page, shot, [[0.02, 0.02], [0.5, 0.5], [0.98, 0.98]])) {
      expect((rgb[0] as number) > 150 && (rgb[0] as number) - (rgb[1] as number) > 50, `pixel ${rgb.join(',')}`).toBe(true);
    }

    const landed = await until(page, 'walk');
    // The picked sheet's roadmap: the session follows the pick when it is entered.
    expect(picked.selected).toBe(1);
    expect(landed.selected).toBe(1);
    expect(landed.roadmap).toBe(SAMPLES[1]);
    expect(landed.history).toEqual(['boot', 'table', 'dive', 'cut', 'landing', 'walk']);
    expect(landed.walker?.shown).toBe(true);
    expect(landed.wipe).toBeNull();
    expect(loads).toBe(loaded);
    expect(errors).toEqual([]);
  });
});

test.describe('the way back', () => {
  test('is one camera move from the shut map to the table, with the mountain flat until the camera arrives', async ({ page }, testInfo) => {
    const errors = watch(page);
    await open(page, testInfo, `still&p=0.97&road=${RUST}`);
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    let now = await info(page);
    for (let frame = 0; frame < 600 && now.mode !== 'return'; frame += 1) now = await advance(page, 1 / 60);
    expect(now.mode).toBe('return');

    let t = 0;
    let swapAt: number | null = null;
    let darkest = 0;
    let flatFrames = 0;
    let lastPinY = -1;
    const pinYs: number[] = [];
    let shotMove = false;
    for (let frame = 0; frame < 60 * 6 && now.mode === 'return'; frame += 1) {
      now = await advance(page, 1 / 60);
      t += 1 / 60;
      darkest = Math.max(darkest, now.curtain);
      // The intro is never played again on the way back.
      expect(now.intro).toBeNull();
      if (now.view === 'table' && swapAt === null) {
        swapAt = t;
        // The map comes back as the lit sheet, lying flat in its print.
        expect(now.flat).toBe(true);
        expect(now.sheet?.grow).toBe(0);
        await page.screenshot({ path: receipt(testInfo, 'way-back-1-swap') });
      }
      if (swapAt !== null && now.flat) {
        flatFrames += 1;
        expect(now.sheet?.grow).toBe(0);
      }
      if (swapAt !== null && now.pin) pinYs.push(now.pin.y);
      if (swapAt !== null && t - swapAt > 1.2 && !shotMove) {
        shotMove = true;
        await page.screenshot({ path: receipt(testInfo, 'way-back-2-moving') });
      }
      lastPinY = now.pin?.y ?? lastPinY;
    }
    expect(now.mode).toBe('table');
    expect(swapAt).not.toBeNull();
    // The swap after half a second's wait and the 0.2 s dim; the move takes 2.8 s.
    expect(swapAt as number).toBeGreaterThan(0.6);
    expect(swapAt as number).toBeLessThan(0.8);
    expect(t - (swapAt as number)).toBeGreaterThan(2.7);
    expect(t - (swapAt as number)).toBeLessThan(2.95);
    // The room dims to 0.42 and never goes dark.
    expect(darkest).toBeGreaterThan(0.38);
    expect(darkest).toBeLessThanOrEqual(0.42 + 1e-6);
    // Flat for most of the move.
    expect(flatFrames / 60).toBeGreaterThan(1.8);
    // The camera pulls back in one move: the pin's place on the screen travels and settles.
    expect(pinYs.length).toBeGreaterThan(60);
    expect(Math.abs((pinYs[pinYs.length - 1] as number) - (pinYs[0] as number))).toBeGreaterThan(40);
    expect(now.history.slice(-2)).toEqual(['return', 'table']);
    expect(now.roadmap).toBe(RUST);

    // Then the mountain grows in the light, and the table is as it was before the walk.
    const after = await advance(page, 1.5);
    expect(after.sheet?.grow).toBe(1);
    expect(after.flat).toBe(false);
    expect(after.pin?.visible).toBe(true);
    expect(after.intro).toBeNull();
    await settle(page, 600);
    await page.screenshot({ path: receipt(testInfo, 'way-back-3-table') });
    await expect(page.locator('.zh-enter')).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('scrolling into the map', () => {
  test('at the gate a scroll up rises out through the pin, and a scroll down lands at the gate with the way to where you are', async ({ page }, testInfo) => {
    const errors = watch(page);
    const phone = testInfo.project.name === 'phone';
    await open(page, testInfo, `still&road=${RUST}&done=5`);
    const here = (await info(page)).here;
    await page.locator('.zh-enter').click();
    await until(page, 'walk');
    let now = await advance(page, 2.5);
    expect(now.scrollY).toBeGreaterThan(100);

    // Back up the walk to the gate, and rest there a moment.
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    now = await advance(page, 1.5);
    expect(now.mode).toBe('walk');
    expect(now.walker?.along ?? 1).toBeLessThan(0.01);

    const { height } = page.viewportSize() ?? { height: 900 };
    const step = Math.round(height * 0.17);
    /** One scroll by the visitor: up is positive. A wheel on the desktop, a finger on the phone. */
    const scroll = async (up: number): Promise<void> => {
      if (!phone) {
        await page.mouse.move(400, 400);
        await page.mouse.wheel(0, -up);
        return;
      }
      await page.evaluate((dy) => {
        const touch = (y: number): Touch => new Touch({ identifier: 7, target: document.body, clientX: 200, clientY: y });
        const from = 400;
        window.dispatchEvent(new TouchEvent('touchstart', { touches: [touch(from)], cancelable: true, bubbles: true }));
        window.dispatchEvent(new TouchEvent('touchmove', { touches: [touch(from + dy)], cancelable: true, bubbles: true }));
        window.dispatchEvent(new TouchEvent('touchend', { touches: [], cancelable: true, bubbles: true }));
      }, up);
    };

    await scroll(step);
    now = await advance(page, 0.05);
    expect(now.mode).toBe('rise');
    expect(now.scrollY).toBe(0);
    for (let notch = 0; notch < 5; notch += 1) await scroll(step);
    now = await advance(page, 1.2);
    expect(now.mode).toBe('rise');
    // Out past the cut: the table is behind the pin again.
    expect(now.hx).toBeLessThan(0.6);
    expect(now.rise ?? 0).toBeGreaterThan(0.4);
    await page.screenshot({ path: receipt(testInfo, 'rise-1-out-through-the-pin') });

    // And back down: through the red, onto the map at the gate.
    for (let notch = 0; notch < 8; notch += 1) await scroll(-step);
    let sawRed = false;
    for (let frame = 0; frame < 300 && now.mode !== 'walk'; frame += 1) {
      now = await advance(page, 1 / 60);
      if (now.guard > 0) sawRed = true;
    }
    expect(now.mode).toBe('walk');
    expect(sawRed).toBe(true);
    now = await advance(page, 0.6);
    expect(now.history.slice(-3)).toEqual(['walk', 'rise', 'walk']);
    expect(now.scrollY).toBeLessThan(2);
    expect(now.walker?.along ?? 1).toBeLessThan(0.01);
    const first = await page.evaluate(() => (window as unknown as W).__zt.session.roadmap.stages[0]?.waypoints[0]?.id);
    expect(now.walker?.item).toBe(`waypoint:${first}`);
    // With progress, the page offers the way to it.
    expect(now.jump).toBe(true);
    await settle(page, 800);
    await expect(page.locator('.zt-jump')).toBeVisible();
    await page.screenshot({ path: receipt(testInfo, 'rise-2-back-at-the-gate') });

    await page.locator('.zt-jump').click();
    now = await advance(page, 2.5);
    expect(now.walker?.item).toBe(`waypoint:${here?.waypointId}`);
    expect(now.scrollY).toBeGreaterThan(100);
    expect(errors).toEqual([]);
  });

  test('all the way up, the page is the table again, with that roadmap in the light', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'phone', 'checked once, on the desktop');
    await open(page, testInfo, `still&road=${RUST}`);
    await page.locator('.zh-enter').click();
    await until(page, 'walk');
    let now = await advance(page, 2);
    await page.mouse.move(400, 400);
    for (let notch = 0; notch < 12; notch += 1) await page.mouse.wheel(0, -300);
    for (let frame = 0; frame < 40 && now.mode !== 'table'; frame += 1) now = await advance(page, 0.25);
    expect(now.mode).toBe('table');
    expect(now.view).toBe('table');
    expect(now.history.slice(-3)).toEqual(['walk', 'rise', 'table']);
    expect(now.roadmap).toBe(RUST);
    expect(now.sheet?.grow).toBe(1);
    expect(now.hx).toBe(0);
    await settle(page, 600);
    await expect(page.locator('.zh-enter')).toBeVisible();
    await page.screenshot({ path: receipt(testInfo, 'rise-3-out-on-the-table') });

    // Nothing was lost: going in again by the button lands as before.
    await page.locator('.zh-enter').click();
    const again = await until(page, 'walk');
    expect(again.walker?.shown).toBe(true);
  });

  test('a scroll up that only arrives at the gate does not carry on out of the map', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'phone', 'a wheel belongs to the desktop');
    await open(page, testInfo, `still&p=0.3&road=${RUST}`);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    // The same frame the page arrives at the top: not rested yet.
    await page.mouse.move(400, 400);
    await page.mouse.wheel(0, -300);
    let now = await advance(page, 0.1);
    expect(now.mode).toBe('walk');
    now = await advance(page, 1.5);
    await page.mouse.wheel(0, -300);
    now = await advance(page, 0.1);
    expect(now.mode).toBe('rise');
  });
});

test.describe('a roadmap from an address', () => {
  const ADDRESS = 'https://roadmaps.example.test/one.roadmap.json';

  test('?src= fetches the file, lays it on the table alone and previews it before this browser keeps it', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'phone', 'checked once, on the desktop');
    const errors = watch(page);
    const body = strangerRoadmap('from-an-address', 'A roadmap from an address');
    let fetched = 0;
    await page.route(ADDRESS, (route) => {
      fetched += 1;
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body });
    });
    await open(page, testInfo, `still&src=${encodeURIComponent(ADDRESS)}`);
    expect(fetched).toBe(1);
    const waiting = await info(page);
    expect(waiting.roadmap).toBe('from-an-address');
    await expectAlone(page, 'from-an-address');
    expect(await kept(page)).not.toContain('from-an-address');
    const preview = page.locator('dialog[data-panel="open"]');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('A roadmap from an address');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
    await page.screenshot({ path: receipt(testInfo, 'address-preview') });

    await preview.locator('[data-action="apply"]').click();
    // The message stays five seconds of real time, so it is read before the frames are stepped.
    await expect(page.locator('.zt-toast')).toContainText('A roadmap from an address');
    const applied = await advance(page, 2);
    expect(applied.roadmap).toBe('from-an-address');
    expect(applied.selected).toBe(0);
    expect(applied.sheet?.grow).toBe(1);
    expect(await kept(page)).toContain('from-an-address');
    await expectAlone(page, 'from-an-address');
    await page.screenshot({ path: receipt(testInfo, 'address-applied') });
    expect(errors).toEqual([]);
  });

  test('an address that fails or holds no roadmap says so and leaves the gallery on the table', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'phone', 'checked once, on the desktop');
    await page.route(ADDRESS, (route) => route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: 'gone' }));
    await open(page, testInfo, `still&src=${encodeURIComponent(ADDRESS)}`);
    await expect(page.locator('.zt-toast')).toContainText('could not be loaded');
    expect((await info(page)).mode).toBe('table');
    await expect(page.locator('dialog[data-panel="open"]')).toBeHidden();

    await page.unroute(ADDRESS);
    await page.route(ADDRESS, (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"id": 7}' }));
    await open(page, testInfo, `still&src=${encodeURIComponent(ADDRESS)}`);
    const toast = page.locator('.zt-toast');
    await expect(toast).toContainText('could not be loaded');
    // The validator's own words say what is wrong.
    await expect(toast.locator('li').first()).toBeVisible();
    expect((await info(page)).roadmap).not.toBe('from-an-address');
  });
});

test.describe('a roadmap file dropped on the page', () => {
  /** Drags files over the page and drops them, the way a browser reports it. */
  async function drop(page: Page, files: { name: string; text: string }[], only: 'enter' | 'leave' | 'drop'): Promise<void> {
    await page.evaluate(
      ({ list, step }) => {
        const data = new DataTransfer();
        for (const file of list) data.items.add(new File([file.text], file.name, { type: 'application/json' }));
        const fire = (type: string): void => {
          document.body.dispatchEvent(new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true }));
        };
        fire('dragenter');
        fire('dragover');
        if (step === 'leave') fire('dragleave');
        if (step === 'drop') fire('drop');
      },
      { list: files, step: only },
    );
  }

  test('a file held over the page is invited, and one dropped is shown as a preview first', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'phone', 'dragging a file belongs to the desktop');
    const errors = watch(page);
    await open(page, testInfo, 'still');
    const file = { name: 'mine.roadmap.json', text: strangerRoadmap('from-a-file', 'A roadmap from a file') };

    await drop(page, [file], 'enter');
    await expect(page.locator('html')).toHaveAttribute('data-zt-drop', '');
    await expect(page.locator('#zt-drop')).toBeVisible();
    await expect(page.locator('#zt-drop')).toHaveText('Drop the roadmap file to open it');
    await page.screenshot({ path: receipt(testInfo, 'drop-held') });
    await drop(page, [file], 'leave');
    // Entered twice and left once: still held. The drop clears it either way.
    await expect(page.locator('html')).toHaveAttribute('data-zt-drop', '');
    await drop(page, [file], 'drop');
    await expect(page.locator('html')).not.toHaveAttribute('data-zt-drop', '');
    await expect(page.locator('#zt-drop')).toBeHidden();

    const preview = page.locator('dialog[data-panel="open"]');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('A roadmap from a file');
    expect((await info(page)).roadmap).not.toBe('from-a-file');
    await preview.locator('[data-action="apply"]').click();
    const applied = await advance(page, 2);
    expect(applied.roadmap).toBe('from-a-file');
    expect(applied.selected).toBe(0);
    // Opened, the file's roadmap lies on the table alone: the examples are gone, and so is the gallery's footer.
    await expect(page.locator('.zs-brief').first()).toBeAttached({ timeout: 30_000 });
    await expectAlone(page, 'from-a-file');
    await page.screenshot({ path: receipt(testInfo, 'drop-applied') });
    expect(errors).toEqual([]);
  });

  test('two files at once, or a file that is not a roadmap, are refused with a message', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'phone', 'dragging a file belongs to the desktop');
    await open(page, testInfo, 'still');
    const before = (await info(page)).roadmap;
    const good = { name: 'a.roadmap.json', text: strangerRoadmap('one', 'One') };

    await drop(page, [good, { ...good, name: 'b.roadmap.json' }], 'drop');
    await expect(page.locator('.zt-toast')).toContainText('Drop one roadmap file at a time.');
    await expect(page.locator('dialog[data-panel="open"]')).toBeHidden();

    await drop(page, [{ name: 'notes.json', text: '{"title": "not a roadmap"}' }], 'drop');
    await expect(page.locator('.zt-toast')).toContainText('not a roadmap zero-to can open');
    await expect(page.locator('.zt-toast li').first()).toBeVisible();

    await drop(page, [{ name: 'broken.json', text: 'this is not JSON' }], 'drop');
    await expect(page.locator('.zt-toast p')).not.toBeEmpty();
    await expect(page.locator('dialog[data-panel="open"]')).toBeHidden();
    expect((await info(page)).roadmap).toBe(before);
  });
});

/** The skill's command-line tool, which writes a roadmap into the viewer. */
const CLI = fileURLToPath(new URL('../../.agents/skills/zero-to/scripts/zero-to.mjs', import.meta.url));

/** Opens a page from disk, as a person opens the file the skill wrote, at the project's size. */
async function openFile(page: Page, testInfo: TestInfo, file: string, query: string): Promise<void> {
  const phone = testInfo.project.name === 'phone';
  await page.setViewportSize(phone ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await page.goto(`${pathToFileURL(file).href}?${query}`);
}

test.describe('a page built for one roadmap', () => {
  // The viewer is built from the source as it is now, and the skill's tool writes a person's roadmap into it:
  // the Rust example under another id and title, so it is nobody's example.
  let dir = '';
  let viewer = '';
  let built = '';
  test.beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'zero-to-e2e-'));
    viewer = join(dir, 'zero-to.html');
    await buildViewer({ out: viewer, quiet: true });
    const file = join(dir, 'rust-on-weeknights.roadmap.json');
    writeFileSync(file, strangerRoadmap('rust-on-weeknights', 'Rust on weeknights'));
    built = join(dir, 'rust-on-weeknights.html');
    execFileSync(process.execPath, [CLI, 'build', file, '--viewer', viewer, '--out', built], { stdio: 'pipe' });
  });
  test.afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  test('holds its roadmap alone: one sheet, no examples, and sections that are its own brief', async ({ page }, testInfo) => {
    const errors = watch(page);
    // The file carries none of the examples at all, not only none on the table.
    const html = readFileSync(built, 'utf8');
    for (const [index, id] of SAMPLES.entries()) {
      expect(html.includes(id), id).toBe(false);
      expect(html.includes(SAMPLE_TITLES[index] as string), SAMPLE_TITLES[index]).toBe(false);
    }
    await openFile(page, testInfo, built, 'still&t=6');
    await page.waitForFunction(() => document.documentElement.dataset.zt === 'ready', null, { timeout: 300_000 });
    const now = await info(page);
    expect(now.roadmap).toBe('rust-on-weeknights');
    expect(now.selected).toBe(0);
    expect(now.sheet?.grow).toBe(1);
    await expect(page.locator('.zs-brief').first()).toBeAttached({ timeout: 30_000 });
    await expectAlone(page, 'rust-on-weeknights');
    await expect(page.locator('.zh-headline')).toHaveText('Rust on weeknights');
    await page.screenshot({ path: receipt(testInfo, 'built-alone') });
    // Nothing to turn to: the arrow keys leave the one sheet in the light.
    await page.keyboard.press('ArrowRight');
    const turned = await advance(page, 1.5);
    expect(turned.selected).toBe(0);
    expect(turned.roadmap).toBe('rust-on-weeknights');
    expect(errors).toEqual([]);
  });

  test('opened as it is, the viewer asks for a roadmap, then holds the chosen one alone', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'phone', 'checked once, on the desktop');
    await openFile(page, testInfo, viewer, 'still&t=6');
    await page.waitForFunction(() => document.documentElement.dataset.zt === 'choose', null, { timeout: 120_000 });
    await expect(page.locator('.zt-empty h1')).toHaveText('Open a roadmap');
    await expect(page.locator('.zt-empty h1')).toBeFocused();
    await page.screenshot({ path: receipt(testInfo, 'viewer-asks') });
    // Something that is no roadmap is refused, with the validator's own words.
    await page.locator('#zt-empty-file').setInputFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('{"title": "not a roadmap"}') });
    await expect(page.locator('.zt-empty-error')).toBeVisible();
    await expect(page.locator('.zt-empty-error li').first()).toBeVisible();
    await page.locator('#zt-empty-file').setInputFiles({ name: 'mine.roadmap.json', mimeType: 'application/json', buffer: Buffer.from(strangerRoadmap('from-the-chooser', 'A roadmap from the chooser')) });
    await page.waitForFunction(() => document.documentElement.dataset.zt === 'ready', null, { timeout: 300_000 });
    await expect(page.locator('.zt-empty')).toHaveCount(0);
    expect((await info(page)).roadmap).toBe('from-the-chooser');
    await expect(page.locator('.zs-brief').first()).toBeAttached({ timeout: 30_000 });
    await expectAlone(page, 'from-the-chooser');
    expect(await kept(page)).toContain('from-the-chooser');
  });
});

test.describe('the gallery root', () => {
  test('still lays the examples out to turn through, with their link ages in the footer', async ({ page }, testInfo) => {
    await open(page, testInfo, 'still&t=6');
    const now = await info(page);
    expect(SAMPLES).toContain(now.roadmap);
    expect(await page.evaluate(() => (window as unknown as { __zt: { table: { count: number } } }).__zt.table.count)).toBe(5);
    await expect(page.locator('html')).toHaveAttribute('data-zt-sheets', '5');
    await expect(page.locator('html')).toHaveAttribute('data-zt-table', 'gallery');
    await expect(page.locator('.zh-counter')).toBeVisible();
    await expect(page.locator('.zs-ages li').first()).toBeAttached({ timeout: 30_000 });
    expect(await page.locator('.zs-ages li').count()).toBeGreaterThanOrEqual(5);
    await page.screenshot({ path: receipt(testInfo, 'gallery-root') });
  });

  test('on a phone at rest the compass clears the whole hero copy, the lede included', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone', 'the phone layout');
    for (const query of ['still&t=6&motion=reduced', `still&t=6&motion=reduced&road=music-theory-for-a-class`]) {
      await open(page, testInfo, query);
      await settle(page, 600);
      const measured = await page.evaluate(() => {
        const boxes = ['.zh-headline', '.zh-lede', '.zh-hint']
          .map((selector) => document.querySelector(selector)?.getBoundingClientRect())
          .filter((box): box is DOMRect => box !== undefined && box.width > 0 && box.height > 0);
        return {
          copy: { left: Math.min(...boxes.map((b) => b.left)), top: Math.min(...boxes.map((b) => b.top)), right: Math.max(...boxes.map((b) => b.right)), bottom: Math.max(...boxes.map((b) => b.bottom)) },
          compass: (window as unknown as { __zt: { info(): { compass: { x: number; y: number; r: number } | null } } }).__zt.info().compass,
        };
      });
      expect(measured.compass).not.toBeNull();
      const { copy } = measured;
      const compass = measured.compass as { x: number; y: number; r: number };
      const nearestX = Math.min(Math.max(compass.x, copy.left), copy.right);
      const nearestY = Math.min(Math.max(compass.y, copy.top), copy.bottom);
      expect(Math.hypot(compass.x - nearestX, compass.y - nearestY), query).toBeGreaterThan(compass.r);
      await page.screenshot({ path: receipt(testInfo, `phone-hero-${query.includes('music') ? 'music' : 'gallery'}`) });
    }
  });
});

test.describe('where the keyboard is', () => {
  test('after landing it is on the note, after folding on the enter button, after the list view on its tool', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'phone', 'keyboard pass on the desktop project');
    await open(page, testInfo, `still&road=${RUST}`);
    expect(await tabTo(page, '.zh-enter', 40)).toBe(true);
    await page.keyboard.press('Enter');
    await until(page, 'walk');
    await advance(page, 1.5);
    await expect(page.locator('.zh-note-title')).toBeFocused();
    // The next Tab goes on inside the note, not from the top of the page.
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.closest('.zh-note') !== null)).toBe(true);

    await page.keyboard.press('Escape');
    await until(page, 'table', 30);
    await expect(page.locator('.zh-enter')).toBeFocused();

    await page.keyboard.press('l');
    await expect(page.locator('#zero-to-outline h1')).toBeFocused({ timeout: 30_000 });
    await page.keyboard.press('l');
    await advance(page, 0.3);
    await expect(page.locator('.zh-tool[data-tool="list"]')).toBeFocused();
  });
});

test.describe('the gallery without WebGL', () => {
  test('is its index, with a link to every example, a way to open another, and from an example a way back', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'phone', 'checked once, on the desktop');
    const errors = watch(page);
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (/webgl/i.test(type)) return null;
        return (original as (this: HTMLCanvasElement, type: string, ...rest: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof original;
    });
    await open(page, testInfo, '');
    expect((await info(page)).mode).toBe('list');
    await expect(page.locator('html')).toHaveAttribute('data-zt-index', '');
    for (const id of SAMPLES) await expect(page.locator(`#zero-to-outline a[href*="${id}"]`).first()).toBeVisible();
    // A roadmap's own strip and shelf have no place on the index.
    await expect(page.locator('.zh-profile-host')).toBeHidden();
    await page.screenshot({ path: receipt(testInfo, 'no-webgl-index') });

    await page.locator('.zt-listbar button').click();
    await expect(page.locator('dialog[data-panel="open"]')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.locator(`#zero-to-outline a[href*="${RUST}"]`).first().click();
    await page.waitForFunction(() => document.documentElement.dataset.zt === 'ready', null, { timeout: 300_000 });
    await expect(page.locator('#zero-to-outline h1')).toHaveText('Zero to Rust, coming from Python');
    const back = page.locator('.zt-listbar a');
    await expect(back).toBeVisible();
    await back.click();
    await page.waitForFunction(() => document.documentElement.dataset.zt === 'ready', null, { timeout: 300_000 });
    await expect(page.locator('html')).toHaveAttribute('data-zt-index', '');
    expect(errors).toEqual([]);
  });
});

test.describe('the pixel-ratio watcher', () => {
  test('slow frames lower the pixel ratio a step at a time down to 1, and a resize keeps it lowered', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name === 'phone', 'checked once, on the desktop');
    test.setTimeout(240_000);
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    // Every frame takes at least 26 ms here, whatever the GPU: over the 20 ms the watcher allows.
    await page.addInitScript(() => {
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (callback: FrameRequestCallback): number =>
        raf((time) => {
          const until = performance.now() + 26;
          while (performance.now() < until) {
            // Busy, like a frame that fills too many pixels.
          }
          callback(time);
        });
    });
    await page.goto(`/?road=${RUST}`);
    await page.waitForFunction(() => document.documentElement.dataset.zt === 'ready', null, { timeout: 300_000 });
    const ratio = (): Promise<{ ratio: number; width: number; client: number }> =>
      page.evaluate(() => {
        const canvas = document.getElementById('zt-stage') as HTMLCanvasElement;
        return { ratio: (window as unknown as W).__zt.info().ratio, width: canvas.width, client: canvas.clientWidth };
      });
    // The screen draws at 2 to begin with; the first slow frames may already have taken it down a step.
    const start = await ratio();
    expect(start.ratio).toBeLessThanOrEqual(2);
    expect(start.ratio).toBeGreaterThan(1);
    expect(start.width).toBe(Math.round(start.client * start.ratio));

    // Thirty slow frames take a step of 0.25: never more than one step at a time, never below 1.
    const seen = new Set<number>([start.ratio]);
    let now = start;
    for (let poll = 0; poll < 400 && now.ratio > 1; poll += 1) {
      await page.waitForTimeout(100);
      now = await ratio();
      seen.add(now.ratio);
    }
    expect(now.ratio).toBe(1);
    for (const value of seen) expect([1, 1.25, 1.5, 1.75, 2]).toContain(value);
    expect(seen.has(1.25)).toBe(true);
    expect(now.width).toBe(now.client);
    await page.waitForTimeout(1500);
    expect((await ratio()).ratio).toBe(1);

    // A resize draws the new size at the lowered ratio, not at the screen's own.
    await page.setViewportSize({ width: 1000, height: 700 });
    await page.waitForTimeout(800);
    const resized = await ratio();
    expect(resized.client).toBe(1000);
    expect(resized.ratio).toBe(1);
    expect(resized.width).toBe(1000);
    await page.screenshot({ path: receipt(testInfo, 'pixel-ratio-lowered') });
    await context.close();
  });
});
