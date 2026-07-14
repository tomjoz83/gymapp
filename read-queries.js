'use strict';

const { est1RM } = require('./store');

function getActiveProgram(db) {
  const p = db.prepare(
    'SELECT id, name, slug, description, start_date FROM programs WHERE active = 1'
  ).get();
  if (!p) return null;
  const weekCount = db.prepare(
    'SELECT COUNT(*) c FROM program_weeks WHERE program_id = ?'
  ).get(p.id).c;
  return { id: p.id, name: p.name, slug: p.slug, description: p.description, start_date: p.start_date, weekCount };
}

function getProgramWeek(db, weekNumber) {
  const prog = db.prepare('SELECT id FROM programs WHERE active = 1').get();
  if (!prog) return null;
  const week = db.prepare(
    'SELECT id, week_number, label FROM program_weeks WHERE program_id = ? AND week_number = ?'
  ).get(prog.id, weekNumber);
  if (!week) return null;
  const routines = db.prepare(
    'SELECT id, name, day_of_week FROM routines WHERE program_week_id = ? ORDER BY order_index'
  ).all(week.id);
  for (const r of routines) {
    r.exercises = db.prepare(
      `SELECT e.name AS exercise, rx.target_sets, rx.target_reps, rx.target_weight,
              rx.target_rpe, rx.rest_seconds
         FROM routine_exercises rx
         JOIN exercises e ON e.id = rx.exercise_id
        WHERE rx.routine_id = ?
        ORDER BY rx.order_index`
    ).all(r.id);
  }
  return { week_number: week.week_number, label: week.label, routines };
}

function listSessions(db) {
  return db.prepare(
    `SELECT ws.id, ws.started_at, ws.finished_at,
            r.name AS routine_name,
            w.program_id AS program_id,
            (SELECT COUNT(*) FROM set_logs sl WHERE sl.session_id = ws.id) AS set_count
       FROM workout_sessions ws
       LEFT JOIN routines r ON r.id = ws.routine_id
       LEFT JOIN program_weeks w ON w.id = r.program_week_id
      ORDER BY ws.started_at DESC, ws.id DESC`
  ).all();
}

function getSession(db, id) {
  const s = db.prepare('SELECT id, started_at, finished_at, notes FROM workout_sessions WHERE id = ?').get(id);
  if (!s) return null;
  s.sets = db.prepare(
    `SELECT sl.id, e.name AS exercise, sl.set_number, sl.weight, sl.reps, sl.rpe,
            sl.is_warmup, sl.is_complete
       FROM set_logs sl JOIN exercises e ON e.id = sl.exercise_id
      WHERE sl.session_id = ?
      ORDER BY sl.set_number, sl.id`
  ).all(id);
  return s;
}

function getProgress(db, exerciseName) {
  const ex = db.prepare('SELECT id FROM exercises WHERE name = ?').get(exerciseName);
  if (!ex) return { exercise: exerciseName, history: [], pr: null };
  const rows = db.prepare(
    `SELECT ws.id AS session_id, ws.started_at AS date, sl.weight, sl.reps
       FROM set_logs sl JOIN workout_sessions ws ON ws.id = sl.session_id
      WHERE sl.exercise_id = ? AND sl.is_warmup = 0 AND sl.is_complete = 1
        AND sl.weight IS NOT NULL AND sl.reps IS NOT NULL
      ORDER BY ws.started_at ASC, ws.id ASC`
  ).all(ex.id);

  const bySession = new Map();
  for (const r of rows) {
    let h = bySession.get(r.session_id);
    if (!h) { h = { date: r.date, top_weight: 0, est_1rm: 0, volume: 0 }; bySession.set(r.session_id, h); }
    h.top_weight = Math.max(h.top_weight, r.weight);
    h.est_1rm = Math.max(h.est_1rm, est1RM(r.weight, r.reps));
    h.volume += r.weight * r.reps;
  }
  const pr = db.prepare(
    'SELECT rep_count, best_weight, best_est_1rm FROM personal_records WHERE exercise_id = ? ORDER BY best_est_1rm DESC LIMIT 1'
  ).get(ex.id) || null;
  return { exercise: exerciseName, history: Array.from(bySession.values()), pr };
}

function findSessionForSlot(db, { routineId, date }) {
  const row = db.prepare(
    `SELECT id, started_at, finished_at FROM workout_sessions
      WHERE routine_id = ? AND substr(started_at, 1, 10) = ?
      ORDER BY id DESC LIMIT 1`
  ).get(routineId, date);
  return row || null;
}

function listLoggedExercises(db) {
  return db.prepare(
    `SELECT e.name AS name,
            COUNT(DISTINCT sl.session_id) AS session_count,
            MAX(substr(ws.started_at,1,10)) AS last_date
       FROM set_logs sl
       JOIN exercises e ON e.id = sl.exercise_id
       JOIN workout_sessions ws ON ws.id = sl.session_id
      WHERE sl.is_warmup = 0 AND sl.weight IS NOT NULL
      GROUP BY e.id
      ORDER BY last_date DESC, e.name ASC`
  ).all();
}

module.exports = { getActiveProgram, getProgramWeek, listSessions, getSession, getProgress, findSessionForSlot, listLoggedExercises };
