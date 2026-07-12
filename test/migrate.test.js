const { test } = require('node:test');
const assert = require('node:assert');
const { getDb, closeDb } = require('../db');
const { migrateFromJson } = require('../scripts/migrate-from-json');

test('migrateFromJson maps workouts to sessions and sets to set_logs', () => {
  const db = getDb(':memory:');
  const data = {
    nextId: 5,
    workouts: [
      {
        id: 1, name: 'Push Day', date: '2026-07-06',
        created_at: '2026-07-06 00:00:00', completed_at: '2026-07-06 11:00:00',
        notes: 'block 1',
        sets: [
          { id: 2, exercise: 'Bench Press', sets: 3, reps: 8, weight: 60, rpe: 7 },
          { id: 3, exercise: 'Bench Press', sets: 3, reps: 8, weight: 60, rpe: 8 },
        ],
      },
    ],
  };
  const counts = migrateFromJson(db, data);
  assert.strictEqual(counts.sessions, 1);
  assert.strictEqual(counts.sets, 2);

  const session = db.prepare('SELECT * FROM workout_sessions').get();
  assert.strictEqual(session.started_at, '2026-07-06');
  assert.strictEqual(session.finished_at, '2026-07-06 11:00:00');

  const logs = db.prepare('SELECT * FROM set_logs ORDER BY set_number').all();
  assert.strictEqual(logs.length, 2);
  assert.strictEqual(logs[0].weight, 60);

  const pr = db.prepare('SELECT * FROM personal_records').get();
  assert.ok(pr, 'PRs recomputed');
  closeDb();
});

test('migrateFromJson handles rest days and missing rpe', () => {
  const db = getDb(':memory:');
  const data = {
    workouts: [
      { id: 1, name: 'Rest', date: '2026-07-07', created_at: '2026-07-07 00:00:00', completed_at: null, notes: 'rest', sets: [] },
      { id: 2, name: 'Legs', date: '2026-07-08', created_at: '2026-07-08 00:00:00', completed_at: null, notes: '', sets: [ { id: 3, exercise: 'Squat', sets: 3, reps: 5, weight: 100 } ] },
    ],
  };
  const counts = migrateFromJson(db, data);
  assert.strictEqual(counts.sessions, 2);
  assert.strictEqual(counts.sets, 1);
  const sessionCount = db.prepare('SELECT COUNT(*) c FROM workout_sessions').get().c;
  assert.strictEqual(sessionCount, 2);
  const log = db.prepare("SELECT * FROM set_logs").get();
  assert.strictEqual(log.rpe, null);
  closeDb();
});
