/**
 * The head of every page: title, description, canonical address, Open Graph and Twitter card, and structured
 * data (JSON-LD). Nothing here is invented: no ratings, no reviews, no prices. A page without a known https
 * address for the site is marked noindex and carries no absolute address at all (fail closed).
 */
import { uiLang, type UiLang } from '../i18n';
import { day as formatDay, hours as formatHours } from '../learn/format';
import { deriveTrek } from '../roadmap/derive';
import type { Roadmap } from '../roadmap/types';
import { anchor, summitTier, tierName } from './outline';
import { say } from './strings';
import { escapeAttr, escapeText, scriptJson } from './tree';

export type PageKind = 'home' | 'gallery' | 'roadmap';

export interface HeadPage {
  readonly kind: PageKind;
  /** The page's path below the site base: '' for the root, 'gallery/', 'r/<id>/'. */
  readonly path: string;
  /** The site's https base without a trailing slash, or null: then the page is noindex. */
  readonly base: string | null;
  readonly ui?: UiLang;
  /** For a roadmap page. */
  readonly roadmap?: Roadmap;
  /** For the home and gallery pages. */
  readonly samples?: readonly Roadmap[];
  /** Path of the 1200 by 630 social image below the base, when the file exists. */
  readonly image?: string | null;
  /** Forces noindex, for example for a page that shows a roadmap from a share link. */
  readonly noindex?: boolean;
}

export const SITE_NAME = 'zero-to';
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
const LICENSE_URL = 'https://www.apache.org/licenses/LICENSE-2.0';
const AUTHOR = { '@type': 'Person', name: 'OthmanAdi', url: 'https://github.com/OthmanAdi' } as const;

/** The absolute address of a path below the base, or null without a base. */
export function absolute(base: string | null, path: string): string | null {
  return base === null ? null : `${base}/${path.replace(/^\/+/, '')}`;
}

/** Cuts text at a word boundary so it fits `max` characters, with an ellipsis when it was cut. */
export function clipWords(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '')}…`;
}

/** ISO 8601 duration for minutes, as schema.org's timeRequired expects: PT41H45M. */
export function isoDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `PT${h > 0 ? `${h}H` : ''}${m > 0 || h === 0 ? `${m}M` : ''}`;
}

/** The interface language a roadmap's page is written in: its own when it is English or German. */
export function pageUi(roadmap: Roadmap): UiLang {
  const primary = roadmap.lang.split('-')[0];
  return primary === 'de' ? 'de' : 'en';
}

export interface PageMeta {
  readonly title: string;
  readonly description: string;
  readonly imageAlt: string;
  readonly lang: string;
}

export function pageMeta(page: HeadPage): PageMeta {
  const ui = page.ui ?? uiLang();
  if (page.kind === 'roadmap' && page.roadmap) {
    const r = page.roadmap;
    const trek = deriveTrek(r);
    const stages = say('stages', { count: r.stages.length }, ui);
    const time = formatHours(trek.totalMinutes, { lang: ui });
    const day = formatDay(r.checkedOn, { lang: ui });
    const tail = say('seoDescription', { summary: '', stages, time, day }, ui).trim();
    const room = 158 - tail.length - 1;
    const description = r.summary && room > 40 ? `${clipWords(r.summary, room)} ${tail}` : say('seoDescriptionShort', { stages, time, day }, ui);
    return {
      title: say('seoTitle', { title: r.title }, ui),
      description,
      imageAlt: say('ogAlt', { title: r.title, stages, time }, ui),
      lang: r.lang,
    };
  }
  if (page.kind === 'gallery') {
    return { title: say('galleryTitle', undefined, ui), description: say('galleryDescription', undefined, ui), imageAlt: say('ogAltSite', undefined, ui), lang: ui };
  }
  return { title: say('siteTitle', undefined, ui), description: say('siteDescription', undefined, ui), imageAlt: say('ogAltSite', undefined, ui), lang: ui };
}

/** Structured data for the page: WebApplication (home), CollectionPage (gallery), LearningResource (a roadmap). */
export function jsonLd(page: HeadPage): Record<string, unknown> {
  const ui = page.ui ?? uiLang();
  const url = absolute(page.base, page.path);
  const meta = pageMeta(page);
  const image = page.image ? absolute(page.base, page.image) : null;
  const withUrl = (value: Record<string, unknown>, at: string | null): Record<string, unknown> => (at ? { ...value, url: at } : value);

  if (page.kind === 'roadmap' && page.roadmap) {
    const r = page.roadmap;
    const trek = deriveTrek(r);
    const id = url ? `${url}#roadmap` : undefined;
    const stages = r.stages.map((stage, i) => {
      const at = url ? `${url}#${anchor.stage(stage.id)}` : null;
      return withUrl(
        {
          '@type': 'LearningResource',
          ...(at ? { '@id': at } : {}),
          name: stage.title,
          position: i + 1,
          educationalLevel: tierName(stage.tier, ui),
          timeRequired: isoDuration(trek.stages[i]?.minutes ?? 0),
          inLanguage: r.lang,
        },
        at,
      );
    });
    const resource: Record<string, unknown> = withUrl(
      {
        '@type': 'LearningResource',
        ...(id ? { '@id': id } : {}),
        name: r.title,
        description: r.summary ?? meta.description,
        inLanguage: r.lang,
        teaches: r.brief.goal ?? r.topic,
        educationalLevel: `${tierName(r.stages[0]?.tier ?? 'bronze', ui)} – ${tierName(summitTier(r), ui)}`,
        learningResourceType: say('kicker', undefined, ui),
        timeRequired: isoDuration(trek.totalMinutes),
        isAccessibleForFree: true,
        dateModified: r.checkedOn,
        ...(image ? { image } : {}),
        hasPart: stages,
      },
      url,
    );
    const list: Record<string, unknown> = {
      '@type': 'ItemList',
      name: `${say('tocTitle', undefined, ui)}: ${r.title}`,
      itemListOrder: 'https://schema.org/ItemListOrderAscending',
      numberOfItems: r.stages.length,
      itemListElement: r.stages.map((stage, i) =>
        withUrl({ '@type': 'ListItem', position: i + 1, name: stage.title }, url ? `${url}#${anchor.stage(stage.id)}` : null),
      ),
    };
    const graph: Record<string, unknown>[] = [resource, list];
    const home = absolute(page.base, '');
    const gallery = absolute(page.base, 'gallery/');
    if (home && gallery && url) {
      graph.push({
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: SITE_NAME, item: home },
          { '@type': 'ListItem', position: 2, name: say('galleryTitle', undefined, ui), item: gallery },
          { '@type': 'ListItem', position: 3, name: r.title, item: url },
        ],
      });
    }
    return { '@context': 'https://schema.org', '@graph': graph };
  }

  if (page.kind === 'gallery') {
    const samples = page.samples ?? [];
    return {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: meta.title,
      description: meta.description,
      ...(url ? { url } : {}),
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: samples.length,
        itemListElement: samples.map((r, i) => withUrl({ '@type': 'ListItem', position: i + 1, name: r.title }, absolute(page.base, `r/${r.id}/`))),
      },
    };
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: SITE_NAME,
    description: meta.description,
    ...(url ? { url } : {}),
    ...(image ? { image } : {}),
    applicationCategory: 'EducationalApplication',
    operatingSystem: 'Any',
    browserRequirements: 'A current web browser. The 3D map needs WebGL; the plain list works without it.',
    isAccessibleForFree: true,
    inLanguage: ['en', 'de'],
    license: LICENSE_URL,
    author: AUTHOR,
  };
}

const meta = (name: string, content: string): string => `<meta name="${escapeAttr(name)}" content="${escapeAttr(content)}">`;
const prop = (property: string, content: string): string => `<meta property="${escapeAttr(property)}" content="${escapeAttr(content)}">`;

/** Every head tag of a page as HTML text, one per line. */
export function headTags(page: HeadPage): string {
  const m = pageMeta(page);
  const url = absolute(page.base, page.path);
  const image = page.image ? absolute(page.base, page.image) : null;
  const tags = [`<title>${escapeText(m.title)}</title>`, meta('description', m.description)];
  if (url === null || page.noindex) tags.push(meta('robots', 'noindex'));
  if (url) tags.push(`<link rel="canonical" href="${escapeAttr(url)}">`);
  tags.push(prop('og:type', 'website'), prop('og:site_name', SITE_NAME), prop('og:title', m.title), prop('og:description', m.description));
  if (url) tags.push(prop('og:url', url));
  if (image) {
    tags.push(
      prop('og:image', image),
      prop('og:image:width', String(OG_WIDTH)),
      prop('og:image:height', String(OG_HEIGHT)),
      prop('og:image:alt', m.imageAlt),
    );
  }
  tags.push(meta('twitter:card', image ? 'summary_large_image' : 'summary'), meta('twitter:title', m.title), meta('twitter:description', m.description));
  if (image) tags.push(meta('twitter:image', image), meta('twitter:image:alt', m.imageAlt));
  tags.push(`<script type="application/ld+json">${scriptJson(jsonLd(page))}</script>`);
  return tags.join('\n    ');
}

/**
 * Marks the running page noindex, for a roadmap that came from a share link or a file: crawlers never read the
 * fragment, so such a page must not be indexed as the page it replaced.
 */
export function setNoindex(doc: Document = document): void {
  let tag = doc.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
  if (!tag) {
    tag = doc.createElement('meta');
    tag.name = 'robots';
    doc.head.append(tag);
  }
  tag.content = 'noindex';
}
