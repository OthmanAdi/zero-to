// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  checkResources,
  checkUrl,
  formatTotals,
  isYouTubeVideo,
  mapLimit,
  nextCheck,
  oembedUrl,
  pageTitle,
  readSigns,
  stripTracking,
  totalsOf,
  USER_AGENT,
  type CheckOptions,
  type LinkResult,
} from './links';
import { dnsError, fakeFetch, htmlPage, type FakeRoute } from './test-helpers';

const A = 'https://docs.example.org/guide/ch04.html';

function options(routes: Record<string, FakeRoute>, extra: Partial<CheckOptions> = {}): CheckOptions {
  return { fetch: fakeFetch(routes), ...extra };
}

async function check(routes: Record<string, FakeRoute>, url = A, extra: Partial<CheckOptions> = {}): Promise<LinkResult> {
  return checkUrl('res', url, options(routes, extra));
}

describe('addresses', () => {
  it('strips tracking parameters and keeps the rest', () => {
    expect(stripTracking('https://a.example/p?id=3&utm_source=x&utm_medium=y&fbclid=1#top')).toBe('https://a.example/p?id=3#top');
    expect(stripTracking('https://youtu.be/dQw4w9WgXcQ?si=abc')).toBe('https://youtu.be/dQw4w9WgXcQ');
    expect(stripTracking('not a url')).toBe('not a url');
  });

  it('recognises YouTube video addresses and builds the oEmbed lookup', () => {
    expect(isYouTubeVideo('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
    expect(isYouTubeVideo('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
    expect(isYouTubeVideo('https://www.youtube.com/shorts/abcdefghijk')).toBe(true);
    expect(isYouTubeVideo('https://www.youtube.com/@somechannel')).toBe(false);
    expect(isYouTubeVideo('https://vimeo.com/123456')).toBe(false);
    expect(oembedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=x')).toBe(
      'https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ&format=json',
    );
  });
});

describe('reading a page', () => {
  it('takes the title and decodes entities', () => {
    expect(pageTitle('<html><head><title>\n  Ownership &amp; borrowing &#8211; The Book </title></head></html>')).toBe('Ownership & borrowing – The Book');
    expect(pageTitle('<p>no title</p>')).toBeNull();
  });

  it('spots parked domains, not-found pages, paywalls, login forms and bot checks', () => {
    expect(readSigns(htmlPage('example.dev', '<p>This domain is for sale! Buy this domain today.</p>')).parked).toBe(true);
    expect(readSigns(htmlPage('Page not found')).notFound).toBe(true);
    expect(readSigns(htmlPage('404 | Example Docs')).notFound).toBe(true);
    expect(readSigns(htmlPage('Handling errors in Rust')).notFound).toBe(false);
    expect(readSigns(htmlPage('A story', '<p>Member-only story</p>')).paywall).toBe(true);
    expect(readSigns(htmlPage('Sign in', '<form><input type="password" name="p"></form>')).loginForm).toBe(true);
    expect(readSigns(htmlPage('Just a moment...')).botCheck).toBe(true);
  });
});

describe('checkUrl', () => {
  it('keeps a 200 page and records title, length and the final address', async () => {
    const body = htmlPage('What is ownership?');
    const result = await check({ [A]: { body } });
    expect(result.outcome).toBe('kept');
    expect(result.http).toBe(200);
    expect(result.title).toBe('What is ownership?');
    expect(result.contentLength).toBe(new TextEncoder().encode(body).length);
    expect(result.finalUrl).toBe(A);
    expect(result.redirects).toBe(0);
    expect(result.flags).toEqual([]);
  });

  it('sends a browser User-Agent that names no person', async () => {
    let seen: Headers | null = null;
    await checkUrl('res', A, {
      fetch: async (_url, init) => {
        seen = new Headers(init.headers);
        return new Response(htmlPage('Ok'), { status: 200, headers: { 'content-type': 'text/html' } });
      },
    });
    expect(seen).not.toBeNull();
    expect((seen as unknown as Headers).get('user-agent')).toBe(USER_AGENT);
    expect(USER_AGENT).toMatch(/^Mozilla\/5\.0 /);
    expect(USER_AGENT).not.toMatch(/@|zero-to|bot/i);
  });

  it('follows redirects, strips tracking from the end address and flags the move', async () => {
    const result = await check({
      [A]: { status: 301, headers: { location: '/guide/v2/ch04.html?utm_source=old' } },
      'https://docs.example.org/guide/v2/ch04.html?utm_source=old': { status: 302, headers: { location: 'https://docs.example.org/guide/v2/ownership.html' } },
      'https://docs.example.org/guide/v2/ownership.html': { body: htmlPage('Ownership') },
    });
    expect(result.outcome).toBe('kept');
    expect(result.redirects).toBe(2);
    expect(result.finalUrl).toBe('https://docs.example.org/guide/v2/ownership.html');
    expect(result.flags).toContain('moved');
  });

  it('stops after five redirects', async () => {
    const routes: Record<string, FakeRoute> = {};
    for (let i = 0; i < 7; i += 1) routes[`https://loop.example/${i}`] = { status: 302, headers: { location: `/${i + 1}` } };
    const result = await check(routes, 'https://loop.example/0');
    expect(result.outcome).toBe('unverified');
    expect(result.flags).toEqual(['too-many-redirects']);
    expect(result.redirects).toBe(5);
  });

  it('calls 404, 410 and a missing domain dead', async () => {
    expect((await check({ [A]: { status: 404 } })).outcome).toBe('dead');
    const gone = await check({ [A]: { status: 410 } });
    expect(gone.outcome).toBe('dead');
    expect(gone.flags).toEqual(['gone']);
    const dns = await check({ [A]: { error: dnsError('ENOTFOUND') } });
    expect(dns.outcome).toBe('dead');
    expect(dns.flags).toEqual(['dns']);
    expect(dns.http).toBeNull();
    expect(dns.finalUrl).toBeNull();
  });

  it('calls parked domains and not-found pages served with 200 dead', async () => {
    const parked = await check({ [A]: { body: htmlPage('docs.example.org', '<p>The domain docs.example.org may be for sale.</p>') } });
    expect(parked.outcome).toBe('dead');
    expect(parked.flags).toEqual(['parked']);
    const soft = await check({ [A]: { body: htmlPage('Page not found') } });
    expect(soft.outcome).toBe('dead');
    expect(soft.flags).toEqual(['soft-404']);
    const sold = await check({ [A]: { status: 301, headers: { location: 'https://www.hugedomains.com/domain_profile.cfm?d=example' } }, 'https://www.hugedomains.com/domain_profile.cfm?d=example': { body: htmlPage('Buy it') } });
    expect(sold.outcome).toBe('dead');
  });

  it('calls logins and paywalls gated', async () => {
    expect((await check({ [A]: { status: 401 } })).outcome).toBe('gated');
    expect((await check({ [A]: { status: 402 } })).outcome).toBe('gated');
    const form = await check({ [A]: { status: 403, body: htmlPage('Sign in', '<input type="password">') } });
    expect(form.outcome).toBe('gated');
    expect(form.flags).toEqual(['login']);
    const wall = await check({ [A]: { body: htmlPage('Lesson 4', '<p>Subscribe to continue reading.</p>') } });
    expect(wall.outcome).toBe('gated');
    expect(wall.flags).toEqual(['paywall']);
    const redirect = await check({
      [A]: { status: 302, headers: { location: 'https://accounts.example.org/login?next=/guide' } },
      'https://accounts.example.org/login?next=/guide': { body: htmlPage('Log in') },
    });
    expect(redirect.outcome).toBe('gated');
  });

  it('leaves timeouts, 429, a bare 403, server errors and bot checks unverified', async () => {
    const slow = await check({ [A]: { hang: true } }, A, { timeoutMs: 20 });
    expect(slow.outcome).toBe('unverified');
    expect(slow.flags).toEqual(['timeout']);
    expect(slow.http).toBeNull();
    expect((await check({ [A]: { status: 429 } })).flags).toEqual(['rate-limited']);
    const refused = await check({ [A]: { status: 403, body: htmlPage('Forbidden') } });
    expect(refused.outcome).toBe('unverified');
    expect(refused.flags).toEqual(['refused']);
    expect((await check({ [A]: { status: 503 } })).flags).toEqual(['server-error']);
    expect((await check({ [A]: { status: 403, body: htmlPage('Just a moment...') } })).flags).toEqual(['bot-check']);
    expect((await check({ [A]: { error: dnsError('EAI_AGAIN') } })).outcome).toBe('unverified');
  });

  it('flags a deep link that lands on the front page', async () => {
    const result = await check({
      [A]: { status: 301, headers: { location: 'https://docs.example.org/' } },
      'https://docs.example.org/': { body: htmlPage('Example Docs') },
    });
    expect(result.outcome).toBe('unverified');
    expect(result.flags).toEqual(['home-redirect']);
  });

  it('does not read a PDF body but still keeps it', async () => {
    const result = await check({ [A]: { body: '%PDF-1.7', headers: { 'content-type': 'application/pdf', 'content-length': '123456' } } });
    expect(result.outcome).toBe('kept');
    expect(result.contentLength).toBe(123456);
    expect(result.title).toBeNull();
  });

  it('checks YouTube videos through oEmbed, not the watch page', async () => {
    const watch = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    const real = await check({ [oembedUrl(watch)]: { body: JSON.stringify({ title: 'A real video', author_name: 'Someone' }), headers: { 'content-type': 'application/json' } } }, watch);
    expect(real.outcome).toBe('kept');
    expect(real.title).toBe('A real video');
    expect(real.fetched).toBe(oembedUrl(watch));
    expect(real.finalUrl).toBe(watch);
    const missing = 'https://youtu.be/zzzzzzzzzzz';
    const dead = await check({ [missing]: { body: htmlPage('YouTube') }, [oembedUrl(missing)]: { status: 404, body: 'Not Found' } }, missing);
    expect(dead.outcome).toBe('dead');
    expect(dead.flags).toContain('not-found');
  });
});

describe('checkResources', () => {
  it('runs at most four checks at once and keeps the order', async () => {
    let active = 0;
    let peak = 0;
    const fetch = async (url: string): Promise<Response> => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return new Response(htmlPage(url), { status: 200, headers: { 'content-type': 'text/html' } });
    };
    const resources = Array.from({ length: 11 }, (_, i) => ({ id: `r${i}`, url: `https://site.example/${i}` }));
    const results = await checkResources(resources, { fetch });
    expect(peak).toBe(4);
    expect(results.map((r) => r.resourceId)).toEqual(resources.map((r) => r.id));
    expect(results.every((r) => r.outcome === 'kept')).toBe(true);
  });

  it('fetches a shared address once and reports it for each resource', async () => {
    const seen: string[] = [];
    const fetch = async (url: string): Promise<Response> => {
      seen.push(url);
      return new Response(htmlPage('Shared'), { status: 200, headers: { 'content-type': 'text/html' } });
    };
    const results = await checkResources([{ id: 'a', url: A }, { id: 'b', url: A }], { fetch });
    expect(seen).toEqual([A]);
    expect(results.map((r) => r.resourceId)).toEqual(['a', 'b']);
  });

  it('mapLimit handles an empty list', async () => {
    expect(await mapLimit([], 4, async () => 1)).toEqual([]);
  });

  it('totals add up and read as the receipt line', async () => {
    const results = await checkResources(
      [
        { id: 'ok', url: 'https://a.example/ok' },
        { id: 'gone', url: 'https://a.example/gone' },
        { id: 'login', url: 'https://a.example/login-only' },
        { id: 'slow', url: 'https://a.example/429' },
      ],
      options({
        'https://a.example/ok': { body: htmlPage('Fine') },
        'https://a.example/gone': { status: 404 },
        'https://a.example/login-only': { status: 401 },
        'https://a.example/429': { status: 429 },
      }),
    );
    const totals = totalsOf(results);
    expect(totals).toEqual({ opened: 4, kept: 1, dead: 1, flagged: 2 });
    expect(formatTotals(totals)).toBe('4 opened, 1 kept, 1 dead, 2 flagged');
  });
});

describe('nextCheck', () => {
  const kept = { outcome: 'kept', http: 200, reason: 'It answered 200.', flags: [] } as unknown as LinkResult;
  const today = '2026-11-13';

  it('keeps verified only when it was verified before', () => {
    expect(nextCheck({ status: 'verified', on: '2026-10-01', http: 200 }, kept, today, false)).toEqual({ status: 'verified', on: today, http: 200 });
    const unread = nextCheck({ status: 'unverified', on: '2026-10-01', http: 403, note: 'Could not be opened.' }, kept, today, false);
    expect(unread.status).toBe('unverified');
    expect(unread.note).toMatch(/not read yet/);
    expect(nextCheck(undefined, kept, today, false).status).toBe('unverified');
  });

  it('marks a 200 verified with trust200 and drops the old failure note', () => {
    expect(nextCheck({ status: 'unverified', on: '2026-10-01', http: 403, note: 'Could not be opened.' }, kept, today, true)).toEqual({ status: 'verified', on: today, http: 200 });
  });

  it('keeps a gated note when the landing page still answers', () => {
    const before = { status: 'gated', on: '2026-10-01', http: 200, note: 'Lessons need an account.' } as const;
    expect(nextCheck(before, kept, today, false)).toEqual({ ...before, on: today });
  });

  it('writes dead and unreachable links as unverified with the reason, never deleting them', () => {
    const dead = { outcome: 'dead', http: 404, reason: 'The page is not there (HTTP 404).', flags: ['not-found'] } as unknown as LinkResult;
    const after = nextCheck({ status: 'verified', on: '2026-10-01', http: 200 }, dead, today, true);
    expect(after.status).toBe('unverified');
    expect(after.note).toMatch(/^Dead on 2026-11-13: The page is not there/);
    const slow = { outcome: 'unverified', http: null, reason: 'No answer within the time limit.', flags: ['timeout'] } as unknown as LinkResult;
    expect(nextCheck(undefined, slow, today, false).note).toBe('Could not be opened on 2026-11-13 (no answer within the time limit). Open it yourself before relying on it.');
    const refused = { outcome: 'unverified', http: 403, reason: 'Refused.', flags: ['refused'] } as unknown as LinkResult;
    expect(nextCheck(undefined, refused, today, false).note).toBe('Could not be opened on 2026-11-13 (HTTP 403). Open it yourself before relying on it.');
  });
});
