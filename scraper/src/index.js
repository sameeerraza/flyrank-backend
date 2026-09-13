// The polite scraper — W5 · A9
// Entry point only. Config lives in config.js, so requiring settings from another
// module never runs the scraper as a side effect.

const path = require("node:path");
const { TARGET } = require("./config");
const { fetchWithCache } = require("./fetcher");

async function main() {
  const { fromCache, bytes, cachePath } = await fetchWithCache(TARGET.startUrl);

  // The size, not the HTML. Sixty pages of markup in a terminal helps nobody.
  console.log(`${fromCache ? "CACHE HIT" : "FETCH"}  ${TARGET.startUrl}`);
  console.log(`  ${bytes} bytes  →  ${path.relative(process.cwd(), cachePath)}`);
}

main().catch((err) => {
  console.error(`failed: ${err.message}`);
  process.exit(1);
});
