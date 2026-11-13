/**
 * The look's formatters, with the spaces next to a number made non-breaking, so "about 19 h" and "17 Mar 2027"
 * never break between the number and its unit or month on a narrow card.
 */
import { formatDay as lookDay, formatHours as lookHours, type DayOptions, type HoursOptions } from '../look/format';

/** Spaces right before or after a digit become no-break spaces. */
export function keepTogether(text: string): string {
  return text.replace(/ (?=\d)|(?<=\d) /g, ' ');
}

export function hours(minutes: number, options?: HoursOptions): string {
  return keepTogether(lookHours(minutes, options));
}

export function day(value: string | Date, options?: DayOptions): string {
  return keepTogether(lookDay(value, options));
}
