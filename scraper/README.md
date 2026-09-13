# The polite scraper — FlyRank Internship · Backend Track · W5 · A9

A small, polite scraping pipeline over [Books to Scrape](https://books.toscrape.com/):
download the first three catalogue pages, visit all 60 book pages, turn messy HTML
into clean, checked JSON, survive a broken page without crashing, and end every run
with an honest report.

**Lane:** JavaScript (Node.js 22) — the same language used earlier in this track.
Built-in `fetch` for requests, Cheerio for parsing, Zod for schema validation, the
built-in file system for output. No database, no proxy, no cloud account, no card.

## Status

Stage 0 of 7 — target classified. Nothing is scraped yet; the entry file is a stub.

| Stage | What | Done |
| --- | --- | --- |
| 0 | Check before you collect | ✅ |
| 1 | Fetch once, cache once | ⬜ |
| 2 | Find all three pages | ⬜ |
| 3 | Extract the raw records | ⬜ |
| 4 | Clean it, check it, store it | ⬜ |
| 5 | One bad page must not kill the run | ⬜ |
| 6 | Publish the evidence | ⬜ |

## Run it

```bash
node src/index.js
```

No dependencies yet — Stage 2 is the first stage that needs one.

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

These apply to every request that actually leaves this machine. Cached reads are not
requests and need none of it.

- **User-agent:** `FlyRankInternship-A9/1.0 (+https://github.com/sameeerraza/flyrank-backend)`
  — an honest name and a link, so a site owner reading their logs can find out who
  this is.
- **Timeout:** every request gives up after a few seconds rather than hanging.
- **Status check:** only `200` is a page. Anything else is a failed fetch, not HTML
  to parse.
- **Delay:** at least 500 ms between real requests.
- **Cache:** the first fetch of a URL is saved under `cache/` and re-read from there
  for the rest of development. The site should feel one run, not fifty.

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
