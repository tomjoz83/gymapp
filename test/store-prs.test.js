const { test } = require('node:test');
const assert = require('node:assert');
const { getDb, closeDb } = require('../db');
const { createSession, logSet, recomputePRs, findOrCreateExercise } = require('../store');

test('recomputePRs records best weight per rep count', () => {
  const db = getDb(':memory:');
  const s1 = createSession(db, { startedAt: '2026-07-01 10:00:00' });
  logSet(db, { sessionId: s1, exerciseName: 'Bench Press', setNumber: 1, weight: 60, reps: 5 });
  const s2 = createSession(db, { startedAt: '2026-07-08 10:00:00' });
  logSet(db, { sessionId: s2, exerciseName: 'Bench Press', setNumber: 1, weight: 65, reps: 5 });

  const exId = findOrCreateExercise(db, 'Bench Press');
  recomputePRs(db, exId);

  const pr = db.prepare(
    'SELECT * FROM personal_records WHERE exercise_id = ? AND rep_count = 5'
  ).get(exId);
  assert.strictEqual(pr.best_weight, 65);
  assert.ok(Math.abs(pr.best_est_1rm - 65 * (1 + 5 / 30)) < 0.01);
  closeDb();
});
