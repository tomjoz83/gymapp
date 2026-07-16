// test/local-db.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { DatabaseSync } = require('node:sqlite');
const { createLocalDb } = require('../public/local-db.js');

// Adapter: wrap synchronous node:sqlite in the async exec shape local-db expects.
function nodeAdapter() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  return {
    async run(sql, params = []) { const info = db.prepare(sql).run(...params); return { lastId: Number(info.lastInsertRowid), changes: Number(info.changes) }; },
    async get(sql, params = []) { return db.prepare(sql).get(...params); },
    async all(sql, params = []) { return db.prepare(sql).all(...params); },
    async exec(sql) { db.exec(sql); },
    async begin() { db.exec('BEGIN'); },
    async commit() { db.exec('COMMIT'); },
    async rollback() { db.exec('ROLLBACK'); },
    _close() { db.close(); },
  };
}

function prog() {
  return { slug: 'ppl', name: 'PPL', active: true, weeks: [{ week_number: 1, label: 'W1', routines: [
    { name: 'Pull', day_of_week: 'Tuesday', exercises: [{ exercise: 'Deadlift', target_sets: 3, target_reps: 8 }] } ] }] };
}

test('local-db: import program, then read active program + week', async () => {
  const a = nodeAdapter(); const ldb = createLocalDb(a);
  await ldb.initSchema();
  await ldb.importProgram(prog(), '2026-07-13 00:00:00');
  const ap = await ldb.getActiveProgram();
  assert.strictEqual(ap.slug, 'ppl'); assert.strictEqual(ap.weekCount, 1);
  const wk = await ldb.getProgramWeek(1);
  assert.strictEqual(wk.routines[0].name, 'Pull');
  a._close();
});

test('local-db: idempotent session per (date,routine) + log a set + read it back', async () => {
  const a = nodeAdapter(); const ldb = createLocalDb(a);
  await ldb.initSchema(); await ldb.importProgram(prog(), '2026-07-13 00:00:00');
  const routine = await a.get('SELECT id FROM routines LIMIT 1');
  const s1 = await ldb.findOrCreateSessionForSlot({ routineId: routine.id, date: '2026-07-14' });
  const s2 = await ldb.findOrCreateSessionForSlot({ routineId: routine.id, date: '2026-07-14' });
  assert.strictEqual(s2.id, s1.id); assert.strictEqual(s2.created, false);
  await ldb.logSet({ sessionId: s1.id, exerciseName: 'Deadlift', setNumber: 1, weight: 100, reps: 5 });
  const full = await ldb.getSession(s1.id);
  assert.strictEqual(full.sets.length, 1);
  assert.strictEqual(full.sets[0].weight, 100);
  a._close();
});

test('local-db: setProgramStartDate + getProgress + est1RM', async () => {
  const a = nodeAdapter(); const ldb = createLocalDb(a);
  await ldb.initSchema(); await ldb.importProgram(prog(), '2026-07-13 00:00:00');
  const ap = await ldb.getActiveProgram();
  await ldb.setProgramStartDate(ap.id, '2026-07-13');
  assert.strictEqual((await ldb.getActiveProgram()).start_date, '2026-07-13');
  assert.strictEqual(ldb.est1RM(100, 5) > 100, true);
  a._close();
});

// Regression: finishSession null-guard must use changes, not lastId (Bug 2 fix)
test('local-db: finishSession — real session returns result, non-existent id returns null', async () => {
  const a = nodeAdapter(); const ldb = createLocalDb(a);
  await ldb.initSchema(); await ldb.importProgram(prog(), '2026-07-13 00:00:00');
  const routine = await a.get('SELECT id FROM routines LIMIT 1');
  // Create a real session then do some inserts so lastInsertRowid is non-zero
  const sessionId = await ldb.createSession({ routineId: routine.id });
  await ldb.logSet({ sessionId, exerciseName: 'Deadlift', setNumber: 1, weight: 80, reps: 3 });
  // finishSession on a real session must return {id, finished_at}
  const result = await ldb.finishSession(sessionId, '2026-07-14 10:00:00');
  assert.ok(result !== null, 'finishSession on real session should not return null');
  assert.strictEqual(result.id, sessionId);
  assert.strictEqual(result.finished_at, '2026-07-14 10:00:00');
  // Confirm finished_at is persisted in DB
  const row = await a.get('SELECT finished_at FROM workout_sessions WHERE id = ?', [sessionId]);
  assert.strictEqual(row.finished_at, '2026-07-14 10:00:00');
  // finishSession on a non-existent id must return null (not {id, finished_at})
  const nullResult = await ldb.finishSession(99999, '2026-07-14 10:00:00');
  assert.strictEqual(nullResult, null, 'finishSession on non-existent id must return null');
  a._close();
});

// Regression: updateSetLog must return row object, not a Promise (Bug 1 fix)
test('local-db: updateSetLog — returns actual row object with updated fields, non-existent id returns null', async () => {
  const a = nodeAdapter(); const ldb = createLocalDb(a);
  await ldb.initSchema(); await ldb.importProgram(prog(), '2026-07-13 00:00:00');
  const routine = await a.get('SELECT id FROM routines LIMIT 1');
  const sessionId = await ldb.createSession({ routineId: routine.id });
  const setId = await ldb.logSet({ sessionId, exerciseName: 'Deadlift', setNumber: 1, weight: 100, reps: 5 });
  // updateSetLog must return the resolved row object, not a Promise
  const updated = await ldb.updateSetLog(setId, { weight: 120, reps: 4 });
  assert.strictEqual(typeof updated, 'object', 'updateSetLog must return an object, not a Promise');
  assert.ok(updated !== null, 'updateSetLog must not return null for existing id');
  assert.strictEqual(updated.weight, 120, 'updated row must reflect new weight');
  assert.strictEqual(updated.reps, 4, 'updated row must reflect new reps');
  // updateSetLog on non-existent id must return null
  const nullResult = await ldb.updateSetLog(99999, { weight: 50 });
  assert.strictEqual(nullResult, null, 'updateSetLog on non-existent id must return null');
  a._close();
});
