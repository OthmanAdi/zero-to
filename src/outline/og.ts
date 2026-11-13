/**
 * The 1200 by 630 social image of a page, as a small HTML document that the build opens in a headless browser
 * and photographs. It uses the site's own faces (passed in as @font-face rules) and colours: the night room, a
 * paper sheet with the route's profile, the brand mark and the roadmap's facts.
 */
import { uiLang, type UiLang } from '../i18n';
import { day as formatDay } from '../learn/format';
import { brandMark, WORDMARK_DASH } from '../look/brand';
import { THEME } from '../look/theme';
import { deriveTrek } from '../roadmap/derive';
import { emptyProgress } from '../roadmap/progress';
import type { Roadmap } from '../roadmap/types';
import { hereAlong } from './marks';
import { factsLine, tierName } from './outline';
import { profileTree } from './profile';
import { OG_HEIGHT, OG_WIDTH } from './head';
import { say } from './strings';
import { el, escapeAttr, road, toHtml, type ONode } from './tree';

export type OgInput =
  | { readonly kind: 'roadmap'; readonly roadmap: Roadmap; readonly ui?: UiLang }
  | { readonly kind: 'site'; readonly samples: readonly Roadmap[]; readonly ui?: UiLang };

const d = WORDMARK_DASH;

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${OG_WIDTH}px;height:${OG_HEIGHT}px;overflow:hidden}
body{position:relative;background:radial-gradient(ellipse 70% 90% at 18% 0%,rgba(255,217,160,.17),rgba(255,217,160,0) 62%),radial-gradient(ellipse 60% 70% at 85% 100%,rgba(185,201,255,.07),rgba(0,0,0,0) 70%),${THEME.night};color:${THEME.text};font-family:'Atkinson Hyperlegible Next','Segoe UI',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.brand{position:absolute;left:64px;top:52px;display:flex;align-items:center;gap:14px}
.word{font-family:'Fraunces',Georgia,serif;font-weight:600;font-size:30px;letter-spacing:-.02em;font-variation-settings:'SOFT' 60,'WONK' 0;color:${THEME.text}}
.dash{display:inline-block;width:${d.length * 2 + d.gap}em;height:${d.thickness}em;margin:0 ${d.side}em;vertical-align:${d.rise}em;border-radius:${d.thickness / 3}em;background:linear-gradient(90deg,${THEME.signal} ${d.length}em,transparent ${d.length}em,transparent ${d.length + d.gap}em,${THEME.signal} ${d.length + d.gap}em)}
.copy{position:absolute;left:64px;top:150px;width:600px}
.kicker{font-family:'IBM Plex Mono',ui-monospace,monospace;font-weight:500;font-size:15px;letter-spacing:.14em;text-transform:uppercase;color:${THEME.textSoft};margin-bottom:22px}
.title{font-family:'Fraunces',Georgia,serif;font-weight:500;font-size:64px;line-height:1.02;letter-spacing:-.02em;font-variation-settings:'opsz' 144,'SOFT' 40,'WONK' 0;color:${THEME.paperHi};display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;text-wrap:balance}
.title em{font-style:italic;font-weight:400;color:${THEME.signal}}
.summary{margin-top:22px;font-size:23px;line-height:1.42;color:${THEME.textSoft};display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.foot{position:absolute;left:64px;bottom:50px;font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:15px;letter-spacing:.06em;color:${THEME.textFaint}}
.foot b{display:inline-block;width:9px;height:9px;border-radius:50%;background:${THEME.signal};margin-right:10px;vertical-align:1px}
.sheet{position:absolute;right:60px;top:70px;width:440px;padding:26px 26px 24px;background:${THEME.paper};color:${THEME.ink};border-radius:3px;transform:rotate(-2.2deg);box-shadow:0 1px 0 rgba(255,255,255,.6) inset,0 2px 6px rgba(0,0,0,.35),0 34px 50px -24px rgba(0,0,0,.85);background-image:radial-gradient(130% 70% at 28% 0%,rgba(255,255,255,.55),rgba(255,255,255,0) 62%),repeating-linear-gradient(176deg,rgba(31,42,61,.02) 0 1px,transparent 1px 5px)}
.sheet.back{top:96px;right:84px;transform:rotate(3.4deg);background:${THEME.card};opacity:.9}
.tape{position:absolute;top:-11px;left:50%;width:84px;height:22px;margin-left:-42px;transform:rotate(-3deg);background:${THEME.tape}}
.sheet-k{font-family:'IBM Plex Mono',ui-monospace,monospace;font-weight:500;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:${THEME.inkSoft}}
.sheet svg{display:block;width:100%;height:auto;margin:10px 0 12px}
.sheet svg text{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:15px}
.sheet svg .zo-p-label{display:none}
.legend{list-style:none;display:grid;gap:5px;font-size:15px;line-height:1.25}
.legend li{display:flex;gap:10px;align-items:baseline}
.legend .n{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:12.5px;color:${THEME.inkSoft};min-width:18px}
.legend .t{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.legend .tier{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:11.5px;letter-spacing:.06em;color:${THEME.inkSoft}}
.cards{position:absolute;right:56px;top:96px;width:470px;height:440px}
.card{position:absolute;width:360px;padding:22px 24px;background:${THEME.paper};color:${THEME.ink};border-radius:3px;box-shadow:0 2px 6px rgba(0,0,0,.35),0 34px 50px -24px rgba(0,0,0,.85)}
.card h2{font-family:'Fraunces',Georgia,serif;font-weight:500;font-size:27px;line-height:1.08;letter-spacing:-.01em;margin:8px 0 10px}
.card svg{display:block;width:100%;height:auto}
.card svg text{display:none}
`;

function wordmark(): string {
  return `<span class="word">zero<span class="dash"></span>to</span>`;
}

function legend(roadmap: Roadmap, ui: UiLang): ONode {
  const max = 8;
  return el(
    'ol',
    { class: 'legend' },
    roadmap.stages.slice(0, max).map((s, i) =>
      el('li', null, el('span', { class: 'n' }, String(i + 1).padStart(2, '0')), road('span', s.title, roadmap.lang, { class: 't' }), el('span', { class: 'tier' }, tierName(s.tier, ui))),
    ),
  );
}

function roadmapBody(roadmap: Roadmap, ui: UiLang): string {
  const trek = deriveTrek(roadmap);
  const here = hereAlong(trek, roadmap, emptyProgress(roadmap.id));
  const profile = toHtml(profileTree(trek, { here }, { ui, height: 250 }));
  const copy = el(
    'div',
    { class: 'copy' },
    el('p', { class: 'kicker' }, `${say('kicker', undefined, ui)} · ${factsLine(roadmap, trek, ui)}`),
    road('h1', roadmap.title, roadmap.lang, { class: 'title' }),
    roadmap.summary ? road('p', roadmap.summary, roadmap.lang, { class: 'summary' }) : null,
  );
  const foot = el('p', { class: 'foot' }, el('b'), say('checkedOn', { day: formatDay(roadmap.checkedOn, { lang: ui }) }, ui), ` · ${say('sources', { count: roadmap.resources.length }, ui)}`);
  return (
    toHtml(copy) +
    `<div class="sheet back"></div><div class="sheet"><span class="tape"></span>` +
    toHtml(el('p', { class: 'sheet-k' }, say('profileTitle', undefined, ui))) +
    profile +
    toHtml(legend(roadmap, ui)) +
    `</div>` +
    toHtml(foot)
  );
}

function siteBody(samples: readonly Roadmap[], ui: UiLang): string {
  const headline = say('siteHeadline', undefined, ui);
  // The last word of the headline is the goal and takes the route's colour, as on the site.
  const match = /^(.*\s)(\S+?)([.!]?)$/.exec(headline);
  const title = match
    ? el('h1', { class: 'title' }, match[1] ?? '', el('em', null, match[2] ?? ''), match[3] ?? '')
    : el('h1', { class: 'title' }, headline);
  const copy = el('div', { class: 'copy' }, el('p', { class: 'kicker' }, say('galleryTitle', undefined, ui)), title);
  const picks = samples.slice(0, 3);
  const poses = [
    { right: 96, top: 6, rot: -5.5 },
    { right: 40, top: 128, rot: 3 },
    { right: 118, top: 236, rot: -1.5 },
  ];
  const cards = picks.map((r, i) => {
    const trek = deriveTrek(r);
    const pose = poses[i] ?? { right: 0, top: 0, rot: 0 };
    return toHtml(
      el(
        'div',
        { class: 'card', style: `right:${pose.right}px;top:${pose.top}px;transform:rotate(${pose.rot}deg)` },
        el('p', { class: 'sheet-k' }, factsLine(r, trek, ui)),
        road('h2', r.title, r.lang),
        profileTree(trek, { here: 0 }, { ui, height: 170 }),
      ),
    );
  });
  const foot = el('p', { class: 'foot' }, el('b'), say('siteTitle', undefined, ui));
  return `${toHtml(copy)}<div class="cards">${cards.join('')}</div>${toHtml(foot)}`;
}

/** The social image page. `fontCss` carries the site's @font-face rules (data URLs), so nothing is fetched. */
export function ogCardHtml(input: OgInput, fontCss = ''): string {
  const ui = input.ui ?? uiLang();
  const lang = input.kind === 'roadmap' ? input.roadmap.lang : ui;
  const body = input.kind === 'roadmap' ? roadmapBody(input.roadmap, ui) : siteBody(input.samples, ui);
  return `<!doctype html><html lang="${escapeAttr(lang)}"><head><meta charset="utf-8"><style>${fontCss}${CSS}</style></head><body><div class="brand">${brandMark(46, { ink: THEME.text })}${wordmark()}</div>${body}</body></html>`;
}
