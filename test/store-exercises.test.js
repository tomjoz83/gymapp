const { test } = require('node:test');
const assert = require('node:assert');
const { getDb, closeDb } = require('../db');
const { findOrCreateExercise } = require('../store');

test('findOrCreateExercise is idempotent by name', () => {
  const db = getDb(':memory:');
  const a = findOrCreateExercise(db, 'Bench Press');
  const b = findOrCreateExercise(db, 'Bench Press');
  assert.strictEqual(a, b);
  const count = db.prepare('SELECT COUNT(*) c FROM exercises').get().c;
  assert.strictEqual(count, 1);
  closeDb();
});

test('findOrCreateExercise trims and rejects empty', () => {
  const db = getDb(':memory:');
  const id = findOrCreateExercise(db, '  Squat  ');
  const row = db.prepare('SELECT name FROM exercises WHERE id = ?').get(id);
  assert.strictEqual(row.name, 'Squat');
  assert.throws(() => findOrCreateExercise(db, '   '));
  closeDb();
});
