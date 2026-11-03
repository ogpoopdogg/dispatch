/* Customer History key: requests/<id>/company_created = "<company_id>~<created_at as 13 digits>".
   Sorting by it keeps each company's requests together in time order, so the pickup app can
   ask for one company's requests from one period instead of every request it ever sent.
   The pickup app builds the same key (historyKey in requestpickup/index.html).
   The ~ never appears in a company id (they are push keys: letters, digits, - and _), so the
   database rules can tell one company's keys from another's by the "<company_id>~" prefix. */
'use strict';

const pad13 = (ms) => String(Math.max(0, Math.floor(ms))).padStart(13, '0');

/** The key for a request, or null when it has no company or no creation time yet. */
function historyKey(r) {
  if (!r || typeof r.company_id !== 'string' || !r.company_id || typeof r.created_at !== 'number') return null;
  return `${r.company_id}~${pad13(r.created_at)}`;
}

/** { "<id>/company_created": key } for every request whose key is missing or wrong. */
function missingKeys(requests) {
  const up = {};
  for (const [id, r] of Object.entries(requests || {})) {
    const k = historyKey(r);
    if (k && r.company_created !== k) up[`${id}/company_created`] = k;
  }
  return up;
}

module.exports = { historyKey, missingKeys, pad13 };
