'use strict';

// ---------------------------------------------------------------------------
// VPS configuration — used ONLY by syncProgram() on the native app.
// Must be the HTTPS URL of your VPS (iOS ATS requires HTTPS).
// Replace <your-vps-host> with the actual hostname before building for device.
// ---------------------------------------------------------------------------
const VPS_BASE = 'https://<your-vps-host>';

const { createApp, reactive, toRefs } = Vue;

// Shared secret sent with every API call; the server rejects everything else
// with 401. Stored per-device after the first unlock.
let authToken = localStorage.getItem('pt_token') || '';
let onUnauthorized = () => {};

// ---------------------------------------------------------------------------
// On-device SQLite via @capacitor-community/sqlite.
// localDb is set during initLocalDb(); null means "use HTTP fallback".
// isNative is true iff the SQLite layer is active (running inside Capacitor).
// ---------------------------------------------------------------------------
let localDb = null;
let isNative = false;

async function initLocalDb() {
  try {
    // @capacitor-community/sqlite is loaded by Capacitor at runtime on device.
    // In a plain desktop browser this property simply doesn't exist → fall back.
    const cap = window.Capacitor;
    if (!cap || !cap.Plugins || !cap.Plugins.CapacitorSQLite) return;

    const sqlite = cap.Plugins.CapacitorSQLite;

    // Open (or create) the app database.
    await sqlite.open({ database: 'gymapp', encrypted: false, mode: 'no-encryption' });

    // Build the exec adapter over the plugin's Promise-based API.
    const exec = {
      async run(sql, params) {
        const r = await sqlite.run({ statement: sql, values: params || [] });
        // r.changes is the plugin's changes object: { changes, lastId }
        return { lastId: r.changes.lastId, changes: r.changes.changes };
      },
      async get(sql, params) {
        const r = await sqlite.query({ statement: sql, values: params || [] });
        return (r.values && r.values.length > 0) ? r.values[0] : undefined;
      },
      async all(sql, params) {
        const r = await sqlite.query({ statement: sql, values: params || [] });
        return r.values || [];
      },
      async exec(sql) {
        await sqlite.execute({ statements: sql });
      },
      async begin() {
        await sqlite.run({ statement: 'BEGIN', values: [] });
      },
      async commit() {
        await sqlite.run({ statement: 'COMMIT', values: [] });
      },
      async rollback() {
        await sqlite.run({ statement: 'ROLLBACK', values: [] });
      },
    };

    localDb = LocalDb.createLocalDb(exec);
    await localDb.initSchema();
    isNative = true;
  } catch (e) {
    // Plugin unavailable or init failed → stay on HTTP fallback.
    console.warn('[gymapp] SQLite init skipped, using HTTP fallback:', e && e.message);
    localDb = null;
    isNative = false;
  }
}

// ---------------------------------------------------------------------------
// apiHttpFallback — the original fetch-based api(), unchanged.
// Used when running in a plain desktop browser (localDb === null).
// ---------------------------------------------------------------------------
async function apiHttpFallback(url, options = {}) {
  options.headers = {
    ...(options.headers || {}),
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
  };
  const res = await fetch(url, options);
  if (res.status === 401) {
    onUnauthorized();
    const err = new Error('Passphrase required');
    err.unauthorized = true;
    throw err;
  }
  const text = await res.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // Non-JSON (usually Express's HTML 404 page) → the running server is
      // missing this route. Almost always means it needs a restart.
      throw new Error(
        `Server returned a non-JSON response for ${options.method || 'GET'} ${url} `
        + `(HTTP ${res.status}). Restart the server so it picks up the latest routes.`
      );
    }
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ---------------------------------------------------------------------------
// api() — unified entry point.
// On native (localDb present): routes to local SQLite layer; no fetch, no token.
// On browser (localDb null): delegates to apiHttpFallback() exactly as before.
// ---------------------------------------------------------------------------
async function api(url, options = {}) {
  if (!localDb) return apiHttpFallback(url, options);

  const method = (options.method || 'GET').toUpperCase();
  const body = options.body ? JSON.parse(options.body) : null;
  const u = new URL(url, 'http://x');
  const path = u.pathname;
  const q = u.searchParams;

  // GET /api/active-program
  if (path === '/api/active-program') return localDb.getActiveProgram();

  // GET /api/program/week?number=N
  if (path === '/api/program/week') return localDb.getProgramWeek(Number(q.get('number')) || 1);

  // GET /api/sessions
  if (path === '/api/sessions' && method === 'GET') return localDb.listSessions();

  // POST /api/sessions
  if (path === '/api/sessions' && method === 'POST') {
    return (body && body.date && body.routineId != null)
      ? localDb.findOrCreateSessionForSlot({ routineId: body.routineId, date: body.date })
      : localDb.createSession({ routineId: body ? body.routineId : null });
  }

  // GET /api/sessions/:id
  const mSession = path.match(/^\/api\/sessions\/(\d+)$/);
  if (mSession && method === 'GET') return localDb.getSession(Number(mSession[1]));

  // POST /api/sessions/:id/sets
  const mSets = path.match(/^\/api\/sessions\/(\d+)\/sets$/);
  if (mSets && method === 'POST') {
    const newId = await localDb.logSet({
      sessionId: Number(mSets[1]),
      exerciseName: body.exerciseName,
      setNumber: body.setNumber,
      weight: body.weight,
      reps: body.reps,
      rpe: body.rpe,
    });
    // Recompute PRs for this exercise (mirrors the web server route).
    try {
      const ex = await localDb.findOrCreateExercise(body.exerciseName);
      await localDb.recomputePRs(ex);
    } catch (_) { /* best-effort */ }
    return { id: newId };
  }

  // POST /api/sessions/:id/finish
  const mFinish = path.match(/^\/api\/sessions\/(\d+)\/finish$/);
  if (mFinish && method === 'POST') return localDb.finishSession(Number(mFinish[1]));

  // PUT /api/sets/:id
  const mSet = path.match(/^\/api\/sets\/(\d+)$/);
  if (mSet && method === 'PUT') return localDb.updateSetLog(Number(mSet[1]), body);

  // DELETE /api/sets/:id
  if (mSet && method === 'DELETE') return localDb.deleteSetLog(Number(mSet[1]));

  // PUT /api/program/:id/start-date
  const mStartDate = path.match(/^\/api\/program\/(\d+)\/start-date$/);
  if (mStartDate) return localDb.setProgramStartDate(Number(mStartDate[1]), body.start_date);

  // GET /api/exercises
  if (path === '/api/exercises') return localDb.listLoggedExercises();

  // GET /api/progress/:exercise
  const mProgress = path.match(/^\/api\/progress\/(.+)$/);
  if (mProgress) return localDb.getProgress(decodeURIComponent(mProgress[1]));

  throw new Error('Unrouted local api: ' + method + ' ' + path);
}

function formatElapsed(totalSeconds) {
  const sec = Math.max(0, Math.floor(totalSeconds || 0));
  const h = String(Math.floor(sec / 3600)).padStart(2, '0');
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}


// ---------------------------------------------------------------------------
// Boot: await SQLite init BEFORE mounting Vue so isNative/localDb are set
// when setup() reads them synchronously.
// ---------------------------------------------------------------------------
async function mountApp() {
  await initLocalDb();

  createApp({
  setup() {
    const APP_TZ = 'Pacific/Auckland';
    function todayStr() { return PTLogic.todayInTZ(APP_TZ, new Date()); }

    const state = reactive({
      // On native: start unlocked immediately (no passphrase gate on device).
      // On browser: honour the stored token as before.
      unlocked: isNative || !!authToken,
      tokenInput: '',
      error: '',
      view: 'home',
      activeProgram: null,
      effortScale: localStorage.getItem('pt_effort_scale') || 'rpe',
      week: null,
      activeSession: null,
      workout: null,
      rest: { remaining: 0, running: false },
      toast: '',
      anchorDate: null,
      calendar: [],
      sessionsByDate: {},
      _routinesByDay: null,
      readonly: false,
      exercises: [], progressDetail: null,
      startDateInput: '',
      programDays: [], programDayDetail: null,
      // Sync UI (native only)
      syncDateInput: '',
      // VPS token input — one-time entry on device; persisted to localStorage so
      // subsequent syncs reuse it without re-entry. Shown only when isNative.
      syncTokenInput: localStorage.getItem('pt_token') || '',
    });

    onUnauthorized = () => { state.unlocked = false; };

    async function buildCalendar() {
      if (!state.activeProgram || !state.activeProgram.start_date) { state.calendar = []; return; }
      try {
        if (!state.anchorDate) state.anchorDate = todayStr();
        // routinesByDay: fetch week 1 once for the day_of_week → routine name map (same every week).
        let routinesByDay = state._routinesByDay;
        if (!routinesByDay) {
          const w = await api('/api/program/week?number=1');
          routinesByDay = {};
          for (const r of (w.routines || [])) routinesByDay[r.day_of_week] = r.name;
          state._routinesByDay = routinesByDay;
        }
        // sessions keyed by date (YYYY-MM-DD) for status dots.
        const sessions = await api('/api/sessions');
        const byDate = {};
        for (const s of sessions) {
          const d = String(s.started_at).slice(0, 10);
          // keep the "best" session per date: finished > in-progress; with sets > empty
          const prev = byDate[d];
          const score = (s.finished_at ? 2 : 0) + (s.set_count > 0 ? 1 : 0);
          if (!prev || score > prev._score) byDate[d] = { ...s, _score: score };
        }
        state.sessionsByDate = byDate;
        state.calendar = PTLogic.weekGrid(
          state.activeProgram.start_date,
          state.activeProgram.weekCount,
          state.anchorDate,
          routinesByDay
        );
      } catch (e) { state.error = e.message || String(e); }
    }
    function cellStatus(cell) {
      const s = state.sessionsByDate[cell.date];
      if (s && s.finished_at) return 'done';
      if (s) return 'in-progress';
      if (!cell.inProgram) return 'rest';
      if (cell.date < todayStr()) return 'missed';
      if (cell.date === todayStr()) return 'today';
      return 'upcoming';
    }
    function pageWeek(deltaDays) {
      const d = new Date(state.anchorDate + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + deltaDays);
      state.anchorDate = d.toISOString().slice(0, 10);
      buildCalendar();
    }
    function routineForCell(cell) {
      // find the routine object for this cell's week+day from the week payload
      return (state.week && state.week.routines || []).find((r) => r.name === cell.routineName) || null;
    }
    async function loadWeekForCell(cell) {
      const slot = PTLogic.dateToSlot(state.activeProgram.start_date, state.activeProgram.weekCount, cell.date);
      if (!slot) return null;
      state.week = await api(`/api/program/week?number=${slot.weekNumber}`);
      return routineForCell(cell);
    }
    function hydrateFromSession(routine, full, editable) {
      // Build the workout grid, marking logged sets done; extra target sets appended as blank (editable only).
      const priorByExercise = {};
      for (const s of full.sets) (priorByExercise[s.exercise] = priorByExercise[s.exercise] || []).push(s);
      const exercises = [];
      for (const rx of routine.exercises) {
        const logged = (priorByExercise[rx.exercise] || []).sort((a, b) => a.set_number - b.set_number);
        const sets = [];
        const target = rx.target_sets || logged.length || 1;
        for (let i = 1; i <= Math.max(target, logged.length); i++) {
          const done = logged.find((x) => x.set_number === i);
          sets.push(done
            ? { set_number: i, prev: null, weight: done.weight, reps: done.reps, rpe: done.rpe, done: !!done.is_complete, logId: done.id }
            : { set_number: i, prev: null, weight: null, reps: null, rpe: rx.target_rpe != null ? rx.target_rpe : null, done: false, logId: null });
        }
        exercises.push({ name: rx.exercise, rest_seconds: rx.rest_seconds || 90, sets });
      }
      state.workout = { exercises, current: 0 };
      state.readonly = !editable;
    }
    async function openDay(cell) {
      if (!cell.inProgram) { showToast('Rest day'); return; }
      const routine = await loadWeekForCell(cell);
      if (!routine) { showToast('No routine'); return; }
      const sessions = await api('/api/sessions');
      const slotSession = sessions.find((s) => String(s.started_at).slice(0, 10) === cell.date && s.routine_name === routine.name) || null;
      if (slotSession && slotSession.finished_at) {
        const full = await api(`/api/sessions/${slotSession.id}`);
        state.activeSession = { id: slotSession.id, routine };
        hydrateFromSession(routine, full, false); // read-only
        state.view = 'workout';
        return;
      }
      if (slotSession) { // unfinished → resume editable
        const full = await api(`/api/sessions/${slotSession.id}`);
        state.activeSession = { id: slotSession.id, routine };
        hydrateFromSession(routine, full, true);
        state.view = 'workout';
        return;
      }
      // none → start (idempotent per slot)
      const resp = await api('/api/sessions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ routineId: routine.id, date: cell.date }),
      });
      state.activeSession = { id: resp.id, routine };
      state.readonly = false;
      await initWorkout(routine); // existing Phase-3b builder (prefill), now program-scoped (below)
      state.view = 'workout';
    }
    function editReadonly() { state.readonly = false; }

    // Fetch prior sessions' full set data ONCE, newest first, excluding the active session.
    async function loadPriorSessions() {
      const result = [];
      try {
        const sessions = await api('/api/sessions'); // most recent first
        const scoped = sessions.filter((s) => !state.activeProgram || s.program_id === state.activeProgram.id);
        for (const s of scoped) {
          if (state.activeSession && s.id === state.activeSession.id) continue;
          const full = await api(`/api/sessions/${s.id}`);
          result.push(full);
        }
      } catch (e) { if (!e.unauthorized) state.error = e.message; }
      return result;
    }

    // Given already-loaded prior sessions, return the newest session's sets for an exercise.
    function priorSetsFor(priorSessions, exerciseName) {
      for (const full of priorSessions) {
        const matching = full.sets.filter((x) => x.exercise === exerciseName);
        if (matching.length) return matching;
      }
      return [];
    }

    async function initWorkout(routine) {
      const priorSessions = await loadPriorSessions();
      const exercises = [];
      for (const rx of routine.exercises) {
        const prior = priorSetsFor(priorSessions, rx.exercise);
        const sets = [];
        for (let i = 1; i <= (rx.target_sets || 1); i++) {
          const pf = PTLogic.prefillForSet(prior, i, rx);
          sets.push({
            set_number: i,
            prev: PTLogic.resolvePrevious(prior, i),
            weight: pf.weight,
            reps: pf.reps,
            rpe: rx.target_rpe != null ? rx.target_rpe : null,
            done: false,
            logId: null,
          });
        }
        exercises.push({ name: rx.exercise, rest_seconds: rx.rest_seconds || 90, sets });
      }
      state.workout = { exercises, current: 0 };
    }

    let restInterval = null;
    function stopRestInterval() { if (restInterval) { clearInterval(restInterval); restInterval = null; } }
    function startRest(seconds) {
      stopRestInterval();
      state.rest = PTLogic.nextRestState(seconds);
      if (!state.rest.running) return;
      restInterval = setInterval(() => {
        const next = PTLogic.tickRest(state.rest);
        state.rest = { remaining: next.remaining, running: next.running };
        if (next.justFinished) { beep(); if (navigator.vibrate) navigator.vibrate(400); stopRestInterval(); }
      }, 1000);
    }
    function skipRest() { state.rest = { remaining: 0, running: false }; stopRestInterval(); }
    function addRest(delta) { if (state.rest.running) state.rest = { remaining: Math.max(0, state.rest.remaining + delta), running: true }; }
    function beep() {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const o = ctx.createOscillator(); o.frequency.value = 880; o.connect(ctx.destination);
        o.addEventListener('ended', () => { ctx.close().catch(() => {}); });
        o.start(); o.stop(ctx.currentTime + 0.2);
      } catch (e) { /* audio not available */ }
    }

    async function logSet(ex, set) {
      try {
        const row = await api(`/api/sessions/${state.activeSession.id}/sets`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            exerciseName: ex.name,
            setNumber: set.set_number,
            weight: set.weight,
            reps: set.reps,
            rpe: set.rpe,
          }),
        });
        if (!row || row.id == null) throw new Error('set log failed: no id returned');
        set.done = true;
        set.logId = row.id;
        startRest(ex.rest_seconds);
        try {
          const prog = await api(`/api/progress/${encodeURIComponent(ex.name)}`);
          if (prog.pr && set.weight != null && set.reps != null) {
            const est = set.weight * (1 + set.reps / 30);
            if (est >= prog.pr.best_est_1rm - 0.01) {
              showToast(`🎉 ${ex.name} PR! est 1RM ${Math.round(est)}kg`);
            }
          }
        } catch (e) { /* progress is best-effort; ignore */ }
      } catch (e) { if (!e.unauthorized) state.error = e.message; }
    }

    async function finishWorkout() {
      stopRestInterval();
      state.rest = { remaining: 0, running: false };
      let finished = false;
      if (state.activeSession) {
        try {
          await api(`/api/sessions/${state.activeSession.id}/finish`, { method: 'POST' });
          finished = true;
        } catch (e) { if (!e.unauthorized) state.error = e.message; }
      }
      state.activeSession = null;
      state.workout = null;
      state.view = 'home';
      await buildCalendar();
      if (finished) showToast('✓ Workout saved and completed');
    }

    function showToast(msg) {
      state.toast = msg;
      setTimeout(() => { if (state.toast === msg) state.toast = ''; }, 3000);
    }

    // Return to Home WITHOUT finishing the session. Every logged set is already
    // persisted server-side (each ✓ posts immediately), so the open session is
    // left intact and can be resumed; nothing is lost.
    function leaveWorkout() {
      stopRestInterval();
      state.rest = { remaining: 0, running: false };
      state.view = 'home';
    }

    async function saveStartDate() {
      const d = state.startDateInput;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { state.error = 'Enter a valid date (YYYY-MM-DD)'; return; }
      state.error = '';
      try {
        await api(`/api/program/${state.activeProgram.id}/start-date`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ start_date: d }),
        });
        state.activeProgram.start_date = d;
        await buildCalendar();
        showToast(`✓ Start date saved: ${d}`);
      } catch (e) { if (!e.unauthorized) state.error = e.message; }
    }

    async function loadActiveProgram() {
      try {
        state.activeProgram = await api('/api/active-program');
        state.startDateInput = state.activeProgram ? (state.activeProgram.start_date || '') : '';
        await buildCalendar();
        await loadProgramDays();
      } catch (e) {
        if (!e.unauthorized) state.error = e.message;
      }
    }

    // Read-only reference view of the active program's day-types (Push/Pull/…).
    // Structure is week-independent for names+sets, so week 1 is canonical.
    async function loadProgramDays() {
      if (!state.activeProgram) { state.programDays = []; return; }
      try {
        const w = await api('/api/program/week?number=1');
        state.programDays = (w.routines || []).map((r) => ({
          name: r.name,
          exercises: (r.exercises || []).map((e) => ({ exercise: e.exercise, target_sets: e.target_sets })),
        }));
      } catch (e) { if (!e.unauthorized) state.error = e.message; }
    }
    function openProgramDay(day) { state.programDayDetail = day; }
    function closeProgramDay() { state.programDayDetail = null; }

    async function unlock() {
      const t = state.tokenInput.trim();
      if (!t) return;
      authToken = t; // in-memory so the verify call is authenticated
      state.tokenInput = '';
      state.error = '';
      try {
        await api('/api/active-program');
        localStorage.setItem('pt_token', t); // persist only after success
        state.unlocked = true;
        await loadActiveProgram();
      } catch (e) {
        authToken = '';
        localStorage.removeItem('pt_token');
        state.unlocked = false;
        state.error = 'Wrong passphrase';
      }
    }

    function lock() {
      authToken = '';
      localStorage.removeItem('pt_token');
      state.unlocked = false;
    }

    function saveEffortScale() {
      localStorage.setItem('pt_effort_scale', state.effortScale);
    }

    async function loadExercises() {
      try { state.exercises = await api('/api/exercises'); } catch (e) { if (!e.unauthorized) state.error = e.message; }
    }
    async function openProgress(name) {
      try {
        const p = await api(`/api/progress/${encodeURIComponent(name)}`);
        p.history = (p.history || []).filter((h) => h.est_1rm > 0);
        if (p.pr && !(p.pr.best_est_1rm > 0)) p.pr = null;
        state.progressDetail = { exercise: name, ...p };
      } catch (e) { if (!e.unauthorized) state.error = e.message; }
    }
    function progressSparkline(history) {
      const vals = (history || []).map((h) => h.est_1rm);
      if (vals.length < 2) return '';
      const max = Math.max(...vals), min = Math.min(...vals), span = max - min || 1;
      return vals.map((v, i) => {
        const x = (i / (vals.length - 1)) * 280;
        const y = 60 - ((v - min) / span) * 56 - 2;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ');
    }
    function closeProgress() { state.progressDetail = null; }

    // -----------------------------------------------------------------------
    // syncProgram — fetch the active program from the VPS and import it into
    // the local SQLite DB, then set the chosen start date.
    // Native-only: only shown in UI when isNative is true.
    // -----------------------------------------------------------------------
    async function syncProgram() {
      const d = state.syncDateInput;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
        state.error = 'Enter a valid start date (YYYY-MM-DD)';
        return;
      }
      // The passphrase screen is removed on device, so the sync fetch has no token
      // unless the user supplies one here (persisted for future syncs).
      const tok = (state.syncTokenInput || '').trim();
      if (tok) { authToken = tok; localStorage.setItem('pt_token', tok); }
      if (!authToken) { state.error = 'Enter your VPS token to sync'; return; }
      state.error = '';
      try {
        const res = await fetch(VPS_BASE + '/api/program/current', {
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
        });
        if (!res.ok) throw new Error(`VPS responded ${res.status}`);
        const json = await res.json();
        // importProgram is idempotent on slug — safe to call repeatedly.
        const programId = await localDb.importProgram(json);
        await localDb.setProgramStartDate(programId, d);
        state._routinesByDay = null; // invalidate cached week map
        await loadActiveProgram();
        // getCurrentProgramJson serves active:true, so import should activate it;
        // guard against a bad payload so we don't toast a misleading success.
        if (!state.activeProgram) { state.error = 'Synced but no active program — check the VPS payload'; return; }
        showToast(`✓ Program synced, starts ${d}`);
      } catch (e) {
        state.error = 'Sync failed: ' + (e.message || String(e));
      }
    }

    // -----------------------------------------------------------------------
    // Boot
    // -----------------------------------------------------------------------
    // On native: skip passphrase, go straight to home.
    // On browser: honour token as before.
    if (state.unlocked) loadActiveProgram();

    return {
      ...toRefs(state),
      isNative,
      unlock, lock, saveEffortScale, saveStartDate,
      logSet, finishWorkout, leaveWorkout,
      skipRest, addRest,
      pageWeek, openDay, cellStatus, buildCalendar,
      editReadonly,
      loadExercises, openProgress, closeProgress, progressSparkline,
      openProgramDay, closeProgramDay,
      syncProgram,
      fmtPrev: (prev) => PTLogic.formatPrevious(prev, state.effortScale),
    };
  },
  }).mount('#app');
}

mountApp();
