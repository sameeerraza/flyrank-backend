// Stage 3 — the parser, checked entirely on fixtures.
//
// extractBook takes HTML and returns a record, so none of this needs a server at
// all. That is the whole reason the fetch and the parse were kept apart.

const test = require("node:test");
const assert = require("node:assert/strict");

const { extractBook, ExtractError } = require("../src/extract");

const PROVENANCE = {
  url: "https://books.toscrape.com/catalogue/a-light_1000/index.html",
  sourcePage: "https://books.toscrape.com/catalogue/page-1.html",
  fetchedAt: "2026-09-13T10:00:00.000Z",
};

// A book page in miniature. Everything outside <article class="product_page"> is
// there to be ignored: a sidebar with its own heading and price, and a
// recommendations strip — the "second price on the page" that a loose selector
// would happily grab.
function bookPage({
  title = "A Light in the Attic",
  price = "£51.77",
  availability = "\n\n    In stock (22 available)\n\n",
  ratingClass = "star-rating Three",
  description = "It's hard to imagine a world without it.",
  omitDescriptionHeader = false,
  omitArticle = false,
} = {}) {
  const descriptionBlock = omitDescriptionHeader
    ? ""
    : `<div id="product_description" class="sub-header"><h2>Product Description</h2></div>
       ${description === null ? "" : `<p>${description}</p>`}`;

  const article = `
    <article class="product_page">
      <div class="product_main">
        <h1>${title}</h1>
        <p class="price_color">${price}</p>
        <p class="instock availability">${availability}</p>
        <p class="${ratingClass}"></p>
      </div>
      ${descriptionBlock}
      <table class="table"><tr><th>UPC</th><td>abc123</td></tr></table>
    </article>`;

  return `<html><body>
    <aside class="sidebar"><h1>Category heading</h1><p class="price_color">£99.99</p></aside>
    ${omitArticle ? "" : article}
    <section class="recommendations"><h1>You might also like</h1>
      <p class="price_color">£1.00</p></section>
  </body></html>`;
}

test("a complete page yields all eight keys", () => {
  const record = extractBook(bookPage(), PROVENANCE);

  assert.deepEqual(Object.keys(record), [
    "title",
    "product_url",
    "price_text",
    "availability_text",
    "rating_text",
    "description",
    "source_page",
    "fetched_at",
  ]);
  assert.equal(record.title, "A Light in the Attic");
  assert.equal(record.price_text, "£51.77");
  assert.equal(record.rating_text, "Three");
});

test("markup indentation is not part of the availability value", () => {
  const record = extractBook(bookPage(), PROVENANCE);
  assert.equal(record.availability_text, "In stock (22 available)");
});

test("a book with no description gets null, not an empty string", () => {
  const record = extractBook(bookPage({ description: null }), PROVENANCE);

  assert.equal(record.description, null);
  // The key still has to be there, or the record shape changes per book.
  assert.ok("description" in record);
  assert.equal(Object.keys(record).length, 8);
});

test("a description paragraph of pure whitespace is also null", () => {
  const record = extractBook(bookPage({ description: "   \n  " }), PROVENANCE);
  assert.equal(record.description, null);
});

test("a page with no description section at all is null, not an error", () => {
  const record = extractBook(bookPage({ omitDescriptionHeader: true }), PROVENANCE);
  assert.equal(record.description, null);
  assert.equal(record.title, "A Light in the Attic");
});

test("the rating is read from the class name", () => {
  for (const word of ["One", "Two", "Three", "Four", "Five"]) {
    const record = extractBook(
      bookPage({ ratingClass: `star-rating ${word}` }),
      PROVENANCE,
    );
    assert.equal(record.rating_text, word);
  }
});

test("a class that is not a rating does not become a rating", () => {
  const record = extractBook(
    bookPage({ ratingClass: "star-rating disabled" }),
    PROVENANCE,
  );
  assert.equal(record.rating_text, null, "'disabled' is not a rating");
});

test("selectors stay inside the product area", () => {
  // The sidebar and the recommendations strip both carry an h1 and a price.
  const record = extractBook(bookPage(), PROVENANCE);

  assert.equal(record.title, "A Light in the Attic", "not the sidebar heading");
  assert.equal(record.price_text, "£51.77", "not the £99.99 or the £1.00");
});

test("provenance is carried through exactly as given", () => {
  const record = extractBook(bookPage(), PROVENANCE);

  assert.equal(record.product_url, PROVENANCE.url);
  assert.equal(record.source_page, PROVENANCE.sourcePage);
  assert.equal(record.fetched_at, PROVENANCE.fetchedAt);
});

test("a page that is not a book page is a failure, not a record of nulls", () => {
  assert.throws(
    () => extractBook(bookPage({ omitArticle: true }), PROVENANCE),
    (err) =>
      err instanceof ExtractError &&
      err.url === PROVENANCE.url &&
      // Stage 5 counts download failures and parse failures separately, and
      // reads one field to do it.
      err.kind === "parse",
  );
});

test("a missing field inside a real product page is null, not invented", () => {
  const html = `<html><body><article class="product_page">
    <div class="product_main"><h1>Only a title</h1></div>
  </article></body></html>`;
  const record = extractBook(html, PROVENANCE);

  assert.equal(record.title, "Only a title");
  assert.equal(record.price_text, null);
  assert.equal(record.availability_text, null);
  assert.equal(record.rating_text, null);
  assert.equal(Object.keys(record).length, 8);
});
