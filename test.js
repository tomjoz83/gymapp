'use strict';

// Integration tests — boot the real server against a throwaway data file and
// exercise the endpoints over HTTP. Run with `npm test` (Node 18+).

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 4178;
const BASE = `http://localhost:${PORT}`;
const STORE = path.join(os.tmpdir(), `pt-test-${process.pid}.json`);
const ARCHIVE = path.join(os.tmpdir(), `pt-test-archive-${process.pid}.json`);
const TOKEN = 'test-token';
const AUTH = { Authorization: `Bearer ${TOKEN}` };
let srv;

async function req(method, url, body) {
  const opts = { method, headers: { ...AUTH } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(BASE + url, opts);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}

// POST a raw CSV body to the import endpoint (with auth).
async function importCsv(csv, qs = '') {
  return fetch(`${BASE}/api/import${qs}`, {
    method: 'POST',
    headers: { ...AUTH, 'Content-Type': 'text/csv' },
    body: csv,
  });
}

before(async () => {
  fs.writeFileSync(STORE, JSON.stringify({ nextId: 1, workouts: [] }));
  srv = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(PORT), STORE_PATH: STORE, ARCHIVE_PATH: ARCHIVE, AUTH_TOKEN: TOKEN },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) {
    try { await fetch(`${BASE}/api/workouts`); return; }
    catch { await new Promise((r) => setTimeout(r, 50)); }
  }
  throw new Error('server did not start');
});

after(() => {
  if (srv) srv.kill();
  try { fs.unlinkSync(ARCHIVE); } catch {}
  try { fs.unlinkSync(STORE); } catch {}
});

test('import keeps same-named workouts on different dates separate', async () => {
  const csv = [
    'name,day,date,notes,completed,exercise,reps,weight',
    'Push Day,Monday,2026-07-06,,no,Bench,8,60',
    'Push Day,Monday,2026-07-13,,no,Bench,8,62',
    'Maybe Done,Monday,2026-07-06,,none,Squat,5,100',
  ].join('\n');

  const res = await importCsv(csv);
  const data = await res.json();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(data.workoutsCreated, 3, 'three distinct workouts created');
  assert.strictEqual(data.setsCreated, 3);

  const all = (await req('GET', '/api/workouts')).body;
  const pushDays = all.filter((w) => w.name === 'Push Day');
  assert.strictEqual(pushDays.length, 2, 'two separate Push Day sessions');
});

test('import reads the sets column and defaults missing sets to 1', async () => {
  const csv = [
    'name,day,date,notes,completed,exercise,sets,reps,weight',
    'Leg Sets,Monday,2026-09-07,,no,Squat,5,5,100',   // explicit sets
    'Leg Sets,Monday,2026-09-07,,no,Lunge,,12,20',     // blank sets -> default 1
  ].join('\n');

  const res = await importCsv(csv);
  assert.strictEqual(res.status, 200);

  const all = (await req('GET', '/api/workouts')).body;
  const w = all.find((x) => x.name === 'Leg Sets');
  assert.ok(w, 'workout imported');
  const squat = w.sets.find((s) => s.exercise === 'Squat');
  const lunge = w.sets.find((s) => s.exercise === 'Lunge');
  assert.strictEqual(squat.sets, 5, 'explicit sets preserved');
  assert.strictEqual(lunge.sets, 1, 'blank sets defaults to 1');
});

test('import reads the rpe column (blank/out-of-range -> null)', async () => {
  const csv = [
    'name,day,date,notes,completed,exercise,sets,reps,rpe,weight',
    'RPE Day,Monday,2026-09-14,,no,Squat,3,5,8,100',   // valid rpe
    'RPE Day,Monday,2026-09-14,,no,Deadlift,1,5,,120',  // blank rpe -> null
    'RPE Day,Monday,2026-09-14,,no,Curl,3,12,50,15',    // out of range -> clamps to 10
  ].join('\n');

  const res = await importCsv(csv);
  assert.strictEqual(res.status, 200);

  const all = (await req('GET', '/api/workouts')).body;
  const w = all.find((x) => x.name === 'RPE Day');
  assert.ok(w, 'workout imported');
  assert.strictEqual(w.sets.find((s) => s.exercise === 'Squat').rpe, 8, 'valid rpe kept');
  assert.strictEqual(w.sets.find((s) => s.exercise === 'Deadlift').rpe, null, 'blank rpe -> null');
  assert.strictEqual(w.sets.find((s) => s.exercise === 'Curl').rpe, 10, 'rpe clamps to 10');
  // weight is preserved alongside rpe
  assert.strictEqual(w.sets.find((s) => s.exercise === 'Squat').weight, 100, 'weight kept next to rpe');
});

test('a set can be added and edited with an rpe target', async () => {
  const id = (await req('POST', '/api/workouts', { name: 'RPE API', date: '2026-09-15' })).body.id;

  const add = await req('POST', `/api/workouts/${id}/sets`, { exercise: 'Press', sets: 3, reps: 8, rpe: 7, weight: 40 });
  assert.strictEqual(add.status, 201);
  assert.strictEqual(add.body.rpe, 7, 'rpe stored on create');
  assert.strictEqual(add.body.weight, 40, 'weight stored alongside rpe');

  const noRpe = await req('POST', `/api/workouts/${id}/sets`, { exercise: 'Fly', reps: 12, weight: 10 });
  assert.strictEqual(noRpe.body.rpe, null, 'omitted rpe defaults to null');

  const put = await req('PUT', `/api/sets/${add.body.id}`, { exercise: 'Press', sets: 3, reps: 8, rpe: 9, weight: 42.5 });
  assert.strictEqual(put.body.rpe, 9, 'rpe updated via PUT');
  assert.strictEqual(put.body.weight, 42.5, 'weight still editable');
});

test('a set can be added and edited with a sets count', async () => {
  const id = (await req('POST', '/api/workouts', { name: 'Sets API', date: '2026-09-08' })).body.id;

  const add = await req('POST', `/api/workouts/${id}/sets`, { exercise: 'Curl', sets: 3, reps: 12, weight: 15 });
  assert.strictEqual(add.status, 201);
  assert.strictEqual(add.body.sets, 3, 'sets stored on create');

  const noSets = await req('POST', `/api/workouts/${id}/sets`, { exercise: 'Row', reps: 8, weight: 40 });
  assert.strictEqual(noSets.body.sets, 1, 'omitted sets defaults to 1');

  const put = await req('PUT', `/api/sets/${add.body.id}`, { exercise: 'Curl', sets: 4, reps: 10, weight: 17.5 });
  assert.strictEqual(put.body.sets, 4, 'sets updated via PUT');

  const bad = await req('POST', `/api/workouts/${id}/sets`, { exercise: 'Bad', sets: 0, reps: 8, weight: 10 });
  assert.strictEqual(bad.status, 400, 'zero sets rejected');
});

test('"completed" column parses strictly (none/empty are not completed)', async () => {
  const all = (await req('GET', '/api/workouts')).body;
  const maybe = all.find((w) => w.name === 'Maybe Done');
  assert.ok(maybe, 'workout exists');
  assert.strictEqual(maybe.completed, false, 'completed=none must stay incomplete');
});

test('a set can be edited via /api/sets/:id without sending workoutId', async () => {
  const all = (await req('GET', '/api/workouts')).body;
  const w = all.find((x) => (x.sets || []).length);
  const setId = w.sets[0].id;

  const put = await req('PUT', `/api/sets/${setId}`, { exercise: 'Bench', reps: 12, weight: 65 });
  assert.strictEqual(put.status, 200, 'edit should succeed, not 404');
  assert.strictEqual(put.body.reps, 12);

  const fresh = (await req('GET', `/api/workouts/${w.id}`)).body;
  assert.strictEqual(fresh.sets.find((s) => s.id === setId).reps, 12);
});

test('a set can be deleted via /api/sets/:id', async () => {
  const all = (await req('GET', '/api/workouts')).body;
  const w = all.find((x) => (x.sets || []).length);
  const setId = w.sets[0].id;

  const del = await req('DELETE', `/api/sets/${setId}`);
  assert.strictEqual(del.status, 200);

  const fresh = (await req('GET', `/api/workouts/${w.id}`)).body;
  assert.ok(!fresh.sets.some((s) => s.id === setId), 'set removed');
});

test('weekly view always returns all 7 days', async () => {
  const res = (await req('GET', '/api/program/weeks?offset=0')).body;
  assert.strictEqual(res.days.length, 7);
});

test('a workout can be created through the API', async () => {
  const created = await req('POST', '/api/workouts', { name: 'Leg Day', date: '2026-07-06' });
  assert.strictEqual(created.status, 201);
  assert.strictEqual(created.body.name, 'Leg Day');

  const all = (await req('GET', '/api/workouts')).body;
  assert.ok(all.some((w) => w.name === 'Leg Day'));
});

test('status flow persists elapsed time and resets on idle', async () => {
  const id = (await req('POST', '/api/workouts', { name: 'Timer Test', date: '2026-07-06' })).body.id;

  let r = await req('PUT', `/api/workouts/${id}/status`, { status: 'in_progress', elapsed_seconds: 0 });
  assert.strictEqual(r.body.status, 'in_progress');

  r = await req('PUT', `/api/workouts/${id}/status`, { status: 'completed', elapsed_seconds: 125 });
  assert.strictEqual(r.body.status, 'completed');
  assert.strictEqual(r.body.completed, true);
  assert.strictEqual(r.body.elapsed_seconds, 125, 'finish records the elapsed time');

  r = await req('PUT', `/api/workouts/${id}/status`, { status: 'idle' });
  assert.strictEqual(r.body.status, 'idle');
  assert.strictEqual(r.body.elapsed_seconds, 0, 'reopen clears the timer');
  assert.strictEqual(r.body.completed, false);
});

test('an invalid status is rejected', async () => {
  const id = (await req('POST', '/api/workouts', { name: 'Bad Status', date: '2026-07-06' })).body.id;
  const r = await req('PUT', `/api/workouts/${id}/status`, { status: 'wat' });
  assert.strictEqual(r.status, 400);
});

test('completing via workout PUT keeps status and completed in sync', async () => {
  const id = (await req('POST', '/api/workouts', { name: 'Sync Test', date: '2026-07-06' })).body.id;

  let r = await req('PUT', `/api/workouts/${id}`, { completed: true });
  assert.strictEqual(r.body.completed, true);
  assert.strictEqual(r.body.status, 'completed', 'status follows completed=true');

  r = await req('PUT', `/api/workouts/${id}`, { completed: false });
  assert.strictEqual(r.body.completed, false);
  assert.strictEqual(r.body.status, 'idle', 'status follows completed=false');
});

test('new workouts start in the idle status', async () => {
  const r = await req('POST', '/api/workouts', { name: 'Fresh', date: '2026-07-06' });
  assert.strictEqual(r.body.status, 'idle');
  assert.strictEqual(r.body.elapsed_seconds, 0);
});

test('requests without a valid token are rejected', async () => {
  const noAuth = await fetch(`${BASE}/api/workouts`);
  assert.strictEqual(noAuth.status, 401, 'missing token -> 401');

  const badAuth = await fetch(`${BASE}/api/workouts`, { headers: { Authorization: 'Bearer nope' } });
  assert.strictEqual(badAuth.status, 401, 'wrong token -> 401');

  const viaQuery = await fetch(`${BASE}/api/export.csv?token=${TOKEN}`);
  assert.strictEqual(viaQuery.status, 200, 'token via query string works for downloads');

  const ok = await fetch(`${BASE}/api/workouts`, { headers: AUTH });
  assert.strictEqual(ok.status, 200, 'valid token -> 200');
});

test('a corrupt store fails loudly instead of silently resetting', async () => {
  const good = fs.readFileSync(STORE, 'utf8');
  fs.writeFileSync(STORE, '{ this is not valid json');
  try {
    const r = await req('GET', '/api/workouts');
    assert.strictEqual(r.status, 500, 'corrupt store returns 500, not an empty 200');
    assert.match(r.body.error || '', /JSON/i, 'error explains the store is unreadable');
  } finally {
    fs.writeFileSync(STORE, good); // restore so later tests still run
  }
});

// --- archive / clear / replace (run last: these wipe the active plan) ---

test('completed workouts can be archived to a separate file', async () => {
  const id = (await req('POST', '/api/workouts', { name: 'Archive Me', date: '2026-07-06' })).body.id;
  await req('PUT', `/api/workouts/${id}/status`, { status: 'completed', elapsed_seconds: 60 });

  const r = await req('POST', '/api/archive');
  assert.ok(r.body.archived >= 1, 'at least one workout archived');

  const arch = (await req('GET', '/api/archive')).body;
  assert.ok(arch.some((w) => w.name === 'Archive Me'), 'archive contains the workout');
});

test('clearing all workouts empties the plan but keeps the archive', async () => {
  const before = (await req('GET', '/api/archive')).body.length;

  const r = await req('DELETE', '/api/workouts');
  assert.strictEqual(r.body.ok, true);

  const active = (await req('GET', '/api/workouts')).body;
  assert.strictEqual(active.length, 0, 'active plan is empty');

  const after = (await req('GET', '/api/archive')).body.length;
  assert.ok(after >= before, 'archive is preserved across clear');
});

test('import with replace clears the old plan and loads the new template', async () => {
  await req('POST', '/api/workouts', { name: 'Old Plan', date: '2026-07-06' });

  const csv = 'name,day,date,notes,completed,exercise,reps,weight\nNew Plan,Monday,2026-08-03,,no,Bench,5,80';
  const res = await importCsv(csv, '?replace=1');
  const data = await res.json();
  assert.strictEqual(data.replaced, true);

  const active = (await req('GET', '/api/workouts')).body;
  assert.ok(active.every((w) => w.name !== 'Old Plan'), 'old plan was cleared');
  assert.ok(active.some((w) => w.name === 'New Plan'), 'new plan was loaded');
});
