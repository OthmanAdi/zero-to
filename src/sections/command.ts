import type { UiLang } from '../i18n';

/**
 * The command the start ticket prints: `/zero-to <topic>` followed by what was punched in. The skill reads the
 * prompt as plain language, so the punched choices are written as words, in the language of the page, because
 * the roadmap is written in the language of its prompt.
 */

export const AUDIENCES = ['self', 'student', 'class'] as const;
export type Audience = (typeof AUDIENCES)[number];

/** The hours a week the ticket offers: the four answers of the interview. */
export const HOURS = [2, 5, 10, 20] as const;

export const TOPIC_MAX = 120;

export interface TicketChoice {
  readonly topic: string;
  readonly audience?: Audience;
  /** Hours a week. Left out for a class, which is planned by sessions. */
  readonly hours?: number;
  /** Skip the interview and take the recommended defaults. */
  readonly defaults?: boolean;
}

/** Control characters and the line and paragraph separators: everything that would break the one line. */
const BREAKS = /[\p{Cc}\p{Zl}\p{Zp}]+/gu;

/** One line, no control characters, single spaces, at most `TOPIC_MAX` characters. */
export function cleanTopic(topic: string): string {
  const flat = topic.replace(BREAKS, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(flat).slice(0, TOPIC_MAX).join('').trim();
}

/** A straight or curly double quote, a backtick or a backslash. */
const NEEDS_QUOTES = /["`\\“”„]/;

/**
 * The topic as it stands in the command. A plain topic is written as typed. A topic that holds a double quote,
 * a backtick or a backslash, or that starts with a dash or a slash or holds a double dash and could be read as
 * an option or a second command, is put in double quotes with its own quotes and backslashes escaped.
 */
export function quoteTopic(topic: string): string {
  const clean = cleanTopic(topic);
  if (clean === '') return '';
  const plain = !NEEDS_QUOTES.test(clean) && !/^[-/]/.test(clean) && !/(^|\s)--/.test(clean);
  if (plain) return clean;
  return `"${clean.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

const WORDS: Readonly<Record<UiLang, { readonly student: string; readonly class: string; readonly hours: (n: number) => string; readonly topic: string }>> = {
  en: {
    student: 'for a student I mentor',
    class: 'for a class I teach',
    hours: (n) => (n >= 20 ? '20 hours or more a week' : `about ${n} hours a week`),
    topic: '<topic>',
  },
  de: {
    student: 'für eine Person, die ich betreue',
    class: 'für eine Klasse, die ich unterrichte',
    hours: (n) => (n >= 20 ? '20 Stunden oder mehr pro Woche' : `etwa ${n} Stunden pro Woche`),
    topic: '<Thema>',
  },
};

/**
 * The whole command line, for example `/zero-to Rust, about 5 hours a week`. Without a topic it shows the
 * placeholder `<topic>`, which is the form the documentation uses.
 */
export function ticketCommand(choice: TicketChoice, lang: UiLang = 'en'): string {
  const words = WORDS[lang];
  const parts = [quoteTopic(choice.topic) || words.topic];
  if (choice.audience === 'student') parts.push(words.student);
  if (choice.audience === 'class') parts.push(words.class);
  const hours = choice.hours;
  if (choice.audience !== 'class' && hours !== undefined && Number.isFinite(hours) && hours > 0) parts.push(words.hours(Math.round(hours)));
  return `/zero-to ${parts.join(', ')}${choice.defaults ? ' --defaults' : ''}`;
}

/** True when the ticket holds enough to be torn off: a topic. */
export function ticketReady(choice: TicketChoice): boolean {
  return cleanTopic(choice.topic) !== '';
}
