import { defineStrings } from '../i18n';

/**
 * The words this package prints: the stage board, the names and plain descriptions of the signpost styles a
 * roadmap can choose, and the names of the station pieces. Roadmap text is never among them.
 */
export const PROPS_STRINGS = {
  en: {
    stageOf: 'Stage {i} of {n}',
    handsOn: '{percent} % hands-on',
    tierUp: 'Up to {tier}',
    passed: 'Passed',
    tierBronze: 'Bronze',
    tierSilver: 'Silver',
    tierGold: 'Gold',
    tierDiamond: 'Diamond',

    signTimberName: 'Timber fingerpost',
    signTimber: 'A wooden post with pointed boards, the classic sign at a path junction. It suits any roadmap and is the default.',
    signCairnName: 'Cairn',
    signCairn: 'A pile of flat stones with a weathered stick through the top that carries the boards. For bare, stony or desert ground where nothing else would stand.',
    signTrigPillarName: 'Survey pillar',
    signTrigPillar: 'A squat concrete survey pillar with a brass plate and a steel rod that carries enamel plates. For exact subjects: mathematics, measurement, engineering.',
    signBlazePostName: 'Waymark post',
    signBlazePost: 'A grey squared post with a painted white and red waymark near the top. For woodland and for long routes with many small steps.',
    signSnowPoleName: 'Snow pole',
    signSnowPole: 'A tall black and white pole in a snow drift, the kind that marks a road under deep snow. For high, cold or wintry roadmaps.',
    signBuoyName: 'Buoy',
    signBuoy: 'A brass buoy on the water with a lattice mast, a lamp and signal pennants. For water, coasts and anything that is a voyage.',
    signSummitFlagName: 'Summit flag',
    signSummitFlag: 'A tall pole on a few stones with a long pennant at the top and smaller pennants below. For the last checkpoint, or for a short roadmap with one clear goal.',

    stationStages: 'Stages',
    stationCheckpoints: 'Checkpoints',
    stationProjects: 'Projects',
    stationSources: 'Checked sources',
    stationPace: 'Pace',
  },
  de: {
    stageOf: 'Etappe {i} von {n}',
    handsOn: '{percent} % Praxis',
    tierUp: 'Aufstieg zu {tier}',
    passed: 'Geschafft',
    tierBronze: 'Bronze',
    tierSilver: 'Silber',
    tierGold: 'Gold',
    tierDiamond: 'Diamant',

    signTimberName: 'Holzwegweiser',
    signTimber: 'Ein Holzpfosten mit spitzen Brettern, der klassische Wegweiser an einer Weggabelung. Er passt zu jeder Roadmap und ist die Voreinstellung.',
    signCairnName: 'Steinmann',
    signCairn: 'Ein Stapel flacher Steine mit einem verwitterten Stock, der die Bretter trägt. Für kahlen, steinigen oder wüstenhaften Boden, auf dem sonst nichts stehen würde.',
    signTrigPillarName: 'Vermessungspfeiler',
    signTrigPillar: 'Ein gedrungener Betonpfeiler der Landesvermessung mit Messingplatte und einer Stahlstange, die Emailschilder trägt. Für genaue Fächer: Mathematik, Messen, Technik.',
    signBlazePostName: 'Markierungspfosten',
    signBlazePost: 'Ein grauer Vierkantpfosten mit einer weiß-roten Wegmarkierung oben. Für Wald und für lange Routen mit vielen kleinen Schritten.',
    signSnowPoleName: 'Schneestange',
    signSnowPole: 'Eine hohe schwarz-weiße Stange in einer Schneewehe, wie sie eine Straße unter tiefem Schnee markiert. Für hohe, kalte oder winterliche Roadmaps.',
    signBuoyName: 'Boje',
    signBuoy: 'Eine Messingboje auf dem Wasser mit Gittermast, Lampe und Signalwimpeln. Für Wasser, Küsten und alles, was eine Überfahrt ist.',
    signSummitFlagName: 'Gipfelfahne',
    signSummitFlag: 'Eine hohe Stange auf ein paar Steinen mit einem langen Wimpel an der Spitze und kleineren darunter. Für den letzten Checkpoint oder für eine kurze Roadmap mit einem klaren Ziel.',

    stationStages: 'Etappen',
    stationCheckpoints: 'Checkpoints',
    stationProjects: 'Projekte',
    stationSources: 'Geprüfte Quellen',
    stationPace: 'Tempo',
  },
} as const;

export const say = defineStrings('props', PROPS_STRINGS);
