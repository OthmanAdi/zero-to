# Research and checking sources

The roadmap's promise is that every link was opened and read by the agent that wrote it, on the date it says. This file is how to keep that promise.

## Contents

- [Finding candidates](#finding-candidates)
- [What counts as verified](#what-counts-as-verified)
- [Statuses](#statuses)
- [Dates](#dates)
- [Ranking](#ranking)
- [Keeping spam out](#keeping-spam-out)
- [How many](#how-many)
- [Commands](#commands)
- [The receipt](#the-receipt)

## Finding candidates

Search in every language in `brief.resourceLangs`. Look in this order:

1. The primary source: official documentation, the standards body, the author's or publisher's own page, a university's open course.
2. Established teaching platforms with a clear author.
3. Single articles and videos, only for a gap the first two leave.

Curated lists and forum threads are a source of candidates, never evidence that a link works. Collect five to eight candidates per waypoint and keep one to three.

## What counts as verified

All five, in the current run:

1. You fetched the URL now; you did not recall it. After at most five redirects it answered 200. Write the final URL, without tracking parameters.
2. You read the page. Its title and body are the resource the entry names. A parked domain, a "not found" page served with 200, a consent wall or a "course retired" notice fails here.
3. The `why` line is supported by what you read. "Chapter 4 covers ownership" needs chapter 4 to have been opened.
4. Cost and language were seen on the page. A price carries `seenOn`. A paid item with no visible price gets `cost: "paid"` and no `price`.
5. A video is checked through the platform's embed lookup, not the watch page. For YouTube: `https://www.youtube.com/oembed?url=<watch url>&format=json`. A video id that does not exist still returns 200 on the watch page, but 404 there.

Some fetch tools return a summary of a long page instead of its text. When you read only part of a page, or only such a summary, write that into `check.note` ("Read the first half; the rest as a summary"), and let the `why` line claim only what you saw in the text itself.

## Statuses

| `check.status` | When | What the learner sees |
|---|---|---|
| `verified` | All five points hold | The volume, with "opened on `<date>`" |
| `gated` | Reachable, but the content is behind a login or paywall. Title and outline were read, the lessons were not | The volume, with that sentence from `check.note` |
| `unverified` | Could not be opened by an automated client: 403, 429, a timeout, a page that needs a browser | The volume, with "Could not be opened on `<date>` (HTTP 403). Open it yourself before relying on it." |

A dead link (404, 410, no DNS, a parked domain) is never written into the roadmap; it goes into the receipt with the reason. A waypoint may not rest on unverified sources alone. If nothing for a step can be verified, keep the step and its task and write a `gap` line: "No source could be verified for this step. Search terms that should find one: ...".

## Dates

Keep three dates apart:

- `check.on`: the day you opened it.
- `updated`: the date the source prints about itself, copied as printed, or nothing. Never guess it.
- `price.seenOn`: the day you saw the price.

`freshness` says how age counts: for a `fast` topic a source older than about 18 months loses rank unless it is the primary source; for `slow` topics age does not count. The site suggests a recheck after 30 days for fast topics and 90 for the rest.

## Ranking

In this order: verified before gated before unverified; a deep link to the exact chapter before a home page; primary source before commentary; preferred language; inside the budget, and free first on a tie; something to do before something to watch; currency against `freshness`; fit to the learning style. Last, a spread rule: apart from official documentation, no single site supplies more than about 40 percent of the sources. Star counts, view counts and ratings are not used, because you cannot check what they mean.

## Keeping spam out

Resolve link shorteners. Drop affiliate landing pages, "best ten courses" lists, coupon and aggregator sites, pages with no author and no date, and unlicensed copies of commercial books. A paid source stands alone on a step only when no free one exists, and the entry says so.

## How many

Per waypoint, one main source and up to two alternatives. Per stage, three to seven volumes on the shelf. Per roadmap normally 20 to 40, never more than 45. Every source costs a fetch and a read.

## Commands

The tool fetches; you read.

```bash
# fetch every link, report dead and flagged ones, write the receipt
node scripts/zero-to.mjs check-links roadmap.json --receipt receipt.json

# after you have read the pages, record the statuses and dates
node scripts/zero-to.mjs check-links roadmap.json --write
```

Without the tool, the same checks by hand:

```bash
curl -sSL -o /dev/null -w "%{http_code} %{url_effective}\n" "URL"
curl -sSL "URL" | grep -o "<title>[^<]*" | head -1
```

Then open the page with the host's fetch or browser tool and read the part the `why` line relies on.

## The receipt

Next to the roadmap, keep every URL you tried, its status and why it was kept or dropped. The site shows the totals ("38 opened, 31 kept, 5 dead, 2 flagged"), so the learner can see the work behind the list.
