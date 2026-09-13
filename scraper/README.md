# The polite scraper — FlyRank Internship · Backend Track · W5 · A9

A small, polite scraping pipeline over [Books to Scrape](https://books.toscrape.com/):
download the first three catalogue pages, visit all 60 book pages, turn messy HTML
into clean, checked JSON, survive a broken page without crashing, and end every run
with an honest report.

**Lane:** JavaScript (Node.js 22) — the same language used earlier in this track.
Built-in `fetch` for requests, Cheerio for parsing, Zod for schema validation, the
built-in file system for output. No database, no proxy, no cloud account, no card.

## Status

Stage 3 of 7 — all 60 book pages are fetched and turned into raw records, each
carrying its eight keys and its provenance. Nothing is normalized or validated
yet: `price_text` is still `"£51.77"`, not a number.

| Stage | What | Done |
| --- | --- | --- |
| 0 | Check before you collect | ✅ |
| 1 | Fetch once, cache once | ✅ |
| 2 | Find all three pages | ✅ |
| 3 | Extract the raw records | ✅ |
| 4 | Clean it, check it, store it | ⬜ |
| 5 | One bad page must not kill the run | ⬜ |
| 6 | Publish the evidence | ⬜ |

## Run it

From a fresh clone of the repo:

```bash
cd scraper
npm install
node src/index.js
```

Needs Node.js 20+ — the scraper uses the built-in `fetch` and `AbortSignal.timeout`.
It is its own npm package, separate from the Task API at the repo root: `cheerio`
(Stage 2) and `zod` (Stage 4) belong to the scraper and are declared here, not in
the API's manifest. Stage 1 itself runs on built-ins alone.

The first run asks the site; every run after that reads the saved copy. Delete
`cache/` to force a real fetch again.

```
$ node src/index.js
FETCH  https://books.toscrape.com/catalogue/page-1.html
  50469 bytes  ·  20 books
FETCH  https://books.toscrape.com/catalogue/page-2.html
  50877 bytes  ·  20 books
FETCH  https://books.toscrape.com/catalogue/page-3.html
  51374 bytes  ·  20 books

catalogue_pages=3
discovered=60
unique_urls=60
skipped_links=0
next_rejected=0

  [ 1/60] fetch  A Light in the Attic
  [ 2/60] fetch  Tipping the Velvet
  …
  [60/60] fetch  The Natural History of Us (The Fine Art of Pretending #2)

sample record:
{
  "title": "A Light in the Attic",
  "product_url": "https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html",
  "price_text": "£51.77",
  "availability_text": "In stock (22 available)",
  "rating_text": "Three",
  "description": "It's hard to imagine a world without A Light in the Attic. …",
  "source_page": "https://books.toscrape.com/catalogue/page-1.html",
  "fetched_at": "2026-09-13T11:15:53.842Z"
}

detail_pages=60
null_descriptions=0
cache_hits=0/60
```

A second run prints the same numbers with `cache_hits=60/60` and every line
reading `cache` instead of `fetch`. The difference in wall time is the whole
point of the cache and the delay: **43.6 s cold, 0.9 s warm**. The delay sits on
the network path, so the cold run pays 500 ms per page and the warm run pays
nothing. Neither run dumps HTML — sixty pages of markup in a terminal helps
nobody.

## Test it

```bash
npm test
```

Thirty-four tests. The politeness rules: the user-agent that actually reaches the
wire, the timeout, each status code and whether it is worth retrying, cache naming,
and the fetch-once/read-from-disk behaviour with its `fetchedAt`. The crawl:
relative URLs resolved against their page, the selector staying inside the product
area, links that leave the origin being refused — including an `http` downgrade and
a `javascript:` URL — unusable hrefs being counted rather than dropped, a refused
"next" link being reported rather than passing for the end of the catalogue, the
walk following `next` and then stopping, duplicates counted once, and a second walk
reporting the same numbers off the cache. The parser: all eight keys present, a
missing description as `null` rather than `""`, a rating read from its class name,
a non-rating class refused, selectors ignoring a sidebar and a recommendations
strip that both carry a heading and a price, and a page with no product article
failing loudly instead of yielding eight nulls.

They run against a throwaway local server and finish in well under a second —
nothing here touches books.toscrape.com, because testing failure by hammering the
real site is the one thing this assignment tells you not to do.

## Layout

| File | Responsibility |
| --- | --- |
| `src/config.js` | The target and the politeness numbers. No side effects, so any module can require it. |
| `src/fetcher.js` | The only file that touches the network: user-agent, timeout, status check, delay, cache. |
| `src/discover.js` | Stage 2's crawl: walks the catalogue by its own "next" link and collects book URLs. |
| `src/extract.js` | Stage 3's parser: HTML in, one record out. Touches no network, so its tests are pure fixtures. |
| `src/collect.js` | The only place fetch and parse meet: opens each book page and hands the HTML to the parser. |
| `src/index.js` | Entry point. Wires the stages together and prints the run. |
| `package.json` | The scraper's own dependencies, kept out of the Task API's manifest at the repo root. |
| `test/` | Politeness rules checked against a local server, never against the sandbox. |

## What the pages actually contain

Two findings from the 60 pages in scope, both for Stage 4 to deal with rather than
Stage 3 — a raw record is meant to record what was on the page, not improve it.

- **Descriptions arrive doubled.** The site's own `<p>` holds a truncated teaser,
  then the full text, then a literal `...more`: *"…laugh and smile and love th
  It's hard to imagine a world without…"*. That is one paragraph in the source,
  not a selector picking up two elements. 59 of the 60 end in `...more`.

  We record it as it was. Stage 4 will add a separate `description_clean`
  alongside it, the same way `price_gbp` sits alongside `price_text` — the raw
  value and the clean value live side by side, and the cleanup never overwrites
  the evidence. Only the `...more` suffix is worth stripping there: it is exactly
  deterministic. Removing the repeated teaser would take a heuristic, and a
  heuristic will one day cut real prose, which is the same sin as inventing text
  that was not on the page. Keeping the raw field is also what makes it possible
  to go back and compare against the page when a description looks wrong three
  weeks from now, instead of trusting our own cleanup.
- **Every book in scope has a description.** So `null_descriptions=0` is honest,
  and the `null` path is proven by fixtures instead — a book page with no
  description, one with an empty paragraph, and one with no description section
  at all.
- **Whitespace is treated differently per field, on purpose.**
  `availability_text` is collapsed to a single line, because the whitespace around
  *"In stock (22 available)"* is markup indentation and nothing more. A
  description is only trimmed: line breaks inside prose are part of what the page
  said, and flattening them would be an edit rather than a read.

## Known limitation

The request delay is a process-wide throttle that assumes requests happen one at a
time — which they do, through Stage 5. It reads the time of the last request,
waits out the remainder, and stamps the clock afterwards. Two fetches running
concurrently would both read that timestamp before either updated it, compute the
same debt, and fire together: the 500 ms promise would break silently, with no
error to notice it. Adding concurrency — the queued-jobs stretch goal — means
putting a mutex around that read-wait-stamp sequence first.

## Target classification

**Which site.** [books.toscrape.com](https://books.toscrape.com/) — the "Books"
sandbox listed on [toscrape.com](http://toscrape.com/).

**Why this site.** Its own landing page calls it a *Web Scraping Sandbox* and
describes Books to Scrape as "a fictional bookstore that desperately wants to be
scraped… a safe place for beginners learning web scraping and for developers
validating their scraping technologies as well." The site exists to be scraped, the
data is fictional, and no real business or person is affected by the requests. That
sentence on their page is the permission this assignment rests on.

**How much.** The **first three catalogue pages only**, found by following the
catalogue's own "next" link from page 1 and stopping after page 3 — never by
hardcoding the book URLs. The site paginates at a maximum of 20 items per page, so
three pages is **60 book detail pages**, out of the 1000 books it holds. One pass,
with every response cached locally so development re-reads the saved copy instead of
asking the site again.

That scope is enforced in code, not just promised here: a link resolving to any
other **origin** — different host, or the same host over plain `http` — is refused
and counted, so the crawler cannot wander off `https://books.toscrape.com` even if
a page one day points somewhere else. A "next" link that gets refused is counted
separately, because a crawl cut short should never be mistaken for a short
catalogue.

**What data.** Per book, eight fields lifted from the public product page:
`title`, `product_url`, `price_text`, `availability_text`, `rating_text`,
`description` (`null` when the page has none), plus `source_page` and `fetched_at`
as provenance. Later stages add a normalized numeric `price_gbp`. No images, no
reviews, no user data — there is none to collect.

**Why that is appropriate here.** The site was published as a practice target, the
scope is three pages read once and then served from cache, and every request
identifies itself and waits between calls, so the load is smaller than one person
browsing the catalogue by hand.

## Politeness rules

All five live in `src/fetcher.js`, on the path a request takes to the network.
Cached reads never reach that path, so they are never delayed and never counted.

- **User-agent:** `FlyRankInternship-A9/1.0 (+https://github.com/sameeerraza/flyrank-backend)`
  — an honest name and a link, so a site owner reading their logs can find out who
  this is.
- **Timeout:** 10 s, via `AbortSignal.timeout`. A request gives up rather than
  hanging.
- **Status check:** only `200` is a page, checked before anything reads the body.
  Anything else raises a `FetchError` carrying its `status` and whether it is worth
  retrying — a 404 or 403 never is, a timeout or 5xx is.
- **Delay:** at least 500 ms of quiet between one response and the next request,
  process-wide. The first request waits for nothing.
- **Cache:** the first fetch of a URL is saved under `cache/`, named after its path
  (`/catalogue/page-1.html` → `catalogue-page-1.html`), and re-read from there for
  the rest of development. The site should feel one run, not fifty.

## robots.txt

Requested once, on 2026-09-13:

```
GET https://books.toscrape.com/robots.txt
→ HTTP 404 Not Found (153 bytes, nginx default error page)
```

**Result: no robots file found.** The site publishes no Robots Exclusion Protocol
rules at all, so there is nothing granting or denying automated access. A missing
file is not permission — it is just a missing file. The permission for this project
comes from the sandbox statement on toscrape.com quoted above, not from the absence
of a robots.txt.

## Scope promise

I will not reuse this code on another site without checking its rules and terms first.
