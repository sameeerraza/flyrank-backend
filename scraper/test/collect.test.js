// Stage 3 — the wiring between fetch and parse, against a local server.

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { collectBooks } = require("../src/collect");

const FAST = { delayMs: 0 };

function bookPage(title, description = "words") {
  return `<html><body><article class="product_page">
    <div class="product_main">
      <h1>${title}</h1>
      <p class="price_color">£51.77</p>
      <p class="instock availability">In stock (1 available)</p>
      <p class="star-rating Four"></p>
    </div>
    <div id="product_description"><h2>Product Description</h2></div>
    ${description === null ? "" : `<p>${description}</p>`}
  </article></body></html>`;
}

async function startBooks(pages) {
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits += 1;
    const body = pages[req.url];
    if (!body) {
      res.writeHead(404);
      return res.end("missing");
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "collect-cache-"));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    get hits() {
      return hits;
    },
    cacheDir,
    async close() {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
      await fs.rm(cacheDir, { recursive: true, force: true });
    },
  };
}

test("every discovered book becomes a record, with its own source page", async () => {
  const server = await startBooks({
    "/b1.html": bookPage("First"),
    "/b2.html": bookPage("Second", null),
  });

  try {
    const books = [
      { url: `${server.url}/b1.html`, sourcePage: `${server.url}/page-1.html` },
      { url: `${server.url}/b2.html`, sourcePage: `${server.url}/page-2.html` },
    ];
    const { records } = await collectBooks({
      books,
      fetchOptions: { ...FAST, cacheDir: server.cacheDir },
    });

    assert.equal(records.length, 2);
    assert.equal(records[0].title, "First");
    assert.equal(records[1].title, "Second");
    assert.equal(records[1].description, null);
    assert.equal(records[0].source_page, `${server.url}/page-1.html`);
    assert.equal(records[1].source_page, `${server.url}/page-2.html`);
  } finally {
    await server.close();
  }
});

// A server that can be told to fail a given path a number of times before it
// starts answering, and counts every request it receives.
async function startFlaky(routes) {
  const hits = {};
  const server = http.createServer((req, res) => {
    hits[req.url] = (hits[req.url] ?? 0) + 1;
    const route = routes[req.url];
    if (!route) {
      res.writeHead(404);
      return res.end("missing");
    }
    if (route.failTimes && hits[req.url] <= route.failTimes) {
      res.writeHead(route.status ?? 503, route.headers ?? {});
      return res.end("nope");
    }
    if (route.alwaysStatus) {
      res.writeHead(route.alwaysStatus);
      return res.end("nope");
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(route.body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "flaky-cache-"));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    hits,
    cacheDir,
    async close() {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
      await fs.rm(cacheDir, { recursive: true, force: true });
    },
  };
}

test("one broken page does not take the run down", async () => {
  const server = await startFlaky({
    "/b1.html": { body: bookPage("First") },
    "/b3.html": { body: bookPage("Third") },
    // /b2.html is not registered at all — a 404.
  });

  try {
    const books = ["b1", "b2", "b3"].map((n) => ({
      url: `${server.url}/${n}.html`,
      sourcePage: `${server.url}/page-1.html`,
    }));
    const { records, failures } = await collectBooks({
      books,
      fetchOptions: { ...FAST, cacheDir: server.cacheDir },
    });

    assert.equal(records.length, 2, "the good pages survived the bad one");
    assert.deepEqual(
      records.map((r) => r.title),
      ["First", "Third"],
    );
    assert.equal(failures.length, 1);
    assert.equal(failures[0].url, `${server.url}/b2.html`);
  } finally {
    await server.close();
  }
});

test("a 404 is never asked for twice", async () => {
  const server = await startFlaky({ "/gone.html": { alwaysStatus: 404 } });

  try {
    const { failures } = await collectBooks({
      books: [{ url: `${server.url}/gone.html`, sourcePage: "s" }],
      fetchOptions: { ...FAST, cacheDir: server.cacheDir },
    });

    // The page does not exist. Asking again will not create it.
    assert.equal(server.hits["/gone.html"], 1);
    assert.equal(failures[0].attempts, 1);
    assert.equal(failures[0].kind, "http");
    assert.equal(failures[0].status, 404);
  } finally {
    await server.close();
  }
});

test("a 403 is never asked for twice either", async () => {
  const server = await startFlaky({ "/nope.html": { alwaysStatus: 403 } });

  try {
    const { failures } = await collectBooks({
      books: [{ url: `${server.url}/nope.html`, sourcePage: "s" }],
      fetchOptions: { ...FAST, cacheDir: server.cacheDir },
    });

    // The site said no. Asking again is how a polite robot becomes a pest.
    assert.equal(server.hits["/nope.html"], 1);
    assert.equal(failures[0].status, 403);
  } finally {
    await server.close();
  }
});

test("a 5xx is retried once, and a page that recovers yields a record", async () => {
  const server = await startFlaky({
    "/flaky.html": { failTimes: 1, status: 503, body: bookPage("Recovered") },
  });

  try {
    const { records, failures } = await collectBooks({
      books: [{ url: `${server.url}/flaky.html`, sourcePage: "s" }],
      fetchOptions: { ...FAST, cacheDir: server.cacheDir },
    });

    assert.equal(server.hits["/flaky.html"], 2, "one failure, one retry");
    assert.equal(failures.length, 0);
    assert.equal(records[0].title, "Recovered");
  } finally {
    await server.close();
  }
});

test("the retry happens once, not until it works", async () => {
  const server = await startFlaky({ "/down.html": { alwaysStatus: 500 } });

  try {
    const { failures } = await collectBooks({
      books: [{ url: `${server.url}/down.html`, sourcePage: "s" }],
      fetchOptions: { ...FAST, cacheDir: server.cacheDir },
    });

    assert.equal(server.hits["/down.html"], 2, "original attempt plus one retry");
    assert.equal(failures[0].attempts, 2);
  } finally {
    await server.close();
  }
});

test("a page that downloads but does not parse fails as a parse error", async () => {
  const server = await startFlaky({
    "/notabook.html": { body: "<html><body><p>no product article here</p></body></html>" },
    "/b1.html": { body: bookPage("Fine") },
  });

  try {
    const { records, failures } = await collectBooks({
      books: [
        { url: `${server.url}/notabook.html`, sourcePage: "s" },
        { url: `${server.url}/b1.html`, sourcePage: "s" },
      ],
      fetchOptions: { ...FAST, cacheDir: server.cacheDir },
    });

    assert.equal(records.length, 1);
    assert.equal(failures.length, 1);
    // A download failure and a parse failure are two different numbers in the
    // report, and this is the field that separates them.
    assert.equal(failures[0].kind, "parse");
    assert.equal(failures[0].status, null);
    // A page that downloaded fine is never re-requested just because it failed
    // to parse.
    assert.equal(server.hits["/notabook.html"], 1);
  } finally {
    await server.close();
  }
});

test("a cached page that fails to parse costs the site nothing", async () => {
  const server = await startFlaky({
    "/notabook.html": { body: "<html><body><p>not a book</p></body></html>" },
  });

  try {
    const books = [{ url: `${server.url}/notabook.html`, sourcePage: "s" }];
    const options = { books, fetchOptions: { ...FAST, cacheDir: server.cacheDir } };

    // First pass fills the cache and fails to parse.
    await collectBooks(options);
    // Second pass reads that same page off disk and fails to parse again.
    const second = await collectBooks(options);

    assert.equal(second.failures.length, 1);
    assert.equal(second.failures[0].kind, "parse");
    // The page came off disk: no request was made, and the cache hit is counted.
    assert.equal(second.networkRequests, 0, "a parse failure is not a request");
    assert.equal(second.cacheHits, 1, "the cache hit still counts");
    assert.equal(server.hits["/notabook.html"], 1, "asked for exactly once, ever");
  } finally {
    await server.close();
  }
});

test("a Retry-After longer than the run's budget means no retry at all", async () => {
  const server = await startFlaky({
    "/busy.html": { alwaysStatus: 429, failTimes: 99, status: 429, headers: { "retry-after": "120" } },
  });

  try {
    const { failures } = await collectBooks({
      books: [{ url: `${server.url}/busy.html`, sourcePage: "s" }],
      fetchOptions: { ...FAST, cacheDir: server.cacheDir },
    });

    // The server said 120s. Asking again after 10 would be ignoring it, so the
    // page is failed instead — and the report says why.
    assert.equal(server.hits["/busy.html"], 1);
    assert.equal(failures[0].status, 429);
    assert.match(failures[0].reason, /not retried/);
    assert.match(failures[0].reason, /120s/);
    assert.match(failures[0].reason, /budget/);
  } finally {
    await server.close();
  }
});

test("a Retry-After within budget is waited out, then retried", async () => {
  const server = await startFlaky({
    "/slow.html": {
      failTimes: 1,
      status: 503,
      headers: { "retry-after": "0.05" },
      body: bookPage("Recovered"),
    },
  });

  try {
    const started = Date.now();
    const { records, failures } = await collectBooks({
      books: [{ url: `${server.url}/slow.html`, sourcePage: "s" }],
      fetchOptions: { ...FAST, cacheDir: server.cacheDir },
    });

    assert.equal(failures.length, 0);
    assert.equal(records[0].title, "Recovered");
    assert.equal(server.hits["/slow.html"], 2);
    assert.ok(Date.now() - started >= 50, "the server's figure was actually waited out");
  } finally {
    await server.close();
  }
});

test("fetched_at comes from the cached page, so a rerun repeats it exactly", async () => {
  const server = await startBooks({ "/b1.html": bookPage("First") });

  try {
    const books = [
      { url: `${server.url}/b1.html`, sourcePage: `${server.url}/page-1.html` },
    ];
    const options = { books, fetchOptions: { ...FAST, cacheDir: server.cacheDir } };

    const first = await collectBooks(options);
    const hitsAfterFirst = server.hits;
    const second = await collectBooks(options);

    assert.equal(server.hits, hitsAfterFirst, "the rerun reads from cache");
    assert.equal(second.cacheHits, 1);
    // A record built today from a page saved yesterday must say yesterday.
    assert.equal(second.records[0].fetched_at, first.records[0].fetched_at);
    assert.deepEqual(second.records, first.records);
  } finally {
    await server.close();
  }
});
