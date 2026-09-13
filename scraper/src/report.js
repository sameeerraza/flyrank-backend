// Stage 5 — the run report.
//
// A scraper that reports nothing can fail silently for weeks. This is the file
// that makes a run answer for itself: what it found, what it stored, what broke,
// and whether those three add up.

const fs = require("node:fs/promises");
const path = require("node:path");

const { reconcile } = require("./store");
const { serialize } = require("./store");

function countByKind(failures) {
  const counts = {};
  for (const failure of failures) {
    counts[failure.kind] = (counts[failure.kind] ?? 0) + 1;
  }
  return counts;
}

function buildReport({ startedAt, finishedAt, discovery, collection, storage }) {
  const failedPages = collection.failures.length;

  // The self-check. Every URL the crawl found has to end up somewhere nameable:
  // stored, rejected with a reason, dropped as a duplicate, or failed outright.
  // failed was the last missing term — with it, the report can be checked against
  // itself rather than taken on trust.
  const check = reconcile({
    discovered: discovery.uniqueUrls,
    valid: storage.valid.length,
    invalid: storage.invalid.length,
    duplicates: storage.duplicates,
    failed: failedPages,
  });

  return {
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: finishedAt.getTime() - startedAt.getTime(),

    catalogue_pages: discovery.cataloguePages,
    discovered: discovery.discovered,
    unique_urls: discovery.uniqueUrls,
    skipped_links: discovery.skipped,
    next_rejected: discovery.nextRejected,

    // What the site's logs would show: every request that actually left this
    // machine, retries and failed pages included. Cache reads cost it nothing and
    // are counted separately.
    requests_sent:
      discovery.cataloguePages - discovery.cacheHits + collection.networkRequests,
    cache_hits: discovery.cacheHits + collection.cacheHits,
    pages_stored: storage.valid.length,

    valid_records: storage.valid.length,
    invalid_records: storage.invalid.length,
    duplicates_dropped: storage.duplicates,
    failed_pages: failedPages,
    failures_by_kind: countByKind(collection.failures),

    reconciled: check.reconciled,
    unaccounted_for: check.missing,

    failures: collection.failures,
  };
}

async function writeReport(report, { outputDir }) {
  await fs.mkdir(outputDir, { recursive: true });
  const reportPath = path.join(outputDir, "run-report.json");
  await fs.writeFile(reportPath, serialize(report), "utf8");
  return reportPath;
}

module.exports = { buildReport, writeReport, countByKind };
