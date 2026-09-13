// The polite scraper — W5 · A9
// Entry point only. Config lives in config.js, so requiring settings from another
// module never runs the scraper as a side effect.

const { discoverBooks } = require("./discover");

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

async function main() {
  const { cataloguePages, discovered, skipped, nextRejected, uniqueUrls, cacheHits } =
    await discoverBooks({ onPage: reportPage });

  console.log("");
  console.log(`catalogue_pages=${cataloguePages}`);
  console.log(`discovered=${discovered}`);
  console.log(`unique_urls=${uniqueUrls}`);
  console.log(`skipped_links=${skipped}`);
  console.log(`next_rejected=${nextRejected}`);
  console.log(`cache_hits=${cacheHits}/${cataloguePages}`);
}

main().catch((err) => {
  console.error(`failed: ${err.message}`);
  process.exit(1);
});
