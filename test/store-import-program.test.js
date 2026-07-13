const { test } = require('node:test');
const assert = require('node:assert');
const { getDb, closeDb } = require('../db');
const { importProgram } = require('../store');

function sampleProgram(overrides = {}) {
  return {
    slug: 'ppl', name: 'PPL', description: 'd', active: true,
    weeks: [
      { week_number: 1, label: 'W1', routines: [
        { name: 'Push', day_of_week: 'Monday', exercises: [
          { exercise: 'Bench Press', target_sets: 4, target_reps: 8, target_weight: 60, target_rpe: 7, rest_seconds: 120 },
          { exercise: 'Overhead Press', target_sets: 3, target_reps: 10 },
        ] },
        { name: 'Rest', exercises: [] },
      ] },
    ],
    ...overrides,
  };
}

test('importProgram inserts program, weeks, routines, exercises', () => {
  const db = getDb(':memory:');
  const id = importProgram(db, sampleProgram(), '2026-07-13 12:00:00');
  assert.ok(id > 0);
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM programs').get().c, 1);
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM program_weeks').get().c, 1);
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM routines').get().c, 2);
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM routine_exercises').get().c, 2);
  const prog = db.prepare('SELECT * FROM programs WHERE id = ?').get(id);
  assert.strictEqual(prog.slug, 'ppl');
  assert.strictEqual(prog.active, 1);
  const rx = db.prepare('SELECT order_index FROM routine_exercises ORDER BY order_index').all();
  assert.deepStrictEqual(rx.map((r) => r.order_index), [0, 1]);
  closeDb();
});

test('importProgram upserts by slug (no duplicate)', () => {
  const db = getDb(':memory:');
  importProgram(db, sampleProgram(), '2026-07-13 12:00:00');
  importProgram(db, sampleProgram({ name: 'PPL v2' }), '2026-07-14 12:00:00');
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM programs').get().c, 1);
  assert.strictEqual(db.prepare('SELECT name FROM programs').get().name, 'PPL v2');
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM program_weeks').get().c, 1);
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM routines').get().c, 2);
  closeDb();
});

test('importProgram active flag clears active on others', () => {
  const db = getDb(':memory:');
  importProgram(db, sampleProgram({ slug: 'a', active: true }), '2026-07-13 12:00:00');
  importProgram(db, sampleProgram({ slug: 'b', active: true }), '2026-07-13 12:00:00');
  const active = db.prepare('SELECT slug FROM programs WHERE active = 1').all().map((r) => r.slug);
  assert.deepStrictEqual(active, ['b']);
  closeDb();
});

test('importProgram throws on invalid program', () => {
  const db = getDb(':memory:');
  assert.throws(() => importProgram(db, { slug: 'BAD SLUG', name: '' }, '2026-07-13 12:00:00'));
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM programs').get().c, 0);
  closeDb();
});
