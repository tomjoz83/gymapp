'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const L = require('../public/logic.js');

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
