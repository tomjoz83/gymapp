'use strict';
const fs = require('node:fs');
const { getDb } = require('../db');
const { createSession, logSet, recomputePRs, findOrCreateExercise } = require('../store');

function migrateFromJson(db, jsonData) {
  const workouts = (jsonData && jsonData.workouts) || [];
  let sessions = 0;
  let sets = 0;
  const touchedExercises = new Set();

  db.exec('BEGIN');
  try {
    for (const w of workouts) {
      const startedAt = w.date || w.created_at || null;
      const sid = createSession(db, {
        startedAt,
        finishedAt: w.completed_at || null,
        notes: w.notes || null,
      });
      sessions += 1;

      let setNumber = 0;
      for (const s of w.sets || []) {
        if (!s.exercise) continue;
        setNumber += 1;
        const exerciseId = findOrCreateExercise(db, s.exercise);
        logSet(db, {
          sessionId: sid,
          exerciseName: s.exercise,
          setNumber,
          weight: s.weight != null ? Number(s.weight) : null,
          reps: s.reps != null ? Number(s.reps) : null,
          rpe: s.rpe != null ? Number(s.rpe) : null,
        });
        sets += 1;
        touchedExercises.add(exerciseId);
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  for (const exId of touchedExercises) recomputePRs(db, exId);
  return { sessions, sets };
}

if (require.main === module) {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: node scripts/migrate-from-json.js <data.json>');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(path, 'utf8'));
  const db = getDb();
  const counts = migrateFromJson(db, data);
  console.log(`Migrated ${counts.sessions} sessions, ${counts.sets} sets.`);
}

module.exports = { migrateFromJson };
