import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

/**
 * Checks of the landing sections on their dev page. They read the document and measured boxes, never stored
 * images. Every capture is also saved as a receipt: into the folder named by RECEIPTS_DIR when it is set,
 * otherwise into the test's output folder.
 */

test.setTimeout(180_000);

const STOPS = ['what-it-is', 'how-it-works', 'on-the-trail', 'for-a-class', 'the-map', 'install', 'questions', 'start'];

function receipt(testInfo: TestInfo, name: string): string {
  const dir = (process.env.RECEIPTS_DIR ?? '').trim();
  if (!dir) return testInfo.outputPath(`${name}.png`);
  mkdirSync(dir, { recursive: true });
  return join(dir, `e2e-${testInfo.project.name}-${name}.png`);
}

async function open(page: Page, query = ''): Promise<string[]> {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  await page.goto(`/dev/sections.html?${query}`);
  await page.waitForFunction(() => document.documentElement.dataset.sections === 'ready', null, { timeout: 120_000 });
  return problems;
}

/** Scrolls to a share of the page and waits until the sections have shown that position. */
async function scrollToShare(page: Page, share: number): Promise<{ current: number; done: number }> {
  return page.evaluate(async (at) => {
    window.scrollTo(0, (document.documentElement.scrollHeight - window.innerHeight) * at);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const sections = (window as unknown as { __sections: { current: number; threadDone: number } }).__sections;
    return { current: sections.current, done: sections.threadDone };
  }, share);
}

const isWide = (page: Page): boolean => (page.viewportSize()?.width ?? 0) >= 900;

test('the page is text first: eight stops with real headings, in order, and no console errors', async ({ page }, testInfo) => {
  const problems = await open(page, 'motion=reduced');
  const sections = page.locator('#sections section.zs-stop');
  await expect(sections).toHaveCount(STOPS.length);
  expect(await sections.evaluateAll((nodes) => nodes.map((node) => node.id))).toEqual(STOPS);
  for (const id of STOPS) {
    const heading = page.locator(`#${id} h2`);
    await expect(heading).toHaveCount(1);
    await expect(heading).toBeVisible();
    expect(await page.locator(`#${id}`).getAttribute('aria-labelledby')).toBe(await heading.getAttribute('id'));
  }
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('#what-it-is h2')).toHaveText('A study plan you can walk.');
  await expect(page.locator('#what-it-is')).toContainText('zero-to is an agent skill that turns one prompt into an interactive learning roadmap.');
  // With reduced motion nothing is pinned and everything stands, so the whole page can be read in one pass.
  await expect(page.locator('#sections [data-pin]')).toHaveCount(0);
  expect(await page.locator('#sections .zs-rise:not(.is-up)').count()).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  expect(await page.evaluate(() => (document.getElementById('sections')?.innerText ?? '').split(/\s+/).length)).toBeGreaterThan(900);
  await page.screenshot({ path: receipt(testInfo, 'full-reduced'), fullPage: true });
  expect(problems).toEqual([]);
});

test('needs no WebGL: with every canvas context refused the same page is there', async ({ page }) => {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
  });
  const problems = await open(page);
  await expect(page.locator('#sections canvas')).toHaveCount(0);
  await expect(page.locator('#sections section.zs-stop h2')).toHaveCount(STOPS.length);
  await scrollToShare(page, 1);
  await expect(page.locator('form.zs-ticket')).toBeVisible();
  expect(problems).toEqual([]);
});

test('scrolling draws the thread further and walks the stops in order', async ({ page }) => {
  await open(page);
  let done = -1;
  let current = -1;
  const seen = new Set<number>();
  for (let step = 0; step <= 60; step += 1) {
    const state = await scrollToShare(page, step / 60);
    expect(state.done).toBeGreaterThanOrEqual(done);
    expect(state.current).toBeGreaterThanOrEqual(current);
    done = state.done;
    current = state.current;
    seen.add(state.current);
  }
  expect(current).toBe(STOPS.length - 1);
  expect([...seen].filter((index) => index >= 0)).toHaveLength(STOPS.length);
  expect(done).toBeGreaterThan(3000);
  // The route colour is on the page: at least one leg is drawn as done.
  expect(await page.locator('.zs-thread-done[d^="M"]').count()).toBeGreaterThan(10);
  // And it goes back when the page is scrolled back.
  expect((await scrollToShare(page, 0.2)).done).toBeLessThan(done);
});

test('a stop pins, forms and brings its things forward one after another', async ({ page }, testInfo) => {
  test.skip(!isWide(page), 'stops are pinned on wide windows only');
  await open(page, 'stop=what&hold=0.1');
  const stop = page.locator('#what-it-is');
  await expect(stop).toHaveAttribute('data-pin', '');
  await expect(stop.locator('.zs-peak.is-up')).toHaveCount(4);
  await expect(stop.locator('.zs-tier.is-on')).toHaveCount(1);
  await expect(stop.locator('.zs-tier.is-on h4')).toHaveText('Bronze');
  const box = await stop.locator('.zs-box').boundingBox();
  expect(Math.abs(box?.y ?? 99)).toBeLessThan(2);
  expect(Math.abs((box?.height ?? 0) - (page.viewportSize()?.height ?? 0))).toBeLessThan(2);

  // Further into the hold the last altitude is in front, and the box has not moved.
  await page.evaluate(() => {
    const section = document.getElementById('what-it-is') as HTMLElement;
    window.scrollTo(0, section.getBoundingClientRect().top + window.scrollY + (section.offsetHeight - window.innerHeight) * 0.9);
  });
  await expect(stop.locator('.zs-tier.is-on h4')).toHaveText('Diamond');
  expect(Math.abs((await stop.locator('.zs-box').boundingBox())?.y ?? 99)).toBeLessThan(2);
  await expect(page.locator('#nav-slot a[aria-current="location"]')).toHaveText(/What/);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: receipt(testInfo, 'stop-what') });
});

test('the index tabs lead to their stops', async ({ page }) => {
  await open(page, 'motion=reduced');
  const nav = page.locator('#nav-slot nav');
  await expect(nav).toHaveAttribute('aria-label', 'Sections');
  if (!isWide(page)) {
    // On a narrow window one tab hangs alone and opens the rest.
    const toggle = nav.locator('button.zs-nav-toggle');
    await expect(toggle).toBeVisible();
    await expect(nav.locator('a').first()).toBeHidden();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  }
  await expect(nav.locator('a')).toHaveCount(STOPS.length - 1);
  await nav.locator('a', { hasText: 'Install' }).click();
  await expect.poll(async () => page.evaluate(() => Math.round(document.getElementById('install')?.getBoundingClientRect().top ?? 9999))).toBeLessThan(4);
  await expect(nav.locator('a[aria-current="location"]')).toHaveText(/Install/);
  expect(await page.evaluate(() => location.hash)).toBe('#install');
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('install-title');
});

test('the ticket prints the command, escapes quotes and copies it when the stub is torn off', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
  await open(page, 'stop=start');
  const ticket = page.locator('form.zs-ticket');
  const command = ticket.locator('.zs-command');
  await expect(command).toHaveText('/zero-to <topic>, about 5 hours a week');

  await ticket.getByRole('button', { name: /Tear here to copy/ }).click();
  await expect(ticket.getByRole('status')).toHaveText('Punch in a topic first.');
  await expect(ticket.getByLabel('Topic')).toBeFocused();

  await ticket.getByLabel('Topic').fill('the "Dune" novels');
  await expect(command).toHaveText('/zero-to "the \\"Dune\\" novels", about 5 hours a week');
  await ticket.getByRole('radio', { name: 'A class I teach' }).check();
  await expect(command).toHaveText('/zero-to "the \\"Dune\\" novels", for a class I teach');
  await ticket.getByRole('radio', { name: 'Me', exact: true }).check();
  await ticket.getByRole('radio', { name: '10', exact: true }).check();
  await ticket.getByRole('checkbox', { name: 'Skip the interview and take the defaults' }).check();
  await expect(command).toHaveText('/zero-to "the \\"Dune\\" novels", about 10 hours a week --defaults');

  await ticket.getByRole('button', { name: /Tear here to copy/ }).click();
  await expect(ticket.getByRole('status')).toHaveText('Copied. Paste it into your agent.');
  await expect(ticket.locator('.zs-stub')).toHaveClass(/is-torn/);
  const copied = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
  if (copied !== null) expect(copied).toBe('/zero-to "the \\"Dune\\" novels", about 10 hours a week --defaults');
  await page.waitForTimeout(900);
  await page.screenshot({ path: receipt(testInfo, 'ticket-torn') });
});

test('every install path says it is untested, and its command can be copied', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
  await open(page, 'stop=install');
  const agents = page.locator('#install .zs-agent');
  await expect(agents).toHaveCount(3);
  expect(await agents.locator('.zs-state').allTextContents()).toEqual(['untested', 'untested', 'untested']);
  await expect(page.locator('#install')).toContainText('None of these paths has been run against a public release yet.');
  const first = agents.first().locator('.zs-cmd').first();
  await expect(first.locator('code')).toHaveText('npx skills add OthmanAdi/zero-to --skill zero-to');
  await first.getByRole('button').click();
  await expect(first.getByRole('button')).toHaveText('Copied');
});

test('the map stop draws the chosen mountain from the generator', async ({ page }, testInfo) => {
  await open(page, 'stop=map');
  const stop = page.locator('#the-map');
  const caption = stop.locator('.zs-print-caption');
  await expect(caption).toContainText('Volcano with a Spiral trail', { timeout: 30_000 });
  const before = await stop.locator('.zs-print-source g').innerHTML();
  expect(before).toContain('stroke-dasharray');

  await stop.getByRole('button', { name: 'Ridge', exact: true }).click();
  await expect(stop.getByRole('button', { name: 'Ridge', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(stop.getByRole('button', { name: 'Volcano' })).toHaveAttribute('aria-pressed', 'false');
  await expect(caption).toContainText('Ridge with a Spiral trail');
  await expect(stop.locator('.zs-describe')).toContainText('A long narrow spine');
  const ridge = await stop.locator('.zs-print-source g').innerHTML();
  expect(ridge).not.toBe(before);

  // A theme changes the ground and the default signpost. A new seed changes the landscape and nothing else.
  await stop.getByRole('button', { name: 'Desert expedition' }).click();
  await expect(stop.locator('.zs-post.is-in')).toHaveText('Cairn');
  expect(await stop.locator('.zs-swatch.is-in').allTextContents()).toEqual(expect.arrayContaining(['Sand', 'Dirt', 'Rock']));
  await stop.getByRole('button', { name: 'Roll a new seed' }).click();
  await expect(caption).toContainText('"zero-to-2"');
  await page.waitForTimeout(1600);
  await page.screenshot({ path: receipt(testInfo, 'stop-map') });
});

test('the questions open one at a time with the keyboard', async ({ page }) => {
  await open(page, 'stop=questions');
  const questions = page.locator('#questions details');
  await expect(questions).toHaveCount(8);
  await expect(questions.first()).toHaveAttribute('open', '');
  await questions.nth(1).locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(questions.nth(1)).toHaveAttribute('open', '');
  await expect(questions.nth(1)).toContainText('An AI agent writes it');
  await expect(page.locator('#questions details[open]')).toHaveCount(1);
});

test('the German page is German, command included', async ({ page }, testInfo) => {
  const problems = await open(page, 'ui=de&stop=start&topic=Rust');
  await expect(page.locator('#what-it-is h2')).toHaveText('Ein Lernplan, den man gehen kann.');
  await expect(page.locator('#sections')).toHaveAttribute('lang', 'de');
  await expect(page.locator('#nav-slot nav')).toHaveAttribute('aria-label', 'Abschnitte');
  await expect(page.locator('form.zs-ticket .zs-command')).toHaveText('/zero-to Rust, etwa 5 Stunden pro Woche');
  expect(await page.locator('#install .zs-state').allTextContents()).toEqual(['ungetestet', 'ungetestet', 'ungetestet']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: receipt(testInfo, 'start-de') });
  expect(problems).toEqual([]);
});

test('nothing reaches past the window at any stop, and every control is large enough to touch', async ({ page }) => {
  await open(page, 'motion=reduced');
  for (const id of STOPS) {
    await page.locator(`#${id}`).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), id).toBeLessThanOrEqual(0);
  }
  if (!isWide(page)) {
    const small = await page.locator('#sections button, #sections a, #sections summary, #sections .zs-punch-face').evaluateAll((nodes) =>
      nodes
        .map((node) => ({ box: node.getBoundingClientRect(), text: (node.textContent ?? '').trim().slice(0, 30) }))
        .filter(({ box }) => box.width > 0 && box.height > 0 && box.height < 30)
        .map(({ text, box }) => `${text}: ${Math.round(box.height)}`),
    );
    expect(small).toEqual([]);
  }
});
