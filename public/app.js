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
      view: 'overview',
      week: null,
      weekOffset: 0,
      weekLabel: '',
      progress: null,
      error: '',
      message: '',
      newWorkout: { name: '', notes: '', date: '' },
      editingWorkoutId: null,
      editWorkout: { name: '', notes: '' },
      editingSetId: null,
      editSet: { exercise: '', sets: null, reps: null, rpe: null, weight: null },
      importText: '',
      replaceOnImport: false,
      archiveCount: 0,
      selectedWorkout: null,
      setDrafts: {},
      setEdits: {},              // per-set inline drafts while a workout is in progress
      timerDuration: 60,
      running: false,            // is the workout elapsed timer ticking?
      needAuth: !authToken,      // show the passphrase gate?
      authFailed: false,         // last stored/entered passphrase was rejected
      tokenInput: '',
      authToken,                 // reactive copy, used to build download links
    });

    onUnauthorized = () => {
      state.authFailed = !!authToken;
      state.needAuth = true;
    };

    function submitToken() {
      const t = state.tokenInput.trim();
      if (!t) return;
      authToken = t;
      localStorage.setItem('pt_token', t);
      state.authToken = t;
      state.tokenInput = '';
      state.needAuth = false;
      state.authFailed = false;
      loadOverview();
      loadArchiveCount();
    }

    function ensureDraft(id) {
      if (!state.setDrafts[id]) {
        state.setDrafts = { ...state.setDrafts, [id]: { exercise: '', sets: '', reps: '', rpe: '', weight: '' } };
      }
    }

    let flashTimer = null;
    function flash(msg, isError = false) {
      state.error = isError ? msg : '';
      state.message = isError ? '' : msg;
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => { state.error = ''; state.message = ''; }, 3500);
    }
    // 401s are handled by the passphrase gate — no error banner needed.
    const fail = (err) => { if (!err || !err.unauthorized) flash(err.message || String(err), true); };

    async function loadOverview() {
      try {
        const data = await api(`/api/program/weeks?offset=${state.weekOffset}`);
        state.week = data;
        state.weekLabel = data.label || formatWeekLabel(data.start, data.end);
      } catch (err) { fail(err); }
    }

    function formatWeekLabel(start, end) {
      if (!start || !end) return '';
      const s = new Date(start + 'T00:00:00');
      const e = new Date(end + 'T00:00:00');
      const opts = { month: 'short', day: 'numeric' };
      return `${s.toLocaleDateString(undefined, opts)} – ${e.toLocaleDateString(undefined, opts)}`;
    }

    function changeWeek(delta) {
      state.weekOffset += delta;
      loadOverview();
    }

    function goThisWeek() {
      if (state.weekOffset === 0) return;
      state.weekOffset = 0;
      loadOverview();
    }

    function formatDate(iso) {
      if (!iso) return '';
      const d = new Date(iso + 'T00:00:00');
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }

    function isToday(iso) {
      if (!iso) return false;
      return iso === isoLocal(new Date());   // local date, matching the server
    }

    function openWorkout(w) {
      state.view = 'workouts';
      state.selectedWorkout = w;
      ensureDraft(w.id);
      loadElapsed(w.elapsed_seconds || 0);   // show saved time; don't auto-run
      setRest(state.timerDuration);
      if (w.status === 'in_progress') syncSetEdits(w, { preserve: false });
    }

    // Build (or refresh) the per-set inline edit drafts. preserve=true keeps
    // any drafts the user is currently typing and only adds/removes rows.
    function syncSetEdits(w, { preserve = true } = {}) {
      const next = {};
      for (const s of (w.sets || [])) {
        next[s.id] = (preserve && state.setEdits[s.id])
          ? state.setEdits[s.id]
          : { exercise: s.exercise, sets: s.sets ?? 1, reps: s.reps, rpe: s.rpe ?? '', weight: s.weight };
      }
      state.setEdits = next;
    }

    // Prescribed RPE, matching the server: blank / non-numeric / ≤0 → null
    // (no target), otherwise a whole number clamped to 1–10.
    function parseRpe(v) {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) return null;
      return Math.min(10, Math.max(1, Math.round(n)));
    }

    // Normalise a set-entry draft (from either the add form or an inline edit)
    // into the payload the API expects. Returns { error } or { values }.
    function parseSetDraft(draft) {
      const d = draft || {};
      const exercise = String(d.exercise || '').trim();
      const reps = Number(d.reps);
      if (!exercise || !Number.isFinite(reps) || reps <= 0) {
        return { error: 'Exercise and reps are required' };
      }
      return {
        values: {
          exercise,
          sets: Math.max(1, Math.round(Number(d.sets) || 1)),
          reps: Math.round(reps),
          rpe: parseRpe(d.rpe),
          weight: Math.max(0, Number(d.weight) || 0),
        },
      };
    }

    async function saveSetInline(w, s) {
      const draft = state.setEdits[s.id];
      if (!draft) return;
      const { error, values } = parseSetDraft(draft);
      if (error) { flash(error, true); return; }
      try {
        await api(`/api/sets/${s.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...values, workoutId: w.id }),
        });
        // reflect saved values locally so other rows keep their unsaved input
        Object.assign(s, values);
        await loadOverview();
      } catch (err) { fail(err); }
    }

    function goBackToOverview() {
      state.view = 'overview';
      state.selectedWorkout = null;
      loadOverview();
    }

    // Build a tiny inline-SVG sparkline (top weight over time) from a series
    // of numbers. Returns viewBox dims, a polyline `points` string, and the
    // last point so we can dot it. null for an empty series.
    function sparkline(values) {
      if (!values.length) return null;
      const w = 200, h = 40, pad = 4;
      const min = Math.min(...values);
      const max = Math.max(...values);
      const span = max - min || 1;
      const n = values.length;
      const pts = values.map((v, i) => {
        const x = n === 1 ? w / 2 : pad + (i / (n - 1)) * (w - 2 * pad);
        const y = h - pad - ((v - min) / span) * (h - 2 * pad);
        return [Number(x.toFixed(1)), Number(y.toFixed(1))];
      });
      const last = pts[pts.length - 1];
      return { w, h, points: pts.map((p) => p.join(',')).join(' '), single: n === 1, lastX: last[0], lastY: last[1] };
    }

    async function loadProgress() {
      state.view = 'progress';
      try {
        // Progress spans finished sessions too, so pull the archive as well
        // and merge (active copy wins when an id appears in both).
        const [active, archived] = await Promise.all([
          api('/api/workouts'),
          api('/api/archive').catch(() => []),
        ]);
        const byId = new Map();
        for (const w of archived || []) byId.set(w.id, w);
        for (const w of active || []) byId.set(w.id, w);

        // Group every set by exercise, then by session date.
        const groups = new Map();
        for (const w of byId.values()) {
          const date = (w.date || (w.created_at || '').slice(0, 10) || '').slice(0, 10);
          if (!date) continue;
          for (const s of (w.sets || [])) {
            const name = (s.exercise || '').trim();
            if (!name) continue;
            const key = name.toLowerCase();
            let g = groups.get(key);
            if (!g) { g = { key, name, sessions: new Map() }; groups.set(key, g); }
            const setCount = Number(s.sets) || 1;
            const reps = Number(s.reps) || 0;
            const weight = Number(s.weight) || 0;
            const sess = g.sessions.get(date) || { date, day: w.day || '', topWeight: 0, volume: 0, entries: [] };
            sess.topWeight = Math.max(sess.topWeight, weight);
            sess.volume += setCount * reps * weight;
            sess.entries.push(`${setCount}×${reps}${weight ? ' @ ' + weight : ''}`);
            g.sessions.set(date, sess);
          }
        }

        state.progress = [...groups.values()].map((g) => {
          const sessions = [...g.sessions.values()]
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((s) => ({ date: s.date, day: s.day, topWeight: s.topWeight, volume: Math.round(s.volume), summary: s.entries.join(', ') }));
          return {
            key: g.key,
            name: g.name,
            sessionCount: sessions.length,
            topWeight: sessions.reduce((m, s) => Math.max(m, s.topWeight), 0),
            lastDate: sessions.length ? sessions[sessions.length - 1].date : '',
            sessions,
            spark: sparkline(sessions.map((s) => s.topWeight)),
          };
        }).sort((a, b) => b.lastDate.localeCompare(a.lastDate) || a.name.localeCompare(b.name));
      } catch (err) { fail(err); }
    }

    async function createWorkout() {
      if (!state.newWorkout.name.trim()) return;
      try {
        await api('/api/workouts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(state.newWorkout),
        });
        state.newWorkout = { name: '', notes: '', date: '' };
        await loadOverview();
        flash('Workout added');
      } catch (err) { fail(err); }
    }

    function startEditWorkout(w) {
      state.editingWorkoutId = w.id;
      state.editWorkout = { name: w.name, notes: w.notes };
    }

    async function saveWorkout(w) {
      try {
        await api(`/api/workouts/${w.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(state.editWorkout),
        });
        state.editingWorkoutId = null;
        if (state.view === 'workouts' && state.selectedWorkout && state.selectedWorkout.id === w.id) {
          state.selectedWorkout = { ...state.selectedWorkout, ...state.editWorkout };
        }
        if (state.view === 'progress') await loadProgress();
        await loadOverview();
      } catch (err) { fail(err); }
    }

    async function updateWorkoutStatus(w, status, elapsed = null) {
      try {
        const body = { status };
        if (elapsed != null) body.elapsed_seconds = elapsed;
        const data = await api(`/api/workouts/${w.id}/status`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (state.view === 'workouts' && state.selectedWorkout && state.selectedWorkout.id === w.id) {
          state.selectedWorkout = data;
        }
        if (state.view === 'progress') await loadProgress();
        await loadOverview();
      } catch (err) { fail(err); }
    }

    async function startWorkout(w) {
      primeAudio();
      loadElapsed(w.elapsed_seconds || 0);
      runElapsed();
      await updateWorkoutStatus(w, 'in_progress', currentElapsed());
      syncSetEdits(state.selectedWorkout || w, { preserve: false });
    }

    async function pauseWorkout(w) {
      stopElapsed();
      await updateWorkoutStatus(w, 'in_progress', currentElapsed());
    }

    async function resumeWorkout(w) {
      runElapsed();
      await updateWorkoutStatus(w, 'in_progress', currentElapsed());
    }

    async function finishWorkout(w) {
      stopElapsed();
      await updateWorkoutStatus(w, 'completed', currentElapsed());
    }

    async function reopenWorkout(w) {
      loadElapsed(0);
      await updateWorkoutStatus(w, 'idle');
    }

    async function deleteWorkout(w) {
      if (!confirm(`Delete "${w.name}"?`)) return;
      try {
        await api(`/api/workouts/${w.id}`, { method: 'DELETE' });
        if (state.view === 'workouts' && state.selectedWorkout && state.selectedWorkout.id === w.id) {
          state.selectedWorkout = null;
          state.view = 'overview';   // avoid a blank screen on the now-empty detail view
        }
        if (state.view === 'progress') await loadProgress();
        await loadOverview();
      } catch (err) { fail(err); }
    }

    async function addSet(w) {
      const { error, values } = parseSetDraft(state.setDrafts[w.id]);
      if (error) { flash(error, true); return; }

      try {
        await api(`/api/workouts/${w.id}/sets`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(values),
        });
        state.setDrafts = { ...state.setDrafts, [w.id]: { exercise: '', sets: '', reps: '', rpe: '', weight: '' } };
        await loadOverview();
        if (state.view === 'progress') await loadProgress();
        if (state.view === 'workouts' && state.selectedWorkout && state.selectedWorkout.id === w.id) {
          const data = await api(`/api/workouts/${w.id}`);
          state.selectedWorkout = data;
          state.setDrafts = { ...state.setDrafts, [w.id]: { exercise: '', sets: '', reps: '', rpe: '', weight: '' } };
          if (data.status === 'in_progress') syncSetEdits(data, { preserve: true });
        }
      } catch (err) { fail(err); }
    }

    function startEditSet(s) {
      state.editingSetId = s.id;
      state.editSet = { exercise: s.exercise, sets: s.sets ?? 1, reps: s.reps, rpe: s.rpe ?? '', weight: s.weight };
    }

    async function saveSet(w, s) {
      try {
        await api(`/api/sets/${s.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(state.editSet),
        });
        state.editingSetId = null;
        if (state.view === 'workouts' && state.selectedWorkout && state.selectedWorkout.id === w.id) {
          const data = await api(`/api/workouts/${w.id}`);
          state.selectedWorkout = data;
        }      } catch (err) { fail(err); }
    }

    async function deleteSet(w, s) {
      try {
        await api(`/api/sets/${s.id}`, { method: 'DELETE' });
        if (state.view === 'workouts' && state.selectedWorkout && state.selectedWorkout.id === w.id) {
          const data = await api(`/api/workouts/${w.id}`);
          state.selectedWorkout = data;
          if (data.status === 'in_progress') syncSetEdits(data, { preserve: true });
        }
        await loadOverview();
      } catch (err) { fail(err); }
    }

    function onFile(e) {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => { state.importText = reader.result; };
      reader.readAsText(file);
    }

    async function doImport() {
      try {
        const url = state.replaceOnImport ? '/api/import?replace=1' : '/api/import';
        const result = await api(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/csv' },
          body: state.importText,
        });
        state.importText = '';
        const extra = result.archived ? ` (archived ${result.archived} completed)` : '';
        flash(`Imported ${result.workoutsCreated} workouts and ${result.setsCreated} sets${extra}.`);
        await loadOverview();
        await loadArchiveCount();
      } catch (err) { fail(err); }
    }

    async function loadArchiveCount() {
      try {
        const arch = await api('/api/archive');
        state.archiveCount = (arch || []).length;
      } catch { /* ignore */ }
    }

    async function archiveCompleted() {
      try {
        const r = await api('/api/archive', { method: 'POST' });
        flash(`Archived ${r.archived} completed workout(s). ${r.totalArchived} saved in total.`);
        await loadArchiveCount();
      } catch (err) { fail(err); }
    }

    async function clearAllWorkouts() {
      if (!confirm('Clear ALL workouts from your current plan?\nCompleted ones are archived first, so your history is kept.')) return;
      try {
        const r = await api('/api/workouts', { method: 'DELETE' });
        flash(`Cleared ${r.cleared} workout(s); archived ${r.archived} completed.`);
        state.view = 'overview';
        state.selectedWorkout = null;
        await loadOverview();
        await loadArchiveCount();
      } catch (err) { fail(err); }
    }

    const timerPresets = [30, 60, 90, 120, 180, 240, 300, 360, 420, 480, 540, 600];
    const timerDisplay = Vue.ref('00:00:00');   // workout elapsed (counts up)
    const restTimerDisplay = Vue.ref('01:00');  // rest countdown (counts down)

    // Both timers are derived from wall-clock timestamps rather than a
    // per-second counter. iOS Safari freezes JS timers while the screen is
    // locked, so a naive setInterval loses that time; computing from
    // Date.now() means we always show the true elapsed/remaining time the
    // moment the tab wakes up.

    // --- workout elapsed timer ---
    let elapsedBase = 0;      // seconds banked from previous (paused) runs
    let runStartMs = null;    // epoch ms the current run began, null when paused
    let elapsedId = null;
    let lastSyncedSec = 0;    // last value pushed to the server

    function currentElapsed() {
      const live = runStartMs != null ? (Date.now() - runStartMs) / 1000 : 0;
      return Math.max(0, Math.round(elapsedBase + live));
    }
    function renderElapsed() { timerDisplay.value = formatElapsed(currentElapsed()); }

    // Best-effort background save so closing the tab mid-workout loses at most
    // a few seconds. Doesn't reload the UI like updateWorkoutStatus does.
    async function persistElapsed(w, seconds) {
      try {
        await api(`/api/workouts/${w.id}/status`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'in_progress', elapsed_seconds: seconds }),
        });
      } catch { /* transient; next tick retries */ }
    }

    function runElapsed() {
      if (elapsedId) return;
      runStartMs = Date.now();
      state.running = true;
      renderElapsed();
      elapsedId = setInterval(() => {
        renderElapsed();
        const now = currentElapsed();
        if (now - lastSyncedSec >= 15 && state.selectedWorkout) {
          lastSyncedSec = now;
          persistElapsed(state.selectedWorkout, now);
        }
      }, 1000);
    }
    function stopElapsed() {
      if (runStartMs != null) { elapsedBase = currentElapsed(); runStartMs = null; }
      clearInterval(elapsedId);
      elapsedId = null;
      state.running = false;
      renderElapsed();
    }
    function loadElapsed(seconds) {
      clearInterval(elapsedId);
      elapsedId = null;
      runStartMs = null;
      state.running = false;
      elapsedBase = Math.max(0, Math.round(Number(seconds) || 0));
      lastSyncedSec = elapsedBase;
      renderElapsed();
    }

    // --- rest countdown timer (independent of the workout timer) ---
    let restRemaining = 60;   // seconds shown while paused
    let restEndMs = null;     // epoch ms the countdown hits zero, null when paused
    let restId = null;
    let restAlarmed = false;

    function currentRest() {
      if (restEndMs != null) return Math.max(0, Math.round((restEndMs - Date.now()) / 1000));
      return Math.max(0, Math.round(restRemaining));
    }
    function renderRest() { restTimerDisplay.value = formatElapsed(currentRest()); }

    function setRest(secs) {
      clearInterval(restId);
      restId = null;
      restEndMs = null;
      restRemaining = Math.max(0, Math.round(Number(secs) || 0));
      restAlarmed = false;
      renderRest();
    }
    function tickRest() {
      renderRest();
      if (restEndMs != null && currentRest() <= 0 && !restAlarmed) {
        restAlarmed = true;
        clearInterval(restId);
        restId = null;
        restEndMs = null;
        restRemaining = 0;
        fireRestAlarm();
      }
    }
    function startRest() {
      primeAudio();
      if (restId) return;
      let secs = currentRest();
      if (secs <= 0) secs = Math.max(0, Math.round(Number(state.timerDuration) || 0));
      if (secs <= 0) return;
      restEndMs = Date.now() + secs * 1000;
      restAlarmed = false;
      renderRest();
      // 250ms so it catches up quickly and fires the alarm on time when foreground.
      restId = setInterval(tickRest, 250);
    }
    function pauseRest() {
      if (restEndMs != null) { restRemaining = currentRest(); restEndMs = null; }
      clearInterval(restId);
      restId = null;
      renderRest();
    }
    function resetRest() {
      setRest(state.timerDuration);
    }
    function bumpRest(delta) {
      // ±15s. Works whether running (shift the end time) or paused (shift base).
      if (restEndMs != null) {
        restEndMs = Math.max(Date.now(), restEndMs + delta * 1000);
        if (delta > 0) restAlarmed = false;
      } else {
        restRemaining = Math.max(0, restRemaining + delta);
      }
      renderRest();
    }

    // --- rest-over alarm ---
    // Web Audio primed inside a user tap (Start), because iOS won't play audio
    // that wasn't unlocked by a gesture. vibrate() is a no-op on iOS but helps
    // on Android.
    let audioCtx = null;
    function primeAudio() {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx && !audioCtx) audioCtx = new Ctx();
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
      } catch { /* audio unavailable — fall back to the banner + vibrate */ }
    }
    function beep() {
      if (!audioCtx) return;
      try {
        const t0 = audioCtx.currentTime;
        for (let i = 0; i < 3; i++) {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          const start = t0 + i * 0.25;
          osc.type = 'sine';
          osc.frequency.value = 880;
          gain.gain.setValueAtTime(0.0001, start);
          gain.gain.exponentialRampToValueAtTime(0.4, start + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
          osc.connect(gain).connect(audioCtx.destination);
          osc.start(start);
          osc.stop(start + 0.22);
        }
      } catch { /* ignore */ }
    }
    function fireRestAlarm() {
      beep();
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      flash('Rest over — next set!');
    }

    // When the tab wakes from being backgrounded (phone unlock, app switch),
    // recompute both timers immediately instead of waiting for the throttled
    // interval — and fire the rest alarm if it expired while we were away.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      renderElapsed();
      if (restEndMs != null) tickRest();
      else renderRest();
    });

    if (authToken) {
      loadOverview();
      loadArchiveCount();
    }

    return {
      ...toRefs(state),
      submitToken,
      timerDisplay,
      restTimerDisplay,
      formatWeekLabel,
      formatElapsed,
      changeWeek,
      goThisWeek,
      formatDate,
      isToday,
      openWorkout,
      goBackToOverview,
      loadProgress,
      createWorkout,
      startEditWorkout,
      saveWorkout,
      startWorkout,
      pauseWorkout,
      resumeWorkout,
      finishWorkout,
      reopenWorkout,
      deleteWorkout,
      addSet,
      startEditSet,
      saveSet,
      saveSetInline,
      deleteSet,
      onFile,
      doImport,
      archiveCompleted,
      clearAllWorkouts,
      timerPresets,
      setRest,
      startRest,
      pauseRest,
      resetRest,
      bumpRest,
    };
  },
}).mount('#app');
