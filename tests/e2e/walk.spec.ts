import { expect, test, type Page, type TestInfo } from '@playwright/test';

/**
 * The walk on its dev page. Every frame is settled at a fixed walk progress with ?p= and ?still=1, so a slow
 * software renderer measures the same frame as a fast card. Checks read measured properties (where things are
 * on the screen, how bright each panel is, where the colour of the route is), never a golden image.
 * Screenshots are saved as a receipt: into the folder named by RECEIPTS_DIR when it is set, otherwise into
 * the test's output folder.
 */

const PAGE = '/dev/walk.html';

test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

interface ScreenPoint {
  x: number;
  y: number;
}

interface Measure {
  progress: number;
  fold: number;
  stage: number;
  walkerShown: boolean;
  walker: ScreenPoint;
  walkerTop: ScreenPoint;
  routeEnd: ScreenPoint;
  solidEnd: ScreenPoint;
  pin: ScreenPoint;
  panels: { index: number; corners: ScreenPoint[]; inFrame: boolean }[];
  active: string;
}

interface Read {
  panelLuma: (number | null)[];
  signal: number;
  signalAtWalker: number;
  signalAtPin: number;
  frameLuma: number[];
}

interface WalkHook {
  ready: boolean;
  measure(): Measure;
  read(): Read;
}

function receipt(info: TestInfo, name: string): string {
  const dir = (process.env.RECEIPTS_DIR ?? '').trim();
  return dir ? `${dir.replace(/[\\/]+$/, '')}/e2e-${info.project.name}-${name}.png` : info.outputPath(`${name}.png`);
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    // A software renderer warns about slow read-backs. That is not a fault of the page.
    if (message.type() === 'error' && !message.text().includes('ReadPixels')) errors.push(message.text());
  });
  return errors;
}

async function open(page: Page, query: string): Promise<void> {
  await page.goto(`${PAGE}?still=1&t=1.5&${query}`, { waitUntil: 'load', timeout: 120_000 });
  await page.waitForFunction(() => (window as unknown as { __walk?: WalkHook }).__walk?.ready === true, null, { timeout: 240_000 });
}

const measure = (page: Page): Promise<Measure> => page.evaluate(() => (window as unknown as { __walk: WalkHook }).__walk.measure());
const read = (page: Page): Promise<Read> => page.evaluate(() => (window as unknown as { __walk: WalkHook }).__walk.read());
const distance = (a: ScreenPoint, b: ScreenPoint): number => Math.hypot(a.x - b.x, a.y - b.y);

test('at p = 0.3 one panel is lit and its neighbours are at least 40 percent darker', async ({ page }, info) => {
  const errors = watchErrors(page);
  await open(page, 'road=rust-for-a-python-dev&p=0.3&bare=1');
  const state = await measure(page);
  const frame = await read(page);
  expect(state.fold).toBe(1);
  expect(state.stage).toBe(1);
  const lit = frame.panelLuma[state.stage];
  expect(lit).not.toBeNull();
  expect(lit as number).toBeGreaterThan(110);
  for (const neighbour of [state.stage - 1, state.stage + 1]) {
    const luma = frame.panelLuma[neighbour];
    // A neighbour that is mostly off the screen cannot be measured. The one that can must be in the shade.
    if (luma === null || luma === undefined) continue;
    expect(luma, `panel ${neighbour} against the lit panel`).toBeLessThanOrEqual((lit as number) * 0.6);
  }
  // A wide window always shows enough of a neighbour to measure. A narrow one shows the lit panel alone.
  const wide = (page.viewportSize()?.width ?? 0) > 760;
  if (wide) expect(frame.panelLuma.filter((luma, index) => index !== state.stage && luma !== null).length).toBeGreaterThan(0);
  await page.screenshot({ path: receipt(info, 'p030-one-panel-lit') });
  expect(errors).toEqual([]);
});

test('the walker stands on the drawn end of the route', async ({ page }, info) => {
  const errors = watchErrors(page);
  for (const p of [0.15, 0.3, 0.47, 0.62]) {
    await open(page, `road=rust-for-a-python-dev&p=${p}&bare=1`);
    const state = await measure(page);
    expect(state.walkerShown, `walker at p ${p}`).toBe(true);
    expect(distance(state.walker, state.routeEnd), `walker and the end of the route at p ${p}`).toBeLessThanOrEqual(6);
    // The route is there in its colour, right under his feet or just behind him.
    const frame = await read(page);
    expect(frame.signal, `route pixels at p ${p}`).toBeGreaterThan(120);
  }
  await page.screenshot({ path: receipt(info, 'walker-on-the-route') });
  expect(errors).toEqual([]);
});

test('the solid part of the route ends at the pin', async ({ page }, info) => {
  const errors = watchErrors(page);
  // Four steps done: you-are-here is early in the second stage. The walker has gone on to its checkpoint.
  await open(page, 'road=rust-for-a-python-dev&p=0.352&done=4&pass=1&bare=1');
  const state = await measure(page);
  expect(state.stage).toBe(1);
  expect(distance(state.solidEnd, state.pin)).toBeLessThanOrEqual(6);
  expect(distance(state.walker, state.pin)).toBeGreaterThan(60);
  const frame = await read(page);
  // The pin stands in the colour of the route where the solid line ends.
  expect(frame.signalAtPin).toBeGreaterThan(20);
  await page.screenshot({ path: receipt(info, 'solid-route-to-the-pin') });
  expect(errors).toEqual([]);
});

test('at 0.86 all panels are in frame, for 2, 5 and 8 stages', async ({ page }, info) => {
  const errors = watchErrors(page);
  for (const [road, count] of [['photography-basics', 2], ['rust-for-a-python-dev', 5], ['deutsch-a1-von-null', 8]] as const) {
    await open(page, `road=${road}&p=0.86&bare=1`);
    const state = await measure(page);
    expect(state.panels).toHaveLength(count);
    for (const panel of state.panels) expect(panel.inFrame, `${road} panel ${panel.index}`).toBe(true);
    expect(state.fold).toBe(1);
    await page.screenshot({ path: receipt(info, `p086-whole-map-${count}-stages`) });
  }
  expect(errors).toEqual([]);
});

test('at 0.99 the map is shut', async ({ page }, info) => {
  const errors = watchErrors(page);
  await open(page, 'road=rust-for-a-python-dev&p=0.99&bare=1');
  const state = await measure(page);
  expect(state.fold).toBe(0);
  expect(state.walkerShown).toBe(false);
  expect(state.active).toBe('');
  // Shut, every panel lies in the same place: on top of the first.
  const first = state.panels[0] as Measure['panels'][number];
  const middle = (panel: Measure['panels'][number]): ScreenPoint => ({
    x: panel.corners.reduce((sum, corner) => sum + corner.x, 0) / 4,
    y: panel.corners.reduce((sum, corner) => sum + corner.y, 0) / 4,
  });
  for (const panel of state.panels) expect(distance(middle(panel), middle(first)), `panel ${panel.index}`).toBeLessThan(12);
  const frame = await read(page);
  // The cover is in the light and the room round it is dark.
  expect(frame.frameLuma[4] as number).toBeGreaterThan(60);
  expect(Math.min(frame.frameLuma[0] as number, frame.frameLuma[2] as number)).toBeLessThan(40);
  await page.screenshot({ path: receipt(info, 'p099-shut') });
  expect(errors).toEqual([]);
});

test('the map opens panel by panel and the walker passes every kind of stop', async ({ page }, info) => {
  const errors = watchErrors(page);
  await open(page, 'road=rust-for-a-python-dev&p=0.05&bare=1');
  const opening = await measure(page);
  expect(opening.fold).toBeGreaterThan(0.2);
  expect(opening.fold).toBeLessThan(0.8);
  expect(opening.walkerShown).toBe(false);
  await page.screenshot({ path: receipt(info, 'p005-opening') });

  const kinds = new Set<string>();
  for (const p of [0.1, 0.2, 0.213, 0.33, 0.345, 0.5]) {
    await open(page, `road=rust-for-a-python-dev&p=${p}&bare=1`);
    kinds.add((await measure(page)).active.split(':')[0] as string);
  }
  expect(kinds.has('waypoint')).toBe(true);
  expect(kinds.has('signpost') || kinds.has('camp')).toBe(true);
  expect(errors).toEqual([]);
});

test('a roadmap with 2 stages and one with 8 walk from the first panel to the last', async ({ page }, info) => {
  const errors = watchErrors(page);
  for (const [road, count] of [['photography-basics', 2], ['deutsch-a1-von-null', 8]] as const) {
    await open(page, `road=${road}&p=0.12&bare=1`);
    const start = await measure(page);
    expect(start.stage).toBe(0);
    expect(start.walkerShown).toBe(true);
    expect(distance(start.walker, start.routeEnd)).toBeLessThanOrEqual(6);
    await open(page, `road=${road}&p=0.8&bare=1`);
    const end = await measure(page);
    expect(end.stage).toBe(count - 1);
    expect(end.walkerShown).toBe(true);
    expect(distance(end.walker, end.routeEnd)).toBeLessThanOrEqual(6);
    const frame = await read(page);
    expect(frame.panelLuma[count - 1] as number).toBeGreaterThan(100);
    await page.screenshot({ path: receipt(info, `p080-last-panel-${count}-stages`) });
  }
  expect(errors).toEqual([]);
});

test('the active panel fits above the note on a narrow window, and inside the frame on a wide one', async ({ page }, info) => {
  const errors = watchErrors(page);
  await open(page, 'road=rust-for-a-python-dev&p=0.3');
  const state = await measure(page);
  const viewport = page.viewportSize() as { width: number; height: number };
  const narrow = viewport.width <= 760;
  const panel = state.panels[state.stage] as Measure['panels'][number];
  // The front corners of the panel are the last two.
  const front = [panel.corners[2] as ScreenPoint, panel.corners[3] as ScreenPoint];
  const limit = narrow ? viewport.height - 96 : viewport.height;
  for (const corner of front) {
    expect(corner.y).toBeLessThanOrEqual(limit + 2);
    expect(corner.x).toBeGreaterThanOrEqual(-2);
    expect(corner.x).toBeLessThanOrEqual(viewport.width + 2);
  }
  expect(state.walker.y).toBeLessThan(limit);
  await page.screenshot({ path: receipt(info, 'p030-with-the-note') });
  expect(errors).toEqual([]);
});

test('the landing starts inside the red head and ends on the stage shot', async ({ page }, info) => {
  const errors = watchErrors(page);
  await open(page, 'road=rust-for-a-python-dev&p=0.086&landing=0&bare=1');
  const red = await read(page);
  const viewport = page.viewportSize() as { width: number; height: number };
  // Red from corner to corner: nearly every pixel of the frame is in the colour of the pin.
  const frame = await page.evaluate(() => {
    const canvas = document.getElementById('stage') as HTMLCanvasElement;
    return canvas.width * canvas.height;
  });
  expect(red.signal / frame).toBeGreaterThan(0.97);
  await page.screenshot({ path: receipt(info, 'landing-000-red') });

  await open(page, 'road=rust-for-a-python-dev&p=0.086&landing=0.3&bare=1');
  const standing = await measure(page);
  expect(standing.walkerShown).toBe(true);
  expect(standing.walker.x).toBeGreaterThan(viewport.width * 0.2);
  expect(standing.walker.x).toBeLessThan(viewport.width * 0.8);
  await page.screenshot({ path: receipt(info, 'landing-030-walker-up') });

  await open(page, 'road=rust-for-a-python-dev&p=0.086&landing=1&bare=1');
  const landed = await measure(page);
  const panel = landed.panels[0] as Measure['panels'][number];
  expect((panel.corners[2] as ScreenPoint).y).toBeLessThanOrEqual(viewport.height + 2);
  await page.screenshot({ path: receipt(info, 'landing-100-stage-shot') });
  expect(errors).toEqual([]);
});

test('with reduced motion two frames a second apart are the same', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, 'road=rust-for-a-python-dev&p=0.3&motion=reduced&bare=1');
  const first = await measure(page);
  await page.goto(`${PAGE}?still=1&t=2.5&road=rust-for-a-python-dev&p=0.3&motion=reduced&bare=1`, { waitUntil: 'load', timeout: 120_000 });
  await page.waitForFunction(() => (window as unknown as { __walk?: WalkHook }).__walk?.ready === true, null, { timeout: 240_000 });
  const second = await measure(page);
  expect(distance(first.walker, second.walker)).toBeLessThan(0.5);
  expect(second.panels).toEqual(first.panels);
  expect(errors).toEqual([]);
});

test('a tap on the walker is a hit on the walker, and a tap on the empty room is none', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, 'road=rust-for-a-python-dev&p=0.3&bare=1');
  const state = await measure(page);
  // The middle of his body: between his feet and the point just above his hat.
  const body = { x: (state.walker.x + state.walkerTop.x) / 2, y: (state.walker.y + state.walkerTop.y) / 2 };
  expect(state.walker.y - state.walkerTop.y).toBeGreaterThan(8);
  await page.mouse.click(body.x, body.y);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.tap ?? '')).toMatch(/^walker:/);
  await page.mouse.click(6, 6);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.tap ?? '')).toBe('none');
  expect(errors).toEqual([]);
});
