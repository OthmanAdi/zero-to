import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

/**
 * Checks of the look dev page. They measure properties of real captures (outline length, pixel counts, text
 * widths) and never compare against stored images, because GPUs differ. Every capture is also saved as a
 * receipt: into the folder named by RECEIPTS_DIR when it is set, otherwise into the test's output folder.
 */

// The scenes are drawn by a software renderer in the test browser, which is slow on a busy machine.
test.setTimeout(240_000);

function receipt(testInfo: TestInfo, name: string): string {
  const dir = (process.env.RECEIPTS_DIR ?? '').trim();
  if (!dir) return testInfo.outputPath(`${name}.png`);
  mkdirSync(dir, { recursive: true });
  return join(dir, `e2e-${testInfo.project.name}-${name}.png`);
}

async function open(page: Page, query: string): Promise<void> {
  await page.goto(`/dev/look.html?${query}`);
  await page.waitForFunction(() => document.documentElement.dataset.look === 'ready', null, { timeout: 180_000 });
}

interface Outline {
  /** Length of the boundary between light and dark, in capture pixels. */
  length: number;
  /** Number of light pixels. */
  area: number;
}

/**
 * Traces the boundary between light and dark in a capture and returns its length. The boundary is followed
 * between pixel centres at half brightness (marching squares with interpolation), so an anti-aliased edge is
 * measured to a fraction of a pixel. `invert` measures the dark shape on a light ground.
 */
async function outline(page: Page, png: Buffer, invert: boolean): Promise<Outline> {
  return page.evaluate(
    async ({ data, invert: flip }) => {
      const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2D canvas');
      ctx.drawImage(bitmap, 0, 0);
      const { width, height } = bitmap;
      const pixels = ctx.getImageData(0, 0, width, height).data;
      const field = new Float32Array(width * height);
      let area = 0;
      for (let i = 0; i < field.length; i += 1) {
        const value = (0.2126 * (pixels[i * 4] ?? 0) + 0.7152 * (pixels[i * 4 + 1] ?? 0) + 0.0722 * (pixels[i * 4 + 2] ?? 0)) / 255;
        const level = flip ? 1 - value : value;
        field[i] = level - 0.5;
        if (level > 0.5) area += 1;
      }
      const at = (x: number, y: number) => field[y * width + x] ?? 0;
      let length = 0;
      for (let y = 0; y < height - 1; y += 1) {
        for (let x = 0; x < width - 1; x += 1) {
          const a = at(x, y);
          const b = at(x + 1, y);
          const c = at(x + 1, y + 1);
          const d = at(x, y + 1);
          const cuts: number[] = [];
          if (a * b < 0) cuts.push(a / (a - b), 0);
          if (b * c < 0) cuts.push(1, b / (b - c));
          if (d * c < 0) cuts.push(d / (d - c), 1);
          if (a * d < 0) cuts.push(0, a / (a - d));
          for (let i = 0; i + 3 < cuts.length; i += 4) {
            length += Math.hypot((cuts[i + 2] ?? 0) - (cuts[i] ?? 0), (cuts[i + 3] ?? 0) - (cuts[i + 1] ?? 0));
          }
        }
      }
      return { length, area };
    },
    { data: png.toString('base64'), invert },
  );
}

interface Matte {
  setMatte(mode: 'none' | 'sheet' | 'shadow'): void;
  setDeckle(value: number): void;
  render(): void;
}

async function matte(page: Page, mode: 'none' | 'sheet' | 'shadow', deckle: number): Promise<void> {
  await page.evaluate(
    ({ mode: wanted, deckle: amount }) => {
      const sheet = (window as unknown as { __look: { sheet: Matte | null } }).__look.sheet;
      if (!sheet) throw new Error('the sheet scene is not on this page');
      sheet.setMatte(wanted);
      sheet.setDeckle(amount);
      sheet.render();
    },
    { mode, deckle },
  );
}

test('the type sheet shows all three faces loaded', async ({ page }, testInfo) => {
  await open(page, 'section=type&t=0');
  const look = await page.evaluate(() => {
    const hooks = (window as unknown as { __look: { fonts: { ready: boolean; missing: string[] } | null; widths: Record<string, { face: number; fallback: number }> | null } }).__look;
    return { fonts: hooks.fonts, widths: hooks.widths };
  });
  expect(look.fonts?.missing).toEqual([]);
  expect(look.fonts?.ready).toBe(true);
  for (const role of ['display', 'text', 'label']) {
    const width = look.widths?.[role];
    expect(width, role).toBeTruthy();
    // A face that did not load is drawn in its fallback and measures the same.
    expect(Math.abs((width?.face ?? 0) - (width?.fallback ?? 0)), `${role} differs from its fallback`).toBeGreaterThan(1);
  }
  // The same in the DOM: each specimen is set in its own family.
  const families = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-face]'), (element) => {
      const style = getComputedStyle(element);
      return {
        role: element.dataset.face,
        loaded: document.fonts.check(`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`),
        family: style.fontFamily.split(',')[0]?.replace(/["']/g, '').trim(),
      };
    }),
  );
  expect(families.map((entry) => entry.family)).toEqual(['Fraunces', 'Atkinson Hyperlegible Next', 'IBM Plex Mono']);
  expect(families.every((entry) => entry.loaded)).toBe(true);

  // The headline keeps its size rule: 64 px on a wide window, 40 px on a phone.
  const headline = await page.evaluate(() => Number.parseFloat(getComputedStyle(document.querySelector('.zt-headline') as Element).fontSize));
  const wide = (page.viewportSize()?.width ?? 0) >= 1200;
  if (wide) expect(headline).toBeGreaterThan(56);
  else expect(headline).toBeLessThan(48);
  // Nothing on the sheet is wider than the window.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: receipt(testInfo, 'type') });
});

test('focus is a lamp ring on the room and an ink ring with a lamp halo on paper', async ({ page }, testInfo) => {
  await open(page, 'section=type&t=0');
  const ring = () =>
    page.evaluate(() => {
      const element = document.activeElement as HTMLElement;
      const style = getComputedStyle(element);
      return {
        id: element.id,
        visible: element.matches(':focus-visible'),
        color: style.outlineColor,
        width: style.outlineWidth,
        offset: style.outlineOffset,
        line: style.outlineStyle,
        shadow: style.boxShadow,
      };
    });
  await page.keyboard.press('Tab');
  const room = await ring();
  expect(room).toMatchObject({ id: 'focus-room', visible: true, color: 'rgb(255, 217, 160)', width: '2px', offset: '2px', line: 'solid' });
  expect(room.shadow).toBe('none');
  await page.keyboard.press('Tab');
  const paper = await ring();
  expect(paper).toMatchObject({ id: 'focus-paper', visible: true, color: 'rgb(31, 42, 61)', width: '2px', offset: '2px', line: 'solid' });
  expect(paper.shadow).toContain('rgb(255, 217, 160)');
  await page.locator('.note').screenshot({ path: receipt(testInfo, 'focus-paper') });
});

test('the brand mark renders at 16, 32 and 512 px', async ({ page }, testInfo) => {
  await open(page, 'section=brand&t=0');
  for (const size of [16, 32, 512]) {
    const plate = page.locator(`[data-mark="${size}"]`);
    await expect(plate.locator('svg')).toHaveAttribute('viewBox', '0 0 32 32');
    const counts = await page.evaluate(
      async ({ data }) => {
        const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no 2D canvas');
        ctx.drawImage(bitmap, 0, 0);
        const pixels = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
        let ink = 0;
        let signal = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          const r = pixels[i] ?? 0;
          const g = pixels[i + 1] ?? 0;
          const b = pixels[i + 2] ?? 0;
          if (r > 200 && g > 200 && b > 200) ink += 1;
          else if (r > 170 && g < 120 && b < 100) signal += 1;
        }
        return { ink, signal, total: pixels.length / 4 };
      },
      { data: (await plate.screenshot()).toString('base64') },
    );
    // The ring covers a good share of the plate and the signal half of the needle is there.
    expect(counts.ink / counts.total, `ink at ${size}`).toBeGreaterThan(0.12);
    expect(counts.signal / counts.total, `signal at ${size}`).toBeGreaterThan(0.012);
  }

  // The 16 px cut on its true pixels: the ring's sides are two full pixels wide with clean ground beside them.
  const row = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-zoom="16"]');
    const ctx = canvas?.getContext('2d');
    if (!ctx) throw new Error('no zoom canvas');
    const data = ctx.getImageData(0, 8, 16, 1).data;
    return Array.from({ length: 16 }, (_, x) => data[x * 4] ?? 0);
  });
  expect(row[2]).toBeGreaterThan(215);
  expect(row[3]).toBeGreaterThan(215);
  expect(row[1]).toBeLessThan(60);
  expect(row[4]).toBeLessThan(60);
  expect(row[12]).toBeGreaterThan(215);
  expect(row[13]).toBeGreaterThan(215);
  expect(row[14]).toBeLessThan(60);
  await page.screenshot({ path: receipt(testInfo, 'brand') });
});

test('a standing sheet has a torn outline and its shadow has the same one', async ({ page }, testInfo) => {
  // One cut-out, held still after it has stood up. Close on a stretch of its upper edge, near enough that the
  // fray of the tear is larger than a pixel on a phone too. From the distance of the table the fray fades out
  // by design and only the wander of the edge is left.
  await open(page, 'section=sheet&solo=1&still=1&t=4&cam=edge');
  const canvas = page.locator('#sheet canvas');
  await page.screenshot({ path: receipt(testInfo, 'sheet-close') });

  await matte(page, 'sheet', 0.006);
  const tornShot = await canvas.screenshot({ path: receipt(testInfo, 'sheet-matte-torn') });
  const torn = await outline(page, tornShot, false);
  await matte(page, 'sheet', 0);
  const smoothShot = await canvas.screenshot({ path: receipt(testInfo, 'sheet-matte-smooth') });
  const smooth = await outline(page, smoothShot, false);

  testInfo.annotations.push({ type: 'outline of the sheet, torn to smooth', description: (torn.length / smooth.length).toFixed(3) });
  expect(smooth.length).toBeGreaterThan(400);
  // The same sheet with the tear switched off is the smooth outline. The torn edge is at least 1.15 times as long.
  expect(torn.length / smooth.length).toBeGreaterThanOrEqual(1.15);
  // It is the same shape: the tear moves the edge, it does not eat the sheet.
  expect(Math.abs(torn.area - smooth.area) / smooth.area).toBeLessThan(0.02);

  // The shadow alone, on plain white ground, seen from above and close, for the same reason.
  await open(page, 'section=sheet&solo=1&still=1&t=4&cam=shadow-edge');
  await matte(page, 'shadow', 0.006);
  const tornShadowShot = await page.locator('#sheet canvas').screenshot({ path: receipt(testInfo, 'shadow-matte-torn') });
  const tornShadow = await outline(page, tornShadowShot, true);
  await matte(page, 'shadow', 0);
  const smoothShadowShot = await page.locator('#sheet canvas').screenshot({ path: receipt(testInfo, 'shadow-matte-smooth') });
  const smoothShadow = await outline(page, smoothShadowShot, true);

  testInfo.annotations.push({
    type: 'outline of the shadow, torn to smooth',
    description: (tornShadow.length / smoothShadow.length).toFixed(3),
  });
  expect(smoothShadow.area).toBeGreaterThan(2000);
  // The shadow is cast by the same outline field: its edge is torn too, and it loses the tear with the sheet.
  expect(tornShadow.length / smoothShadow.length).toBeGreaterThanOrEqual(1.05);
  expect(Math.abs(tornShadow.area - smoothShadow.area) / smoothShadow.area).toBeLessThan(0.03);

  // And the whole of it, lit, for the eye.
  await open(page, 'section=sheet&solo=1&still=1&t=4&cam=shadow');
  await page.screenshot({ path: receipt(testInfo, 'shadow-lit') });
});

test('the lamp puts a paper card top in its band without clipping', async ({ page }, testInfo) => {
  await open(page, 'section=paper&still=1&t=0');
  const calibration = await page.evaluate(
    () => (window as unknown as { __look: { calibration: { top: number[]; mid: number[]; low: number[]; pass: boolean } | null } }).__look.calibration,
  );
  expect(calibration).toBeTruthy();
  const top = calibration?.top ?? [];
  expect(top[1]).toBeGreaterThanOrEqual(228);
  expect(top[1]).toBeLessThanOrEqual(245);
  expect(Math.max(...top, ...(calibration?.mid ?? []), ...(calibration?.low ?? []))).toBeLessThan(253);
  // Warm light: red above green above blue on white paper.
  expect(top[0]).toBeGreaterThan(top[1] ?? 0);
  expect(top[1]).toBeGreaterThan(top[2] ?? 0);
  await page.screenshot({ path: receipt(testInfo, 'lamp') });
});

test('reduced motion holds the sheet scene still', async ({ page }) => {
  await open(page, 'section=sheet&solo=1&motion=reduced');
  const canvas = page.locator('#sheet canvas');
  const first = await canvas.screenshot();
  await page.waitForTimeout(700);
  const second = await canvas.screenshot();
  expect(first.equals(second)).toBe(true);
});
