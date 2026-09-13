// Stage 3 — open every discovered book page and turn it into a raw record.
//
// The two halves stay apart on purpose: fetcher.js knows about the network,
// extract.js knows about HTML, and this file is the only place that puts them
// together. Stage 5 hangs its error handling here, where a download failure and
// a parse failure are already distinguishable.

const { fetchWithCache } = require("./fetcher");
const { extractBook } = require("./extract");

async function collectBooks({ books, fetchOptions, onBook } = {}) {
  const records = [];
  let cacheHits = 0;

  for (const [index, { url, sourcePage }] of books.entries()) {
    const { html, fromCache, fetchedAt } = await fetchWithCache(url, fetchOptions);
    if (fromCache) cacheHits += 1;

    // fetchedAt is the cache file's timestamp, so a record built today from a
    // page saved yesterday says yesterday. The receipt has to be true or it is
    // not a receipt.
    const record = extractBook(html, { url, sourcePage, fetchedAt });
    records.push(record);

    onBook?.({ record, fromCache, index: index + 1, total: books.length });
  }

  return { records, cacheHits };
}

module.exports = { collectBooks };
