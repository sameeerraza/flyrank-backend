// Stage 2 — the crawl, checked against a local server and hand-written fixtures.
// Nothing here touches books.toscrape.com.

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { discoverBooks, parseCataloguePage } = require("../src/discover");

const FAST = { delayMs: 0 };

// A catalogue page in miniature: a couple of books in product_pod articles, a
// sidebar full of links that are not books, and an optional next link.
function cataloguePage({ books = [], next = null } = {}) {
  const articles = books
    .map(
      (href) =>
        `<article class="product_pod"><h3><a href="${href}" title="t">t</a></h3></article>`,
    )
    .join("");
  const pager = next
    ? `<li class="next"><a href="${next}">next</a></li>`
    : `<li class="current">Page 9 of 9</li>`;
  return `<html><body>
    <aside class="sidebar"><a href="/category/books/fiction_10/index.html">Fiction</a>
    <a href="/index.html">Home</a></aside>
    ${articles}
    <ul class="pager">${pager}</ul>
  </body></html>`;
}

async function startCatalogue(pages) {
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
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "discover-cache-"));
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

test("relative hrefs are resolved against the page they were found on", () => {
  const html = cataloguePage({
    books: ["../book-name/index.html", "other-book_2/index.html"],
  });
  const { bookUrls } = parseCataloguePage(
    html,
    "https://books.toscrape.com/catalogue/page-2.html",
  );

  assert.deepEqual(bookUrls, [
    "https://books.toscrape.com/book-name/index.html",
    "https://books.toscrape.com/catalogue/other-book_2/index.html",
  ]);
  // Gluing strings would have produced ".../catalogue/../book-name/index.html".
  assert.ok(bookUrls.every((u) => !u.includes("..")));
});

test("the selector is aimed at the product area, not every link on the page", () => {
  const html = cataloguePage({ books: ["a_1/index.html"], next: "page-2.html" });
  const { bookUrls } = parseCataloguePage(html, "https://books.toscrape.com/catalogue/page-1.html");

  assert.equal(bookUrls.length, 1, "sidebar, home and pager links are not books");
  assert.match(bookUrls[0], /a_1\/index\.html$/);
});

test("a book link that leaves the host is out of scope, and is counted", () => {
  const html = cataloguePage({
    books: [
      "in-scope_1/index.html",
      "https://somewhere-else.example/x/index.html",
      "//evil.example/protocol-relative/index.html",
    ],
  });
  const { bookUrls, skipped } = parseCataloguePage(
    html,
    "https://books.toscrape.com/catalogue/page-1.html",
  );

  assert.deepEqual(bookUrls, [
    "https://books.toscrape.com/catalogue/in-scope_1/index.html",
  ]);
  assert.equal(skipped, 2, "both off-host links are reported, not silently dropped");
});

test("a next link pointing off-host ends the walk, and says so", () => {
  const html = cataloguePage({
    books: ["a_1/index.html"],
    next: "https://somewhere-else.example/page-2.html",
  });
  const { nextUrl, nextRejected } = parseCataloguePage(
    html,
    "https://books.toscrape.com/catalogue/page-1.html",
  );

  assert.equal(nextUrl, null);
  // Ending the walk is not enough: a truncated crawl that reports nothing looks
  // exactly like a short catalogue.
  assert.equal(nextRejected, true);
});

test("a catalogue that simply ends is not reported as a rejection", () => {
  const { nextUrl, nextRejected } = parseCataloguePage(
    cataloguePage({ books: ["a_1/index.html"] }),
    "https://books.toscrape.com/catalogue/page-50.html",
  );

  assert.equal(nextUrl, null);
  assert.equal(nextRejected, false, "no next link at all is normal, not news");
});

test("a rejected next link is counted by the walk", async () => {
  const server = await startCatalogue({
    "/page-1.html": cataloguePage({
      books: ["b1/index.html"],
      next: "https://elsewhere.example/page-2.html",
    }),
  });

  try {
    const result = await discoverBooks({
      startUrl: `${server.url}/page-1.html`,
      maxPages: 3,
      fetchOptions: { ...FAST, cacheDir: server.cacheDir },
    });

    assert.equal(result.cataloguePages, 1);
    assert.equal(result.nextRejected, 1, "the truncation is in the numbers");
  } finally {
    await server.close();
  }
});

test("scope is the origin, so an http link on an https page is refused", () => {
  const html = cataloguePage({
    books: [
      "same-scheme_1/index.html",
      "http://books.toscrape.com/catalogue/downgraded_2/index.html",
      "javascript:void(0)",
    ],
  });
  const { bookUrls, skipped } = parseCataloguePage(
    html,
    "https://books.toscrape.com/catalogue/page-1.html",
  );

  assert.deepEqual(bookUrls, [
    "https://books.toscrape.com/catalogue/same-scheme_1/index.html",
  ]);
  // Same host, different scheme: comparing host alone would have let the
  // downgrade through.
  assert.equal(skipped, 2);
});

test("links that cannot be used are counted, not quietly dropped", () => {
  // Twenty books with one broken href must not report a healthy-looking 19.
  const html = `<html><body>
    <article class="product_pod"><h3><a href="good_1/index.html">t</a></h3></article>
    <article class="product_pod"><h3><a>no href at all</a></h3></article>
    <article class="product_pod"><h3><a href="">empty</a></h3></article>
    <article class="product_pod"><h3><a href="http://[bad">unparseable</a></h3></article>
  </body></html>`;
  const { bookUrls, skipped } = parseCataloguePage(
    html,
    "https://books.toscrape.com/catalogue/page-1.html",
  );

  assert.equal(bookUrls.length, 1);
  assert.equal(skipped, 3);
});

test("skipped links add up across catalogue pages", async () => {
  const server = await startCatalogue({
    "/page-1.html": cataloguePage({
      books: ["b1/index.html", "https://elsewhere.example/x.html"],
      next: "page-2.html",
    }),
    "/page-2.html": cataloguePage({ books: ["b2/index.html", ""] }),
  });

  try {
    const result = await discoverBooks({
      startUrl: `${server.url}/page-1.html`,
      maxPages: 3,
      fetchOptions: { ...FAST, cacheDir: server.cacheDir },
    });

    assert.equal(result.discovered, 2);
    assert.equal(result.skipped, 2, "one per page, totalled");
    assert.equal(result.uniqueUrls, 2);
  } finally {
    await server.close();
  }
});

test("the next link is followed, and the walk stops at the page limit", async () => {
  const server = await startCatalogue({
    "/page-1.html": cataloguePage({ books: ["b1/index.html"], next: "page-2.html" }),
    "/page-2.html": cataloguePage({ books: ["b2/index.html"], next: "page-3.html" }),
    "/page-3.html": cataloguePage({ books: ["b3/index.html"], next: "page-4.html" }),
    "/page-4.html": cataloguePage({ books: ["b4/index.html"] }),
  });

  try {
    const result = await discoverBooks({
      startUrl: `${server.url}/page-1.html`,
      maxPages: 3,
      fetchOptions: { ...FAST, cacheDir: server.cacheDir },
    });

    assert.equal(result.cataloguePages, 3, "stops after three, even though page 4 exists");
    assert.equal(server.hits, 3, "page 4 is never requested");
    assert.deepEqual(
      result.books.map((b) => b.url),
      [1, 2, 3].map((n) => `${server.url}/b${n}/index.html`),
    );
  } finally {
    await server.close();
  }
});

test("the walk ends early when the catalogue runs out of next links", async () => {
  const server = await startCatalogue({
    "/page-1.html": cataloguePage({ books: ["b1/index.html"], next: "page-2.html" }),
    "/page-2.html": cataloguePage({ books: ["b2/index.html"] }),
  });

  try {
    const result = await discoverBooks({
      startUrl: `${server.url}/page-1.html`,
      maxPages: 3,
      fetchOptions: { ...FAST, cacheDir: server.cacheDir },
    });
    assert.equal(result.cataloguePages, 2);
    assert.equal(result.uniqueUrls, 2);
  } finally {
    await server.close();
  }
});

test("duplicates are counted but only kept once, and the first page wins", async () => {
  const server = await startCatalogue({
    "/page-1.html": cataloguePage({ books: ["same/index.html"], next: "page-2.html" }),
    "/page-2.html": cataloguePage({ books: ["same/index.html", "fresh/index.html"] }),
  });

  try {
    const result = await discoverBooks({
      startUrl: `${server.url}/page-1.html`,
      maxPages: 3,
      fetchOptions: { ...FAST, cacheDir: server.cacheDir },
    });

    assert.equal(result.discovered, 3, "every link seen, duplicates included");
    assert.equal(result.uniqueUrls, 2, "what the next stage works from");
    assert.equal(
      result.books.find((b) => b.url.endsWith("same/index.html")).sourcePage,
      `${server.url}/page-1.html`,
      "provenance points at the page that found it first, so a rerun agrees",
    );
  } finally {
    await server.close();
  }
});

test("a second walk reports the same numbers without touching the network", async () => {
  const pages = {
    "/page-1.html": cataloguePage({ books: ["b1/index.html"], next: "page-2.html" }),
    "/page-2.html": cataloguePage({ books: ["b2/index.html"] }),
  };
  const server = await startCatalogue(pages);

  try {
    const options = {
      startUrl: `${server.url}/page-1.html`,
      maxPages: 3,
      fetchOptions: { ...FAST, cacheDir: server.cacheDir },
    };
    const first = await discoverBooks(options);
    const hitsAfterFirst = server.hits;
    const second = await discoverBooks(options);

    assert.equal(server.hits, hitsAfterFirst, "the second walk is served from cache");
    assert.equal(second.cacheHits, second.cataloguePages);
    assert.deepEqual(
      second.books.map((b) => b.url),
      first.books.map((b) => b.url),
    );
    assert.equal(second.discovered, first.discovered);
  } finally {
    await server.close();
  }
});
