'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { getDb, closeDb } = require('../db');
const { importProgram } = require('../store');
const { getCurrentProgramJson } = require('../read-queries');

function prog() {
  return { slug: 'ppl', name: 'PPL', description: 'd', active: true,
    weeks: [{ week_number: 1, label: 'W1', routines: [
      { name: 'Push', day_of_week: 'Monday', exercises: [
        { exercise: 'Bench', target_sets: 4, target_reps: 8, target_rpe: 7, rest_seconds: 120 } ] } ] }] };
}

test('getCurrentProgramJson returns importProgram-shaped object', () => {
  const DB1 = '/tmp/pc-test-import-' + process.pid + '.db';
  fs.rmSync(DB1, { force: true });
  const db = getDb(DB1);
  importProgram(db, prog(), '2026-07-13 00:00:00');
  const json = getCurrentProgramJson(db);
  assert.strictEqual(json.slug, 'ppl');
  assert.strictEqual(json.name, 'PPL');
  assert.strictEqual(json.active, true);
  assert.strictEqual(json.weeks.length, 1);
  assert.strictEqual(json.weeks[0].week_number, 1);
  assert.strictEqual(json.weeks[0].routines[0].name, 'Push');
  assert.strictEqual(json.weeks[0].routines[0].day_of_week, 'Monday');
  assert.strictEqual(json.weeks[0].routines[0].exercises[0].exercise, 'Bench');
  assert.strictEqual(json.weeks[0].routines[0].exercises[0].target_sets, 4);
  assert.strictEqual(json.weeks[0].routines[0].exercises[0].target_reps, 8);
  assert.strictEqual(json.weeks[0].routines[0].exercises[0].target_rpe, 7);
  assert.strictEqual(json.weeks[0].routines[0].exercises[0].target_reps, 8);
  assert.strictEqual(json.weeks[0].routines[0].exercises[0].rest_seconds, 120);
  closeDb();
  fs.rmSync(DB1, { force: true });
});

test('getCurrentProgramJson round-trip: re-importing the shape reproduces the program', () => {
  const DB1 = '/tmp/pc-test-src-' + process.pid + '.db';
  const DB2 = '/tmp/pc-test-dst-' + process.pid + '.db';
  fs.rmSync(DB1, { force: true });
  fs.rmSync(DB2, { force: true });

  // Import original into DB1, get JSON shape
  const db1 = getDb(DB1);
  importProgram(db1, prog(), '2026-07-13 00:00:00');
  const json = getCurrentProgramJson(db1);
  closeDb();

  // Re-import returned JSON into DB2
  const db2 = getDb(DB2);
  importProgram(db2, json, '2026-07-13 00:00:00');
  const row = db2.prepare("SELECT id FROM programs WHERE slug='ppl'").get();
  assert.ok(row, 'program should exist in re-imported db');
  closeDb();

  fs.rmSync(DB1, { force: true });
  fs.rmSync(DB2, { force: true });
});

test('getCurrentProgramJson returns null with no active program', () => {
  const db = getDb(':memory:');
  assert.strictEqual(getCurrentProgramJson(db), null);
  closeDb();
});
