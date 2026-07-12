'use strict';

function findOrCreateExercise(db, name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('exercise name required');
  const existing = db.prepare('SELECT id FROM exercises WHERE name = ?').get(trimmed);
  if (existing) return existing.id;
  const info = db.prepare('INSERT INTO exercises (name) VALUES (?)').run(trimmed);
  return Number(info.lastInsertRowid);
}

function est1RM(weight, reps) {
  const w = Number(weight);
  const r = Number(reps);
  if (!Number.isFinite(w) || !Number.isFinite(r) || w <= 0 || r <= 0) return 0;
  return w * (1 + r / 30);
}

function createSession(db, { routineId = null, startedAt = null, finishedAt = null, notes = null } = {}) {
  const info = db.prepare(
    'INSERT INTO workout_sessions (routine_id, started_at, finished_at, notes) VALUES (?, ?, ?, ?)'
  ).run(routineId, startedAt, finishedAt, notes);
  return Number(info.lastInsertRowid);
}

function logSet(db, { sessionId, exerciseName, setNumber, weight = null, reps = null, rpe = null, isWarmup = false, isComplete = true, note = null }) {
  const exerciseId = findOrCreateExercise(db, exerciseName);
  const info = db.prepare(
    `INSERT INTO set_logs
       (session_id, exercise_id, set_number, weight, reps, rpe, is_warmup, is_complete, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(sessionId, exerciseId, setNumber, weight, reps, rpe,
        isWarmup ? 1 : 0, isComplete ? 1 : 0, note);
  return Number(info.lastInsertRowid);
}

module.exports = { findOrCreateExercise, est1RM, createSession, logSet };
