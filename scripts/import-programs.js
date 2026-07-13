'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { getDb } = require('../db');
const { importProgram, programExistsMatching } = require('../store');

function importProgramsFromDir(db, dir, createdAt = null) {
  const imported = [];
  const unchanged = [];
  const skipped = [];
  const errors = [];
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  } catch (err) {
    return { imported, unchanged, skipped, errors: [{ file: dir, error: String(err.message || err) }] };
  }
  for (const f of files) {
    const full = path.join(dir, f);
    try {
      const obj = JSON.parse(fs.readFileSync(full, 'utf8'));
      const before = programExistsMatching(db, obj); // {match,id} against pre-import state
      importProgram(db, obj, createdAt);
      if (before.id === null) imported.push(obj.slug);
      else if (before.match) unchanged.push(obj.slug);
      else skipped.push(obj.slug);
    } catch (err) {
      errors.push({ file: full, error: String(err.message || err) });
    }
  }
  return { imported, unchanged, skipped, errors };
}

if (require.main === module) {
  const dir = process.argv[2] || './programs';
  const createdAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const db = getDb();
  const { imported, unchanged, skipped, errors } = importProgramsFromDir(db, dir, createdAt);
  for (const slug of imported) console.log(`imported: ${slug}`);
  for (const slug of unchanged) console.log(`unchanged: ${slug}`);
  for (const slug of skipped) console.warn(`skipped (differs, not rebuilt): ${slug}`);
  for (const e of errors) console.error(`ERROR ${e.file}: ${e.error}`);
  console.log(`Done. ${imported.length} imported, ${unchanged.length} unchanged, ${skipped.length} skipped, ${errors.length} errors.`);
  if (errors.length) process.exit(1);
}

module.exports = { importProgramsFromDir };
