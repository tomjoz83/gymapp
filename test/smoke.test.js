'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

let base, proc, token, dir;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-'));
  const dbPath = path.join(dir, 'smoke.db');

  // Import the real program (ppl-6wk-hypertrophy) into the temp DB.
  const { getDb, closeDb } = require('../db');
  const { importProgramsFromDir } = require('../scripts/import-programs');
  const db = getDb(dbPath);
  const result = importProgramsFromDir(db, path.resolve(__dirname, '../programs'), '2026-07-13 12:00:00');
  if (result.errors.length) throw new Error('Program import failed: ' + JSON.stringify(result.errors));
  closeDb();

  token = 'smoketoken';
  base = 'http://localhost:3998';
  proc = spawn('node', ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DB_PATH: dbPath, AUTH_TOKEN: token, PORT: '3998' },
    stdio: 'ignore',
  });

  // Poll until ready (up to 5s).
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(base + '/api/active-program', {
        headers: { Authorization: 'Bearer ' + token },
      });
      if (r.ok) break;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
});

after(() => {
  if (proc) proc.kill();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Asset serving tests
// ---------------------------------------------------------------------------

test('GET / serves index.html with id="app"', async () => {
  const r = await fetch(base + '/');
  assert.strictEqual(r.status, 200);
  const html = await r.text();
  assert.ok(html.includes('id="app"'), 'index.html must contain id="app"');
});

test('GET / — all three scripts carry defer attribute', async () => {
  const r = await fetch(base + '/');
  const html = await r.text();

  // Each of the three required script tags must include the defer attribute.
  assert.ok(
    html.includes('<script defer src="vendor/vue.global.prod.js">'),
    'vue script must have defer'
  );
  assert.ok(
    html.includes('<script defer src="logic.js">'),
    'logic.js script must have defer'
  );
  assert.ok(
    html.includes('<script defer src="app.js">'),
    'app.js script must have defer'
  );
});

test('GET / — scripts load in order: vue → logic → app', async () => {
  const r = await fetch(base + '/');
  const html = await r.text();

  const vueIdx = html.indexOf('vendor/vue.global.prod.js');
  const logicIdx = html.indexOf('logic.js');
  const appIdx = html.indexOf('app.js');

  assert.ok(vueIdx !== -1, 'vue script not found in HTML');
  assert.ok(logicIdx !== -1, 'logic.js script not found in HTML');
  assert.ok(appIdx !== -1, 'app.js script not found in HTML');

  assert.ok(vueIdx < logicIdx, 'vue must appear before logic.js in HTML');
  assert.ok(logicIdx < appIdx, 'logic.js must appear before app.js in HTML');
});

test('GET /app.js contains Vue mount and createApp', async () => {
  const r = await fetch(base + '/app.js');
  assert.strictEqual(r.status, 200);
  const js = await r.text();
  assert.ok(js.includes(".mount('#app')"), "app.js must contain .mount('#app')");
  assert.ok(js.includes('createApp'), 'app.js must contain createApp');
});

test('GET /logic.js is served (200, non-empty)', async () => {
  const r = await fetch(base + '/logic.js');
  assert.strictEqual(r.status, 200);
  const body = await r.text();
  assert.ok(body.length > 0, 'logic.js must not be empty');
});

test('GET /style.css is served (200)', async () => {
  const r = await fetch(base + '/style.css');
  assert.strictEqual(r.status, 200);
});

// ---------------------------------------------------------------------------
// API auth tests
// ---------------------------------------------------------------------------

test('GET /api/active-program with Bearer token → 200 with imported program slug', async () => {
  const r = await fetch(base + '/api/active-program', {
    headers: { Authorization: 'Bearer ' + token },
  });
  assert.strictEqual(r.status, 200);
  const p = await r.json();
  assert.strictEqual(p.slug, 'ppl-6wk-hypertrophy', 'active program slug must match imported program');
});

test('GET /api/active-program WITHOUT auth → 401', async () => {
  const r = await fetch(base + '/api/active-program');
  assert.strictEqual(r.status, 401);
});

// ---------------------------------------------------------------------------
// Session round-trip
// ---------------------------------------------------------------------------

test('session round-trip: POST session → POST set → GET session', async () => {
  function api(pathname, opts = {}) {
    return fetch(base + pathname, {
      ...opts,
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
      },
    });
  }

  // Get the first routine of week 1.
  const week = await (await api('/api/program/week?number=1')).json();
  const routineId = week.routines[0].id;
  assert.ok(routineId > 0, 'routineId must be a positive integer');

  // Create a session.
  const sessionRes = await api('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ routineId }),
  });
  assert.strictEqual(sessionRes.status, 201);
  const { id: sessionId } = await sessionRes.json();
  assert.ok(sessionId > 0, 'sessionId must be a positive integer');

  // Log a set.
  const setRes = await api('/api/sessions/' + sessionId + '/sets', {
    method: 'POST',
    body: JSON.stringify({
      exerciseName: week.routines[0].exercises[0].exercise,
      setNumber: 1,
      weight: 60,
      reps: 8,
      rpe: 7,
    }),
  });
  assert.strictEqual(setRes.status, 201);
  const setRow = await setRes.json();
  assert.strictEqual(setRow.weight, 60, 'logged set weight must be 60');

  // Fetch the session and verify it has exactly 1 set.
  const full = await (await api('/api/sessions/' + sessionId)).json();
  assert.strictEqual(full.sets.length, 1, 'session must have exactly 1 set');
});
