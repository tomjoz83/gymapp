'use strict';
const fs = require('node:fs');
const { getDb } = require('../db');

function planCleanup(db) {
  const rows = db.prepare(
    `SELECT ws.id FROM workout_sessions ws
      WHERE ws.finished_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM set_logs sl WHERE sl.session_id = ws.id)
      ORDER BY ws.id`
  ).all();
  return { delete: rows.map((r) => r.id) };
}

function applyCleanup(db, plan) {
  db.exec('BEGIN');
  try {
    const del = db.prepare('DELETE FROM workout_sessions WHERE id = ?');
    for (const id of plan.delete) del.run(id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return plan.delete.length;
}

if (require.main === module) {
  const apply = process.argv.includes('--apply');
  const dbPath = process.env.DB_PATH || './gym.db';
  if (apply) {
    const backup = `${dbPath}.bak-${Date.now()}`;
    fs.copyFileSync(dbPath, backup);
    console.log(`Backup written: ${backup}`);
  }
  const db = getDb();
  const plan = planCleanup(db);
  console.log(`Would delete ${plan.delete.length} empty unfinished session(s): [${plan.delete.join(', ')}]`);
  if (!apply) { console.log('\n(dry run) re-run with --apply to delete.'); process.exit(0); }
  console.log(`Deleted ${applyCleanup(db, plan)} session(s).`);
}

module.exports = { planCleanup, applyCleanup };
