// Stage 4 — identity and the raw → clean conversions. Pure functions, no server.

const test = require("node:test");
const assert = require("node:assert/strict");

const { canonicalize } = require("../src/canonical");
const { priceToNumber, cleanDescription } = require("../src/normalize");

test("a price becomes a real number", () => {
  assert.equal(priceToNumber("£51.77"), 51.77);
  assert.equal(priceToNumber("  £51.77  "), 51.77);
  assert.equal(priceToNumber("£0.00"), 0);
  assert.equal(priceToNumber("£9"), 9);
});

test("a price with anything extra is refused, not half-read", () => {
  // parseFloat("51.77abc") returns 51.77 and says nothing. This is the case the
  // regex exists for: a partial read is worse than a refusal, because it looks
  // like a price.
  assert.equal(priceToNumber("£51.77abc"), null);
  assert.equal(priceToNumber("£51.77 (was £60.00)"), null);
  assert.equal(priceToNumber("from £51.77"), null);
});

test("a price with no currency symbol is refused", () => {
  assert.equal(priceToNumber("51.77"), null);
});

test("a price in another currency never becomes price_gbp", () => {
  // Copying the number out of "$51.77" into a field named price_gbp would be a
  // silent currency error — the worst kind, because the value looks right.
  assert.equal(priceToNumber("$51.77"), null);
  assert.equal(priceToNumber("€51.77"), null);
});

test("empty and non-string prices are null, never NaN", () => {
  for (const input of ["", "   ", null, undefined, 51.77, {}]) {
    const result = priceToNumber(input);
    assert.equal(result, null, `${JSON.stringify(input)} should be null`);
    // parseFloat("") is NaN, and typeof NaN is "number" — a downstream "is it a
    // number?" check would pass on it.
    assert.ok(!Number.isNaN(result));
  }
});

test("a thousands separator is refused rather than guessed at", () => {
  // £1,234.56 parsed loosely becomes 1 — off by three orders of magnitude and
  // still a perfectly valid-looking number.
  assert.equal(priceToNumber("£1,234.56"), null);
});

test("the ...more suffix is stripped, and nothing else is", () => {
  assert.equal(cleanDescription("Some prose. ...more"), "Some prose.");
  assert.equal(cleanDescription("Some prose."), "Some prose.");
  assert.equal(cleanDescription("Ends in more. And more"), "Ends in more. And more");
});

test("a description that is only a suffix ends up null", () => {
  assert.equal(cleanDescription("...more"), null);
  assert.equal(cleanDescription(null), null);
  assert.equal(cleanDescription(undefined), null);
});

test("the repeated teaser is left alone", () => {
  // Removing it needs a heuristic, and a wrong heuristic cuts real prose.
  const doubled = "It's hard to imagine a wor It's hard to imagine a world without. ...more";
  assert.equal(
    cleanDescription(doubled),
    "It's hard to imagine a wor It's hard to imagine a world without.",
  );
});

test("a fragment is not part of a book's identity", () => {
  assert.equal(
    canonicalize("https://books.toscrape.com/catalogue/a_1/index.html#reviews"),
    canonicalize("https://books.toscrape.com/catalogue/a_1/index.html"),
  );
});

test("host case and default ports are normalised by the parser", () => {
  assert.equal(
    canonicalize("https://BOOKS.toscrape.com:443/catalogue/a_1/index.html"),
    "https://books.toscrape.com/catalogue/a_1/index.html",
  );
});

test("a trailing slash is left alone, because servers may mean it", () => {
  assert.notEqual(
    canonicalize("https://books.toscrape.com/a"),
    canonicalize("https://books.toscrape.com/a/"),
  );
});

test("an unusable url gets no identity at all", () => {
  for (const input of ["", "   ", "not a url", null, undefined, 7]) {
    assert.equal(canonicalize(input), null);
  }
});
