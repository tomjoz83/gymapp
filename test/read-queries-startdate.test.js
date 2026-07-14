// test/read-queries-startdate.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { getDb, closeDb } = require('../db');
const { importProgram, setProgramStartDate, createSession, logSet } = require('../store');
const { getActiveProgram, listSessions } = require('../read-queries');

function prog(slug) {
  return { slug, name: slug, active: true, weeks: [{ week_number: 1, routines: [
    { name: 'Pull', day_of_week: 'Tuesday', exercises: [{ exercise: 'Deadlift', target_sets: 3, target_reps: 8 }] } ] }] };
}

test('getActiveProgram exposes start_date; setProgramStartDate sets it', () => {
  const db = getDb(':memory:');
  const id = importProgram(db, prog('p'), '2026-07-13 00:00:00');
  assert.strictEqual(getActiveProgram(db).start_date, null);
  setProgramStartDate(db, id, '2026-07-13');
  assert.strictEqual(getActiveProgram(db).start_date, '2026-07-13');
  closeDb();
});

test('listSessions rows carry program_id (for prefill scoping)', () => {
  const db = getDb(':memory:');
  importProgram(db, prog('p'), '2026-07-13 00:00:00');
  const routine = db.prepare('SELECT id FROM routines LIMIT 1').get();
  const sid = createSession(db, { routineId: routine.id, startedAt: '2026-07-14 12:00:00' });
  logSet(db, { sessionId: sid, exerciseName: 'Deadlift', setNumber: 1, weight: 100, reps: 8 });
  const rows = listSessions(db);
  const row = rows.find((r) => r.id === sid);
  assert.ok(row.program_id, 'program_id should be set for a program-routine session');
  // a routine_id NULL session has program_id null
  const free = createSession(db, { routineId: null, startedAt: '2026-07-01 12:00:00' });
  const frow = listSessions(db).find((r) => r.id === free);
  assert.strictEqual(frow.program_id, null);
  closeDb();
});
