// public/logic.js
// Pure, framework-agnostic workout logic. Dual-loaded:
//  - browser: <script src="logic.js"> sets window.PTLogic
//  - node:    require('../public/logic.js') gets module.exports
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PTLogic = api;
})(typeof self !== 'undefined' ? self : this, function () {
  function rpeToRir(rpe) {
    if (rpe == null) return null;
    const rir = 10 - Number(rpe);
    return Math.min(5, Math.max(0, rir));
  }
  function rirToRpe(rir) {
    if (rir == null) return null;
    const rpe = 10 - Number(rir);
    return Math.min(10, Math.max(1, rpe));
  }
  function resolvePrevious(priorSets, setNumber) {
    if (!Array.isArray(priorSets)) return null;
    const m = priorSets.find((s) => s.set_number === setNumber);
    return m ? { weight: m.weight, reps: m.reps, rpe: m.rpe } : null;
  }
  function prefillForSet(priorSets, setNumber, target) {
    const prev = resolvePrevious(priorSets, setNumber);
    if (prev) return { weight: prev.weight, reps: prev.reps };
    const t = target || {};
    if (t.target_weight != null || t.target_reps != null) {
      return { weight: t.target_weight != null ? t.target_weight : null, reps: t.target_reps != null ? t.target_reps : null };
    }
    return { weight: null, reps: null };
  }
  function formatPrevious(prev, scale) {
    if (!prev) return '—';
    const base = `${prev.weight}×${prev.reps}`;
    if (prev.rpe == null) return base;
    if (scale === 'rir') return `${base} (${rpeToRir(prev.rpe)} RIR)`;
    return `${base} @${prev.rpe}`;
  }
  function nextRestState(seconds) {
    const s = Math.max(0, Math.floor(seconds || 0));
    return { remaining: s, running: s > 0 };
  }
  return { rpeToRir, rirToRpe, resolvePrevious, prefillForSet, formatPrevious, nextRestState };
});
