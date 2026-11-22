// Run with: node --test   (from the functions folder)
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { isStaffEmail, emailKey, signUpRefusal } = require('./signup');

test('customer emails go through', () => {
  assert.strictEqual(signUpRefusal('pat@acme.ca', false), null);
  assert.strictEqual(signUpRefusal('someone@gmail.com', undefined), null);
  assert.strictEqual(signUpRefusal('', false), null);
});
test('@ec.com is refused unless allowed first', () => {
  assert.match(signUpRefusal('newdriver@ec.com', null), /made by E&C/);
  assert.match(signUpRefusal(' NewDriver@EC.com ', false), /made by E&C/);
  assert.strictEqual(signUpRefusal('newdriver@ec.com', true), null);
});
test('look-alike domains are not staff', () => {
  assert.strictEqual(isStaffEmail('a@ec.com.evil.ca'), false);
  assert.strictEqual(isStaffEmail('a@sec.com'), false);
  assert.strictEqual(isStaffEmail('a@ec.com'), true);
});
test('email key matches the timeclock rules', () => {
  assert.strictEqual(emailKey('New.Driver@ec.com'), 'new,driver@ec.com');
  assert.strictEqual(emailKey('gil@ec.com'), 'gil@ec,com');
});
