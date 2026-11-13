/**
 * The page the reader shows for a volume. zero-to never fetches a source, so the page is written from the
 * roadmap entry: what the source is, why it is on the list, what it costs, how it was checked, and the task
 * of the step it serves. "Open original" leads to the source itself.
 */
import { uiLang, type UiLang } from '../i18n';
import { formatDay, formatHours } from '../look/format';
import type { ReaderDoc, ReaderLabels } from '../bookshelf/reader';
import type { Roadmap } from '../roadmap/types';
import { costSentence, safeHref, statusSentence, typeName } from './items';
import { say } from './strings';
import type { ShelfEntry } from './types';

const WORD_JOINER = '⁠';
/** Line starts that markdown-lite reads as a block: headings, quotes, fences, rules, list items. */
const BLOCK_START = /^(?:#|>|```|---|[-*]\s|\d{1,9}\.\s|[•·◦▪▫‣●○]|[–—]\s)/;

/**
 * Roadmap prose as one markdown-lite line. Inline code and emphasis keep working, so "run `cargo new`" reads
 * as code, but nothing in it becomes a link or a block of its own: an invisible word joiner is put where a
 * link or a block marker would begin.
 */
export function prose(text: string): string {
  const flat = text.replace(/\s*\n\s*/g, ' ').trim().replace(/\]\(/g, `]${WORD_JOINER}(`);
  return BLOCK_START.test(flat) ? `${WORD_JOINER}${flat}` : flat;
}

const capitalise = (text: string): string => (text ? text.charAt(0).toLocaleUpperCase() + text.slice(1) : text);

function languageName(tag: string, ui: UiLang): string {
  try {
    return new Intl.DisplayNames([ui], { type: 'language' }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

const TIER_KEYS = { bronze: 'tierBronze', silver: 'tierSilver', gold: 'tierGold', diamond: 'tierDiamond' } as const;

/** The task a volume serves: its waypoint's task, or the camp project that lists it. */
export interface StepTask {
  readonly heading: string;
  readonly title: string;
  readonly text: string;
  readonly time?: string;
}

export function taskFor(entry: ShelfEntry, roadmap: Roadmap, ui: UiLang = uiLang()): StepTask | null {
  for (const stage of roadmap.stages) {
    if (entry.for === 'project') {
      const project = stage.project;
      if (project?.resources?.includes(entry.resource.id)) {
        return {
          heading: say('headProject', undefined, ui),
          title: project.title,
          text: project.brief,
          ...(project.minutes ? { time: `${capitalise(formatHours(project.minutes, { lang: ui }))}.` } : {}),
        };
      }
      continue;
    }
    const waypoint = stage.waypoints.find((w) => w.id === entry.for);
    if (waypoint) {
      const practice = Math.min(waypoint.practiceMinutes, waypoint.minutes);
      const time =
        practice > 0
          ? say('taskTime', { duration: capitalise(formatHours(waypoint.minutes, { lang: ui })), practice: formatHours(practice, { lang: ui, approx: false }) }, ui)
          : `${capitalise(formatHours(waypoint.minutes, { lang: ui }))}.`;
      return { heading: say('headTask', undefined, ui), title: waypoint.title, text: waypoint.do, time };
    }
  }
  return null;
}

/** The reader's own words in the interface language, with the dates and minutes of this volume. */
export function readerLabels(entry: ShelfEntry, ui: UiLang = uiLang()): Partial<ReaderLabels> {
  const status = entry.resource.check.status;
  const saved = status === 'unverified' ? 'savedUnverified' : status === 'gated' ? 'savedGated' : 'savedVerified';
  const minutes = entry.resource.minutes;
  return {
    close: say('close', undefined, ui),
    openOriginal: say('openOriginal', undefined, ui),
    editCopy: say('editCopy', undefined, ui),
    saveCopy: say('saveCopy', undefined, ui),
    cancel: say('cancel', undefined, ui),
    pasteLabel: say('pasteLabel', undefined, ui),
    emptyTitle: say('emptyTitle', undefined, ui),
    emptyBody: say('emptyBody', undefined, ui),
    exampleNote: say('boundary', undefined, ui),
    progress: (percent) => say('progress', { percent }, ui),
    // The reader would estimate the reading time of this generated page. What counts is the source's own time.
    minutes: () => (minutes !== undefined && minutes > 0 ? formatHours(minutes, { lang: ui }) : ''),
    newTab: say('newTab', undefined, ui),
    linkDiffers: (host) => say('linkDiffers', { host }, ui),
    notes: say('notes', undefined, ui),
    notesCount: (used, max) => say('notesCount', { used, max }, ui),
    endOfText: say('endGroup', undefined, ui),
    markRead: say('markUsed', undefined, ui),
    next: (title) => say('nextLink', { title }, ui),
    smaller: say('smaller', undefined, ui),
    larger: say('larger', undefined, ui),
    textSize: say('textSize', undefined, ui),
    // The reader formats the day itself; this says what the day was.
    saved: (date) => say(saved, { date }, ui),
  };
}

/** The markdown-lite text of the generated page. */
export function pageText(entry: ShelfEntry, roadmap: Roadmap, ui: UiLang = uiLang()): string {
  const resource = entry.resource;
  const lines: string[] = [];
  const kind = say(
    'kindLine',
    { type: typeName(resource.type, ui), level: say(TIER_KEYS[resource.level] ?? 'tierBronze', undefined, ui), language: languageName(resource.lang, ui) },
    ui,
  );
  lines.push(`## ${say('headWhat', undefined, ui)}`, '', kind);
  if (resource.updated) lines.push('', say('updated', { date: formatDay(resource.updated, { style: 'iso' }) }, ui));
  lines.push('', `## ${say('headCost', undefined, ui)}`, '', costSentence(resource, ui));
  lines.push('', `## ${say('headCheck', undefined, ui)}`, '', prose(statusSentence(resource, ui)));
  const task = taskFor(entry, roadmap, ui);
  if (task) {
    lines.push('', `## ${task.heading}`, '', `### ${prose(task.title)}`, '', prose(task.text));
    if (task.time) lines.push('', task.time);
  }
  return lines.join('\n');
}

/** Everything the reader needs to show one volume. The address is passed only when it is http or https. */
export function readerDoc(entry: ShelfEntry, roadmap: Roadmap, ui: UiLang = uiLang()): ReaderDoc {
  const resource = entry.resource;
  return {
    id: resource.id,
    title: resource.title,
    url: safeHref(resource.url) ?? '',
    ...(resource.by ? { author: resource.by } : {}),
    // Noon local time, so the reader's own date formatting prints the same calendar day in every time zone.
    addedAt: `${formatDay(resource.check.on, { style: 'iso' })}T12:00:00`,
    note: resource.why,
    text: pageText(entry, roadmap, ui),
    lang: roadmap.lang,
  };
}
