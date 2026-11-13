import { uiLang, type UiLang } from '../i18n';
import { say } from './strings';

/**
 * Numbers, durations and days as the interface prints them. Everything goes through `Intl` with the interface
 * language, so German gets a decimal comma and its own date order.
 *
 * Minutes in a roadmap are estimates, and the interface says so: durations read "about 6 h" unless a caller
 * asks for the bare figure (a column of numbers, a map print with its own "about").
 *
 * A number and its unit are joined by a no-break space (U+00A0), and so are the day, month and year of a date,
 * so "6 h" and "13 Nov 2026" never break across two lines. Compare against `NBSP`, not against a plain space.
 */

/** The no-break space that joins a number to its unit and the parts of a date. */
export const NBSP = '\u00a0';

export interface FormatOptions {
  /** Interface language. The visitor's by default. */
  readonly lang?: UiLang;
}

export interface HoursOptions extends FormatOptions {
  /** Put the word for an estimate in front: "about 6 h". On by default. */
  readonly approx?: boolean;
  /** Always print hours, even under one hour: "0.5 h" where the default prints "30 min". */
  readonly unit?: 'auto' | 'hours';
}

const numberFormats = new Map<string, Intl.NumberFormat>();

function numberFormat(lang: UiLang, fraction: number): Intl.NumberFormat {
  const key = `${lang}/${fraction}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(lang, { minimumFractionDigits: 0, maximumFractionDigits: fraction });
    numberFormats.set(key, format);
  }
  return format;
}

/** A plain number in the interface language: `formatNumber(4.5, { lang: 'de' })` is "4,5". */
export function formatNumber(value: number, options: FormatOptions & { readonly fraction?: number } = {}): string {
  return numberFormat(options.lang ?? uiLang(), options.fraction ?? 1).format(value);
}

/** The value of `formatHours` as a number of hours, rounded the way it is printed. */
export function roundHours(minutes: number): number {
  const hours = Math.max(0, minutes) / 60;
  // Halves below ten hours, whole hours above. Finer steps would promise a precision an estimate has not got.
  return hours < 10 ? Math.round(hours * 2) / 2 : Math.round(hours);
}

/**
 * A duration from minutes: "about 45 min", "about 1.5 h", "about 38 h".
 *
 * Under one hour it prints minutes rounded to five. From one hour it prints hours, in halves below ten and
 * whole above. Zero and bad input print "0 min" without the "about".
 */
export function formatHours(minutes: number, options: HoursOptions = {}): string {
  const lang = options.lang ?? uiLang();
  const safe = Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
  let duration: string;
  if (safe < 60 && options.unit !== 'hours') {
    const rounded = safe === 0 ? 0 : Math.max(5, Math.round(safe / 5) * 5);
    duration =
      rounded >= 60
        ? say('hours', { n: numberFormat(lang, 1).format(1) }, lang)
        : say('minutes', { n: numberFormat(lang, 0).format(rounded) }, lang);
  } else {
    duration = say('hours', { n: numberFormat(lang, 1).format(roundHours(safe)) }, lang);
  }
  if (options.approx === false || safe === 0) return duration;
  return say('about', { duration }, lang);
}

export interface DayOptions extends FormatOptions {
  /**
   * `iso` is 2026-11-13, the form stamps and status lines print. `short` is "13 Nov 2026" in the reader's
   * order. `long` adds the weekday. Default `short`.
   */
  readonly style?: 'iso' | 'short' | 'long';
}

interface Ymd {
  readonly y: number;
  readonly m: number;
  readonly d: number;
}

function toYmd(day: string | Date): Ymd | null {
  if (day instanceof Date) {
    if (Number.isNaN(day.getTime())) return null;
    return { y: day.getFullYear(), m: day.getMonth() + 1, d: day.getDate() };
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(day.trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return { y, m, d };
}

const dayFormats = new Map<string, Intl.DateTimeFormat>();

/**
 * A calendar day. Roadmaps store days as `YYYY-MM-DD` with no time and no zone, and that is how they are read:
 * the 13th stays the 13th wherever the reader is. Input that is not a day comes back unchanged.
 */
export function formatDay(day: string | Date, options: DayOptions = {}): string {
  const ymd = toYmd(day);
  if (!ymd) return typeof day === 'string' ? day : '';
  const style = options.style ?? 'short';
  if (style === 'iso') {
    return `${String(ymd.y).padStart(4, '0')}-${String(ymd.m).padStart(2, '0')}-${String(ymd.d).padStart(2, '0')}`;
  }
  const lang = options.lang ?? uiLang();
  const key = `${lang}/${style}`;
  let format = dayFormats.get(key);
  if (!format) {
    // English is set day first ("13 Nov 2026"), which no reader takes for another date.
    format = new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : lang, {
      day: 'numeric',
      month: style === 'long' ? 'long' : 'short',
      year: 'numeric',
      ...(style === 'long' ? { weekday: 'long' as const } : {}),
      timeZone: 'UTC',
    });
    dayFormats.set(key, format);
  }
  const text = format.format(new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d)));
  if (style === 'short') return text.replace(/ /g, NBSP);
  // The long form may break once, after the weekday. Day, month and year stay together.
  const first = text.indexOf(' ');
  return first < 0 ? text : `${text.slice(0, first + 1)}${text.slice(first + 1).replace(/ /g, NBSP)}`;
}
