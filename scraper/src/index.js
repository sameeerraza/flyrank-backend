// The polite scraper — W5 · A9
// Entry point only. Config lives in config.js, so requiring settings from another
// module never runs the scraper as a side effect.

const path = require("node:path");
const { TARGET, OUTPUT_DIR } = require("./config");
const { discoverBooks } = require("./discover");
const { collectBooks } = require("./collect");
const { storeRecords } = require("./store");
const { buildReport, writeReport } = require("./report");

// Stage 5's proof, run on demand: `node src/index.js --inject-failure` adds one
// book URL that does not exist. Breaking things on our own side — never by
// pointing the scraper at something real and hoping it fails.
const INJECT_FAILURE = process.argv.includes("--inject-failure");
// Root-relative, so it resolves against the origin rather than against the
// catalogue directory the start URL happens to sit in.
const FAKE_URL = new URL(
  "/catalogue/this-book-does-not-exist_9999/index.html",
  TARGET.startUrl,
).href;

function reportPage({ pageUrl, fromCache, bytes, found, skipped, nextRejected }) {
  // The size and the count, not the HTML. Sixty pages of markup in a terminal
  // helps nobody.
  console.log(`${fromCache ? "CACHE HIT" : "FETCH"}  ${pageUrl}`);
  const note = skipped ? `  ·  ${skipped} link(s) skipped` : "";
  console.log(`  ${bytes} bytes  ·  ${found} books${note}`);
  if (nextRejected) {
    console.log(`  next link pointed out of scope — walk ends here`);
  }
}

function reportBook({ record, fromCache, attempts, index, total }) {
  const counter = String(index).padStart(String(total).length, " ");
  const retried = attempts > 1 ? `  (attempt ${attempts})` : "";
  console.log(
    `  [${counter}/${total}] ${fromCache ? "cache" : "fetch"}  ${record.title ?? "(no title)"}${retried}`,
  );
}

function reportFailure({ failure, index, total }) {
  const counter = String(index).padStart(String(total).length, " ");
  console.log(
    `  [${counter}/${total}] FAILED ${failure.kind}${failure.status ? ` ${failure.status}` : ""}` +
      ` after ${failure.attempts} attempt(s)  ${failure.url}`,
  );
}

async function main() {
  const startedAt = new Date();

  const discovery = await discoverBooks({ onPage: reportPage });

  if (INJECT_FAILURE) {
    // Counted as discovered, so the reconciliation has to account for it — which
    // is the point. A run that swallowed this URL would still print 60 valid
    // records and look perfect.
    discovery.books.push({
      url: FAKE_URL,
      sourcePage: discovery.pages[0] ?? TARGET.startUrl,
    });
    discovery.uniqueUrls += 1;
    discovery.discovered += 1;
    console.log("");
    console.log(`injected one URL that does not exist: ${FAKE_URL}`);
  }

  console.log("");
  console.log(`catalogue_pages=${discovery.cataloguePages}`);
  console.log(`discovered=${discovery.discovered}`);
  console.log(`unique_urls=${discovery.uniqueUrls}`);
  console.log(`skipped_links=${discovery.skipped}`);
  console.log(`next_rejected=${discovery.nextRejected}`);
  console.log("");

  const collection = await collectBooks({
    books: discovery.books,
    onBook: reportBook,
    onFailure: reportFailure,
  });

  const missingDescriptions = collection.records.filter(
    (r) => r.description === null,
  ).length;

  console.log("");
  console.log(`detail_pages=${collection.records.length}`);
  console.log(`failed_pages=${collection.failures.length}`);
  console.log(`null_descriptions=${missingDescriptions}`);
  console.log(`cache_hits=${collection.cacheHits}/${discovery.books.length}`);

  const storage = await storeRecords(collection.records, { outputDir: OUTPUT_DIR });

  console.log("");
  console.log("sample record:");
  console.log(JSON.stringify(storage.valid[0], null, 2));

  if (storage.invalid.length > 0) {
    console.log("");
    console.log("rejected:");
    for (const entry of storage.invalid.slice(0, 5)) {
      console.log(`  ${entry.product_url}`);
      for (const reason of entry.reasons) console.log(`    ${reason}`);
    }
  }

  const finishedAt = new Date();
  const report = buildReport({ startedAt, finishedAt, discovery, collection, storage });
  const reportPath = await writeReport(report, { outputDir: OUTPUT_DIR });

  const rel = (p) => path.relative(process.cwd(), p);

  console.log("");
  console.log(`valid_records=${report.valid_records}`);
  console.log(`invalid_records=${report.invalid_records}`);
  console.log(`duplicates_dropped=${report.duplicates_dropped}`);
  console.log(`failed_pages=${report.failed_pages}`);
  console.log(
    `reconciled=${report.reconciled}  (${report.valid_records} valid + ${report.invalid_records} invalid` +
      ` + ${report.duplicates_dropped} duplicate + ${report.failed_pages} failed` +
      ` = ${report.valid_records + report.invalid_records + report.duplicates_dropped + report.failed_pages}` +
      ` of ${report.unique_urls} discovered)`,
  );
  if (!report.reconciled) {
    console.error(`WARNING: ${report.unaccounted_for} discovered URL(s) are unaccounted for`);
  }

  console.log(
    `stored → ${rel(storage.booksPath)}  ·  ${rel(storage.errorsPath)}  ·  ${rel(reportPath)}`,
  );
}

main().catch((err) => {
  console.error(`failed: ${err.message}`);
  process.exit(1);
});
