// Stage 4 — raw strings in, clean values out.
//
// Nothing here overwrites a raw field. The record keeps price_text next to
// price_gbp and description next to description_clean, so the page's own words
// survive alongside whatever we made of them.

const { canonicalize } = require("./canonical");

// Deliberately strict, and deliberately not parseFloat.
//
// parseFloat("51.77abc") returns 51.77 — it stops at the first character it does
// not like and reports nothing, so "£51.77 (was £60)" would quietly become a
// price. parseFloat("") returns NaN, which is typeof "number", so a downstream
// check of "is it a number" passes on a value that is not one.
//
// This matches the whole string or nothing, and the currency symbol is required:
// a page that one day prices in dollars must not have its number copied into a
// field called price_gbp. A null here fails the schema and the record lands in
// errors.json with a reason, which is the visible outcome we want.
const PRICE_GBP = /^£(\d+(?:\.\d{1,2})?)$/;

function priceToNumber(priceText) {
  if (typeof priceText !== "string") return null;
  const match = PRICE_GBP.exec(priceText.trim());
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

// The site's own description paragraph ends in a literal "...more". Stripping
// that suffix is exact string surgery, so it is safe to do.
//
// What is NOT done here: the same paragraph also opens with a truncated teaser
// that repeats the first sentences of the full text. Removing that would take a
// heuristic — find the repeat, guess where it ends — and a heuristic that is
// wrong once has cut real prose out of a record, which is the same sin as
// inventing text that was never on the page. The doubling is recorded as a
// property of the source in the README, and the raw description keeps it.
function cleanDescription(description) {
  if (typeof description !== "string") return null;
  const cleaned = description.replace(/\s*\.\.\.more$/, "").trim();
  return cleaned === "" ? null : cleaned;
}

// Adds the clean fields to a raw record. Missing or unparseable values become
// null and are left for the schema to reject with a reason.
function normalizeRecord(raw) {
  return {
    ...raw,
    product_url: canonicalize(raw.product_url) ?? raw.product_url,
    price_gbp: priceToNumber(raw.price_text),
    description_clean: cleanDescription(raw.description),
  };
}

module.exports = { normalizeRecord, priceToNumber, cleanDescription };
