const { test } = require('node:test');
const assert = require('node:assert');
const L = require('../public/logic.js');

test('rpeToRir and rirToRpe convert and clamp', () => {
  assert.strictEqual(L.rpeToRir(10), 0);
  assert.strictEqual(L.rpeToRir(8), 2);
  assert.strictEqual(L.rpeToRir(null), null);
  assert.strictEqual(L.rpeToRir(3), 5); // clamp
  assert.strictEqual(L.rirToRpe(0), 10);
  assert.strictEqual(L.rirToRpe(2), 8);
  assert.strictEqual(L.rirToRpe(null), null);
});

test('resolvePrevious finds the matching set number', () => {
  const prior = [
    { set_number: 1, weight: 60, reps: 8, rpe: 7 },
    { set_number: 2, weight: 60, reps: 8, rpe: 8 },
  ];
  assert.deepStrictEqual(L.resolvePrevious(prior, 2), { weight: 60, reps: 8, rpe: 8 });
  assert.strictEqual(L.resolvePrevious(prior, 5), null);
  assert.strictEqual(L.resolvePrevious([], 1), null);
});

test('prefillForSet prefers previous, then target, then nulls', () => {
  const prior = [{ set_number: 1, weight: 62.5, reps: 8, rpe: 8 }];
  assert.deepStrictEqual(L.prefillForSet(prior, 1, { target_weight: 60, target_reps: 10 }), { weight: 62.5, reps: 8 });
  assert.deepStrictEqual(L.prefillForSet([], 1, { target_weight: 60, target_reps: 10 }), { weight: 60, reps: 10 });
  assert.deepStrictEqual(L.prefillForSet([], 1, {}), { weight: null, reps: null });
});

test('formatPrevious renders rpe and rir scales', () => {
  const prev = { weight: 60, reps: 8, rpe: 7 };
  assert.strictEqual(L.formatPrevious(prev, 'rpe'), '60×8 @7');
  assert.strictEqual(L.formatPrevious(prev, 'rir'), '60×8 (3 RIR)');
  assert.strictEqual(L.formatPrevious(null, 'rpe'), '—');
});

test('nextRestState seeds a countdown state', () => {
  assert.deepStrictEqual(L.nextRestState(90), { remaining: 90, running: true });
  assert.deepStrictEqual(L.nextRestState(0), { remaining: 0, running: false });
  assert.deepStrictEqual(L.nextRestState(-5), { remaining: 0, running: false });
  assert.deepStrictEqual(L.nextRestState(2.9), { remaining: 2, running: true });
});
