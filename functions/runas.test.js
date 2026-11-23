'use strict';
// Every Dispatch function runs as the ec-apps account, not the default one with Editor.
const test = require('node:test');
const assert = require('node:assert');
const I = require('./index');

test('every function runs as the ec-apps account', () => {
  const other = Object.entries(I).filter(([, f]) => !f.__endpoint || f.__endpoint.serviceAccountEmail !== 'ec-apps@eandccourier-36fcc.iam.gserviceaccount.com');
  assert.deepStrictEqual(other.map(([n]) => n), []);
  assert.ok(Object.keys(I).length >= 6);
});
