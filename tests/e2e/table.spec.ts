import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

/**
 * The hero table in a real browser, on its dev page. The checks measure the drawn frame and the scene behind it
 * (where the lit sheet lies on the screen, how many shades the terraces show, how tall the mountain stands) and
 * never compare against stored images, because GPUs differ. Time is stepped by hand at 1/60 s, so a slow
 * software renderer shows the same frames as a fast GPU. Every capture is saved as a receipt: into the folder
 * named by RECEIPTS_DIR when it is set, otherwise into the test's output folder.
 */
test.setTimeout(300_000);

const PAGE = '/dev/table.html';

interface Info {
  t: number;
  selected: number;
  standing: number;
  grow: number;
  phi: number;
  count: number;
  readout: { hours: number; hoursText: string; line: string; card: number | null } | null;
  viewport: { width: number; height: number };
  pin: { x: number; y: number; visible: boolean };
  sheet: { x: number; y: number }[];
  compass: { x: number; y: number; r: number };
  box: { x0: number; x1: number; y0: number; y1: number };
  headline: { left: number; top: number; right: number; bottom: number };
  mountain: { height: number; silhouette: number };
}

interface TableApi {
  info(): Info;
  advance(seconds: number): Info;
  pixels(x: number, y: number, width: number, height: number): number[];
  hash(): number;
  rendererName(): string;
  frameMs(frames?: number): number;
  heights(): number[];
  select(index: number): boolean;
  next(): boolean;
  pointer(x: number | null, y: number | null, speed?: number): void;
  hit(): { kind: string; sheet: number; card: number; stage: number };
}

/** The page's window, as the functions run in the page see it. */
type W = { __table: TableApi };

function receipt(testInfo: TestInfo, name: string): string {
  const dir = (process.env.RECEIPTS_DIR ?? '').trim();
  if (!dir) return testInfo.outputPath(`${name}.png`);
  mkdirSync(dir, { recursive: true });
  return join(dir, `e2e-${testInfo.project.name}-${name}.png`);
}

/** The two sizes the hero is checked at: a 1440 by 900 desktop and a 390 by 844 phone. */
async function open(page: Page, testInfo: TestInfo, query: string): Promise<void> {
  const phone = testInfo.project.name === 'phone';
  await page.setViewportSize(phone ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await page.goto(`${PAGE}?${query}`);
  await page.waitForFunction(() => document.documentElement.dataset.table === 'ready', null, { timeout: 240_000 });
}

test('at six seconds the lit sheet lies in its box, the compass clears the headline and the mountain shows its terraces', async ({ page }, testInfo) => {
  await open(page, testInfo, 'still=1&t=6&done=6');
  const info = await page.evaluate(() => (window as unknown as W).__table.info());
  await page.screenshot({ path: receipt(testInfo, 'settled') });
  const { width, height } = info.viewport;
  expect(info.selected).toBe(0);
  expect(info.grow).toBe(1);

  // The lit sheet inside the fit box, with 3 percent of the viewport to spare for the solver.
  const box = {
    left: ((info.box.x0 + 1) / 2) * width,
    right: ((info.box.x1 + 1) / 2) * width,
    top: ((1 - info.box.y1) / 2) * height,
    bottom: ((1 - info.box.y0) / 2) * height,
  };
  for (const corner of info.sheet) {
    expect(corner.x).toBeGreaterThanOrEqual(box.left - 0.03 * width);
    expect(corner.x).toBeLessThanOrEqual(box.right + 0.03 * width);
    expect(corner.y).toBeGreaterThanOrEqual(box.top - 0.03 * height);
    expect(corner.y).toBeLessThanOrEqual(box.bottom + 0.03 * height);
  }

  // The compass disc does not lie over the headline.
  const nearestX = Math.min(Math.max(info.compass.x, info.headline.left), info.headline.right);
  const nearestY = Math.min(Math.max(info.compass.y, info.headline.top), info.headline.bottom);
  expect(Math.hypot(info.compass.x - nearestX, info.compass.y - nearestY)).toBeGreaterThan(info.compass.r);

  // Terraces: a strip down the middle of the lit sheet shows many shades, not one flat tone.
  const steps = await page.evaluate((sheet) => {
    const xs = sheet.map((p) => p.x);
    const ys = sheet.map((p) => p.y);
    const middle = (Math.min(...xs) + Math.max(...xs)) / 2;
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);
    const half = (Math.max(...xs) - Math.min(...xs)) * 0.16;
    const strip = (window as unknown as W).__table.pixels(middle - half, top + (bottom - top) * 0.2, half * 2, (bottom - top) * 0.55);
    const bins = new Map<number, number>();
    for (let i = 0; i < strip.length; i += 4) {
      const shade = Math.round((0.2126 * (strip[i] ?? 0) + 0.7152 * (strip[i + 1] ?? 0) + 0.0722 * (strip[i + 2] ?? 0)) / 12);
      bins.set(shade, (bins.get(shade) ?? 0) + 1);
    }
    return [...bins.values()].filter((count) => count >= strip.length / 4 / 400).length;
  }, info.sheet);
  expect(steps).toBeGreaterThanOrEqual(6);

  // The pin: its head shows in the signal colour. Counted in device pixels round the head only, so the trail
  // beside it does not count.
  expect(info.pin.visible).toBe(true);
  const signal = await page.evaluate((pin) => {
    const reach = 10;
    const patch = (window as unknown as W).__table.pixels(pin.x - reach, pin.y - reach, reach * 2, reach * 2);
    let count = 0;
    for (let i = 0; i < patch.length; i += 4) {
      const r = patch[i] ?? 0;
      const g = patch[i + 1] ?? 0;
      const b = patch[i + 2] ?? 0;
      if (r > 150 && g < 120 && b < 100 && r - g > 70) count += 1;
    }
    return count;
  }, info.pin);
  testInfo.annotations.push({ type: 'signal pixels of the pin', description: String(signal) });
  expect(signal).toBeGreaterThanOrEqual(40);
});

test('a growing mountain rises frame by frame and the hours count up with it', async ({ page }, testInfo) => {
  await open(page, testInfo, 'still=1&t=2&intro=0');
  const result = await page.evaluate(() => {
    const table = (window as unknown as W).__table;
    table.next();
    // The table has to arrive before the new mountain may stand.
    let waited = 0;
    while (table.info().standing !== 1 && waited < 4) {
      table.advance(1 / 60);
      waited += 1 / 60;
    }
    const frames: { at: number; silhouette: number; height: number; hours: number }[] = [];
    let at = 0;
    for (const next of [0.2, 0.6, 1.25]) {
      const info = table.advance(next - at);
      at = next;
      frames.push({ at, silhouette: info.mountain.silhouette, height: info.mountain.height, hours: info.readout?.hours ?? 0 });
    }
    const settled = table.advance(1.5);
    return { waited, frames, settled: settled.mountain.height, total: settled.readout?.hours ?? 0 };
  });
  await page.screenshot({ path: receipt(testInfo, 'grown') });
  expect(result.waited).toBeGreaterThan(0.9);
  expect(result.waited).toBeLessThan(1.6);
  const [early, middle, late] = result.frames;
  if (!early || !middle || !late) throw new Error('three frames were asked for');
  expect(middle.silhouette).toBeGreaterThan(early.silhouette + 2);
  expect(late.silhouette).toBeGreaterThan(middle.silhouette + 2);
  expect(middle.hours).toBeGreaterThan(early.hours);
  expect(late.hours).toBeGreaterThanOrEqual(middle.hours);
  expect(late.hours).toBe(result.total);
  // At 1.25 s the cards have landed: the mountain is within a few percent of its height, a little over it.
  expect(late.height).toBeGreaterThan(result.settled * 0.97);
  expect(late.height).toBeLessThan(result.settled * 1.08);
});

test('after a pick the old mountain is back in its print within 0.9 seconds', async ({ page }, testInfo) => {
  await open(page, testInfo, 'still=1&t=2&intro=0');
  const result = await page.evaluate(() => {
    const table = (window as unknown as W).__table;
    const full = table.heights()[0] ?? 0;
    table.select(1);
    const selectedAtOnce = table.info().selected;
    table.advance(0.4);
    const half = table.heights()[0] ?? 0;
    table.advance(0.4);
    const at08 = table.heights()[0] ?? 0;
    table.advance(0.1);
    const at09 = table.heights()[0] ?? 0;
    return { full, half, at08, at09, selectedAtOnce };
  });
  await page.screenshot({ path: receipt(testInfo, 'sunk') });
  expect(result.selectedAtOnce).toBe(1);
  expect(result.full).toBeGreaterThan(0.5);
  expect(result.half).toBeLessThan(result.full);
  // The growth clock reaches zero at 0.8 s; the card springs trail it by a hair and are flat by 0.9 s.
  expect(result.at08).toBeLessThan(result.full * 0.04);
  expect(result.at09).toBe(0);
});

test('the pointer on a contour card names its stage, and on a sheet at the edge it lifts that sheet', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'a phone has no pointer to rest on a card');
  await open(page, testInfo, 'still=1&t=6&intro=0');
  const result = await page.evaluate(() => {
    const table = (window as unknown as W).__table;
    const info = table.info();
    const xs = info.sheet.map((p) => p.x);
    const ys = info.sheet.map((p) => p.y);
    const x = (Math.min(...xs) + Math.max(...xs)) / 2;
    const y = Math.min(...ys) + (Math.max(...ys) - Math.min(...ys)) * 0.5;
    table.pointer(x, y, 0);
    table.advance(0.5);
    const card = { hit: table.hit(), line: table.info().readout?.line ?? '' };
    table.pointer(info.viewport.width * 0.21, info.viewport.height * 0.58, 0);
    table.advance(0.6);
    return { card, sheet: table.hit() };
  });
  await page.screenshot({ path: receipt(testInfo, 'hover-sheet') });
  expect(result.card.hit.kind).toBe('card');
  expect(result.card.line).toMatch(/^Card \d+ of 20 · Stage \d · \w+ · about /);
  expect(result.sheet.kind).toBe('sheet');
  expect(result.sheet.sheet).toBe(1);
});

test('with reduced motion two frames a second apart are the same picture', async ({ page }, testInfo) => {
  await open(page, testInfo, 'still=1&t=3&motion=reduced');
  const result = await page.evaluate(() => {
    const first = (window as unknown as W).__table.hash();
    const info = (window as unknown as W).__table.advance(1);
    return { first, second: (window as unknown as W).__table.hash(), grow: info.grow, standing: info.standing };
  });
  await page.screenshot({ path: receipt(testInfo, 'reduced') });
  expect(result.second).toBe(result.first);
  // No intro: the mountain stands from the first frame.
  expect(result.grow).toBe(1);
  expect(result.standing).toBe(0);
});

test('the frame time with the mountain standing is recorded, and held under 20 ms on a real GPU', async ({ page }, testInfo) => {
  await open(page, testInfo, 'still=1&t=6&intro=0');
  const result = await page.evaluate(() => ({ renderer: (window as unknown as W).__table.rendererName(), ms: (window as unknown as W).__table.frameMs(8) }));
  testInfo.annotations.push({ type: 'frame time', description: `${result.ms.toFixed(1)} ms on ${result.renderer}` });
  expect(Number.isFinite(result.ms)).toBe(true);
  // A software renderer draws every pixel on the CPU and says nothing about a phone's GPU.
  if (!/swiftshader|llvmpipe|software/i.test(result.renderer)) expect(result.ms).toBeLessThan(20);
});

test('Left and Right turn the table, and the counter follows at once', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'keys belong to the desktop');
  await open(page, testInfo, 'intro=0');
  await expect(page.locator('.dev-count')).toContainText('01 / 05');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.dev-count')).toContainText('02 / 05');
  expect(await page.evaluate(() => (window as unknown as W).__table.info().selected)).toBe(1);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.dev-count')).toContainText('05 / 05');
  await page.getByRole('button', { name: 'Next roadmap' }).click();
  await expect(page.locator('.dev-count')).toContainText('01 / 05');
});
