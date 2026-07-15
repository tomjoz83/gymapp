'use strict';
const { DatabaseSync } = require('node:sqlite');
const { SCHEMA } = require('./public/db-schema.js');

let cached = null;
let cachedPath = null;

function getDb(path) {
  const target = path || process.env.DB_PATH || './gym.db';
  if (cached && cachedPath === target) return cached;
  if (cached) {
    cached.close();
    cached = null;
    cachedPath = null;
  }
  const db = new DatabaseSync(target);
  db.exec('PRAGMA foreign_keys = ON;');
  // Migration: if a pre-existing programs table predates the `slug` column,
  // drop the (always-empty until Phase 2) program tables so SCHEMA recreates
  // them with the new shape. Never touches sessions/set_logs/exercises/PRs.
  const programsRow = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='programs'"
  ).get();
  if (programsRow) {
    const cols = db.prepare('PRAGMA table_info(programs)').all().map((c) => c.name);
    if (!cols.includes('slug')) {
      db.exec(`
        DROP TABLE IF EXISTS routine_exercises;
        DROP TABLE IF EXISTS routines;
        DROP TABLE IF EXISTS program_weeks;
        DROP TABLE IF EXISTS programs;
      `);
    }
  }
  // Re-query programs existence: the slug-migration block above may have
  // DROPped the table, so the pre-drop value would be stale. Fresh query
  // guarantees correct behaviour for all three cases:
  //   fresh DB            → no row, no ALTER (SCHEMA creates with start_date)
  //   pre-slug DB         → table was dropped above, no row, no ALTER
  //   Phase-2 DB (slug, no start_date) → row present, ALTER adds column
  const programsRowNow = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='programs'"
  ).get();
  if (programsRowNow) {
    const cols2 = db.prepare('PRAGMA table_info(programs)').all().map((c) => c.name);
    if (cols2.includes('slug') && !cols2.includes('start_date')) {
      db.exec('ALTER TABLE programs ADD COLUMN start_date TEXT');
    }
  }
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
