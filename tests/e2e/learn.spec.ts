import { expect, test, type Page } from '@playwright/test';

/**
 * The learning cards in a real browser, on the dev page: the predict question opens the sources, the whole
 * waypoint card works from the keyboard alone, progress survives a reload, and the interface switches to German.
 */
const PAGE = '/dev/learn.html';
const TODAY = '2026-11-16';

async function open(page: Page, query: string): Promise<void> {
  await page.goto(`${PAGE}?${query}&today=${TODAY}`);
  await expect(page.locator('.zl-card').first()).toBeVisible();
}

test('the sources open only after the predict question is answered or skipped', async ({ page }) => {
  await open(page, 'card=waypoint&wp=moves&reset=1');
  const links = page.locator('.zl-source-title');
  await expect(links.first()).not.toHaveAttribute('href');
  await expect(page.getByText('Answer or skip the question above to open the sources.')).toBeVisible();

  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(links.first()).toHaveAttribute('href', 'https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html');
  await expect(links.first()).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(page.getByText('You skipped the question.')).toBeVisible();
});

test('a guess with options, Done and a rating, all from the keyboard, survive a reload', async ({ page }) => {
  await open(page, 'card=waypoint&wp=guessing-game&reset=1');
  const card = page.locator('.zl-waypoint');

  // Tab from the page start into the card: the first control in the card is the first guess.
  await page.locator('.dev-head select').focus();
  await page.keyboard.press('Tab'); // the language link
  await page.keyboard.press('Tab');
  await expect(card.locator('.zl-predict input[type=radio]').first()).toBeFocused();
  await page.keyboard.press('ArrowDown'); // the second option: "It does not compile"
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Save my guess' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(card.locator('.zl-guess-text')).toHaveText('It does not compile');

  // Check the guess after reading: the matching check has kept it.
  const check = card.getByRole('button', { name: 'Check my answer' });
  await check.focus();
  await page.keyboard.press('Enter');
  await expect(card.locator('.zl-verdict')).toContainText('Right.');

  const done = card.getByRole('checkbox', { name: 'Done' });
  await done.focus();
  await page.keyboard.press('Space');
  await expect(done).toBeChecked();
  const rating = card.getByRole('group', { name: 'How far did you get?' });
  await expect(rating).toBeVisible();
  await rating.getByRole('radio', { name: 'Saw it' }).focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(rating.getByRole('radio', { name: 'Did it alone' })).toBeChecked();
  await expect(card.locator('.zl-step[data-chosen]')).toHaveCount(1);

  await card.getByRole('button', { name: 'Pin key point 1' }).focus();
  await page.keyboard.press('Enter');
  await expect(card.getByRole('button', { name: 'Pin key point 1' })).toHaveAttribute('aria-pressed', 'true');

  await page.goto(`${PAGE}?card=waypoint&wp=guessing-game&today=${TODAY}`);
  await expect(page.getByRole('checkbox', { name: 'Done' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Did it alone' })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Pin key point 1' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.zl-verdict')).toContainText('Right.');
});

test('Tab visits the controls of every card in document order, each with a visible focus ring', async ({ page }) => {
  await open(page, 'seed=1&wp=moves');
  const expected = await page.evaluate(() => {
    const all = [...document.querySelectorAll<HTMLElement>('.zl-card a[href], .zl-card button, .zl-card input, .zl-card select, .zl-card textarea')];
    return all
      .filter((el) => !el.closest('[hidden]') && !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0)
      .filter((el) => !(el instanceof HTMLInputElement && el.type === 'radio' && !el.checked && document.querySelector(`input[type=radio][name="${el.name}"]:checked`)))
      .filter((el, i, list) => !(el instanceof HTMLInputElement && el.type === 'radio' && !el.checked && list.slice(0, i).some((o) => o instanceof HTMLInputElement && o.name === el.name)))
      .map((el, i) => {
        el.dataset.tabProbe = String(i);
        return i;
      }).length;
  });
  await page.locator('.zl-card').first().evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.locator('.dev-head a').focus();
  const seen: number[] = [];
  let ringMissing = 0;
  for (let i = 0; i < expected; i += 1) {
    await page.keyboard.press('Tab');
    const probe = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el?.dataset.tabProbe) return null;
      const style = getComputedStyle(el);
      return { index: Number(el.dataset.tabProbe), ring: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2 };
    });
    if (!probe) break;
    seen.push(probe.index);
    if (!probe.ring) ringMissing += 1;
  }
  expect(seen.length).toBeGreaterThan(40);
  expect(seen).toEqual([...seen].sort((a, b) => a - b));
  expect(ringMissing).toBe(0);
});

test('the interface speaks German with ?ui=de, roadmap text stays as written', async ({ page }) => {
  await open(page, 'card=waypoint&wp=toolchain&ui=de&reset=1');
  await expect(page.getByRole('checkbox', { name: 'Erledigt' })).toBeVisible();
  await expect(page.locator('.zl-waypoint')).toHaveAttribute('lang', 'de');
  await expect(page.locator('.zl-title')).toHaveText('Install and run');
  await expect(page.locator('.zl-title')).toHaveAttribute('lang', 'en');
});

test('blocked storage keeps working in memory and says so', async ({ page }) => {
  await open(page, 'card=waypoint&wp=toolchain&storage=blocked');
  await expect(page.getByText(/Kept for this visit only/)).toBeVisible();
  await page.getByRole('checkbox', { name: 'Done' }).check();
  await expect(page.getByRole('group', { name: 'How far did you get?' })).toBeVisible();
});
