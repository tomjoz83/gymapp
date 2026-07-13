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
    });

    onUnauthorized = () => { state.unlocked = false; };

    async function loadActiveProgram() {
      try {
        state.activeProgram = await api('/api/active-program');
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

    return { ...toRefs(state), unlock, lock, saveEffortScale };
  },
}).mount('#app');
