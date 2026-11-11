// Run with: node --test   (from the functions folder)
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { customerAlertForRequest, customerAlertForMessage, recipientsFor, generalRecipients } = require('./customer');

const base = { ref_no: 1204, status: 'new', customer_uid: 'u1', pickup: { name: 'Acme Supply' }, delivery: { name: 'Lake Clinic' } };

test('dispatched to a driver', () => {
  assert.deepStrictEqual(customerAlertForRequest(base, { ...base, status: 'dispatched' }), { title: 'Pickup #1204 sent to a driver', body: 'Acme Supply to Lake Clinic.' });
});
test('removed by dispatch', () => {
  const m = customerAlertForRequest(base, { ...base, status: 'removed' });
  assert.strictEqual(m.title, 'Pickup #1204 removed by dispatch');
  assert.match(m.body, /^Acme Supply to Lake Clinic\. It won.t be picked up/);
});
test('no delivery listed', () => {
  assert.strictEqual(customerAlertForRequest(base, { ...base, delivery: {}, status: 'dispatched' }).body, 'Acme Supply.');
});
test('new, seen, edits, cancels, undo and deletes stay quiet', () => {
  assert.strictEqual(customerAlertForRequest(null, base), null);
  assert.strictEqual(customerAlertForRequest(base, { ...base, seen_at: 5 }), null);
  assert.strictEqual(customerAlertForRequest(base, { ...base, status: 'cancelled' }), null);
  assert.strictEqual(customerAlertForRequest({ ...base, status: 'dispatched' }, base), null);
  assert.strictEqual(customerAlertForRequest({ ...base, status: 'removed' }, base), null);
  assert.strictEqual(customerAlertForRequest(base, null), null);
});
test('message from dispatch', () => {
  assert.deepStrictEqual(customerAlertForMessage(null, { from: 'dispatch', text: 'Driver is 10 min out.', ref_no: 1204 }), { title: 'Dispatch about #1204', body: 'Driver is 10 min out.' });
  assert.strictEqual(customerAlertForMessage(null, { from: 'dispatch', text: 'x'.repeat(300) }).body.length, 180);
});
test('customer messages and edits stay quiet', () => {
  assert.strictEqual(customerAlertForMessage(null, { from: 'customer', text: 'hi' }), null);
  assert.strictEqual(customerAlertForMessage({ from: 'dispatch', text: 'a' }, { from: 'dispatch', text: 'b' }), null);
});
test('recipients: sender plus coworkers who wrote about it, once each', () => {
  assert.deepStrictEqual(recipientsFor(base, { a: { from: 'customer', by_uid: 'u2' }, b: { from: 'dispatch', by_uid: 'staff' }, c: { from: 'customer', by_uid: 'u1' } }).sort(), ['u1', 'u2']);
  assert.deepStrictEqual(recipientsFor(null, null), []);
});
test('general message: people who wrote one, still in the company', () => {
  const members = { u1: { role: 'owner' }, u2: { role: 'member' }, u3: { role: 'member' } };
  const msgs = { a: { rid: 'general', from: 'customer', by_uid: 'u2' }, b: { rid: 'r1', from: 'customer', by_uid: 'u3' }, c: { rid: 'general', from: 'customer', by_uid: 'gone' } };
  assert.deepStrictEqual(generalRecipients(msgs, members), ['u2']);
});
test('general message nobody asked: the whole company', () => {
  assert.deepStrictEqual(generalRecipients({}, { u1: {}, u2: {} }).sort(), ['u1', 'u2']);
  assert.deepStrictEqual(generalRecipients(null, null), []);
});
test('general message title has no pickup number', () => {
  assert.strictEqual(customerAlertForMessage(null, { from: 'dispatch', text: 'Closed weekends.', rid: 'general', ref_no: null }).title, 'Dispatch');
});
