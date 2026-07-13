const { test } = require('node:test');
const assert = require('node:assert');
const L = require('../public/logic.js');

test('tickRest counts down and flags finish', () => {
  let s = L.nextRestState(2);
  assert.deepStrictEqual(s, { remaining: 2, running: true });
  s = L.tickRest(s);
  assert.deepStrictEqual(s, { remaining: 1, running: true });
  s = L.tickRest(s);
  assert.strictEqual(s.remaining, 0);
  assert.strictEqual(s.running, false);
  assert.strictEqual(s.justFinished, true);
  assert.deepStrictEqual(L.tickRest({ remaining: 0, running: false }), { remaining: 0, running: false });
});
