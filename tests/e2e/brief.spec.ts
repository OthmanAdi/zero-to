import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { datedClass, fillInline, latestSession, ownDeutsch, ownRust, receiptFor, type FixtureRoadmap } from './fixtures';

/**
 * Roadmap mode of the landing sections: with a person's own roadmap the eight stops are its trip brief. The
 * stops are mounted by a test host (`host/brief.html`) the way a page with a roadmap mounts them, with the
 * receipt, a clock, a keeper for the start and the take-along actions. One check uses the sections' own dev
 * page and its `setRoadmap` handle. The checks read the document and measured boxes, never stored images.
 * Every capture is saved as a receipt: into the folder named by RECEIPTS_DIR when it is set, otherwise into the
 * test's output folder.
 */

test.setTimeout(180_000);

const HOST = '/tests/e2e/host/brief.html';
/** The day every check of this file runs on: a Friday, the day after session 10 of the dated class. */
const TODAY = '2026-11-13';
const STOPS = ['what-it-is', 'how-it-works', 'on-the-trail', 'for-a-class', 'the-map', 'install', 'questions', 'start'];
const TABS_EN = ['Route', 'Sources', 'Counts', 'Pace', 'Map', 'Upkeep', 'Gaps'];

/** What the host is given before the page loads. See `host/brief.ts`. */
interface HostSetup {
  roadmap?: FixtureRoadmap | null;
  receipt?: object | null;
  plan?: { startDay?: string; hoursPerWeek?: number; deadline?: string } | null;
  today?: string;
  keepStart?: boolean;
  actions?: string[];
}

interface HostWindow {
  __hostRecord: { started: { on: string; hoursPerWeek: number }[]; actions: string[] };
  __sections: { setRoadmap(roadmap: unknown): void; current: number };
}

function receipt(testInfo: TestInfo, name: string): string {
  const dir = (process.env.RECEIPTS_DIR ?? '').trim();
  if (!dir) return testInfo.outputPath(`${name}.png`);
  mkdirSync(dir, { recursive: true });
  return join(dir, `e2e-${testInfo.project.name}-${name}.png`);
}

function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  return problems;
}

const isPhone = (testInfo: TestInfo): boolean => testInfo.project.name === 'phone';

/** Opens the host with a roadmap at 1440 by 900, or 390 by 844 on the phone, on a fixed day. */
async function open(page: Page, testInfo: TestInfo, setup: HostSetup, query = ''): Promise<string[]> {
  const problems = watch(page);
  await page.setViewportSize(isPhone(testInfo) ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await page.clock.setFixedTime(new Date(`${TODAY}T10:00:00Z`));
  await page.addInitScript((value) => {
    (window as unknown as { __host: unknown }).__host = value;
  }, setup);
  await page.goto(`${HOST}?${query}`);
  await page.waitForFunction(() => document.documentElement.dataset.sections === 'ready', null, { timeout: 120_000 });
  return problems;
}

/** Scrolls to a stop, into its hold when it is pinned, and lets its things come forward. */
async function goTo(page: Page, id: string, hold = 0.9): Promise<void> {
  await page.evaluate(
    ({ id, hold }) => {
      const section = document.getElementById(id) as HTMLElement;
      const top = section.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, top + (section.hasAttribute('data-pin') ? (section.offsetHeight - window.innerHeight) * hold : 0));
    },
    { id, hold },
  );
  await page.waitForTimeout(1200);
}

const overflow = (page: Page): Promise<number> => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const tabs = (page: Page): Promise<string[]> => page.locator('#nav-slot nav a span:last-child').allTextContents();
/** The sentence of the pace stop. Numbers and their units, and the parts of a day, are joined by no-break spaces: patterns match them with \s. */
const paceSentence = (page: Page) => page.locator('#for-a-class p.zs-lede[aria-live]');

test.describe('a roadmap of your own', () => {
  test('turns the eight stops into its trip brief, every word of it read from the file', async ({ page }, testInfo) => {
    const roadmap = ownRust();
    const counts = receiptFor(roadmap);
    const problems = await open(page, testInfo, { roadmap, receipt: counts, today: TODAY, keepStart: true, actions: ['print', 'download'] }, 'motion=reduced');

    // The same eight stops, in the same order, each with its own heading: the page is still text first.
    const stops = page.locator('#sections section.zs-stop');
    await expect(stops).toHaveCount(STOPS.length);
    expect(await stops.evaluateAll((nodes) => nodes.map((node) => node.id))).toEqual(STOPS);
    await expect(page.locator('#sections section.zs-stop.zs-brief')).toHaveCount(STOPS.length);
    for (const id of STOPS) {
      const heading = page.locator(`#${id} h2`);
      await expect(heading).toHaveCount(1);
      await expect(heading).toBeVisible();
      expect(await page.locator(`#${id}`).getAttribute('aria-labelledby')).toBe(await heading.getAttribute('id'));
    }
    expect(await tabs(page)).toEqual(TABS_EN);

    // 01 The route: the title as the file writes it, set as text in the roadmap's language.
    const title = page.locator('#what-it-is h2');
    await expect(title).toHaveText(roadmap.title);
    await expect(title).toHaveAttribute('lang', roadmap.lang);
    expect(await title.evaluate((node) => node.children.length)).toBe(0);
    await expect(page.locator('#what-it-is')).toContainText('5 stages, about 42 h.');

    // 02 Sources: the receipt's counts, and the three sources that are not verified, named with their notes.
    await expect(page.locator('#how-it-works h2')).toHaveText(`${counts.opened} opened, ${counts.kept} kept.`);
    expect(await page.locator('#how-it-works .zs-slips .zs-slip').allTextContents()).toEqual([`${counts.kept - 3} verified`, '1 gated', '2 unverified', '6 dead, not written']);
    await expect(page.locator('#how-it-works')).toContainText('3 sources are listed with a warning.');
    await expect(page.locator('#how-it-works')).toContainText('Test data: the exercises ask for an account.');

    // 03 Counts: what the file carries, side trails included.
    await expect(page.locator('#on-the-trail')).toContainText('5 stages, 19 steps');
    await expect(page.locator('#on-the-trail')).toContainText('2 steps are side trails you may skip.');

    // 04 Pace: the hours of the file against its own start and date.
    await expect(page.locator('#for-a-class h2')).toHaveText('Your hours against the calendar.');
    await expect(paceSentence(page)).toHaveText(/^At 4\sh a week the route takes \d+\sweeks\. Starting on 2\sNov\s2026, you arrive on \d{1,2}\s\w{3}\s2027\. That is \d+\sdays (before|after) your date, 28\sFeb\s2027\.$/);

    // 06 Upkeep: the actions the page offers, and nothing it was not given.
    const install = page.locator('#install');
    await expect(install.getByRole('button', { name: 'Print the trail card' })).toBeVisible();
    await expect(install.getByRole('button', { name: 'Download the file' })).toBeVisible();
    await expect(install.getByRole('button', { name: 'Share link' })).toHaveCount(0);
    await install.getByRole('button', { name: 'Download the file' }).click();
    expect(await page.evaluate(() => (window as unknown as HostWindow).__hostRecord.actions)).toEqual(['download']);

    // 07 Gaps: every step with a gap line, the file's own and the two of the fixture.
    await expect(page.locator('#questions')).toContainText('3 steps carry a gap line: the agent could verify no source for them.');
    await expect(page.locator('#questions')).toContainText('Test data: the only exercise track found asks for an account.');

    // 08 Start: a permit for this route, not the ticket of the tour.
    await expect(page.locator('#start h2')).toHaveText('Punch your start.');
    await expect(page.locator('#start form.zs-b-permit')).toContainText(roadmap.title);

    expect(await overflow(page)).toBeLessThanOrEqual(0);
    expect(problems).toEqual([]);
  });

  test('on a phone every control of the brief is large enough to touch', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo), 'touch targets are checked on the phone');
    // Known miss: the links of the sources that are not verified (02 Sources) are 21 px tall at 390 px. The
    // sections own the fix. Remove this line with it, and the check holds the brief to the tour's floor.
    test.fail(true, 'the links of the not-verified sources are 21 px tall on a phone');
    const roadmap = ownRust();
    await open(page, testInfo, { roadmap, receipt: receiptFor(roadmap), today: TODAY, keepStart: true, actions: ['print', 'download'] }, 'motion=reduced');
    const small = await page.locator('#sections button, #sections a, #sections summary, #sections .zs-punch-face').evaluateAll((nodes) =>
      nodes
        .map((node) => ({ box: node.getBoundingClientRect(), text: (node.textContent ?? '').trim().slice(0, 30) }))
        .filter(({ box }) => box.width > 0 && box.height > 0 && box.height < 30)
        .map(({ text, box }) => `${text}: ${Math.round(box.height)}`),
    );
    expect(small).toEqual([]);
  });

  test('every stop of the brief fits the window, pinned on a wide one and in the flow on a phone', async ({ page }, testInfo) => {
    const roadmap = ownRust();
    const problems = await open(page, testInfo, { roadmap, receipt: receiptFor(roadmap), today: TODAY, keepStart: true });
    const wide = !isPhone(testInfo);
    for (const id of STOPS) {
      await goTo(page, id);
      const facts = await page.evaluate((stop) => {
        const section = document.getElementById(stop) as HTMLElement;
        const box = section.querySelector('.zs-box')?.getBoundingClientRect() ?? null;
        return { brief: section.classList.contains('zs-brief'), pinned: section.hasAttribute('data-pin'), boxTop: box ? box.top : null, boxHeight: box ? box.height : null };
      }, id);
      expect(facts.brief, id).toBe(true);
      expect(await overflow(page), id).toBeLessThanOrEqual(0);
      // The first five stops hold the screen on a wide window. A phone has nothing pinned.
      if (!wide) expect(facts.pinned, id).toBe(false);
      if (wide && STOPS.indexOf(id) < 5) {
        expect(facts.pinned, id).toBe(true);
        expect(Math.abs(facts.boxTop ?? 99), id).toBeLessThan(2);
        expect(Math.abs((facts.boxHeight ?? 0) - 900), id).toBeLessThan(2);
      }
      await page.screenshot({ path: receipt(testInfo, `brief-${id}`) });
    }
    expect(problems).toEqual([]);
  });

  test('the pace control changes this view only, and the reset brings the plan back', async ({ page }, testInfo) => {
    await open(page, testInfo, { roadmap: ownRust(), today: TODAY, keepStart: true }, 'stop=class&hold=0.95');
    await goTo(page, 'for-a-class', 0.95);
    const sentence = paceSentence(page);
    const before = (await sentence.textContent()) ?? '';
    expect(before).toMatch(/^At 4\sh a week/);
    const reset = page.locator('#for-a-class .zs-b-reset');
    await expect(reset).toBeHidden();

    const range = page.locator('#for-a-class .zs-b-range');
    await range.focus();
    for (let press = 0; press < 8; press += 1) await page.keyboard.press('ArrowRight');
    await expect(sentence).toHaveText(/^At 8\sh a week the route takes \d+\sweeks?\. Starting on 2\sNov\s2026/);
    await expect(range).toHaveAttribute('aria-valuetext', /^8\sh a week$/);
    await expect(page.locator('#for-a-class .zs-b-pace-value')).toHaveText('8');
    await expect(reset).toBeVisible();
    await expect(reset).toHaveText('Back to the plan: 4 h');
    // The permit further down still punches the plan of the file.
    await expect(page.locator('#start .zs-punch-input:checked')).toHaveValue('4');
    await page.waitForTimeout(600);
    await page.screenshot({ path: receipt(testInfo, 'brief-pace-eight-hours') });

    await reset.click();
    await expect(sentence).toHaveText(before);
    await expect(reset).toBeHidden();
    await expect(range).toBeFocused();
  });

  test('tearing the permit hands the start to the page, and the pace stop follows it', async ({ page }, testInfo) => {
    const problems = await open(page, testInfo, { roadmap: ownRust(), today: TODAY, keepStart: true }, 'stop=start');
    await goTo(page, 'start', 0);
    const permit = page.locator('#start form.zs-b-permit');
    // The start day of the file lies in the past, so the permit proposes today.
    await expect(permit.locator('.zs-b-day')).toHaveValue(TODAY);
    await permit.locator('label.zs-punch', { hasText: '10 h' }).click();
    await expect(permit.locator('.zs-b-span')).toHaveText(/ at 10\sh a week$/);
    await expect(permit.locator('.zs-b-arrival')).not.toBeEmpty();

    await permit.locator('.zs-tear').click();
    await expect(permit.locator('.zs-status')).toHaveText('Start set for 13 Nov 2026.');
    await expect(permit.locator('.zs-stub')).toHaveClass(/is-torn/);
    await expect(permit.locator('.zs-tear')).toHaveText('Tear again');
    expect(await page.evaluate(() => (window as unknown as HostWindow).__hostRecord.started)).toEqual([{ on: TODAY, hoursPerWeek: 10 }]);
    await page.waitForTimeout(900);
    await page.screenshot({ path: receipt(testInfo, 'brief-permit-torn') });

    // The pace stop shows the plan the learner keeps now.
    await goTo(page, 'for-a-class', 0.95);
    await expect(paceSentence(page)).toHaveText(/^At 10\sh a week the route takes \d+\sweeks?\. Starting on 13\sNov\s2026, you arrive on /);
    await expect(page.locator('#for-a-class .zs-facts')).toContainText('13 Nov 2026, the day on your permit.');
    await page.screenshot({ path: receipt(testInfo, 'brief-pace-after-start') });

    // Without a day there is nothing to start.
    await goTo(page, 'start', 0);
    await permit.locator('.zs-b-day').fill('');
    await permit.locator('.zs-tear').click();
    await expect(permit.locator('.zs-status')).toHaveText('Choose a start day first.');
    await expect(permit.locator('.zs-b-day')).toBeFocused();
    expect(await page.evaluate(() => (window as unknown as HostWindow).__hostRecord.started)).toHaveLength(1);
    expect(problems).toEqual([]);
  });

  test('a page that keeps no start sends the visitor up to the table instead of claiming one', async ({ page }, testInfo) => {
    await open(page, testInfo, { roadmap: ownRust(), today: TODAY }, 'motion=reduced&stop=start');
    await page.locator('#start').scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
    await expect(page.locator('#start .zs-ticket-foot')).toHaveCount(0);
    await page.locator('#start .zs-tear').click();
    await expect(page.locator('#start [role="status"]')).toHaveText('Go on at the table at the top of the page.');
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(2);
  });

  test('a class roadmap with dated sessions shows on the calendar where the class is today', async ({ page }, testInfo) => {
    const roadmap = datedClass();
    const session = latestSession(roadmap, TODAY);
    expect(session?.n).toBe(10);
    const problems = await open(page, testInfo, { roadmap, today: TODAY }, 'stop=class&hold=0.95');
    await goTo(page, 'for-a-class', 0.95);
    const stop = page.locator('#for-a-class');
    await expect(stop.locator('h2')).toHaveText('Your class against the calendar.');
    const marks = stop.locator('.zs-b-session');
    await expect(marks).toHaveCount(roadmap.class?.sessions.length ?? -1);
    const here = stop.locator('.zs-b-session.is-here');
    await expect(here).toHaveCount(1);
    await expect(here).toHaveText(String(session?.n));
    await expect(here).toHaveAttribute('title', `Session ${session?.n}: ${session?.title}`);
    await expect(stop.locator('.zs-today').first()).toContainText('Class is here');
    await expect(stop).toContainText('2 sessions a week of 45 minutes.');
    // The line of the class stands at its session mark, at the same place on the ruler.
    const at = (selector: string): Promise<string> => stop.locator(selector).first().evaluate((node) => (node as HTMLElement).style.getPropertyValue('--at'));
    expect(await at('.zs-b-session.is-here')).not.toBe('');
    expect(await at('.zs-today')).toBe(await at('.zs-b-session.is-here'));
    await page.screenshot({ path: receipt(testInfo, 'brief-class-calendar') });
    expect(problems).toEqual([]);
  });

  test('a German page reads the brief in German', async ({ page }, testInfo) => {
    const roadmap = ownDeutsch();
    const problems = await open(page, testInfo, { roadmap, today: TODAY, keepStart: true }, 'ui=de&motion=reduced');
    await expect(page.locator('#sections')).toHaveAttribute('lang', 'de');
    expect(await tabs(page)).toEqual(['Route', 'Quellen', 'Zahlen', 'Tempo', 'Karte', 'Pflege', 'Lücken']);
    await expect(page.locator('#what-it-is h2')).toHaveText(roadmap.title);
    await expect(page.locator('#for-a-class h2')).toHaveText('Deine Stunden gegen den Kalender.');
    await expect(paceSentence(page)).toHaveText(/^Bei 5\sStd\. pro Woche dauert die Route \d+\sWochen\. Mit Start am 9\.\sNov\.\s2026 kommst du am /);
    await expect(page.locator('#start .zs-tear')).toHaveText('Hier abreißen und starten');
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await page.locator('#for-a-class').scrollIntoViewIfNeeded();
    await page.screenshot({ path: receipt(testInfo, 'brief-de-pace') });
    expect(problems).toEqual([]);
  });

  test('needs no WebGL: with every canvas context refused the brief is all there', async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
    });
    const problems = await open(page, testInfo, { roadmap: ownRust(), today: TODAY, keepStart: true });
    await expect(page.locator('#sections canvas')).toHaveCount(0);
    await expect(page.locator('#sections section.zs-stop.zs-brief h2')).toHaveCount(STOPS.length);
    await page.locator('#start').scrollIntoViewIfNeeded();
    await expect(page.locator('#start form.zs-b-permit')).toBeVisible();
    expect(problems).toEqual([]);
  });
});

test.describe('the sections dev page', () => {
  test('setRoadmap turns the tour into the brief of a roadmap and back again', async ({ page }, testInfo) => {
    const problems = watch(page);
    await page.setViewportSize(isPhone(testInfo) ? { width: 390, height: 844 } : { width: 1440, height: 900 });
    await page.goto('/dev/sections.html?motion=reduced');
    await page.waitForFunction(() => document.documentElement.dataset.sections === 'ready', null, { timeout: 120_000 });
    await expect(page.locator('#what-it-is h2')).toHaveText('A study plan you can walk.');
    await expect(page.locator('#sections .zs-brief')).toHaveCount(0);
    const tour = await tabs(page);

    const roadmap = ownRust();
    await page.evaluate((value) => (window as unknown as HostWindow).__sections.setRoadmap(value), roadmap);
    await expect(page.locator('#sections section.zs-stop.zs-brief')).toHaveCount(STOPS.length);
    await expect(page.locator('#what-it-is h2')).toHaveText(roadmap.title);
    expect(await tabs(page)).toEqual(TABS_EN);
    await expect(page.locator('#start form.zs-b-permit')).toHaveCount(1);
    await page.screenshot({ path: receipt(testInfo, 'dev-sections-brief') });

    await page.evaluate(() => (window as unknown as HostWindow).__sections.setRoadmap(null));
    await expect(page.locator('#sections .zs-brief')).toHaveCount(0);
    await expect(page.locator('#what-it-is h2')).toHaveText('A study plan you can walk.');
    expect(await tabs(page)).toEqual(tour);
    await expect(page.locator('#start form.zs-ticket')).toBeVisible();
    expect(problems).toEqual([]);
  });
});

test.describe('on the real page', () => {
  test.setTimeout(420_000);

  interface AppWindow {
    __zt: { session: { roadmap: { id: string }; progress: { startedAt?: string }; plan: { startDay?: string; hoursPerWeek?: number } } };
  }

  async function openApp(page: Page, testInfo: TestInfo, query: string): Promise<void> {
    await page.setViewportSize(isPhone(testInfo) ? { width: 390, height: 844 } : { width: 1440, height: 900 });
    await page.goto(`/?${query}`);
    await page.waitForFunction(() => document.documentElement.dataset.zt === 'ready', null, { timeout: 300_000 });
    await expect(page.locator('#zt-sections section.zs-stop')).toHaveCount(STOPS.length, { timeout: 60_000 });
  }

  test('a file with its own roadmap shows its trip brief under the table, and the torn permit starts the session', async ({ page }, testInfo) => {
    const problems = watch(page);
    const roadmap = ownRust();
    const counts = receiptFor(roadmap);
    await page.clock.setFixedTime(new Date(`${TODAY}T10:00:00Z`));
    await page.addInitScript(fillInline, { roadmap: JSON.stringify(roadmap), receipt: JSON.stringify(counts) });
    await openApp(page, testInfo, 'still');
    expect(await page.evaluate(() => (window as unknown as AppWindow).__zt.session.roadmap.id)).toBe(roadmap.id);

    const sections = page.locator('#zt-sections');
    await expect(sections.locator('section.zs-stop.zs-brief')).toHaveCount(STOPS.length, { timeout: 60_000 });
    await expect(sections.locator('[data-stop="what"] h2')).toHaveText(roadmap.title);
    await expect(sections.locator('[data-stop="how"] h2')).toHaveText(`${counts.opened} opened, ${counts.kept} kept.`);
    expect(await page.locator('.zs-tabs a span:last-child').allTextContents()).toEqual(TABS_EN);

    const permit = sections.locator('[data-stop="start"] form.zs-b-permit');
    await permit.scrollIntoViewIfNeeded();
    await expect(permit).toContainText(roadmap.title);
    await permit.locator('label.zs-punch', { hasText: '10 h' }).click();
    await page.screenshot({ path: receipt(testInfo, 'app-brief-permit') });
    await permit.locator('.zs-tear').click();
    await expect(permit.locator('.zs-status')).toHaveText('Start set for 13 Nov 2026.');
    // The start is the session's: kept with the learner's progress and plan.
    const kept = await page.evaluate(() => {
      const { session } = (window as unknown as AppWindow).__zt;
      return { startedAt: session.progress.startedAt ?? null, plan: session.plan };
    });
    expect(kept.startedAt?.slice(0, 10)).toBe(TODAY);
    expect(kept.plan.startDay).toBe(TODAY);
    expect(kept.plan.hoursPerWeek).toBe(10);
    expect(problems).toEqual([]);
  });

  test('a gallery roadmap on the table keeps the tour of the skill', async ({ page }, testInfo) => {
    test.skip(isPhone(testInfo), 'checked once, on the desktop');
    await openApp(page, testInfo, 'still&road=rust-for-a-python-dev');
    await expect(page.locator('#zt-sections [data-stop="what"] h2')).toHaveText('A study plan you can walk.');
    await expect(page.locator('#zt-sections .zs-brief')).toHaveCount(0);
  });
});
