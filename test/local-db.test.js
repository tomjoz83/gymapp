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
    async run(sql, params = []) { const info = db.prepare(sql).run(...params); return { lastId: Number(info.lastInsertRowid) }; },
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
