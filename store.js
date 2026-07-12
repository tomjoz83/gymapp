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

function recomputePRs(db, exerciseId) {
  const rows = db.prepare(
    `SELECT sl.reps AS reps, sl.weight AS weight, ws.started_at AS at
       FROM set_logs sl
       JOIN workout_sessions ws ON ws.id = sl.session_id
      WHERE sl.exercise_id = ? AND sl.is_warmup = 0 AND sl.is_complete = 1
        AND sl.weight IS NOT NULL AND sl.reps IS NOT NULL AND sl.reps > 0`
  ).all(exerciseId);

  const best = new Map(); // rep_count -> {weight, est, at}
  for (const r of rows) {
    const est = est1RM(r.weight, r.reps);
    const cur = best.get(r.reps);
    if (!cur || est > cur.est) {
      best.set(r.reps, { weight: r.weight, est, at: r.at });
    }
  }

  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM personal_records WHERE exercise_id = ?').run(exerciseId);
    const ins = db.prepare(
      `INSERT INTO personal_records (exercise_id, rep_count, best_weight, best_est_1rm, achieved_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    for (const [repCount, v] of best) {
      ins.run(exerciseId, repCount, v.weight, v.est, v.at);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { findOrCreateExercise, est1RM, createSession, logSet, recomputePRs };
