/**
 * The list of sources on a card: each with why it is there, what it costs and what happened when the link was
 * opened. Verified sources carry the day they were opened; gated and unverified ones say so in words.
 */
import { uiLang, type UiLang } from '../i18n';
import { day as formatDay, hours as formatHours } from './format';
import type { Resource } from '../roadmap/types';
import { h, roadText, srOnly } from './dom';
import { safeUrl } from './notebook';
import { say } from './strings';

/** The language's own name in the interface language: `de` is "German" in English. */
export function languageName(code: string, lang: UiLang = uiLang()): string {
  try {
    const names = new Intl.DisplayNames([lang], { type: 'language' });
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

function priceText(resource: Resource, lang: UiLang): string | null {
  const price = resource.price;
  if (!price) return null;
  let amount: string;
  try {
    amount = new Intl.NumberFormat(lang, { style: 'currency', currency: price.currency }).format(price.amount);
  } catch {
    amount = `${price.amount} ${price.currency}`;
  }
  const day = formatDay(price.seenOn, { lang });
  const key = price.per === 'month' ? 'priceMonth' : price.per === 'year' ? 'priceYear' : 'priceOnce';
  return say(key, { amount, day }, lang);
}

/**
 * The status line under a source: "Free · about 45 min · opened 13 Nov 2026" for a verified one, the cost and
 * price for paid ones. Gated and unverified sources get their own sentence from `statusSentence`.
 */
export function resourceLine(resource: Resource, lang: UiLang = uiLang()): string {
  const parts = [say(`cost.${resource.cost}`, undefined, lang)];
  const price = priceText(resource, lang);
  if (price) parts.push(price);
  if (resource.minutes) parts.push(formatHours(resource.minutes, { lang }));
  if (resource.check.status === 'verified') parts.push(say('opened', { day: formatDay(resource.check.on, { lang }) }, lang));
  return parts.join(' · ');
}

/** The sentence for a gated or unverified source, or null for a verified one. */
export function statusSentence(resource: Resource, lang: UiLang = uiLang()): string | null {
  const day = formatDay(resource.check.on, { lang });
  if (resource.check.status === 'gated') return say('gatedLine', { day }, lang);
  if (resource.check.status === 'unverified') {
    return resource.check.http ? say('unverifiedHttp', { day, http: resource.check.http }, lang) : say('unverifiedPlain', { day }, lang);
  }
  return null;
}

export interface ResourceListOptions {
  readonly resources: readonly Resource[];
  /** The roadmap's language, for `why` and the titles. */
  readonly lang: string;
  /** Mark the first source as the main one. */
  readonly mainFirst?: boolean;
}

export interface ResourceList {
  readonly root: HTMLUListElement;
  /** Locked links have no address yet, so they cannot be followed or focused, and say why. */
  setLocked(locked: boolean): void;
}

export function resourceList(options: ResourceListOptions): ResourceList {
  const lang = uiLang();
  const links: { readonly a: HTMLAnchorElement; readonly href: string | null }[] = [];
  const root = h('ul', { class: 'zl-sources-list', role: 'list' });

  options.resources.forEach((resource, index) => {
    const href = safeUrl(resource.url);
    const status = resource.check.status;
    const kind = [
      options.mainFirst ? say(index === 0 ? 'mainSource' : 'otherSource') : null,
      say(`type.${resource.type}`),
      resource.lang.split('-')[0] !== options.lang.split('-')[0] ? say('inLang', { language: languageName(resource.lang, lang) }) : null,
    ]
      .filter(Boolean)
      .join(' · ');

    const title = roadText('a', resource.title, resource.lang, { class: 'zl-source-title' });
    if (href) {
      title.setAttribute('target', '_blank');
      title.setAttribute('rel', 'noopener noreferrer');
      title.append(srOnly(` ${say('opensNewTab')}`));
    }
    links.push({ a: title, href });

    const sentence = statusSentence(resource, lang);
    const item = h(
      'li',
      { class: 'zl-source', 'data-status': status },
      h('p', { class: 'zl-label zl-source-kind' }, kind),
      h('p', { class: 'zl-source-head' }, title),
      resource.by ? roadText('p', resource.by, resource.lang, { class: 'zl-source-by' }) : null,
      roadText('p', resource.why, options.lang, { class: 'zl-why' }),
      status !== 'verified'
        ? h(
            'p',
            { class: 'zl-source-flag' },
            h('span', { class: 'zl-flag-word' }, say(status === 'gated' ? 'statusGated' : 'statusUnverified')),
            ' ',
            sentence,
          )
        : null,
      status !== 'verified' && resource.check.note ? roadText('p', resource.check.note, options.lang, { class: 'zl-source-note' }) : null,
      h('p', { class: 'zl-source-line' }, resourceLine(resource, lang)),
    );
    root.append(item);
  });

  const setLocked = (locked: boolean): void => {
    root.toggleAttribute('data-locked', locked);
    for (const { a, href } of links) {
      if (locked || !href) {
        a.removeAttribute('href');
        a.setAttribute('aria-disabled', 'true');
      } else {
        a.setAttribute('href', href);
        a.removeAttribute('aria-disabled');
      }
    }
  };
  setLocked(false);
  return { root, setLocked };
}
