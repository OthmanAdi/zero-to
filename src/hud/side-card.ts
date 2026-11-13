/**
 * The side card: what the roadmap in the light is, at one glance. The big number is its hours and counts up with
 * the mountain. Under it the readout names what the pointer is on, so the mountain works as an index.
 *
 * The card has no box. It is type on the room with a soft shade behind it, and its lines arrive one after
 * another whenever another roadmap comes into the light.
 */
import { uiLang } from '../i18n';
import { formatDay, formatNumber, roundHours } from '../look/format';
import { deriveTrek } from '../roadmap/derive';
import { emptyProgress, summarise, youAreHere, type Progress } from '../roadmap/progress';
import type { Roadmap } from '../roadmap/types';
import type { ReadoutParts } from '../table/readout';
import { el, fitLines, setRoadText, setText } from './dom';
import { say, tierKey } from './strings';

/** One roadmap on the table: the same shape the table takes for a sheet. */
export interface HudRoadmap {
  readonly roadmap: Roadmap;
  readonly progress?: Progress | null;
  /** True for a gallery example. */
  readonly example?: boolean;
}

/** The delays of the card's lines in milliseconds, in the order they arrive. */
export const CARD_STAGGER = [200, 240, 290, 340, 390, 440, 490, 540] as const;

/** Where the pin stands: the index of the stage of you-are-here, or `stages` when the route is walked. */
export function pinStage(entry: HudRoadmap): { readonly stage: number; readonly stages: number; readonly started: boolean } {
  const progress = entry.progress ?? emptyProgress(entry.roadmap.id, entry.roadmap.checkedOn);
  const here = youAreHere(entry.roadmap, progress);
  const stages = entry.roadmap.stages.length;
  const started = summarise(entry.roadmap, progress).doneWaypoints > 0;
  if (!here) return { stage: stages, stages, started };
  return { stage: Math.max(0, entry.roadmap.stages.findIndex((s) => s.id === here.stageId)), stages, started };
}

export function pinLine(entry: HudRoadmap): string {
  const pin = pinStage(entry);
  if (pin.stage >= pin.stages) return say('pinSummit');
  if (pin.stage === 0 && !pin.started) return say('pinGate');
  return say('pinStage', { i: pin.stage + 1 });
}

export interface SideCard {
  readonly element: HTMLElement;
  /** The button that opens the share dialog. */
  readonly shareButton: HTMLButtonElement;
  setRoadmap(entry: HudRoadmap | null, animate?: boolean): void;
  /** Takes the table's readout. Writes to the document only when its `key` changed. Returns true on a write. */
  setReadout(parts: ReadoutParts | null): boolean;
  /** How often the readout was written. */
  readonly writes: number;
  relabel(): void;
  /** Fits the title again after the window or the fonts changed. */
  fit(): void;
}

export function createSideCard(host: HTMLElement, onShare: (opener: HTMLElement) => void): SideCard {
  const tier = el('span', { class: 'zh-chip-tier' });
  const chip = el('p', { class: 'zh-chip zt-label zh-line' }, el('span', { class: 'zh-chip-dot', 'aria-hidden': 'true' }), tier);
  const example = el('span', { class: 'zh-chip-example zt-label', hidden: true });
  const chipRow = el('div', { class: 'zh-chip-row zh-line' }, chip, example);
  const meta = el('p', { class: 'zh-card-meta zt-label zh-line' });
  const title = el('h2', { class: 'zh-card-title zt-title zh-line', dir: 'auto' });
  const goal = el('p', { class: 'zh-card-goal zt-small zh-line', dir: 'auto' });
  const number = el('span', { class: 'zh-card-number zt-number', 'aria-hidden': 'true' });
  const unitName = el('span');
  const unitNote = el('span', { class: 'zh-card-unit-note' });
  const unit = el('span', { class: 'zh-card-unit zt-label', 'aria-hidden': 'true' }, unitName, unitNote);
  const spoken = el('span', { class: 'zh-sr' });
  const hours = el('p', { class: 'zh-card-hours zh-line' }, number, unit, spoken);
  const readLine = el('span', { class: 'zh-card-readline zt-label' });
  const readTitle = el('span', { class: 'zh-card-readtitle zt-data', dir: 'auto' });
  const readout = el('p', { class: 'zh-card-readout zh-line', role: 'status' }, readLine, readTitle);
  const pinText = el('span');
  const pin = el('p', { class: 'zh-card-pin zt-label zh-line' }, el('span', { class: 'zh-dot', 'aria-hidden': 'true' }), pinText);
  const summary = el('p', { class: 'zh-card-summary zt-small zh-line', dir: 'auto' });
  const opened = el('span', { class: 'zh-card-opened zt-label' });
  const shareButton = el('button', { type: 'button', class: 'zh-link zt-label' });
  shareButton.addEventListener('click', () => onShare(shareButton));
  const foot = el('p', { class: 'zh-card-foot zh-line' }, opened, shareButton);

  const root = el('aside', { class: 'zh-side', lang: uiLang() }, chipRow, meta, title, goal, hours, readout, pin, summary, foot);
  root.querySelectorAll<HTMLElement>(':scope > .zh-line').forEach((line, i) => {
    line.style.setProperty('--zh-delay', `${CARD_STAGGER[Math.min(i, CARD_STAGGER.length - 1)]}ms`);
  });

  let entry: HudRoadmap | null = null;
  let readKey = '';
  let totalHours = '';
  let writes = 0;
  let refit = true;

  /**
   * The card stands between the header and the shelf. When that column is too low for every line, the card
   * gives up what the outline also says, the least needed first: the summary, then the goal, then the foot.
   * Without layout (a test) nothing is dropped.
   */
  const fitColumn = (): void => {
    const overflows = (): boolean => {
      const column = root.getBoundingClientRect();
      if (column.height <= 0) return false;
      let bottom = column.top;
      for (const line of root.children) {
        const box = line.getBoundingClientRect();
        if (box.height > 0) bottom = Math.max(bottom, box.bottom);
      }
      return bottom > column.bottom + 1;
    };
    for (let drop = 0; drop <= 3; drop++) {
      if (drop === 0) delete root.dataset.drop;
      else root.dataset.drop = String(drop);
      if (!overflows()) return;
    }
  };

  const writeHours = (text: string): void => {
    setText(number, text);
    spoken.lang = uiLang();
  };

  const render = (): void => {
    root.lang = uiLang();
    root.setAttribute('aria-label', say('card'));
    setText(unitName, say('hoursUnit'));
    setText(unitNote, ` · ${say('hoursNote')}`);
    setText(shareButton, say('share'));
    root.hidden = entry === null;
    if (!entry) return;
    const { roadmap } = entry;
    const trek = deriveTrek(roadmap);
    const steps = roadmap.stages.reduce((sum, stage) => sum + stage.waypoints.length, 0);
    root.dataset.tier = roadmap.brief.targetTier;
    setText(tier, say('toTier', { tier: say(tierKey(roadmap.brief.targetTier)) }));
    example.hidden = !entry.example;
    setText(example, say('example'));
    setText(meta, [say('stages', { count: roadmap.stages.length }), say('steps', { count: steps }), roadmap.lang.toUpperCase()].join(' · '));
    if (setRoadText(title, roadmap.title, roadmap.lang) || refit) fitLines(title);
    refit = false;
    setRoadText(goal, roadmap.brief.goal ?? '', roadmap.lang);
    goal.hidden = !roadmap.brief.goal;
    totalHours = formatNumber(roundHours(trek.totalMinutes), { fraction: 1 });
    if (readKey === '') writeHours(totalHours);
    setText(spoken, say('hoursSpoken', { n: totalHours }));
    setText(pinText, pinLine(entry));
    setRoadText(summary, roadmap.summary ?? '', roadmap.lang);
    summary.hidden = !roadmap.summary;
    setText(opened, say('linksOpened', { day: formatDay(roadmap.checkedOn) }));
    shareButton.setAttribute('aria-label', `${say('share')}: ${roadmap.title}`);
    if (readKey === '') {
      setText(readLine, '');
      setText(readTitle, '');
    }
    fitColumn();
  };

  render();
  host.append(root);

  return {
    element: root,
    shareButton,
    setRoadmap(next, animate = true) {
      const changed = next?.roadmap.id !== entry?.roadmap.id;
      entry = next;
      if (changed) {
        readKey = '';
        if (animate) {
          // The lines leave at once and arrive again one after another.
          root.classList.remove('is-arriving');
          void root.offsetWidth;
          root.classList.add('is-arriving');
        }
      }
      render();
    },
    setReadout(parts) {
      const key = parts?.key ?? '';
      if (key === readKey) return false;
      readKey = key;
      writes += 1;
      if (!parts) {
        writeHours(totalHours);
        setText(readLine, '');
        setText(readTitle, '');
        return true;
      }
      writeHours(parts.hoursText);
      setText(readLine, parts.line);
      // The stage title shows only while a card is under the pointer. The roadmap's title is already above.
      if (parts.card !== null) setRoadText(readTitle, parts.title, parts.lang);
      else setText(readTitle, '');
      return true;
    },
    get writes() {
      return writes;
    },
    relabel: render,
    fit: () => {
      fitLines(title);
      fitColumn();
    },
  };
}
