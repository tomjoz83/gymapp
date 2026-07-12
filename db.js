'use strict';
const { DatabaseSync } = require('node:sqlite');

let cached = null;
let cachedPath = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  muscle_group TEXT,
  equipment TEXT,
  tracking_type TEXT NOT NULL DEFAULT 'weight_reps',
  notes TEXT
);
CREATE TABLE IF NOT EXISTS programs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS program_weeks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  week_number INTEGER NOT NULL,
  label TEXT
);
CREATE TABLE IF NOT EXISTS routines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  program_week_id INTEGER NOT NULL REFERENCES program_weeks(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  day_of_week TEXT,
  order_index INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS routine_exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  routine_id INTEGER NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  exercise_id INTEGER NOT NULL REFERENCES exercises(id),
  order_index INTEGER NOT NULL DEFAULT 0,
  target_sets INTEGER,
  target_reps INTEGER,
  target_weight REAL,
  target_rpe INTEGER,
  rest_seconds INTEGER
);
CREATE TABLE IF NOT EXISTS workout_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  routine_id INTEGER REFERENCES routines(id),
  started_at TEXT,
  finished_at TEXT,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS set_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  exercise_id INTEGER NOT NULL REFERENCES exercises(id),
  set_number INTEGER NOT NULL,
  weight REAL,
  reps INTEGER,
  rpe INTEGER,
  is_warmup INTEGER NOT NULL DEFAULT 0,
  is_complete INTEGER NOT NULL DEFAULT 1,
  note TEXT
);
CREATE TABLE IF NOT EXISTS personal_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exercise_id INTEGER NOT NULL REFERENCES exercises(id),
  rep_count INTEGER NOT NULL,
  best_weight REAL,
  best_est_1rm REAL,
  achieved_at TEXT,
  UNIQUE(exercise_id, rep_count)
);
`;

function getDb(path) {
  const target = path || process.env.DB_PATH || './gym.db';
  if (cached && cachedPath === target) return cached;
  if (cached) cached.close();
  const db = new DatabaseSync(target);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  cached = db;
  cachedPath = target;
  return db;
}

function closeDb() {
  if (cached) {
    cached.close();
    cached = null;
    cachedPath = null;
  }
}

module.exports = { getDb, closeDb };
