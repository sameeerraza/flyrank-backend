# The polite scraper — FlyRank Internship · Backend Track · W5 · A9

A small, polite scraping pipeline over [Books to Scrape](https://books.toscrape.com/):
download the first three catalogue pages, visit all 60 book pages, turn messy HTML
into clean, checked JSON, survive a broken page without crashing, and end every run
with an honest report.

**Lane:** JavaScript (Node.js 22) — the same language used earlier in this track.
Built-in `fetch` for requests, Cheerio for parsing, Zod for schema validation, the
built-in file system for output. No database, no proxy, no cloud account, no card.

## Status

Stage 4 of 7 — records are normalized, checked against a schema, and stored.
`output/books.json` holds exactly 60 unique records and a rerun reproduces it
byte for byte.

| Stage | What | Done |
| --- | --- | --- |
| 0 | Check before you collect | ✅ |
| 1 | Fetch once, cache once | ✅ |
| 2 | Find all three pages | ✅ |
| 3 | Extract the raw records | ✅ |
| 4 | Clean it, check it, store it | ✅ |
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

detail_pages=60
null_descriptions=0
cache_hits=0/60

sample record:
{
  "title": "A Light in the Attic",
  "product_url": "https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html",
  "price_text": "£51.77",
  "price_gbp": 51.77,
  "availability_text": "In stock (22 available)",
  "rating_text": "Three",
  "description": "It's hard to imagine a world without A Light in the Attic. … ...more",
  "description_clean": "It's hard to imagine a world without A Light in the Attic. …",
  "source_page": "https://books.toscrape.com/catalogue/page-1.html",
  "fetched_at": "2026-09-13T11:15:53.842Z"
}

valid_records=60
invalid_records=0
duplicates_dropped=0
reconciled=true  (60 valid + 0 invalid + 0 duplicate = 60 of 60 discovered)
stored → output/books.json  ·  output/errors.json
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

Sixty-three tests. The politeness rules: the user-agent that actually reaches the
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
failing loudly instead of yielding eight nulls. Normalization and storage: prices
with trailing junk, a missing symbol, another currency or a thousands separator
all refused rather than half-read, a fragment not making a second book, invalid
records landing in `errors.json` with their reasons and never in `books.json`, and
storing the same records twice producing byte-identical output.

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
| `src/canonical.js` | One definition of "the same book", shared by Stage 2's dedupe and Stage 4's identity. |
| `src/normalize.js` | Raw strings to clean values: `price_text` → `price_gbp`, `...more` stripped. |
| `src/schema.js` | The record shape, in Zod. What is required, what type, what may be null. |
| `src/store.js` | Validates before writing, then writes `books.json` and `errors.json`. |
| `src/index.js` | Entry point. Wires the stages together and prints the run. |
| `package.json` | The scraper's own dependencies, kept out of the Task API's manifest at the repo root. |
| `test/` | Politeness rules checked against a local server, never against the sandbox. |

## The record

Ten fields. Raw values and clean values live side by side — the page's own words
are never overwritten by what we made of them.

| Field | Type | Notes |
| --- | --- | --- |
| `title` | string | Non-empty. |
| `product_url` | string | The record's identity. Must be within `https://books.toscrape.com`. |
| `price_text` | string | Exactly as printed: `"£51.77"`. |
| `price_gbp` | number | Finite, not negative. |
| `availability_text` | string | Collapsed to one line. |
| `rating_text` | enum | One of One, Two, Three, Four, Five. Required — see below. |
| `description` | string \| null | As it was on the page, `...more` and all. |
| `description_clean` | string \| null | Only the `...more` suffix removed. |
| `source_page` | string | The catalogue page this book was found on. |
| `fetched_at` | string | ISO 8601. The cache file's timestamp, not the clock. |

A record is checked against this **before** it is stored. Anything that fails goes
to `output/errors.json` with the reasons and never appears in `books.json`.

**Only `description` is optional.** The brief marks that one optional and is silent
on the rest, so the rest being required is a decision worth naming. `rating_text`
is the one people ask about: the parser yields `null` when the star-rating class is
not one of the five words, and that does not mean a book has no rating — it means
the page's structure changed. A record like that belongs in `errors.json` where
someone will see it, not in `books.json` looking complete with one field quietly
absent.

**`product_url` and `source_page` must be within `https://books.toscrape.com`**,
not merely `https://`. Discovery already refuses an off-origin link, so nothing
off-origin can reach the schema today — but the schema is the last gate before a
record is written, and a gate that trusts an earlier gate is not really a gate.

`price_gbp` is parsed with a strict pattern rather than `parseFloat`, which reads
`"£51.77 (was £60)"` as `51.77` and reports nothing — a partial read is worse than
a refusal, because it looks like a price. A value that cannot be read becomes
`null`, fails the schema, and lands in `errors.json` where you can see it. The
currency symbol is required for the same reason: the number out of `"$51.77"` must
never be copied into a field named `price_gbp`.

### Idempotency

Running twice produces the same 60 records, not 120 — and the proof is a diff, not
a count:

```bash
node src/index.js
cp output/books.json /tmp/run1.json
node src/index.js
diff /tmp/run1.json output/books.json   # empty
```

This holds because identity is the canonical URL, records keep discovery order,
and `fetched_at` comes from the cache file rather than the clock. A matching count
can still hide a timestamp that moved; an empty diff cannot.

### The run checks its own arithmetic

Every URL the crawl found has to end up somewhere nameable — stored, rejected with
a reason, dropped as a duplicate, or (from Stage 5) failed outright:

```
reconciled=true  (60 valid + 0 invalid + 0 duplicate = 60 of 60 discovered)
```

If those never add up, a record went missing between the crawl and the file, and
no individual count would look wrong. A report that is only a list of numbers
cannot tell you when one of them is a lie; this one can.

## What the pages actually contain

Two findings from the 60 pages in scope, both for Stage 4 to deal with rather than
Stage 3 — a raw record is meant to record what was on the page, not improve it.

- **Descriptions arrive doubled.** The site's own `<p>` holds a truncated teaser,
  then the full text, then a literal `...more`: *"…laugh and smile and love th
  It's hard to imagine a world without…"*. That is one paragraph in the source,
  not a selector picking up two elements. 59 of the 60 end in `...more`.

  We record it as it was. `description_clean` sits alongside it and strips only
  the `...more` suffix, which is exact string surgery. **The repeated teaser is
  left in place on purpose.** Removing it would take a heuristic — find the
  repeat, guess where it ends — and a heuristic that is wrong once has cut real
  prose out of a record, which is the same sin as inventing text that was never
  on the page. Keeping the raw field is also what makes it possible to go back
  and compare against the page when a description looks wrong three weeks from
  now, instead of trusting our own cleanup.
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
