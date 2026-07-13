'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { getDb, closeDb } = require('../db');
const {
  importProgram, createSession, logSet, assertNoDependentSessions,
} = require('../store');

function prog() {
  return {
    slug: 'ppl', name: 'PPL', description: 'd', active: true,
    weeks: [{ week_number: 1, label: 'W1', routines: [
      { name: 'Pull Day', day_of_week: 'Tuesday', exercises: [
        { exercise: 'Deadlift', target_sets: 3, target_reps: 8, target_rpe: 7, rest_seconds: 180 },
      ] },
    ] }],
  };
}

// The regression: re-importing the SAME program after a session references
// one of its routines must NOT throw and must NOT destroy the session.
test('re-import of unchanged program with a dependent session is a safe no-op', () => {
  const db = getDb(':memory:');
  const id1 = importProgram(db, prog(), '2026-07-14 00:00:00');
  const routine = db.prepare('SELECT id FROM routines LIMIT 1').get();
  const sid = createSession(db, { routineId: routine.id, startedAt: '2026-07-14 10:00:00' });
  logSet(db, { sessionId: sid, exerciseName: 'Deadlift', setNumber: 1, weight: 100, reps: 5 });

  const id2 = importProgram(db, prog(), '2026-07-14 12:00:00'); // same JSON again

  assert.strictEqual(id2, id1, 'program id should be unchanged (no delete/recreate)');
  const stillThere = db.prepare('SELECT id FROM workout_sessions WHERE id = ?').get(sid);
  assert.ok(stillThere, 'the dependent session must survive re-import');
  const routineStill = db.prepare('SELECT id FROM routines WHERE id = ?').get(routine.id);
  assert.ok(routineStill, 'the routine must not be recycled/deleted');
  closeDb();
});

test('importing a genuinely new program still works', () => {
  const db = getDb(':memory:');
  importProgram(db, prog(), '2026-07-14 00:00:00');
  const other = prog(); other.slug = 'other'; other.name = 'Other'; other.active = false;
  const id = importProgram(db, other, '2026-07-14 00:00:00');
  assert.ok(Number.isInteger(id));
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM programs').get().c, 2);
  closeDb();
});

test('same slug with changed content returns existing id and does not throw or delete', () => {
  const db = getDb(':memory:');
  const id1 = importProgram(db, prog(), '2026-07-14 00:00:00');
  const routine = db.prepare('SELECT id FROM routines LIMIT 1').get();
  const sid = createSession(db, { routineId: routine.id, startedAt: '2026-07-14 10:00:00' });
  const changed = prog(); changed.weeks[0].routines[0].exercises[0].target_reps = 12;
  const id2 = importProgram(db, changed, '2026-07-14 12:00:00');
  assert.strictEqual(id2, id1);
  assert.ok(db.prepare('SELECT id FROM workout_sessions WHERE id = ?').get(sid));
  closeDb();
});

test('assertNoDependentSessions throws a readable error when dependents exist', () => {
  const db = getDb(':memory:');
  const pid = importProgram(db, prog(), '2026-07-14 00:00:00');
  const routine = db.prepare('SELECT id FROM routines LIMIT 1').get();
  createSession(db, { routineId: routine.id, startedAt: '2026-07-14 10:00:00' });
  assert.throws(() => assertNoDependentSessions(db, pid),
    /Cannot delete program .*workout session\(s\) reference its routines/);
  closeDb();
});

test('assertNoDependentSessions is a no-op when there are none', () => {
  const db = getDb(':memory:');
  const pid = importProgram(db, prog(), '2026-07-14 00:00:00');
  assert.strictEqual(assertNoDependentSessions(db, pid), undefined);
  closeDb();
});
