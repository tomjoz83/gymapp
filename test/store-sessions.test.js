const { test } = require('node:test');
const assert = require('node:assert');
const { getDb, closeDb } = require('../db');
const { createSession, logSet, est1RM } = require('../store');

test('est1RM uses Epley and guards bad input', () => {
  assert.ok(Math.abs(est1RM(100, 5) - 116.6667) < 0.01);
  assert.strictEqual(est1RM(0, 5), 0);
  assert.strictEqual(est1RM(100, 0), 0);
});

test('createSession + logSet persist rows', () => {
  const db = getDb(':memory:');
  const sid = createSession(db, { startedAt: '2026-07-01 10:00:00' });
  assert.ok(sid > 0);
  const setId = logSet(db, {
    sessionId: sid, exerciseName: 'Bench Press',
    setNumber: 1, weight: 60, reps: 8, rpe: 7,
  });
  assert.ok(setId > 0);
  const row = db.prepare('SELECT * FROM set_logs WHERE id = ?').get(setId);
  assert.strictEqual(row.session_id, sid);
  assert.strictEqual(row.weight, 60);
  assert.strictEqual(row.reps, 8);
  assert.strictEqual(row.rpe, 7);
  const exCount = db.prepare('SELECT COUNT(*) c FROM exercises').get().c;
  assert.strictEqual(exCount, 1);
  closeDb();
});
