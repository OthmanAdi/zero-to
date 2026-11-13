import { afterEach, describe, expect, it } from 'vitest';
import { createSession, type Session } from '../learn/session';
import { memoryStorage } from '../learn/storage';
import { hydrateOutline, type HydratedOutline } from './hydrate';
import { outlineHtml, renderOutline } from './outline';
import { preparePrint } from './print';
import { firstSkip, headingLevels, parseFragment, sample } from './testing';

let cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup) fn();
  cleanup = [];
  document.body.replaceChildren();
  delete document.documentElement.dataset.print;
});

function setup(id = 'rust-for-a-python-dev', from: 'dom' | 'html' = 'dom'): { root: HTMLElement; session: Session; outline: HydratedOutline } {
  const roadmap = sample(id);
  const session = createSession(roadmap, memoryStorage(), { clock: () => '2026-11-20', saveOnPageHide: false });
  const root = from === 'dom' ? renderOutline(roadmap, { ui: 'en' }) : (parseFragment(outlineHtml(roadmap, { ui: 'en' })).firstElementChild as HTMLElement);
  document.body.append(root);
  const outline = hydrateOutline(root, session, { ui: 'en', print: () => {}, download: () => {} });
  cleanup.push(() => outline.destroy(), () => session.destroy());
  return { root, session, outline };
}

const pinAlong = (root: HTMLElement): number => Number(root.querySelector('[data-zo-profile] [data-zo-mark="here"]')?.getAttribute('data-along'));

describe('hydrateOutline', () => {
  it('marks a step done from its checkbox and moves the pin, the walked line and "you are here"', () => {
    const { root, session } = setup();
    const first = session.roadmap.stages[0]!.waypoints[0]!;
    const second = session.roadmap.stages[0]!.waypoints[1]!;
    const box = root.querySelector<HTMLInputElement>(`[data-zo-done="${first.id}"]`)!;
    expect(box).not.toBeNull();
    expect(root.querySelector(`#w-${first.id}`)?.hasAttribute('data-here')).toBe(true);
    const before = pinAlong(root);
    expect(root.querySelector('.zo-p-walked')).toBeNull();

    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));

    expect(session.progress.waypoints[first.id]?.done).toBe(true);
    expect(pinAlong(root)).toBeGreaterThan(before);
    expect(root.querySelector('.zo-p-walked')).not.toBeNull();
    expect(root.querySelector(`#w-${first.id}`)?.hasAttribute('data-done')).toBe(true);
    expect(root.querySelector(`#w-${second.id}`)?.hasAttribute('data-here')).toBe(true);
    expect(root.querySelector(`#w-${first.id} .zo-status`)?.textContent).toMatch(/Done on/);
    expect(root.querySelector('.zo-continue-link')?.textContent).toContain(second.title);
  });

  it('follows changes made elsewhere on the same session, as the 3D view makes them', () => {
    const { root, session } = setup();
    const id = session.roadmap.stages[0]!.waypoints[0]!.id;
    session.done(id);
    expect(root.querySelector<HTMLInputElement>(`[data-zo-done="${id}"]`)?.checked).toBe(true);
    session.done(id, false);
    expect(root.querySelector<HTMLInputElement>(`[data-zo-done="${id}"]`)?.checked).toBe(false);
  });

  it('hydrates prerendered HTML the same way', () => {
    const { root, session } = setup('photography-basics', 'html');
    const id = session.roadmap.stages[0]!.waypoints[0]!.id;
    const box = root.querySelector<HTMLInputElement>(`[data-zo-done="${id}"]`)!;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(session.progress.waypoints[id]?.done).toBe(true);
  });

  it('swaps the reading text for the working card and back, keeping the headings in order', () => {
    const { root, session } = setup();
    const step = session.roadmap.stages[1]!.waypoints[0]!;
    const host = root.querySelector<HTMLElement>(`#w-${step.id}`)!;
    const toggle = host.querySelector<HTMLButtonElement>('.zo-work')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector<HTMLElement>('[data-zo-body]')!.hidden).toBe(true);
    const card = host.querySelector<HTMLElement>('.zo-card')!;
    expect(card.hidden).toBe(false);
    expect(card.querySelector('.zl-waypoint')).not.toBeNull();
    // Signpost and camp cards too.
    root.querySelector<HTMLButtonElement>(`#c-${session.roadmap.stages[1]!.id} .zo-work`)!.click();
    root.querySelector<HTMLButtonElement>(`#p-${session.roadmap.stages[1]!.id} .zo-work`)?.click();
    expect(firstSkip(headingLevels(root))).toBeNull();

    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(card.hidden).toBe(true);
    expect(host.querySelector<HTMLElement>('[data-zo-body]')!.hidden).toBe(false);
    expect(document.activeElement).toBe(toggle);
  });

  it('every control is a native element with a name', () => {
    const { root } = setup('music-theory-for-a-class');
    const controls = [...root.querySelectorAll('button, input, a[href], summary')];
    expect(controls.length).toBeGreaterThan(30);
    for (const c of controls) {
      const byFor = c.id ? (root.querySelector(`label[for="${c.id}"]`)?.textContent ?? '').trim() : '';
      const byRef = (c.getAttribute('aria-labelledby') ?? '').split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim();
      const name = (c.getAttribute('aria-label') ?? '') || (c.textContent ?? '').trim() || (c.closest('label')?.textContent ?? '').trim() || byFor || byRef;
      expect(name, c.outerHTML.slice(0, 120)).not.toBe('');
    }
  });

  it('offers the exports, and the teacher tools only for a roadmap with teacher parts', () => {
    const plain = setup('rust-for-a-python-dev');
    const words = [...plain.root.querySelectorAll('.zo-actions button')].map((b) => b.textContent);
    expect(words).toContain('Print the trail card');
    expect(words).toContain('Download the roadmap as Markdown');
    expect(words.some((w) => w?.includes('.ics'))).toBe(true);
    expect(words).not.toContain('Download the student file');
    plain.outline.destroy();
    document.body.replaceChildren();
    const teacher = setup('music-theory-for-a-class');
    const teacherWords = [...teacher.root.querySelectorAll('.zo-actions button')].map((b) => b.textContent);
    expect(teacherWords).toContain('Download the student file');
    expect(teacherWords).toContain('Print the session pages');
  });

  it('shows due reviews above the stages once a finished step comes due, with a ring on the profile', () => {
    const roadmap = sample('rust-for-a-python-dev');
    let day = '2026-11-20';
    const session = createSession(roadmap, memoryStorage(), { clock: () => day, saveOnPageHide: false });
    const root = renderOutline(roadmap, { ui: 'en' });
    document.body.append(root);
    const outline = hydrateOutline(root, session, { ui: 'en', print: () => {}, download: () => {} });
    cleanup.push(() => outline.destroy(), () => session.destroy());
    const step = roadmap.stages.flatMap((s) => s.waypoints).find((w) => (w.checks?.length ?? 0) > 0)!;
    session.done(step.id);
    expect(root.querySelector<HTMLElement>('.zo-panel.review')!.hidden).toBe(true);
    day = '2026-12-01';
    outline.update();
    const panel = root.querySelector<HTMLElement>('.zo-panel.review')!;
    expect(panel.hidden).toBe(false);
    expect(panel.querySelector('h2')?.textContent).toBe('Review');
    expect(root.querySelector(`#w-${step.id}`)?.hasAttribute('data-due')).toBe(true);
    expect(root.querySelectorAll('[data-zo-profile] .zo-p-due')).toHaveLength(1);
    expect(firstSkip(headingLevels(root))).toBeNull();
  });

  it('refuses an outline of another roadmap', () => {
    const roadmap = sample('rust-for-a-python-dev');
    const other = createSession(sample('photography-basics'), memoryStorage(), { saveOnPageHide: false });
    expect(() => hydrateOutline(renderOutline(roadmap, { ui: 'en' }), other)).toThrow(/photography-basics/);
    other.destroy();
  });
});

describe('print views', () => {
  it('puts the trail card, the notebook and the session pages into the print root', () => {
    const { session } = setup('music-theory-for-a-class');
    session.pin({ kind: 'own', text: 'my line', stageId: session.roadmap.stages[0]!.id });
    for (const kind of ['trail-card', 'notebook', 'teacher'] as const) {
      const undo = preparePrint(kind, session, { ui: 'en' });
      const root = document.getElementById('zo-print-root')!;
      expect(document.documentElement.dataset.print).toBe(kind);
      expect(root.querySelector('.zo-print-page')).not.toBeNull();
      if (kind === 'trail-card') expect(root.querySelectorAll('tbody tr')).toHaveLength(session.roadmap.stages.length);
      if (kind === 'teacher') expect(root.querySelectorAll('.zo-session-page')).toHaveLength(session.roadmap.class!.sessions!.length);
      if (kind === 'notebook') expect(root.textContent).toContain('my line');
      undo();
      expect(document.documentElement.dataset.print).toBeUndefined();
      expect(root.childElementCount).toBe(0);
    }
  });
});
