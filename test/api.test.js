'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

let base, proc, token, dir;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-'));
  const dbPath = path.join(dir, 'test.db');
  const { getDb, closeDb } = require('../db');
  const { importProgram } = require('../store');
  const db = getDb(dbPath);
  importProgram(db, {
    slug: 'p', name: 'Prog', active: true,
    weeks: [{ week_number: 1, label: 'W1', routines: [
      { name: 'Push', day_of_week: 'Monday', exercises: [
        { exercise: 'Bench Press', target_sets: 4, target_reps: 8, target_weight: 60, target_rpe: 7, rest_seconds: 120 },
      ] },
    ] }],
  }, '2026-07-13 12:00:00');
  closeDb();

  token = 'testtok';
  base = 'http://localhost:3999';
  proc = spawn('node', ['server.js'], {
    env: { ...process.env, DB_PATH: dbPath, AUTH_TOKEN: token, PORT: '3999' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(base + '/api/active-program', { headers: { Authorization: 'Bearer ' + token } }); if (r.ok) break; }
    catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
});

after(() => { if (proc) proc.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

function api(pathname, opts = {}) {
  return fetch(base + pathname, {
    ...opts,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

test('GET /api/active-program returns the active program', async () => {
  const r = await api('/api/active-program');
  assert.strictEqual(r.status, 200);
  const p = await r.json();
  assert.strictEqual(p.slug, 'p');
  assert.strictEqual(p.weekCount, 1);
});

test('GET /api/program/week returns routines with exercises', async () => {
  const w = await (await api('/api/program/week?number=1')).json();
  assert.strictEqual(w.routines[0].exercises[0].exercise, 'Bench Press');
});

test('session + set logging round-trip', async () => {
  const routineId = (await (await api('/api/program/week?number=1')).json()).routines[0].id;
  const sid = (await (await api('/api/sessions', { method: 'POST', body: JSON.stringify({ routineId }) })).json()).id;
  assert.ok(sid > 0);
  const setRow = await (await api('/api/sessions/' + sid + '/sets', {
    method: 'POST', body: JSON.stringify({ exerciseName: 'Bench Press', setNumber: 1, weight: 60, reps: 8, rpe: 7 }),
  })).json();
  assert.strictEqual(setRow.weight, 60);
  const full = await (await api('/api/sessions/' + sid)).json();
  assert.strictEqual(full.sets.length, 1);
  const fin = await (await api('/api/sessions/' + sid + '/finish', { method: 'POST' })).json();
  assert.ok(fin.finished_at);
});

test('unauthenticated request is rejected', async () => {
  const r = await fetch(base + '/api/active-program');
  assert.strictEqual(r.status, 401);
});

test('GET /api/sessions/:id 404s for unknown id', async () => {
  const r = await api('/api/sessions/99999');
  assert.strictEqual(r.status, 404);
});

test('GET /api/program/week 404s for a missing week', async () => {
  const r = await api('/api/program/week?number=99');
  assert.strictEqual(r.status, 404);
});

test('PUT /api/sets/:id 404s for unknown id', async () => {
  const r = await api('/api/sets/99999', { method: 'PUT', body: JSON.stringify({ weight: 50 }) });
  assert.strictEqual(r.status, 404);
});

test('POST /api/sessions/:id/sets 400s without exerciseName', async () => {
  const sid = (await (await api('/api/sessions', { method: 'POST', body: JSON.stringify({}) })).json()).id;
  const r = await api('/api/sessions/' + sid + '/sets', { method: 'POST', body: JSON.stringify({ setNumber: 1, weight: 50, reps: 5 }) });
  assert.strictEqual(r.status, 400);
});

test('set can be updated then deleted (PUT + DELETE 204)', async () => {
  const sid = (await (await api('/api/sessions', { method: 'POST', body: JSON.stringify({}) })).json()).id;
  const setRow = await (await api('/api/sessions/' + sid + '/sets', {
    method: 'POST', body: JSON.stringify({ exerciseName: 'Bench Press', setNumber: 1, weight: 60, reps: 8 }),
  })).json();
  const upd = await (await api('/api/sets/' + setRow.id, { method: 'PUT', body: JSON.stringify({ weight: 65 }) })).json();
  assert.strictEqual(upd.weight, 65);
  const del = await api('/api/sets/' + setRow.id, { method: 'DELETE' });
  assert.strictEqual(del.status, 204);
});

test('GET /api/sessions lists sessions and /api/progress returns shape', async () => {
  const list = await (await api('/api/sessions')).json();
  assert.ok(Array.isArray(list));
  const prog = await (await api('/api/progress/Bench%20Press')).json();
  assert.strictEqual(prog.exercise, 'Bench Press');
  assert.ok(Array.isArray(prog.history));
});
