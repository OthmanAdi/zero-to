import { expect, test, type Page, type TestInfo } from '@playwright/test';

/**
 * The overlay on its dev page: where each part sits on a wide window and on a phone, that no part lies on
 * another, that the note stays off the walker, that both languages fit, and that the keyboard reaches
 * everything. Screenshots go to the test's output folder, or to the folder named by `RECEIPTS_DIR`.
 */

const PAGE = '/dev/hud.html';
/** Positions may be off by this share of the window. */
const TOLERANCE = 0.03;

interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const PARTS: Readonly<Record<string, string>> = {
  brand: '.zh-brand',
  tools: '.zh-tools',
  start: '.zh-start',
  headline: '.zh-headline',
  lede: '.zh-lede',
  hint: '.zh-hint',
  counter: '.zh-counter',
  previous: '.zh-arrow[data-dir="previous"]',
  next: '.zh-arrow[data-dir="next"]',
  enter: '.zh-enter',
  side: '.zh-side',
  shelf: '.zh-shelf .zt-dock__panel, .zh-shelf .zt-dock__toggle',
  note: '.zh-note-paper',
  strip: '.zh-profile-strip',
  readout: '.zh-profile-readout',
};

async function shot(page: Page, info: TestInfo, name: string): Promise<void> {
  const dir = process.env.RECEIPTS_DIR;
  const path = dir ? `${dir.replace(/[\\/]+$/, '')}/e2e-${info.project.name}-${name}.png` : info.outputPath(`${name}.png`);
  await page.screenshot({ path });
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

async function open(page: Page, query: string, size?: { width: number; height: number }): Promise<void> {
  if (size) await page.setViewportSize(size);
  await page.goto(`${PAGE}?still=1&${query}`);
  await expect(page.locator('html')).toHaveAttribute('data-hud', 'ready');
  // Let the note finish its move to a side.
  await page.waitForTimeout(1700);
}

/** The boxes of the parts that are shown. The side card's box is the box of its lines. */
async function boxes(page: Page): Promise<Record<string, Box>> {
  return page.evaluate((parts) => {
    const shown = (el: Element | null): boolean => {
      if (!el) return false;
      for (let node: Element | null = el; node && node !== document.body; node = node.parentElement) {
        if (node.hasAttribute('data-off') || (node as HTMLElement).hidden) return false;
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
      }
      return true;
    };
    const out: Record<string, { x: number; y: number; w: number; h: number }> = {};
    for (const [key, selector] of Object.entries(parts)) {
      const el = [...document.querySelectorAll(selector)].find(shown);
      if (!el) continue;
      let rect = { left: 0, top: 0, width: 0, height: 0 };
      if (key === 'side') {
        const lines = [...el.children].filter(shown).map((child) => child.getBoundingClientRect());
        if (lines.length === 0) continue;
        const left = Math.min(...lines.map((b) => b.left));
        const top = Math.min(...lines.map((b) => b.top));
        rect = { left, top, width: Math.max(...lines.map((b) => b.right)) - left, height: Math.max(...lines.map((b) => b.bottom)) - top };
      } else {
        rect = el.getBoundingClientRect();
      }
      if (rect.width > 0 && rect.height > 0) out[key] = { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
    }
    return out;
  }, PARTS);
}

function overlaps(all: Record<string, Box>, ignore: readonly string[] = []): string[] {
  const found: string[] = [];
  const keys = Object.keys(all);
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = all[keys[i]!]!;
      const b = all[keys[j]!]!;
      const pair = `${keys[i]} x ${keys[j]}`;
      if (ignore.includes(pair)) continue;
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > 1 && oy > 1) found.push(`${pair} (${Math.round(ox)} by ${Math.round(oy)})`);
    }
  }
  return found;
}

/** Labels whose text is wider than their box, and whether the page scrolls sideways. */
async function misfits(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const shown = (el: Element): boolean => {
      for (let node: Element | null = el; node && node !== document.body; node = node.parentElement) {
        if (node.hasAttribute('data-off') || (node as HTMLElement).hidden) return false;
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
      }
      return true;
    };
    const labels = '.zh-hud .zt-label, .zh-hud .zh-tab, .zh-hud .zh-enter-sub, .zh-hud .zh-start, .zh-hud .zh-btn, .zh-hud .zh-kbd';
    for (const el of document.querySelectorAll<HTMLElement>(labels)) {
      if (!shown(el) || el.clientWidth === 0) continue;
      // A label that is cut on purpose says so with an ellipsis rule.
      if (getComputedStyle(el).textOverflow === 'ellipsis') continue;
      if (el.scrollWidth > el.clientWidth + 1) out.push(`${el.className}: "${(el.textContent ?? '').trim().slice(0, 40)}"`);
      const box = el.getBoundingClientRect();
      if (box.right > window.innerWidth + 1 || box.left < -1) out.push(`outside the window: "${(el.textContent ?? '').trim().slice(0, 40)}"`);
    }
    if (document.documentElement.scrollWidth > window.innerWidth) out.push('the page scrolls sideways');
    return out;
  });
}

const near = (value: number, wanted: number, span: number): boolean => Math.abs(value - wanted) <= TOLERANCE * span;

test.describe('wide window', () => {
  test.skip(({ isMobile }) => isMobile, 'a phone has its own layout');

  test('the table view puts every part where the layout says, at 1440 by 900', async ({ page }, info) => {
    const errors = watchErrors(page);
    await open(page, 'done=4', { width: 1440, height: 900 });
    const b = await boxes(page);
    const W = 1440;
    const H = 900;
    const at = (name: string): Box => {
      expect(b[name], `${name} is shown`).toBeTruthy();
      return b[name]!;
    };
    expect(near(at('brand').x, 48, W) && near(at('brand').y, 28, H)).toBe(true);
    expect(near(at('start').x + at('start').w, W - 46, W) && near(at('start').y, 23, H)).toBe(true);
    expect(Math.round(at('start').h)).toBe(38);
    expect(near(at('start').w, 164, W)).toBe(true);
    expect(near(at('headline').x, 46, W) && near(at('headline').y, 190, H)).toBe(true);
    expect(at('headline').w).toBeLessThanOrEqual(430);
    expect(near(at('lede').x, 46, W)).toBe(true);
    expect(Math.round(at('lede').y - (at('headline').y + at('headline').h))).toBe(24);
    expect(at('lede').w).toBeLessThanOrEqual(330);
    expect(Math.round(at('hint').y - (at('lede').y + at('lede').h))).toBe(28);
    // The ball of the enter button, between the compass and the sheet.
    expect(near(at('enter').x + 25, 637, W) && near(at('enter').y + at('enter').h / 2, 520, H)).toBe(true);
    expect(near(at('previous').x + 26, 500, W) && near(at('previous').y + 26, 704, H)).toBe(true);
    expect(near(at('next').x + 26, 940, W) && near(at('next').y + 26, 704, H)).toBe(true);
    expect(Math.round(at('previous').w)).toBe(52);
    expect(near(at('side').x + at('side').w, W - 46, W) && near(at('side').y, 250, H)).toBe(true);
    expect(Math.round(at('side').w)).toBe(360);
    expect(Math.round(at('shelf').w)).toBe(380);
    expect(Math.round(at('shelf').h)).toBe(196);
    expect(Math.round(W - (at('shelf').x + at('shelf').w))).toBe(46);
    expect(Math.round(H - (at('shelf').y + at('shelf').h))).toBe(40);
    // The counter is text beside the arrows. There is no row of picker tabs.
    expect(at('counter').x + at('counter').w).toBeLessThan(at('previous').x);
    await expect(page.locator('.zh-counter')).toHaveText(/01\s*\/\s*05/);
    await expect(page.locator('.zh-counter button')).toHaveCount(0);
    expect(overlaps(b)).toEqual([]);
    expect(await misfits(page)).toEqual([]);
    await shot(page, info, 'table-1440');
    expect(errors).toEqual([]);
  });

  test('the walk view puts every part where the layout says, at 1440 by 900', async ({ page }, info) => {
    const errors = watchErrors(page);
    await open(page, 'done=4&mode=walk&p=0.3&side=left', { width: 1440, height: 900 });
    const b = await boxes(page);
    const W = 1440;
    const H = 900;
    expect(near(b.tools!.x + b.tools!.w, W - 46, W) && near(b.tools!.y, 23, H)).toBe(true);
    await expect(page.locator('.zh-tools .zh-tool:visible')).toHaveCount(5);
    expect((await page.locator('.zh-tools .zh-tool:visible').first().boundingBox())!.width).toBe(38);
    // The note: left 40, top 82, 340 wide, no taller than the window minus 250.
    const note = (await page.locator('.zh-note').boundingBox())!;
    expect(Math.round(note.x)).toBe(40);
    expect(Math.round(note.y)).toBe(82);
    expect(Math.round(note.width)).toBe(340);
    expect(b.note!.h).toBeLessThanOrEqual(H - 250 + 12);
    await expect(page.locator('.zh-note [role="tab"]')).toHaveText(['Note', 'Do', 'Take with you']);
    // The profile: left 40, right 446, bottom 28, 84 high, with its readout above.
    expect(Math.round(b.strip!.x)).toBe(40);
    expect(Math.round(W - (b.strip!.x + b.strip!.w))).toBe(446);
    expect(Math.round(H - (b.strip!.y + b.strip!.h))).toBe(28);
    expect(Math.round(b.strip!.h)).toBe(84);
    expect(b.readout!.y + b.readout!.h).toBeLessThanOrEqual(b.strip!.y);
    expect(Math.round(b.shelf!.w)).toBe(380);
    expect(Math.round(W - (b.shelf!.x + b.shelf!.w))).toBe(46);
    expect(Math.round(H - (b.shelf!.y + b.shelf!.h))).toBe(40);
    expect(overlaps(b)).toEqual([]);
    expect(await misfits(page)).toEqual([]);
    await shot(page, info, 'walk-1440');
    expect(errors).toEqual([]);
  });

  for (const lang of ['en', 'de'] as const) {
    test(`no overlay lies on another at 1024 by 768 (${lang})`, async ({ page }, info) => {
      const size = { width: 1024, height: 768 };
      await open(page, `done=4&ui=${lang}`, size);
      expect(overlaps(await boxes(page))).toEqual([]);
      expect(await misfits(page)).toEqual([]);
      await shot(page, info, `table-1024-${lang}`);
      for (const side of ['left', 'right']) {
        for (const item of ['', 'signpost', 'camp']) {
          await open(page, `done=4&mode=walk&p=0.3&ui=${lang}&side=${side}&item=${item}`, size);
          const b = await boxes(page);
          expect(overlaps(b), `${side} ${item}`).toEqual([]);
          expect(await misfits(page), `${side} ${item}`).toEqual([]);
          // Nothing of the note hangs out of its paper.
          const inside = await page.evaluate(() => {
            const paper = document.querySelector('.zh-note-paper')!.getBoundingClientRect();
            return [...document.querySelectorAll('.zh-note-paper > :not(.zt-tape)')]
              .filter((el) => getComputedStyle(el).display !== 'none')
              .every((el) => el.getBoundingClientRect().bottom <= paper.bottom + 2);
          });
          expect(inside, `${side} ${item}`).toBe(true);
          if (item === '') await shot(page, info, `walk-1024-${side}-${lang}`);
        }
      }
    });
  }

  test('the note never covers the walker', async ({ page }) => {
    test.setTimeout(120_000);
    for (const size of [
      { width: 1440, height: 900 },
      { width: 1024, height: 768 },
    ]) {
      await open(page, 'done=4&mode=walk&p=0.02', size);
      for (const p of [0.02, 0.16, 0.3, 0.44, 0.58, 0.72, 0.99]) {
        const result = await page.evaluate(async (along) => {
          const dev = (window as unknown as { __hud: { seek(v: number): void; walker(): { x: number; y: number } } }).__hud;
          dev.seek(along);
          await new Promise((resolve) => setTimeout(resolve, 1650));
          const note = document.querySelector('.zh-note-paper')!.getBoundingClientRect();
          const walker = dev.walker();
          const covered = walker.x >= note.left && walker.x <= note.right && walker.y >= note.top && walker.y <= note.bottom;
          return { covered, side: document.querySelector<HTMLElement>('.zh-note')!.dataset.side };
        }, p);
        expect(result.covered, `p ${p} at ${size.width}: note at the ${result.side}`).toBe(false);
      }
    }
  });

  test('the keyboard reaches everything in order, and panels give focus back', async ({ page }) => {
    await open(page, '', { width: 1440, height: 900 });
    const focusName = (): Promise<string> =>
      page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el ? (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ') : '';
      });
    await page.keyboard.press('Tab');
    expect(await focusName()).toBe('Skip to list view');
    await page.keyboard.press('Tab');
    expect(await focusName()).toBe('zero-to, back to the table');
    await page.keyboard.press('Tab');
    expect(await focusName()).toBe('List view');
    await page.keyboard.press('Tab');
    expect(await focusName()).toBe('Open a roadmap');
    await page.keyboard.press('Tab');
    expect(await focusName()).toBe('Shortcuts');
    // Enter on the tool opens the list. Escape closes it and focus is back on the tool.
    await page.keyboard.press('Enter');
    await expect(page.locator('dialog[data-panel="shortcuts"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog[data-panel="shortcuts"]')).toBeHidden();
    expect(await focusName()).toBe('Shortcuts');
    await page.keyboard.press('Tab');
    expect(await focusName()).toContain('Start a roadmap');
    await page.keyboard.press('Tab');
    expect(await focusName()).toBe('Previous roadmap');
    await page.keyboard.press('Tab');
    expect(await focusName()).toContain('Walk this roadmap');
    await page.keyboard.press('Tab');
    expect(await focusName()).toBe('Next roadmap');
    await page.keyboard.press('Tab');
    expect(await focusName()).toContain('Share');
    // Every stop shows a ring.
    const ring = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
    expect(ring).not.toBe('none');
    // Right turns the table: the counter and the card answer at once.
    await page.locator('body').click({ position: { x: 700, y: 120 } });
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.zh-counter')).toHaveText(/02\s*\/\s*05/);
    await expect(page.locator('.zh-card-title')).toHaveText('Zero to LangGraph, coming from Python');
    // Enter goes in. D ticks the step under the walker. Escape folds the map.
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Enter');
    await expect(page.locator('.zh-hud')).toHaveAttribute('data-mode', 'walk');
    await page.keyboard.press('d');
    await page.locator('.zh-note [role="tab"]').nth(1).click();
    await expect(page.locator('.zh-note input.zl-check-box')).toBeChecked();
    await page.locator('body').click({ position: { x: 700, y: 120 } });
    await page.keyboard.press('Escape');
    await expect(page.locator('.zh-hud')).toHaveAttribute('data-mode', 'table');
  });

  test('the note teaches: guess first, then do, then pin a key point into the notebook', async ({ page }, info) => {
    await open(page, 'mode=walk&p=0.3&side=left', { width: 1440, height: 900 });
    const note = page.locator('.zh-note');
    // Walk to a step that asks for a guess: the question comes before the sources.
    await page.evaluate(() => (window as unknown as { __hud: { bus: { emit(e: unknown): void } } }).__hud.bus.emit({ type: 'go', waypointId: 'moves' }));
    await expect(note.locator('.zh-note-title')).toHaveText('Who owns the value');
    await expect(note.locator('.zl-predict')).toBeVisible();
    await expect(note.locator('[data-part="do"]')).toBeHidden();
    // Take with you: pin the first key point.
    await note.getByRole('tab', { name: 'Take with you' }).click();
    await expect(note.locator('[data-part="note"]')).toBeHidden();
    await note.locator('[data-part="take"] .zl-pin').first().click();
    await expect(page.locator('.zh-tool-count')).toHaveText('1');
    await page.locator('[data-tool="notebook"]').click();
    const drawer = page.locator('dialog[data-panel="notebook"]');
    await expect(drawer).toBeVisible();
    await expect(drawer.locator('.zl-notebook')).toContainText(/1 entry/);
    await shot(page, info, 'notebook');
  });

  test('a roadmap from outside is previewed with its counts and applied only on confirm', async ({ page }, info) => {
    await open(page, 'panel=preview', { width: 1440, height: 900 });
    const dialog = page.locator('dialog[data-panel="open"]');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.zh-fact')).toHaveCount(7);
    await expect(dialog).toContainText('Zero to LangGraph, coming from Python');
    await expect(page.locator('.zh-headline')).toHaveText('Zero to Rust, coming from Python');
    await shot(page, info, 'preview');
    await dialog.getByRole('button', { name: 'Open this roadmap' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('.zh-headline')).toHaveText('Zero to LangGraph, coming from Python');
  });
});

test.describe('phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'the wide layout is checked above');
  const size = { width: 390, height: 844 };

  test('the table view follows the phone layout at 390 by 844', async ({ page }, info) => {
    const errors = watchErrors(page);
    await open(page, 'done=4', size);
    const b = await boxes(page);
    const W = 390;
    const H = 844;
    expect(near(b.brand!.x, 16, W) && near(b.brand!.y, 16, H)).toBe(true);
    expect(near(b.headline!.x, 16, W) && near(b.headline!.y, 104, H)).toBe(true);
    expect(b.lede!.w).toBeLessThanOrEqual(320);
    expect(b.hint).toBeUndefined();
    // Counter and arrows share the line at bottom 76. The enter button is centred at bottom 132.
    for (const name of ['counter', 'previous', 'next']) expect(Math.round(H - (b[name]!.y + b[name]!.h))).toBe(76);
    expect(b.previous!.w).toBeGreaterThanOrEqual(44);
    expect(Math.round(H - (b.enter!.y + b.enter!.h))).toBe(132);
    expect(near(b.enter!.x + b.enter!.w / 2, W / 2, W)).toBe(true);
    // The side card is a strip of two lines beside the round shelf button.
    const side = (await page.locator('.zh-side').boundingBox())!;
    expect(Math.round(side.x)).toBe(16);
    expect(Math.round(W - (side.x + side.width))).toBe(84);
    expect(Math.round(H - (side.y + side.height))).toBe(16);
    expect(side.height).toBeLessThanOrEqual(48);
    expect(Math.round(b.shelf!.w)).toBe(52);
    expect(Math.round(W - (b.shelf!.x + b.shelf!.w))).toBe(16);
    expect(Math.round(H - (b.shelf!.y + b.shelf!.h))).toBe(16);
    expect(overlaps(b)).toEqual([]);
    expect(await misfits(page)).toEqual([]);
    await shot(page, info, 'table-390');
    expect(errors).toEqual([]);
  });

  test('the walk view: a 96 px peek, the profile above it, and a sheet that opens to 70 percent', async ({ page }, info) => {
    await open(page, 'done=4&mode=walk&p=0.3', size);
    const H = 844;
    const note = page.locator('.zh-note');
    const peek = (await note.boundingBox())!;
    expect(Math.round(H - peek.y)).toBe(96);
    const b = await boxes(page);
    expect(Math.round(b.strip!.h)).toBe(56);
    expect(b.strip!.y + b.strip!.h).toBeLessThanOrEqual(peek.y);
    expect(peek.y - (b.strip!.y + b.strip!.h)).toBeLessThanOrEqual(12);
    expect(overlaps(b, ['note x strip', 'note x readout'])).toEqual([]);
    await expect(page.locator('.zh-minimap')).toBeHidden();
    await expect(page.locator('.zh-note-foot')).toBeHidden();
    await expect(page.locator('.zh-ribbon-hour')).toBeVisible();
    await expect(page.locator('.zh-note-title')).toBeVisible();
    await shot(page, info, 'walk-390');
    // The body of a shut sheet is out of the keyboard's path.
    expect(await page.locator('.zh-note-body').evaluate((el) => el.hasAttribute('inert'))).toBe(true);
    await page.locator('.zh-note-grip').click();
    await page.waitForTimeout(600);
    const open70 = (await note.boundingBox())!;
    expect(Math.abs(open70.height - 0.7 * H)).toBeLessThanOrEqual(2);
    expect(Math.round(open70.y + open70.height)).toBe(H);
    expect(await page.locator('.zh-note-body').evaluate((el) => el.hasAttribute('inert'))).toBe(false);
    await expect(page.locator('.zh-note-grip')).toHaveAttribute('aria-expanded', 'true');
    await shot(page, info, 'walk-390-sheet');
  });

  for (const lang of ['en', 'de'] as const) {
    test(`every label fits at 320 px (${lang})`, async ({ page }, info) => {
      const narrow = { width: 320, height: 640 };
      await open(page, `ui=${lang}&done=4`, narrow);
      expect(await misfits(page)).toEqual([]);
      expect(overlaps(await boxes(page))).toEqual([]);
      await shot(page, info, `table-320-${lang}`);
      await open(page, `ui=${lang}&done=4&mode=walk&p=0.3&sheet=1`, narrow);
      expect(await misfits(page)).toEqual([]);
      await shot(page, info, `walk-320-${lang}`);
      for (const panel of ['shortcuts', 'share', 'open', 'preview']) {
        await open(page, `ui=${lang}&panel=${panel}`, narrow);
        await expect(page.locator('dialog[open]')).toBeVisible();
        expect(await misfits(page), panel).toEqual([]);
        const fits = await page.locator('dialog[open]').evaluate((el) => {
          const box = el.getBoundingClientRect();
          return box.left >= 0 && box.right <= window.innerWidth && el.scrollWidth <= el.clientWidth + 1;
        });
        expect(fits, panel).toBe(true);
      }
    });
  }
});
