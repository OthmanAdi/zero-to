import { defineStrings } from '../i18n';

/**
 * The words the look itself needs: units, the "about" of an estimate and the name of the mark. A number and its
 * unit are joined by a no-break space (U+00A0), so a line never ends between them.
 */
export const say = defineStrings('look', {
  en: {
    hours: '{n}\u00a0h',
    minutes: '{n}\u00a0min',
    about: 'about {duration}',
    brand: 'zero-to',
    brandMark: 'zero-to mark: a zero crossed by a compass needle',
  },
  de: {
    hours: '{n}\u00a0Std.',
    minutes: '{n}\u00a0Min.',
    about: 'ca. {duration}',
    brand: 'zero-to',
    brandMark: 'zero-to Zeichen: eine Null, von einer Kompassnadel gekreuzt',
  },
});
