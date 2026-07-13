const { test } = require('node:test');
const assert = require('node:assert');
const { getDb, closeDb } = require('../db');

test('getDb creates all tables', () => {
  const db = getDb(':memory:');
  const rows = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all();
  const names = rows.map((r) => r.name);
  for (const t of [
    'exercises', 'programs', 'program_weeks', 'routines',
    'routine_exercises', 'workout_sessions', 'set_logs', 'personal_records',
  ]) {
    assert.ok(names.includes(t), `missing table: ${t}`);
  }
  closeDb();
});
