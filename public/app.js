'use strict';

const { createApp, reactive, toRefs } = Vue;

// Shared secret sent with every API call; the server rejects everything else
// with 401. Stored per-device after the first unlock.
let authToken = localStorage.getItem('pt_token') || '';
let onUnauthorized = () => {};

async function api(url, options = {}) {
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

function formatElapsed(totalSeconds) {
  const sec = Math.max(0, Math.floor(totalSeconds || 0));
  const h = String(Math.floor(sec / 3600)).padStart(2, '0');
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}


createApp({
  setup() {
    const APP_TZ = 'Pacific/Auckland';
    function todayStr() { return PTLogic.todayInTZ(APP_TZ, new Date()); }

    const state = reactive({
      unlocked: !!authToken,
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
      if (state.activeSession) {
        try { await api(`/api/sessions/${state.activeSession.id}/finish`, { method: 'POST' }); }
        catch (e) { if (!e.unauthorized) state.error = e.message; }
      }
      state.activeSession = null;
      state.workout = null;
      state.view = 'home';
      await buildCalendar();
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
      try {
        await api(`/api/program/${state.activeProgram.id}/start-date`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ start_date: d }),
        });
        state.activeProgram.start_date = d;
        await buildCalendar();
      } catch (e) { if (!e.unauthorized) state.error = e.message; }
    }

    async function loadActiveProgram() {
      try {
        state.activeProgram = await api('/api/active-program');
        state.startDateInput = state.activeProgram.start_date || '';
        await buildCalendar();
      } catch (e) {
        if (!e.unauthorized) state.error = e.message;
      }
    }

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

    if (state.unlocked) loadActiveProgram();

    return {
      ...toRefs(state),
      unlock, lock, saveEffortScale, saveStartDate,
      logSet, finishWorkout, leaveWorkout,
      skipRest, addRest,
      pageWeek, openDay, cellStatus, buildCalendar,
      editReadonly,
      loadExercises, openProgress, closeProgress, progressSparkline,
      fmtPrev: (prev) => PTLogic.formatPrevious(prev, state.effortScale),
    };
  },
}).mount('#app');
