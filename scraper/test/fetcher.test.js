// Stage 1 — the politeness rules, checked rather than assumed.
//
// Everything here runs against a throwaway local server, never against the real
// site: testing failure by hammering books.toscrape.com is exactly what this
// assignment tells you not to do.

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  FetchError,
  fetchPolitely,
  fetchWithCache,
  cacheNameFor,
} = require("../src/fetcher");
const { TARGET } = require("../src/config");

// delayMs: 0 keeps the suite fast. The delay itself is a politeness rule for the
// real site, not something worth paying for against localhost.
const FAST = { delayMs: 0 };

async function startServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    async close() {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

test("sends an identifying user-agent, not Node's default", async () => {
  let seen = null;
  const server = await startServer((req, res) => {
    seen = req.headers["user-agent"];
    res.end("<html></html>");
  });

  try {
    await fetchPolitely(`${server.url}/`, FAST);
  } finally {
    await server.close();
  }

  assert.equal(seen, TARGET.userAgent);
  assert.match(seen, /^FlyRankInternship-A9\/1\.0 \(\+https:\/\//);
});

test("gives up instead of hanging when the server never answers", async () => {
  const server = await startServer(() => {
    /* deliberately no response */
  });

  try {
    await assert.rejects(
      () => fetchPolitely(`${server.url}/`, { ...FAST, timeoutMs: 50 }),
      (err) =>
        err instanceof FetchError &&
        err.kind === "timeout" &&
        err.status === null &&
        err.retryable === true,
    );
  } finally {
    await server.close();
  }
});

test("404 is a failed fetch and is never worth retrying", async () => {
  const server = await startServer((req, res) => {
    res.writeHead(404, { "content-type": "text/html" });
    res.end("<html>not found</html>"); // an error page is still a body
  });

  try {
    await assert.rejects(
      () => fetchPolitely(`${server.url}/missing.html`, FAST),
      (err) =>
        err instanceof FetchError &&
        err.kind === "http" &&
        err.status === 404 &&
        err.retryable === false,
    );
  } finally {
    await server.close();
  }
});

test("403 is the site saying no, so it is not retryable either", async () => {
  const server = await startServer((req, res) => {
    res.writeHead(403);
    res.end("forbidden");
  });

  try {
    await assert.rejects(
      () => fetchPolitely(`${server.url}/`, FAST),
      (err) => err.status === 403 && err.retryable === false,
    );
  } finally {
    await server.close();
  }
});

test("5xx is retryable", async () => {
  const server = await startServer((req, res) => {
    res.writeHead(503);
    res.end("busy");
  });

  try {
    await assert.rejects(
      () => fetchPolitely(`${server.url}/`, FAST),
      (err) => err.status === 503 && err.retryable === true,
    );
  } finally {
    await server.close();
  }
});

test("429 is retryable and its Retry-After is captured", async () => {
  const server = await startServer((req, res) => {
    res.writeHead(429, { "retry-after": "7" });
    res.end("slow down");
  });

  try {
    await assert.rejects(
      () => fetchPolitely(`${server.url}/`, FAST),
      (err) =>
        err.status === 429 && err.retryable === true && err.retryAfter === 7,
    );
  } finally {
    await server.close();
  }
});

test("cache filenames are readable and derived from the URL path", () => {
  assert.equal(
    cacheNameFor("https://books.toscrape.com/catalogue/page-1.html"),
    "catalogue-page-1.html",
  );
  assert.equal(
    cacheNameFor(
      "https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html",
    ),
    "catalogue-a-light-in-the-attic_1000-index.html",
  );
  assert.equal(cacheNameFor("https://books.toscrape.com/"), "index.html");

  // Two URLs differing only in query must not collapse onto one file.
  const a = cacheNameFor("https://books.toscrape.com/search?q=a");
  const b = cacheNameFor("https://books.toscrape.com/search?q=b");
  assert.notEqual(a, b);
});

test("a URL is asked for once; the second read comes off disk with the same fetchedAt", async () => {
  let hits = 0;
  const server = await startServer((req, res) => {
    hits += 1;
    res.end("<html>page</html>");
  });
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "scraper-cache-"));

  try {
    const first = await fetchWithCache(`${server.url}/catalogue/page-1.html`, {
      ...FAST,
      cacheDir,
    });
    const second = await fetchWithCache(`${server.url}/catalogue/page-1.html`, {
      ...FAST,
      cacheDir,
    });

    assert.equal(hits, 1, "the second read must not touch the network");
    assert.equal(first.fromCache, false);
    assert.equal(second.fromCache, true);
    assert.equal(first.html, second.html);

    // Provenance has to survive a rerun, or books.json differs every time and the
    // idempotency proof is gone.
    assert.equal(first.fetchedAt, second.fetchedAt);
  } finally {
    await server.close();
    await fs.rm(cacheDir, { recursive: true, force: true });
  }
});
