// The polite scraper — W5 · A9
// Entry point only. Config lives in config.js, so requiring settings from another
// module never runs the scraper as a side effect.

const path = require("node:path");
const { OUTPUT_DIR } = require("./config");
const { discoverBooks } = require("./discover");
const { collectBooks } = require("./collect");
const { storeRecords, reconcile } = require("./store");

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

function reportBook({ record, fromCache, index, total }) {
  const counter = String(index).padStart(String(total).length, " ");
  const tag = fromCache ? "cache" : "fetch";
  console.log(`  [${counter}/${total}] ${tag}  ${record.title ?? "(no title)"}`);
}

async function main() {
  const discovery = await discoverBooks({ onPage: reportPage });

  console.log("");
  console.log(`catalogue_pages=${discovery.cataloguePages}`);
  console.log(`discovered=${discovery.discovered}`);
  console.log(`unique_urls=${discovery.uniqueUrls}`);
  console.log(`skipped_links=${discovery.skipped}`);
  console.log(`next_rejected=${discovery.nextRejected}`);
  console.log("");

  const { records, cacheHits } = await collectBooks({
    books: discovery.books,
    onBook: reportBook,
  });

  const missingDescriptions = records.filter((r) => r.description === null).length;

  console.log("");
  console.log(`detail_pages=${records.length}`);
  console.log(`null_descriptions=${missingDescriptions}`);
  console.log(`cache_hits=${cacheHits}/${records.length}`);

  const { valid, invalid, duplicates, booksPath, errorsPath } =
    await storeRecords(records, { outputDir: OUTPUT_DIR });

  console.log("");
  console.log("sample record:");
  console.log(JSON.stringify(valid[0], null, 2));

  if (invalid.length > 0) {
    console.log("");
    console.log("rejected:");
    for (const entry of invalid.slice(0, 5)) {
      console.log(`  ${entry.product_url}`);
      for (const reason of entry.reasons) console.log(`    ${reason}`);
    }
  }

  const rel = (p) => path.relative(process.cwd(), p);

  console.log("");
  console.log(`valid_records=${valid.length}`);
  console.log(`invalid_records=${invalid.length}`);
  console.log(`duplicates_dropped=${duplicates}`);

  // A report that is only a list of counts cannot tell you when one of them is
  // wrong. This one checks itself.
  const check = reconcile({
    discovered: discovery.uniqueUrls,
    valid: valid.length,
    invalid: invalid.length,
    duplicates,
  });
  console.log(
    `reconciled=${check.reconciled}  (${valid.length} valid + ${invalid.length} invalid` +
      ` + ${duplicates} duplicate = ${check.accountedFor} of ${check.discovered} discovered)`,
  );
  if (!check.reconciled) {
    console.error(`WARNING: ${check.missing} discovered URL(s) are unaccounted for`);
  }

  console.log(`stored → ${rel(booksPath)}  ·  ${rel(errorsPath)}`);
}

main().catch((err) => {
  console.error(`failed: ${err.message}`);
  process.exit(1);
});
