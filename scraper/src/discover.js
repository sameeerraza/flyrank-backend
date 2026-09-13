// Stage 2 — walk the catalogue and collect every book link.
//
// A crawler finds the shelves; an extractor reads the labels. This file only
// finds shelves: it never opens a book page.

const cheerio = require("cheerio");
const { TARGET } = require("./config");
const { canonicalize } = require("./canonical");
const { fetchWithCache } = require("./fetcher");

// Aimed at the product area, not the whole document. The catalogue page carries
// 94 links; only 20 of them are books. "Every <a> on the page" would sweep up the
// category sidebar and the pager and look like it worked.
const BOOK_LINK = "article.product_pod h3 a";
const NEXT_LINK = "li.next a";

// Relative hrefs ("../book-name/index.html") are resolved against the page they
// were found on, by the URL parser. Gluing strings together is how you end up
// with ".../catalogue/catalogue/page-2.html".
//
// Returns null for anything out of scope, which the caller counts rather than
// ignores.
function absolute(href, pageUrl) {
  if (typeof href !== "string" || href.trim() === "") return null;
  try {
    const resolved = new URL(href, pageUrl);
    // new URL ignores the base entirely when href is already absolute. So one
    // off-host link inside the product area — or a "next" pointing elsewhere —
    // would walk this crawler straight out of the three-page scope the README
    // promises, quietly. Scope is one origin: a link that leaves it is out of
    // scope by definition, not something to follow and apologise for later.
    //
    // origin, not host: host omits the scheme, so comparing it would wave
    // through an http:// link found on an https:// page — a downgrade off the
    // encrypted connection is precisely what this guard is for. Opaque schemes
    // like javascript: have an origin of "null" and are refused either way.
    if (resolved.origin !== new URL(pageUrl).origin) return null;
    return resolved.href;
  } catch {
    return null;
  }
}

function parseCataloguePage(html, pageUrl) {
  const $ = cheerio.load(html);

  // Collected with each() rather than map().get() so an <a> with no href stays
  // in the list as undefined and gets counted below instead of vanishing.
  const hrefs = [];
  $(BOOK_LINK).each((_, el) => hrefs.push($(el).attr("href")));

  const bookUrls = hrefs.map((href) => absolute(href, pageUrl)).filter(Boolean);

  // A link that was on the page but could not be used. Twenty books with one
  // broken href must not report a tidy nineteen and look healthy — a run that
  // cannot say what it dropped cannot be trusted about what it kept.
  const skipped = hrefs.length - bookUrls.length;

  const nextHref = $(NEXT_LINK).attr("href");
  const nextUrl = nextHref ? absolute(nextHref, pageUrl) : null;

  // "There was no next link" and "there was one, but it left the scope" both
  // produce a null nextUrl and both end the walk — but only one of them is news.
  // Without this flag a rejected next link prints catalogue_pages=1 and looks
  // like a perfectly healthy short catalogue.
  const nextRejected = Boolean(nextHref) && nextUrl === null;

  return { bookUrls, skipped, nextUrl, nextRejected };
}

// Follows the catalogue's own "next" link rather than guessing page URLs, and
// stops after maxPages. Sixty hardcoded book links would be a lie the moment the
// shop reorders its shelves.
//
// onPage is called once per catalogue page so the caller can print progress;
// this module stays quiet on its own.
// fetchOptions is passed straight to fetchWithCache, so tests can point at a
// throwaway cache directory instead of the real one.
async function discoverBooks({ startUrl, maxPages, onPage, fetchOptions } = {}) {
  const limit = maxPages ?? TARGET.cataloguePages;

  const books = []; // { url, sourcePage } in discovery order
  const seen = new Set();
  const pages = [];
  let discovered = 0;
  let skipped = 0;
  let nextRejected = 0;
  let cacheHits = 0;

  let pageUrl = startUrl ?? TARGET.startUrl;

  // The safety net here is the page limit, not cycle detection: a "next" link
  // pointing backwards would be walked again rather than recognised. Harmless at
  // three pages; raising maxPages means adding a seen-pages Set first.
  while (pageUrl && pages.length < limit) {
    const { html, fromCache, bytes } = await fetchWithCache(pageUrl, fetchOptions);
    if (fromCache) cacheHits += 1;

    const parsed = parseCataloguePage(html, pageUrl);
    const { bookUrls, nextUrl } = parsed;
    discovered += bookUrls.length;
    skipped += parsed.skipped;
    if (parsed.nextRejected) nextRejected += 1;

    for (const url of bookUrls) {
      // First page to mention a book owns it, so source_page stays stable across
      // runs even if the shop lists the same title twice.
      //
      // Deduped on the canonical URL — the same function Stage 4 uses as a
      // record's identity, so the two can never drift into disagreeing about
      // what "the same book" means.
      const identity = canonicalize(url);
      if (identity === null || seen.has(identity)) continue;
      seen.add(identity);
      books.push({ url: identity, sourcePage: pageUrl });
    }

    pages.push(pageUrl);
    onPage?.({
      pageUrl,
      fromCache,
      bytes,
      found: bookUrls.length,
      skipped: parsed.skipped,
      nextRejected: parsed.nextRejected,
    });

    pageUrl = nextUrl;
  }

  return {
    books,
    pages,
    cataloguePages: pages.length,
    discovered, // every usable link seen, duplicates included
    skipped, // book links on the page, but unusable: no href, unparseable, off-scope
    nextRejected, // pages whose "next" existed but pointed out of scope
    uniqueUrls: books.length, // what the next stage actually works from
    cacheHits,
  };
}

module.exports = { discoverBooks, parseCataloguePage, BOOK_LINK, NEXT_LINK };
