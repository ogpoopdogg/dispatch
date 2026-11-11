/* Decides which phone alert a customer (Request Pickup app) gets, and who gets it.
   The pickup app saves each phone's push token under customer_push/<uid>/<device key>. */
'use strict';

const route = (r) => {
  const from = (r.pickup && r.pickup.name) || '';
  const to = (r.delivery && (r.delivery.name || r.delivery.address)) || '';
  return from && to ? `${from} to ${to}` : from || to;
};

/** The alert for the customer when dispatch changes requests/<id>, or null. */
function customerAlertForRequest(before, after) {
  if (!before || !after || before.status === after.status) return null;
  const where = route(after);
  if (after.status === 'dispatched' && before.status === 'new') {
    return { title: `Pickup #${after.ref_no} sent to a driver`, body: where ? `${where}.` : 'It has gone to a driver.' };
  }
  if (after.status === 'removed' && before.status === 'new') {
    return { title: `Pickup #${after.ref_no} removed by dispatch`, body: `${where ? `${where}. ` : ''}It won’t be picked up. Open the app to message dispatch.` };
  }
  return null;
}

/** The alert for a new message from dispatch (messages/<id>), or null. */
function customerAlertForMessage(before, after) {
  if (before || !after || after.from !== 'dispatch' || !after.text) return null;
  const text = String(after.text);
  return { title: `Dispatch${after.ref_no ? ` about #${after.ref_no}` : ''}`, body: text.length > 180 ? `${text.slice(0, 177)}...` : text };
}

/** Who hears about a pickup: whoever sent it, plus anyone in the company who wrote to dispatch about it. */
function recipientsFor(request, messages) {
  const out = new Set();
  if (request && request.customer_uid) out.add(request.customer_uid);
  Object.values(messages || {}).forEach((m) => { if (m && m.from === 'customer' && m.by_uid) out.add(m.by_uid); });
  return [...out];
}

module.exports = { customerAlertForRequest, customerAlertForMessage, recipientsFor };
