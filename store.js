'use strict';

const { validateProgram } = require('./program-schema');

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

function importProgram(db, program, createdAt = null) {
  const result = validateProgram(program);
  if (!result.valid) {
    throw new Error('invalid program: ' + result.errors.join('; '));
  }
  const stamp = createdAt || '1970-01-01 00:00:00';
  const isActive = program.active ? 1 : 0;

  db.exec('BEGIN');
  try {
    const existing = db.prepare('SELECT id FROM programs WHERE slug = ?').get(program.slug);
    if (existing) {
      db.prepare('DELETE FROM programs WHERE id = ?').run(existing.id);
    }
    const progInfo = db.prepare(
      'INSERT INTO programs (name, slug, description, active, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(program.name, program.slug, program.description || null, isActive, stamp);
    const programId = Number(progInfo.lastInsertRowid);

    if (isActive) {
      db.prepare('UPDATE programs SET active = 0 WHERE id != ?').run(programId);
    }

    const insWeek = db.prepare(
      'INSERT INTO program_weeks (program_id, week_number, label) VALUES (?, ?, ?)'
    );
    const insRoutine = db.prepare(
      'INSERT INTO routines (program_week_id, name, day_of_week, order_index) VALUES (?, ?, ?, ?)'
    );
    const insRx = db.prepare(
      `INSERT INTO routine_exercises
         (routine_id, exercise_id, order_index, target_sets, target_reps, target_weight, target_rpe, rest_seconds)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const w of program.weeks) {
      const weekId = Number(insWeek.run(programId, w.week_number, w.label || null).lastInsertRowid);
      w.routines.forEach((r, ri) => {
        const routineId = Number(insRoutine.run(weekId, r.name, r.day_of_week || null, ri).lastInsertRowid);
        r.exercises.forEach((e, ei) => {
          const exerciseId = findOrCreateExercise(db, e.exercise);
          insRx.run(
            routineId, exerciseId, ei,
            e.target_sets != null ? e.target_sets : null,
            e.target_reps != null ? e.target_reps : null,
            e.target_weight != null ? e.target_weight : null,
            e.target_rpe != null ? e.target_rpe : null,
            e.rest_seconds != null ? e.rest_seconds : null
          );
        });
      });
    }

    db.exec('COMMIT');
    return programId;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { findOrCreateExercise, est1RM, createSession, logSet, recomputePRs, importProgram };
