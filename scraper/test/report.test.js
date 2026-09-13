// Stage 5 — the run report, and the arithmetic that makes it checkable.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { buildReport, writeReport, countByKind } = require("../src/report");

function inputs({ failures = [], valid = 60, invalid = 0, duplicates = 0, discovered = 60 } = {}) {
  return {
    startedAt: new Date("2026-09-13T10:00:00.000Z"),
    finishedAt: new Date("2026-09-13T10:00:45.000Z"),
    discovery: {
      cataloguePages: 3,
      discovered,
      uniqueUrls: discovered,
      skipped: 0,
      nextRejected: 0,
      cacheHits: 3,
    },
    collection: { failures, cacheHits: 57, networkRequests: 4 },
    storage: {
      valid: Array.from({ length: valid }, (_, i) => ({ id: i })),
      invalid: Array.from({ length: invalid }, (_, i) => ({ id: i })),
      duplicates,
    },
  };
}

test("the report carries what the brief asks for", () => {
  const report = buildReport(inputs());

  assert.equal(report.started_at, "2026-09-13T10:00:00.000Z");
  assert.equal(report.duration_ms, 45_000);
  assert.equal(report.cache_hits, 60);
  assert.equal(report.valid_records, 60);
  assert.equal(report.invalid_records, 0);
  assert.equal(report.failed_pages, 0);
});

test("requests_sent counts what actually left the machine", () => {
  // 3 catalogue pages, all cached → 0 there; 4 detail requests including retries.
  const report = buildReport(inputs());
  assert.equal(report.requests_sent, 4);
});

test("a failed page is the last term of the reconciliation", () => {
  const report = buildReport({
    ...inputs({ discovered: 61, valid: 60 }),
    collection: {
      failures: [{ url: "https://books.toscrape.com/x", kind: "http", status: 404 }],
      cacheHits: 57,
      networkRequests: 4,
    },
  });

  // 61 discovered = 60 valid + 0 invalid + 0 duplicate + 1 failed.
  assert.equal(report.unique_urls, 61);
  assert.equal(report.failed_pages, 1);
  assert.equal(report.reconciled, true);
  assert.equal(report.unaccounted_for, 0);
});

test("a record that vanished is visible even though every count looks sane", () => {
  // 61 discovered, 59 stored, 1 failed — one page went missing quietly.
  const report = buildReport({
    ...inputs({ discovered: 61, valid: 59 }),
    collection: {
      failures: [{ url: "https://books.toscrape.com/x", kind: "http", status: 404 }],
      cacheHits: 57,
      networkRequests: 4,
    },
  });

  assert.equal(report.reconciled, false);
  assert.equal(report.unaccounted_for, 1);
});

test("failures are grouped by kind", () => {
  assert.deepEqual(
    countByKind([
      { kind: "http" },
      { kind: "http" },
      { kind: "timeout" },
      { kind: "parse" },
    ]),
    { http: 2, timeout: 1, parse: 1 },
  );
});

test("the report names which page failed, not just how many", () => {
  const failure = {
    url: "https://books.toscrape.com/catalogue/nope_9999/index.html",
    kind: "http",
    status: 404,
    attempts: 1,
    reason: "HTTP 404 Not Found",
  };
  const report = buildReport({
    ...inputs({ discovered: 61 }),
    collection: { failures: [failure], cacheHits: 57, networkRequests: 4 },
  });

  // "one page broke" without saying which is barely better than silence.
  assert.equal(report.failures[0].url, failure.url);
  assert.equal(report.failures[0].status, 404);
});

test("the report is written to disk as run-report.json", async () => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "report-out-"));
  try {
    const reportPath = await writeReport(buildReport(inputs()), { outputDir });
    assert.equal(path.basename(reportPath), "run-report.json");

    const written = JSON.parse(await fs.readFile(reportPath, "utf8"));
    assert.equal(written.valid_records, 60);
  } finally {
    await fs.rm(outputDir, { recursive: true, force: true });
  }
});
