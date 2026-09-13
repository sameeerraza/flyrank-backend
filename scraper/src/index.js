// The polite scraper — W5 · A9
// Entry point only. Config lives in config.js, so requiring settings from another
// module never runs the scraper as a side effect.

const { discoverBooks } = require("./discover");
const { collectBooks } = require("./collect");

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

  console.log("");
  console.log("sample record:");
  console.log(JSON.stringify(records[0], null, 2));

  // A record whose optional field is absent is the one worth showing: it proves
  // all eight keys are present with an honest null rather than being dropped.
  const withoutDescription = records.find((r) => r.description === null);
  if (withoutDescription) {
    console.log("");
    console.log("sample record with no description:");
    console.log(JSON.stringify(withoutDescription, null, 2));
  }

  const missingDescriptions = records.filter((r) => r.description === null).length;

  console.log("");
  console.log(`detail_pages=${records.length}`);
  console.log(`null_descriptions=${missingDescriptions}`);
  console.log(`cache_hits=${cacheHits}/${records.length}`);
}

main().catch((err) => {
  console.error(`failed: ${err.message}`);
  process.exit(1);
});
