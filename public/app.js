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

function isoLocal(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

createApp({
  setup() {
    const state = reactive({
      unlocked: !!authToken,
      tokenInput: '',
      error: '',
      view: 'home',
      activeProgram: null,
      currentWeek: 1,
      effortScale: localStorage.getItem('pt_effort_scale') || 'rpe',
      week: null,
      activeSession: null,
      workout: null,
      rest: { remaining: 0, running: false },
    });

    onUnauthorized = () => { state.unlocked = false; };

    async function loadWeek() {
      if (!state.activeProgram) return;
      try {
        state.week = await api(`/api/program/week?number=${state.currentWeek}`);
      } catch (e) { if (!e.unauthorized) state.error = e.message; }
    }

    // Fetch prior sessions' full set data ONCE, newest first, excluding the active session.
    async function loadPriorSessions() {
      const result = [];
      try {
        const sessions = await api('/api/sessions'); // most recent first
        for (const s of sessions) {
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
      } catch (e) { if (!e.unauthorized) state.error = e.message; }
    }

    function finishWorkout() { /* Task 6 implements finish + PR toast */ stopRestInterval(); state.rest = { remaining: 0, running: false }; state.view = 'home'; }

    // Return to Home WITHOUT finishing the session. Every logged set is already
    // persisted server-side (each ✓ posts immediately), so the open session is
    // left intact and can be resumed; nothing is lost.
    function leaveWorkout() {
      stopRestInterval();
      state.rest = { remaining: 0, running: false };
      state.view = 'home';
    }

    async function startWorkout(routine) {
      try {
        const { id } = await api('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ routineId: routine.id }),
        });
        state.activeSession = { id, routine };
        state.view = 'workout';
        await initWorkout(routine);
      } catch (e) { if (!e.unauthorized) state.error = e.message; }
    }

    async function loadActiveProgram() {
      try {
        state.activeProgram = await api('/api/active-program');
        await loadWeek();
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

    if (state.unlocked) loadActiveProgram();

    return {
      ...toRefs(state),
      unlock, lock, saveEffortScale, loadWeek, startWorkout,
      logSet, finishWorkout, leaveWorkout,
      skipRest, addRest,
      fmtPrev: (prev) => PTLogic.formatPrevious(prev, state.effortScale),
    };
  },
}).mount('#app');
