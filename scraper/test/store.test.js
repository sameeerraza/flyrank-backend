// Stage 4 — validate before storing, and store the same thing twice.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { storeRecords, validateRecords, serialize, reconcile } = require("../src/store");

// A raw record as Stage 3 produces it: no price_gbp, no description_clean yet.
function rawRecord(overrides = {}) {
  return {
    title: "A Light in the Attic",
    product_url: "https://books.toscrape.com/catalogue/a-light_1000/index.html",
    price_text: "£51.77",
    availability_text: "In stock (22 available)",
    rating_text: "Three",
    description: "Prose. ...more",
    source_page: "https://books.toscrape.com/catalogue/page-1.html",
    fetched_at: "2026-09-13T10:00:00.000Z",
    ...overrides,
  };
}

async function tmpOutput() {
  return fs.mkdtemp(path.join(os.tmpdir(), "store-out-"));
}

test("a good record is normalised and kept", () => {
  const { valid, invalid } = validateRecords([rawRecord()]);

  assert.equal(invalid.length, 0);
  assert.equal(valid.length, 1);
  assert.equal(valid[0].price_gbp, 51.77);
  assert.equal(valid[0].price_text, "£51.77", "the raw value survives alongside it");
  assert.equal(valid[0].description_clean, "Prose.");
  assert.equal(valid[0].description, "Prose. ...more", "raw description untouched");
});

test("an unreadable price fails the schema with a reason", () => {
  const { valid, invalid } = validateRecords([
    rawRecord({ price_text: "£51.77 (was £60)" }),
  ]);

  assert.equal(valid.length, 0);
  assert.equal(invalid.length, 1);
  assert.match(invalid[0].reasons.join(" "), /price_gbp/);
  assert.equal(invalid[0].product_url, rawRecord().product_url);
});

test("a record that fails never reaches the valid set", () => {
  const { valid, invalid } = validateRecords([
    rawRecord(),
    rawRecord({ product_url: "https://books.toscrape.com/b_2/index.html", title: "" }),
    rawRecord({ product_url: "https://books.toscrape.com/b_3/index.html" }),
  ]);

  assert.equal(valid.length, 2);
  assert.equal(invalid.length, 1);
  assert.ok(valid.every((r) => r.title !== ""));
});

test("a non-https identity is refused", () => {
  const { invalid } = validateRecords([
    rawRecord({ product_url: "http://books.toscrape.com/catalogue/a_1/index.html" }),
  ]);

  assert.equal(invalid.length, 1);
  assert.match(invalid[0].reasons.join(" "), /product_url/);
});

test("the schema refuses an off-scope url even though discovery already would", () => {
  // Defence in depth: the schema is the last gate before a record is written, so
  // it does not rely on the crawl having been careful.
  const { valid, invalid } = validateRecords([
    rawRecord({ product_url: "https://somewhere-else.example/x/index.html" }),
  ]);

  assert.equal(valid.length, 0);
  assert.match(invalid[0].reasons.join(" "), /product_url/);
  assert.match(invalid[0].reasons.join(" "), /books\.toscrape\.com/);
});

test("provenance is held to the same scope as the identity", () => {
  const { invalid } = validateRecords([
    rawRecord({ source_page: "https://somewhere-else.example/page-1.html" }),
  ]);

  assert.equal(invalid.length, 1);
  assert.match(invalid[0].reasons.join(" "), /source_page/);
});

test("an unparseable rating fails the whole record rather than storing it short", () => {
  // extract.js yields null when the star-rating class is not one of the five
  // words, which means the page changed shape. Deliberately not nullable.
  const { valid, invalid } = validateRecords([rawRecord({ rating_text: "disabled" })]);

  assert.equal(valid.length, 0);
  assert.match(invalid[0].reasons.join(" "), /rating_text/);
});

test("a rating outside the five words is refused", () => {
  const { invalid } = validateRecords([rawRecord({ rating_text: null })]);
  assert.equal(invalid.length, 1);
  assert.match(invalid[0].reasons.join(" "), /rating_text/);
});

test("a missing description is allowed, and stays null on both fields", () => {
  const { valid, invalid } = validateRecords([rawRecord({ description: null })]);

  assert.equal(invalid.length, 0);
  assert.equal(valid[0].description, null);
  assert.equal(valid[0].description_clean, null);
});

test("the same book twice counts once", () => {
  const url = "https://books.toscrape.com/catalogue/a_1/index.html";
  const { valid, duplicates } = validateRecords([
    rawRecord({ product_url: url }),
    rawRecord({ product_url: `${url}#reviews` }),
  ]);

  // Identity is the canonical URL, so the fragment does not make a second book.
  assert.equal(valid.length, 1);
  assert.equal(duplicates, 1);
});

test("books.json holds only valid records and errors.json holds the reasons", async () => {
  const outputDir = await tmpOutput();
  try {
    const badUrl = "https://books.toscrape.com/catalogue/b_2/index.html";
    await storeRecords(
      [rawRecord(), rawRecord({ product_url: badUrl, price_text: "free" })],
      { outputDir },
    );

    const books = JSON.parse(await fs.readFile(path.join(outputDir, "books.json"), "utf8"));
    const errors = JSON.parse(await fs.readFile(path.join(outputDir, "errors.json"), "utf8"));

    assert.equal(books.length, 1);
    assert.equal(errors.length, 1);
    assert.match(errors[0].reasons.join(" "), /price_gbp/);
    assert.ok(!books.some((b) => b.product_url === badUrl));
  } finally {
    await fs.rm(outputDir, { recursive: true, force: true });
  }
});

test("errors.json is written even when nothing failed", async () => {
  const outputDir = await tmpOutput();
  try {
    await storeRecords([rawRecord()], { outputDir });
    const errors = await fs.readFile(path.join(outputDir, "errors.json"), "utf8");
    // An empty array says "nothing failed". A missing file only says nobody looked.
    assert.equal(JSON.parse(errors).length, 0);
  } finally {
    await fs.rm(outputDir, { recursive: true, force: true });
  }
});

test("storing the same records twice produces a byte-identical file", async () => {
  const outputDir = await tmpOutput();
  try {
    const records = [
      rawRecord(),
      rawRecord({ product_url: "https://books.toscrape.com/catalogue/b_2/index.html" }),
    ];

    await storeRecords(records, { outputDir });
    const first = await fs.readFile(path.join(outputDir, "books.json"), "utf8");
    await storeRecords(records, { outputDir });
    const second = await fs.readFile(path.join(outputDir, "books.json"), "utf8");

    // Not "both have 2 records" — the same bytes. A count that matches can still
    // hide a timestamp that moved.
    assert.equal(second, first);
    assert.equal(JSON.parse(second).length, 2);
  } finally {
    await fs.rm(outputDir, { recursive: true, force: true });
  }
});

test("the serialised file ends in a newline", () => {
  assert.ok(serialize([]).endsWith("\n"));
});

test("every discovered url is accounted for, or the run says so", () => {
  assert.equal(
    reconcile({ discovered: 60, valid: 60, invalid: 0, duplicates: 0 }).reconciled,
    true,
  );
  assert.equal(
    reconcile({ discovered: 60, valid: 58, invalid: 1, duplicates: 1 }).reconciled,
    true,
  );

  // The case the check exists for: two records went missing between the crawl
  // and the file, and no individual count looks wrong.
  const gap = reconcile({ discovered: 60, valid: 57, invalid: 1, duplicates: 0 });
  assert.equal(gap.reconciled, false);
  assert.equal(gap.missing, 2);
});

test("failed pages count towards the reconciliation", () => {
  // Stage 5 supplies this term; the arithmetic is already in place for it.
  const check = reconcile({
    discovered: 60,
    valid: 59,
    invalid: 0,
    duplicates: 0,
    failed: 1,
  });
  assert.equal(check.reconciled, true);
  assert.equal(check.accountedFor, 60);
});
