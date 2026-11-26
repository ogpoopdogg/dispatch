// Run with: node --test   (from the functions folder)
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { reminderFor, fmtWait, shopHolidays } = require('./reminders');

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
test('no reminders on Manitoba holidays or days closed in Settings', () => {
  const XMAS_10AM = Date.parse('2026-12-25T16:00:00Z'); // Fri 10:00 in Brandon (CST)
  const old = { ref_no: 7, status: 'new', when: 'asap', created_at: XMAS_10AM - 30 * 60000 };
  assert.strictEqual(reminderFor({ a: old }, null, XMAS_10AM), null, 'Christmas Day');
  assert.ok(reminderFor({ a: old }, null, XMAS_10AM, { closed: false }), 'opened in Settings');
  assert.strictEqual(reminderFor({ a: job(30) }, null, WED_10AM, { closed: true, note: 'Storm' }), null, 'closed in Settings');
  assert.ok(reminderFor({ a: job(30) }, null, WED_10AM, null), 'a normal Wednesday');
  const SAT_10AM = Date.parse('2026-10-31T15:00:00Z');
  const sat = { ref_no: 7, status: 'new', when: 'asap', created_at: SAT_10AM - 30 * 60000 };
  assert.strictEqual(reminderFor({ a: sat }, null, SAT_10AM), null, 'a Saturday');
  assert.ok(reminderFor({ a: sat }, null, SAT_10AM, { closed: false }), 'a Saturday opened in Settings');
});
test('holiday dates match the apps', () => {
  assert.deepStrictEqual(Object.keys(shopHolidays(2027)).sort(), ['2027-01-01', '2027-02-15', '2027-03-26', '2027-05-24', '2027-07-01', '2027-09-06', '2027-09-30', '2027-10-11', '2027-12-25']);
});
