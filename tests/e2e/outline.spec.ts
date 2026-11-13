import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

/**
 * The outline, the half of the site that needs no WebGL: the prerendered page reads with JavaScript off, a
 * step is marked done with the keyboard alone and the profile's pin moves, and at A4 the trail card prints on
 * one page while the outline prints its links' addresses.
 */
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PAGE = '/dev/outline.html';
const TODAY = '2026-11-24';
const SAMPLES = ['deutsch-a1-von-null', 'langgraph-for-a-python-dev', 'music-theory-for-a-class', 'photography-basics', 'rust-for-a-python-dev', 'statistics-for-data-work'];

// The outline never needs WebGL; these tests prove it by switching WebGL off.
test.use({ launchOptions: { args: ['--disable-webgl', '--disable-3d-apis'] } });

let site = '';
test.beforeAll(() => {
  site = mkdtempSync(join(tmpdir(), 'zero-to-outline-'));
  const run = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/prerender.ts', '--shell', 'dev/outline.html', '--out', site], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, SITE_ORIGIN: '' },
  });
  if (run.status !== 0) throw new Error(`prerender failed:\n${run.stdout}\n${run.stderr}`);
});
test.afterAll(() => {
  if (site) rmSync(site, { recursive: true, force: true });
});

async function open(page: Page, query: string): Promise<void> {
  await page.goto(`${PAGE}?${query}&today=${TODAY}`);
  await page.waitForSelector('html[data-ready]');
}

const pdfPages = (pdf: Buffer): number => (pdf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;

test.describe('with JavaScript off', () => {
  test.use({ javaScriptEnabled: false });

  test('a prerendered roadmap page shows its title, stages, steps and links', async ({ page }, info) => {
    await page.goto(pathToFileURL(join(site, 'r', 'rust-for-a-python-dev', 'index.html')).href);
    await expect(page.locator('h1')).toHaveText('Zero to Rust, coming from Python');
    await expect(page.locator('section.zo-stage > header h2')).toHaveCount(5);
    await expect(page.locator('li.zo-step h3').first()).toBeVisible();
    const links = page.locator('a[href^="http"]');
    expect(await links.count()).toBeGreaterThan(10);
    for (const rel of await links.evaluateAll((all) => all.map((a) => a.getAttribute('rel') ?? ''))) expect(rel.split(' ')).toContain('noopener');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
    const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent()) ?? '{}') as { '@graph': { '@type': string }[] };
    expect(ld['@graph'][0]?.['@type']).toBe('LearningResource');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: info.outputPath('outline-no-js.png') });
  });

  test('the gallery page lists every example as real links', async ({ page }) => {
    await page.goto(pathToFileURL(join(site, 'gallery', 'index.html')).href);
    for (const id of SAMPLES) await expect(page.locator(`a[href="../r/${id}/"]`).first()).toBeVisible();
  });
});

test.describe('with WebGL off', () => {
  test('a step is marked done with the keyboard alone and the pin moves', async ({ page }, info) => {
    test.skip(info.project.name === 'phone', 'keyboard pass on the desktop project');
    await open(page, 'road=rust-for-a-python-dev&fresh=1');
    expect(
      await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
      }),
    ).toBe(false);
    const pin = page.locator('[data-zo-profile] [data-zo-mark="here"]');
    const before = Number(await pin.getAttribute('data-along'));

    let found = false;
    for (let i = 0; i < 80 && !found; i += 1) {
      await page.keyboard.press('Tab');
      found = await page.evaluate(() => document.activeElement?.matches('input[data-zo-done]') ?? false);
    }
    expect(found).toBe(true);
    const id = await page.evaluate(() => document.activeElement?.getAttribute('data-zo-done'));
    await page.keyboard.press('Space');

    await expect(page.locator(`input[data-zo-done="${id}"]`)).toBeChecked();
    await expect(page.locator(`#w-${id}`)).toHaveAttribute('data-done', '');
    await expect.poll(async () => Number(await pin.getAttribute('data-along'))).toBeGreaterThan(before);
    await expect(page.locator('.zo-step[data-here]')).not.toHaveAttribute('id', `w-${id}`);
    await page.locator('[data-zo-profile]').screenshot({ path: info.outputPath('profile-after-done.png') });

    // The step's working card opens and closes from the keyboard too.
    const toggle = page.locator(`#w-${id} .zo-work`);
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator(`#w-${id} .zl-waypoint`)).toBeVisible();
    await page.locator(`#w-${id} .zl-waypoint button`).first().focus();
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();
  });
});

test.describe('print at A4', () => {
  test('the trail card is one page for every example', async ({ page }, info) => {
    test.skip(info.project.name === 'phone', 'printing is checked once');
    for (const id of SAMPLES) {
      await page.emulateMedia({ media: 'screen' });
      await open(page, `road=${id}&seed=1&print=trail-card`);
      await page.emulateMedia({ media: 'print' });
      const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
      expect(pdfPages(pdf), id).toBe(1);
    }
  });

  test('the outline prints its link addresses and leaves the controls out', async ({ page }, info) => {
    test.skip(info.project.name === 'phone', 'printing is checked once');
    await open(page, 'road=photography-basics&seed=1&print=outline');
    await page.emulateMedia({ media: 'print' });
    const link = page.locator('.zo-outline a.zo-source-title').first();
    const href = (await link.getAttribute('href')) ?? '';
    expect(href).toMatch(/^https?:/);
    expect(await link.evaluate((a) => getComputedStyle(a, '::after').content)).toContain(href);
    expect(await page.locator('.zo-tools').first().evaluate((el) => getComputedStyle(el).display)).toBe('none');
    await page.screenshot({ path: info.outputPath('outline-print.png') });
  });
});
