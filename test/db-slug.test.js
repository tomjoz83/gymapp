const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getDb, closeDb } = require('../db');

test('programs table has a unique slug column', () => {
  const db = getDb(':memory:');
  const cols = db.prepare("PRAGMA table_info(programs)").all().map((c) => c.name);
  assert.ok(cols.includes('slug'), 'programs.slug column missing');
  db.prepare("INSERT INTO programs (name, slug, created_at) VALUES ('A', 'dup', '2026-01-01')").run();
  assert.throws(() => {
    db.prepare("INSERT INTO programs (name, slug, created_at) VALUES ('B', 'dup', '2026-01-01')").run();
  });
  closeDb();
});

test('getDb self-heals an old programs table missing slug (file DB)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'olddb-'));
  const dbPath = path.join(dir, 'old.db');
  const { DatabaseSync } = require('node:sqlite');
  const raw = new DatabaseSync(dbPath);
  raw.exec("CREATE TABLE programs (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL)");
  raw.exec("CREATE TABLE program_weeks (id INTEGER PRIMARY KEY, program_id INTEGER)");
  raw.exec("CREATE TABLE routines (id INTEGER PRIMARY KEY, program_week_id INTEGER)");
  raw.exec("CREATE TABLE routine_exercises (id INTEGER PRIMARY KEY, routine_id INTEGER)");
  raw.close();

  const db = getDb(dbPath);
  const cols = db.prepare("PRAGMA table_info(programs)").all().map((c) => c.name);
  assert.ok(cols.includes('slug'), 'slug column should exist after self-heal');
  closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});
