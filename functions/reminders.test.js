// Run with: node --test   (from the functions folder)
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { reminderFor, fmtWait } = require('./reminders');

const WED_10AM = Date.parse('2026-10-28T15:00:00Z'); // Wed 10:00 in Brandon (CDT)
const job = (mins, extra) => ({ ref_no: 7, company_name: 'Acme', status: 'new', when: 'asap', created_at: WED_10AM - mins * 60000, ...extra });

test('reminds with the oldest wait during business hours', () => {
  const m = reminderFor({ a: job(25), b: job(12, { ref_no: 8 }) }, null, WED_10AM);
  assert.deepStrictEqual(m, { title: 'Jobs waiting in queue: 25 min', body: '2 jobs waiting. Oldest: #7 Acme' });
});
test('nothing waiting 10 minutes yet: no reminder', () => {
  assert.strictEqual(reminderFor({ a: job(4) }, null, WED_10AM), null);
});
test('outside business hours or on a day off: no reminder', () => {
  assert.strictEqual(reminderFor({ a: job(30) }, { start: '11:00', end: '17:00' }, WED_10AM), null);
  assert.strictEqual(reminderFor({ a: job(30) }, { days: [1, 2, 4, 5] }, WED_10AM), null);
  assert.strictEqual(reminderFor({ a: job(30) }, { enabled: false }, WED_10AM), null);
});
test('a job booked for a later day is not in the queue', () => {
  assert.strictEqual(reminderFor({ a: job(300, { when: 'scheduled', scheduled_for: '2026-10-29' }) }, null, WED_10AM), null);
  assert.ok(reminderFor({ a: job(300, { when: 'scheduled', scheduled_for: '2026-10-28' }) }, null, WED_10AM));
});
test('waits read naturally', () => {
  assert.strictEqual(fmtWait(25 * 60000), '25 min');
  assert.strictEqual(fmtWait(80 * 60000), '1 hr 20 min');
  assert.strictEqual(fmtWait(26 * 3600000), '1 day');
});
