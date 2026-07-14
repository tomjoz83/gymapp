'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const L = require('../public/logic.js');
const { getDb, closeDb } = require('../db');
const { planTimestampMigration } = require('../scripts/migrate-timestamps-nz');

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
  const startedConv = plan.convert.find((c) => c.id === timed && c.field === 'started_at');
  assert.strictEqual(startedConv.to, '2026-07-14 07:06:17');
  closeDb();
});
