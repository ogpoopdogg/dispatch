// Run with: node --test   (from the functions folder)
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { historyKey, missingKeys } = require('./history');

test('key is the company, then the creation time padded so it sorts as text', () => {
  assert.strictEqual(historyKey({ company_id: '-Nabc', created_at: 1762196400000 }), '-Nabc~1762196400000');
  assert.strictEqual(historyKey({ company_id: 'c1', created_at: 5 }), 'c1~0000000000005');
  assert.ok(historyKey({ company_id: 'c1', created_at: 999 }) < historyKey({ company_id: 'c1', created_at: 1000 }));
});
test('one company\'s keys never start with another company\'s prefix', () => {
  // Company ids are push keys, which can contain _ but never ~
  const a = historyKey({ company_id: '-Nab', created_at: 1 });
  const b = historyKey({ company_id: '-Nab_c', created_at: 1 });
  assert.ok(!b.startsWith('-Nab~'));
  assert.ok(a.startsWith('-Nab~'));
});
test('no key without a company or a creation time', () => {
  assert.strictEqual(historyKey(null), null);
  assert.strictEqual(historyKey({ created_at: 1 }), null);
  assert.strictEqual(historyKey({ company_id: 'c1', created_at: { '.sv': 'timestamp' } }), null);
});
test('only missing or wrong keys are filled in', () => {
  const up = missingKeys({
    a: { company_id: 'c1', created_at: 10 },
    b: { company_id: 'c1', created_at: 20, company_created: 'c1~0000000000020' },
    c: { company_id: 'c2', created_at: 30, company_created: 'c2~9' },
    d: { status: 'new' }
  });
  assert.deepStrictEqual(up, { 'a/company_created': 'c1~0000000000010', 'c/company_created': 'c2~0000000000030' });
});
