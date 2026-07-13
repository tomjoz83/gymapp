'use strict';

function getActiveProgram(db) {
  const p = db.prepare(
    'SELECT id, name, slug, description FROM programs WHERE active = 1'
  ).get();
  if (!p) return null;
  const weekCount = db.prepare(
    'SELECT COUNT(*) c FROM program_weeks WHERE program_id = ?'
  ).get(p.id).c;
  return { id: p.id, name: p.name, slug: p.slug, description: p.description, weekCount };
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

module.exports = { getActiveProgram, getProgramWeek };
