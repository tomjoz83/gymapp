'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { getDb } = require('../db');
const { importProgram } = require('../store');

function importProgramsFromDir(db, dir, createdAt = null) {
  const imported = [];
  const errors = [];
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  } catch (err) {
    return { imported, errors: [{ file: dir, error: String(err.message || err) }] };
  }
  for (const f of files) {
    const full = path.join(dir, f);
    try {
      const obj = JSON.parse(fs.readFileSync(full, 'utf8'));
      importProgram(db, obj, createdAt);
      imported.push(obj.slug);
    } catch (err) {
      errors.push({ file: full, error: String(err.message || err) });
    }
  }
  return { imported, errors };
}

if (require.main === module) {
  const dir = process.argv[2] || './programs';
  const createdAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const db = getDb();
  const { imported, errors } = importProgramsFromDir(db, dir, createdAt);
  for (const slug of imported) console.log(`imported: ${slug}`);
  for (const e of errors) console.error(`ERROR ${e.file}: ${e.error}`);
  console.log(`Done. ${imported.length} imported, ${errors.length} errors.`);
  if (errors.length) process.exit(1);
}

module.exports = { importProgramsFromDir };
