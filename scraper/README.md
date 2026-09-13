# The polite scraper — FlyRank Internship · Backend Track · W5 · A9

A small, polite scraping pipeline over [Books to Scrape](https://books.toscrape.com/):
download the first three catalogue pages, visit all 60 book pages, turn messy HTML
into clean, checked JSON, survive a broken page without crashing, and end every run
with an honest report.

**Lane:** JavaScript (Node.js 22) — the same language used earlier in this track.
Built-in `fetch` for requests, Cheerio for parsing, Zod for schema validation, the
built-in file system for output. No database, no proxy, no cloud account, no card.

## Status

Stage 2 of 7 — the three catalogue pages are walked by following the site's own
"next" link, and all 60 book URLs are discovered. No book page is opened yet.

| Stage | What | Done |
| --- | --- | --- |
| 0 | Check before you collect | ✅ |
| 1 | Fetch once, cache once | ✅ |
| 2 | Find all three pages | ✅ |
| 3 | Extract the raw records | ⬜ |
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
$ node src/index.js                      $ node src/index.js
FETCH  …/catalogue/page-1.html           CACHE HIT  …/catalogue/page-1.html
  50469 bytes  ·  20 books                 50469 bytes  ·  20 books
FETCH  …/catalogue/page-2.html           CACHE HIT  …/catalogue/page-2.html
  50877 bytes  ·  20 books                 50877 bytes  ·  20 books
FETCH  …/catalogue/page-3.html           CACHE HIT  …/catalogue/page-3.html
  51374 bytes  ·  20 books                 51374 bytes  ·  20 books

catalogue_pages=3                        catalogue_pages=3
discovered=60                            discovered=60
unique_urls=60                           unique_urls=60
skipped_links=0                          skipped_links=0
next_rejected=0                          next_rejected=0
cache_hits=0/3                           cache_hits=3/3

real 2.67s                               real 0.26s
```

Same numbers both times. The runs report sizes and counts rather than markup —
sixty pages of HTML in a terminal helps nobody. The ten-fold difference in wall
time is the politeness delay: it sits on the network path, so the cold run pays
500 ms between pages and the warm run pays nothing.

## Test it

```bash
npm test
```

Twenty-one tests. The politeness rules: the user-agent that actually reaches the
wire, the timeout, each status code and whether it is worth retrying, cache naming,
and the fetch-once/read-from-disk behaviour with its `fetchedAt`. The crawl:
relative URLs resolved against their page, the selector staying inside the product
area, links that leave the origin being refused — including an `http` downgrade and
a `javascript:` URL — unusable hrefs being counted rather than dropped, a refused
"next" link being reported rather than passing for the end of the catalogue, the
walk following `next` and then stopping, duplicates counted once, and a second walk
reporting the same numbers off the cache.

They run against a throwaway local server and finish in well under a second —
nothing here touches books.toscrape.com, because testing failure by hammering the
real site is the one thing this assignment tells you not to do.

## Layout

| File | Responsibility |
| --- | --- |
| `src/config.js` | The target and the politeness numbers. No side effects, so any module can require it. |
| `src/fetcher.js` | The only file that touches the network: user-agent, timeout, status check, delay, cache. |
| `src/discover.js` | Stage 2's crawl: walks the catalogue by its own "next" link and collects book URLs. |
| `src/index.js` | Entry point. Wires the stages together and prints the run. |
| `package.json` | The scraper's own dependencies, kept out of the Task API's manifest at the repo root. |
| `test/` | Politeness rules checked against a local server, never against the sandbox. |

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
