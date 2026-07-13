const { test } = require('node:test');
const assert = require('node:assert');
const { getDb, closeDb } = require('../db');
const { createSession, logSet, finishSession, updateSetLog, deleteSetLog } = require('../store');

test('finishSession sets finished_at', () => {
  const db = getDb(':memory:');
  const sid = createSession(db, { startedAt: '2026-07-01 10:00:00' });
  const r = finishSession(db, sid, '2026-07-01 11:00:00');
  assert.strictEqual(r.finished_at, '2026-07-01 11:00:00');
  const row = db.prepare('SELECT finished_at FROM workout_sessions WHERE id = ?').get(sid);
  assert.strictEqual(row.finished_at, '2026-07-01 11:00:00');
  closeDb();
});

test('updateSetLog changes fields and returns row', () => {
  const db = getDb(':memory:');
  const sid = createSession(db, { startedAt: '2026-07-01 10:00:00' });
  const setId = logSet(db, { sessionId: sid, exerciseName: 'Bench Press', setNumber: 1, weight: 60, reps: 8 });
  const updated = updateSetLog(db, setId, { weight: 65, reps: 6 });
  assert.strictEqual(updated.weight, 65);
  assert.strictEqual(updated.reps, 6);
  assert.strictEqual(updateSetLog(db, 9999, { weight: 1 }), null);
  closeDb();
});

test('deleteSetLog removes the row', () => {
  const db = getDb(':memory:');
  const sid = createSession(db, { startedAt: '2026-07-01 10:00:00' });
  const setId = logSet(db, { sessionId: sid, exerciseName: 'Bench Press', setNumber: 1, weight: 60, reps: 8 });
  assert.strictEqual(deleteSetLog(db, setId), true);
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM set_logs').get().c, 0);
  assert.strictEqual(deleteSetLog(db, 9999), false);
  closeDb();
});
