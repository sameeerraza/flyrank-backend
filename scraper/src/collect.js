// Stage 3 + 5 — open every discovered book page, turn it into a raw record, and
// survive the ones that break.
//
// The two halves stay apart on purpose: fetcher.js knows about the network,
// extract.js knows about HTML, and this file is the only place that puts them
// together. That is also why the error handling lives here — by the time a
// failure reaches this loop it already carries a kind, so "could not download"
// and "could not parse" are two different numbers without any guesswork.

const { fetchWithCache } = require("./fetcher");
const { extractBook } = require("./extract");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// How long this run is willing to wait when a server names its own figure.
//
// Note what this is NOT: it is not a ceiling that lets us ask again sooner than
// we were told. Capping a Retry-After of 120s at 10s and retrying anyway is the
// precise impoliteness this project exists to avoid — the server said 120, so
// asking at 10 is ignoring it. When the wait exceeds the budget we do not retry
// at all; the page is reported as failed and says why.
const MAX_RETRY_AFTER_MS = 10_000;

// Retry belongs here rather than inside fetchWithCache. The fetcher already owns
// the politeness delay; a retry loop in there would mean two independent things
// deciding how long to wait, from two places, for the same request.
//
// One extra attempt, and only when the error says it is worth one. A 404 means
// the page does not exist — asking again will not create it. A 403 means the site
// said no — asking again is how a polite robot becomes a pest. The throttle
// already puts delayMs of quiet before the retry leaves, so "wait a moment and
// try once more" needs no sleep of its own; the only exception is a server that
// named its own figure.
async function fetchWithRetry(
  url,
  fetchOptions,
  maxRetries,
  maxRetryAfterMs = MAX_RETRY_AFTER_MS,
) {
  let attempts = 0;

  for (;;) {
    attempts += 1;
    try {
      const result = await fetchWithCache(url, fetchOptions);
      return { ...result, attempts };
    } catch (err) {
      if (!err.retryable || attempts > maxRetries) {
        err.attempts = attempts;
        throw err;
      }

      // A 429 or 503 may carry Retry-After. Obey it, or give up — never split
      // the difference and ask early.
      if (err.retryAfter) {
        const waitMs = err.retryAfter * 1000;
        if (waitMs > maxRetryAfterMs) {
          err.attempts = attempts;
          err.notRetried =
            `server asked for ${err.retryAfter}s, beyond this run's ` +
            `${maxRetryAfterMs / 1000}s budget`;
          throw err;
        }
        await sleep(waitMs);
      }
    }
  }
}

async function collectBooks({
  books,
  fetchOptions,
  onBook,
  onFailure,
  maxRetries = 1,
  maxRetryAfterMs = MAX_RETRY_AFTER_MS,
} = {}) {
  const records = [];
  const failures = [];
  let cacheHits = 0;
  // Requests that actually left this machine, retries and failures included.
  // This is the number the site would see in its logs, so it is the one worth
  // reporting: a run that asked twice and calls it once is not being honest
  // about the load it caused.
  let networkRequests = 0;

  // One page is one page. Fifty-nine good records must survive one bad one, so a
  // failure is written down and the loop keeps going.
  //
  // kind comes off the error itself: "timeout" | "network" | "http" from the
  // fetcher, "parse" from the extractor. A report that says one page failed
  // without saying how is barely better than silence.
  const recordFailure = (err, { url, sourcePage, index }) => {
    const failure = {
      url,
      source_page: sourcePage,
      kind: err.kind ?? "unknown",
      status: err.status ?? null,
      attempts: err.attempts ?? 1,
      reason: err.notRetried ? `${err.message} — not retried: ${err.notRetried}` : err.message,
    };
    failures.push(failure);
    onFailure?.({ failure, index, total: books.length });
  };

  for (const [index, { url, sourcePage }] of books.entries()) {
    const position = index + 1;

    // The download and the parse are two separate failures with two separate
    // costs, so they get two separate try blocks. Sharing one charges the site
    // for a request that a parse failure never made: a page read from cache and
    // then failing to parse still landed in the fetch catch and added one to the
    // request count, inflating the one number in the report that is supposed to
    // say what the site's logs would show.
    let fetched;
    try {
      fetched = await fetchWithRetry(url, fetchOptions, maxRetries, maxRetryAfterMs);
      if (fetched.fromCache) cacheHits += 1;
      else networkRequests += fetched.attempts;
    } catch (err) {
      // A failed download still cost the site every attempt it took.
      networkRequests += err.attempts ?? 1;
      recordFailure(err, { url, sourcePage, index: position });
      continue;
    }

    try {
      // fetchedAt is the cache file's timestamp, so a record built today from a
      // page saved yesterday says yesterday. The receipt has to be true or it is
      // not a receipt.
      const record = extractBook(fetched.html, {
        url,
        sourcePage,
        fetchedAt: fetched.fetchedAt,
      });
      records.push(record);
      onBook?.({
        record,
        fromCache: fetched.fromCache,
        attempts: fetched.attempts,
        index: position,
        total: books.length,
      });
    } catch (err) {
      // The HTML had already arrived. Nothing more was asked of the site, so
      // nothing more is charged to it.
      recordFailure(err, { url, sourcePage, index: position });
    }
  }

  return { records, failures, cacheHits, networkRequests };
}

module.exports = { collectBooks, fetchWithRetry };
