const { test } = require('node:test');
const assert = require('node:assert');
const { getDb, closeDb } = require('../db');
const { createSession, logSet, recomputePRs, findOrCreateExercise } = require('../store');
const { listSessions, getSession, getProgress } = require('../read-queries');

test('listSessions and getSession return sessions and their sets', () => {
  const db = getDb(':memory:');
  const s1 = createSession(db, { startedAt: '2026-07-01 10:00:00' });
  logSet(db, { sessionId: s1, exerciseName: 'Bench Press', setNumber: 1, weight: 60, reps: 8 });
  logSet(db, { sessionId: s1, exerciseName: 'Bench Press', setNumber: 2, weight: 60, reps: 8 });

  const list = listSessions(db);
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].set_count, 2);

  const full = getSession(db, s1);
  assert.strictEqual(full.sets.length, 2);
  assert.strictEqual(full.sets[0].exercise, 'Bench Press');
  assert.strictEqual(getSession(db, 9999), null);
  closeDb();
});

test('getProgress aggregates per-session history and PR', () => {
  const db = getDb(':memory:');
  const s1 = createSession(db, { startedAt: '2026-07-01 10:00:00' });
  logSet(db, { sessionId: s1, exerciseName: 'Bench Press', setNumber: 1, weight: 60, reps: 8 });
  logSet(db, { sessionId: s1, exerciseName: 'Bench Press', setNumber: 2, weight: 62.5, reps: 6 });
  recomputePRs(db, findOrCreateExercise(db, 'Bench Press'));

  const prog = getProgress(db, 'Bench Press');
  assert.strictEqual(prog.exercise, 'Bench Press');
  assert.strictEqual(prog.history.length, 1);
  assert.strictEqual(prog.history[0].top_weight, 62.5);
  assert.ok(prog.history[0].volume === 60 * 8 + 62.5 * 6);
  assert.ok(prog.pr, 'has a PR row');
  closeDb();
});

test('getProgress returns empty for unknown exercise', () => {
  const db = getDb(':memory:');
  const prog = getProgress(db, 'Nonexistent');
  assert.deepStrictEqual(prog, { exercise: 'Nonexistent', history: [], pr: null });
  closeDb();
});

test('getProgress excludes warmup and incomplete sets', () => {
  const db = getDb(':memory:');
  const s1 = createSession(db, { startedAt: '2026-07-01 10:00:00' });
  // a warmup set (should be ignored) + a real work set
  logSet(db, { sessionId: s1, exerciseName: 'Squat', setNumber: 1, weight: 40, reps: 10, isWarmup: true });
  logSet(db, { sessionId: s1, exerciseName: 'Squat', setNumber: 2, weight: 100, reps: 5 });
  const prog = getProgress(db, 'Squat');
  assert.strictEqual(prog.history.length, 1);
  // volume should be only the work set (100*5), not include the 40*10 warmup
  assert.strictEqual(prog.history[0].volume, 100 * 5);
  assert.strictEqual(prog.history[0].top_weight, 100);
  closeDb();
});
