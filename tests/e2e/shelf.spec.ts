import { expect, test, type Page, type TestInfo } from '@playwright/test';

/**
 * The resource shelf on its dev page: the dock with three and with seven volumes, keyboard and focus, the
 * reader page of a volume, and the phone's bottom sheet. Screenshots go to the test's output folder, or to
 * the folder named by `RECEIPTS_DIR` when it is set.
 */

const PAGE = '/dev/shelf.html';

async function shot(page: Page, info: TestInfo, name: string, target?: ReturnType<Page['locator']>): Promise<void> {
  const dir = process.env.RECEIPTS_DIR;
  const path = dir ? `${dir.replace(/[\\/]+$/, '')}/${info.project.name}-${name}.png` : info.outputPath(`${name}.png`);
  if (target) await target.screenshot({ path });
  else await page.screenshot({ path });
}

async function settled(page: Page): Promise<void> {
  await expect(page.locator('.bb-shelf')).toHaveAttribute('data-settled', '1');
}

/** B puts focus on the presented volume (a key of the dev page, as of the site). Waits for the row to be built. */
async function focusShelf(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await expect(async () => {
    await page.keyboard.press('b');
    expect(await page.evaluate(() => document.activeElement?.classList.contains('bb-book__control'))).toBe(true);
  }).toPass({ timeout: 3000 });
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

/** Keep the real WebGL drawing but exercise the capable-device branch on the software test browser. */
async function reportCapableHardware(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'hardwareConcurrency', { value: 8 });
    Object.defineProperty(navigator, 'deviceMemory', { value: 8 });
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, options?: WebGLContextAttributes) {
      return Reflect.apply(getContext, this, [
        kind,
        options?.failIfMajorPerformanceCaveat ? { ...options, failIfMajorPerformanceCaveat: false } : options,
      ]);
    } as typeof getContext;
    const getParameter = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function (parameter: number) {
      if (parameter === 0x9246 || parameter === this.RENDERER) return 'Test graphics adapter';
      return getParameter.call(this, parameter);
    };
  });
}

test.describe('the dock', () => {
  test.skip(({ isMobile }) => isMobile, 'the phone shows a button and a sheet instead');

  for (const [count, query] of [
    [3, '?road=sample&stage=0&n=3&still=1'],
    [7, '?road=sample&stage=4&still=1'],
  ] as const) {
    test(`stands ${count} volumes in 380 by 196, none narrower than 30 px`, async ({ page }, info) => {
      const errors = watchErrors(page);
      await page.goto(`${PAGE}${query}`);
      await settled(page);
      const dock = page.locator('.zt-dock');
      const box = (await dock.boundingBox())!;
      expect(Math.round(box.width)).toBe(380);
      expect(Math.round(box.height)).toBe(196);
      await expect(page.locator('button.bb-book__control')).toHaveCount(count);
      await expect(page.locator('.bb-shelf')).toHaveAttribute('data-fixed', '1');
      await expect(page.locator('.zt-dock__header')).toContainText(`${count} sources`);
      const widths = await page.locator('li.bb-book:not([aria-hidden]) .bb-book__spine').evaluateAll((spines) =>
        spines.map((spine) => parseFloat(getComputedStyle(spine).width)),
      );
      expect(Math.min(...widths)).toBeGreaterThanOrEqual(30 - 0.01);
      await shot(page, info, `dock-${count}`, dock);
      expect(errors).toEqual([]);
    });
  }

  test('names the gated and unverified sources in the header and the caption', async ({ page }) => {
    await page.goto(`${PAGE}?road=fixture&present=fixture-course&still=1`);
    await settled(page);
    await expect(page.locator('.zt-dock__header')).toHaveText(/sources · opened 2026-11-13 · 1 gated · 1 unverified/);
    await expect(page.locator('.zt-dock__status')).toHaveText('behind a login · opened 2026-11-13');
  });

  test('moves with the arrow keys, opens on Enter, and gives focus back on Escape', async ({ page }, info) => {
    await page.goto(`${PAGE}?road=sample&stage=4&still=1`);
    await settled(page);
    await focusShelf(page);
    const shelf = page.locator('.bb-shelf');
    const first = await shelf.getAttribute('data-focus-id');
    await page.keyboard.press('ArrowRight');
    await expect(shelf).not.toHaveAttribute('data-focus-id', first ?? '');
    await settled(page);
    const second = await shelf.getAttribute('data-focus-id');

    await page.keyboard.press('Enter');
    const reader = page.locator('.bb-reader');
    await expect(reader).toHaveAttribute('data-open', '1');
    await expect(reader.locator('.bb-reader__title')).not.toBeEmpty();
    await expect(reader.locator('.bb-reader__note')).not.toBeEmpty();
    const original = reader.locator('a.bb-reader__open');
    await expect(original).toHaveAttribute('href', /^https?:\/\//);
    await expect(original).toHaveAttribute('rel', /noopener/);
    await expect(reader.locator('.bb-reader__body')).toContainText('How it was checked');
    await expect(reader.locator('.bb-reader__body')).toContainText('Your task at this step');
    await expect(reader.locator('.zt-reader__pin')).toHaveText(/Pin to notebook/);
    await expect(reader.locator('.bb-reader__done')).toHaveText('Mark as used');
    await shot(page, info, 'reader');

    await page.keyboard.press('Escape');
    await expect(reader).toHaveCount(0);
    const focused = await page.evaluate(() => ({
      control: document.activeElement?.classList.contains('bb-book__control') ?? false,
      id: document.activeElement?.closest<HTMLElement>('li.bb-book')?.dataset.id ?? null,
    }));
    expect(focused).toEqual({ control: true, id: second });
  });

  test('opens without a travelling cover under reduced motion', async ({ page }) => {
    await reportCapableHardware(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${PAGE}?road=sample&stage=2&still=1`);
    await settled(page);
    await focusShelf(page);
    await page.keyboard.press('Enter');
    // The fade itself is 150 ms. The first frames of the reader are slow under the software renderer the
    // project's browser runs with, so the wait is generous; what this test asserts is that nothing travels.
    await expect(page.locator('.bb-reader')).toHaveAttribute('data-open', '1', { timeout: 6000 });
    await expect(page.locator('.bb-flight')).toHaveCount(0);
    await expect(page.locator('.bb-studio')).toHaveCount(0);
  });

  test('renders Studio on a capable device and keeps the same controls after WebGL loss', async ({ page }, info) => {
    test.setTimeout(90_000);
    const errors = watchErrors(page);
    await reportCapableHardware(page);
    await page.goto(`${PAGE}?road=sample&stage=0&n=3&still=1`);
    const shelf = page.locator('.bb-shelf');
    const studio = shelf.locator('canvas.bb-studio');
    await expect(shelf).toHaveAttribute('data-paint', 'studio', { timeout: 45_000 });
    await expect(studio).toHaveAttribute('data-volumes', '3');
    await shot(page, info, 'studio', page.locator('.zt-dock'));

    const first = await shelf.getAttribute('data-focus-id');
    await focusShelf(page);
    await page.keyboard.press('ArrowRight');
    await expect(shelf).not.toHaveAttribute('data-focus-id', first ?? '');
    await settled(page);
    const second = await shelf.getAttribute('data-focus-id');

    await studio.evaluate((canvas: HTMLCanvasElement) => {
      canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
    });
    await expect(studio).toHaveCount(0);
    await expect(shelf).not.toHaveAttribute('data-paint', 'studio');
    await expect(shelf).toHaveAttribute('data-focus-id', second ?? '');
    await expect(shelf.locator('button.bb-book__control:focus')).toBeVisible();

    await page.keyboard.press('Enter');
    const reader = page.locator('.bb-reader');
    await expect(reader).toHaveAttribute('data-open', '1');
    await expect(reader.locator('a.bb-reader__open')).toHaveAttribute('href', /^https?:\/\//);
    await page.keyboard.press('Escape');
    await expect(reader).toHaveCount(0);
    await expect(shelf.locator('button.bb-book__control:focus')).toBeVisible();
    await expect(studio).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test.describe('the phone sheet', () => {
  test.skip(({ isMobile }) => !isMobile, 'the desktop shows the dock itself');

  test('opens the same row from a round button and closes again', async ({ page }, info) => {
    const errors = watchErrors(page);
    await page.goto(`${PAGE}?road=sample&stage=4&still=1`);
    const toggle = page.locator('.zt-dock__toggle');
    await expect(toggle).toHaveText(/Sources \(7\)/);
    const box = (await toggle.boundingBox())!;
    expect(Math.round(box.width)).toBe(52);
    await toggle.tap();
    await expect(page.locator('.zt-dock')).toHaveAttribute('data-sheet', 'open');
    await expect(page.locator('button.bb-book__control')).toHaveCount(7);
    await settled(page);
    const panel = (await page.locator('.zt-dock__panel').boundingBox())!;
    expect(Math.round(panel.height)).toBe(300);
    await shot(page, info, 'sheet');

    await page.locator('.bb-book.is-centre .bb-book__cover').tap();
    await expect(page.locator('.bb-reader')).toHaveAttribute('data-open', '1');
    await page.locator('.bb-reader__close').tap();
    await expect(page.locator('.bb-reader')).toHaveCount(0);
    await page.locator('.zt-dock__close').tap();
    await expect(page.locator('.zt-dock')).toHaveAttribute('data-sheet', 'closed');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
});
