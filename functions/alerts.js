/* Decides which push alert a change to requests/<id> should send. */
'use strict';

const fmtDay = (s) => {
  const [y, m, d] = String(s).split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
};
const route = (r) => `${(r.pickup && r.pickup.name) || '?'} for ${(r.delivery && r.delivery.name) || '?'}`;

/** Works out which alert (if any) a change to requests/<id> should send. */
function describeChange(before, after) {
  if (!after) return null; // deleted
  const company = after.company_name ? `${after.company_name}: ` : '';
  const when = after.when === 'scheduled' && after.scheduled_for ? `, for ${fmtDay(after.scheduled_for)}` : '';

  // Brand new request (not one moved back to the queue with Undo, which the app treats as already seen).
  // One a dispatcher made in the app stays quiet: they already know about it.
  if (after.status === 'new' && (!before || before.status == null) && after.source !== 'dispatcher') {
    return { kind: 'new', title: `New ${when ? 'scheduled ' : ''}request #${after.ref_no}`, body: `${company}${route(after)}${when}` };
  }
  // Customer edited a waiting request
  if (before && before.status === 'new' && after.status === 'new' && after.updated_at && after.updated_at !== before.updated_at) {
    return { kind: 'updated', title: `Request updated #${after.ref_no}`, body: `${company}${route(after)}${when}` };
  }
  // Customer cancelled a waiting request
  if (before && before.status === 'new' && after.status === 'cancelled') {
    return { kind: 'cancelled', title: `Request cancelled #${after.ref_no}`, body: `${company}${route(after)}` };
  }
  return null;
}

module.exports = { describeChange };
