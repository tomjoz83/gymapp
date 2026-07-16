// test/db-schema-shared.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { SCHEMA } = require('../public/db-schema.js');
const { DatabaseSync } = require('node:sqlite');

test('shared SCHEMA creates all 8 tables incl programs.start_date', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);
  for (const t of ['exercises','programs','program_weeks','routines','routine_exercises','workout_sessions','set_logs','personal_records'])
    assert.ok(tables.includes(t), 'missing '+t);
  const cols = db.prepare('PRAGMA table_info(programs)').all().map((c) => c.name);
  assert.ok(cols.includes('start_date'));
  db.close();
});
