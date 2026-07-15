'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { getDb } = require('./db');
const { createSession, logSet, finishSession, updateSetLog, deleteSetLog, recomputePRs, findOrCreateExercise, findOrCreateSessionForSlot, setProgramStartDate } = require('./store');
const { getActiveProgram, getProgramWeek, listSessions, getSession, getProgress, listLoggedExercises, getCurrentProgramJson } = require('./read-queries');
const PTLogic = require('./public/logic.js');
const APP_TZ = process.env.APP_TZ || 'Pacific/Auckland';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.text({ type: ['text/csv', 'text/plain'], limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ===== Auth =====
// Single-user shared secret. The server is reachable from the internet, so
// every /api route requires the token — sent as `Authorization: Bearer <t>`
// by the app, or `?token=<t>` for plain-link CSV downloads. The token lives
// in .auth-token (auto-generated on first run, AUTH_TOKEN env overrides).
const TOKEN_PATH = process.env.TOKEN_PATH || path.join(__dirname, '.auth-token');

function loadAuthToken() {
  if (process.env.AUTH_TOKEN) return process.env.AUTH_TOKEN.trim();
  try {
    const t = fs.readFileSync(TOKEN_PATH, 'utf8').trim();
    if (t) return t;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const t = crypto.randomBytes(12).toString('base64url');
  fs.writeFileSync(TOKEN_PATH, `${t}\n`, { mode: 0o600 });
  console.log(`Generated new auth token in ${TOKEN_PATH}`);
  return t;
}

const AUTH_TOKEN = loadAuthToken();

// Compare via hashes so lengths always match (timingSafeEqual requirement)
// and the check is constant-time.
function tokenMatches(candidate) {
  const a = crypto.createHash('sha256').update(String(candidate)).digest();
  const b = crypto.createHash('sha256').update(AUTH_TOKEN).digest();
  return crypto.timingSafeEqual(a, b);
}

app.use('/api', (req, res, next) => {
  const header = req.headers.authorization || '';
  const candidate = header.startsWith('Bearer ')
    ? header.slice(7)
    : (req.query.token || '');
  if (candidate && tokenMatches(candidate)) return next();
  res.status(401).json({ error: 'unauthorized' });
});

function todayIso() {
  return PTLogic.todayInTZ(APP_TZ, new Date());
}

function nowStamp() {
  return PTLogic.nowInTZ(APP_TZ, new Date());
}

// ===== SQLite-backed API routes =====

app.get('/api/active-program', (req, res) => {
  res.json(getActiveProgram(getDb()));
});

app.get('/api/program/week', (req, res) => {
  const n = Math.max(1, parseInt(req.query.number, 10) || 1);
  const week = getProgramWeek(getDb(), n);
  if (!week) return res.status(404).json({ error: 'week not found' });
  res.json(week);
});

app.get('/api/program/current', (req, res) => {
  const json = getCurrentProgramJson(getDb());
  if (!json) return res.status(404).json({ error: 'no active program' });
  res.json(json);
});

app.put('/api/program/:id/start-date', (req, res) => {
  const b = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.start_date || ''))) return res.status(400).json({ error: 'start_date must be YYYY-MM-DD' });
  res.json(setProgramStartDate(getDb(), Number(req.params.id), b.start_date));
});

app.get('/api/sessions', (req, res) => {
  res.json(listSessions(getDb()));
});

app.get('/api/sessions/:id', (req, res) => {
  const s = getSession(getDb(), Number(req.params.id));
  if (!s) return res.status(404).json({ error: 'session not found' });
  res.json(s);
});

app.post('/api/sessions', (req, res) => {
  const b = req.body || {};
  const routineId = b.routineId != null ? Number(b.routineId) : null;
  const date = typeof b.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : null;
  const db = getDb();
  if (routineId != null && date != null) {
    const today = todayIso();
    const startedAt = date === today ? nowStamp() : `${date} 12:00:00`;
    const { id, created } = findOrCreateSessionForSlot(db, { routineId, date, startedAt });
    return res.status(created ? 201 : 200).json({ id, created });
  }
  const id = createSession(db, { routineId, startedAt: nowStamp() });
  res.status(201).json({ id });
});

app.post('/api/sessions/:id/sets', (req, res) => {
  const b = req.body || {};
  if (!b.exerciseName) return res.status(400).json({ error: 'exerciseName required' });
  const db = getDb();
  const setId = logSet(db, {
    sessionId: Number(req.params.id),
    exerciseName: b.exerciseName,
    setNumber: Number(b.setNumber) || 1,
    weight: b.weight != null ? Number(b.weight) : null,
    reps: b.reps != null ? Number(b.reps) : null,
    rpe: b.rpe != null ? Number(b.rpe) : null,
    isWarmup: !!b.isWarmup,
  });
  recomputePRs(db, findOrCreateExercise(db, b.exerciseName));
  res.status(201).json(db.prepare('SELECT * FROM set_logs WHERE id = ?').get(setId));
});

app.put('/api/sets/:id', (req, res) => {
  const row = updateSetLog(getDb(), Number(req.params.id), req.body || {});
  if (!row) return res.status(404).json({ error: 'set not found' });
  res.json(row);
});

app.delete('/api/sets/:id', (req, res) => {
  const ok = deleteSetLog(getDb(), Number(req.params.id));
  if (!ok) return res.status(404).json({ error: 'set not found' });
  res.status(204).end();
});

app.post('/api/sessions/:id/finish', (req, res) => {
  const result = finishSession(getDb(), Number(req.params.id), nowStamp());
  if (!result) return res.status(404).json({ error: 'session not found' });
  res.json(result);
});

app.get('/api/exercises', (req, res) => {
  res.json(listLoggedExercises(getDb()));
});

app.get('/api/progress/:exercise', (req, res) => {
  res.json(getProgress(getDb(), req.params.exercise));
});

// Errors from route handlers come back as JSON so the frontend can show the
// real message instead of Express's HTML page.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'internal error' });
});

app.listen(PORT, () => {
  console.log(`Personal trainer running at http://localhost:${PORT}`);
});
