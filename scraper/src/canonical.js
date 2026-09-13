// One definition of "the same book", used everywhere.
//
// Stage 2 dedupes discovered links and Stage 4 calls product_url a record's
// canonical identity. If those were two separate pieces of code they would agree
// almost always — and disagree exactly when some URL turns up with a fragment or
// an odd bit of encoding, which is the hardest kind of bug to see. So there is
// one function, and both callers use it.

// What is normalised, and what deliberately is not:
//
//   - The fragment is dropped. A fragment is never sent to the server, so
//     .../book/#reviews and .../book/ are the same resource by definition.
//   - Scheme and host case, default ports (:443 on https) and percent-encoding
//     are normalised by the URL parser itself.
//   - A trailing slash is left alone. /a and /a/ are different paths in HTTP and
//     a server is entitled to treat them differently; merging them would be a
//     guess about someone else's routing.
//   - Query order is left alone, for the same reason.
//
// Returns null for anything unparseable, so a caller has to decide what to do
// rather than silently receiving a bad identity.
function canonicalize(url) {
  if (typeof url !== "string" || url.trim() === "") return null;
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.href;
  } catch {
    return null;
  }
}

module.exports = { canonicalize };
