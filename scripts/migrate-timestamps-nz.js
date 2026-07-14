'use strict';
const fs = require('node:fs');
const { getDb } = require('../db');
const L = require('../public/logic.js');

function planTimestampMigration(db, tz) {
  // Ensure the sentinel column exists (no-op if already present).
  _ensureMigratedColumn(db);
  const rows = db.prepare('SELECT id, started_at, finished_at FROM workout_sessions WHERE tz_migrated IS NOT 1').all();
  const convert = [];
  let skipped = 0;
  for (const r of rows) {
    let touched = false;
    for (const field of ['started_at', 'finished_at']) {
      const v = r[field];
      if (!v) continue;
      const to = L.utcStampToTZ(tz, v);
      if (to !== v) { convert.push({ id: r.id, field, from: v, to }); touched = true; }
    }
    if (!touched) skipped += 1;
  }
  return { convert, skipped };
}

function applyTimestampMigration(db, plan) {
  _ensureMigratedColumn(db);
  db.exec('BEGIN');
  try {
    const upd = {
      started_at: db.prepare('UPDATE workout_sessions SET started_at = ? WHERE id = ?'),
      finished_at: db.prepare('UPDATE workout_sessions SET finished_at = ? WHERE id = ?'),
    };
    const mark = db.prepare('UPDATE workout_sessions SET tz_migrated = 1 WHERE id = ?');
    // Collect unique ids that actually had at least one conversion.
    const changedIds = new Set();
    for (const c of plan.convert) { upd[c.field].run(c.to, c.id); changedIds.add(c.id); }
    for (const id of changedIds) mark.run(id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return plan.convert.length;
}

/** Add tz_migrated INTEGER column if the table predates it (idempotent). */
function _ensureMigratedColumn(db) {
  const cols = db.prepare('PRAGMA table_info(workout_sessions)').all().map((c) => c.name);
  if (!cols.includes('tz_migrated')) {
    db.exec('ALTER TABLE workout_sessions ADD COLUMN tz_migrated INTEGER');
  }
}

if (require.main === module) {
  const tz = process.env.APP_TZ || 'Pacific/Auckland';
  const apply = process.argv.includes('--apply');
  const dbPath = process.env.DB_PATH || './gym.db';
  if (apply) {
    const backup = `${dbPath}.bak-${Date.now()}`;
    fs.copyFileSync(dbPath, backup);
    console.log(`Backup written: ${backup}`);
  }
  const db = getDb();
  const plan = planTimestampMigration(db, tz);
  console.log(`Would convert ${plan.convert.length} field(s); skip ${plan.skipped} session(s):`);
  for (const c of plan.convert) console.log(`  session ${c.id} ${c.field}: ${c.from}  ->  ${c.to}`);
  if (!apply) { console.log('\n(dry run) re-run with --apply to write.'); process.exit(0); }
  const n = applyTimestampMigration(db, plan);
  console.log(`Applied ${n} conversion(s).`);
}

module.exports = { planTimestampMigration, applyTimestampMigration };
