'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { getDb, closeDb } = require('../db');
const { createSession, logSet, finishSession } = require('../store');
const { planCleanup, applyCleanup } = require('../scripts/cleanup-empty-sessions');

test('planCleanup selects only zero-set unfinished sessions', () => {
  const db = getDb(':memory:');
  const empty1 = createSession(db, { routineId: null, startedAt: '2026-07-13 23:52:23' });
  const empty2 = createSession(db, { routineId: null, startedAt: '2026-07-13 23:53:26' });
  const withSet = createSession(db, { routineId: null, startedAt: '2026-07-13 18:57:39' });
  logSet(db, { sessionId: withSet, exerciseName: 'Deadlift', setNumber: 1, weight: 100, reps: 10 });
  const finished = createSession(db, { routineId: null, startedAt: '2026-07-13 19:06:17' });
  finishSession(db, finished, '2026-07-13 19:50:28'); // finished but zero sets → must NOT be deleted

  const plan = planCleanup(db);
  assert.deepStrictEqual(plan.delete.sort((a, b) => a - b), [empty1, empty2]);
  assert.ok(!plan.delete.includes(withSet));
  assert.ok(!plan.delete.includes(finished));
  closeDb();
});

test('applyCleanup deletes exactly the planned sessions', () => {
  const db = getDb(':memory:');
  const e = createSession(db, { routineId: null, startedAt: '2026-07-13 23:52:23' });
  const keep = createSession(db, { routineId: null, startedAt: '2026-07-13 18:57:39' });
  logSet(db, { sessionId: keep, exerciseName: 'Deadlift', setNumber: 1, weight: 100, reps: 10 });
  applyCleanup(db, planCleanup(db));
  assert.strictEqual(db.prepare('SELECT id FROM workout_sessions WHERE id = ?').get(e), undefined);
  assert.ok(db.prepare('SELECT id FROM workout_sessions WHERE id = ?').get(keep));
  closeDb();
});
