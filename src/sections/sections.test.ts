import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { missingKeys } from '../i18n';
import { SIGNPOST_KEYS } from '../props/signposts';
import { THEMES } from '../roadmap/themes';
import { SURFACE_KINDS, TIER_NAMES } from '../scene/palette';
import { TERRAIN_TEMPLATE_IDS, TRAIL_TEMPLATE_IDS } from '../terrain';
import { TERRAIN_TEMPLATES, TRAIL_TEMPLATES } from '../terrain/catalogue';
import { GROUNDS, INSTALL_PATHS, MAP_THEMES, POSTS, QUESTIONS, SHAPES, STOPS, TIERS, TRAILS, hasSectionWords, loadSectionWords, mountSections, saySections, type Sections } from './index';
import { PRINT, mapPrint } from './mapprint';
import { DE } from './words.de';
import { EN } from './words.en';

const SECTION_STRINGS = { en: EN, de: DE };

let mounted: Sections | null = null;

function mount(options: Parameters<typeof mountSections>[1] = {}): { root: HTMLElement; sections: Sections } {
  const root = document.createElement('main');
  document.body.append(root);
  mounted = mountSections(root, { lang: 'en', reduced: () => false, ...options });
  return { root, sections: mounted };
}

afterEach(() => {
  mounted?.destroy();
  mounted = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/**
 * The test browser lays nothing out, so the page gets a layout here: the children of the root are stacked, a
 * gap 300 high, a stop 1000 high and the footer 600 high, in a window 800 high.
 */
function fakeLayout(): void {
  const heightOf = (element: Element): number => (element.classList.contains('zs-gap') ? 300 : element.classList.contains('zs-stop') ? 1000 : element.tagName === 'FOOTER' ? 600 : 0);
  const topOf = (element: Element): number => {
    let top = 0;
    for (let before = element.previousElementSibling; before; before = before.previousElementSibling) top += heightOf(before);
    return top;
  };
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('zs-root')) return [...this.children].reduce((sum, child) => sum + heightOf(child), 0);
    return this.classList.contains('zs-box') ? 760 : heightOf(this);
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1440);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const inRoot = this.parentElement?.classList.contains('zs-root') ?? false;
    const top = inRoot ? topOf(this) : this.closest('.zs-stop') ? topOf(this.closest('.zs-stop') as Element) + 150 : 0;
    const height = inRoot ? heightOf(this) : 40;
    return { top, bottom: top + height, left: 0, right: 1440, width: 1440, height, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  });
}

const texts = (lang: 'en' | 'de'): [string, string][] =>
  Object.entries(SECTION_STRINGS[lang]).map(([key, value]) => [key, typeof value === 'string' ? value : Object.values(value).join(' ')]);

describe('the words', () => {
  it('has every key in both languages, with the same placeholders', () => {
    expect(missingKeys(SECTION_STRINGS)).toEqual([]);
  });

  it('answers in English until the German words are fetched, and in German after', async () => {
    expect(hasSectionWords('en')).toBe(true);
    expect(hasSectionWords('de')).toBe(false);
    expect(saySections('navHow', undefined, 'de')).toBe('How');
    await loadSectionWords('de');
    expect(hasSectionWords('de')).toBe(true);
    expect(saySections('navHow', undefined, 'de')).toBe('Ablauf');
    expect(saySections('ageDays', { count: 1 }, 'de')).toBe('Links vor 1 Tag geöffnet');
    expect(saySections('ageDays', { count: 3 }, 'de')).toBe('Links vor 3 Tagen geöffnet');
  });

  it('uses no dash as a pause, no exclamation mark and no ellipsis', () => {
    for (const lang of ['en', 'de'] as const) {
      for (const [key, text] of texts(lang)) {
        expect(text, `${lang}.${key}`).not.toMatch(/[–—!…]| - | -- /);
      }
    }
  });

  it('uses no sales words', () => {
    const sales =
      /\b(amazing|awesome|powerful|seamless|effortless|revolutionary|supercharge|unlock|unleash|magic|blazing|game.?chang|cutting.edge|world.class|best.in.class|ultimate|stunning|beautiful|simply|easily|just works|mühelos|revolutionär|einzigartig|perfekt|genial|kinderleicht|nahtlos)\b/i;
    for (const lang of ['en', 'de'] as const) {
      for (const [key, text] of texts(lang)) expect(text, `${lang}.${key}`).not.toMatch(sales);
    }
  });

  it('carries the search words once each in the headings and ledes they belong to', () => {
    const en = SECTION_STRINGS.en;
    expect(en.whatLede).toMatch(/agent skill/);
    expect(en.whatLede).toMatch(/interactive learning roadmap/);
    expect(en.whatLede).toMatch(/study plan/);
    expect(en.classLede).toMatch(/curriculum, a course outline or a syllabus/);
    expect(en.q2).toMatch(/AI roadmap/);
    expect(en.q3).toMatch(/fixed roadmaps/);
  });

  it('marks code and the one emphasised word of every title', () => {
    for (const lang of ['en', 'de'] as const) {
      for (const stop of STOPS) {
        const title = SECTION_STRINGS[lang][`${stop.id}Title` as keyof typeof SECTION_STRINGS.en] as string;
        expect(title.match(/\*[^*]+\*/g), `${lang}.${stop.id}Title`).toHaveLength(1);
      }
    }
  });
});

describe('what the page says about the map', () => {
  it('lists the mountain shapes, trails, grounds, signposts and themes the product has', () => {
    expect([...SHAPES]).toEqual([...TERRAIN_TEMPLATE_IDS]);
    expect([...TRAILS]).toEqual([...TRAIL_TEMPLATE_IDS]);
    expect([...GROUNDS].sort()).toEqual([...SURFACE_KINDS].sort());
    expect([...POSTS]).toEqual([...SIGNPOST_KEYS]);
    expect([...TIERS]).toEqual([...TIER_NAMES]);
    expect(MAP_THEMES.map((theme) => ({ id: theme.id, ground: [...theme.ground], post: theme.post }))).toEqual(
      THEMES.map((theme) => ({ id: theme.id, ground: [...theme.surfaces], post: theme.signpost })),
    );
  });

  it('describes the shapes and trails in the words of the catalogue', () => {
    const camel = (id: string) => id.replace(/(^|-)([a-z])/g, (_whole, _dash: string, letter: string) => letter.toUpperCase());
    for (const entry of TERRAIN_TEMPLATES) {
      expect(saySections(`shape${camel(entry.id)}` as 'shapeVolcano', undefined, 'en')).toBe(entry.name);
      expect(saySections(`shape${camel(entry.id)}Body` as 'shapeVolcanoBody', undefined, 'en')).toBe(entry.description);
    }
    for (const entry of TRAIL_TEMPLATES) {
      expect(saySections(`trail${camel(entry.id)}` as 'trailSpiral', undefined, 'en')).toBe(entry.name);
      expect(saySections(`trail${camel(entry.id)}Body` as 'trailSpiralBody', undefined, 'en')).toBe(entry.description);
    }
  });

  it('prints the same contour sheet for the same choice and another one for another seed', () => {
    const choice = { shape: 'volcano', trail: 'spiral', theme: 'classic-topo', seed: 'zero-to' } as const;
    const print = mapPrint(choice);
    expect(print).toBe(mapPrint(choice));
    expect(print).not.toBe(mapPrint({ ...choice, seed: 'zero-to-2' }));
    expect(print).toContain('stroke-dasharray');
    expect(print).toContain('var(--zt-signal)');
    // Every coordinate lies on the sheet.
    const numbers = [...print.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)];
    expect(numbers.length).toBeGreaterThan(100);
    for (const [, x, y] of numbers) {
      expect(Number(x)).toBeGreaterThanOrEqual(0);
      expect(Number(x)).toBeLessThanOrEqual(PRINT.width);
      expect(Number(y)).toBeGreaterThanOrEqual(0);
      expect(Number(y)).toBeLessThanOrEqual(PRINT.height);
    }
  });
});

describe('the page', () => {
  beforeAll(() => loadSectionWords('de'));

  it('is real text: one heading per stop, in order, with its section labelled by it', () => {
    const { root } = mount();
    const sections = [...root.querySelectorAll('section.zs-stop')];
    expect(sections.map((section) => section.id)).toEqual(STOPS.map((stop) => stop.anchor));
    for (const section of sections) {
      const headings = section.querySelectorAll('h2');
      expect(headings).toHaveLength(1);
      expect(section.getAttribute('aria-labelledby')).toBe(headings[0]?.id);
      expect(headings[0]?.textContent?.trim().length).toBeGreaterThan(8);
    }
    expect(root.querySelector('h1')).toBeNull();
    expect(root.querySelector('h2')?.textContent).toBe('A study plan you can walk.');
    expect(root.querySelector('h2 em')?.textContent).toBe('walk');
    // Enough words for a crawler, before anything is scrolled.
    expect((root.textContent ?? '').split(/\s+/).length).toBeGreaterThan(900);
  });

  it('keeps the heading levels in order inside every stop', () => {
    const { root } = mount();
    for (const section of root.querySelectorAll('section.zs-stop')) {
      let last = 2;
      for (const heading of section.querySelectorAll('h2, h3, h4')) {
        const level = Number(heading.tagName.slice(1));
        expect(level - last).toBeLessThanOrEqual(1);
        last = level;
      }
    }
  });

  it('hides the art from assistive technology and keeps every control out of it', () => {
    const { root } = mount();
    const hidden = [...root.querySelectorAll('[aria-hidden="true"]')];
    expect(hidden.length).toBeGreaterThan(20);
    for (const node of hidden) expect(node.querySelector('a, button, input, summary')).toBeNull();
    for (const drawing of root.querySelectorAll('svg')) expect(drawing.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('hangs one index tab per stop except the last, which belongs to the start chip', () => {
    const { root } = mount();
    const nav = root.querySelector('nav.zs-nav');
    expect(nav?.getAttribute('aria-label')).toBe('Sections');
    const links = [...(nav?.querySelectorAll('a') ?? [])];
    expect(links.map((link) => link.getAttribute('href'))).toEqual(STOPS.slice(0, -1).map((stop) => `#${stop.anchor}`));
    for (const link of links) expect(root.querySelector(link.getAttribute('href') ?? '')).not.toBeNull();
  });

  it('puts the tabs where the page header wants them and prefixes its ids when asked', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const { root } = mount({ navHost: host, idPrefix: 'zt-' });
    expect(root.querySelector('nav.zs-nav')).toBeNull();
    expect(host.querySelector('nav.zs-nav a')?.getAttribute('href')).toBe('#zt-what-it-is');
    expect(root.querySelector('#zt-start')).not.toBeNull();
    mounted?.destroy();
    mounted = null;
    expect(host.children).toHaveLength(0);
  });

  it('puts a band of night behind the header and shows it only while the sections are under it', () => {
    fakeLayout();
    const host = document.createElement('div');
    document.body.append(host);
    const { root, sections } = mount({ navHost: host });
    const band = host.querySelector('.zs-band');
    expect(root.querySelector('.zs-band')).toBeNull();
    expect(band?.getAttribute('aria-hidden')).toBe('true');
    // The band comes before the tabs in the header, so the tabs lie on it.
    expect(band?.nextElementSibling?.matches('nav.zs-nav')).toBe(true);
    // The table: the top of the sections is at the bottom of the window, or anywhere below its top.
    sections.update(0);
    expect(band?.classList.contains('is-on')).toBe(false);
    sections.update(sections.progressAt(-40));
    expect(band?.classList.contains('is-on')).toBe(false);
    // The top of the sections has passed the top of the window: what scrolls now scrolls under the header.
    sections.update(sections.progressAt(40));
    expect(band?.classList.contains('is-on')).toBe(true);
    sections.update(1);
    expect(band?.classList.contains('is-on')).toBe(true);
    // Back up at the table the band goes.
    sections.update(sections.progressAt(-200));
    expect(band?.classList.contains('is-on')).toBe(false);
  });

  it('lays the band over the stops and under the tabs when it has no header to stand in', () => {
    const { root } = mount();
    const band = root.querySelector(':scope > .zs-band');
    expect(band).not.toBeNull();
    expect(band?.nextElementSibling?.matches('nav.zs-nav')).toBe(true);
  });

  it('marks every install path untested until it is given the day it was run', () => {
    const { root } = mount();
    const states = [...root.querySelectorAll('.zs-agent .zs-state')].map((node) => node.textContent);
    expect(states).toEqual(INSTALL_PATHS.map(() => 'untested'));
    expect(root.textContent).toContain('None of these paths has been run against a public release yet.');
    mounted?.destroy();
    const again = mount({ tested: { codex: '2026-12-01' } });
    expect([...again.root.querySelectorAll('.zs-agent .zs-state')].map((node) => node.textContent)).toEqual(['untested', 'run on 2026-12-01', 'untested']);
  });

  it('prints each install command as text with a labelled copy button', () => {
    const { root } = mount();
    const commands = [...root.querySelectorAll('.zs-agent .zs-cmd code')].map((node) => node.textContent);
    expect(commands).toEqual(INSTALL_PATHS.flatMap((path) => [...path.commands, ...(path.alternative ?? [])]));
    for (const button of root.querySelectorAll('.zs-copy-btn')) {
      expect(button.getAttribute('type')).toBe('button');
      expect(button.getAttribute('aria-label')).toMatch(/^Copy the command: /);
    }
  });

  it('answers every question in the document, with one open', () => {
    const { root } = mount();
    const questions = [...root.querySelectorAll<HTMLDetailsElement>('details.zs-q')];
    expect(questions).toHaveLength(QUESTIONS);
    expect(questions.filter((question) => question.open)).toHaveLength(1);
    for (const question of questions) {
      expect(question.querySelector('summary h3')?.textContent).toMatch(/\?$/);
      expect(question.querySelector('p')?.textContent?.length).toBeGreaterThan(40);
    }
  });

  it('stands everything up as the page is scrolled through, and nothing before', () => {
    fakeLayout();
    const { root, sections } = mount();
    const rising = [...root.querySelectorAll('.zs-rise, .zs-peak, .zs-orb-card')];
    expect(rising.length).toBeGreaterThan(20);
    sections.update(0);
    expect(root.classList.contains('zs-live')).toBe(true);
    for (const element of rising) expect(element.classList.contains('is-up')).toBe(false);
    expect(sections.current).toBe(-1);
    expect(sections.threadDone).toBe(0);
    sections.update(1);
    for (const element of rising) expect(element.classList.contains('is-up')).toBe(true);
    expect(sections.current).toBe(STOPS.length - 1);
  });

  it('pins the stops that play, draws the thread further with every step and walks the tabs in order', () => {
    fakeLayout();
    const { root, sections } = mount();
    expect([...root.querySelectorAll<HTMLElement>('[data-pin]')].map((node) => node.dataset.stop)).toEqual(STOPS.filter((stop) => stop.hold > 0).map((stop) => stop.id));
    expect(root.querySelectorAll('svg.zs-thread')).toHaveLength(STOPS.length * 2);
    let done = -1;
    let current = -1;
    for (let step = 0; step <= 400; step += 1) {
      sections.update(step / 400);
      expect(sections.threadDone).toBeGreaterThanOrEqual(done);
      expect(sections.current).toBeGreaterThanOrEqual(current);
      expect(sections.current - current).toBeLessThanOrEqual(1);
      expect(root.querySelectorAll('nav.zs-nav [aria-current]').length).toBeLessThanOrEqual(1);
      done = sections.threadDone;
      current = sections.current;
    }
    expect(done).toBeGreaterThan(8000);
    expect(root.querySelector('.zs-walker')).not.toBeNull();
    // Scrolling back takes the thread back.
    sections.update(0.3);
    expect(sections.threadDone).toBeLessThan(done);
  });

  it('turns a scroll position into the progress it is given back', () => {
    fakeLayout();
    const { sections } = mount();
    expect(sections.progressAt(-800)).toBe(0);
    expect(sections.progressAt(0)).toBeGreaterThan(0);
    expect(sections.progressAt(1_000_000)).toBe(1);
  });

  it('keeps everything standing with reduced motion and pins nothing', () => {
    const { root, sections } = mount({ reduced: () => true });
    sections.update(0);
    expect(root.classList.contains('zs-still')).toBe(true);
    expect(root.querySelectorAll('[data-pin]')).toHaveLength(0);
    for (const element of root.querySelectorAll('.zs-rise, .zs-peak, .zs-orb-card')) expect(element.classList.contains('is-up')).toBe(true);
  });

  it('tells the page which stop is current', () => {
    fakeLayout();
    const onStop = vi.fn();
    const { sections } = mount({ onStop });
    sections.update(1);
    expect(onStop).toHaveBeenLastCalledWith(STOPS.length - 1, 'start');
  });

  it('never takes a progress outside 0 to 1 or a number that is not one', () => {
    const { sections } = mount();
    expect(() => {
      sections.update(-3);
      sections.update(7);
      sections.update(Number.NaN);
    }).not.toThrow();
    expect(sections.threadDone).toBeGreaterThanOrEqual(0);
  });

  it('changes language in place and keeps what was punched into the ticket', () => {
    const { root, sections } = mount({ topic: 'the "Dune" novels' });
    expect(root.querySelector('.zs-command')?.textContent).toBe('/zero-to "the \\"Dune\\" novels", about 5 hours a week');
    sections.setLang('de');
    expect(root.lang).toBe('de');
    expect(root.querySelector('h2')?.textContent).toBe('Ein Lernplan, den man gehen kann.');
    expect(root.querySelector('nav.zs-nav')?.getAttribute('aria-label')).toBe('Abschnitte');
    expect(root.querySelectorAll('nav.zs-nav')).toHaveLength(1);
    expect(root.querySelector('.zs-command')?.textContent).toBe('/zero-to "the \\"Dune\\" novels", etwa 5 Stunden pro Woche');
    expect([...root.querySelectorAll('.zs-agent .zs-state')].map((node) => node.textContent)).toEqual(['ungetestet', 'ungetestet', 'ungetestet']);
  });

  it('removes everything it added when it is destroyed', () => {
    const { root, sections } = mount();
    sections.destroy();
    mounted = null;
    expect(root.children).toHaveLength(0);
    expect(root.className).toBe('');
    expect(() => sections.update(0.5)).not.toThrow();
  });
});

describe('the ticket', () => {
  const type = (root: HTMLElement, value: string) => {
    const input = root.querySelector<HTMLInputElement>('.zs-input');
    if (!input) throw new Error('no topic field');
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const pick = (root: HTMLElement, selector: string) => {
    const input = root.querySelector<HTMLInputElement>(selector);
    if (!input) throw new Error(`no ${selector}`);
    input.checked = input.type === 'checkbox' ? !input.checked : true;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  it('is a labelled form with native controls', () => {
    const { root } = mount();
    const form = root.querySelector('form.zs-ticket');
    expect(form?.getAttribute('aria-label')).toBe('Trail ticket');
    const topic = form?.querySelector<HTMLInputElement>('input[type="text"]');
    expect(root.querySelector(`label[for="${topic?.id}"]`)?.textContent).toBe('Topic');
    expect(form?.querySelectorAll('fieldset legend')).toHaveLength(2);
    expect(form?.querySelectorAll('input[type="radio"]')).toHaveLength(7);
    expect(form?.querySelector('[role="status"]')).not.toBeNull();
  });

  it('prints the command as it is punched', () => {
    const { root } = mount();
    const command = () => root.querySelector('.zs-command')?.textContent;
    expect(command()).toBe('/zero-to <topic>, about 5 hours a week');
    type(root, 'Rust');
    expect(command()).toBe('/zero-to Rust, about 5 hours a week');
    pick(root, 'input[type="radio"][value="10"]');
    expect(command()).toBe('/zero-to Rust, about 10 hours a week');
    pick(root, 'input[type="radio"][value="class"]');
    expect(command()).toBe('/zero-to Rust, for a class I teach');
    expect(root.querySelector<HTMLInputElement>('input[type="radio"][value="10"]')?.disabled).toBe(true);
    pick(root, 'input[type="checkbox"]');
    expect(command()).toBe('/zero-to Rust, for a class I teach --defaults');
    type(root, 'say "hi"');
    expect(command()).toBe('/zero-to "say \\"hi\\"", for a class I teach --defaults');
  });

  it('copies the command when the stub is torn off, and asks for a topic first', async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const onCopy = vi.fn();
    const { root } = mount({ onCopy });
    const tear = root.querySelector<HTMLButtonElement>('.zs-tear');
    const status = () => root.querySelector('.zs-status')?.textContent;
    tear?.click();
    expect(writeText).not.toHaveBeenCalled();
    expect(status()).toBe('Punch in a topic first.');
    type(root, 'bread baking');
    expect(status()).toBe('');
    tear?.click();
    await vi.waitFor(() => expect(status()).toBe('Copied. Paste it into your agent.'));
    expect(writeText).toHaveBeenCalledWith('/zero-to bread baking, about 5 hours a week');
    expect(onCopy).toHaveBeenCalledWith('/zero-to bread baking, about 5 hours a week');
    expect(root.querySelector('.zs-stub')?.classList.contains('is-torn')).toBe(true);
    // Punching anything else puts the stub back.
    type(root, 'bread');
    expect(root.querySelector('.zs-stub')?.classList.contains('is-torn')).toBe(false);
    vi.unstubAllGlobals();
  });

  it('takes a topic from the page', () => {
    const { root, sections } = mount();
    sections.setTopic('Statistics for data work');
    expect(root.querySelector<HTMLInputElement>('.zs-input')?.value).toBe('Statistics for data work');
    expect(root.querySelector('.zs-command')?.textContent).toBe('/zero-to Statistics for data work, about 5 hours a week');
  });
});

describe('the footer', () => {
  it('links only to what it was given or what exists, and says how old the gallery checks are', () => {
    const { root } = mount({
      today: new Date(2026, 10, 20),
      examples: [
        { title: 'Zero to Rust, coming from Python', lang: 'en', checkedOn: '2026-11-13', freshness: 'medium' },
        { title: 'Deutsch A1 von null', lang: 'de', checkedOn: '2026-08-01', freshness: 'slow' },
        { title: 'Broken', checkedOn: 'soon' },
      ],
    });
    const stamps = [...root.querySelectorAll('.zs-stamp')].map((node) => node.textContent);
    expect(stamps).toEqual(['Repository', 'Roadmap format', 'Licence']);
    const ages = [...root.querySelectorAll('.zs-age')];
    expect(ages).toHaveLength(2);
    expect(ages[0]?.textContent).toContain('links opened 7 days ago · in date');
    expect(ages[1]?.textContent).toContain('recheck due');
    expect(ages[1]?.querySelector('[lang="de"]')?.textContent).toBe('Deutsch A1 von null');
  });
});
