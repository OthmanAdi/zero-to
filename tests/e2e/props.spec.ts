import { expect, test, type Page, type TestInfo } from '@playwright/test';

/**
 * Props, signposts and stations on their dev page. Every scene is stepped to a fixed moment with ?t=, so a
 * slow software renderer measures the same frame as a fast card. Checks read measured properties (angles,
 * colours at projected points, the cut of each drawing), never a golden image. Screenshots are saved as a
 * receipt: into the folder named by RECEIPTS_DIR when it is set, otherwise into the test's output folder.
 */

const PAGE = '/dev/props.html';

test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

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
  await page.goto(`${PAGE}?${query}`, { waitUntil: 'load', timeout: 120_000 });
  await page.waitForFunction(() => document.documentElement.dataset.props === 'ready', null, { timeout: 240_000 });
  await page.evaluate(() => (window as unknown as { __props: { ready: Promise<void> } }).__props.ready);
}

function state<T>(page: Page): Promise<T> {
  return page.evaluate(() => (window as unknown as { __props: { state(): unknown } }).__props.state()) as Promise<T>;
}

function pixel(page: Page, at: { x: number; y: number }, half = 2): Promise<number[]> {
  return page.evaluate(([x, y, h]) => (window as unknown as { __props: { pixel(x: number, y: number, half: number): number[] } }).__props.pixel(x as number, y as number, h as number), [at.x, at.y, half]);
}

const luma = (rgb: readonly number[]): number => 0.2126 * (rgb[0] ?? 0) + 0.7152 * (rgb[1] ?? 0) + 0.0722 * (rgb[2] ?? 0);
/** True for the route colour as it leaves the tone mapper: clearly red, little green, less blue. */
const isSignal = (rgb: readonly number[]): boolean => (rgb[0] ?? 0) > 150 && (rgb[0] ?? 0) - (rgb[1] ?? 0) > 70 && (rgb[0] ?? 0) - (rgb[2] ?? 0) > 80;

interface ArtStat {
  name: string;
  filled: number;
  over: number;
  cut: number;
}

test('every drawing is cut out whole: a silhouette that is not empty and no edge clipped by its box', async ({ page }, info) => {
  const errors = watchErrors(page);
  await open(page, 'section=art&still=1&px=240');
  const stats = await state<ArtStat[]>(page);
  expect(stats.length).toBeGreaterThan(60);

  const props = stats.filter((stat) => /^(grass|forest|dirt|rock|scree|snow|sand|water|sky|camp)\/[a-z]+$/.test(stat.name));
  expect(props.length).toBeGreaterThanOrEqual(24);
  const surfaces = new Set(props.map((stat) => stat.name.split('/')[0]));
  expect([...surfaces].sort()).toEqual(['camp', 'dirt', 'forest', 'grass', 'rock', 'sand', 'scree', 'sky', 'snow', 'water']);

  const posts = stats.filter((stat) => /^signpost\/[a-z-]+$/.test(stat.name) && !/pennant|lock/.test(stat.name));
  expect(posts.map((stat) => stat.name).sort()).toEqual(
    ['blaze-post', 'buoy', 'cairn', 'snow-pole', 'summit-flag', 'timber', 'trig-pillar'].map((key) => `signpost/${key}`).sort(),
  );

  for (const stat of stats) expect(stat.filled, `${stat.name} is empty`).toBeGreaterThan(0.08);
  // Free-standing drawings must lie inside their box. Arms, boards and cards fill their box on purpose.
  const freeStanding = [...props, ...posts, ...stats.filter((stat) => /^(station\/peak-|cairn\/|camp\/pole|signpost\/(pennant|lock))/.test(stat.name))];
  for (const stat of freeStanding) {
    expect(stat.over, `${stat.name} is drawn past its box`).toBe(0);
    expect(stat.cut, `${stat.name} is cut off by its box`).toBe(0);
  }
  await page.screenshot({ path: receipt(info, 'art'), fullPage: true });
  expect(errors).toEqual([]);
});

test('the contact sheet stands every prop on paper under the lamp', async ({ page }, info) => {
  const errors = watchErrors(page);
  await open(page, 'section=sheet&still=1&t=4');
  const props = await state<{ id: string; up: number }[]>(page);
  expect(props.length).toBeGreaterThanOrEqual(24);
  for (const prop of props) expect(prop.up, prop.id).toBeGreaterThan(0.97);
  // The frame is lit: paper under the lamp is far brighter than the room.
  const size = page.viewportSize() ?? { width: 1280, height: 800 };
  let bright = 0;
  for (let i = 1; i < 12; i += 1) {
    for (let j = 1; j < 8; j += 1) {
      if (luma(await pixel(page, { x: (size.width * i) / 12, y: (size.height * j) / 8 }, 3)) > 150) bright += 1;
    }
  }
  expect(bright).toBeGreaterThan(2);
  await page.screenshot({ path: receipt(info, 'sheet') });
  expect(errors).toEqual([]);
});

interface PostState {
  key: string;
  count: number;
  up: number;
  pennant: number;
  arms: { ticked: boolean; swing: number; lines: string[]; truncated: boolean; pivot: { x: number; y: number }; tip: { x: number; y: number }; screenAngle: number }[];
}

test('a signpost with three arms and one ticked: the ticked arm points the other way', async ({ page }, info) => {
  const errors = watchErrors(page);
  await open(page, 'section=signposts&only=timber&still=1&t=4&ticked=1');
  const [post] = await state<PostState[]>(page);
  expect(post?.key).toBe('timber');
  expect(post?.count).toBe(3);
  const arms = post?.arms ?? [];
  expect(arms.map((arm) => arm.ticked)).toEqual([false, true, false]);
  expect(arms[1]?.swing ?? 9).toBeCloseTo(0, 2);
  expect(arms[0]?.swing ?? 0).toBeCloseTo(Math.PI, 2);

  const turn = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
  for (const other of [0, 2]) expect(turn(arms[1]?.screenAngle ?? 0, arms[other]?.screenAngle ?? 0), `arm 1 against arm ${other}`).toBeGreaterThanOrEqual(25);
  expect(turn(arms[0]?.screenAngle ?? 0, arms[2]?.screenAngle ?? 0)).toBeLessThan(5);
  // The ticked arm points up the route: to the right, and a little upward.
  expect(arms[1]?.tip.x ?? 0).toBeGreaterThan((arms[1]?.pivot.x ?? 0) + 40);
  expect(arms[0]?.tip.x ?? 0).toBeLessThan((arms[0]?.pivot.x ?? 0) - 40);
  // There is a board where each arm is said to be: its middle is lit paper, not the dark room behind it.
  // Some samples land on a printed letter, so most of them have to be board, not all.
  for (const arm of arms) {
    let board = 0;
    for (const along of [0.14, 0.3, 0.45, 0.6, 0.75, 0.9]) {
      const at = { x: arm.pivot.x + (arm.tip.x - arm.pivot.x) * along, y: arm.pivot.y + (arm.tip.y - arm.pivot.y) * along };
      if (luma(await pixel(page, at, 1)) > 110) board += 1;
    }
    expect(board, `arm at ${Math.round(arm.screenAngle)} degrees`).toBeGreaterThanOrEqual(3);
  }
  // Words as written, on one or two lines.
  expect(arms.map((arm) => arm.lines.join(' '))).toEqual(['Read a staff', 'Clap a rhythm in 4/4', 'Name the notes of C major']);
  await page.screenshot({ path: receipt(info, 'signpost-one-ticked') });

  // Mid-swing the arm is on its way round, in front of the post.
  await open(page, 'section=signposts&only=timber&still=1&t=0.1&ticked=1');
  const [moving] = await state<PostState[]>(page);
  expect(moving?.arms[1]?.swing ?? 0).toBeGreaterThan(0.2);
  expect(moving?.arms[1]?.swing ?? 9).toBeLessThan(Math.PI - 0.2);
  expect(errors).toEqual([]);
});

test('every signpost style stands, carries its arms in any script and raises its pennant when passed', async ({ page }, info) => {
  const errors = watchErrors(page);
  await open(page, 'section=signposts&still=1&t=4&ticked=0&passed=1');
  const posts = await state<PostState[]>(page);
  expect(posts.map((post) => post.key)).toEqual(['timber', 'cairn', 'trig-pillar', 'blaze-post', 'snow-pole', 'buoy', 'summit-flag']);
  for (const post of posts) {
    expect(post.up, post.key).toBeGreaterThan(0.97);
    expect(post.pennant, post.key).toBeCloseTo(1, 2);
    expect(post.arms.length, post.key).toBeGreaterThanOrEqual(2);
    expect(post.arms[0]?.ticked).toBe(true);
    for (const arm of post.arms) expect(arm.lines.length, `${post.key}: ${arm.lines.join(' / ')}`).toBeGreaterThanOrEqual(1);
  }
  const all = posts.flatMap((post) => post.arms.map((arm) => arm.lines.join(' ')));
  expect(all).toContain('写一个函数');
  expect(all).toContain('اقرأ الخريطة');
  expect(all).toContain('Привет, мир');
  expect(all).toContain('Größenverhältnisse erklären');
  // The one item that is far too long ends in an ellipsis and says so.
  const long = posts.find((post) => post.key === 'cairn')?.arms[1];
  expect(long?.truncated).toBe(true);
  expect(long?.lines.at(-1)?.endsWith('…')).toBe(true);
  await page.screenshot({ path: receipt(info, 'signposts') });
  expect(errors).toEqual([]);
});

interface PartsState {
  rungs: number;
  flags: number[];
  due: boolean;
  ring: number;
  passed: boolean;
  walker: { x: number; walk: number; phase: number; swing: number; facing: number; pose: { bob: number; lean: number; nearLeg: number; farLeg: number } };
  screen: { cairn: Point; ring: Point; ringLeft: Point; flagSlots: Point[]; walker: Point; board: Point };
}
interface Point {
  x: number;
  y: number;
}

test('a camp with two of three flags up, and a cairn that shows its ring when due', async ({ page }, info) => {
  const errors = watchErrors(page);
  await open(page, 'section=parts&still=1&t=4&rungs=2&due=1&labels=0');
  const parts = await state<PartsState>(page);
  expect(parts.rungs).toBe(2);
  expect(parts.flags[0]).toBeCloseTo(1, 2);
  expect(parts.flags[1]).toBeCloseTo(1, 2);
  expect(parts.flags[2]).toBeCloseTo(0, 2);
  expect(parts.due).toBe(true);
  expect(parts.ring).toBeCloseTo(1, 1);
  await page.screenshot({ path: receipt(info, 'camp-two-flags-cairn-due') });

  // Close up on the camp: two flags fly at their places on the pole, the third place is empty.
  await open(page, 'section=parts&only=camp&still=1&t=4&rungs=2&labels=0');
  const camp = await state<PartsState>(page);
  const flown = await Promise.all(camp.screen.flagSlots.map((slot) => pixel(page, slot, 1)));
  expect(luma(flown[0] ?? []), 'first flag').toBeGreaterThan(140);
  expect(luma(flown[1] ?? []), 'second flag').toBeGreaterThan(140);
  expect(luma(flown[2] ?? []), 'third place').toBeLessThan(luma(flown[1] ?? []) - 50);
  await page.screenshot({ path: receipt(info, 'camp-two-flags') });

  await open(page, 'section=parts&only=camp&still=1&t=4&rungs=0&labels=0');
  const lowered = await state<PartsState>(page);
  expect(lowered.flags.every((flag) => Math.abs(flag) < 0.01)).toBe(true);
  expect(luma(await pixel(page, lowered.screen.flagSlots[0] ?? { x: 0, y: 0 }, 1))).toBeLessThan(luma(flown[0] ?? []) - 50);

  // Close up on the cairn: the ring lies round it in the route colour, and only when it is due.
  await open(page, 'section=parts&only=cairn&still=1&t=4&due=1&labels=0');
  const due = await state<PartsState>(page);
  expect(isSignal(await pixel(page, due.screen.ring, 1)), 'ring to the right').toBe(true);
  expect(isSignal(await pixel(page, due.screen.ringLeft, 1)), 'ring to the left').toBe(true);
  expect(isSignal(await pixel(page, { x: due.screen.cairn.x, y: due.screen.cairn.y - 12 }, 1)), 'the cairn itself').toBe(false);
  await page.screenshot({ path: receipt(info, 'cairn-due') });

  await open(page, 'section=parts&only=cairn&still=1&t=4&due=0&labels=0');
  const rest = await state<PartsState>(page);
  expect(rest.ring).toBeCloseTo(0, 2);
  expect(isSignal(await pixel(page, rest.screen.ring, 1))).toBe(false);
  expect(isSignal(await pixel(page, rest.screen.ringLeft, 1))).toBe(false);
  expect(errors).toEqual([]);
});

test('the walker walks as a puppet, the board takes its stamp, and a tap makes the walker wobble', async ({ page }, info) => {
  const errors = watchErrors(page);
  await open(page, 'section=parts&still=1&t=1.1&walk=0.42&passed=1&labels=0');
  const walking = await state<PartsState>(page);
  expect(walking.passed).toBe(true);
  expect(walking.walker.walk).toBeGreaterThan(0.5);
  expect(walking.walker.phase).toBeGreaterThan(4);
  expect(Math.abs(walking.walker.pose.nearLeg) + walking.walker.pose.bob * 10).toBeGreaterThan(0.1);
  expect(walking.walker.pose.nearLeg + walking.walker.pose.farLeg).toBeCloseTo(0, 5);
  await page.screenshot({ path: receipt(info, 'walker-walking') });

  // A different moment of the same walk is a different pose.
  await page.evaluate(() => (window as unknown as { __props: { step(seconds: number): void } }).__props.step(0.15));
  const later = await state<PartsState>(page);
  expect(later.walker.x).toBeGreaterThan(walking.walker.x);
  expect(Math.abs(later.walker.pose.nearLeg - walking.walker.pose.nearLeg)).toBeGreaterThan(0.05);

  // Standing still, then tapped: only a tap on his paper counts.
  await open(page, 'section=parts&only=walker&still=1&t=2&labels=0');
  const still = await state<PartsState>(page);
  expect(still.walker.swing).toBe(0);
  expect(still.walker.pose.bob).toBe(0);
  const canvas = page.locator('#stage');
  await canvas.click({ position: { x: 12, y: 12 } });
  expect(await page.evaluate(() => (window as unknown as { __props: { lastTap: string | null } }).__props.lastTap)).toBeNull();
  await canvas.click({ position: { x: still.screen.walker.x, y: still.screen.walker.y } });
  expect(await page.evaluate(() => (window as unknown as { __props: { lastTap: string | null } }).__props.lastTap)).toBe('walker');
  const tapped = await state<PartsState>(page);
  expect(Math.abs(tapped.walker.swing)).toBeGreaterThan(0.02);
  expect(Math.abs(tapped.walker.swing)).toBeLessThanOrEqual(0.14);
  await page.screenshot({ path: receipt(info, 'walker-tapped') });
  // The wobble dies away.
  await page.evaluate(() => (window as unknown as { __props: { step(seconds: number): void } }).__props.step(2));
  expect((await state<PartsState>(page)).walker.swing).toBe(0);
  expect(errors).toEqual([]);
});

test('scenery follows the surface and stands up by its triggers', async ({ page }, info) => {
  const errors = watchErrors(page);
  await open(page, 'section=scenery&still=1&t=4&count=9&labels=0');
  const panels = await state<{ id: string; x: number; z: number; trigger: string; up: number }[][]>(page);
  expect(panels).toHaveLength(8);
  const surfaces = ['water', 'sand', 'grass', 'forest', 'dirt', 'scree', 'rock', 'snow'];
  panels.forEach((items, index) => {
    expect(items).toHaveLength(9);
    for (const item of items) {
      expect([surfaces[index], 'sky'], item.id).toContain(item.id.split('/')[0]);
      expect(item.up, `${item.id} on ${surfaces[index]}`).toBeGreaterThan(0.9);
    }
  });
  await page.screenshot({ path: receipt(info, 'scenery') });

  // Before the walker arrives, only the skyline and the middle ground are up.
  await open(page, 'section=scenery&only=forest&still=1&t=4&count=9&walker=-9&end=0&labels=0');
  const [forest] = await state<{ id: string; trigger: string; up: number }[][]>(page);
  for (const item of forest ?? []) {
    if (item.trigger === 'fraction') expect(item.up, item.id).toBeGreaterThan(0.9);
    else expect(item.up, item.id).toBeLessThan(0.1);
  }
  expect((forest ?? []).some((item) => item.trigger === 'near')).toBe(true);
  await page.screenshot({ path: receipt(info, 'scenery-forest-before-the-walker') });
  expect(errors).toEqual([]);
});

interface StationState {
  kind: string;
  names: string[];
  form: number;
  focus: number;
  up: number[];
  anchors: Point[];
}

test('the stations form one cut-out after another and bring one to the front', async ({ page }, info) => {
  const errors = watchErrors(page);
  await open(page, 'section=station&kind=altitudes&still=1&t=4&form=0.5');
  const half = await state<StationState>(page);
  expect(half.names).toEqual(['bronze', 'silver', 'gold', 'diamond']);
  expect(half.up[0]).toBeGreaterThan(0.95);
  expect(half.up[1]).toBeGreaterThan(0.95);
  expect(half.up[2]).toBeGreaterThan(0.95);
  expect(half.up[3]).toBeLessThan(0.05);

  await open(page, 'section=station&kind=altitudes&still=1&t=4&form=1&focus=2');
  const full = await state<StationState>(page);
  expect(full.up.every((up) => up > 0.95)).toBe(true);
  expect(full.focus).toBe(2);
  // The peaks rise from bronze to diamond: each anchor is higher on the screen than the one before.
  const size = page.viewportSize() ?? { width: 1280, height: 800 };
  for (const anchor of full.anchors) {
    expect(anchor.x).toBeGreaterThan(0);
    expect(anchor.x).toBeLessThan(size.width);
    expect(anchor.y).toBeGreaterThan(0);
  }
  await page.screenshot({ path: receipt(info, 'station-altitudes') });

  await open(page, 'section=station&kind=altitudes&still=1&t=4&form=1');
  const level = await state<StationState>(page);
  expect(level.anchors[3]?.y ?? 0).toBeLessThan((level.anchors[0]?.y ?? 0) - 30);

  await open(page, 'section=station&kind=carries&still=1&t=5&form=1&focus=3');
  const carries = await state<StationState>(page);
  expect(carries.names).toEqual(['stages', 'checkpoints', 'projects', 'sources', 'pace']);
  expect(carries.up.every((up) => up > 0.95)).toBe(true);
  // The card in focus has turned to the front: it is the one nearest the middle of the frame.
  const middle = (page.viewportSize()?.width ?? 1280) / 2;
  const front = carries.anchors.reduce((best, anchor, index) => (Math.abs(anchor.x - middle) < Math.abs((carries.anchors[best]?.x ?? 0) - middle) ? index : best), 0);
  expect(front).toBe(3);
  await page.screenshot({ path: receipt(info, 'station-carries') });
  expect(errors).toEqual([]);
});

test('with reduced motion everything stands at once and nothing sways or wobbles', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, 'section=parts&motion=reduced&still=1&rungs=3&due=1&labels=0');
  const parts = await state<PartsState>(page);
  expect(parts.flags).toEqual([1, 1, 1]);
  expect(parts.ring).toBe(1);
  expect(parts.walker.pose.bob).toBe(0);
  const canvas = page.locator('#stage');
  const first = await canvas.screenshot();
  await canvas.click({ position: { x: parts.screen.walker.x, y: parts.screen.walker.y } });
  expect((await state<PartsState>(page)).walker.swing).toBe(0);
  await page.evaluate(() => (window as unknown as { __props: { step(seconds: number): void } }).__props.step(1));
  const second = await canvas.screenshot();
  expect(second.equals(first)).toBe(true);
  expect(errors).toEqual([]);
});
