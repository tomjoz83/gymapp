'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const L = require('../public/logic.js');
const { getDb, closeDb } = require('../db');
const { planTimestampMigration, applyTimestampMigration } = require('../scripts/migrate-timestamps-nz');

test('utcStampToTZ converts a timed UTC stamp to NZ', () => {
  assert.strictEqual(L.utcStampToTZ('Pacific/Auckland', '2026-07-13 19:06:17'), '2026-07-14 07:06:17');
});
test('utcStampToTZ leaves a midnight/date-only stamp unchanged', () => {
  assert.strictEqual(L.utcStampToTZ('Pacific/Auckland', '2026-07-06 00:00:00'), '2026-07-06 00:00:00');
});

test('planTimestampMigration converts timed rows, skips date-only rows', () => {
  const db = getDb(':memory:');
  const { createSession } = require('../store');
  const legacy = createSession(db, { routineId: null, startedAt: '2026-07-06 00:00:00' });
  const timed = createSession(db, { routineId: null, startedAt: '2026-07-13 19:06:17', finishedAt: '2026-07-13 19:50:28' });
  const plan = planTimestampMigration(db, 'Pacific/Auckland');
  const ids = plan.convert.map((c) => c.id);
  assert.ok(ids.includes(timed), 'timed row should be in the plan');
  assert.ok(!ids.includes(legacy), 'legacy date-only row must be skipped');
  // started_at conversion
  const startedConv = plan.convert.find((c) => c.id === timed && c.field === 'started_at');
  assert.strictEqual(startedConv.to, '2026-07-14 07:06:17');
  // finished_at conversion (MINOR: also assert the finished_at entry)
  const finishedConv = plan.convert.find((c) => c.id === timed && c.field === 'finished_at');
  assert.ok(finishedConv, 'finished_at entry should be in the plan');
  assert.strictEqual(finishedConv.to, '2026-07-14 07:50:28');
  closeDb();
});

test('applyTimestampMigration writes converted values; midnight row unchanged', () => {
  const db = getDb(':memory:');
  const { createSession } = require('../store');
  const legacyId = createSession(db, { routineId: null, startedAt: '2026-07-06 00:00:00' });
  const timedId = createSession(db, { routineId: null, startedAt: '2026-07-13 19:06:17', finishedAt: '2026-07-13 19:50:28' });

  const plan = planTimestampMigration(db, 'Pacific/Auckland');
  const count = applyTimestampMigration(db, plan);

  // return value equals the number of converted fields (started_at + finished_at = 2)
  assert.strictEqual(count, 2);

  // timed row: both fields converted to NZ wall-clock
  const timed = db.prepare('SELECT started_at, finished_at FROM workout_sessions WHERE id = ?').get(timedId);
  assert.strictEqual(timed.started_at, '2026-07-14 07:06:17');
  assert.strictEqual(timed.finished_at, '2026-07-14 07:50:28');

  // legacy midnight row: unchanged
  const legacy = db.prepare('SELECT started_at, finished_at FROM workout_sessions WHERE id = ?').get(legacyId);
  assert.strictEqual(legacy.started_at, '2026-07-06 00:00:00');

  closeDb();
});

test('applyTimestampMigration is idempotent — second plan produces empty convert array', () => {
  const db = getDb(':memory:');
  const { createSession } = require('../store');
  createSession(db, { routineId: null, startedAt: '2026-07-06 00:00:00' });
  createSession(db, { routineId: null, startedAt: '2026-07-13 19:06:17', finishedAt: '2026-07-13 19:50:28' });

  // First pass: plan + apply
  const plan1 = planTimestampMigration(db, 'Pacific/Auckland');
  applyTimestampMigration(db, plan1);

  // Second pass: already-NZ stamps no longer match the midnight guard and are not UTC → empty convert
  const plan2 = planTimestampMigration(db, 'Pacific/Auckland');
  assert.strictEqual(plan2.convert.length, 0, 'second run must produce zero conversions (no double-shift)');

  closeDb();
});
