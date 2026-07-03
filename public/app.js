'use strict';

const { createApp, reactive, toRefs } = Vue;

async function api(url, options = {}) {
  const res = await fetch(url, options);
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
      workouts: [],
      week: null,
      weekOffset: 0,
      weekLabel: '',
      weekPanelOpen: false,
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
    });

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
    const fail = (err) => flash(err.message || String(err), true);

    async function loadWorkouts() {
      try {
        state.workouts = await api('/api/workouts');
      } catch (err) { fail(err); }
    }

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

    function toggleWeekPanel() {
      state.weekPanelOpen = !state.weekPanelOpen;
    }

    function formatDate(iso) {
      if (!iso) return '';
      const d = new Date(iso + 'T00:00:00');
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }

    function isToday(iso) {
      if (!iso) return false;
      const today = new Date().toISOString().slice(0, 10);
      return iso === today;
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

    async function saveSetInline(w, s) {
      const draft = state.setEdits[s.id];
      if (!draft) return;
      const exercise = String(draft.exercise || '').trim();
      const sets = Math.max(1, Math.round(Number(draft.sets) || 1));
      const reps = Number(draft.reps);
      const rpe = draft.rpe === '' || draft.rpe == null ? null : Math.min(10, Math.max(1, Math.round(Number(draft.rpe)))) || null;
      const weight = Math.max(0, Number(draft.weight) || 0);
      if (!exercise || !Number.isFinite(reps) || reps <= 0) {
        flash('Exercise and reps are required', true);
        return;
      }
      try {
        await api(`/api/sets/${s.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ exercise, sets, reps, rpe, weight, workoutId: w.id }),
        });
        // reflect saved values locally so other rows keep their unsaved input
        s.exercise = exercise; s.sets = sets; s.reps = reps; s.rpe = rpe; s.weight = weight;
        await loadWorkouts();
        await loadOverview();
      } catch (err) { fail(err); }
    }

    function goBackToOverview() {
      state.view = 'overview';
      state.selectedWorkout = null;
      loadOverview();
    }

    async function loadProgress() {
      state.view = 'progress';
      try {
        const all = await api('/api/workouts');
        state.progress = (all || []).map((w) => {
          const sets = w.sets || [];
          const setCount = sets.reduce((n, s) => n + (Number(s.sets) || 1), 0);
          const volume = sets.reduce((sum, s) => sum + (Number(s.sets) || 1) * (Number(s.reps) || 0) * (Number(s.weight) || 0), 0);
          return {
            id: w.id,
            name: w.name,
            notes: w.notes,
            date: w.date || (w.created_at || '').slice(0, 10) || '',
            day: w.day || '',
            completed: !!w.completed,
            set_count: setCount,
            volume: Math.round(volume),
            sets,
          };
        }).sort((a, b) => a.id - b.id);
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
        await loadWorkouts();
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
        await loadWorkouts();
        if (state.view === 'progress') await loadProgress();
        await loadOverview();
      } catch (err) { fail(err); }
    }

    async function startWorkout(w) {
      loadElapsed(w.elapsed_seconds || 0);
      runElapsed();
      await updateWorkoutStatus(w, 'in_progress', elapsedSec);
      syncSetEdits(state.selectedWorkout || w, { preserve: false });
    }

    async function pauseWorkout(w) {
      stopElapsed();
      await updateWorkoutStatus(w, 'in_progress', elapsedSec);
    }

    async function resumeWorkout(w) {
      runElapsed();
      await updateWorkoutStatus(w, 'in_progress', elapsedSec);
    }

    async function finishWorkout(w) {
      stopElapsed();
      await updateWorkoutStatus(w, 'completed', elapsedSec);
    }

    async function reopenWorkout(w) {
      loadElapsed(0);
      await updateWorkoutStatus(w, 'idle');
    }

    async function toggleComplete(w) {
      try {
        await api(`/api/workouts/${w.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ completed: !w.completed }),
        });
        await loadWorkouts();
        if (state.view === 'progress') await loadProgress();
        await loadOverview();
      } catch (err) { fail(err); }
    }

    async function deleteWorkout(w) {
      if (!confirm(`Delete "${w.name}"?`)) return;
      try {
        await api(`/api/workouts/${w.id}`, { method: 'DELETE' });
        if (state.view === 'workouts' && state.selectedWorkout && state.selectedWorkout.id === w.id) {
          state.selectedWorkout = null;
          state.view = 'overview';   // avoid a blank screen on the now-empty detail view
        }
        await loadWorkouts();
        if (state.view === 'progress') await loadProgress();
        await loadOverview();
      } catch (err) { fail(err); }
    }

    async function addSet(w) {
      const draft = state.setDrafts[w.id] || {};
      const exercise = String(draft.exercise || '').trim();
      const sets = Math.max(1, Math.round(Number(draft.sets) || 1));
      const reps = Number(draft.reps);
      const rpe = draft.rpe === '' || draft.rpe == null ? null : Math.min(10, Math.max(1, Math.round(Number(draft.rpe)))) || null;
      const weight = Math.max(0, Number(draft.weight) || 0);

      if (!exercise || !Number.isFinite(reps) || reps <= 0) {
        flash('Exercise and reps are required', true);
        return;
      }

      try {
        await api(`/api/workouts/${w.id}/sets`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ exercise, sets, reps, rpe, weight }),
        });
        state.setDrafts = { ...state.setDrafts, [w.id]: { exercise: '', sets: '', reps: '', rpe: '', weight: '' } };

        await loadWorkouts();
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
        }
        await loadWorkouts();
      } catch (err) { fail(err); }
    }

    async function deleteSet(w, s) {
      try {
        await api(`/api/sets/${s.id}`, { method: 'DELETE' });
        if (state.view === 'workouts' && state.selectedWorkout && state.selectedWorkout.id === w.id) {
          const data = await api(`/api/workouts/${w.id}`);
          state.selectedWorkout = data;
          if (data.status === 'in_progress') syncSetEdits(data, { preserve: true });
        }
        await loadWorkouts();
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
        await loadWorkouts();
        await loadArchiveCount();
      } catch (err) { fail(err); }
    }

    const timerPresets = [30, 60, 90, 120, 180, 240, 300, 360, 420, 480, 540, 600];
    const timerDisplay = Vue.ref('00:00:00');   // workout elapsed (counts up)
    const restTimerDisplay = Vue.ref('01:00');  // rest countdown (counts down)
    let elapsedSec = 0;
    let restSec = 0;
    let elapsedId = null;
    let restId = null;

    function renderElapsed() { timerDisplay.value = formatElapsed(elapsedSec); }
    function renderRest() { restTimerDisplay.value = formatElapsed(restSec); }

    // --- workout elapsed timer (single source of truth) ---
    function runElapsed() {
      if (elapsedId) return;
      state.running = true;
      elapsedId = setInterval(() => { elapsedSec += 1; renderElapsed(); }, 1000);
    }
    function stopElapsed() {
      clearInterval(elapsedId);
      elapsedId = null;
      state.running = false;
    }
    function loadElapsed(seconds) {
      stopElapsed();
      elapsedSec = Math.max(0, Math.round(Number(seconds) || 0));
      renderElapsed();
    }

    // --- rest countdown timer (independent of the workout timer) ---
    function setRest(secs) {
      clearInterval(restId);
      restId = null;
      restSec = Math.max(0, Math.round(Number(secs) || 0));
      renderRest();
    }
    function startRest() {
      if (restId) return;
      if (restSec <= 0) restSec = Math.max(0, Math.round(Number(state.timerDuration) || 0));
      if (restSec <= 0) return;
      renderRest();
      restId = setInterval(() => {
        restSec -= 1;
        if (restSec <= 0) {
          restSec = 0;
          renderRest();
          clearInterval(restId);
          restId = null;
          if (navigator.vibrate) navigator.vibrate(400);
          flash('Rest over — next set!');
          return;
        }
        renderRest();
      }, 1000);
    }
    function pauseRest() {
      clearInterval(restId);
      restId = null;
    }
    function resetRest() {
      setRest(state.timerDuration);
    }

    loadOverview();
    loadWorkouts();
    loadArchiveCount();

    return {
      ...toRefs(state),
      timerDisplay,
      restTimerDisplay,
      formatWeekLabel,
      formatElapsed,
      changeWeek,
      toggleWeekPanel,
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
      toggleComplete,
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
    };
  },
}).mount('#app');
