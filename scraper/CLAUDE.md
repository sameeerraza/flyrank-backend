# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`scraper/` is a self-contained npm package — the W5/A9 assignment, unrelated to
the Express Task API at the repo root apart from sharing a git repo. It has its
own `package.json`, its own `node_modules`, and its own dependencies (`cheerio`,
`zod`). **Never add scraper dependencies to the root manifest**; that mistake has
already been made and undone once.

It downloads the first three catalogue pages of `books.toscrape.com`, visits all
60 book pages, and produces validated JSON plus a run report. `README.md` is the
user-facing document: target classification, the record schema, politeness rules,
ethics note, and a pasted run report.

## Commands

```bash
npm install
npm start                      # = node src/index.js — full pipeline, ~45s cold, ~1s warm
npm start -- --inject-failure  # adds one non-existent book URL; reproduces the Stage 5 checkpoint
npm test                       # = node --test, 79 tests, no network, <1s

node --test test/store.test.js                  # one file
node --test --test-name-pattern "thousands"     # one test by name
rm -rf cache/                                   # force real fetches again
```

The first run fetches; every run after reads `cache/`. `cache/` is gitignored;
`output/` is committed on purpose as sample evidence.

## Architecture

A pipeline — `classify → fetch → extract → normalize → validate → store → report`
— with strict layering that is the point of the design, not incidental:

- **`fetcher.js` is the only file that touches the network.** User-agent, timeout,
  status check, delay and cache all live on that one path.
- **`extract.js` never fetches.** It is `extractBook(html, {url, sourcePage, fetchedAt})`
  → record. That is why every parser test is a pure fixture with no server, and
  why a download failure and a parse failure are distinguishable in Stage 5.
- **`collect.js` is the only place the two meet**, so per-page error handling and
  retry live there.
- **`config.js` has no side effects**, so any module can require it without
  running the scraper. `index.js` is an entry point and exports nothing.
- **`canonical.js` is the single definition of "the same book"**, used by both
  `discover.js`'s dedupe and `store.js`'s record identity. Two notions of identity
  would agree until some URL arrived with a fragment.

## Invariants that look like details and are not

Each of these was a bug or a near-bug. Changing one silently breaks something that
no test name will obviously point at.

- **The delay sits inside `fetchWithCache`, below the cache check.** Move it to a
  caller's loop and 60 cached pages wait 30 seconds for nothing. The throttle
  stamps its clock on *completion*, so gaps are ≥ `delayMs` however you measure.
- **`fetchedAt` is the cache file's mtime on both the fetch and cache paths.**
  Using `new Date()` on the fetch path puts a few ms between run 1 and run 2 and
  destroys the byte-identical-rerun property that proves idempotency.
- **Errors carry `kind` / `status` / `retryable` / `retryAfter`** (`FetchError`) and
  `kind: "parse"` (`ExtractError`). Retry logic reads `err.retryable`; never regex
  an error message, and never distinguish failures by class.
- **Retry lives in `collect.js`, not `fetcher.js`** — one place decides how long to
  wait. Retry once, on `retryable` only: never a 404 or 403.
- **A `Retry-After` beyond the run's budget means no retry at all**, not a capped
  one. Capping 120s at 10s and asking anyway is worse than ignoring the header.
- **Fetch and extract have separate `try` blocks.** Sharing one charges the site
  for a request that a parse failure never made, inflating `requests_sent` — the
  one number meant to match the site's logs.
- **`price_gbp` is parsed with an anchored regex requiring `£`, never `parseFloat`.**
  `parseFloat("51.77abc")` returns `51.77` silently and `parseFloat("")` returns
  `NaN`, which is `typeof "number"`. Unparseable → `null` → schema failure →
  `errors.json` with a reason.
- **Raw and clean live side by side** (`price_text`/`price_gbp`,
  `description`/`description_clean`). Never overwrite a raw field. Only the exact
  `...more` suffix is stripped; the site's duplicated description teaser is left
  alone deliberately, because removing it needs a heuristic that would one day cut
  real prose.
- **Scope is enforced twice**, by origin (not host — host omits the scheme and
  would wave through an `http` downgrade): once in `discover.js` when links are
  resolved, once in `schema.js` before a record is written.
- **Validation happens before storage.** Failures go to `errors.json` with reasons
  and never into `books.json`. `errors.json` is written even when empty — a
  missing file only means nobody looked.
- **`reconcile()` must balance**: `unique_urls === valid + invalid + duplicates + failed`.
  If it ever doesn't, a record went missing and no individual count looks wrong.

## Testing conventions

Tests never touch `books.toscrape.com` — the assignment forbids testing failure by
hammering the real site. Network behaviour is tested against throwaway
`http.createServer` instances on port 0 with a temp `cacheDir`; parser behaviour is
tested on inline HTML fixtures.

Two shapes worth reusing:

- **Hit counters.** Assert the server received *exactly* N requests, not just that
  the result looked right. That is how "a 404 is never retried" and "page 4 is
  never requested" are actually proven.
- **Fixtures that plant decoys.** The catalogue fixture carries sidebar links and
  the book fixture carries a sidebar and recommendations strip with their own `h1`
  and `price_color`, so a selector that widens fails immediately.

Pass `fetchOptions: { delayMs: 0, cacheDir }` in tests so the suite stays fast and
never writes to the real `cache/`.

## Scope discipline

The README promises three catalogue pages of one public sandbox, and that promise
is enforced in code rather than prose. Do not widen the crawl, add a second target,
or point this at another site — the assignment's whole premise is that the target
was classified first.
