'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { getDb, closeDb } = require('../db');
const { createSession, logSet } = require('../store');
const { listLoggedExercises } = require('../read-queries');

test('listLoggedExercises returns exercises with logged history', () => {
  const db = getDb(':memory:');
  const s1 = createSession(db, { startedAt: '2026-07-01 10:00:00' });
  logSet(db, { sessionId: s1, exerciseName: 'Bench Press', setNumber: 1, weight: 60, reps: 8 });
  const s2 = createSession(db, { startedAt: '2026-07-08 10:00:00' });
  logSet(db, { sessionId: s2, exerciseName: 'Bench Press', setNumber: 1, weight: 62.5, reps: 8 });
  const list = listLoggedExercises(db);
  const bench = list.find((e) => e.name === 'Bench Press');
  assert.ok(bench); assert.strictEqual(bench.session_count, 2);
  closeDb();
});

test('listLoggedExercises excludes catalog exercises with no sets', () => {
  const db = getDb(':memory:');
  require('../store').findOrCreateExercise(db, 'Never Logged');
  assert.deepStrictEqual(listLoggedExercises(db), []);
  closeDb();
});
