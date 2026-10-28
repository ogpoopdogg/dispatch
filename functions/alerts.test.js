// Run with: node --test   (from the functions folder)
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { describeChange } = require('./alerts');

const base = { ref_no: 42, status: 'new', company_name: 'Acme', pickup: { name: 'Shop' }, delivery: { name: 'Site' }, created_at: 1 };

test('new request alerts', () => {
  assert.deepStrictEqual(describeChange(null, base), { kind: 'new', title: 'New request #42', body: 'Acme: Shop for Site' });
});
test('new scheduled request names the day', () => {
  const m = describeChange(null, { ...base, when: 'scheduled', scheduled_for: '2026-10-14' });
  assert.strictEqual(m.title, 'New scheduled request #42');
  assert.strictEqual(m.body, 'Acme: Shop for Site, for Wed, Oct 14');
});
test('customer edit alerts', () => {
  assert.strictEqual(describeChange(base, { ...base, updated_at: 5 }).kind, 'updated');
});
test('customer cancel alerts', () => {
  assert.strictEqual(describeChange(base, { ...base, status: 'cancelled', cancelled_at: 9 }).kind, 'cancelled');
});
test('dispatching, undo and deletes stay quiet', () => {
  assert.strictEqual(describeChange(base, { ...base, status: 'dispatched' }), null);
  assert.strictEqual(describeChange({ ...base, status: 'dispatched' }, base), null);
  assert.strictEqual(describeChange(base, null), null);
  assert.strictEqual(describeChange(base, { ...base }), null);
});
test('removing from the queue and moving it back stay quiet', () => {
  assert.strictEqual(describeChange(base, { ...base, status: 'removed', removed_at: 9 }), null);
  assert.strictEqual(describeChange({ ...base, status: 'removed', removed_at: 9 }, base), null);
});
test('a dispatch made in the app stays quiet', () => {
  assert.strictEqual(describeChange(null, { ...base, source: 'dispatcher' }), null);
  assert.strictEqual(describeChange(null, { ...base, source: 'dispatcher', status: 'dispatched' }), null);
});
