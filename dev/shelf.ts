import '../src/look/fonts.css';
import { tokensCss } from '../src/look/theme';
import { resourcesFor } from '../src/roadmap/derive';
import sample from '../src/roadmap/samples/rust-for-a-python-dev.json';
import type { Roadmap } from '../src/roadmap/types';
import { createMemorySession, createShelfDock, type ShelfDock } from '../src/shelf';
import { fixtureRoadmap } from '../src/shelf/fixtures';

/**
 * Dev page for the resource shelf: the dock at the corner of a dark map table, on the sample roadmap or on
 * the fixture shelf (all ten types, a gated and an unverified source, a price).
 *
 * URL: ?road=sample|fixture, &stage=<index>, &n=<how many volumes>, &present=<resource id>, &lit=0..1,
 * &open=<resource id>, &ui=en|de, &motion=reduced, &still=1 (no controls).
 * Keys: B focuses the shelf, D dims or lights it.
 */
const params = new URLSearchParams(window.location.search);
const still = params.get('still') === '1';
const reduced = params.get('motion') === 'reduced';
const ui = params.get('ui') === 'de' ? 'de' : 'en';
document.body.classList.toggle('still', still);
document.documentElement.lang = ui;

const tokens = document.createElement('style');
tokens.textContent = tokensCss();
document.head.appendChild(tokens);

const roadmap: Roadmap = params.get('road') === 'fixture' ? fixtureRoadmap() : (sample as unknown as Roadmap);
const session = createMemorySession(roadmap);
const host = document.getElementById('dock') as HTMLElement;
const hud = document.getElementById('hud') as HTMLElement;

const dock: ShelfDock = createShelfDock(host, session, {
  ui,
  reducedMotion: reduced ? true : undefined,
  background: [hud],
  onPresent: (id) => {
    document.body.dataset.presented = id ?? '';
  },
  onOpenChange: (id) => {
    document.body.dataset.open = id ?? '';
  },
});

let stageIndex = Math.min(roadmap.stages.length - 1, Math.max(0, Number(params.get('stage') ?? 0) || 0));
const limit = Number(params.get('n') ?? 0) || 0;

function load(index: number, present?: string | null): void {
  stageIndex = index;
  const stage = roadmap.stages[index]!;
  let entries = resourcesFor(roadmap, stage.id);
  if (limit > 0) entries = entries.slice(0, limit);
  dock.setEntries(entries, present ?? null);
  drawHud();
}

let lit = Math.min(1, Math.max(0, Number(params.get('lit') ?? 1)));
dock.setLit(lit);

function drawHud(): void {
  if (still) return;
  hud.replaceChildren();
  const title = document.createElement('div');
  title.textContent = `${roadmap.title} · stage ${stageIndex + 1} of ${roadmap.stages.length}`;
  const stages = document.createElement('div');
  roadmap.stages.forEach((stage, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `${index + 1}. ${stage.title}`;
    button.setAttribute('aria-pressed', String(index === stageIndex));
    button.addEventListener('click', () => load(index));
    stages.appendChild(button);
  });
  const light = document.createElement('button');
  light.type = 'button';
  light.textContent = lit >= 1 ? 'Dim (predict not answered)' : 'Light (predict answered)';
  light.addEventListener('click', toggleLight);
  const pins = document.createElement('div');
  pins.textContent = `Notebook: ${session.pins.length} pinned`;
  hud.append(title, stages, light, pins);
}

function toggleLight(): void {
  lit = lit >= 1 ? 0 : 1;
  dock.setLit(lit);
  drawHud();
}

session.subscribe?.(drawHud);
load(stageIndex, params.get('present'));

document.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest('input, textarea, .bb-reader')) return;
  if (event.key === 'b' || event.key === 'B') {
    event.preventDefault();
    dock.focus();
  } else if (event.key === 'd' || event.key === 'D') {
    toggleLight();
  }
});

const openId = params.get('open');
if (openId) void dock.open(openId);

Object.assign(window, { __dock: dock, __session: session });
