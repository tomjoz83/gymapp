'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getDb, closeDb } = require('../db');
const { importProgramsFromDir } = require('../scripts/import-programs');
const { createSession, logSet } = require('../store');

test('real programs/ dir: log a workout, then re-deploy import is a no-op', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-'));
  const db = getDb(path.join(dir, 't.db'));
  const programsDir = path.join(__dirname, '..', 'programs');

  const first = importProgramsFromDir(db, programsDir, '2026-07-14 00:00:00');
  assert.ok(first.imported.includes('ppl-6wk-hypertrophy'), 'program should import first time');
  assert.deepStrictEqual(first.errors, []);

  // Simulate the real event: a workout logged against a program routine.
  const routine = db.prepare('SELECT id FROM routines ORDER BY id LIMIT 1').get();
  const sid = createSession(db, { routineId: routine.id, startedAt: '2026-07-14 10:00:00' });
  logSet(db, { sessionId: sid, exerciseName: 'Barbell Bench Press', setNumber: 1, weight: 60, reps: 9 });

  // Re-run deploy import against the SAME real files.
  const second = importProgramsFromDir(db, programsDir, '2026-07-14 12:00:00');
  assert.deepStrictEqual(second.errors, [], 'no FK error on re-import');
  assert.ok(second.unchanged.includes('ppl-6wk-hypertrophy'), 'should report unchanged');
  assert.ok(db.prepare('SELECT id FROM workout_sessions WHERE id = ?').get(sid), 'session survives');
  closeDb();
});
