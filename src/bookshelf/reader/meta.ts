import type { ReaderLabels } from './types';

export const WORDS_PER_MINUTE = 220;

/** `progress` receives a whole percent from 0 to 100. */
export const defaultReaderLabels: ReaderLabels = {
  close: 'Back to shelf',
  openOriginal: 'Open original',
  editCopy: 'Edit text',
  saveCopy: 'Save text',
  cancel: 'Cancel',
  pasteLabel: 'Text to read',
  emptyTitle: 'No text saved yet',
  exampleNote: 'Example text written for this app. It is not the linked page.',
  emptyBody:
    'Paste the part of the page you want to read. It stays with this link, and the reader remembers where you stop.',
  progress: (percent) => `${percent}% read`,
  minutes: (minutes) => `${minutes} min`,
  newTab: 'opens in a new tab',
  linkDiffers: (host) => `Goes to ${host}`,
  notes: 'My notes (they stay in this browser)',
  notesCount: (used, max) => `${used} of ${max} characters`,
  endOfText: 'End of text',
  markRead: 'Mark as read',
  next: (title, minutes) => (minutes ? `Next: ${title}, about ${minutes}` : `Next: ${title}`),
  smaller: 'Smaller text',
  larger: 'Larger text',
  textSize: 'Text size',
  saved: (date) => `Saved ${date}`,
};

/** Merges overrides over the defaults, ignoring keys that are explicitly undefined. */
export function resolveLabels(overrides?: Partial<ReaderLabels>): ReaderLabels {
  const merged: ReaderLabels = { ...defaultReaderLabels };
  if (!overrides) return merged;
  for (const key of Object.keys(overrides) as (keyof ReaderLabels)[]) {
    const value = overrides[key];
    if (value !== undefined) Object.assign(merged, { [key]: value });
  }
  return merged;
}

/** Reading time in whole minutes, at least 1. */
export function estimateMinutes(text: string): number {
  const words = typeof text === 'string' ? text.split(/\s+/).filter(Boolean).length : 0;
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}

/** Hostname without a leading `www.`, or an empty string when the URL is not parseable. */
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** A language tag the platform can use, or an empty string for anything that is not one. */
export function cleanLang(value: string | undefined): string {
  const tag = (value ?? '').trim();
  return tag.length <= 12 && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/.test(tag) ? tag : '';
}

export interface SavedDate {
  text: string;
  iso: string;
}

const EN_OPTIONS: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };

/** Plain English reads day first with a three-letter month: the locale data spells September "Sept". */
function formatEnglish(date: Date): string {
  const part = (type: string): string =>
    new Intl.DateTimeFormat('en-US', EN_OPTIONS).formatToParts(date).find((entry) => entry.type === type)?.value ?? '';
  return `${part('day')} ${part('month')} ${part('year')}`;
}

export function formatSavedDate(addedAt: string | undefined, locale?: string): SavedDate | null {
  if (!addedAt) return null;
  const date = new Date(addedAt);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const text = !locale || /^en$/i.test(locale) ? formatEnglish(date) : new Intl.DateTimeFormat(locale, EN_OPTIONS).format(date);
    return { text, iso: date.toISOString() };
  } catch {
    return null;
  }
}
