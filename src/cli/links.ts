/**
 * The link checker. It opens every resource address, follows up to five redirects, reads the start of the page
 * and sorts the answer into one of four outcomes:
 *
 * - kept: the page answered with a success status and nothing on it looks wrong.
 * - dead: 404, 410, a domain without DNS, a parked domain, or a page that says it was not found.
 * - gated: a login or a paywall (401, 402, a 403 with a login form, paywall wording, a redirect to a login page).
 * - unverified: it could not be judged (timeouts, 429, a 403 without evidence, server errors, bot checks).
 *
 * A success status only proves the address is reachable. Whether the page is the resource the entry names is for
 * the agent to read, so a resource becomes "verified" only when it already was, or when the caller says so.
 *
 * YouTube videos are checked through the oEmbed lookup, because the watch page answers 200 even for a video that
 * does not exist.
 */
import type { CheckStatus, Resource, ResourceCheck } from '../roadmap/types';
import type { FetchLike } from './io';

export type Outcome = 'kept' | 'dead' | 'gated' | 'unverified';

export const MAX_REDIRECTS = 5;
export const TIMEOUT_MS = 15_000;
export const CONCURRENCY = 4;
/** Bytes of a page read for its title and the heuristics. */
export const MAX_BODY_BYTES = 1_000_000;
/** A current desktop browser. It names no person and no tool. */
export const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface LinkResult {
  readonly resourceId: string;
  /** The address as written in the roadmap. */
  readonly url: string;
  /** The address that was actually fetched first (the oEmbed lookup for a YouTube video). */
  readonly fetched: string;
  /** Where the redirects ended, without tracking parameters. Null when nothing answered. */
  readonly finalUrl: string | null;
  readonly http: number | null;
  readonly title: string | null;
  readonly contentLength: number | null;
  readonly redirects: number;
  readonly outcome: Outcome;
  /** Short machine words, for example "not-found", "parked", "login", "timeout", "moved". */
  readonly flags: readonly string[];
  /** What happened, in one plain sentence. */
  readonly reason: string;
  readonly ms: number;
}

export interface CheckOptions {
  readonly fetch: FetchLike;
  readonly timeoutMs?: number;
  readonly concurrency?: number;
  readonly maxRedirects?: number;
  readonly userAgent?: string;
  /** Milliseconds for timing each check. Default `Date.now`. */
  readonly clock?: () => number;
  /** Called after each finished check, for progress output. */
  readonly onResult?: (result: LinkResult, done: number, total: number) => void;
}

// ---------------------------------------------------------------------------------------------------------------
// Addresses

const TRACKING = /^(utm_[a-z_]+|fbclid|gclid|dclid|gbraid|wbraid|msclkid|yclid|mc_cid|mc_eid|igshid|_hsenc|_hsmi|_ga|_gl|mkt_tok)$/i;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be']);

/** The address without tracking parameters (and without YouTube's share marker). Unparseable text is returned as is. */
export function stripTracking(address: string): string {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return address;
  }
  const youtube = YOUTUBE_HOSTS.has(url.hostname);
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING.test(key) || (youtube && (key === 'si' || key === 'feature'))) url.searchParams.delete(key);
  }
  return url.href;
}

/** True for a single YouTube video address (watch, youtu.be, shorts, live, embed). */
export function isYouTubeVideo(address: string): boolean {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return false;
  }
  if (!YOUTUBE_HOSTS.has(url.hostname)) return false;
  if (url.hostname.endsWith('youtu.be')) return /^\/[\w-]{6,}/.test(url.pathname);
  if (url.pathname === '/watch') return url.searchParams.has('v');
  return /^\/(shorts|live|embed)\/[\w-]{6,}/.test(url.pathname);
}

export function oembedUrl(address: string): string {
  return `https://www.youtube.com/oembed?url=${encodeURIComponent(stripTracking(address))}&format=json`;
}

// ---------------------------------------------------------------------------------------------------------------
// Reading pages

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', middot: '·', hellip: '…', laquo: '«', raquo: '»', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

function clean(text: string): string {
  return decodeEntities(text.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** The page's <title>, cleaned, or null. */
export function pageTitle(html: string): string | null {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  if (!match || match[1] === undefined) return null;
  const title = clean(match[1]);
  return title === '' ? null : title.slice(0, 300);
}

function firstHeading(html: string): string | null {
  const match = /<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i.exec(html);
  return match?.[1] === undefined ? null : clean(match[1]);
}

const NOT_FOUND = /(^|\W)(404|error 404|404 error|404 not found|page not found|not found|file not found|page (?:does not|doesn['’]t) exist|this page (?:does not|doesn['’]t|no longer) exists?|no longer available|could not be found|cannot be found|can['’]t be found|seite nicht gefunden|nicht gefunden|page introuvable|página no encontrada|pagina non trovata)(\W|$)/i;
const NOT_FOUND_STRONG = /^(?:error\s*)?404\b|^(?:page|file)?\s*not found\b|\bpage not found\b|\b404 not found\b|seite nicht gefunden|page introuvable|página no encontrada|^(?:this )?page (?:does not|doesn['’]t|no longer) exists?\b/i;
const PARKED = /(this domain|the domain|domain name)[^<]{0,80}?(is|may be) for sale|buy this domain|domain (?:is )?for sale|this domain is parked|parked (?:free|domain)|domain parking|sedoparking|parkingcrew|bodis\.com|hugedomains|afternic|dan\.com\/buy-domain/i;
const PARKING_HOSTS = /(^|\.)(sedo\.com|dan\.com|afternic\.com|hugedomains\.com|parkingcrew\.net|bodis\.com|undeveloped\.com|sav\.com|domainmarket\.com)$/i;
const PAYWALL = /(subscribe|subscription) (now )?to (continue|keep) reading|to continue reading,? (please )?(subscribe|sign in|log in)|this (article|content|story|post) is (only )?(available|reserved) (only )?(to|for) (paid )?(subscribers|members)|member-only story|members[- ]only (content|story|article|post)|become a (paid )?member to (read|continue|access)|you(['’]ve| have) reached your (free )?(article|story|monthly) limit|purchase (this course|to unlock|access to this)|unlock (this|the full) (course|article|lesson|story)|enrol(l)?(ment)? (is )?required to (view|access)|sign in to (continue|read|view|access) (this|the) (course|lesson|article|content)|log in to (continue|read|view|access) (this|the) (course|lesson|article|content)/i;
const LOGIN_FORM = /<input\b[^>]*\btype\s*=\s*["']?password\b/i;
const LOGIN_PATH = /(^|\/)(login|log-in|log_in|signin|sign-in|sign_in|sso|auth|oauth2?|authorize|session\/new|users\/sign_in|accounts?\/login)(\/|$)/i;
const LOGIN_HOST = /^(login|signin|accounts?|auth|sso|id)\./i;
const BOT_CHECK = /just a moment\.\.\.|attention required! \| cloudflare|cf-chl-|challenge-platform|verify (that )?you are (a )?human|are you a robot|captcha-delivery|px-captcha|enable javascript and cookies to continue/i;

export interface PageSigns {
  readonly title: string | null;
  readonly parked: boolean;
  readonly notFound: boolean;
  readonly paywall: boolean;
  readonly loginForm: boolean;
  readonly botCheck: boolean;
}

export function readSigns(html: string): PageSigns {
  const title = pageTitle(html);
  const heading = firstHeading(html);
  const head = html.slice(0, 200_000);
  const notFound =
    (title !== null && NOT_FOUND_STRONG.test(title)) ||
    (heading !== null && heading.length < 80 && NOT_FOUND.test(heading) && (title === null || NOT_FOUND.test(title)));
  return {
    title,
    parked: PARKED.test(head),
    notFound,
    paywall: PAYWALL.test(head),
    loginForm: LOGIN_FORM.test(head),
    botCheck: BOT_CHECK.test(head) || (title !== null && /^just a moment/i.test(title)),
  };
}

function isLoginAddress(address: string): boolean {
  try {
    const url = new URL(address);
    return LOGIN_HOST.test(url.hostname) || LOGIN_PATH.test(url.pathname);
  } catch {
    return false;
  }
}

function isParkingHost(address: string): boolean {
  try {
    return PARKING_HOSTS.test(new URL(address).hostname);
  } catch {
    return false;
  }
}

/** A deep link that ended on the site's front page, which usually means the page was removed. */
function landedOnHome(from: string, to: string): boolean {
  try {
    const a = new URL(from);
    const b = new URL(to);
    const deep = a.pathname.replace(/\/+$/, '').length > 0;
    const home = b.pathname === '/' || b.pathname === '' || /^\/[a-z]{2}(-[a-z]{2})?\/?$/i.test(b.pathname);
    return deep && home && b.search === '';
  } catch {
    return false;
  }
}

function sameAddress(a: string, b: string): boolean {
  const norm = (s: string): string => s.replace(/\/+$/, '').replace(/^http:/, 'https:');
  return norm(stripTracking(a)) === norm(stripTracking(b));
}

async function readBody(response: Response, limit: number): Promise<{ text: string; bytes: number; complete: boolean }> {
  if (!response.body) return { text: '', bytes: 0, complete: true };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let complete = true;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    bytes += value.length;
    if (bytes >= limit) {
      complete = false;
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  const all = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.length;
  }
  return { text: new TextDecoder('utf-8').decode(all), bytes, complete };
}

async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

function isTextual(contentType: string | null): boolean {
  if (contentType === null || contentType === '') return true;
  return /text\/|html|xml|json/i.test(contentType);
}

// ---------------------------------------------------------------------------------------------------------------
// Judging an answer

interface Verdict {
  readonly outcome: Outcome;
  readonly flags: string[];
  readonly reason: string;
}

function judgeError(error: unknown, timedOut: boolean): Verdict {
  const code = errorCode(error);
  const name = error instanceof Error || error instanceof DOMException ? error.name : '';
  if (timedOut || name === 'TimeoutError' || name === 'AbortError' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'ETIMEDOUT') {
    return { outcome: 'unverified', flags: ['timeout'], reason: 'No answer within the time limit.' };
  }
  if (code === 'ENOTFOUND') return { outcome: 'dead', flags: ['dns'], reason: 'The domain has no DNS record: it does not exist (any more).' };
  if (code === 'EAI_AGAIN') return { outcome: 'unverified', flags: ['dns-retry'], reason: 'The DNS lookup failed for now. Try again later.' };
  if (code !== null && /CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code)) {
    return { outcome: 'unverified', flags: ['tls'], reason: `The site's security certificate was refused (${code}).` };
  }
  if (code === 'ECONNREFUSED') return { outcome: 'unverified', flags: ['refused'], reason: 'The server refused the connection.' };
  const detail = code ?? (error instanceof Error ? error.message : String(error));
  return { outcome: 'unverified', flags: ['network'], reason: `The connection failed (${detail}).` };
}

function errorCode(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current !== null && typeof current === 'object'; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

function judgePage(status: number, requested: string, finalUrl: string, signs: PageSigns | null): Verdict {
  const flags: string[] = [];
  if (status === 404) return { outcome: 'dead', flags: ['not-found'], reason: 'The page is not there (HTTP 404).' };
  if (status === 410) return { outcome: 'dead', flags: ['gone'], reason: 'The page was removed (HTTP 410).' };
  if (signs?.botCheck) return { outcome: 'unverified', flags: ['bot-check'], reason: `A bot check stopped the automatic visit (HTTP ${status}).` };
  if (status === 401) return { outcome: 'gated', flags: ['login'], reason: 'It needs a login (HTTP 401).' };
  if (status === 402) return { outcome: 'gated', flags: ['paywall'], reason: 'It needs a payment (HTTP 402).' };
  if (status === 403) {
    if (signs?.loginForm) return { outcome: 'gated', flags: ['login'], reason: 'It answered with a login form (HTTP 403).' };
    if (signs?.paywall) return { outcome: 'gated', flags: ['paywall'], reason: 'It answered with a paywall (HTTP 403).' };
    return { outcome: 'unverified', flags: ['refused'], reason: 'The site refused the automatic visit (HTTP 403).' };
  }
  if (status === 429) return { outcome: 'unverified', flags: ['rate-limited'], reason: 'The site asked to slow down (HTTP 429).' };
  if (status >= 500) return { outcome: 'unverified', flags: ['server-error'], reason: `The server had an error (HTTP ${status}).` };
  if (status >= 400) return { outcome: 'unverified', flags: ['http-error'], reason: `The site answered with an error (HTTP ${status}).` };
  if (status < 200 || status >= 300) return { outcome: 'unverified', flags: ['odd-status'], reason: `The site answered with HTTP ${status} and no page.` };

  // A success status. Look for the ways a 200 can still be wrong.
  if (isParkingHost(finalUrl) || signs?.parked) return { outcome: 'dead', flags: ['parked'], reason: 'The domain is parked or for sale.' };
  if (signs?.notFound) return { outcome: 'dead', flags: ['soft-404'], reason: `The page says it was not found, although it answered ${status}.` };
  if (!sameAddress(requested, finalUrl) && isLoginAddress(finalUrl) && !isLoginAddress(requested)) {
    return { outcome: 'gated', flags: ['login'], reason: 'It redirected to a login page.' };
  }
  if (signs?.paywall) return { outcome: 'gated', flags: ['paywall'], reason: 'The page shows paywall or members-only wording.' };
  if (landedOnHome(requested, finalUrl) && !sameAddress(requested, finalUrl)) {
    return { outcome: 'unverified', flags: ['home-redirect'], reason: 'It redirected to the front page, which often means the page was removed.' };
  }
  if (!sameAddress(requested, finalUrl)) flags.push('moved');
  if (signs?.loginForm) flags.push('login-form');
  return { outcome: 'kept', flags, reason: `It answered ${status}.` };
}

function judgeOembed(status: number): Verdict {
  if (status === 200) return { outcome: 'kept', flags: ['youtube'], reason: 'YouTube knows the video (oEmbed 200).' };
  if (status === 404) return { outcome: 'dead', flags: ['youtube', 'not-found'], reason: 'YouTube does not know this video (oEmbed 404).' };
  if (status === 400) return { outcome: 'dead', flags: ['youtube', 'bad-address'], reason: 'YouTube does not read this as a video address (oEmbed 400).' };
  if (status === 401 || status === 403) {
    return { outcome: 'unverified', flags: ['youtube', 'private'], reason: `YouTube would not describe the video: it may be private or not embeddable (oEmbed ${status}).` };
  }
  if (status === 429) return { outcome: 'unverified', flags: ['youtube', 'rate-limited'], reason: 'YouTube asked to slow down (HTTP 429).' };
  return { outcome: 'unverified', flags: ['youtube', 'http-error'], reason: `The YouTube lookup answered HTTP ${status}.` };
}

// ---------------------------------------------------------------------------------------------------------------
// Checking

/** Opens one address and judges it. Never throws. */
export async function checkUrl(resourceId: string, url: string, options: CheckOptions): Promise<LinkResult> {
  const clock = options.clock ?? Date.now;
  const started = clock();
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  const youtube = isYouTubeVideo(url);
  const fetched = youtube ? oembedUrl(url) : url;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException('The check took too long.', 'TimeoutError'));
  }, timeoutMs);
  const headers = {
    'user-agent': options.userAgent ?? USER_AGENT,
    accept: youtube ? 'application/json' : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'en;q=0.9,*;q=0.5',
  };

  let current = fetched;
  let redirects = 0;
  let http: number | null = null;
  const finish = (verdict: Verdict, extra: Partial<Pick<LinkResult, 'title' | 'contentLength' | 'finalUrl'>> = {}): LinkResult => ({
    resourceId,
    url,
    fetched,
    finalUrl: extra.finalUrl === undefined ? (http === null ? null : stripTracking(youtube ? url : current)) : extra.finalUrl,
    http,
    title: extra.title ?? null,
    contentLength: extra.contentLength ?? null,
    redirects,
    outcome: verdict.outcome,
    flags: verdict.flags,
    reason: verdict.reason,
    ms: Math.max(0, Math.round(clock() - started)),
  });

  try {
    for (;;) {
      const response = await options.fetch(current, { method: 'GET', redirect: 'manual', headers, signal: controller.signal });
      http = response.status;
      const location = response.headers.get('location');
      if (http >= 300 && http < 400 && location !== null) {
        await discard(response);
        if (redirects >= maxRedirects) {
          return finish({ outcome: 'unverified', flags: ['too-many-redirects'], reason: `It redirected more than ${maxRedirects} times.` });
        }
        current = new URL(location, current).href;
        redirects += 1;
        continue;
      }
      const lengthHeader = response.headers.get('content-length');
      const declared = lengthHeader !== null && /^\d+$/.test(lengthHeader) ? Number(lengthHeader) : null;
      if (youtube) {
        const body = await readBody(response, 64_000);
        let title: string | null = null;
        if (http === 200) {
          try {
            const meta = JSON.parse(body.text) as { title?: unknown };
            title = typeof meta.title === 'string' ? meta.title : null;
          } catch {
            title = null;
          }
        }
        return finish(judgeOembed(http), { title, contentLength: declared ?? (body.complete ? body.bytes : null), finalUrl: stripTracking(url) });
      }
      if (!isTextual(response.headers.get('content-type'))) {
        await discard(response);
        return finish(judgePage(http, url, current, null), { contentLength: declared });
      }
      const body = await readBody(response, MAX_BODY_BYTES);
      const signs = readSigns(body.text);
      return finish(judgePage(http, url, current, signs), { title: signs.title, contentLength: declared ?? (body.complete ? body.bytes : null) });
    }
  } catch (error) {
    // Nothing usable came back, even when a status line arrived before the failure.
    http = null;
    return finish(judgeError(error, timedOut), { finalUrl: null });
  } finally {
    clearTimeout(timer);
  }
}

/** Runs `work` over `items` with at most `limit` at once, keeping the order of the results. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await work(items[index] as T, index);
    }
  });
  await Promise.all(lanes);
  return results;
}

/** Checks every resource. Two resources with the same address share one fetch. */
export async function checkResources(resources: readonly Pick<Resource, 'id' | 'url'>[], options: CheckOptions): Promise<LinkResult[]> {
  const unique = [...new Set(resources.map((r) => r.url))];
  let done = 0;
  const byUrl = new Map<string, LinkResult>();
  await mapLimit(unique, options.concurrency ?? CONCURRENCY, async (url) => {
    const owner = resources.find((r) => r.url === url);
    const result = await checkUrl(owner?.id ?? '', url, options);
    byUrl.set(url, result);
    for (const r of resources) {
      if (r.url === url) {
        done += 1;
        options.onResult?.({ ...result, resourceId: r.id }, done, resources.length);
      }
    }
  });
  return resources.map((r) => ({ ...(byUrl.get(r.url) as LinkResult), resourceId: r.id }));
}

// ---------------------------------------------------------------------------------------------------------------
// What gets written

export interface Totals {
  readonly opened: number;
  readonly kept: number;
  readonly dead: number;
  readonly flagged: number;
}

export function totalsOf(results: readonly LinkResult[]): Totals {
  const count = (o: Outcome): number => results.filter((r) => r.outcome === o).length;
  return { opened: results.length, kept: count('kept'), dead: count('dead'), flagged: count('gated') + count('unverified') };
}

export function formatTotals(totals: Totals): string {
  return `${totals.opened} opened, ${totals.kept} kept, ${totals.dead} dead, ${totals.flagged} flagged`;
}

/** The note written for a 200 that was not read: the tool never claims what it did not read. */
export const REACHABLE_NOTE = 'reachable, read it before marking verified';

/**
 * The `check` a result leads to. A success keeps "verified" only when the resource was verified before, or when
 * `trust200` is set; otherwise the resource stays as it was with a note that it is reachable but unread.
 * Dead links are written as unverified with the reason, so nothing is deleted and the agent decides.
 */
export function nextCheck(previous: ResourceCheck | undefined, result: LinkResult, today: string, trust200: boolean): ResourceCheck {
  const http = result.http;
  const before: CheckStatus | undefined = previous?.status;
  switch (result.outcome) {
    case 'kept': {
      if (before === 'verified' || trust200) {
        const keepNote = before === 'verified' && previous?.note !== undefined;
        return keepNote ? { status: 'verified', on: today, http, note: previous?.note as string } : { status: 'verified', on: today, http };
      }
      if (before === 'gated' && previous?.note !== undefined) return { status: 'gated', on: today, http, note: previous.note };
      return {
        status: 'unverified',
        on: today,
        http,
        note: `Reachable on ${today} (HTTP ${http ?? 'none'}), but not read yet. Read it before marking it verified.`,
      };
    }
    case 'dead':
      return { status: 'unverified', on: today, http, note: `Dead on ${today}: ${result.reason} Replace or remove this resource.` };
    case 'gated':
      if (before === 'gated' && previous?.note !== undefined) return { status: 'gated', on: today, http, note: previous.note };
      return { status: 'gated', on: today, http, note: `Behind a login or paywall when opened on ${today}: ${result.reason}` };
    case 'unverified': {
      const why = http === null ? result.reason.replace(/\.$/, '').toLowerCase() : `HTTP ${http}`;
      return { status: 'unverified', on: today, http, note: `Could not be opened on ${today} (${why}). Open it yourself before relying on it.` };
    }
  }
}

/** What the table says about a kept link the tool may not mark verified. */
export function keptDetail(result: LinkResult, previous: CheckStatus | undefined, trust200: boolean): string {
  // The advice comes first, so a long title cannot push it out of the table.
  const parts: string[] = [];
  if (previous !== 'verified' && !trust200) parts.push(previous === 'gated' ? 'reachable, still gated' : REACHABLE_NOTE);
  if (result.flags.includes('moved') && result.finalUrl !== null) parts.push(`moved to ${result.finalUrl}`);
  if (result.title !== null) parts.push(result.title);
  return parts.join(' · ');
}
