'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const L = require('../public/logic.js');
const PTLogic = L; // same export; alias for clarity in deterministic tests

// ---------------------------------------------------------------------------
// DETERMINISTIC unit assertions — prove NZ wiring against pinned cross-midnight
// instants. These tests fail regardless of when they run; they do not depend on
// the current wall clock or on the server being up.
// ---------------------------------------------------------------------------

// 2000-01-01T13:00:00Z is NZDT (+13) → 2000-01-02 02:00 NZ
// UTC date = 2000-01-01, NZ date = 2000-01-02  → cross-midnight proof.
test('todayInTZ returns NZ date (not UTC date) for cross-midnight instant (NZDT)', () => {
  const instant = new Date('2000-01-01T13:00:00Z');
  assert.strictEqual(
    PTLogic.todayInTZ('Pacific/Auckland', instant),
    '2000-01-02',
    'NZDT cross-midnight: UTC 2000-01-01 T13 should be NZ 2000-01-02'
  );
});

// 2026-07-13T19:06:17Z is NZST (+12) → 2026-07-14 07:06:17 NZ
// UTC date = 2026-07-13, NZ date = 2026-07-14  → cross-midnight proof in winter.
test('todayInTZ returns NZ date (not UTC date) for cross-midnight instant (NZST)', () => {
  const instant = new Date('2026-07-13T19:06:17Z');
  assert.strictEqual(
    PTLogic.todayInTZ('Pacific/Auckland', instant),
    '2026-07-14',
    'NZST cross-midnight: UTC 2026-07-13 T19:06 should be NZ 2026-07-14'
  );
});

test('nowInTZ returns correct NZ wall-clock timestamp for pinned NZST instant', () => {
  const instant = new Date('2026-07-13T19:06:17Z');
  assert.strictEqual(
    PTLogic.nowInTZ('Pacific/Auckland', instant),
    '2026-07-14 07:06:17',
    'NZST: UTC 2026-07-13 19:06:17 should be NZ wall-clock 2026-07-14 07:06:17'
  );
});

// ---------------------------------------------------------------------------
// HTTP round-trip — exercises the live server path (existing test, kept as-is)
// ---------------------------------------------------------------------------

let proc, base, dir; const token = 'tzt';
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srv-tz-'));
  base = 'http://localhost:3998';
  proc = spawn('node', ['server.js'], {
    env: { ...process.env, DB_PATH: path.join(dir, 't.db'), AUTH_TOKEN: token, PORT: '3998', APP_TZ: 'Pacific/Auckland' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(base + '/api/active-program', { headers: { Authorization: 'Bearer ' + token } }); if (r.ok || r.status === 200) break; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
});
after(() => { if (proc) proc.kill(); });

test('created session started_at carries the NZ date', async () => {
  const r = await fetch(base + '/api/sessions', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: '{}',
  });
  const { id } = await r.json();
  const g = await fetch(base + '/api/sessions/' + id, { headers: { Authorization: 'Bearer ' + token } });
  const s = await g.json();
  const expectedDate = L.todayInTZ('Pacific/Auckland', new Date());
  assert.strictEqual(String(s.started_at).slice(0, 10), expectedDate);
});
