/**
 * The imprint of a volume: the site it comes from, reduced to what a person would call it.
 * Volumes with the same imprint are dressed alike, the way one publisher's books form a series.
 */
export interface Imprint {
  /** The site without subdomains, for example `wikipedia.org`. Empty when the source is not a host name. */
  key: string;
  /** A short name for the foot of a cover, for example `Wikipedia`. */
  name: string;
  /** One character for the device at the tail of a spine. */
  initial: string;
}

/** Endings under which organisations register a name one label further in. A short list on purpose. */
const TWO_PART_ENDINGS = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'com.au',
  'net.au',
  'org.au',
  'edu.au',
  'co.nz',
  'co.jp',
  'ne.jp',
  'or.jp',
  'com.br',
  'com.cn',
  'com.tr',
  'com.mx',
  'co.in',
  'co.za',
  'co.kr',
]);

const NO_IMPRINT: Imprint = { key: '', name: '', initial: '' };

export function imprintOf(source: string | undefined): Imprint {
  const host = (source ?? '').trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/[/:?#].*$/, '');
  if (host === '' || !host.includes('.') || /^[\d.]+$/.test(host)) return NO_IMPRINT;
  const labels = host.split('.').filter((label) => label !== '');
  if (labels.length < 2) return NO_IMPRINT;
  const ending = labels.slice(-2).join('.');
  const keep = TWO_PART_ENDINGS.has(ending) && labels.length >= 3 ? 3 : 2;
  const site = labels.slice(-keep);
  const word = (site[0] ?? '').replace(/-+/g, ' ').trim();
  if (word === '') return NO_IMPRINT;
  const name = word.charAt(0).toUpperCase() + word.slice(1);
  return { key: site.join('.'), name, initial: name.charAt(0) };
}

/** A small stable hash (FNV-1a), so the same text always picks the same treatment. */
export function hashText(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Picks one of `count` treatments for an imprint. Sources without an imprint always get the first. */
export function seriesOf(source: string | undefined, count: number): number {
  const { key } = imprintOf(source);
  return key === '' || count <= 0 ? 0 : hashText(key) % count;
}
