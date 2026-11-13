import { describe, expect, it } from 'vitest';
import { TOPIC_MAX, cleanTopic, quoteTopic, ticketCommand, ticketReady } from './command';

describe('the ticket command', () => {
  it('writes a plain topic as it was typed', () => {
    expect(ticketCommand({ topic: 'Rust' })).toBe('/zero-to Rust');
    expect(ticketCommand({ topic: 'LangGraph for a Python developer' })).toBe('/zero-to LangGraph for a Python developer');
    expect(ticketCommand({ topic: "Beethoven's piano sonatas" })).toBe("/zero-to Beethoven's piano sonatas");
    expect(ticketCommand({ topic: 'Türkçe A1, 中文, العربية' })).toBe('/zero-to Türkçe A1, 中文, العربية');
  });

  it('escapes quotes in a topic and puts the topic in quotes', () => {
    expect(quoteTopic('the "Dune" novels')).toBe('"the \\"Dune\\" novels"');
    expect(ticketCommand({ topic: 'the "Dune" novels' })).toBe('/zero-to "the \\"Dune\\" novels"');
    expect(ticketCommand({ topic: '"' })).toBe('/zero-to "\\""');
  });

  it('escapes a backslash before it escapes a quote, so the two cannot be confused', () => {
    expect(quoteTopic('C:\\temp')).toBe('"C:\\\\temp"');
    expect(quoteTopic('a\\"b')).toBe('"a\\\\\\"b"');
  });

  it('quotes a topic with a backtick or a curly double quote', () => {
    expect(quoteTopic('the `ls` command')).toBe('"the `ls` command"');
    expect(quoteTopic('„Faust“ lesen')).toBe('"„Faust“ lesen"');
  });

  it('quotes a topic that could be read as an option or as another command', () => {
    expect(ticketCommand({ topic: '--defaults' })).toBe('/zero-to "--defaults"');
    expect(ticketCommand({ topic: 'Rust --defaults' })).toBe('/zero-to "Rust --defaults"');
    expect(ticketCommand({ topic: '/zero-to recheck x' })).toBe('/zero-to "/zero-to recheck x"');
    expect(ticketCommand({ topic: '-v' })).toBe('/zero-to "-v"');
    // A hyphen inside a word is only a hyphen.
    expect(ticketCommand({ topic: 'object-oriented design' })).toBe('/zero-to object-oriented design');
  });

  it('keeps the command on one line', () => {
    expect(cleanTopic('  Rust\n\nfor\tbeginners  ')).toBe('Rust for beginners');
    expect(cleanTopic(`a${String.fromCharCode(0x2028)}b${String.fromCharCode(0x2029)}c${String.fromCharCode(0)}d`)).toBe('a b c d');
    expect(ticketCommand({ topic: 'Rust\n--defaults' })).toBe('/zero-to "Rust --defaults"');
    expect(ticketCommand({ topic: 'x\r\n/other' })).not.toMatch(/[\r\n]/);
  });

  it('cuts a topic at 120 characters without splitting a character', () => {
    const long = '𝔘'.repeat(TOPIC_MAX + 30);
    expect(Array.from(cleanTopic(long))).toHaveLength(TOPIC_MAX);
    expect(cleanTopic(long)).toBe('𝔘'.repeat(TOPIC_MAX));
  });

  it('adds who it is for and the hours a week in words', () => {
    expect(ticketCommand({ topic: 'Rust', audience: 'self', hours: 5 })).toBe('/zero-to Rust, about 5 hours a week');
    expect(ticketCommand({ topic: 'Rust', audience: 'student', hours: 2 })).toBe('/zero-to Rust, for a student I mentor, about 2 hours a week');
    expect(ticketCommand({ topic: 'Rust', audience: 'self', hours: 20 })).toBe('/zero-to Rust, 20 hours or more a week');
  });

  it('leaves the hours out for a class, which is planned by sessions', () => {
    expect(ticketCommand({ topic: 'music theory', audience: 'class', hours: 5 })).toBe('/zero-to music theory, for a class I teach');
  });

  it('adds the flag that skips the interview last', () => {
    expect(ticketCommand({ topic: 'Rust', hours: 10, defaults: true })).toBe('/zero-to Rust, about 10 hours a week --defaults');
    expect(ticketCommand({ topic: 'the "Dune" novels', defaults: true })).toBe('/zero-to "the \\"Dune\\" novels" --defaults');
  });

  it('writes the command in German on a German page', () => {
    expect(ticketCommand({ topic: 'Rust', audience: 'class' }, 'de')).toBe('/zero-to Rust, für eine Klasse, die ich unterrichte');
    expect(ticketCommand({ topic: 'Rust', audience: 'student', hours: 5 }, 'de')).toBe('/zero-to Rust, für eine Person, die ich betreue, etwa 5 Stunden pro Woche');
    expect(ticketCommand({ topic: 'Rust', hours: 20 }, 'de')).toBe('/zero-to Rust, 20 Stunden oder mehr pro Woche');
  });

  it('shows the placeholder of the documentation while there is no topic', () => {
    expect(ticketCommand({ topic: '' })).toBe('/zero-to <topic>');
    expect(ticketCommand({ topic: '   ', hours: 5 }, 'de')).toBe('/zero-to <Thema>, etwa 5 Stunden pro Woche');
    expect(ticketReady({ topic: ' \n ' })).toBe(false);
    expect(ticketReady({ topic: 'Rust' })).toBe(true);
  });

  it('ignores hours that are not a positive number', () => {
    expect(ticketCommand({ topic: 'Rust', hours: 0 })).toBe('/zero-to Rust');
    expect(ticketCommand({ topic: 'Rust', hours: Number.NaN })).toBe('/zero-to Rust');
  });
});
