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

function finishSession(db, id, finishedAt) {
  const info = db.prepare('UPDATE workout_sessions SET finished_at = ? WHERE id = ?').run(finishedAt, id);
  if (info.changes === 0) return null;
  return { id, finished_at: finishedAt };
}

function updateSetLog(db, id, fields = {}) {
  const existing = db.prepare('SELECT * FROM set_logs WHERE id = ?').get(id);
  if (!existing) return null;
  const weight = fields.weight != null ? fields.weight : existing.weight;
  const reps = fields.reps != null ? fields.reps : existing.reps;
  const rpe = fields.rpe !== undefined ? fields.rpe : existing.rpe;
  const isWarmup = fields.isWarmup != null ? (fields.isWarmup ? 1 : 0) : existing.is_warmup;
  const isComplete = fields.isComplete != null ? (fields.isComplete ? 1 : 0) : existing.is_complete;
  db.prepare(
    'UPDATE set_logs SET weight = ?, reps = ?, rpe = ?, is_warmup = ?, is_complete = ? WHERE id = ?'
  ).run(weight, reps, rpe, isWarmup, isComplete, id);
  recomputePRs(db, existing.exercise_id);
  return db.prepare('SELECT * FROM set_logs WHERE id = ?').get(id);
}

function deleteSetLog(db, id) {
  const existing = db.prepare('SELECT exercise_id FROM set_logs WHERE id = ?').get(id);
  if (!existing) return false;
  db.prepare('DELETE FROM set_logs WHERE id = ?').run(id);
  recomputePRs(db, existing.exercise_id);
  return true;
}

function normNum(v) {
  return v === undefined || v === null ? null : v;
}

// Reconstruct a stored program (by slug) into the same normalized shape as an
// incoming validated program JSON, for deep comparison.
function readStoredProgramShape(db, slug) {
  const p = db.prepare(
    'SELECT id, name, description, active FROM programs WHERE slug = ?'
  ).get(slug);
  if (!p) return null;
  const weeks = db.prepare(
    'SELECT id, week_number, label FROM program_weeks WHERE program_id = ? ORDER BY week_number'
  ).all(p.id);
  const shape = {
    name: p.name,
    description: normNum(p.description),
    active: !!p.active,
    weeks: weeks.map((w) => {
      const routines = db.prepare(
        'SELECT id, name, day_of_week FROM routines WHERE program_week_id = ? ORDER BY order_index'
      ).all(w.id);
      return {
        week_number: w.week_number,
        label: normNum(w.label),
        routines: routines.map((r) => {
          const exs = db.prepare(
            `SELECT e.name AS exercise, rx.target_sets, rx.target_reps, rx.target_weight,
                    rx.target_rpe, rx.rest_seconds
               FROM routine_exercises rx JOIN exercises e ON e.id = rx.exercise_id
              WHERE rx.routine_id = ? ORDER BY rx.order_index`
          ).all(r.id);
          return {
            name: r.name,
            day_of_week: normNum(r.day_of_week),
            exercises: exs.map((e) => ({
              exercise: e.exercise,
              target_sets: normNum(e.target_sets),
              target_reps: normNum(e.target_reps),
              target_weight: normNum(e.target_weight),
              target_rpe: normNum(e.target_rpe),
              rest_seconds: normNum(e.rest_seconds),
            })),
          };
        }),
      };
    }),
  };
  return { id: p.id, shape };
}

// Normalize an incoming validated program JSON into the same shape.
function incomingProgramShape(program) {
  const weeks = [...program.weeks].sort((a, b) => a.week_number - b.week_number);
  return {
    name: program.name,
    description: normNum(program.description),
    active: !!program.active,
    weeks: weeks.map((w) => ({
      week_number: w.week_number,
      label: normNum(w.label),
      routines: w.routines.map((r) => ({
        name: r.name,
        day_of_week: normNum(r.day_of_week),
        exercises: r.exercises.map((e) => ({
          exercise: e.exercise,
          target_sets: normNum(e.target_sets),
          target_reps: normNum(e.target_reps),
          target_weight: normNum(e.target_weight),
          target_rpe: normNum(e.target_rpe),
          rest_seconds: normNum(e.rest_seconds),
        })),
      })),
    })),
  };
}

function programExistsMatching(db, program) {
  const stored = readStoredProgramShape(db, program.slug);
  if (!stored) return { match: false, id: null };
  const a = JSON.stringify(stored.shape);
  const b = JSON.stringify(incomingProgramShape(program));
  return { match: a === b, id: stored.id };
}

module.exports = {
  findOrCreateExercise, est1RM, createSession, logSet, recomputePRs, importProgram,
  finishSession, updateSetLog, deleteSetLog, programExistsMatching,
};
