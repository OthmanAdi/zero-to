/**
 * Roadmap resources as Bookshelf volumes, and the words the dock prints about them. All pure.
 */
import { uiLang, type UiLang } from '../i18n';
import { formatDay, formatHours } from '../look/format';
import { CLOTHS, hashText, PATTERNS, type ClothName, type PatternName, type ShelfItem } from '../bookshelf/shelf';
import { TIER_NAMES } from '../scene/palette';
import type { Price, Resource, ResourceType, Roadmap } from '../roadmap/types';
import { say } from './strings';
import type { DockItem, ShelfEntry, ShelfPin, UsedLookup } from './types';

export interface Look {
  readonly cloth: ClothName;
  readonly pattern: PatternName;
}

/** Cloth and cover pattern by resource type, so one kind of source always looks like one series. */
export const TYPE_LOOK: Readonly<Record<ResourceType, Look>> = {
  docs: { cloth: 'slate', pattern: 'tiles' },
  reference: { cloth: 'slate', pattern: 'bars' },
  book: { cloth: 'rust', pattern: 'arcs' },
  course: { cloth: 'plum', pattern: 'rays' },
  video: { cloth: 'teal', pattern: 'waves' },
  article: { cloth: 'bone', pattern: 'bars' },
  interactive: { cloth: 'ochre', pattern: 'dots' },
  exercises: { cloth: 'moss', pattern: 'tiles' },
  tool: { cloth: 'ink', pattern: 'rays' },
  community: { cloth: 'ochre', pattern: 'waves' },
};

/** The look of a type. A type this version does not know gets the first cloth and the first pattern. */
export function lookFor(type: string): Look {
  return Object.hasOwn(TYPE_LOOK, type) ? TYPE_LOOK[type as ResourceType] : { cloth: CLOTHS[0], pattern: PATTERNS[0] };
}

/** The address when it is an absolute http or https URL, otherwise null. Nothing else ever becomes a link. */
export function safeHref(url: string | undefined): string | null {
  const candidate = (url ?? '').trim();
  if (!candidate || /\s/.test(candidate)) return null;
  try {
    const { protocol } = new URL(candidate);
    return protocol === 'http:' || protocol === 'https:' ? candidate : null;
  } catch {
    return null;
  }
}

/** Host without `www.`, for the imprint on the cover. Empty for an address that is not http or https. */
export function hostOf(url: string): string {
  const href = safeHref(url);
  if (!href) return '';
  try {
    return new URL(href).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const day = (value: string): string => formatDay(value, { style: 'iso' });

/** "€29 a month", or "29 XYZ" when the platform does not know the currency. */
export function formatPrice(price: Price, ui: UiLang = uiLang()): string {
  let amount: string;
  try {
    amount = new Intl.NumberFormat(ui, {
      style: 'currency',
      currency: price.currency,
      minimumFractionDigits: Number.isInteger(price.amount) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(price.amount);
  } catch {
    amount = `${price.amount} ${price.currency}`;
  }
  if (price.per === 'month') return say('perMonth', { price: amount }, ui);
  if (price.per === 'year') return say('perYear', { price: amount }, ui);
  if (price.per === 'once') return say('perOnce', { price: amount }, ui);
  return amount;
}

/** The cost word: Free, Free with paid parts, Paid. */
export function costWord(resource: Resource, ui: UiLang = uiLang()): string {
  if (resource.cost === 'free') return say('costFree', undefined, ui);
  if (resource.cost === 'freemium') return say('costFreemium', undefined, ui);
  return say('costPaid', undefined, ui);
}

/** The cost as a sentence for the reader: "Free." or "Paid: €29 a month, price seen on 2026-11-13." */
export function costSentence(resource: Resource, ui: UiLang = uiLang()): string {
  const word = costWord(resource, ui);
  if (!resource.price) return `${word}.`;
  const price = say('priceSeen', { price: formatPrice(resource.price, ui), date: day(resource.price.seenOn) }, ui);
  return `${word}: ${price}.`;
}

/**
 * The caption's status line. A verified volume reads "Free · about 45 min · opened 2026-11-13"; a gated or
 * unverified one reads its short warning instead, because that is what a learner must see first.
 */
export function statusLine(resource: Resource, ui: UiLang = uiLang()): string {
  const date = day(resource.check.on);
  if (resource.check.status === 'gated') return say('lineGated', { date }, ui);
  if (resource.check.status === 'unverified') {
    return resource.check.http !== null && resource.check.http !== undefined
      ? say('lineUnverifiedHttp', { date, http: resource.check.http }, ui)
      : say('lineUnverified', { date }, ui);
  }
  const cost = resource.price && resource.cost !== 'free' ? formatPrice(resource.price, ui) : costWord(resource, ui);
  const parts = [cost];
  if (resource.minutes !== undefined && resource.minutes > 0) parts.push(formatHours(resource.minutes, { lang: ui }));
  parts.push(say('opened', { date }, ui));
  return parts.join(' · ');
}

/** The full status sentence, followed by the checker's own note when the entry has one. */
export function statusSentence(resource: Resource, ui: UiLang = uiLang()): string {
  const date = day(resource.check.on);
  let sentence: string;
  if (resource.check.status === 'gated') sentence = say('sentenceGated', { date }, ui);
  else if (resource.check.status === 'unverified') {
    sentence =
      resource.check.http !== null && resource.check.http !== undefined
        ? say('sentenceUnverifiedHttp', { date, http: resource.check.http }, ui)
        : say('sentenceUnverified', { date }, ui);
  } else sentence = say('sentenceVerified', { date }, ui);
  const note = resource.check.note?.trim();
  return note ? `${sentence} ${note}` : sentence;
}

/** The type's name in the interface language. */
export function typeName(type: string, ui: UiLang = uiLang()): string {
  const key = {
    docs: 'typeDocs',
    reference: 'typeReference',
    book: 'typeBook',
    course: 'typeCourse',
    video: 'typeVideo',
    article: 'typeArticle',
    interactive: 'typeInteractive',
    exercises: 'typeExercises',
    tool: 'typeTool',
    community: 'typeCommunity',
  }[type] as Parameters<typeof say>[0] | undefined;
  return say(key ?? 'typeOther', undefined, ui);
}

/**
 * The roadmap's resources as volumes. `source` is the hostname, `author` is `by`, thickness is minutes over
 * 240, stature is 0.5 plus the tier index over 6, the seed is a hash of the id, `note` is `why`, and `done`
 * says whether the learner marked the volume as used.
 */
export function toShelfItems(entries: readonly ShelfEntry[], progress?: UsedLookup | null, ui: UiLang = uiLang()): DockItem[] {
  return entries.map((entry) => {
    const resource = entry.resource;
    const look = lookFor(resource.type);
    const tier = Math.max(0, TIER_NAMES.indexOf(resource.level));
    return {
      id: resource.id,
      resourceId: resource.id,
      title: resource.title,
      source: hostOf(resource.url),
      author: resource.by,
      cloth: look.cloth,
      pattern: look.pattern,
      seed: hashText(resource.id),
      thickness: resource.minutes !== undefined && resource.minutes > 0 ? clamp01(resource.minutes / 240) : undefined,
      stature: 0.5 + tier / 6,
      lang: resource.lang,
      note: resource.why,
      done: progress?.isUsed(resource.id) === true,
      type: resource.type,
      cost: resource.cost,
      status: resource.check.status,
      checkedOn: resource.check.on,
      why: resource.why,
      statusLine: statusLine(resource, ui),
      statusSentence: statusSentence(resource, ui),
      for: entry.for,
      main: entry.main,
    };
  });
}

/**
 * A volume's accessible name in the interface language: "Title. host. Volume 2 of 5", then "Marked as read" or
 * "40 percent read". The English is word for word what the Bookshelf row writes itself, which only speaks
 * English; the dock writes this over it (a test holds the two together).
 */
export function volumeLabel(item: ShelfItem, index: number, count: number, ui: UiLang = uiLang()): string {
  const parts = [item.title];
  if (item.source) parts.push(item.source);
  parts.push(say('volumeAt', { index: index + 1, count }, ui));
  const progress = item.progress ?? 0;
  if (item.done) parts.push(say('volumeDone', undefined, ui));
  else if (progress > 0) parts.push(say('volumeRead', { percent: Math.round(progress * 100) }, ui));
  return parts.join('. ');
}

/** The shelf's own live line after one of its arrows moved the row ("Title, 2 of 5"), in the interface language. */
const RESTED = /^([\s\S]*), (\d+) of (\d+)$/;

/**
 * The Bookshelf row's "where the row came to rest" line in the interface language, or null when `text` is not
 * that line as the shelf writes it (for example because it was already rewritten).
 */
export function restedLine(text: string, ui: UiLang = uiLang()): string | null {
  const match = RESTED.exec(text);
  if (!match) return null;
  return say('restedAt', { title: match[1] ?? '', index: Number(match[2]), count: Number(match[3]) }, ui);
}

/**
 * The dock header in two parts: what is on the shelf and when it was opened ("5 sources · opened 2026-11-13",
 * with the oldest and newest day when they differ), and the marked states ("1 gated · 2 unverified"), which is
 * empty when every source was verified. The dock sets the second part on its own line when it does not fit.
 */
export function dockHeaderParts(entries: readonly ShelfEntry[], ui: UiLang = uiLang()): { main: string; flags: string } {
  if (entries.length === 0) return { main: say('empty', undefined, ui), flags: '' };
  const days = entries.map((entry) => day(entry.resource.check.on)).sort();
  const first = days[0] as string;
  const last = days[days.length - 1] as string;
  const opened = first === last ? say('opened', { date: first }, ui) : say('openedRange', { from: first, to: last }, ui);
  const gated = entries.filter((entry) => entry.resource.check.status === 'gated').length;
  const unverified = entries.filter((entry) => entry.resource.check.status === 'unverified').length;
  const flags: string[] = [];
  if (gated > 0) flags.push(say('gatedCount', { count: gated }, ui));
  if (unverified > 0) flags.push(say('unverifiedCount', { count: unverified }, ui));
  return { main: `${say('sources', { count: entries.length }, ui)} · ${opened}`, flags: flags.join(' · ') };
}

/** "5 sources · opened 2026-11-13 · 1 gated". */
export function dockHeader(entries: readonly ShelfEntry[], ui: UiLang = uiLang()): string {
  const { main, flags } = dockHeaderParts(entries, ui);
  return flags ? `${main} · ${flags}` : main;
}

/** Where an entry sits in the roadmap: its stage, and its waypoint unless it belongs to a camp's project. */
export function placeOf(entry: ShelfEntry, roadmap: Roadmap): { stageId: string; waypointId?: string } | null {
  for (const stage of roadmap.stages) {
    if (entry.for === 'project') {
      if (stage.project?.resources?.includes(entry.resource.id)) return { stageId: stage.id };
    } else if (stage.waypoints.some((waypoint) => waypoint.id === entry.for)) {
      return { stageId: stage.id, waypointId: entry.for };
    }
  }
  return null;
}

/** The notebook pin for a volume: its title and why, and its address when that is http or https. */
export function pinFor(entry: ShelfEntry, stageId: string, waypointId?: string): ShelfPin {
  const resource = entry.resource;
  const text = `${resource.title}: ${resource.why}`;
  const url = safeHref(resource.url);
  return {
    kind: 'link',
    resourceId: resource.id,
    text: text.length > 500 ? `${text.slice(0, 499)}…` : text,
    ...(url ? { url } : {}),
    stageId,
    ...(waypointId ? { waypointId } : {}),
  };
}
