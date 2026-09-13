// The polite scraper — W5 · A9
// Stage 0: the target is classified (see README.md); nothing is fetched yet.

// Every real request this project makes will carry these. Stage 1 is where they
// start being used.
const TARGET = {
  name: "Books to Scrape",
  startUrl: "https://books.toscrape.com/catalogue/page-1.html",
  cataloguePages: 3,
  userAgent:
    "FlyRankInternship-A9/1.0 (+https://github.com/sameeerraza/flyrank-backend)",
  timeoutMs: 10000,
  delayMs: 500,
  cacheDir: "cache",
  outputDir: "output",
};

function main() {
  console.log(`target: ${TARGET.name} (${TARGET.startUrl})`);
  console.log(`scope: first ${TARGET.cataloguePages} catalogue pages`);
  console.log(`user-agent: ${TARGET.userAgent}`);
  console.log(`politeness: ${TARGET.delayMs}ms delay, ${TARGET.timeoutMs}ms timeout`);
  console.log("robots.txt: no robots file found (404) — see README.md");
  console.log("stage 0 complete — no requests made. Stage 1 adds fetch + cache.");
}

main();

module.exports = { TARGET };
