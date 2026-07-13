const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getDb, closeDb } = require('../db');
const { importProgramsFromDir } = require('../scripts/import-programs');

function writeProgram(dir, name, obj) {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(obj));
}

test('importProgramsFromDir loads valid files and collects errors', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'progs-'));
  writeProgram(dir, 'good.json', {
    slug: 'good', name: 'Good', active: true,
    weeks: [{ week_number: 1, routines: [{ name: 'Push', exercises: [{ exercise: 'Bench Press' }] }] }],
  });
  writeProgram(dir, 'bad.json', { slug: 'BAD SLUG', name: '' });
  fs.writeFileSync(path.join(dir, 'notjson.txt'), 'ignored');

  const db = getDb(':memory:');
  const summary = importProgramsFromDir(db, dir, '2026-07-13 12:00:00');
  assert.deepStrictEqual(summary.imported, ['good']);
  assert.strictEqual(summary.errors.length, 1);
  assert.ok(summary.errors[0].file.includes('bad.json'));
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM programs').get().c, 1);
  closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});
