import { uiLang, type UiLang } from '../i18n';
import { formatHours, formatNumber, roundHours } from '../look/format';
import type { TierName } from '../scene/palette';
import { countUp } from './grow';
import { stageOfCard, type SheetData } from './sheet-data';
import { say, tierKey } from './strings';

/**
 * What the side card shows about the lit mountain. The big number counts up with the cards. While a card is
 * under the pointer the line names the stage whose altitude band holds that card, so the mountain works as an
 * index of the roadmap.
 *
 * The strings are in sentence case. An overlay that sets labels in capitals does so in its style sheet, and only
 * for `line`: `title` is roadmap text and is never upper-cased.
 */
export interface ReadoutParts {
  /** Index of the lit sheet. */
  readonly sheet: number;
  /** Hours shown right now, rounded the way they are printed. */
  readonly hours: number;
  /** The same as text in the interface language, without a unit. */
  readonly hoursText: string;
  /** The hours of the whole roadmap. */
  readonly totalHours: number;
  /** The card under the pointer, counted from 1, or null. */
  readonly card: number | null;
  readonly cards: number;
  /** The stage that card belongs to, counted from 1, or null. */
  readonly stage: number | null;
  readonly stages: number;
  readonly tier: TierName | null;
  /** The label line: "Card 7 of 16 · Stage 2 · Silver · about 6 h", or the summary of the roadmap. */
  readonly line: string;
  /** The title of the stage under the pointer, or of the roadmap. Roadmap text: set with its own `lang`. */
  readonly title: string;
  /** Language of `title`. */
  readonly lang: string;
  /** Everything above as one string, which changes exactly when something visible changes. */
  readonly key: string;
}

const SEPARATOR = ' · ';

export function readoutFor(sheet: number, data: SheetData, grow: number, hoverCard: number, lang: UiLang = uiLang()): ReadoutParts {
  const minutes = countUp(data.totalMinutes, grow);
  const hours = roundHours(minutes);
  const hoursText = formatNumber(hours, { lang, fraction: 1 });
  const totalHours = roundHours(data.totalMinutes);
  const hovered = hoverCard >= 0 && hoverCard < data.cards;
  const stageIndex = hovered ? stageOfCard(data, hoverCard) : -1;
  const stage = stageIndex >= 0 ? data.trek.stages[stageIndex] : undefined;

  let line: string;
  let title: string;
  let tier: TierName | null = null;
  if (hovered && stage) {
    tier = stage.tier;
    line = [
      say('cardOf', { k: hoverCard + 1, n: data.cards }, lang),
      say('stage', { i: stageIndex + 1 }, lang),
      say(tierKey(stage.tier), undefined, lang),
      formatHours(stage.minutes, { lang }),
    ].join(SEPARATOR);
    title = stage.title;
  } else {
    line = [
      say('cards', { count: data.cards }, lang),
      say('stages', { count: data.stageCount }, lang),
      say('toTier', { tier: say(tierKey(data.tier), undefined, lang) }, lang),
    ].join(SEPARATOR);
    title = data.roadmap.title;
  }

  return {
    sheet,
    hours,
    hoursText,
    totalHours,
    card: hovered ? hoverCard + 1 : null,
    cards: data.cards,
    stage: stage ? stageIndex + 1 : null,
    stages: data.stageCount,
    tier,
    line,
    title,
    lang: data.roadmap.lang,
    key: `${sheet}|${hoursText}|${line}|${title}`,
  };
}
