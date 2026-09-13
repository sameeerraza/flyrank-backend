// The only file that talks to the network.
//
// Every real request goes through fetchPolitely: an honest user-agent, a timeout,
// a status check before the body is touched, and at least delayMs since the last
// real request. fetchWithCache wraps it so a URL is asked for once and re-read
// from disk after that.

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { TARGET, CACHE_DIR } = require("./config");

// A failure carries its own facts. Stage 5 has to tell "try once more" apart from
// "never ask again", and the run report has to count failures by status — neither
// works if the only machine-readable thing is an English sentence.
class FetchError extends Error {
  constructor(message, { url, kind, status = null, retryable, retryAfter = null }) {
    super(message);
    this.name = "FetchError";
    this.url = url;
    this.kind = kind; // "timeout" | "network" | "http"
    this.status = status; // number for kind "http", otherwise null
    this.retryable = retryable;
    this.retryAfter = retryAfter; // seconds, when the server named a figure
  }
}

// Retry a request that might succeed next time; never retry an answer that will
// not change. A 404 means the page is not there — asking again will not create
// it. A 403 means the site said no — asking again is how a polite robot becomes
// a pest. A 429 is the site asking for slower, not for never.
function isRetryableStatus(status) {
  return status >= 500 || status === 429;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Rate limit across the whole process rather than sleeping blindly: wait only the
// time still owed since the last real request finished, so the first request is
// not delayed at all. The clock is stamped on completion, not on dispatch, so the
// site sees a full delayMs of quiet between one response and the next request
// under any way of measuring it.
//
// Known limitation: this assumes requests are sequential, which they are through
// Stage 5. Two fetchPolitely calls running at once would both read lastRequestAt
// before either updated it, compute the same debt, and fire together — breaking
// the 500ms promise silently, with no error to notice. Adding concurrency (the
// A7 queued-jobs stretch) means putting a mutex around read-wait-stamp first.
let lastRequestAt = 0;

async function throttle(delayMs) {
  const owed = delayMs - (Date.now() - lastRequestAt);
  if (owed > 0) await sleep(owed);
}

// https://books.toscrape.com/catalogue/page-1.html -> catalogue-page-1.html
// A readable name beats a hash: when a selector misbehaves you want to open the
// exact page in an editor without grepping for which file it was.
function cacheNameFor(url) {
  const parsed = new URL(url);
  let name = parsed.pathname.replace(/^\/+|\/+$/g, "").replace(/\//g, "-");
  if (parsed.search) {
    name += `-${crypto.createHash("sha1").update(parsed.search).digest("hex").slice(0, 8)}`;
  }
  name = name.replace(/[^a-zA-Z0-9._-]/g, "_") || "index.html";
  // Keep clear of the 255-byte filename limit without letting two long URLs
  // collapse onto the same file.
  if (name.length > 120) {
    const digest = crypto.createHash("sha1").update(url).digest("hex").slice(0, 8);
    name = `${name.slice(0, 111)}-${digest}`;
  }
  return name;
}

function cachePathFor(url, cacheDir = CACHE_DIR) {
  return path.join(cacheDir, cacheNameFor(url));
}

async function readCache(cachePath) {
  try {
    return await fs.readFile(cachePath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

async function fetchPolitely(url, options = {}) {
  const {
    userAgent = TARGET.userAgent,
    timeoutMs = TARGET.timeoutMs,
    delayMs = TARGET.delayMs,
  } = options;

  await throttle(delayMs);

  let res;
  try {
    res = await fetch(url, {
      headers: { "user-agent": userAgent },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // A failure still cost the site a request, so it still starts the clock.
    lastRequestAt = Date.now();
    if (err.name === "TimeoutError") {
      throw new FetchError(`gave up after ${timeoutMs}ms: ${url}`, {
        url,
        kind: "timeout",
        retryable: true,
      });
    }
    throw new FetchError(`request failed: ${url} — ${err.message}`, {
      url,
      kind: "network",
      retryable: true,
    });
  }

  lastRequestAt = Date.now();

  // Status first, before anything reads the body. Only 200 is a page; a 404 error
  // page is still a body, and parsing it would quietly produce garbage records.
  if (res.status !== 200) {
    const retryAfter = Number(res.headers.get("retry-after"));
    // Drain the error page we are about to discard, so the socket goes back to
    // the pool instead of being torn down. Stage 5 makes this matter: a run with
    // deliberately broken URLs in it should not leak a connection per failure.
    if (res.body) await res.body.cancel().catch(() => {});
    throw new FetchError(`HTTP ${res.status} ${res.statusText} — ${url}`, {
      url,
      kind: "http",
      status: res.status,
      retryable: isRetryableStatus(res.status),
      retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
    });
  }

  // res.text() decodes as UTF-8 per the fetch spec. This site sends
  // "content-type: text/html" with no charset, but its markup declares
  // <meta charset="UTF-8">, so the two agree and "£51.77" survives intact.
  // Reading bytes and decoding by hand is how that turns into "Â£51.77".
  return res.text();
}

// Returns { html, fromCache, bytes, cachePath, fetchedAt }. The cache is what
// keeps the site from feeling every restart of this script — and because the delay
// lives on the network path, a cached read never waits.
//
// fetchedAt is always the cache file's mtime, on both paths. It is provenance: the
// honest answer to "when did this HTML arrive", and a record built from a page
// cached yesterday must not claim it was fetched just now. Reading it back off the
// file on the fetch path too, rather than trusting a Date taken moments earlier,
// is what makes run 1 and run 2 agree to the millisecond — which is what lets the
// idempotency proof be "diff the two outputs, get nothing". Delete cache/ and the
// timestamp moves, which is also honest.
async function fetchWithCache(url, options = {}) {
  const cachePath = cachePathFor(url, options.cacheDir);

  const cached = await readCache(cachePath);
  if (cached !== null) {
    const { mtime } = await fs.stat(cachePath);
    return {
      html: cached,
      fromCache: true,
      bytes: Buffer.byteLength(cached),
      cachePath,
      fetchedAt: mtime.toISOString(),
    };
  }

  const html = await fetchPolitely(url, options);
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, html, "utf8");
  const { mtime } = await fs.stat(cachePath);
  return {
    html,
    fromCache: false,
    bytes: Buffer.byteLength(html),
    cachePath,
    fetchedAt: mtime.toISOString(),
  };
}

module.exports = {
  FetchError,
  fetchPolitely,
  fetchWithCache,
  cacheNameFor,
  cachePathFor,
};
