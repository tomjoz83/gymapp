'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const L = require('../public/logic.js');

test('todayInTZ: Sun 21:00 UTC is Monday in NZ', () => {
  const inst = new Date('2026-07-12T21:00:00Z');
  assert.strictEqual(L.todayInTZ('Pacific/Auckland', inst), '2026-07-13');
});

test('todayInTZ: session 118 instant (Jul 13 19:06 UTC) is NZ Jul 14', () => {
  assert.strictEqual(L.todayInTZ('Pacific/Auckland', new Date('2026-07-13T19:06:17Z')), '2026-07-14');
});

test('nowInTZ: returns NZ wall-clock "YYYY-MM-DD HH:mm:ss"', () => {
  const s = L.nowInTZ('Pacific/Auckland', new Date('2026-07-13T19:06:17Z'));
  assert.strictEqual(s, '2026-07-14 07:06:17');
});

test('todayInTZ: UTC tz returns the UTC date unchanged', () => {
  assert.strictEqual(L.todayInTZ('Etc/UTC', new Date('2026-07-13T19:06:17Z')), '2026-07-13');
});
