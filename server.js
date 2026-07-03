'use strict';
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { parseObjects, stringify } = require('./csv');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.text({ type: ['text/csv', 'text/plain'], limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const STORE_PATH = process.env.STORE_PATH || path.join(__dirname, 'data.json');

function read() {
  try {
    const data = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    if (typeof data.nextId !== 'number') data.nextId = 1;
    if (!Array.isArray(data.workouts)) data.workouts = [];
    return data;
  } catch {
    return { nextId: 1, workouts: [] };
  }
}

function write(store) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
}

// Completed workouts are copied here so they survive clearing / replacing the
// active plan. Separate file, separate lifetime.
const ARCHIVE_PATH = process.env.ARCHIVE_PATH || path.join(__dirname, 'archive.json');

function readArchive() {
  try {
    const data = JSON.parse(fs.readFileSync(ARCHIVE_PATH, 'utf8'));
    if (!Array.isArray(data.workouts)) data.workouts = [];
    return data;
  } catch {
    return { workouts: [] };
  }
}

function writeArchive(archive) {
  fs.writeFileSync(ARCHIVE_PATH, JSON.stringify(archive, null, 2), 'utf8');
}

// Format a Date as a local YYYY-MM-DD (NOT UTC) so week boundaries and
// "today" stay correct regardless of the server's timezone.
function isoLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayIso() {
  return isoLocal(new Date());
}

function weekRange(offset = 0) {
  const n = new Date();
  const day = n.getDay();
  const diff = n.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(n.getFullYear(), n.getMonth(), diff + offset * 7);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  return {
    start: isoLocal(monday),
    end: isoLocal(sunday),
    monday,
  };
}

function dayLabel(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'long' });
}

// Local "YYYY-MM-DD HH:mm:ss" timestamp (consistent with isoLocal dates).
function nowStamp() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${isoLocal(d)} ${hh}:${mm}:${ss}`;
}

// Single source of truth that keeps `status`, `completed`, and
// `elapsed_seconds` in sync. Used by both the status endpoint and the
// workout PUT so the two completion concepts can never disagree.
function applyStatus(target, status, elapsedSeconds) {
  target.status = status;
  if (status === 'in_progress') {
    target.started_at = target.started_at || nowStamp();
    target.completed = false;
    target.completed_at = null;
    if (elapsedSeconds != null) {
      target.elapsed_seconds = Math.max(0, Math.round(Number(elapsedSeconds) || 0));
    }
  } else if (status === 'completed') {
    target.completed = true;
    target.completed_at = nowStamp();
    target.elapsed_seconds = Math.max(0, Math.round(Number(elapsedSeconds) || target.elapsed_seconds || 0));
  } else { // idle
    target.started_at = null;
    target.completed = false;
    target.completed_at = null;
    target.elapsed_seconds = 0;
  }
}

const CSV_HEADERS = ['name', 'day', 'date', 'notes', 'completed', 'exercise', 'sets', 'reps', 'rpe', 'weight'];

// Prescribed effort target. Whole number 1–10; anything blank / non-numeric /
// out of range becomes null (= "no RPE target").
function parseRpe(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(10, Math.max(1, Math.round(n)));
}

function loadWorkout(id, store) {
  return store.workouts.find((w) => w.id === Number(id)) || null;
}

function listWorkouts() {
  const store = read();
  return (store.workouts || [])
    .slice()
    .sort((a, b) => b.id - a.id)
    .map((w) => ({ ...w }));
}

// Build CSV rows (one row per set, or one blank-exercise row for empty/rest
// workouts) — shared by the plan export and the archive export.
function workoutsToCsvRows(workouts) {
  const rows = [CSV_HEADERS.slice()];
  for (const w of workouts) {
    const date = (w.date || w.completed_at || w.created_at || '').slice(0, 10);
    const sets = w.sets || [];
    if (sets.length === 0) {
      rows.push([w.name, w.day || '', date, w.notes || '', w.completed ? 'yes' : 'no', '', '', '', '', '']);
    } else {
      for (const s of sets) {
        rows.push([w.name, w.day || '', date, w.notes || '', w.completed ? 'yes' : 'no', s.exercise, s.sets ?? 1, s.reps, s.rpe ?? '', s.weight]);
      }
    }
  }
  return rows;
}

// Copy completed (non-rest) workouts into the archive file. Returns how many
// were newly added. Does not modify the active store.
function archiveCompletedWorkouts(store) {
  const completed = (store.workouts || []).filter((w) => w.completed && !w._rest);
  if (!completed.length) return 0;
  const archive = readArchive();
  const seen = new Set(archive.workouts.map((w) => w.id));
  let added = 0;
  for (const w of completed) {
    if (!seen.has(w.id)) {
      archive.workouts.push({ ...w, archived_at: nowStamp() });
      added += 1;
    }
  }
  writeArchive(archive);
  return added;
}

app.get('/api/workouts', (req, res) => {
  res.json(listWorkouts());
});

app.get('/api/workouts/:id', (req, res) => {
  const workout = loadWorkout(req.params.id, read());
  if (!workout) return res.status(404).json({ error: 'workout not found' });
  res.json({ ...workout });
});

app.post('/api/workouts', (req, res) => {
  const { name = '', notes = '', date, exercises = [] } = req.body || {};
  const dayName = (req.body.day || dayLabel(date || todayIso())).trim();
  const workoutDate = (date || todayIso()).trim();

  if (!name) return res.status(400).json({ error: 'name is required' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workoutDate)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }

  const store = read();

  const completed = !!req.body.completed;
  const workout = {
    id: store.nextId++,
    name,
    notes: notes.trim(),
    completed,
    status: completed ? 'completed' : 'idle',
    started_at: null,
    elapsed_seconds: 0,
    day: dayName,
    date: workoutDate,
    created_at: nowStamp(),
    completed_at: completed ? nowStamp() : null,
    sets: Array.isArray(exercises)
      ? exercises
          .filter((e) => e && e.exercise)
          .map((e, idx) => ({
            id: store.nextId++,
            exercise: String(e.exercise).trim(),
            sets: Math.max(1, Math.round(Number(e.sets) || 1)),
            reps: Math.max(0, Math.round(Number(e.reps) || 0)),
            rpe: parseRpe(e.rpe),
            weight: Math.max(0, Number(e.weight) || 0),
            sort: e.sort ?? idx,
          }))
      : [],
  };

  store.workouts.push(workout);
  write(store);
  res.status(201).json({ ...workout });
});

app.put('/api/workouts/:id', (req, res) => {
  const workout = loadWorkout(req.params.id, read());
  if (!workout) return res.status(404).json({ error: 'workout not found' });

  const store = read();
  const target = loadWorkout(req.params.id, store);

  const name = req.body.name != null ? String(req.body.name).trim() : target.name;
  const notes = req.body.notes != null ? String(req.body.notes).trim() : target.notes;
  const date = req.body.date != null ? String(req.body.date).trim() : target.date;
  const day = req.body.day != null ? String(req.body.day).trim() : target.day;

  if (!name) return res.status(400).json({ error: 'name is required' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }

  target.name = name;
  target.notes = notes;
  target.date = date;
  target.day = day;

  if (req.body.completed != null) {
    applyStatus(target, req.body.completed ? 'completed' : 'idle', req.body.elapsed_seconds);
  }

  if (Array.isArray(req.body.exercises)) {
    target.sets = req.body.exercises
      .filter((e) => e && e.exercise)
      .map((e, idx) => ({
        ...(e.id ? { id: Number(e.id) } : {}),
        exercise: String(e.exercise).trim(),
        sets: Math.max(1, Math.round(Number(e.sets) || 1)),
        reps: Math.max(0, Math.round(Number(e.reps) || 0)),
        rpe: parseRpe(e.rpe),
        weight: Math.max(0, Number(e.weight) || 0),
        sort: e.sort ?? idx,
      }));
  }

  write(store);
  res.json({ ...target });
});

app.delete('/api/workouts/:id', (req, res) => {
  if (!loadWorkout(req.params.id, read())) return res.status(404).json({ error: 'workout not found' });
  const store = read();
  store.workouts = store.workouts.filter((w) => w.id !== Number(req.params.id));
  write(store);
  res.json({ ok: true });
});

// Clear the whole active plan. Completed workouts are archived first so
// changing plans never deletes finished sessions.
app.delete('/api/workouts', (req, res) => {
  const store = read();
  const archived = archiveCompletedWorkouts(store);
  const cleared = (store.workouts || []).length;
  store.workouts = [];
  write(store);
  res.json({ ok: true, cleared, archived });
});

// Archive all completed workouts now (keeps them in the active plan too).
app.post('/api/archive', (req, res) => {
  const store = read();
  const added = archiveCompletedWorkouts(store);
  res.json({ archived: added, totalArchived: readArchive().workouts.length });
});

app.get('/api/archive', (req, res) => {
  res.json(readArchive().workouts);
});

app.get('/api/archive.csv', (req, res) => {
  const workouts = readArchive().workouts.slice().reverse();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="archive.csv"');
  res.send(stringify(workoutsToCsvRows(workouts)));
});

function validateSet(body) {
  const exercise = (body.exercise || '').trim();
  const sets = Number(body.sets ?? 1);
  const reps = Number(body.reps);
  const weight = Number(body.weight ?? 0);
  if (!exercise) return { error: 'exercise is required' };
  if (!Number.isFinite(sets) || sets <= 0) return { error: 'sets must be a positive number' };
  if (!Number.isFinite(reps) || reps <= 0) return { error: 'reps must be a positive number' };
  if (!Number.isFinite(weight) || weight < 0) return { error: 'weight must be zero or more' };
  return { exercise, sets: Math.round(sets), reps: Math.round(reps), rpe: parseRpe(body.rpe), weight };
}

app.post('/api/workouts/:id/sets', (req, res) => {
  const workout = loadWorkout(req.params.id, read());
  if (!workout) return res.status(404).json({ error: 'workout not found' });
  const v = validateSet(req.body);
  if (v.error) return res.status(400).json({ error: v.error });

  const store = read();
  const target = loadWorkout(req.params.id, store);
  const set = {
    id: store.nextId++,
    exercise: v.exercise,
    sets: v.sets,
    reps: v.reps,
    rpe: v.rpe,
    weight: v.weight,
    sort: (target.sets || []).length,
  };
  target.sets = target.sets || [];
  target.sets.push(set);
  write(store);
  res.status(201).json({ ...set });
});

// Locate a set by id. Uses workoutId as a hint when provided, otherwise
// scans every workout — so callers don't have to know the parent workout.
function findSet(store, setId, workoutId) {
  if (workoutId != null) {
    const w = loadWorkout(workoutId, store);
    const s = w && (w.sets || []).find((x) => x.id === setId);
    if (s) return { workout: w, set: s };
  }
  for (const w of store.workouts || []) {
    const s = (w.sets || []).find((x) => x.id === setId);
    if (s) return { workout: w, set: s };
  }
  return null;
}

app.put('/api/sets/:id', (req, res) => {
  const setId = Number(req.params.id);
  const store = read();
  const found = findSet(store, setId, req.body && req.body.workoutId);
  if (!found) return res.status(404).json({ error: 'set not found' });

  const v = validateSet(req.body);
  if (v.error) return res.status(400).json({ error: v.error });

  found.set.exercise = v.exercise;
  found.set.sets = v.sets;
  found.set.reps = v.reps;
  found.set.rpe = v.rpe;
  found.set.weight = v.weight;
  found.set.sort = req.body.sort != null ? Math.round(req.body.sort) : found.set.sort;

  write(store);
  res.json({ ...found.set });
});

app.delete('/api/sets/:id', (req, res) => {
  const setId = Number(req.params.id);
  const store = read();
  const found = findSet(store, setId, req.body && req.body.workoutId);
  if (!found) return res.status(404).json({ error: 'set not found' });

  found.workout.sets = (found.workout.sets || []).filter((s) => s.id !== setId);
  write(store);
  res.json({ ok: true });
});

// ===== Workout status / timer endpoints =====

app.put('/api/workouts/:id/status', (req, res) => {
  const workout = loadWorkout(req.params.id, read());
  if (!workout) return res.status(404).json({ error: 'workout not found' });

  const { status, elapsed_seconds } = req.body || {};
  if (!['idle', 'in_progress', 'completed'].includes(status)) {
    return res.status(400).json({ error: 'status must be idle, in_progress, or completed' });
  }

  const store = read();
  const target = loadWorkout(req.params.id, store);
  if (!target) return res.status(404).json({ error: 'workout not found' });

  applyStatus(target, status, elapsed_seconds);

  write(store);
  res.json({ ...target });
});

// ===== New program / weekly / day endpoints =====

app.get('/api/program/weeks', (req, res) => {
  const { start, end, offset } = req.query;
  const store = read();

  let weekStartDate = null;
  let weekEndDate = null;

  if (offset !== undefined && offset !== '') {
    const computed = weekRange(Number(offset));
    weekStartDate = computed.start;
    weekEndDate = computed.end;
  } else if (start && end) {
    weekStartDate = start;
    weekEndDate = end;
  }

  const workouts = (store.workouts || []).filter((w) => {
    const d = (w.date || w.created_at || '').slice(0, 10);
    if (!d) return false;
    if (weekStartDate && d < weekStartDate) return false;
    if (weekEndDate && d > weekEndDate) return false;
    return true;
  });

  const grouped = new Map();
  for (const w of workouts) {
    const iso = (w.date || w.created_at || '').slice(0, 10);
    if (!iso) continue;
    const list = grouped.get(iso) || [];
    list.push({ ...w });
    grouped.set(iso, list);
  }

  // Always return all 7 days of the week
  let days = [];
  if (weekStartDate && weekEndDate) {
    const start = new Date(weekStartDate + 'T00:00:00');
    for (let i = 0; i < 7; i++) {
      const dt = new Date(start);
      dt.setDate(dt.getDate() + i);
      const iso = isoLocal(dt);
      days.push({ date: iso, day: dayLabel(iso), workouts: grouped.get(iso) || [] });
    }
  } else {
    // Fallback when no week range: list only days that have workouts.
    days = Array.from(grouped.entries())
      .map(([date, items]) => ({ date, day: dayLabel(date), workouts: items.sort((a, b) => a.id - b.id) }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  const label = weekStartDate && weekEndDate
    ? `${new Date(weekStartDate + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${new Date(weekEndDate + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
    : '';

  res.json({ start: weekStartDate, end: weekEndDate, days, label });
});

app.get('/api/program/day', (req, res) => {
  const { date } = req.query;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date query param YYYY-MM-DD is required' });
  }
  const store = read();
  const dayWorkouts = (store.workouts || [])
    .filter((w) => (w.date || '').slice(0, 10) === date)
    .map((w) => ({ ...w }));
  res.json({ date, day: dayLabel(date), workouts: dayWorkouts });
});

// Bulk-import staged workouts from a flat CSV with optional placeholders.
app.post('/api/import', (req, res) => {
  const text = typeof req.body === 'string' ? req.body : req.body.csv;
  if (!text || !String(text).trim()) return res.status(400).json({ error: 'no CSV provided' });

  const records = parseObjects(text);
  if (records.length === 0) return res.status(400).json({ error: 'CSV has no data rows' });

  const isCompleted = (v) => /^(1|yes|true|y|done|complete|completed)$/i.test(String(v).trim());

  let workoutsCreated = 0;
  let setsCreated = 0;

  // Group by name + date + day so the same workout name on different dates
  // (e.g. "Push Day" in week 1 and week 2) stays as separate sessions.
  const groups = new Map();
  for (const r of records) {
    const name = (r.name || r.workout || '').trim();
    if (!name) continue;
    const day = (r.day || '').trim();
    const date = (r.date || '').trim();
    const key = `${name} ${date} ${day}`;
    if (!groups.has(key)) {
      groups.set(key, {
        name,
        day,
        date,
        notes: r.notes || '',
        completed: isCompleted(r.completed),
        exercises: [],
      });
    }
    const g = groups.get(key);
    const exercise = (r.exercise || '').trim();
    if (exercise && String(r.exercise).toLowerCase() !== 'skip') {
      const reps = Number(r.reps);
      if (Number.isFinite(reps) && reps > 0) {
        const weight = Number(r.weight);
        const sets = Number(r.sets);
        g.exercises.push({
          exercise,
          sets: Number.isFinite(sets) && sets > 0 ? Math.round(sets) : 1,
          reps: Math.round(reps),
          rpe: parseRpe(r.rpe),
          weight: Number.isFinite(weight) ? Math.max(0, weight) : 0,
        });
      }
    }
  }

  const store = read();
  store.workouts = store.workouts || [];

  // Optional replace: archive completed, then wipe the current plan before
  // loading the new template. Triggered by ?replace=1.
  let archived = 0;
  const replace = req.query.replace === '1' || req.query.replace === 'true';
  if (replace) {
    archived = archiveCompletedWorkouts(store);
    store.workouts = [];
  }

  for (const g of groups.values()) {
    const name = g.name;
    const datePart = /^\d{4}-\d{2}-\d{2}/.test(g.date) ? g.date.slice(0, 10) : null;
    const day = g.day || dayLabel(datePart || todayIso());

    // Allow rest/skip days by turning them into placeholder pages.
    if (String(name).toLowerCase().startsWith('rest') || String(name).toLowerCase().startsWith('skip')) {
      const placeholder = {
        id: store.nextId++,
        name: `Rest Day / ${day}`,
        notes: String(g.notes || 'Rest or mobility only.'),
        completed: false,
        status: 'idle',
        started_at: null,
        elapsed_seconds: 0,
        day,
        date: datePart || todayIso(),
        created_at: nowStamp(),
        completed_at: null,
        sets: [],
        _rest: true,
      };
      store.workouts.push(placeholder);
      workoutsCreated += 1;
      continue;
    }

    const createdAt = datePart ? `${datePart} 00:00:00` : nowStamp();
    const workout = {
      id: store.nextId++,
      name,
      notes: (g.notes || '').trim(),
      completed: !!g.completed,
      status: g.completed ? 'completed' : 'idle',
      started_at: null,
      elapsed_seconds: 0,
      day,
      date: datePart || todayIso(),
      created_at: createdAt,
      completed_at: g.completed ? createdAt : null,
      sets: [],
    };
    workoutsCreated += 1;
    for (const s of g.exercises) {
      const set = { id: store.nextId++, ...s };
      workout.sets.push(set);
      setsCreated += 1;
    }
    store.workouts.push(workout);
  }

  delete store._staged;
  write(store);
  res.json({ ok: true, workoutsCreated, setsCreated, archived, replaced: replace });
});

app.get('/api/export.csv', (req, res) => {
  const store = read();
  const workouts = (store.workouts || []).slice().reverse();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="workouts.csv"');
  res.send(stringify(workoutsToCsvRows(workouts)));
});

app.listen(PORT, () => {
  console.log(`Personal trainer running at http://localhost:${PORT}`);
});
