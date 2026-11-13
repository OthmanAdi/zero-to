/**
 * Calendar days as "YYYY-MM-DD" strings, computed in UTC so that a day is always 24 hours and nothing depends on
 * the machine's time zone.
 */

const DAY_MS = 86_400_000;

/** Milliseconds since 1970 for a real calendar day, or null for anything else (also "2026-02-30"). */
export function parseDay(text: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = Date.UTC(year, month - 1, day);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) return null;
  return ms;
}

export function isRealDay(text: string): boolean {
  return parseDay(text) !== null;
}

export function formatDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** A day given as text or as a Date (its UTC day). Throws on text that is not a real day. */
export function toDayMs(day: string | Date): number {
  if (typeof day !== 'string') return Math.floor(day.getTime() / DAY_MS) * DAY_MS;
  const ms = parseDay(day.slice(0, 10));
  if (ms === null) throw new Error(`"${day}" is not a calendar day (expected YYYY-MM-DD)`);
  return ms;
}

export function toDay(day: string | Date): string {
  return formatDay(toDayMs(day));
}

export function addDays(day: string, days: number): string {
  return formatDay(toDayMs(day) + Math.round(days) * DAY_MS);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string | Date, to: string | Date): number {
  return Math.round((toDayMs(to) - toDayMs(from)) / DAY_MS);
}
