const { test } = require('node:test');
const assert = require('node:assert');
const { getDb, closeDb } = require('../db');
const { importProgram } = require('../store');
const { getActiveProgram, getProgramWeek } = require('../read-queries');

function seed(db) {
  importProgram(db, {
    slug: 'p', name: 'Prog', description: 'd', active: true,
    weeks: [
      { week_number: 1, label: 'W1', routines: [
        { name: 'Push', day_of_week: 'Monday', exercises: [
          { exercise: 'Bench Press', target_sets: 4, target_reps: 8, target_weight: 60, target_rpe: 7, rest_seconds: 120 },
          { exercise: 'OHP', target_sets: 3, target_reps: 10 },
        ] },
      ] },
      { week_number: 2, label: 'W2', routines: [
        { name: 'Push', day_of_week: 'Monday', exercises: [
          { exercise: 'Bench Press', target_sets: 4, target_reps: 6, target_rpe: 8 },
        ] },
      ] },
    ],
  }, '2026-07-13 12:00:00');
}

test('getActiveProgram returns the active program with week count', () => {
  const db = getDb(':memory:');
  seed(db);
  const p = getActiveProgram(db);
  assert.strictEqual(p.slug, 'p');
  assert.strictEqual(p.weekCount, 2);
  closeDb();
});

test('getProgramWeek returns routines with ordered exercises', () => {
  const db = getDb(':memory:');
  seed(db);
  const w = getProgramWeek(db, 1);
  assert.strictEqual(w.week_number, 1);
  assert.strictEqual(w.routines.length, 1);
  assert.strictEqual(w.routines[0].name, 'Push');
  assert.strictEqual(w.routines[0].exercises.length, 2);
  assert.strictEqual(w.routines[0].exercises[0].exercise, 'Bench Press');
  assert.strictEqual(w.routines[0].exercises[0].target_reps, 8);
  closeDb();
});

test('getActiveProgram returns null when none active', () => {
  const db = getDb(':memory:');
  assert.strictEqual(getActiveProgram(db), null);
  closeDb();
});
