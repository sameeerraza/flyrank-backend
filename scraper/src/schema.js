// Stage 4 — the shape of a finished record, written down once.
//
// A web page is untrusted input. Every record is checked against this before it
// is allowed into books.json; anything that fails goes to errors.json with the
// reason instead.

const { z } = require("zod");
const { TARGET } = require("./config");

const RATINGS = ["One", "Two", "Three", "Four", "Five"];

// Scope is enforced twice, on purpose. Discovery already refuses an off-origin
// link, so nothing off-origin can reach here today — but the schema is the last
// gate before a record is written, and a gate that only checks the scheme would
// wave through https://somewhere-else.example/x if any future path ever reached
// it. Defence in depth costs one refinement.
const TARGET_ORIGIN = new URL(TARGET.startUrl).origin;

const inScopeUrl = z.url().refine(
  (value) => {
    try {
      return new URL(value).origin === TARGET_ORIGIN;
    } catch {
      return false;
    }
  },
  { message: `must be within ${TARGET_ORIGIN}` },
);

const bookRecord = z.object({
  title: z.string().trim().min(1),

  // The record's identity. Checking the origin covers the scheme too: an http://
  // downgrade has a different origin and is refused by the same rule.
  product_url: inScopeUrl,

  // Raw and clean, side by side. price_text is what the page said; price_gbp is
  // what a program can sort by.
  price_text: z.string().min(1),
  price_gbp: z
    .number()
    // .finite() is belt and braces on Zod 4, which already rejects NaN and
    // Infinity — kept because the intent should not depend on that staying true.
    .finite()
    .nonnegative(),

  availability_text: z.string().min(1),

  // Required, not nullable — a deliberate choice rather than a default. The brief
  // marks only description optional and is silent on the rest. extract.js yields
  // null here when the star-rating class is not one of the five words, and that
  // means the page's structure changed, not that a book happens to have no
  // rating. A record like that should be visible in errors.json rather than
  // stored looking complete.
  rating_text: z.enum(RATINGS),

  // Optional, as the brief requires: plenty of books have no description. null is
  // the honest value — the key is always present, never an empty string.
  description: z.string().min(1).nullable(),
  description_clean: z.string().min(1).nullable(),

  // Provenance. Where the fact came from, and when the HTML arrived.
  source_page: inScopeUrl,
  fetched_at: z.iso.datetime(),
});

// Turns a Zod failure into something a person reading errors.json can act on:
// "price_gbp: expected number, received null" rather than a nested object.
function describeIssues(error) {
  return error.issues.map((issue) => {
    const field = issue.path.join(".") || "(record)";
    return `${field}: ${issue.message}`;
  });
}

module.exports = { bookRecord, describeIssues, RATINGS };
