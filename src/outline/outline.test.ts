import { describe, expect, it } from 'vitest';
import { missingKeys } from '../i18n';
import { deriveTrek } from '../roadmap/derive';
import { validateRoadmap } from '../roadmap/validate';
import { outlineHtml, outlineTree, renderOutline } from './outline';
import { profileGeometry, profileSvg, PROFILE_SPUR, PROFILE_WIDTH } from './profile';
import { OUTLINE_STRINGS } from './strings';
import { studentCopy } from './student';
import { textOf } from './tree';
import { firstSkip, headingLevels, mutable, parseFragment, sample, samples } from './testing';

const all = samples();

describe('outline text', () => {
  it.each(all.map((r) => [r.id, r] as const))('%s: outlineHtml and renderOutline carry the same text', (_id, roadmap) => {
    for (const ui of ['en', 'de'] as const) {
      const dom = renderOutline(roadmap, { ui });
      const parsed = parseFragment(outlineHtml(roadmap, { ui }));
      expect(parsed.textContent).toBe(dom.textContent);
      expect(dom.textContent).toBe(textOf(outlineTree(roadmap, { ui })));
      // The same elements in the same order, too.
      const tags = (root: Element) => [...root.querySelectorAll('*')].map((e) => e.tagName.toLowerCase()).join(' ');
      expect(tags(parsed.firstElementChild as Element)).toBe(tags(dom));
    }
  });

  it('shows the title, every stage, every step and every source of a roadmap', () => {
    const roadmap = sample('rust-for-a-python-dev');
    const root = renderOutline(roadmap, { ui: 'en' });
    expect(root.querySelector('h1')?.textContent).toBe(roadmap.title);
    const h2 = [...root.querySelectorAll('h2')].map((h) => h.textContent);
    for (const stage of roadmap.stages) expect(h2).toContain(stage.title);
    const h3 = [...root.querySelectorAll('h3')].map((h) => h.textContent);
    for (const stage of roadmap.stages) for (const w of stage.waypoints) expect(h3).toContain(w.title);
    const linked = new Set([...root.querySelectorAll('a.zo-source-title')].map((a) => a.getAttribute('href')));
    const used = new Set(roadmap.stages.flatMap((s) => [...s.waypoints.flatMap((w) => w.resources), ...(s.project?.resources ?? [])]));
    for (const id of used) {
      const resource = roadmap.resources.find((r) => r.id === id);
      expect(linked.has(new URL(resource!.url).href)).toBe(true);
    }
  });

  it('marks roadmap text with the roadmap language and automatic direction, labels with the interface language', () => {
    const roadmap = sample('deutsch-a1-von-null');
    const root = renderOutline(roadmap, { ui: 'en' });
    expect(root.getAttribute('lang')).toBe('en');
    const title = root.querySelector('h1') as HTMLElement;
    expect(title.getAttribute('lang')).toBe('de');
    expect(title.getAttribute('dir')).toBe('auto');
    for (const h of root.querySelectorAll('.zo-step-title, .zo-stage-title, .zo-note, .zo-task')) {
      expect(h.getAttribute('lang')).toBe('de');
      expect(h.getAttribute('dir')).toBe('auto');
    }
  });
});

describe('links', () => {
  it.each(all.map((r) => [r.id, r] as const))('%s: every link out is http or https with rel noopener', (_id, roadmap) => {
    const root = renderOutline(roadmap, { ui: 'en', teacher: true });
    const out = [...root.querySelectorAll('a')].filter((a) => !(a.getAttribute('href') ?? '').startsWith('#'));
    expect(out.length).toBeGreaterThan(0);
    for (const a of out) {
      const href = a.getAttribute('href') ?? '';
      expect(['http:', 'https:']).toContain(new URL(href).protocol);
      expect((a.getAttribute('rel') ?? '').split(/\s+/)).toContain('noopener');
    }
  });

  it('never turns another scheme into a link', () => {
    const roadmap = mutable('rust-for-a-python-dev');
    roadmap.resources[0].url = 'javascript:alert(1)';
    roadmap.resources[1].url = 'data:text/html,<b>x</b>';
    const root = renderOutline(roadmap, { ui: 'en' });
    for (const a of root.querySelectorAll('a')) {
      expect(a.getAttribute('href')).not.toMatch(/^(javascript|data):/i);
    }
    expect(root.querySelectorAll('.zo-source-title.is-unlinked').length).toBeGreaterThanOrEqual(2);
  });
});

describe('roadmap text is text', () => {
  it('keeps markup in roadmap text as visible characters in both writers', () => {
    const roadmap = mutable('photography-basics');
    const evil = '<img src=x onerror="alert(1)"><script>alert(2)</script> & "quotes"';
    roadmap.title = evil;
    roadmap.stages[0].title = evil;
    roadmap.stages[0].waypoints[0].note = evil;
    roadmap.resources[0].title = evil;
    const dom = renderOutline(roadmap, { ui: 'en' });
    const parsed = parseFragment(outlineHtml(roadmap, { ui: 'en' }));
    for (const root of [dom, parsed]) {
      expect(root.querySelector('img, script')).toBeNull();
      expect(root.querySelector('h1')?.textContent).toBe(evil);
    }
  });
});

describe('headings', () => {
  it.each(all.map((r) => [r.id, r] as const))('%s: levels start at h1 and never skip', (_id, roadmap) => {
    for (const teacher of [false, true]) {
      const levels = headingLevels(renderOutline(roadmap, { ui: 'en', teacher }));
      expect(levels[0]).toBe(1);
      expect(levels.filter((l) => l === 1)).toHaveLength(1);
      expect(firstSkip(levels)).toBeNull();
    }
  });
});

describe('teacher material', () => {
  const music = sample('music-theory-for-a-class');

  it('shows teacher notes and session plans only in the teacher outline', () => {
    const note = music.stages.flatMap((s) => s.waypoints).find((w) => w.teacherNote)!.teacherNote!;
    const opener = music.class!.sessions!.find((s) => s.opener)!.opener!;
    const student = renderOutline(music, { ui: 'en' }).textContent ?? '';
    const teacher = renderOutline(music, { ui: 'en', teacher: true }).textContent ?? '';
    expect(student).not.toContain(note);
    expect(student).not.toContain(opener);
    expect(teacher).toContain(note);
    expect(teacher).toContain(opener);
  });

  it('studentCopy has no teacher notes, no session plans, no answers to assessed checks, and still validates', () => {
    const { roadmap: copy, removed } = studentCopy(music);
    const text = JSON.stringify(copy);
    for (const w of music.stages.flatMap((s) => s.waypoints)) if (w.teacherNote) expect(text).not.toContain(w.teacherNote);
    expect(copy.class?.sessions).toBeUndefined();
    expect(removed.sessions).toBe(music.class!.sessions!.length);
    for (const stage of copy.stages) for (const check of stage.checkpoint.checks ?? []) expect(check.answer).toBe('');
    expect(validateRoadmap(copy).ok).toBe(true);
    // The student outline says the answer is with the teacher instead of showing it.
    expect(renderOutline(copy, { ui: 'en' }).querySelector('.zo-withheld')).not.toBeNull();
  });
});

describe('profile', () => {
  it('runs left to right in minutes over a 1000 wide drawing', () => {
    const roadmap = sample('rust-for-a-python-dev');
    const trek = deriveTrek(roadmap);
    const g = profileGeometry(trek);
    const xs = trek.waypoints.map((w) => g.x(w.along));
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(g.x(0)).toBeGreaterThanOrEqual(0);
    expect(g.x(1)).toBeLessThanOrEqual(PROFILE_WIDTH);
    // Linear: halfway along the route is halfway across.
    expect(g.x(0.5)).toBeCloseTo((g.x(0) + g.x(1)) / 2, 6);
  });

  it('draws the pin, the walked line, the plan and due rings only when asked', () => {
    const roadmap = sample('statistics-for-data-work');
    const trek = deriveTrek(roadmap);
    const bare = parseFragment(profileSvg(trek, {}));
    expect(bare.querySelector('[data-zo-mark="here"]')).toBeNull();
    expect(bare.querySelector('.zo-p-walked')).toBeNull();
    const first = trek.waypoints[0]!.id;
    const marked = parseFragment(profileSvg(trek, { here: 0.4, pace: 0.3, due: [first], done: [first] }));
    expect(marked.querySelector('[data-zo-mark="here"]')?.getAttribute('data-along')).toBe('0.4');
    expect(marked.querySelector('.zo-p-walked')).not.toBeNull();
    expect(marked.querySelector('[data-zo-mark="pace"]')).not.toBeNull();
    expect(marked.querySelectorAll('.zo-p-due')).toHaveLength(1);
    expect(marked.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('puts every optional step with room on a dotted spur that leaves the route and rejoins it', () => {
    const { half, rise, room, least } = PROFILE_SPUR;
    let spurs = 0;
    let optional = 0;
    for (const roadmap of all) {
      for (const height of [240, 230, 250, 170]) {
        const trek = deriveTrek(roadmap);
        const g = profileGeometry(trek, height);
        const label = `${roadmap.id} at ${height}`;
        const byId = new Map(g.spurs.map((spur) => [spur.id, spur]));
        const stops = [0, 1, ...trek.stages.map((stage) => g.share(stage.endMinute)), ...trek.waypoints.map((w) => w.along)];
        for (const w of trek.waypoints) {
          const spur = byId.get(w.id);
          if (!w.optional) {
            expect(spur, `${label}/${w.id}`).toBeUndefined();
            continue;
          }
          if (height === 240) optional += 1;
          if (!spur) continue;
          if (height === 240) spurs += 1;
          const tag = `${label}/${w.id}`;
          // It leaves before the step and rejoins after it, both on the route.
          expect(spur.from, tag).toBeLessThan(w.along);
          expect(spur.to, tag).toBeGreaterThan(w.along);
          expect((w.along - spur.from) * (g.x(1) - g.x(0)), tag).toBeLessThanOrEqual(half + 1e-9);
          expect((spur.to - w.along) * (g.x(1) - g.x(0)), tag).toBeLessThanOrEqual(half + 1e-9);
          expect((Math.min(w.along - spur.from, spur.to - w.along) * (g.x(1) - g.x(0))), tag).toBeGreaterThanOrEqual(least - 1e-9);
          const numbers = spur.d.match(/-?[\d.]+/g)!.map(Number);
          const [fx, fy] = numbers;
          const [tx, ty] = numbers.slice(-2);
          expect(fy, tag).toBeCloseTo(g.yAt(fx!), 0);
          expect(ty, tag).toBeCloseTo(g.yAt(tx!), 0);
          // Its far point is the step's place, off the route by at least half the rise, inside the drawing.
          expect(spur.on.x, tag).toBeCloseTo(g.x(w.along), 9);
          expect(spur.on.y, tag).toBeCloseTo(g.y(w.altitude), 9);
          expect(spur.at.x, tag).toBe(spur.on.x);
          expect(Math.abs(spur.at.y - spur.on.y), tag).toBeGreaterThanOrEqual(rise / 2 - 1e-9);
          expect(Math.abs(spur.at.y - spur.on.y), tag).toBeLessThanOrEqual(rise + 1e-9);
          expect(spur.up, tag).toBe(spur.at.y < spur.on.y);
          expect(spur.at.y, tag).toBeGreaterThanOrEqual(room - 1e-9);
          expect(spur.at.y, tag).toBeLessThanOrEqual(height - room + 1e-9);
          // It never reaches the mark beside it: a step, a camp or an end of the route.
          for (const stop of stops) {
            if (Math.abs(stop - w.along) < 1e-9) continue;
            expect(stop <= spur.from || stop >= spur.to, `${tag} against ${stop}`).toBe(true);
          }
        }
      }
    }
    expect(optional).toBe(12);
    // One optional step of the statistics roadmap sits too close to its camp for a spur: it stays on the route.
    expect(spurs).toBe(11);
  });

  it('draws the spur under the route and the optional step at its far point, due ring and all', () => {
    const roadmap = sample('photography-basics');
    const trek = deriveTrek(roadmap);
    const g = profileGeometry(trek);
    const spur = g.spurs[0]!;
    const svg = parseFragment(profileSvg(trek, { due: [spur.id], done: [spur.id] }));
    const paths = [...svg.querySelectorAll('path')];
    const drawn = svg.querySelector(`.zo-p-spur[data-waypoint="${spur.id}"]`)!;
    expect(drawn.getAttribute('d')).toBe(spur.d);
    expect(drawn.getAttribute('stroke-dasharray')).toBe('0.01 5');
    expect(drawn.getAttribute('stroke-linecap')).toBe('round');
    expect(paths.indexOf(drawn as SVGPathElement)).toBeLessThan(paths.indexOf(svg.querySelector('.zo-p-route') as SVGPathElement));
    expect(svg.querySelectorAll('.zo-p-spur')).toHaveLength(g.spurs.length);
    const steps = [...svg.querySelectorAll('.zo-p-step')];
    const index = trek.waypoints.findIndex((w) => w.id === spur.id);
    const dot = steps[index]!;
    expect(dot.classList.contains('is-optional')).toBe(true);
    expect(dot.classList.contains('is-done')).toBe(true);
    expect(Number(dot.getAttribute('cx'))).toBeCloseTo(spur.at.x, 0);
    expect(Number(dot.getAttribute('cy'))).toBeCloseTo(spur.at.y, 0);
    const ring = svg.querySelector('.zo-p-due')!;
    expect(Number(ring.getAttribute('cy'))).toBeCloseTo(spur.at.y, 0);
    // A step on the route keeps its place on it.
    const plain = trek.waypoints.findIndex((w) => !w.optional);
    expect(Number(steps[plain]!.getAttribute('cy'))).toBeCloseTo(g.y(trek.waypoints[plain]!.altitude), 0);
  });

  it('is in the outline with the pin at the roadmap entry before any progress', () => {
    const roadmap = sample('rust-for-a-python-dev');
    const root = renderOutline(roadmap, { ui: 'en' });
    const pin = root.querySelector('[data-zo-profile] [data-zo-mark="here"]');
    expect(pin?.getAttribute('data-along')).toBe('0');
    expect(root.querySelector('[data-zo-profile-caption]')?.textContent).toMatch(/stages over/);
  });
});

describe('strings', () => {
  it('has the same keys and placeholders in English and German', () => {
    expect(missingKeys(OUTLINE_STRINGS)).toEqual([]);
  });

  it('never upper-cases roadmap text', () => {
    const root = renderOutline(sample('rust-for-a-python-dev'), { ui: 'en' });
    for (const el of root.querySelectorAll('[lang][dir="auto"]')) expect(el.classList.contains('zo-label')).toBe(false);
  });
});
