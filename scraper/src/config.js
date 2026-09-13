// Shared settings. This file has no side effects, so any module can require it
// without accidentally running the scraper.

const path = require("node:path");

const TARGET = {
  name: "Books to Scrape",
  startUrl: "https://books.toscrape.com/catalogue/page-1.html",
  cataloguePages: 3,
  userAgent:
    "FlyRankInternship-A9/1.0 (+https://github.com/sameeerraza/flyrank-backend)",
  timeoutMs: 10000,
  delayMs: 500,
};

// Resolved against the project, not the shell's cwd, so the scraper behaves the
// same whether it is run from scraper/ or from the repo root.
const CACHE_DIR = path.resolve(__dirname, "..", "cache");
const OUTPUT_DIR = path.resolve(__dirname, "..", "output");

module.exports = { TARGET, CACHE_DIR, OUTPUT_DIR };
