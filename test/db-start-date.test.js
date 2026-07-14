'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { getDb, closeDb } = require('../db');

test('fresh DB has programs.start_date column', () => {
  const db = getDb(':memory:');
  const cols = db.prepare('PRAGMA table_info(programs)').all().map((c) => c.name);
  assert.ok(cols.includes('start_date'), 'start_date column missing');
  closeDb();
});

test('pre-existing programs table without start_date is migrated, data preserved', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-'));
  const p = path.join(dir, 't.db');
  // Simulate an OLD db: programs table WITH slug (post-Phase-2) but WITHOUT start_date.
  const raw = new DatabaseSync(p);
  raw.exec(`CREATE TABLE programs (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
            slug TEXT UNIQUE, description TEXT, active INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);`);
  raw.prepare("INSERT INTO programs (name, slug, active, created_at) VALUES ('P','s',1,'2026-01-01')").run();
  raw.close();

  const db = getDb(p); // triggers migration
  const cols = db.prepare('PRAGMA table_info(programs)').all().map((c) => c.name);
  assert.ok(cols.includes('start_date'), 'start_date not added by migration');
  const row = db.prepare('SELECT name, slug, start_date FROM programs WHERE slug = ?').get('s');
  assert.strictEqual(row.name, 'P');
  assert.strictEqual(row.start_date, null);
  closeDb();
});
