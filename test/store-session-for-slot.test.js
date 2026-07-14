'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { getDb, closeDb } = require('../db');
const { importProgram, findOrCreateSessionForSlot, logSet } = require('../store');
const { findSessionForSlot } = require('../read-queries');

function prog() {
  return { slug: 'p', name: 'P', active: true, weeks: [{ week_number: 1, routines: [
    { name: 'Pull', day_of_week: 'Tuesday', exercises: [{ exercise: 'Deadlift', target_sets: 3, target_reps: 8 }] } ] }] };
}

test('findOrCreateSessionForSlot is idempotent per (date, routine)', () => {
  const db = getDb(':memory:');
  importProgram(db, prog(), '2026-07-13 00:00:00');
  const routine = db.prepare('SELECT id FROM routines LIMIT 1').get();

  const a = findOrCreateSessionForSlot(db, { routineId: routine.id, date: '2026-07-14' });
  assert.strictEqual(a.created, true);
  const b = findOrCreateSessionForSlot(db, { routineId: routine.id, date: '2026-07-14' });
  assert.strictEqual(b.created, false);
  assert.strictEqual(b.id, a.id, 'same slot must return the same session');
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM workout_sessions').get().c, 1);
  closeDb();
});

test('different dates for the same routine are different sessions', () => {
  const db = getDb(':memory:');
  importProgram(db, prog(), '2026-07-13 00:00:00');
  const routine = db.prepare('SELECT id FROM routines LIMIT 1').get();
  const a = findOrCreateSessionForSlot(db, { routineId: routine.id, date: '2026-07-14' });
  const b = findOrCreateSessionForSlot(db, { routineId: routine.id, date: '2026-07-21' });
  assert.notStrictEqual(a.id, b.id);
  closeDb();
});

test('findSessionForSlot returns null when none, the row when present', () => {
  const db = getDb(':memory:');
  importProgram(db, prog(), '2026-07-13 00:00:00');
  const routine = db.prepare('SELECT id FROM routines LIMIT 1').get();
  assert.strictEqual(findSessionForSlot(db, { routineId: routine.id, date: '2026-07-14' }), null);
  const { id } = findOrCreateSessionForSlot(db, { routineId: routine.id, date: '2026-07-14' });
  const found = findSessionForSlot(db, { routineId: routine.id, date: '2026-07-14' });
  assert.strictEqual(found.id, id);
  closeDb();
});
