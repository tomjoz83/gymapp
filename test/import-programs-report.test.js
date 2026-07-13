'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getDb, closeDb } = require('../db');
const { importProgramsFromDir } = require('../scripts/import-programs');

function writeProg(dir, obj) {
  fs.writeFileSync(path.join(dir, obj.slug + '.json'), JSON.stringify(obj));
}
function prog() {
  return { slug: 'ppl', name: 'PPL', active: true,
    weeks: [{ week_number: 1, routines: [
      { name: 'Pull', exercises: [{ exercise: 'Deadlift', target_sets: 3, target_reps: 8 }] } ] }] };
}

test('report distinguishes imported / unchanged', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imp-'));
  writeProg(dir, prog());
  const db = getDb(path.join(dir, 't.db'));

  const first = importProgramsFromDir(db, dir, '2026-07-14 00:00:00');
  assert.deepStrictEqual(first.imported, ['ppl']);
  assert.deepStrictEqual(first.unchanged, []);
  assert.deepStrictEqual(first.errors, []);

  const second = importProgramsFromDir(db, dir, '2026-07-14 00:00:00');
  assert.deepStrictEqual(second.imported, []);
  assert.deepStrictEqual(second.unchanged, ['ppl']);
  assert.deepStrictEqual(second.errors, []);
  closeDb();
});

test('report flags a changed program as skipped, not imported', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imp-'));
  writeProg(dir, prog());
  const db = getDb(path.join(dir, 't.db'));
  importProgramsFromDir(db, dir, '2026-07-14 00:00:00');
  const changed = prog(); changed.weeks[0].routines[0].exercises[0].target_reps = 12;
  writeProg(dir, changed);
  const r = importProgramsFromDir(db, dir, '2026-07-14 00:00:00');
  assert.deepStrictEqual(r.skipped, ['ppl']);
  assert.deepStrictEqual(r.imported, []);
  closeDb();
});
