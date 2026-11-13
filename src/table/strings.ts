import { defineStrings } from '../i18n';

/** The words the table prints on covers and writes into the readout. Roadmap text is never among them. */
export const TABLE_STRINGS = {
  en: {
    number: 'No. {n}',
    example: 'Example',
    stages: { one: '{count} stage', other: '{count} stages' },
    cards: { one: '{count} card', other: '{count} cards' },
    toTier: 'to {tier}',
    walked: '{percent} % walked',
    cardOf: 'Card {k} of {n}',
    stage: 'Stage {i}',
    stageOf: 'Stage {i} of {n}',
    hours: 'hours',
    tierBronze: 'Bronze',
    tierSilver: 'Silver',
    tierGold: 'Gold',
    tierDiamond: 'Diamond',
    pinGate: 'The pin stands at the gate',
    pinStage: 'The pin stands in stage {i}',
    pinSummit: 'The pin stands on the summit',
  },
  de: {
    number: 'Nr. {n}',
    example: 'Beispiel',
    stages: { one: '{count} Etappe', other: '{count} Etappen' },
    cards: { one: '{count} Karte', other: '{count} Karten' },
    toTier: 'bis {tier}',
    walked: '{percent} % gegangen',
    cardOf: 'Karte {k} von {n}',
    stage: 'Etappe {i}',
    stageOf: 'Etappe {i} von {n}',
    hours: 'Stunden',
    tierBronze: 'Bronze',
    tierSilver: 'Silber',
    tierGold: 'Gold',
    tierDiamond: 'Diamant',
    pinGate: 'Die Nadel steht am Tor',
    pinStage: 'Die Nadel steht in Etappe {i}',
    pinSummit: 'Die Nadel steht auf dem Gipfel',
  },
} as const;

export const say = defineStrings('table', TABLE_STRINGS);

export type TableStringKey = keyof (typeof TABLE_STRINGS)['en'];

const TIER_KEYS = {
  bronze: 'tierBronze',
  silver: 'tierSilver',
  gold: 'tierGold',
  diamond: 'tierDiamond',
} as const satisfies Record<string, TableStringKey>;

export function tierKey(tier: keyof typeof TIER_KEYS): TableStringKey {
  return TIER_KEYS[tier];
}
