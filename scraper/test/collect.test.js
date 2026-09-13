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
