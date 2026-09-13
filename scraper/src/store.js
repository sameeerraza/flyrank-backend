// Stage 4 — validate, then store.
//
// The order matters and is the whole point: nothing reaches books.json that has
// not passed the schema first. A record that fails goes to errors.json together
// with the reason it failed, so a bad page is visible rather than missing.

const fs = require("node:fs/promises");
const path = require("node:path");

const { canonicalize } = require("./canonical");
const { normalizeRecord } = require("./normalize");
const { bookRecord, describeIssues } = require("./schema");

// Stable on purpose. Records keep discovery order, fetched_at comes from the
// cache file rather than the clock, and the JSON is written the same way every
// time — so a rerun produces a byte-identical file and "diff the two outputs"
// is a real test of idempotency rather than a count that happens to match.
function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function validateRecords(rawRecords) {
  const valid = [];
  const invalid = [];
  const seen = new Map();
  let duplicates = 0;

  for (const raw of rawRecords) {
    const candidate = normalizeRecord(raw);
    const result = bookRecord.safeParse(candidate);

    if (!result.success) {
      invalid.push({
        product_url: candidate.product_url ?? null,
        source_page: candidate.source_page ?? null,
        reasons: describeIssues(result.error),
      });
      continue;
    }

    // Identity is the canonical URL, using the same function discovery dedupes
    // with. A book that appears twice counts once.
    const identity = canonicalize(result.data.product_url);
    if (seen.has(identity)) {
      duplicates += 1;
      continue;
    }
    seen.set(identity, true);
    valid.push(result.data);
  }

  return { valid, invalid, duplicates };
}

async function storeRecords(rawRecords, { outputDir }) {
  const { valid, invalid, duplicates } = validateRecords(rawRecords);

  await fs.mkdir(outputDir, { recursive: true });
  const booksPath = path.join(outputDir, "books.json");
  const errorsPath = path.join(outputDir, "errors.json");

  await fs.writeFile(booksPath, serialize(valid), "utf8");
  // Written even when empty. An empty array is a statement that nothing failed;
  // a missing file only means nobody looked.
  await fs.writeFile(errorsPath, serialize(invalid), "utf8");

  return { valid, invalid, duplicates, booksPath, errorsPath };
}

// Every URL discovered has to end up somewhere nameable: stored, rejected with a
// reason, dropped as a duplicate, or failed outright. If the four do not add up
// to what the crawl found, a record went missing between the crawl and the file
// and nothing else in the report would say so.
//
// failed is 0 until Stage 5, which is the only term still missing.
function reconcile({ discovered, valid, invalid, duplicates, failed = 0 }) {
  const accountedFor = valid + invalid + duplicates + failed;
  return {
    discovered,
    accountedFor,
    missing: discovered - accountedFor,
    reconciled: accountedFor === discovered,
  };
}

module.exports = { storeRecords, validateRecords, serialize, reconcile };
