import { defineStrings } from '../i18n';
import type { TierName } from '../scene/palette';

/**
 * The words the walk prints on its panels, its legend and its mini maps. Roadmap text is never among them:
 * stage and waypoint titles are printed as the roadmap wrote them.
 */
export const WALK_STRINGS = {
  en: {
    stageOf: 'Stage {i} of {n}',
    checked: 'Checked {day}',
    sources: { one: '{count} source', other: '{count} sources' },
    hour: 'Hour {n}',
    camp: 'Camp',
    summit: 'Summit',
    gate: 'Gate',
    legend: 'Legend',
    legendRoute: 'The route ahead',
    legendWalked: 'The route walked',
    legendHere: 'You are here',
    legendWaypoint: 'A step',
    legendSide: 'A side trail',
    legendSignpost: 'Checkpoint: show what you can do',
    legendCamp: 'Camp: build the project',
    legendCairn: 'Cairn: a review is due',
    legendGround: 'Ground by height',
    legendTiers: 'Altitude by tier',
    stages: { one: '{count} stage', other: '{count} stages' },
    toTier: 'to {tier}',
    tierBronze: 'Bronze',
    tierSilver: 'Silver',
    tierGold: 'Gold',
    tierDiamond: 'Diamond',
    surfaceWater: 'Water',
    surfaceSand: 'Sand',
    surfaceGrass: 'Grass',
    surfaceForest: 'Forest',
    surfaceDirt: 'Dirt',
    surfaceScree: 'Scree',
    surfaceRock: 'Rock',
    surfaceSnow: 'Snow',
    uphill: 'Uphill',
    locked: 'Opens at the checkpoint',
  },
  de: {
    stageOf: 'Etappe {i} von {n}',
    checked: 'Geprüft {day}',
    sources: { one: '{count} Quelle', other: '{count} Quellen' },
    hour: 'Stunde {n}',
    camp: 'Lager',
    summit: 'Gipfel',
    gate: 'Tor',
    legend: 'Legende',
    legendRoute: 'Der Weg voraus',
    legendWalked: 'Der gegangene Weg',
    legendHere: 'Du bist hier',
    legendWaypoint: 'Ein Schritt',
    legendSide: 'Ein Nebenweg',
    legendSignpost: 'Kontrollpunkt: zeigen, was du kannst',
    legendCamp: 'Lager: das Projekt bauen',
    legendCairn: 'Steinmann: eine Wiederholung ist fällig',
    legendGround: 'Boden nach Höhe',
    legendTiers: 'Höhe nach Stufe',
    stages: { one: '{count} Etappe', other: '{count} Etappen' },
    toTier: 'bis {tier}',
    tierBronze: 'Bronze',
    tierSilver: 'Silber',
    tierGold: 'Gold',
    tierDiamond: 'Diamant',
    surfaceWater: 'Wasser',
    surfaceSand: 'Sand',
    surfaceGrass: 'Gras',
    surfaceForest: 'Wald',
    surfaceDirt: 'Erde',
    surfaceScree: 'Geröll',
    surfaceRock: 'Fels',
    surfaceSnow: 'Schnee',
    uphill: 'Bergauf',
    locked: 'Öffnet am Kontrollpunkt',
  },
} as const;

export const say = defineStrings('walk', WALK_STRINGS);

export type WalkStringKey = keyof (typeof WALK_STRINGS)['en'];

const TIER_KEYS = { bronze: 'tierBronze', silver: 'tierSilver', gold: 'tierGold', diamond: 'tierDiamond' } as const satisfies Record<TierName, WalkStringKey>;

export function tierKey(tier: TierName): WalkStringKey {
  return TIER_KEYS[tier];
}

const SURFACE_KEYS = {
  water: 'surfaceWater',
  sand: 'surfaceSand',
  grass: 'surfaceGrass',
  forest: 'surfaceForest',
  dirt: 'surfaceDirt',
  scree: 'surfaceScree',
  rock: 'surfaceRock',
  snow: 'surfaceSnow',
} as const satisfies Record<string, WalkStringKey>;

export function surfaceKey(surface: keyof typeof SURFACE_KEYS): WalkStringKey {
  return SURFACE_KEYS[surface];
}
