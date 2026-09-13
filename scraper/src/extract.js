// Stage 3 — turn one book page's HTML into one raw record.
//
// This file never fetches anything. It takes HTML plus the provenance the caller
// already knows, and returns a record. That split is deliberate: every parser test
// runs on a fixture with no server involved, and in Stage 5 a page that fails to
// download and a page that fails to parse are two different failures in two
// different places, which is what makes "one bad page must not kill the run"
// straightforward rather than clever.

const cheerio = require("cheerio");

// Everything is read from inside the product article. "The first thing on the
// page that looks like a price" works today and betrays you the day the page
// grows a recommendations carousel with prices in it.
const SCOPE = "article.product_page";
const MAIN = ".product_main";

const RATING_WORDS = new Set(["One", "Two", "Three", "Four", "Five"]);

// Mirrors FetchError's shape on purpose. Stage 5's run report has to say how many
// pages failed to download and how many failed to parse as two separate numbers,
// and reading err.kind in one place beats asking which class each error happens
// to be.
class ExtractError extends Error {
  constructor(message, { url }) {
    super(message);
    this.name = "ExtractError";
    this.kind = "parse";
    this.url = url;
  }
}

// Markup indentation is not part of a value: the availability cell arrives as
// "\n\n    In stock (22 available)\n\n" and the value on the page is the text.
function collapse(text) {
  return text.replace(/\s+/g, " ").trim();
}

function textOrNull(selection) {
  if (selection.length === 0) return null;
  return collapse(selection.first().text()) || null;
}

// The rating is not written anywhere as text — it is the class name, as in
// <p class="star-rating Three">. Read the word, and only accept a word that is
// actually a rating, so a future class like "star-rating disabled" cannot become
// a rating of "disabled".
function ratingFrom(selection) {
  const className = selection.first().attr("class") ?? "";
  return className.split(/\s+/).find((word) => RATING_WORDS.has(word)) ?? null;
}

// The description is a sibling paragraph after the #product_description header,
// and plenty of books simply do not have one. A missing description is null —
// never an empty string standing in for prose, and never invented text.
//
// Trimmed, not collapsed — deliberately unlike availability above. In a cell that
// reads "In stock (22 available)" the surrounding whitespace is markup
// indentation and nothing else, so collapsing it recovers the value. In prose,
// line breaks are part of what the page said, and flattening them would be an
// edit rather than a read. Leading and trailing space is still noise either way.
function descriptionFrom(scope) {
  const paragraph = scope.find("#product_description").next("p");
  if (paragraph.length === 0) return null;
  const text = paragraph.text().trim();
  return text === "" ? null : text;
}

function extractBook(html, { url, sourcePage, fetchedAt }) {
  const $ = cheerio.load(html);
  const scope = $(SCOPE);

  // No product article at all means this is not a book page — a redesign, or an
  // error page that answered 200. That is a failure to report, not a record of
  // eight nulls to quietly store.
  if (scope.length === 0) {
    throw new ExtractError(`no ${SCOPE} found — not a book page: ${url}`, { url });
  }

  return {
    title: textOrNull(scope.find(`${MAIN} h1`)),
    product_url: url,
    price_text: textOrNull(scope.find(`${MAIN} p.price_color`)),
    availability_text: textOrNull(scope.find(`${MAIN} p.availability`)),
    rating_text: ratingFrom(scope.find(`${MAIN} p.star-rating`)),
    description: descriptionFrom(scope),
    // Provenance: where this came from and when the HTML arrived. Carried on
    // every record so that a value that looks wrong in three weeks can be traced
    // back to the page it was read from.
    source_page: sourcePage,
    fetched_at: fetchedAt,
  };
}

module.exports = { extractBook, ExtractError, SCOPE, RATING_WORDS };
