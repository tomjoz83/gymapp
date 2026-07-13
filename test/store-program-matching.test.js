'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { getDb, closeDb } = require('../db');
const { importProgram, programExistsMatching } = require('../store');

function sampleProgram() {
  return {
    slug: 'p', name: 'Prog', description: 'd', active: true,
    weeks: [{ week_number: 1, label: 'W1', routines: [
      { name: 'Push', day_of_week: 'Monday', exercises: [
        { exercise: 'Bench Press', target_sets: 4, target_reps: 8, target_weight: 60, target_rpe: 7, rest_seconds: 120 },
        { exercise: 'Overhead Press', target_sets: 3, target_reps: 10, target_rpe: 7, rest_seconds: 90 },
      ] },
    ] }],
  };
}

test('programExistsMatching: absent slug -> {match:false, id:null}', () => {
  const db = getDb(':memory:');
  const r = programExistsMatching(db, sampleProgram());
  assert.deepStrictEqual(r, { match: false, id: null });
  closeDb();
});

test('programExistsMatching: identical stored program -> match true, id set', () => {
  const db = getDb(':memory:');
  const id = importProgram(db, sampleProgram(), '2026-07-14 00:00:00');
  const r = programExistsMatching(db, sampleProgram());
  assert.strictEqual(r.match, true);
  assert.strictEqual(r.id, id);
  closeDb();
});

test('programExistsMatching: same slug, changed content -> match false, id set', () => {
  const db = getDb(':memory:');
  const id = importProgram(db, sampleProgram(), '2026-07-14 00:00:00');
  const changed = sampleProgram();
  changed.weeks[0].routines[0].exercises[0].target_reps = 12; // was 8
  const r = programExistsMatching(db, changed);
  assert.strictEqual(r.match, false);
  assert.strictEqual(r.id, id);
  closeDb();
});

test('programExistsMatching: absent optional numeric (target_weight) equals stored NULL', () => {
  const db = getDb(':memory:');
  // second exercise has no target_weight; stored as NULL. Re-check must still match.
  importProgram(db, sampleProgram(), '2026-07-14 00:00:00');
  const r = programExistsMatching(db, sampleProgram());
  assert.strictEqual(r.match, true);
  closeDb();
});

test('programExistsMatching: empty-string description matches stored NULL (import stores "" as NULL)', () => {
  const db = getDb(':memory:');
  const p = sampleProgram();
  p.description = ''; // import stores "" as NULL via `description || null`
  importProgram(db, p, '2026-07-14 00:00:00');
  const r = programExistsMatching(db, p);
  assert.strictEqual(r.match, true, 'empty description must not falsely report as differing');
  closeDb();
});
